from __future__ import annotations

import argparse
import base64
import binascii
import contextlib
import io
import json
import logging
import math
import os
import shutil
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator, Literal

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, ValidationError
from starlette.datastructures import UploadFile


logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("cola.sam2")

SUPPORTED_MODEL_REFS = {
    "facebook/sam2-hiera-tiny",
    "facebook/sam2-hiera-small",
    "facebook/sam2-hiera-base-plus",
    "facebook/sam2-hiera-large",
    "facebook/sam2.1-hiera-tiny",
    "facebook/sam2.1-hiera-small",
    "facebook/sam2.1-hiera-base-plus",
    "facebook/sam2.1-hiera-large",
}
DEFAULT_MODEL_REF = "facebook/sam2.1-hiera-tiny"


class PromptPayload(BaseModel):
    points: list[list[float]] | None = None
    labels: list[int] | None = None
    box: list[float] | None = None
    multimask_output: bool = False


class ImagePredictPayload(PromptPayload):
    image_base64: str = Field(min_length=1)


class VideoPromptPayload(BaseModel):
    frame_index: int = Field(ge=0)
    object_id: int = Field(ge=0)
    points: list[list[float]] | None = None
    labels: list[int] | None = None
    box: list[float] | None = None
    clear_old_points: bool = True


class VideoPropagationPayload(BaseModel):
    start_frame_index: int | None = Field(default=None, ge=0)
    max_frames: int | None = Field(default=None, ge=1, le=100000)
    direction: Literal["forward", "backward", "both"] = "both"


@dataclass(frozen=True)
class RuntimeSettings:
    model_ref: str
    data_root: Path
    max_image_bytes: int = 25 * 1024 * 1024
    max_image_pixels: int = 40_000_000
    max_video_bytes: int = 512 * 1024 * 1024
    max_video_sessions: int = 2
    session_ttl_seconds: int = 3600
    force_cpu: bool = False


@dataclass
class VideoSession:
    session_id: str
    directory: Path
    video_path: Path
    state: dict[str, Any]
    created_at: float
    last_used_at: float
    cancel_event: threading.Event
    busy: bool = False


class SessionNotFoundError(RuntimeError):
    pass


class SessionBusyError(RuntimeError):
    pass


class SessionCapacityError(RuntimeError):
    pass


def _parse_json_value(value: Any, field_name: str, default: Any = None) -> Any:
    if value is None:
        return default
    if isinstance(value, UploadFile):
        raise ValueError(f"{field_name} 必须是 JSON 文本。")
    try:
        return json.loads(str(value))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{field_name} 不是合法 JSON。") from exc


def _parse_form_boolean(value: Any, field_name: str, default: bool) -> bool:
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{field_name} 必须是 true 或 false。")


def _decode_base64_payload(value: str) -> bytes:
    encoded = value.split(",", 1)[1] if value.startswith("data:") and "," in value else value
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("image_base64 不是合法 base64。") from exc


def _load_image(payload: bytes, settings: RuntimeSettings) -> Image.Image:
    if not payload:
        raise ValueError("图片内容不能为空。")
    if len(payload) > settings.max_image_bytes:
        raise ValueError(
            f"图片超过大小限制：最大 {settings.max_image_bytes // 1024 // 1024} MiB。"
        )

    try:
        image = Image.open(io.BytesIO(payload))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("无法解析图片内容。") from exc

    if image.width * image.height > settings.max_image_pixels:
        raise ValueError(f"图片像素数超过限制：最大 {settings.max_image_pixels}。")
    return image.convert("RGB")


def _validate_prompt(
    payload: PromptPayload | VideoPromptPayload,
    width: int,
    height: int,
) -> tuple[np.ndarray | None, np.ndarray | None, np.ndarray | None]:
    if (payload.points is None) != (payload.labels is None):
        raise ValueError("points 和 labels 必须同时提供。")
    if payload.points is None and payload.box is None:
        raise ValueError("至少需要提供 points 或 box。")

    point_array: np.ndarray | None = None
    label_array: np.ndarray | None = None
    box_array: np.ndarray | None = None

    if payload.points is not None and payload.labels is not None:
        if len(payload.points) == 0:
            raise ValueError("points 不能为空。")
        if len(payload.points) != len(payload.labels):
            raise ValueError("points 与 labels 数量必须一致。")
        if any(len(point) != 2 for point in payload.points):
            raise ValueError("每个 point 必须是 [x, y]。")
        if any(label not in {0, 1} for label in payload.labels):
            raise ValueError("labels 只允许 0（背景）或 1（前景）。")
        if any(
            not math.isfinite(value)
            for point in payload.points
            for value in point
        ):
            raise ValueError("points 必须是有限数字。")
        if any(
            point[0] < 0
            or point[0] >= width
            or point[1] < 0
            or point[1] >= height
            for point in payload.points
        ):
            raise ValueError("points 必须位于图片或视频帧范围内。")
        point_array = np.asarray(payload.points, dtype=np.float32)
        label_array = np.asarray(payload.labels, dtype=np.int32)

    if payload.box is not None:
        if len(payload.box) != 4 or any(
            not math.isfinite(value) for value in payload.box
        ):
            raise ValueError("box 必须是有限数字组成的 [x_min, y_min, x_max, y_max]。")
        x_min, y_min, x_max, y_max = payload.box
        if not (0 <= x_min < x_max <= width and 0 <= y_min < y_max <= height):
            raise ValueError("box 必须位于图片或视频帧范围内，且最大坐标大于最小坐标。")
        box_array = np.asarray(payload.box, dtype=np.float32)

    return point_array, label_array, box_array


def _serialize_mask(
    mask: np.ndarray,
    *,
    score: float | None = None,
    object_id: int | None = None,
) -> dict[str, Any]:
    binary = np.asarray(mask, dtype=np.bool_)
    if binary.ndim != 2:
        raise ValueError(f"mask 必须是二维数组，实际 shape={binary.shape}。")

    height, width = binary.shape
    image = Image.fromarray(binary.astype(np.uint8) * 255)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", compress_level=4)

    ys, xs = np.nonzero(binary)
    if xs.size == 0:
        bounding_box = [0, 0, 0, 0]
    else:
        x_min = int(xs.min())
        y_min = int(ys.min())
        bounding_box = [
            x_min,
            y_min,
            int(xs.max()) - x_min + 1,
            int(ys.max()) - y_min + 1,
        ]

    result: dict[str, Any] = {
        "format": "png",
        "size": [height, width],
        "area": int(binary.sum()),
        "bbox": bounding_box,
        "png_base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
    }
    if score is not None:
        result["score"] = round(float(score), 6)
    if object_id is not None:
        result["object_id"] = int(object_id)
    return result


def _serialize_video_masks(
    object_ids: list[int], masks: np.ndarray
) -> list[dict[str, Any]]:
    binary_masks = np.asarray(masks, dtype=np.bool_)
    if binary_masks.ndim == 4 and binary_masks.shape[1] == 1:
        binary_masks = binary_masks[:, 0]
    if binary_masks.ndim != 3:
        raise ValueError(f"视频 mask 必须是 NxHxW，实际 shape={binary_masks.shape}。")
    if len(object_ids) != len(binary_masks):
        raise ValueError("object_ids 与视频 mask 数量不一致。")
    return [
        _serialize_mask(mask, object_id=object_id)
        for object_id, mask in zip(object_ids, binary_masks, strict=True)
    ]


class Sam2Runtime:
    def __init__(self, model_ref: str, force_cpu: bool = False) -> None:
        import torch
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        from sam2.sam2_video_predictor import SAM2VideoPredictor

        self.model_ref = model_ref
        self.torch = torch
        self.device = torch.device(
            "cuda" if torch.cuda.is_available() and not force_cpu else "cpu"
        )
        self.autocast_dtype = None
        if self.device.type == "cuda":
            if torch.cuda.get_device_properties(0).major >= 8:
                torch.backends.cuda.matmul.allow_tf32 = True
                torch.backends.cudnn.allow_tf32 = True
            self.autocast_dtype = (
                torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
            )

        logger.info("Loading SAM 2 model=%s device=%s", model_ref, self.device)
        self.video_predictor = SAM2VideoPredictor.from_pretrained(
            model_ref,
            device=self.device,
        )
        self.image_predictor = SAM2ImagePredictor(self.video_predictor)
        self.inference_lock = threading.Lock()
        logger.info("SAM 2 model ready: model=%s device=%s", model_ref, self.device)

    def _autocast(self):
        if self.device.type == "cuda" and self.autocast_dtype is not None:
            return self.torch.autocast("cuda", dtype=self.autocast_dtype)
        return contextlib.nullcontext()

    def health(self) -> dict[str, Any]:
        result = {
            "status": "ok",
            "model": self.model_ref,
            "device": self.device.type,
        }
        if self.device.type == "cuda":
            result["gpu"] = self.torch.cuda.get_device_name(0)
            result["precision"] = str(self.autocast_dtype).removeprefix("torch.")
        return result

    def predict_image(
        self,
        image: Image.Image,
        points: np.ndarray | None,
        labels: np.ndarray | None,
        box: np.ndarray | None,
        multimask_output: bool,
    ) -> tuple[np.ndarray, np.ndarray]:
        with self.inference_lock, self._autocast():
            self.image_predictor.set_image(image)
            try:
                masks, scores, _ = self.image_predictor.predict(
                    point_coords=points,
                    point_labels=labels,
                    box=box,
                    multimask_output=multimask_output,
                )
                return np.asarray(masks > 0), np.asarray(scores, dtype=np.float32)
            finally:
                self.image_predictor.reset_predictor()

    def initialize_video(
        self,
        video_path: Path,
        *,
        offload_video_to_cpu: bool,
        offload_state_to_cpu: bool,
    ) -> dict[str, Any]:
        with self.inference_lock, self._autocast():
            return self.video_predictor.init_state(
                str(video_path),
                offload_video_to_cpu=offload_video_to_cpu,
                offload_state_to_cpu=offload_state_to_cpu,
            )

    def add_video_prompt(
        self,
        state: dict[str, Any],
        payload: VideoPromptPayload,
        points: np.ndarray | None,
        labels: np.ndarray | None,
        box: np.ndarray | None,
    ) -> tuple[int, list[int], np.ndarray]:
        with self.inference_lock, self._autocast():
            frame_index, object_ids, masks = self.video_predictor.add_new_points_or_box(
                inference_state=state,
                frame_idx=payload.frame_index,
                obj_id=payload.object_id,
                points=points,
                labels=labels,
                clear_old_points=payload.clear_old_points,
                normalize_coords=True,
                box=box,
            )
            return (
                int(frame_index),
                [int(object_id) for object_id in object_ids],
                (masks > 0).detach().cpu().numpy(),
            )

    def propagate_video(
        self,
        state: dict[str, Any],
        *,
        start_frame_index: int | None,
        max_frames: int | None,
        reverse: bool,
    ) -> Iterator[tuple[int, list[int], np.ndarray]]:
        with self.inference_lock, self._autocast():
            for frame_index, object_ids, masks in self.video_predictor.propagate_in_video(
                inference_state=state,
                start_frame_idx=start_frame_index,
                max_frame_num_to_track=max_frames,
                reverse=reverse,
            ):
                yield (
                    int(frame_index),
                    [int(object_id) for object_id in object_ids],
                    (masks > 0).detach().cpu().numpy(),
                )

    def reset_video(self, state: dict[str, Any]) -> None:
        with self.inference_lock:
            self.video_predictor.reset_state(state)


class VideoSessionManager:
    def __init__(self, runtime: Any, settings: RuntimeSettings) -> None:
        self.runtime = runtime
        self.settings = settings
        self.sessions: dict[str, VideoSession] = {}
        self.lock = threading.RLock()
        self.creating_sessions = 0

    def _expired_sessions(self) -> list[VideoSession]:
        now = time.monotonic()
        expired: list[VideoSession] = []
        with self.lock:
            for session_id, session in list(self.sessions.items()):
                if (
                    not session.busy
                    and now - session.last_used_at > self.settings.session_ttl_seconds
                ):
                    expired.append(self.sessions.pop(session_id))
        return expired

    def _dispose(self, session: VideoSession) -> None:
        try:
            self.runtime.reset_video(session.state)
        except Exception:
            logger.exception("Failed to reset SAM 2 session=%s", session.session_id)
        shutil.rmtree(session.directory, ignore_errors=True)

    def prune_expired(self) -> None:
        for session in self._expired_sessions():
            logger.info("Expiring SAM 2 session=%s", session.session_id)
            self._dispose(session)

    def create(
        self,
        directory: Path,
        video_path: Path,
        *,
        offload_video_to_cpu: bool,
        offload_state_to_cpu: bool,
    ) -> VideoSession:
        self.prune_expired()
        with self.lock:
            if (
                len(self.sessions) + self.creating_sessions
                >= self.settings.max_video_sessions
            ):
                raise SessionCapacityError(
                    f"视频会话已达到上限 {self.settings.max_video_sessions}。"
                )
            self.creating_sessions += 1

        try:
            state = self.runtime.initialize_video(
                video_path,
                offload_video_to_cpu=offload_video_to_cpu,
                offload_state_to_cpu=offload_state_to_cpu,
            )
            now = time.monotonic()
            session = VideoSession(
                session_id=str(uuid.uuid4()),
                directory=directory,
                video_path=video_path,
                state=state,
                created_at=now,
                last_used_at=now,
                cancel_event=threading.Event(),
            )
            with self.lock:
                self.sessions[session.session_id] = session
            return session
        finally:
            with self.lock:
                self.creating_sessions -= 1

    def get(self, session_id: str) -> VideoSession:
        self.prune_expired()
        with self.lock:
            session = self.sessions.get(session_id)
            if session is None:
                raise SessionNotFoundError("视频会话不存在或已经过期。")
            session.last_used_at = time.monotonic()
            return session

    def begin_propagation(self, session_id: str) -> VideoSession:
        session = self.get(session_id)
        with self.lock:
            if session.busy:
                raise SessionBusyError("视频会话正在传播 mask，请稍后重试。")
            session.busy = True
            session.cancel_event.clear()
            return session

    def finish_propagation(self, session_id: str) -> None:
        with self.lock:
            session = self.sessions.get(session_id)
            if session is not None:
                session.busy = False
                session.last_used_at = time.monotonic()

    def cancel(self, session_id: str) -> VideoSession:
        session = self.get(session_id)
        session.cancel_event.set()
        return session

    def close(self, session_id: str) -> None:
        with self.lock:
            session = self.sessions.get(session_id)
            if session is None:
                raise SessionNotFoundError("视频会话不存在或已经过期。")
            if session.busy:
                raise SessionBusyError("请先取消正在进行的视频传播，再关闭会话。")
            self.sessions.pop(session_id)
        self._dispose(session)

    def close_all(self) -> None:
        with self.lock:
            sessions = list(self.sessions.values())
            self.sessions.clear()
        for session in sessions:
            session.cancel_event.set()
            self._dispose(session)

    def count(self) -> int:
        self.prune_expired()
        with self.lock:
            return len(self.sessions)


def _validation_detail(error: ValidationError) -> list[dict[str, Any]]:
    return [
        {
            "type": item.get("type"),
            "loc": item.get("loc"),
            "msg": item.get("msg"),
        }
        for item in error.errors()
    ]


async def _read_upload(upload: UploadFile, maximum_bytes: int) -> bytes:
    payload = bytearray()
    while chunk := await upload.read(1024 * 1024):
        payload.extend(chunk)
        if len(payload) > maximum_bytes:
            raise ValueError(f"上传内容超过大小限制：最大 {maximum_bytes // 1024 // 1024} MiB。")
    return bytes(payload)


async def _write_upload(
    upload: UploadFile, target: Path, maximum_bytes: int
) -> int:
    written = 0
    with target.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            written += len(chunk)
            if written > maximum_bytes:
                raise ValueError(
                    f"视频超过大小限制：最大 {maximum_bytes // 1024 // 1024} MiB。"
                )
            output.write(chunk)
    if written == 0:
        raise ValueError("视频内容不能为空。")
    return written


async def _image_request(
    request: Request, settings: RuntimeSettings
) -> tuple[Image.Image, PromptPayload]:
    content_type = request.headers.get("content-type", "").lower()
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("image")
        if not isinstance(upload, UploadFile):
            raise ValueError("multipart 请求必须提供 image 文件。")
        try:
            image_bytes = await _read_upload(upload, settings.max_image_bytes)
        finally:
            await upload.close()
        prompt = PromptPayload.model_validate(
            {
                "points": _parse_json_value(form.get("points"), "points"),
                "labels": _parse_json_value(form.get("labels"), "labels"),
                "box": _parse_json_value(form.get("box"), "box"),
                "multimask_output": _parse_form_boolean(
                    form.get("multimask_output"), "multimask_output", False
                ),
            }
        )
        return _load_image(image_bytes, settings), prompt

    if content_type.startswith("application/json"):
        payload = ImagePredictPayload.model_validate(await request.json())
        return _load_image(_decode_base64_payload(payload.image_base64), settings), payload

    raise ValueError("只支持 multipart/form-data 或 application/json 请求。")


def _session_response(session: VideoSession, settings: RuntimeSettings) -> dict[str, Any]:
    return {
        "session_id": session.session_id,
        "num_frames": int(session.state["num_frames"]),
        "width": int(session.state["video_width"]),
        "height": int(session.state["video_height"]),
        "expires_in_seconds": settings.session_ttl_seconds,
    }


def create_app(runtime: Any, settings: RuntimeSettings) -> FastAPI:
    settings.data_root.mkdir(parents=True, exist_ok=True)
    sessions = VideoSessionManager(runtime, settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        sessions.close_all()

    app = FastAPI(
        title="Cola SAM 2 Inference",
        version="1.0.0",
        description="Promptable image segmentation and stateful video tracking with SAM 2.",
        lifespan=lifespan,
    )

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            **runtime.health(),
            "active_video_sessions": sessions.count(),
            "max_video_sessions": settings.max_video_sessions,
        }

    @app.post("/predict")
    async def predict_image(request: Request) -> dict[str, Any]:
        try:
            image, prompt = await _image_request(request, settings)
            points, labels, box = _validate_prompt(prompt, image.width, image.height)
            masks, scores = runtime.predict_image(
                image,
                points,
                labels,
                box,
                prompt.multimask_output,
            )
            return {
                "model": runtime.model_ref,
                "device": str(runtime.device),
                "width": image.width,
                "height": image.height,
                "masks": [
                    _serialize_mask(mask, score=float(score))
                    for mask, score in zip(masks, scores, strict=True)
                ],
            }
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=_validation_detail(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("SAM 2 image prediction failed")
            raise HTTPException(status_code=500, detail="SAM 2 图片分割失败。") from exc

    @app.post("/video/sessions", status_code=201)
    async def create_video_session(request: Request) -> dict[str, Any]:
        content_type = request.headers.get("content-type", "").lower()
        if not content_type.startswith("multipart/form-data"):
            raise HTTPException(status_code=415, detail="视频会话只支持 multipart/form-data。")

        directory: Path | None = None
        try:
            form = await request.form()
            upload = form.get("video")
            if not isinstance(upload, UploadFile):
                raise ValueError("multipart 请求必须提供 video 文件。")
            filename = upload.filename or "video.mp4"
            if Path(filename).suffix.lower() != ".mp4":
                raise ValueError("SAM 2 视频会话目前只支持 MP4 文件。")
            offload_video_to_cpu = _parse_form_boolean(
                form.get("offload_video_to_cpu"), "offload_video_to_cpu", True
            )
            offload_state_to_cpu = _parse_form_boolean(
                form.get("offload_state_to_cpu"), "offload_state_to_cpu", False
            )

            directory = Path(tempfile.mkdtemp(prefix="session-", dir=settings.data_root))
            video_path = directory / "video.mp4"
            try:
                await _write_upload(upload, video_path, settings.max_video_bytes)
            finally:
                await upload.close()
            session = sessions.create(
                directory,
                video_path,
                offload_video_to_cpu=offload_video_to_cpu,
                offload_state_to_cpu=offload_state_to_cpu,
            )
            return _session_response(session, settings)
        except SessionCapacityError as exc:
            if directory is not None:
                shutil.rmtree(directory, ignore_errors=True)
            raise HTTPException(status_code=429, detail=str(exc)) from exc
        except ValueError as exc:
            if directory is not None:
                shutil.rmtree(directory, ignore_errors=True)
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            if directory is not None:
                shutil.rmtree(directory, ignore_errors=True)
            logger.exception("SAM 2 video session initialization failed")
            raise HTTPException(status_code=500, detail="SAM 2 视频初始化失败。") from exc

    @app.post("/video/sessions/{session_id}/prompts")
    async def add_video_prompt(session_id: str, request: Request) -> dict[str, Any]:
        try:
            payload = VideoPromptPayload.model_validate(await request.json())
            session = sessions.get(session_id)
            if session.busy:
                raise SessionBusyError("视频会话正在传播 mask，请稍后重试。")
            width = int(session.state["video_width"])
            height = int(session.state["video_height"])
            if payload.frame_index >= int(session.state["num_frames"]):
                raise ValueError("frame_index 超出视频帧范围。")
            points, labels, box = _validate_prompt(payload, width, height)
            frame_index, object_ids, masks = runtime.add_video_prompt(
                session.state,
                payload,
                points,
                labels,
                box,
            )
            return {
                "session_id": session_id,
                "frame_index": frame_index,
                "results": _serialize_video_masks(object_ids, masks),
            }
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=_validation_detail(exc)) from exc
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except SessionBusyError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Failed to add SAM 2 video prompt session=%s", session_id)
            raise HTTPException(status_code=500, detail="添加视频提示失败。") from exc

    @app.post("/video/sessions/{session_id}/propagate")
    async def propagate_video(session_id: str, request: Request) -> StreamingResponse:
        try:
            payload = VideoPropagationPayload.model_validate(await request.json())
            session = sessions.begin_propagation(session_id)
            if not session.state.get("obj_ids"):
                sessions.finish_propagation(session_id)
                raise ValueError("请先为至少一个对象添加 points 或 box。")
            if (
                payload.start_frame_index is not None
                and payload.start_frame_index >= int(session.state["num_frames"])
            ):
                sessions.finish_propagation(session_id)
                raise ValueError("start_frame_index 超出视频帧范围。")
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=_validation_detail(exc)) from exc
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except SessionBusyError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        def stream() -> Iterator[str]:
            seen_frames: set[int] = set()
            directions = (
                [False, True]
                if payload.direction == "both"
                else [payload.direction == "backward"]
            )
            try:
                for reverse in directions:
                    for frame_index, object_ids, masks in runtime.propagate_video(
                        session.state,
                        start_frame_index=payload.start_frame_index,
                        max_frames=payload.max_frames,
                        reverse=reverse,
                    ):
                        if session.cancel_event.is_set():
                            yield json.dumps(
                                {"event": "canceled", "session_id": session_id},
                                separators=(",", ":"),
                            ) + "\n"
                            return
                        if frame_index in seen_frames:
                            continue
                        seen_frames.add(frame_index)
                        yield json.dumps(
                            {
                                "event": "frame",
                                "session_id": session_id,
                                "frame_index": frame_index,
                                "results": _serialize_video_masks(object_ids, masks),
                            },
                            separators=(",", ":"),
                        ) + "\n"
                yield json.dumps(
                    {
                        "event": "complete",
                        "session_id": session_id,
                        "frame_count": len(seen_frames),
                    },
                    separators=(",", ":"),
                ) + "\n"
            except Exception as exc:
                logger.exception("SAM 2 propagation failed session=%s", session_id)
                yield json.dumps(
                    {
                        "event": "error",
                        "session_id": session_id,
                        "detail": str(exc),
                    },
                    separators=(",", ":"),
                ) + "\n"
            finally:
                sessions.finish_propagation(session_id)

        return StreamingResponse(stream(), media_type="application/x-ndjson")

    @app.post("/video/sessions/{session_id}/cancel")
    def cancel_video_propagation(session_id: str) -> dict[str, Any]:
        try:
            session = sessions.cancel(session_id)
            return {
                "session_id": session_id,
                "cancel_requested": True,
                "propagating": session.busy,
            }
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.delete("/video/sessions/{session_id}", status_code=204)
    def close_video_session(session_id: str) -> None:
        try:
            sessions.close(session_id)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except SessionBusyError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    return app


def _positive_int_env(name: str, fallback: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return fallback
    value = int(raw)
    if value <= 0:
        raise ValueError(f"{name} 必须大于 0。")
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cola SAM 2 inference server")
    parser.add_argument("--model", default=os.environ.get("MODEL_REF", DEFAULT_MODEL_REF))
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument(
        "--data-root",
        default=os.environ.get("SAM2_SESSION_DATA_ROOT", "/tmp/cola-sam2-sessions"),
    )
    parser.add_argument(
        "--force-cpu",
        action="store_true",
        default=os.environ.get("SAM2_FORCE_CPU", "0") == "1",
    )
    args = parser.parse_args()
    if args.model not in SUPPORTED_MODEL_REFS:
        parser.error(
            f"unsupported SAM 2 model: {args.model}; supported: {', '.join(sorted(SUPPORTED_MODEL_REFS))}"
        )
    return args


def main() -> None:
    import uvicorn

    args = parse_args()
    settings = RuntimeSettings(
        model_ref=args.model,
        data_root=Path(args.data_root),
        max_image_bytes=_positive_int_env("SAM2_MAX_IMAGE_BYTES", 25 * 1024 * 1024),
        max_image_pixels=_positive_int_env("SAM2_MAX_IMAGE_PIXELS", 40_000_000),
        max_video_bytes=_positive_int_env("SAM2_MAX_VIDEO_BYTES", 512 * 1024 * 1024),
        max_video_sessions=_positive_int_env("SAM2_MAX_VIDEO_SESSIONS", 2),
        session_ttl_seconds=_positive_int_env("SAM2_SESSION_TTL_SECONDS", 3600),
        force_cpu=args.force_cpu,
    )
    runtime = Sam2Runtime(settings.model_ref, force_cpu=settings.force_cpu)
    uvicorn.run(create_app(runtime, settings), host=args.host, port=args.port, workers=1)


if __name__ == "__main__":
    main()
