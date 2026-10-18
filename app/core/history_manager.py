"""
林焰智巡 - 历史记录管理器
线程安全的 JSON 文件持久化
"""

import json
import threading
from pathlib import Path
from typing import Optional

from app.config import HISTORY_FILE


class HistoryManager:
    """检测历史记录管理（JSON 持久化 + 线程锁）"""

    _instance: Optional["HistoryManager"] = None
    _lock = threading.Lock()

    def __new__(cls) -> "HistoryManager":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    obj = super().__new__(cls)
                    obj._initialized = False
                    cls._instance = obj
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return
            self._file = HISTORY_FILE
            self._records: list[dict] = self._load()
            self._initialized = True

    # ------------------------------------------------------------------ #
    # 持久化
    # ------------------------------------------------------------------ #
    def _load(self) -> list[dict]:
        """从磁盘读取历史记录"""
        if self._file.exists():
            try:
                with open(self._file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data if isinstance(data, list) else []
            except (json.JSONDecodeError, IOError):
                return []
        return []

    def _save(self) -> None:
        """将历史记录写入磁盘"""
        self._file.parent.mkdir(parents=True, exist_ok=True)
        with open(self._file, "w", encoding="utf-8") as f:
            json.dump(self._records, f, ensure_ascii=False, indent=2)

    # ------------------------------------------------------------------ #
    # 公共方法
    # ------------------------------------------------------------------ #
    def add_record(
        self,
        record_id: str,
        record_type: str,
        original_path: str,
        annotated_path: str,
        thumbnail_path: str,
        detections: list[dict],
        timestamp: str,
        **kwargs,
    ) -> dict:
        """
        新增一条检测记录。

        参数:
            record_id:      唯一 ID
            record_type:    "image" | "video" | "camera"
            original_path:  原始文件 URL / 路径
            annotated_path: 标注结果 URL / 路径
            thumbnail_path: 缩略图 URL / 路径
            detections:     检测结果列表
            timestamp:      ISO 时间戳
            **kwargs:       扩展属性 (例如 alert_type, alert_level, images, video_clip, duration_sec)
        """
        record = {
            "id": record_id,
            "type": record_type,
            "original_path": original_path,
            "annotated_path": annotated_path,
            "thumbnail_path": thumbnail_path,
            "detections": detections,
            "detection_count": len(detections),
            "timestamp": timestamp,
        }
        record.update(kwargs)
        
        with self._lock:
            self._records.insert(0, record)  # 最新记录在前
            self._save()
        return record

    def get_all(self) -> list[dict]:
        """获取全部记录"""
        with self._lock:
            return list(self._records)

    def get_by_id(self, record_id: str) -> Optional[dict]:
        """根据 ID 获取单条记录"""
        with self._lock:
            for r in self._records:
                if r["id"] == record_id:
                    return dict(r)
        return None

    def delete_by_id(self, record_id: str) -> bool:
        """删除指定记录，返回是否成功"""
        with self._lock:
            for i, r in enumerate(self._records):
                if r["id"] == record_id:
                    self._records.pop(i)
                    self._save()
                    return True
        return False

    def clear_all(self) -> None:
        """清空全部记录"""
        with self._lock:
            self._records.clear()
            self._save()

    def count(self) -> int:
        """返回记录数量"""
        with self._lock:
            return len(self._records)

    def commit_batch(self, record_ids: list[str]) -> str:
        """将一组历史记录合并为一个评审批次，并在各记录中保存该批次 ID"""
        from datetime import datetime
        batch_id = f"评审批次_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        with self._lock:
            for r in self._records:
                if r["id"] in record_ids:
                    r["batch_id"] = batch_id
            self._save()
        return batch_id
