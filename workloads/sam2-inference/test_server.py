from __future__ import annotations

import base64
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from typing import Any, Iterator

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image


def load_server_module() -> ModuleType:
    module_path = Path(__file__).with_name("server.py")
    spec = importlib.util.spec_from_file_location("cola_sam2_server", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


server = load_server_module()


class FakeRuntime:
    model_ref = server.DEFAULT_MODEL_REF
    device = "cuda"

    def __init__(self) -> None:
        self.reset_count = 0

    def health(self) -> dict[str, Any]:
        return {"status": "ok", "model": self.model_ref, "device": self.device}

    def predict_image(
        self,
        image: Image.Image,
        points: np.ndarray | None,
        labels: np.ndarray | None,
        box: np.ndarray | None,
        multimask_output: bool,
    ) -> tuple[np.ndarray, np.ndarray]:
        self.last_image_prompt = (points, labels, box, multimask_output)
        mask = np.zeros((1, image.height, image.width), dtype=np.bool_)
        mask[:, 1:3, 1:3] = True
        return mask, np.asarray([0.9876543], dtype=np.float32)

    def initialize_video(
        self,
        video_path: Path,
        *,
        offload_video_to_cpu: bool,
        offload_state_to_cpu: bool,
    ) -> dict[str, Any]:
        if not video_path.is_file():
            raise RuntimeError("video was not written")
        return {
            "num_frames": 3,
            "video_width": 8,
            "video_height": 6,
            "obj_ids": [],
        }

    def add_video_prompt(
        self,
        state: dict[str, Any],
        payload: Any,
        points: np.ndarray | None,
        labels: np.ndarray | None,
        box: np.ndarray | None,
    ) -> tuple[int, list[int], np.ndarray]:
        state["obj_ids"] = [payload.object_id]
        mask = np.zeros((1, 1, 6, 8), dtype=np.bool_)
        mask[:, :, 2:4, 2:5] = True
        return payload.frame_index, [payload.object_id], mask

    def propagate_video(
        self,
        state: dict[str, Any],
        *,
        start_frame_index: int | None,
        max_frames: int | None,
        reverse: bool,
    ) -> Iterator[tuple[int, list[int], np.ndarray]]:
        frame_order = [0, 1, 2] if not reverse else [0]
        for frame_index in frame_order:
            mask = np.zeros((1, 1, 6, 8), dtype=np.bool_)
            mask[:, :, 1:3, frame_index : frame_index + 2] = True
            yield frame_index, list(state["obj_ids"]), mask

    def reset_video(self, state: dict[str, Any]) -> None:
        self.reset_count += 1
        state["obj_ids"] = []


def png_bytes(width: int = 5, height: int = 4) -> bytes:
    image = Image.new("RGB", (width, height), color=(80, 120, 160))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class Sam2ApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.runtime = FakeRuntime()
        self.settings = server.RuntimeSettings(
            model_ref=server.DEFAULT_MODEL_REF,
            data_root=Path(self.temporary_directory.name),
            max_image_bytes=1024 * 1024,
            max_image_pixels=1000,
            max_video_bytes=1024 * 1024,
            max_video_sessions=2,
            session_ttl_seconds=60,
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_health_and_multipart_image_prediction(self) -> None:
        with TestClient(server.create_app(self.runtime, self.settings)) as client:
            health = client.get("/health")
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json()["active_video_sessions"], 0)

            response = client.post(
                "/predict",
                files={"image": ("sample.png", png_bytes(), "image/png")},
                data={
                    "points": "[[2, 2]]",
                    "labels": "[1]",
                    "multimask_output": "false",
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["model"], server.DEFAULT_MODEL_REF)
        self.assertEqual(result["masks"][0]["format"], "png")
        self.assertEqual(result["masks"][0]["area"], 4)
        self.assertEqual(result["masks"][0]["score"], 0.987654)
        self.assertTrue(base64.b64decode(result["masks"][0]["png_base64"]))

    def test_json_image_prediction_rejects_missing_prompt(self) -> None:
        encoded = base64.b64encode(png_bytes()).decode("ascii")
        with TestClient(server.create_app(self.runtime, self.settings)) as client:
            response = client.post("/predict", json={"image_base64": encoded})

        self.assertEqual(response.status_code, 400)
        self.assertIn("至少需要提供", response.json()["detail"])

    def test_video_session_prompt_propagate_and_close(self) -> None:
        with TestClient(server.create_app(self.runtime, self.settings)) as client:
            created = client.post(
                "/video/sessions",
                files={"video": ("sample.mp4", b"fake-mp4", "video/mp4")},
                data={"offload_video_to_cpu": "true"},
            )
            self.assertEqual(created.status_code, 201, created.text)
            session_id = created.json()["session_id"]
            self.assertEqual(created.json()["num_frames"], 3)

            prompt = client.post(
                f"/video/sessions/{session_id}/prompts",
                json={
                    "frame_index": 0,
                    "object_id": 7,
                    "box": [1, 1, 5, 4],
                },
            )
            self.assertEqual(prompt.status_code, 200, prompt.text)
            self.assertEqual(prompt.json()["results"][0]["object_id"], 7)

            propagated = client.post(
                f"/video/sessions/{session_id}/propagate",
                json={"direction": "both"},
            )
            self.assertEqual(propagated.status_code, 200, propagated.text)
            events = [json.loads(line) for line in propagated.text.splitlines()]
            self.assertEqual([event["event"] for event in events], [
                "frame",
                "frame",
                "frame",
                "complete",
            ])
            self.assertEqual(events[-1]["frame_count"], 3)

            closed = client.delete(f"/video/sessions/{session_id}")
            self.assertEqual(closed.status_code, 204, closed.text)

        self.assertGreaterEqual(self.runtime.reset_count, 1)


if __name__ == "__main__":
    unittest.main()
