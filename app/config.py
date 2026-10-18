"""
林焰智巡 - 配置模块
集中管理所有路径、常量和系统参数
"""

import os
from pathlib import Path

# ======================== 基础路径 ========================
BASE_DIR = Path(__file__).resolve().parent.parent

# 模型权重路径
MODEL_PATH = BASE_DIR / "models" / "v4.0_for_preview" / "best.pt"

# 训练结果目录
TRAINING_RESULTS_DIR = BASE_DIR / "runs" / "detect" / "runs" / "detect" / "runs" / "fasdd_uav_yolov8n_v32_print_demo_hardneg"

# ======================== 应用路径 ========================
APP_DIR = BASE_DIR / "app"

# 静态文件目录
STATIC_DIR = APP_DIR / "static"
RESULTS_DIR = STATIC_DIR / "results"
UPLOAD_DIR = STATIC_DIR / "uploads"
THUMBNAIL_DIR = STATIC_DIR / "thumbnails"
VIDEO_DIR = STATIC_DIR / "videos"

# 样本收集目录（用于连续学习与训练迭代）
DATASET_DIR = STATIC_DIR / "dataset"
NEGATIVE_DIR = DATASET_DIR / "negative"
REINFORCE_DIR = DATASET_DIR / "reinforce"

# 数据持久化目录
DATA_DIR = APP_DIR / "data"
HISTORY_FILE = DATA_DIR / "history.json"
SCORING_FILE = DATA_DIR / "scoring.json"

# 前端目录
FRONTEND_DIR = BASE_DIR / "frontend"

# ======================== 检测参数 ========================
CLASS_NAMES = ["fire", "smoke"]
DEFAULT_CONF = 0.25

# ======================== 评分参数 ========================
SCORE_PER_IMAGE = 1.75
MAX_SCORE = 35.0

# ======================== 视频参数 ========================
DEFAULT_FRAME_INTERVAL = 10  # 每隔 N 帧检测一次

# ======================== 缩略图参数 ========================
THUMBNAIL_WIDTH = 200

# ======================== 初始化目录 ========================
_dirs_to_create = [
    RESULTS_DIR,
    UPLOAD_DIR,
    THUMBNAIL_DIR,
    VIDEO_DIR,
    DATA_DIR,
    FRONTEND_DIR,
    NEGATIVE_DIR,
    REINFORCE_DIR,
]

for _d in _dirs_to_create:
    _d.mkdir(parents=True, exist_ok=True)
