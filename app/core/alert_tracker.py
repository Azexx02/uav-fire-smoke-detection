"""
林焰智巡 - 告警状态跟踪器
通过 IoU 进行多目标跟踪，并根据系统逻辑层判定“疑似火点”和进行智能告警记录触发
"""

import time
import uuid
import math
from typing import List, Dict, Tuple, Optional

def get_iou(boxA: List[float], boxB: List[float]) -> float:
    """计算两个边界框的交并比 (IoU)"""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])
    
    interArea = max(0.0, xB - xA) * max(0.0, yB - yA)
    boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
    unionArea = boxAArea + boxBArea - interArea
    
    if unionArea <= 0.0:
        return 0.0
    return interArea / unionArea

class TrackedTarget:
    """被跟踪的火焰/烟雾目标"""
    
    def __init__(self, target_id: str, cls: str, bbox: List[float], confidence: float, frame_size: Tuple[int, int]):
        self.id = target_id
        self.cls = cls  # 'fire' 或 'smoke'
        self.bbox = bbox  # [x1, y1, x2, y2]
        self.confidence = confidence
        self.frame_size = frame_size  # (width, height)
        
        self.first_seen = time.time()
        self.frames_seen = 1
        self.frames_missing = 0
        
        # 轨迹历史
        self.history_bboxes = [bbox]
        
        # 告警状态
        self.is_confirmed = False
        self.confirmed_time = None
        self.has_triggered_alert = False

    def update(self, bbox: List[float], confidence: float):
        """用当前帧的匹配检测更新目标状态"""
        self.bbox = bbox
        self.confidence = confidence
        self.frames_seen += 1
        self.frames_missing = 0
        self.history_bboxes.append(bbox)
        if len(self.history_bboxes) > 30:
            self.history_bboxes.pop(0)

    def mark_missing(self):
        """目标在当前帧丢失"""
        self.frames_missing += 1

    @property
    def area_ratio(self) -> float:
        """边界框占整个画面的面积比例"""
        w, h = self.frame_size
        if w <= 0 or h <= 0:
            return 0.0
        box_w = self.bbox[2] - self.bbox[0]
        box_h = self.bbox[3] - self.bbox[1]
        return (box_w * box_h) / (w * h)

    @property
    def centroid(self) -> Tuple[float, float]:
        """计算中心点坐标"""
        return (self.bbox[0] + self.bbox[2]) / 2.0, (self.bbox[1] + self.bbox[3]) / 2.0

    @property
    def position_stable(self) -> bool:
        """检查位置是否稳定（中心点偏移不超过画面尺寸的 10%）"""
        if len(self.history_bboxes) < 2:
            return True  # 刚出现算稳定
        
        w, h = self.frame_size
        curr_cx, curr_cy = self.centroid
        
        # 计算上一个边界框的中心点
        prev_box = self.history_bboxes[-2]
        prev_cx = (prev_box[0] + prev_box[2]) / 2.0
        prev_cy = (prev_box[1] + prev_box[3]) / 2.0
        
        dx = abs(curr_cx - prev_cx)
        dy = abs(curr_cy - prev_cy)
        
        # 偏离比例超过 10% 即为不稳定
        if dx / w > 0.1 or dy / h > 0.1:
            return False
        return True

    def evaluate_status(self, conf_threshold: float = 0.25) -> str:
        """
        评估当前目标是“确认告警”还是“疑似火点”
        
        返回:
            'confirmed' 或 'suspected'
        """
        # 判断条件：
        # 1. 置信度低 (动态阈值：低于 max(0.3, conf_threshold) 判定为疑似)
        is_low_conf = self.confidence < max(0.3, conf_threshold)
        is_small = self.area_ratio < 0.0001
        is_insufficient_frames = self.frames_seen < 5
        is_unstable = not self.position_stable
        
        if is_low_conf or is_small or is_insufficient_frames or is_unstable:
            return "suspected"
        else:
            if not self.is_confirmed:
                self.is_confirmed = True
                self.confirmed_time = time.time()
            return "confirmed"


class AlertTracker:
    """系统级告警跟踪器"""
    
    def __init__(self, iou_threshold: float = 0.3, max_missing_frames: int = 10):
        self.iou_threshold = iou_threshold
        self.max_missing_frames = max_missing_frames
        self.targets: Dict[str, TrackedTarget] = {}
        
        # 烟雾三连拍冷却机制 (上一次触发记录的系统时间)
        self.last_smoke_alert_time = 0.0
        self.smoke_cooldown = 5.0  # 5秒冷却
        
        # 用于摄像头视频录制的状态 (目标ID -> 帧缓存)
        self.recording_buffers: Dict[str, List[Tuple[float, any]]] = {}  # {target_id: [(timestamp, frame)]}

    def update(self, detections: List[Dict], frame_shape: Tuple[int, int], conf_threshold: float = 0.25) -> List[Dict]:
        """
        根据当前帧检测结果更新跟踪器
        
        参数:
            detections: 检测结果列表, 格式如 [{'class': 'fire', 'confidence': 0.65, 'bbox': [x1,y1,x2,y2]}]
            frame_shape: (height, width)
            conf_threshold: 置信度阈值限制
            
        返回:
            更新后的检测结果列表，已重写 class 为 'suspected_fire' (若不满足确认条件) 并附带 track_id
        """
        h, w = frame_shape
        frame_size = (w, h)
        
        # 提取当前帧火焰和烟雾的检测
        current_detects = []
        for det in detections:
            cls = det.get("class", "").lower()
            if cls in ("fire", "smoke"):
                current_detects.append(det)

        # 匹配当前的追踪目标
        matched_detects = {}  # detection_idx -> target_id
        matched_targets = set()  # target_id
        
        # 计算 IoU 矩阵并进行贪婪匹配
        matches = []
        for det_idx, det in enumerate(current_detects):
            det_box = det["bbox"]
            for target_id, target in self.targets.items():
                if target.cls != det["class"]:
                    continue  # 类别须一致
                iou = get_iou(det_box, target.bbox)
                if iou >= self.iou_threshold:
                    matches.append((iou, det_idx, target_id))
                    
        # 按 IoU 从大到小排序匹配
        matches.sort(key=lambda x: x[0], reverse=True)
        for iou, det_idx, target_id in matches:
            if det_idx not in matched_detects and target_id not in matched_targets:
                matched_detects[det_idx] = target_id
                matched_targets.add(target_id)
                
        # 更新已匹配的目标，创建未匹配的目标
        for det_idx, det in enumerate(current_detects):
            det_box = det["bbox"]
            conf = det["confidence"]
            cls = det["class"]
            
            if det_idx in matched_detects:
                t_id = matched_detects[det_idx]
                self.targets[t_id].update(det_box, conf)
            else:
                # 创建新目标
                t_id = "tr_" + uuid.uuid4().hex[:8]
                self.targets[t_id] = TrackedTarget(t_id, cls, det_box, conf, frame_size)
                
        # 对未匹配的已有目标，增加丢失计数
        for target_id, target in list(self.targets.items()):
            if target_id not in matched_targets:
                target.mark_missing()
                if target.frames_missing > self.max_missing_frames:
                    # 彻底丢失目标
                    del self.targets[target_id]
                    if target_id in self.recording_buffers:
                        del self.recording_buffers[target_id]

        # 评估各目标的当前状态，并重写检测输出
        output_detections = []
        for det_idx, det in enumerate(current_detects):
            t_id = matched_detects.get(det_idx)
            if not t_id or t_id not in self.targets:
                # 理论上匹配完了必有对应，安全 fallback
                output_detections.append(det)
                continue
                
            target = self.targets[t_id]
            status = target.evaluate_status(conf_threshold)
            
            # 深拷贝检测对象以修改
            new_det = dict(det)
            new_det["track_id"] = t_id
            new_det["alert_level"] = status
            
            if status == "suspected":
                new_det["class"] = "suspected_fire"  # 重写类别为“疑似火点”
            
            output_detections.append(new_det)
            
        return output_detections

    def get_events(self, timestamp: float) -> List[Dict]:
        """
        根据当前状态机产生告警事件 (例如确认告警、需截屏、需录像)
        
        返回:
            event list: [{'type': 'fire_confirm'|'smoke_burst', 'target_id': str, ...}]
        """
        events = []
        
        for target_id, target in self.targets.items():
            if target.cls == "smoke":
                # 烟雾首次被确认（或首次检测到），且过了冷却期，触发三连拍
                # 烟雾只要检测到（哪怕是suspected也开始拍，或者确认时拍）
                # 按照用户要求：“一次监测到截取三次（每次间隔一秒）五秒内只能触发一次记录”
                if not target.has_triggered_alert:
                    if timestamp - self.last_smoke_alert_time >= self.smoke_cooldown:
                        target.has_triggered_alert = True
                        self.last_smoke_alert_time = timestamp
                        events.append({
                            "type": "smoke_burst",
                            "target_id": target_id,
                            "class": "smoke",
                            "timestamp": timestamp,
                            "trigger_time": timestamp
                        })
            
            elif target.cls == "fire":
                # 火焰告警：“截取疑似火点到火焰那段+2s作为一个记录去审核”
                # 当目标首次呈现 suspected (或者一发现)，我们开始在缓冲区缓存帧
                # 当目标最终转为 confirmed 时，我们确定触发火焰录制事件！
                if target.is_confirmed and not target.has_triggered_alert:
                    target.has_triggered_alert = True
                    events.append({
                        "type": "fire_confirm",
                        "target_id": target_id,
                        "class": "fire",
                        "timestamp": timestamp,
                        "suspected_start_time": target.first_seen,
                        "confirmed_time": target.confirmed_time
                    })
                    
        return events
