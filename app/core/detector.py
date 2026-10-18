from __future__ import annotations

import threading
import time
import uuid
from pathlib import Path
from typing import Optional, Union

import cv2
import numpy as np
from ultralytics import YOLO

from app.config import (
    CLASS_NAMES,
    DEFAULT_CONF,
    MODEL_PATH,
    RESULTS_DIR,
    THUMBNAIL_DIR,
    THUMBNAIL_WIDTH,
)


class FireSmokeDetector:
    """Thread-safe fire/smoke detector with YOLO and optional RKNN backends."""

    _instance: Optional["FireSmokeDetector"] = None
    _lock = threading.Lock()

    def __new__(cls, model_path: Union[str, Path, None] = None):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    obj = super().__new__(cls)
                    obj._initialized = False
                    cls._instance = obj
        return cls._instance

    def __init__(self, model_path: Union[str, Path, None] = None):
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return
            self._model_path = Path(model_path) if model_path else MODEL_PATH
            self._backend = "rknn" if self._model_path.suffix.lower() == ".rknn" else "yolo"
            print(f"[FireSmokeDetector] Loading model: {self._model_path}")
            if self._backend == "rknn":
                self._model = self._load_rknn_model(self._model_path)
            else:
                self._model = YOLO(str(self._model_path))
            self._initialized = True
            print(f"[FireSmokeDetector] Model loaded backend={self._backend}")

    @property
    def model(self):
        return self._model

    @property
    def model_path(self) -> Path:
        return self._model_path

    def detect(
        self,
        image_path_or_ndarray: Union[str, Path, np.ndarray],
        conf: float = DEFAULT_CONF,
    ) -> dict:
        if isinstance(image_path_or_ndarray, np.ndarray):
            frame = image_path_or_ndarray.copy()
        else:
            frame = cv2.imread(str(image_path_or_ndarray))
            if frame is None:
                raise ValueError(f"Unable to read image: {image_path_or_ndarray}")

        detections, annotated, inference_ms = self._run_frame(frame, conf)

        uid = uuid.uuid4().hex[:12]
        annotated_filename = f"det_{uid}.jpg"
        annotated_path = RESULTS_DIR / annotated_filename
        cv2.imwrite(str(annotated_path), annotated)

        thumbnail_filename = f"thumb_{uid}.jpg"
        thumbnail_path = THUMBNAIL_DIR / thumbnail_filename
        self._make_thumbnail(annotated, thumbnail_path)

        return {
            "detections": detections,
            "annotated_image": annotated,
            "annotated_path": str(annotated_path),
            "thumbnail_path": str(thumbnail_path),
            "inference_time_ms": round(inference_ms, 2),
        }

    def detect_frame(
        self,
        frame: np.ndarray,
        conf: float = DEFAULT_CONF,
    ) -> dict:
        detections, annotated, inference_ms = self._run_frame(frame, conf)
        return {
            "detections": detections,
            "annotated_image": annotated,
            "inference_time_ms": round(inference_ms, 2),
        }

    def draw_custom_annotations(
        self,
        frame: np.ndarray,
        detections: list[dict],
    ) -> np.ndarray:
        annotated = frame.copy()
        for det in detections:
            cls = det.get("class", "")
            conf = det.get("confidence", 0.0)
            bbox = det.get("bbox", [0, 0, 0, 0])
            x1, y1, x2, y2 = [int(v) for v in bbox]

            if cls == "fire":
                color = (0, 0, 255)
                label = f"Fire: {conf:.2f}"
            elif cls == "smoke":
                color = (255, 165, 0)
                label = f"Smoke: {conf:.2f}"
            elif cls == "suspected_fire":
                color = (0, 165, 255)
                label = f"Suspected: {conf:.2f}"
            else:
                color = (0, 255, 0)
                label = f"{cls}: {conf:.2f}"

            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
            cv2.rectangle(annotated, (x1, max(0, y1 - th - 5)), (x1 + tw + 10, y1), color, -1)
            cv2.putText(
                annotated,
                label,
                (x1 + 5, max(15, y1 - 4)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (255, 255, 255),
                1,
                cv2.LINE_AA,
            )

        return annotated

    def detect_frame_with_tracker(
        self,
        frame: np.ndarray,
        conf: float = DEFAULT_CONF,
        tracker=None,
    ) -> dict:
        t0 = time.perf_counter()
        detections = self._predict(frame, conf)
        inference_ms = (time.perf_counter() - t0) * 1000.0

        if tracker is not None:
            detections = tracker.update(detections, frame.shape[:2], conf_threshold=conf)
            annotated = self.draw_custom_annotations(frame, detections)
        elif self._backend == "rknn":
            annotated = self.draw_custom_annotations(frame, detections)
        else:
            results = self._last_yolo_results
            annotated = results[0].plot()

        return {
            "detections": detections,
            "annotated_image": annotated,
            "inference_time_ms": round(inference_ms, 2),
        }

    def _run_frame(self, frame: np.ndarray, conf: float) -> tuple[list[dict], np.ndarray, float]:
        t0 = time.perf_counter()
        detections = self._predict(frame, conf)
        inference_ms = (time.perf_counter() - t0) * 1000.0
        if self._backend == "rknn":
            annotated = self.draw_custom_annotations(frame, detections)
        else:
            annotated = self._last_yolo_results[0].plot()
        return detections, annotated, inference_ms

    def _predict(self, frame: np.ndarray, conf: float) -> list[dict]:
        if self._backend == "rknn":
            return self._predict_rknn(frame, conf)
        self._last_yolo_results = self._model.predict(source=frame, conf=conf, verbose=False)
        return self._parse_detections(self._last_yolo_results[0])

    @staticmethod
    def _parse_detections(result) -> list[dict]:
        detections: list[dict] = []
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return detections

        for box in boxes:
            cls_id = int(box.cls[0].item())
            conf_val = float(box.conf[0].item())
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append(
                {
                    "class": CLASS_NAMES[cls_id] if cls_id < len(CLASS_NAMES) else f"class_{cls_id}",
                    "confidence": round(conf_val, 4),
                    "bbox": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
                }
            )
        return detections

    @staticmethod
    def _load_rknn_model(model_path: Path):
        try:
            from rknnlite.api import RKNNLite
        except ImportError as exc:
            raise RuntimeError("RKNN backend requires rknnlite on the target device") from exc

        rknn = RKNNLite(verbose=False)
        ret = rknn.load_rknn(str(model_path))
        if ret != 0:
            raise RuntimeError(f"Failed to load RKNN model: {model_path}, ret={ret}")
        ret = rknn.init_runtime(core_mask=RKNNLite.NPU_CORE_0_1_2)
        if ret != 0:
            raise RuntimeError(f"Failed to initialize RKNN runtime, ret={ret}")
        return rknn

    @staticmethod
    def _letterbox(frame: np.ndarray, new_shape: tuple[int, int] = (640, 640)) -> tuple[np.ndarray, float, tuple[float, float]]:
        h, w = frame.shape[:2]
        new_w, new_h = new_shape
        ratio = min(new_w / w, new_h / h)
        resized_w, resized_h = int(round(w * ratio)), int(round(h * ratio))
        dw = (new_w - resized_w) / 2
        dh = (new_h - resized_h) / 2

        resized = cv2.resize(frame, (resized_w, resized_h), interpolation=cv2.INTER_LINEAR)
        top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
        left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
        padded = cv2.copyMakeBorder(resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114))
        return padded, ratio, (dw, dh)

    def _predict_rknn(self, frame: np.ndarray, conf: float = DEFAULT_CONF) -> list[dict]:
        padded, ratio, (dw, dh) = self._letterbox(frame)
        rgb = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB)
        inp = rgb[None, ...].astype(np.uint8)
        outputs = self._model.inference(inputs=[inp])
        if not outputs:
            return []

        pred = np.asarray(outputs[0])
        pred = np.squeeze(pred)
        if pred.ndim != 2:
            return []
        if pred.shape[0] < pred.shape[1]:
            pred = pred.T

        boxes_xywh = pred[:, :4]
        class_scores = pred[:, 4:]
        if class_scores.size == 0:
            return []

        class_ids = np.argmax(class_scores, axis=1)
        scores = class_scores[np.arange(class_scores.shape[0]), class_ids]
        keep = scores >= conf
        if not np.any(keep):
            return []

        boxes_xywh = boxes_xywh[keep]
        scores = scores[keep]
        class_ids = class_ids[keep]

        x, y, w, h = boxes_xywh[:, 0], boxes_xywh[:, 1], boxes_xywh[:, 2], boxes_xywh[:, 3]
        x1 = (x - w / 2 - dw) / ratio
        y1 = (y - h / 2 - dh) / ratio
        x2 = (x + w / 2 - dw) / ratio
        y2 = (y + h / 2 - dh) / ratio

        img_h, img_w = frame.shape[:2]
        x1 = np.clip(x1, 0, img_w - 1)
        y1 = np.clip(y1, 0, img_h - 1)
        x2 = np.clip(x2, 0, img_w - 1)
        y2 = np.clip(y2, 0, img_h - 1)

        nms_boxes = [[float(a), float(b), float(c - a), float(d - b)] for a, b, c, d in zip(x1, y1, x2, y2)]
        indices = cv2.dnn.NMSBoxes(nms_boxes, scores.astype(float).tolist(), conf, 0.45)
        if len(indices) == 0:
            return []

        detections: list[dict] = []
        for idx in np.array(indices).reshape(-1):
            cls_id = int(class_ids[idx])
            detections.append(
                {
                    "class": CLASS_NAMES[cls_id] if cls_id < len(CLASS_NAMES) else f"class_{cls_id}",
                    "confidence": round(float(scores[idx]), 4),
                    "bbox": [
                        round(float(x1[idx]), 1),
                        round(float(y1[idx]), 1),
                        round(float(x2[idx]), 1),
                        round(float(y2[idx]), 1),
                    ],
                }
            )
        return detections

    @staticmethod
    def _make_thumbnail(image: np.ndarray, save_path: Path) -> None:
        h, w = image.shape[:2]
        if w == 0:
            return
        ratio = THUMBNAIL_WIDTH / w
        new_h = int(h * ratio)
        thumb = cv2.resize(image, (THUMBNAIL_WIDTH, new_h), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(save_path), thumb)
