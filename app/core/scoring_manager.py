"""
林焰智巡 - 评分管理器
线程安全的 JSON 文件持久化，每张图最高 SCORE_PER_IMAGE 分
"""

import json
import threading
from pathlib import Path
from typing import Optional

from app.config import SCORING_FILE, SCORE_PER_IMAGE, MAX_SCORE


class ScoringManager:
    """评分管理（JSON 持久化 + 线程锁）"""

    _instance: Optional["ScoringManager"] = None
    _lock = threading.Lock()

    def __new__(cls) -> "ScoringManager":
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
            self._file = SCORING_FILE
            self._scores: dict[str, dict] = self._load()
            self._initialized = True

    # ------------------------------------------------------------------ #
    # 持久化
    # ------------------------------------------------------------------ #
    def _load(self) -> dict[str, dict]:
        if self._file.exists():
            try:
                with open(self._file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data if isinstance(data, dict) else {}
            except (json.JSONDecodeError, IOError):
                return {}
        return {}

    def _save(self) -> None:
        self._file.parent.mkdir(parents=True, exist_ok=True)
        with open(self._file, "w", encoding="utf-8") as f:
            json.dump(self._scores, f, ensure_ascii=False, indent=2)

    # ------------------------------------------------------------------ #
    # 公共方法
    # ------------------------------------------------------------------ #
    def score_image(self, history_id: str, correct: bool) -> dict:
        """
        对一条历史记录打分。

        参数:
            history_id: 历史记录 ID
            correct:    True = 检测正确 → 得分；False = 不正确 → 0 分

        返回:
            { history_id, correct, score, message }
        """
        score = SCORE_PER_IMAGE if correct else 0.0
        entry = {
            "history_id": history_id,
            "correct": correct,
            "score": score,
        }
        with self._lock:
            self._scores[history_id] = entry
            self._save()

        return {
            "history_id": history_id,
            "correct": correct,
            "score": score,
            "message": "评分成功：正确 (+{:.2f})".format(score) if correct else "评分成功：不正确 (0)",
        }

    def get_summary(self) -> dict:
        """获取评分汇总"""
        with self._lock:
            details = list(self._scores.values())

        total_images = len(details)
        correct_count = sum(1 for d in details if d.get("correct"))
        incorrect_count = total_images - correct_count
        total_score = sum(d.get("score", 0.0) for d in details)

        return {
            "total_images": total_images,
            "scored_images": total_images,
            "correct_count": correct_count,
            "incorrect_count": incorrect_count,
            "unscored_count": 0,  # 已评分即存在，暂无"未评分"态
            "total_score": round(total_score, 2),
            "max_score": MAX_SCORE,
            "score_percentage": round(total_score / MAX_SCORE * 100, 2) if MAX_SCORE > 0 else 0,
            "score_details": details,
        }

    def reset(self) -> None:
        """重置所有评分"""
        with self._lock:
            self._scores.clear()
            self._save()

    def remove_score(self, history_id: str) -> bool:
        """从活动评分记录中移除指定记录的评分状态"""
        with self._lock:
            if history_id in self._scores:
                del self._scores[history_id]
                self._save()
                return True
        return False

