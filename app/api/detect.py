"""
林焰智巡 - 图片 / 视频检测 API
"""

import uuid
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
from fastapi import APIRouter, File, UploadFile, Query, HTTPException

from app.config import (
    UPLOAD_DIR,
    RESULTS_DIR,
    VIDEO_DIR,
    DEFAULT_CONF,
    DEFAULT_FRAME_INTERVAL,
    THUMBNAIL_DIR,
    THUMBNAIL_WIDTH,
)
from app.core.detector import FireSmokeDetector
from app.core.history_manager import HistoryManager
from app.core.alert_tracker import AlertTracker

router = APIRouter(prefix="/api/detect", tags=["检测"])

# 全局视频处理状态锁标记，防止并发上传推理导致 CPU 跑满假死
is_video_processing = False



def _static_url(abs_path: str) -> str:
    """将绝对路径转换为以 /api/static/ 开头的相对 URL"""
    p = Path(abs_path)
    # 取 static/ 之后的部分
    parts = p.parts
    try:
        idx = parts.index("static")
        relative = "/".join(parts[idx + 1 :])
        return f"/api/static/{relative}"
    except ValueError:
        return abs_path


def _process_video_sync(
    video_input_path: Path,
    output_path: Path,
    conf: float,
    frame_interval: int,
    uid: str,
    fps: float,
    width: int,
    height: int,
    total_frames: int,
) -> dict:
    """在后台线程中同步执行视频解码、逐帧 YOLO 推理、转码和归档"""
    cap = cv2.VideoCapture(str(video_input_path))
    if not cap.isOpened():
        raise ValueError("无法打开视频文件")

    # 输出视频临时写入
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))

    detector = FireSmokeDetector()
    tracker = AlertTracker()
    
    all_detections: list[dict] = []
    key_frames: list[dict] = []
    frame_idx = 0
    processed_count = 0
    total_inference_ms = 0.0

    saved_suspected_targets = set()
    saved_confirmed_targets = set()

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % frame_interval == 0:
                res = detector.detect_frame_with_tracker(frame, conf=conf, tracker=tracker)
                annotated = res["annotated_image"]
                detections = res["detections"]
                total_inference_ms += res["inference_time_ms"]
                processed_count += 1

                if detections:
                    all_detections.extend(detections)

                should_save_kf = False
                for target in tracker.targets.values():
                    status = target.evaluate_status(conf)
                    if status == "suspected" and target.id not in saved_suspected_targets:
                        saved_suspected_targets.add(target.id)
                        should_save_kf = True
                    elif status == "confirmed" and target.id not in saved_confirmed_targets:
                        saved_confirmed_targets.add(target.id)
                        should_save_kf = True

                if should_save_kf and len(key_frames) < 10:
                    kf_name = f"keyframe_{uid}_{frame_idx}.jpg"
                    kf_path = RESULTS_DIR / kf_name
                    cv2.imwrite(str(kf_path), annotated)
                    
                    key_frames.append({
                        "frame_index": frame_idx,
                        "image_url": _static_url(str(kf_path)),
                        "detections": detections
                    })

                writer.write(annotated)
            else:
                writer.write(frame)

            frame_idx += 1
    finally:
        cap.release()
        writer.release()

    # 视频保存完成后，使用 ffmpeg 将其转码为标准的 H.264 MP4 格式，确保主流浏览器直接播放
    temp_output_path = VIDEO_DIR / f"temp_output_{uid}.mp4"
    if output_path.exists():
        try:
            output_path.rename(temp_output_path)
            transcode_success = False
            try:
                import subprocess
                cmd = [
                    "ffmpeg", "-y",
                    "-i", str(temp_output_path),
                    "-vcodec", "libx264",
                    "-pix_fmt", "yuv420p",
                    "-profile:v", "baseline",
                    "-level", "3.0",
                    str(output_path)
                ]
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45, check=True)
                transcode_success = True
            except Exception as e:
                print(f"[detect_video] ffmpeg H264 transcode failed, falling back: {e}")
                
            if not transcode_success:
                if temp_output_path.exists():
                    temp_output_path.rename(output_path)
            else:
                if temp_output_path.exists():
                    temp_output_path.unlink()
        except Exception as outer_e:
            print(f"[detect_video] File operations failed: {outer_e}")
            if temp_output_path.exists() and not output_path.exists():
                temp_output_path.rename(output_path)

    # 视频处理完后，写一条历史记录
    timestamp = datetime.now(timezone.utc).isoformat()
    hm = HistoryManager()
    
    video_url = _static_url(str(output_path))
    thumb_url = key_frames[0]["image_url"] if key_frames else ""
    core_images = [kf["image_url"] for kf in key_frames]
    
    hm.add_record(
        record_id=uid,
        record_type="video",
        original_path=_static_url(str(video_input_path)),
        annotated_path=video_url,
        thumbnail_path=thumb_url,
        detections=all_detections,
        timestamp=timestamp,
        alert_type="video_run",
        alert_level="confirmed" if any(d.get("alert_level") == "confirmed" for d in all_detections) else "suspected",
        images=core_images,
        duration_sec=round(total_frames / fps, 1)
    )

    return {
        "video_url": video_url,
        "total_frames": total_frames,
        "processed_frames": processed_count,
        "total_detections": len(all_detections),
        "key_frames": key_frames,
        "total_inference_time_ms": round(total_inference_ms, 2),
        "timestamp": timestamp,
    }


# ================================================================== #
# POST /api/detect/image
# ================================================================== #
@router.post("/image")
async def detect_image(
    file: UploadFile = File(...),
    conf: float = Query(DEFAULT_CONF, ge=0.01, le=1.0),
    save_history: bool = Query(True),
):
    """上传一张图片进行火烟检测"""
    # 验证文件类型
    allowed_ext = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tiff"}
    ext = Path(file.filename or "upload.jpg").suffix.lower()
    if ext not in allowed_ext:
        raise HTTPException(status_code=400, detail=f"不支持的图片格式: {ext}")

    # 保存上传文件
    uid = uuid.uuid4().hex[:12]
    original_filename = f"orig_{uid}{ext}"
    original_path = UPLOAD_DIR / original_filename
    with open(original_path, "wb") as f:
        content = await file.read()
        f.write(content)

    # 推理 (使用 to_thread 避免事件循环阻塞)
    try:
        import asyncio
        detector = FireSmokeDetector()
        result = await asyncio.to_thread(detector.detect, str(original_path), conf=conf)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"检测失败: {str(e)}")

    timestamp = datetime.now(timezone.utc).isoformat()
    history_id = uid

    # 构建 URL
    original_url = _static_url(str(original_path))
    annotated_url = _static_url(result["annotated_path"])
    thumbnail_url = _static_url(result["thumbnail_path"])

    # 写历史
    if save_history:
        hm = HistoryManager()
        hm.add_record(
            record_id=history_id,
            record_type="image",
            original_path=original_url,
            annotated_path=annotated_url,
            thumbnail_path=thumbnail_url,
            detections=result["detections"],
            timestamp=timestamp,
            original_images=[original_url],
            images=[annotated_url],
        )

    return {
        "success": True,
        "history_id": history_id if save_history else None,
        "detections": result["detections"],
        "detection_count": len(result["detections"]),
        "annotated_image": annotated_url,
        "original_image": original_url,
        "thumbnail": thumbnail_url,
        "inference_time_ms": result["inference_time_ms"],
        "timestamp": timestamp,
    }


# ================================================================== #
# POST /api/detect/video
# ================================================================== #
@router.post("/video")
async def detect_video(
    file: UploadFile = File(...),
    conf: float = Query(DEFAULT_CONF, ge=0.01, le=1.0),
    frame_interval: int = Query(DEFAULT_FRAME_INTERVAL, ge=1, le=300),
):
    """上传视频文件进行逐帧检测与状态跟踪 (不截取视频分片)"""
    global is_video_processing
    if is_video_processing:
        raise HTTPException(
            status_code=429,
            detail="当前已有视频检测任务正在后台运行，为防止硬件资源耗尽，请稍候再试。"
        )

    allowed_ext = {".mp4", ".avi", ".mov", ".mkv", ".wmv", ".flv"}
    ext = Path(file.filename or "upload.mp4").suffix.lower()
    if ext not in allowed_ext:
        raise HTTPException(status_code=400, detail=f"不支持的视频格式: {ext}")

    # 保存上传视频
    uid = uuid.uuid4().hex[:12]
    video_input_path = VIDEO_DIR / f"input_{uid}{ext}"
    with open(video_input_path, "wb") as f:
        content = await file.read()
        f.write(content)

    cap = cv2.VideoCapture(str(video_input_path))
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="无法打开视频文件")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()

    output_path = VIDEO_DIR / f"output_{uid}.mp4"

    # 设置处理锁
    is_video_processing = True

    try:
        import asyncio
        # 使用 to_thread 在独立的线程池中执行长时间的视频检测与转码，防范事件循环挂起
        res = await asyncio.to_thread(
            _process_video_sync,
            video_input_path,
            output_path,
            conf,
            frame_interval,
            uid,
            fps,
            width,
            height,
            total_frames,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"视频分析失败: {str(e)}")
    finally:
        # 无论成功或报错，都必须释放全局视频处理状态锁
        is_video_processing = False

    return {
        "success": True,
        "history_id": uid,
        "video_url": res["video_url"],
        "total_frames": res["total_frames"],
        "processed_frames": res["processed_frames"],
        "frame_interval": frame_interval,
        "total_detections": res["total_detections"],
        "key_frames": res["key_frames"],
        "total_inference_time_ms": res["total_inference_time_ms"],
        "timestamp": res["timestamp"],
    }

