from __future__ import annotations

import argparse
import base64
import io
import os
from typing import Any

import requests
import torch
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field, ValidationError
from PIL import Image, UnidentifiedImageError
from transformers import AutoImageProcessor, AutoModelForObjectDetection


class PredictRequest(BaseModel):
    image_url: str | None = Field(default=None, description="HTTP(S) image URL")
    image_base64: str | None = Field(
        default=None,
        description="Base64 image payload. A data:image/... prefix is allowed.",
    )
    threshold: float | None = Field(default=None, ge=0, le=1)


class RuntimeState:
    def __init__(self, model_ref: str, threshold: float) -> None:
        self.model_ref = model_ref
        self.threshold = threshold
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.processor = AutoImageProcessor.from_pretrained(model_ref)
        self.model = AutoModelForObjectDetection.from_pretrained(model_ref)
        self.model.to(self.device)
        self.model.eval()

    @torch.inference_mode()
    def predict(self, image: Image.Image, threshold: float | None = None) -> dict[str, Any]:
        rgb_image = image.convert("RGB")
        inputs = self.processor(images=rgb_image, return_tensors="pt")
        inputs = {key: value.to(self.device) for key, value in inputs.items()}
        outputs = self.model(**inputs)
        target_sizes = torch.tensor([rgb_image.size[::-1]], device=self.device)
        results = self.processor.post_process_object_detection(
            outputs,
            target_sizes=target_sizes,
            threshold=threshold if threshold is not None else self.threshold,
        )[0]

        detections = []
        id2label = getattr(self.model.config, "id2label", {})
        for score, label, box in zip(
            results["scores"],
            results["labels"],
            results["boxes"],
            strict=False,
        ):
            label_id = int(label.item())
            detections.append(
                {
                    "label_id": label_id,
                    "label": id2label.get(label_id, str(label_id)),
                    "score": round(float(score.item()), 6),
                    "box": [round(float(value), 3) for value in box.tolist()],
                }
            )

        return {
            "model": self.model_ref,
            "device": self.device,
            "width": rgb_image.width,
            "height": rgb_image.height,
            "detections": detections,
        }


def load_image_from_bytes(payload: bytes) -> Image.Image:
    try:
        return Image.open(io.BytesIO(payload))
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=400, detail="无法解析图片内容。") from exc


def decode_base64_image(value: str) -> Image.Image:
    payload = value.split(",", 1)[1] if value.startswith("data:") and "," in value else value
    try:
        return load_image_from_bytes(base64.b64decode(payload, validate=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="image_base64 不是合法 base64。") from exc


def fetch_image(url: str) -> Image.Image:
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="image_url 只支持 http:// 或 https://。")

    try:
        response = requests.get(url, timeout=20)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=400, detail=f"下载图片失败：{exc}") from exc

    return load_image_from_bytes(response.content)


def create_app(state: RuntimeState) -> FastAPI:
    app = FastAPI(title="Cola Vision Inference", version="1.0.0")

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "model": state.model_ref,
            "device": state.device,
        }

    @app.post("/predict")
    async def predict(
        image: UploadFile | None = File(default=None),
        threshold: float | None = Form(default=None),
        request: Request | None = None,
    ) -> dict[str, Any]:
        if image is not None:
            payload = await image.read()
            return state.predict(load_image_from_bytes(payload), threshold)

        payload = await load_predict_request(request)

        if payload.image_base64:
            return state.predict(decode_base64_image(payload.image_base64), payload.threshold)

        if payload.image_url:
            return state.predict(fetch_image(payload.image_url), payload.threshold)

        raise HTTPException(
            status_code=400,
            detail="请通过 multipart image、JSON image_url 或 JSON image_base64 提供图片。",
        )

    return app


async def load_predict_request(request: Request | None) -> PredictRequest:
    if request is None:
        return PredictRequest()

    try:
        payload = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="请求体必须是 JSON。") from exc

    try:
        return PredictRequest(**payload)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.errors()) from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cola vision detection inference server")
    parser.add_argument("--model", default=os.environ.get("MODEL_REF", "PekingU/rtdetr_v2_r50vd"))
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument(
        "--threshold",
        type=float,
        default=float(os.environ.get("DETECTION_THRESHOLD", "0.5")),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    state = RuntimeState(args.model, args.threshold)
    uvicorn.run(create_app(state), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
