"""
林焰智巡 - 摄像头实时检测 API
常驻后台取流线程 + MJPEG 流 + 单帧抓拍 + 智能告警事件流 (SSE)
"""

import uuid
import time
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Tuple

import cv2
import numpy as np
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse

from app.config import (
    DEFAULT_CONF,
    UPLOAD_DIR,
    RESULTS_DIR,
    THUMBNAIL_DIR,
    THUMBNAIL_WIDTH,
    VIDEO_DIR,
    DATA_DIR,
)
from app.core.detector import FireSmokeDetector
from app.core.history_manager import HistoryManager
from app.core.alert_tracker import AlertTracker

router = APIRouter(prefix="/api/camera", tags=["摄像头"])

# 全局摄像头事件推送队列 (存储触发的历史记录对象)
camera_events_queue: List[Dict] = []

# 全局相机实时集成设置保存路径
SETTINGS_FILE = DATA_DIR / "camera_settings.json"

# 默认设置
camera_settings = {
    "routine_interval": 300.0,       # 默认每5分钟，-1代表关闭
    "fire_video_enabled": True,      # 默认开启火焰自动视频截取
    "smoke_burst_enabled": True,     # 默认开启烟雾智能三连拍
    "pre_connect_enabled": True,     # 默认开启启动自动预载连接
}

# 比赛演示优先低延迟：摄像头线程持续拿最新帧，但模型不再每帧都跑。
DETECT_INTERVAL_SEC = 0.30
CAMERA_GRAB_DRAIN_FRAMES = 2


def load_settings():
    """从磁盘加载设置"""
    global camera_settings
    try:
        if SETTINGS_FILE.exists():
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                camera_settings.update(data)
                print(f"[Camera Settings] Loaded settings from disk: {camera_settings}")
    except Exception as e:
        print(f"[Camera Settings] Failed to load settings: {e}")


def save_settings():
    """保存设置到磁盘"""
    try:
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(camera_settings, f, indent=4, ensure_ascii=False)
            print(f"[Camera Settings] Saved settings to disk: {camera_settings}")
    except Exception as e:
        print(f"[Camera Settings] Failed to save settings: {e}")


# 初始化加载
load_settings()


def _static_url(abs_path: str) -> str:
    p = Path(abs_path)
    parts = p.parts
    try:
        idx = parts.index("static")
        relative = "/".join(parts[idx + 1 :])
        return f"/api/static/{relative}"
    except ValueError:
        return abs_path


# ================================================================== #
# 告警与例行巡检图片/视频文件异步保存辅助函数
# ================================================================== #

def save_video_clip(clip_id, frames_to_save, target_fps, width, height, detections, timestamp, camera_id="downward"):
    try:
        clip_name = f"clip_{clip_id}.mp4"
        clip_path = VIDEO_DIR / clip_name
        
        # 写入一个临时视频文件，使用兼容性极好的 mp4v 编码
        temp_clip_path = VIDEO_DIR / f"temp_{clip_name}"
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(temp_clip_path), fourcc, target_fps, (width, height))
        for f in frames_to_save:
            writer.write(f)
        writer.release()
        
        # 自动调用 ffmpeg 转码为 H.264 编码，实现浏览器 html5 video 完美原生播放
        transcode_success = False
        try:
            import subprocess
            cmd = [
                "ffmpeg", "-y",
                "-i", str(temp_clip_path),
                "-vcodec", "libx264",
                "-pix_fmt", "yuv420p",
                "-profile:v", "baseline",
                "-level", "3.0",
                str(clip_path)
            ]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=True)
            transcode_success = True
        except Exception as e:
            print(f"[save_video_clip] ffmpeg H264 transcode failed, falling back: {e}")
        
        # 处理临时视频文件
        if not transcode_success:
            if temp_clip_path.exists():
                if clip_path.exists():
                    clip_path.unlink()
                temp_clip_path.rename(clip_path)
        else:
            if temp_clip_path.exists():
                temp_clip_path.unlink()
        
        # 截取 3 张核心标识帧
        num_frames = len(frames_to_save)
        idxs = [int(num_frames * 0.15), int(num_frames * 0.50), int(num_frames * 0.85)]
        idxs = [max(0, min(idx, num_frames - 1)) for idx in idxs]
        
        relative_images = []
        for i, idx in enumerate(idxs):
            kf_img = frames_to_save[idx]
            kf_name = f"det_{clip_id}_{i}.jpg"
            kf_path = RESULTS_DIR / kf_name
            cv2.imwrite(str(kf_path), kf_img)
            relative_images.append(_static_url(str(kf_path)))
        
        # 生成历史缩略图 (采用中间确认帧)
        key_frame = frames_to_save[idxs[1]]
        thumb_name = f"thumb_{clip_id}.jpg"
        thumb_path = THUMBNAIL_DIR / thumb_name
        h, w = key_frame.shape[:2]
        ratio = THUMBNAIL_WIDTH / w
        new_h = int(h * ratio)
        thumb = cv2.resize(key_frame, (THUMBNAIL_WIDTH, new_h), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(thumb_path), thumb)
        
        # 持久化进 history.json 数据库
        hm = HistoryManager()
        relative_video = _static_url(str(clip_path))
        relative_thumb = _static_url(str(thumb_path))
        
        record = hm.add_record(
            record_id=clip_id,
            record_type="camera",
            original_path=relative_video,
            annotated_path=relative_images[1],
            thumbnail_path=relative_thumb,
            detections=detections,
            timestamp=timestamp,
            alert_type="fire_segment",
            alert_level="confirmed",
            video_clip=relative_video,
            images=relative_images,
            duration_sec=round(len(frames_to_save) / target_fps, 1),
            camera_id=camera_id
        )
        
        # 将事件放入全局事件流推送队列
        camera_events_queue.append({
            "id": clip_id,
            "type": "fire_segment",
            "timestamp": timestamp,
            "record": record,
            "camera_id": camera_id
        })
    except Exception as e:
        print(f"[save_video_clip] Error: {str(e)}")


def save_smoke_burst(burst_id, raw_images_to_save, annotated_images_to_save, detections, timestamp, camera_id="downward"):
    try:
        # 首图作为缩略图
        first_img = raw_images_to_save[0]
        thumb_name = f"thumb_{burst_id}.jpg"
        thumb_path = THUMBNAIL_DIR / thumb_name
        h, w = first_img.shape[:2]
        ratio = THUMBNAIL_WIDTH / w
        new_h = int(h * ratio)
        thumb = cv2.resize(first_img, (THUMBNAIL_WIDTH, new_h), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(thumb_path), thumb)
        
        # 保存爆发期的原始图
        relative_raw_images = []
        for idx, img in enumerate(raw_images_to_save):
            img_name = f"orig_{burst_id}_{idx}.jpg"
            img_path = UPLOAD_DIR / img_name
            cv2.imwrite(str(img_path), img)
            relative_raw_images.append(_static_url(str(img_path)))

        # 保存爆发期的标注图
        relative_annotated_images = []
        for idx, img in enumerate(annotated_images_to_save):
            img_name = f"det_{burst_id}_{idx}.jpg"
            img_path = RESULTS_DIR / img_name
            cv2.imwrite(str(img_path), img)
            relative_annotated_images.append(_static_url(str(img_path)))
            
        # 持久化归档历史
        hm = HistoryManager()
        relative_thumb = _static_url(str(thumb_path))
        
        record = hm.add_record(
            record_id=burst_id,
            record_type="camera",
            original_path=relative_raw_images[0],
            annotated_path=relative_annotated_images[0],
            thumbnail_path=relative_thumb,
            detections=detections,
            timestamp=timestamp,
            alert_type="smoke_burst",
            alert_level="confirmed",
            original_images=relative_raw_images,
            images=relative_annotated_images,
            camera_id=camera_id
        )
        
        # 推送至 SSE 事件管道
        camera_events_queue.append({
            "id": burst_id,
            "type": "smoke_burst",
            "timestamp": timestamp,
            "record": record,
            "camera_id": camera_id
        })
    except Exception as e:
        print(f"[save_smoke_burst] Error: {str(e)}")


def save_routine_capture(raw_img, annotated_img, detections, timestamp, camera_id="downward"):
    try:
        uid = uuid.uuid4().hex[:12]
        
        # 1. 存入原始底图
        orig_filename = f"routine_orig_{uid}.jpg"
        orig_path = UPLOAD_DIR / orig_filename
        cv2.imwrite(str(orig_path), raw_img)
        
        # 2. 存入标注结果图
        ann_filename = f"routine_det_{uid}.jpg"
        ann_path = RESULTS_DIR / ann_filename
        cv2.imwrite(str(ann_path), annotated_img)
        
        # 3. 存入缩略图
        thumb_name = f"routine_thumb_{uid}.jpg"
        thumb_path = THUMBNAIL_DIR / thumb_name
        h, w = raw_img.shape[:2]
        ratio = THUMBNAIL_WIDTH / w
        new_h = int(h * ratio)
        thumb = cv2.resize(raw_img, (THUMBNAIL_WIDTH, new_h), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(thumb_path), thumb)
        
        # 4. 持久化记录
        hm = HistoryManager()
        relative_orig = _static_url(str(orig_path))
        relative_ann = _static_url(str(ann_path))
        relative_thumb = _static_url(str(thumb_path))
        
        record = hm.add_record(
            record_id=uid,
            record_type="camera",
            original_path=relative_orig,
            annotated_path=relative_ann,
            thumbnail_path=relative_thumb,
            detections=detections,
            timestamp=timestamp,
            alert_type="routine",
            alert_level="confirmed" if detections else "normal",
            original_images=[relative_orig],
            images=[relative_ann],
            camera_id=camera_id
        )
        
        # 推送至事件队列
        camera_events_queue.append({
            "id": uid,
            "type": "routine",
            "timestamp": timestamp,
            "record": record,
            "camera_id": camera_id
        })
        print(f"[Routine Capture] Captured and archived routine check image {uid} successfully.")
    except Exception as e:
        print(f"[save_routine_capture] Error: {str(e)}")


def save_demo_capture(raw_img, annotated_img, detections, timestamp, camera_id="downward"):
    try:
        with camera_manager.demo_lock:
            # 已经采集满 20 张后，直接返回
            if camera_manager.demo_captured_count >= 20:
                return
                
            # 第一张截图时启动计时
            if camera_manager.demo_start_time is None:
                camera_manager.demo_start_time = time.time()
                
            uid = uuid.uuid4().hex[:12]
            
            # 保存图片文件
            orig_filename = f"demo_orig_{uid}.jpg"
            orig_path = UPLOAD_DIR / orig_filename
            cv2.imwrite(str(orig_path), raw_img)
            
            ann_filename = f"demo_det_{uid}.jpg"
            ann_path = RESULTS_DIR / ann_filename
            cv2.imwrite(str(ann_path), annotated_img)
            
            thumb_name = f"demo_thumb_{uid}.jpg"
            thumb_path = THUMBNAIL_DIR / thumb_name
            h, w = raw_img.shape[:2]
            ratio = THUMBNAIL_WIDTH / w
            new_h = int(h * ratio)
            thumb = cv2.resize(raw_img, (THUMBNAIL_WIDTH, new_h), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(thumb_path), thumb)
            
            # 持久化记录
            hm = HistoryManager()
            relative_orig = _static_url(str(orig_path))
            relative_ann = _static_url(str(ann_path))
            relative_thumb = _static_url(str(thumb_path))
            
            record = hm.add_record(
                record_id=uid,
                record_type="camera",
                original_path=relative_orig,
                annotated_path=relative_ann,
                thumbnail_path=relative_thumb,
                detections=detections,
                timestamp=timestamp,
                alert_type="demo",
                alert_level="confirmed" if detections else "normal",
                images=[relative_ann],
                camera_id=camera_id
            )
            
            # 递增计数
            camera_manager.demo_captured_count += 1
            
            # 满 20 张后停止计时
            if camera_manager.demo_captured_count >= 20:
                camera_manager.demo_end_time = time.time()
                
            # 推送至事件队列
            camera_events_queue.append({
                "id": uid,
                "type": "demo",
                "timestamp": timestamp,
                "record": record,
                "camera_id": camera_id
            })
            print(f"[Demo Mode] Captured demo image {camera_manager.demo_captured_count}/20 successfully: {uid}")
            return record
    except Exception as e:
        print(f"[save_demo_capture] Error: {str(e)}")
    return None


# ================================================================== #
# CameraManager - 常驻后台的单例摄像头采集、推理与智能跟踪引擎
# ================================================================== #

class CameraSession:
    """独立的摄像头会话生命周期与取流线程"""
    def __init__(self, camera_id: str, default_index: int):
        self.camera_id = camera_id
        self.default_index = default_index
        
        self.cap: Optional[cv2.VideoCapture] = None
        self.running: bool = False
        self.thread: Optional[threading.Thread] = None
        
        # 内存缓冲数据锁
        self.lock = threading.Lock()
        self.latest_raw_frame: Optional[np.ndarray] = None
        self.latest_annotated_frame: Optional[np.ndarray] = None
        self.latest_jpeg: Optional[bytes] = None
        
        # 硬件参数
        self.available: bool = False
        self.width: int = 640
        self.height: int = 480
        self.fps: float = 20.0
        self.detect_enabled: bool = False
        self.tracker: Optional[AlertTracker] = None

    def start(self):
        with self.lock:
            if self.running:
                print(f"[CameraSession-{self.camera_id}] Already running.")
                return
            self.running = True
            self.thread = threading.Thread(
                target=self._run_loop,
                name=f"CamWorker-{self.camera_id}",
                daemon=True
            )
            self.thread.start()
            print(f"[CameraSession-{self.camera_id}] Background thread started.")

    def stop(self):
        print(f"[CameraSession-{self.camera_id}] Stopping background worker thread...")
        with self.lock:
            self.running = False
        
        if self.cap:
            try:
                self.cap.release()
            except Exception as e:
                print(f"[CameraSession-{self.camera_id}] Error releasing cap: {e}")
            self.cap = None

        if self.thread:
            self.thread.join(timeout=2.0)
            self.thread = None
        self.available = False
        print(f"[CameraSession-{self.camera_id}] Thread exited and device released.")

    def _run_loop(self):
        # 搜寻视频通道，优先适配自定 default_index，排除其它会话占用的通道，防范抢占冲突
        cap = None
        chosen_idx = -1
        search_list = [self.default_index] + [i for i in [1, 0, 2] if i != self.default_index]
        
        # 获取被其它会话占用的索引列表
        occupied = camera_manager.get_occupied_indices(exclude_id=self.camera_id)
        
        for idx in search_list:
            if idx in occupied:
                continue
            try:
                cap_test = cv2.VideoCapture(idx)
                if cap_test.isOpened():
                    ret, frame = cap_test.read()
                    if ret and frame is not None:
                        cap = cap_test
                        chosen_idx = idx
                        self.width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
                        self.height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480
                        self.fps = cap.get(cv2.CAP_PROP_FPS) or 20.0
                        self.available = True
                        break
                    cap_test.release()
            except Exception:
                pass
                
        # 兼容性兜底
        if not cap or not cap.isOpened():
            for idx in [0, 1, 2]:
                if idx in occupied or idx == chosen_idx:
                    continue
                try:
                    cap_test = cv2.VideoCapture(idx)
                    if cap_test.isOpened():
                        ret, frame = cap_test.read()
                        if ret and frame is not None:
                            cap = cap_test
                            chosen_idx = idx
                            self.width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
                            self.height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480
                            self.fps = cap.get(cv2.CAP_PROP_FPS) or 20.0
                            self.available = True
                            break
                        cap_test.release()
                except Exception:
                    pass

        if not cap or not cap.isOpened():
            self.available = False
            self.running = False
            print(f"[CameraSession-{self.camera_id}] Critical: Failed to bind to any camera device.")
            return
            
        # 登记占用
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        camera_manager.set_index_occupied(self.camera_id, chosen_idx)
        self.cap = cap
        self.tracker = AlertTracker()
        
        frame_buffer: List[Tuple[float, np.ndarray, np.ndarray]] = []
        recording_sessions: Dict[str, Dict] = {}
        smoke_burst_tasks: List[Dict] = []
        last_routine_capture_time = time.time()
        last_detection_time = 0.0
        last_detections: List[Dict] = []
        max_buffer_size = int(10 * self.fps)
        
        print(f"[CameraSession-{self.camera_id}] Connected to physical device index {chosen_idx} resolution {self.width}x{self.height} @ {self.fps} FPS.")
        
        try:
            while True:
                with self.lock:
                    if not self.running:
                        break
                        
                start_time = time.time()
                for _ in range(CAMERA_GRAB_DRAIN_FRAMES):
                    self.cap.grab()
                ret, frame = self.cap.retrieve()
                if not ret or frame is None:
                    ret, frame = self.cap.read()
                if not ret or frame is None:
                    time.sleep(0.01)
                    continue
                    
                curr_time = time.time()
                
                # 实时演示低延迟策略：只按间隔跑模型，其余帧复用上一次检测框画到最新画面。
                should_detect = (
                    self.detect_enabled
                    and camera_manager.detector
                    and (curr_time - last_detection_time >= DETECT_INTERVAL_SEC)
                )
                if should_detect:
                    res = camera_manager.detector.detect_frame_with_tracker(frame, conf=camera_manager.conf, tracker=self.tracker)
                    annotated = res["annotated_image"]
                    detections = res["detections"]
                    last_detections = detections
                    last_detection_time = curr_time
                elif self.detect_enabled and last_detections:
                    detections = last_detections
                    annotated = camera_manager.detector.draw_custom_annotations(frame, detections)
                else:
                    annotated = frame.copy()
                    detections = []
                    
                if camera_manager.demo_mode:
                    if len(detections) > 0 and camera_manager.demo_captured_count < 20:
                        camera_manager.demo_stable_counter += 1
                        if camera_manager.demo_stable_counter >= 8:
                            if curr_time - camera_manager.demo_last_capture_time >= 3.5:
                                camera_manager.demo_last_capture_time = curr_time
                                camera_manager.demo_stable_counter = 0
                                t = threading.Thread(
                                    target=save_demo_capture,
                                    args=(
                                        frame.copy(),
                                        annotated.copy(),
                                        detections,
                                        datetime.now(timezone.utc).isoformat(),
                                        self.camera_id
                                    ),
                                    daemon=True
                                )
                                t.start()
                    else:
                        camera_manager.demo_stable_counter = 0
                    
                _, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
                jpeg_bytes = buf.tobytes()
                
                with self.lock:
                    self.latest_raw_frame = frame.copy()
                    self.latest_annotated_frame = annotated.copy()
                    self.latest_jpeg = jpeg_bytes
                    
                frame_buffer.append((curr_time, frame.copy(), annotated.copy()))
                if len(frame_buffer) > max_buffer_size:
                    frame_buffer.pop(0)
                    
                # 持续判定智能跟踪警报
                is_demo_context = camera_manager.demo_mode or (time.time() - getattr(camera_manager, "last_demo_page_poll", 0.0) < 6.0)
                events = self.tracker.get_events(curr_time)
                for ev in events:
                    if ev["type"] == "smoke_burst":
                        if is_demo_context or len(recording_sessions) > 0 or not camera_settings.get("smoke_burst_enabled", True):
                            continue
                        smoke_burst_tasks.append({
                            "id": uuid.uuid4().hex[:12],
                            "target_id": ev["target_id"],
                            "count": 0,
                            "next_capture_time": curr_time,
                            "raw_images": [],
                            "annotated_images": [],
                            "detections": detections
                        })
                    elif ev["type"] == "fire_confirm":
                        if is_demo_context or not camera_settings.get("fire_video_enabled", True):
                            continue
                        
                        sus_start = ev["suspected_start_time"]
                        sus_frames = [f[2] for f in frame_buffer if f[0] >= sus_start - 0.5]
                        target_id = ev["target_id"]
                        recording_sessions[target_id] = {
                            "id": uuid.uuid4().hex[:12],
                            "frames": list(sus_frames),
                            "confirmed_time": ev["confirmed_time"],
                            "end_time": curr_time + 2.0,
                            "detections": detections,
                            "status": "recording"
                        }
                        
                # 处理活跃火焰视频写入线程
                for t_id, session in list(recording_sessions.items()):
                    if session["status"] == "recording":
                        session["frames"].append(annotated.copy())
                        if curr_time >= session["end_time"]:
                            session["status"] = "finished"
                            t = threading.Thread(
                                target=save_video_clip,
                                args=(
                                    session["id"],
                                    list(session["frames"]),
                                    int(self.fps),
                                    self.width,
                                    self.height,
                                    session["detections"],
                                    datetime.now(timezone.utc).isoformat(),
                                    self.camera_id
                                ),
                                daemon=True
                            )
                            t.start()
                            del recording_sessions[t_id]
                            
                # 处理活跃烟雾三连拍触发线程
                for task in list(smoke_burst_tasks):
                    if curr_time >= task["next_capture_time"] and task["count"] < 3:
                        task["raw_images"].append(frame.copy())
                        task["annotated_images"].append(annotated.copy())
                        task["count"] += 1
                        task["next_capture_time"] = curr_time + 1.0
                        
                        if task["count"] == 3:
                            t = threading.Thread(
                                target=save_smoke_burst,
                                args=(
                                    task["id"],
                                    list(task["raw_images"]),
                                    list(task["annotated_images"]),
                                    task["detections"],
                                    datetime.now(timezone.utc).isoformat(),
                                    self.camera_id
                                ),
                                daemon=True
                            )
                            t.start()
                            smoke_burst_tasks.remove(task)
                            
                # 例行巡检抓拍
                routine_int = camera_settings.get("routine_interval", 300.0)
                if not is_demo_context and self.detect_enabled and routine_int > 0 and curr_time - last_routine_capture_time >= routine_int:
                    last_routine_capture_time = curr_time
                    t = threading.Thread(
                        target=save_routine_capture,
                        args=(
                            frame.copy(),
                            annotated.copy(),
                            detections,
                            datetime.now(timezone.utc).isoformat(),
                            self.camera_id
                        ),
                        daemon=True
                    )
                    t.start()
                    
                elapsed = time.time() - start_time
                delay = max(0.001, (1.0 / self.fps) - elapsed)
                time.sleep(delay)
                
        finally:
            if self.cap:
                self.cap.release()
                self.cap = None
            self.available = False
            self.running = False
            camera_manager.free_index(self.camera_id)
            
            # 退出时将已缓存帧刷回磁盘
            try:
                for t_id, session in list(recording_sessions.items()):
                    if len(session.get("frames", [])) > 0:
                        save_video_clip(
                            session["id"],
                            list(session["frames"]),
                            int(self.fps),
                            self.width,
                            self.height,
                            session["detections"],
                            datetime.now(timezone.utc).isoformat(),
                            self.camera_id
                        )
                for task in list(smoke_burst_tasks):
                    if len(task.get("raw_images", [])) > 0:
                        save_smoke_burst(
                            task["id"],
                            list(task["raw_images"]),
                            list(task["annotated_images"]),
                            task["detections"],
                            datetime.now(timezone.utc).isoformat(),
                            self.camera_id
                        )
            except Exception as e:
                print(f"[CameraSession-{self.camera_id}] Cleanup save error: {e}")
                
            print(f"[CameraSession-{self.camera_id}] Run loop stopped and cleaned.")


class CameraManager:
    """全局多摄像头管理与单路代理转发器"""
    def __init__(self):
        self.sessions = {
            "downward": CameraSession("downward", default_index=1),
            "forward": CameraSession("forward", default_index=0)
        }
        self.detector = FireSmokeDetector()
        self.conf = DEFAULT_CONF
        self.occupied_ports = {}
        self.occupied_lock = threading.Lock()
        
        # 演示模式状态
        self.demo_mode = False
        self.demo_start_time = None
        self.demo_end_time = None
        self.demo_captured_count = 0
        self.demo_last_capture_time = 0.0
        self.demo_stable_counter = 0
        self.last_demo_page_poll = 0.0
        self.demo_lock = threading.Lock()

    def get_session(self, camera_id: str) -> CameraSession:
        if camera_id not in self.sessions:
            raise HTTPException(status_code=400, detail=f"不支持的摄像头 ID: {camera_id}")
        return self.sessions[camera_id]

    def get_occupied_indices(self, exclude_id: str) -> set[int]:
        with self.occupied_lock:
            return {idx for cid, idx in self.occupied_ports.items() if cid != exclude_id}

    def set_index_occupied(self, camera_id: str, idx: int):
        with self.occupied_lock:
            self.occupied_ports[camera_id] = idx

    def free_index(self, camera_id: str):
        with self.occupied_lock:
            if camera_id in self.occupied_ports:
                del self.occupied_ports[camera_id]

    def start(self, camera_id: str = "downward"):
        self.get_session(camera_id).start()

    def stop(self, camera_id: Optional[str] = None):
        """退出时彻底清空并关闭所有摄像头会话，或者指定关闭某一会话"""
        if camera_id is not None:
            self.get_session(camera_id).stop()
        else:
            for s in self.sessions.values():
                s.stop()

    # 向前兼容代理属性 (默认读写向下俯视 downward 相机)
    @property
    def cap(self):
        return self.sessions["downward"].cap
    @cap.setter
    def cap(self, val):
        self.sessions["downward"].cap = val

    @property
    def running(self):
        return self.sessions["downward"].running
    @running.setter
    def running(self, val):
        self.sessions["downward"].running = val

    @property
    def thread(self):
        return self.sessions["downward"].thread
    @thread.setter
    def thread(self, val):
        self.sessions["downward"].thread = val

    @property
    def lock(self):
        return self.sessions["downward"].lock

    @property
    def latest_raw_frame(self):
        return self.sessions["downward"].latest_raw_frame
    @latest_raw_frame.setter
    def latest_raw_frame(self, val):
        self.sessions["downward"].latest_raw_frame = val

    @property
    def latest_annotated_frame(self):
        return self.sessions["downward"].latest_annotated_frame
    @latest_annotated_frame.setter
    def latest_annotated_frame(self, val):
        self.sessions["downward"].latest_annotated_frame = val

    @property
    def latest_jpeg(self):
        return self.sessions["downward"].latest_jpeg
    @latest_jpeg.setter
    def latest_jpeg(self, val):
        self.sessions["downward"].latest_jpeg = val

    @property
    def available(self):
        return self.sessions["downward"].available
    @available.setter
    def available(self, val):
        self.sessions["downward"].available = val

    @property
    def width(self):
        return self.sessions["downward"].width
    @width.setter
    def width(self, val):
        self.sessions["downward"].width = val

    @property
    def height(self):
        return self.sessions["downward"].height
    @height.setter
    def height(self, val):
        self.sessions["downward"].height = val

    @property
    def fps(self):
        return self.sessions["downward"].fps
    @fps.setter
    def fps(self, val):
        self.sessions["downward"].fps = val

    @property
    def tracker(self):
        return self.sessions["downward"].tracker
    @tracker.setter
    def tracker(self, val):
        self.sessions["downward"].tracker = val

    @property
    def detect_enabled(self):
        return self.sessions["downward"].detect_enabled
    @detect_enabled.setter
    def detect_enabled(self, val):
        self.sessions["downward"].detect_enabled = val


# 实例化唯一的全局摄像头管理器
camera_manager = CameraManager()


# ================================================================== #
# 路由接口层实现
# ================================================================== #


@router.get("/stream")
async def camera_stream(
    camera_id: str = Query("downward", description="摄像头标识 (downward/forward)"),
    conf: float = Query(DEFAULT_CONF, ge=0.01, le=1.0),
):
    """返回常驻 MJPEG 视频推理流，允许多个前端页面或刷新操作瞬间秒连且不影响硬件运作"""
    if not isinstance(camera_id, str):
        camera_id = "downward"
        
    camera_manager.conf = conf
    session = camera_manager.get_session(camera_id)
    if not session.running:
        session.start()

    async def generate():
        fps = session.fps or 20.0
        sleep_time = 1.0 / fps
        
        while True:
            # 持续从常驻后台线程的内存缓存中拉取最新帧字节，不做任何重复取硬件操作
            jpeg_bytes = session.latest_jpeg
            if jpeg_bytes is None:
                # 硬件尚未就绪，返回黑屏提示帧
                blank = np.zeros((480, 640, 3), dtype=np.uint8)
                cv2.putText(
                    blank,
                    f"Camera {camera_id} Connecting...",
                    (120, 240),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (0, 165, 255),
                    2,
                )
                _, buf = cv2.imencode(".jpg", blank)
                jpeg_bytes = buf.tobytes()
                
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + jpeg_bytes + b"\r\n"
            )
            import asyncio
            await asyncio.sleep(sleep_time)

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/capture")
async def camera_capture(
    camera_id: str = Query("downward", description="摄像头标识 (downward/forward)"),
    conf: float = Query(DEFAULT_CONF, ge=0.01, le=1.0),
):
    """从常驻摄像头流缓存中手动抓取一帧图像执行就地推理，无需启停硬件"""
    if not isinstance(camera_id, str):
        camera_id = "downward"
        
    session = camera_manager.get_session(camera_id)
    if not session.available or session.latest_raw_frame is None:
        return JSONResponse(
            status_code=503,
            content={"success": False, "detail": f"摄像头 {camera_id} 尚未就绪或不可用"},
        )

    # 零等待：瞬间捕获常驻线程里当前的原始视频帧
    with session.lock:
        frame = session.latest_raw_frame.copy()

    # 异步存入磁盘
    uid = uuid.uuid4().hex[:12]
    orig_filename = f"cam_orig_{uid}.jpg"
    orig_path = UPLOAD_DIR / orig_filename
    cv2.imwrite(str(orig_path), frame)

    # 触发 YOLO 推理与各尺度缩略图生成
    detector = FireSmokeDetector()
    result = detector.detect(frame, conf=conf)

    timestamp = datetime.now(timezone.utc).isoformat()
    original_url = _static_url(str(orig_path))
    annotated_url = _static_url(result["annotated_path"])
    thumbnail_url = _static_url(result["thumbnail_path"])

    # 归档入历史记录中
    hm = HistoryManager()
    record = hm.add_record(
        record_id=uid,
        record_type="camera",
        original_path=original_url,
        annotated_path=annotated_url,
        thumbnail_path=thumbnail_url,
        detections=result["detections"],
        timestamp=timestamp,
        alert_type="image",
        alert_level="confirmed" if result["detections"] else "normal",
        original_images=[original_url],
        images=[annotated_url],
        camera_id=camera_id
    )

    return {
        "success": True,
        "history_id": uid,
        "detections": result["detections"],
        "detection_count": len(result["detections"]),
        "annotated_image": annotated_url,
        "original_image": original_url,
        "thumbnail": thumbnail_url,
        "inference_time_ms": result["inference_time_ms"],
        "timestamp": timestamp,
        "record": record
    }


@router.get("/status")
async def camera_status(
    camera_id: str = Query("downward", description="摄像头标识 (downward/forward)"),
):
    """极速返回常驻线程的摄像头连接状态与物理分辨率，避免 300ms 摄像头硬件握手阻塞"""
    if not isinstance(camera_id, str):
        camera_id = "downward"
        
    session = camera_manager.get_session(camera_id)
    return {
        "available": session.available,
        "resolution": {
            "width": session.width,
            "height": session.height
        } if session.available else None,
    }


@router.post("/reconnect")
async def camera_reconnect(
    camera_id: str = Query("downward", description="摄像头标识 (downward/forward)"),
):
    """手动重启后台常驻摄像头工作线程，重新尝试建立与硬件 `/dev/video*` 的底层物理绑定"""
    import asyncio
    if not isinstance(camera_id, str):
        camera_id = "downward"
        
    print(f"[CameraManager] Received manual reconnect API trigger for {camera_id}. Force restarting hardware stream...")
    
    if camera_id == "downward":
        await asyncio.to_thread(camera_manager.stop)
        await asyncio.sleep(1.2)
        camera_manager.start()
    else:
        await asyncio.to_thread(camera_manager.stop, camera_id)
        await asyncio.sleep(1.2)
        camera_manager.start(camera_id)

    session = camera_manager.get_session(camera_id)
    # 延长侦测最大上限至 5 秒（50次轮询），保证大多数物理相机的重置完成
    for _ in range(50):
        if session.available:
            break
        await asyncio.sleep(0.1)

    return {
        "success": session.available,
        "available": session.available,
        "resolution": {
            "width": session.width,
            "height": session.height
        } if session.available else None,
    }


@router.get("/events")
async def camera_events():
    """实时告警事件推送 (Server-Sent Events) 通道"""
    async def event_generator():
        last_idx = len(camera_events_queue)
        while True:
            import asyncio
            await asyncio.sleep(0.5)
            if len(camera_events_queue) > last_idx:
                for ev in camera_events_queue[last_idx:]:
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                last_idx = len(camera_events_queue)
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/settings")
async def get_camera_settings():
    """获取摄像头与告警触发实时配置"""
    return {
        "success": True,
        "settings": camera_settings
    }


@router.post("/settings")
async def update_camera_settings(settings: dict):
    """更新摄像头与告警触发实时配置"""
    global camera_settings
    if "routine_interval" in settings:
        try:
            camera_settings["routine_interval"] = float(settings["routine_interval"])
        except ValueError:
            pass
    if "fire_video_enabled" in settings:
        camera_settings["fire_video_enabled"] = bool(settings["fire_video_enabled"])
    if "smoke_burst_enabled" in settings:
        camera_settings["smoke_burst_enabled"] = bool(settings["smoke_burst_enabled"])
    if "pre_connect_enabled" in settings:
        camera_settings["pre_connect_enabled"] = bool(settings["pre_connect_enabled"])
    
    save_settings()
    return {
        "success": True,
        "settings": camera_settings
    }


@router.post("/detect/enable")
async def camera_detect_enable(
    camera_id: str = Query("downward", description="摄像头标识 (downward/forward)"),
):
    """开启摄像头后台 YOLO 实时智能检测"""
    if not isinstance(camera_id, str):
        camera_id = "downward"
        
    if camera_id == "downward":
        camera_manager.detect_enabled = True
    else:
        session = camera_manager.get_session(camera_id)
        session.detect_enabled = True
        
    print(f"[CameraManager] YOLO real-time monitoring ENABLED for {camera_id}.")
    return {"success": True, "detect_enabled": True}


@router.post("/detect/disable")
async def camera_detect_disable(
    camera_id: str = Query("downward", description="摄像头标识 (downward/forward)"),
):
    """关闭摄像头后台 YOLO 实时智能检测，只保留单纯取流以节约 CPU"""
    if not isinstance(camera_id, str):
        camera_id = "downward"
        
    if camera_id == "downward":
        camera_manager.detect_enabled = False
        if camera_manager.tracker:
            camera_manager.tracker.targets.clear()
    else:
        session = camera_manager.get_session(camera_id)
        session.detect_enabled = False
        if session.tracker:
            session.tracker.targets.clear()
            
    print(f"[CameraManager] YOLO real-time monitoring DISABLED for {camera_id} (pure stream only).")
    return {"success": True, "detect_enabled": False}


@router.get("/list")
async def get_camera_list():
    """获取所有摄像头会话的当前状态与物理信息"""
    results = []
    for cid, s in camera_manager.sessions.items():
        results.append({
            "camera_id": cid,
            "available": s.available,
            "running": s.running,
            "detect_enabled": s.detect_enabled,
            "resolution": {
                "width": s.width,
                "height": s.height
            } if s.available else None,
            "fps": s.fps if s.available else None
        })
    return {"success": True, "cameras": results}


@router.post("/demo/start")
async def start_demo_mode():
    """启动演示模式"""
    camera_manager.demo_mode = True
    camera_manager.demo_start_time = None
    camera_manager.demo_end_time = None
    camera_manager.demo_captured_count = 0
    camera_manager.demo_stable_counter = 0
    
    # 自动开启向下俯视相机的实时检测推理
    session = camera_manager.get_session("downward")
    session.detect_enabled = True
    if not session.running:
        session.start()
        
    print("[Demo Mode] Started demo mode. Downward camera real-time monitoring enabled.")
    return {
        "success": True,
        "demo_mode": True,
        "message": "已开启实测演示模式，系统将自动抓图并进行计时"
    }


@router.post("/demo/stop")
async def stop_demo_mode():
    """关闭演示模式"""
    camera_manager.demo_mode = False
    print("[Demo Mode] Stopped demo mode.")
    return {
        "success": True,
        "demo_mode": False,
        "message": "已关闭实测演示模式"
    }


@router.post("/demo/capture")
async def demo_manual_capture(
    camera_id: str = Query("downward", description="摄像头标识 (downward/forward)"),
    conf: float = Query(DEFAULT_CONF, ge=0.01, le=1.0),
):
    """手动采集一张演示样本；无火/无烟也保存，并计入 20 张演示进度。"""
    if not isinstance(camera_id, str):
        camera_id = "downward"

    session = camera_manager.get_session(camera_id)
    if not session.available or session.latest_raw_frame is None:
        return JSONResponse(
            status_code=503,
            content={"success": False, "detail": f"摄像头 {camera_id} 尚未就绪或不可用"},
        )

    with session.lock:
        frame = session.latest_raw_frame.copy()

    detector = FireSmokeDetector()
    result = detector.detect_frame(frame, conf=conf)
    record = save_demo_capture(
        frame,
        result["annotated_image"],
        result["detections"],
        datetime.now(timezone.utc).isoformat(),
        camera_id,
    )
    if record is None:
        return JSONResponse(
            status_code=409,
            content={"success": False, "detail": "本轮演示已采满 20 张或截图保存失败"},
        )

    return {
        "success": True,
        "record": record,
        "detections": result["detections"],
        "detection_count": len(result["detections"]),
        "inference_time_ms": result["inference_time_ms"],
        "demo_captured_count": camera_manager.demo_captured_count,
        "demo_complete": camera_manager.demo_captured_count >= 20,
    }


@router.get("/demo/status")
async def get_demo_status():
    """获取当前实测演示状态"""
    camera_manager.last_demo_page_poll = time.time()
    elapsed = 0.0
    if camera_manager.demo_start_time is not None:
        if camera_manager.demo_end_time is not None:
            elapsed = camera_manager.demo_end_time - camera_manager.demo_start_time
        else:
            elapsed = time.time() - camera_manager.demo_start_time
            
    # 计算时效得分
    if elapsed <= 0.0:
        time_score = 15.0
    elif elapsed <= 180.0:
        time_score = 15.0
    else:
        time_score = max(0.0, 15.0 - (elapsed - 180.0) * 0.5)
        
    return {
        "success": True,
        "demo_mode": camera_manager.demo_mode,
        "demo_captured_count": camera_manager.demo_captured_count,
        "elapsed_time": round(elapsed, 1),
        "time_score": round(time_score, 2),
        "demo_complete": camera_manager.demo_captured_count >= 20
    }


@router.post("/demo/reset")
async def reset_demo_mode():
    """重置演示模式，并物理清空历史中 alert_type == 'demo' 的所有检测记录与评分状态"""
    camera_manager.demo_mode = False
    camera_manager.demo_start_time = None
    camera_manager.demo_end_time = None
    camera_manager.demo_captured_count = 0
    camera_manager.demo_stable_counter = 0
    
    # 清理所有 alert_type == 'demo' 的记录
    from app.api.history import delete_history_by_id
    hm = HistoryManager()
    records = list(hm.get_all())
    demo_count = 0
    for r in records:
        if r.get("alert_type") == "demo" or r.get("record_id", "").startswith("demo_"):
            try:
                # 级联删除历史记录、素材、评分
                await delete_history_by_id(r["id"])
                demo_count += 1
            except Exception as e:
                print(f"[Demo Reset] Failed to delete demo record {r['id']}: {e}")
                
    print(f"[Demo Mode] Reset completed. Cleared {demo_count} demo history records.")
    return {
        "success": True,
        "cleared_count": demo_count,
        "message": f"演示状态已成功重置，并物理清除了 {demo_count} 条实测演示截图及评分。"
    }
