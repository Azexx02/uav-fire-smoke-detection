"""
林焰智巡 - 森林火灾巡检演示系统
FastAPI 应用入口
"""

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import (
    STATIC_DIR,
    FRONTEND_DIR,
    MODEL_PATH,
    RESULTS_DIR,
    UPLOAD_DIR,
    THUMBNAIL_DIR,
    VIDEO_DIR,
    DATA_DIR,
)
from app.core.detector import FireSmokeDetector

# ---- 导入路由 ----
from app.api.detect import router as detect_router
from app.api.camera import router as camera_router
from app.api.history import router as history_router
from app.api.scoring import router as scoring_router
from app.api.report import router as report_router


# ================================================================== #
# Lifespan 事件（替代 deprecated on_event）
# ================================================================== #
@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动 / 关闭生命周期"""
    # ---- 启动 ----
    print("=" * 60)
    print("  林焰智巡 - 森林火灾巡检演示系统 启动中...")
    print("=" * 60)

    # 确保目录存在
    for d in [RESULTS_DIR, UPLOAD_DIR, THUMBNAIL_DIR, VIDEO_DIR, DATA_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    # 预加载模型（单例）
    try:
        FireSmokeDetector(MODEL_PATH)
        print("[启动] YOLO 模型加载成功")
    except Exception as e:
        print(f"[启动] 模型加载失败: {e}")

    # 启动后台摄像头常驻取流与推理工作线程
    try:
        from app.api.camera import camera_manager, camera_settings
        if camera_settings.get("pre_connect_enabled", True):
            camera_manager.start()
            print("[启动] 检测到预热连接已开启，后台摄像头常驻工作线程已自动连接")
        else:
            print("[启动] 检测到预热连接已关闭，延迟连接摄像头")
    except Exception as e:
        print(f"[启动] 摄像头后台线程启动失败: {e}")

    print("[启动] 系统就绪")
    print("=" * 60)

    yield  # 应用运行中

    # ---- 关闭 ----
    try:
        from app.api.camera import camera_manager
        camera_manager.stop()
        print("[关闭] 后台摄像头常驻工作线程已安全停止并释放硬件")
    except Exception as e:
        print(f"[关闭] 释放摄像头线程失败: {e}")
    print("[关闭] 林焰智巡系统已停止")


# ================================================================== #
# 创建 FastAPI 应用
# ================================================================== #
app = FastAPI(
    title="林焰智巡 - 森林火灾巡检演示系统",
    description="基于 YOLOv8 的森林火烟智能检测系统，支持图片/视频/摄像头实时检测",
    version="1.0.0",
    lifespan=lifespan,
)

# ---- CORS ----
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- 注册 API 路由（必须在挂载静态文件之前） ----
app.include_router(detect_router)
app.include_router(camera_router)
app.include_router(history_router)
app.include_router(scoring_router)
app.include_router(report_router)


# ---- 健康检查 ----
@app.get("/api/health", tags=["系统"])
async def health_check():
    """系统健康检查"""
    return {
        "status": "ok",
        "service": "林焰智巡",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model_loaded": FireSmokeDetector._instance is not None
        and FireSmokeDetector._instance._initialized,
    }


# ---- 挂载静态文件 ----
app.mount("/api/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# ---- 挂载前端（最后挂载，优先级最低） ----
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


# ================================================================== #
# 直接运行入口
# ================================================================== #
if __name__ == "__main__":
    import logging
    import uvicorn

    # RKNN runtime rewrites logging level names on the board; restore them before
    # uvicorn applies its default logging config.
    logging.addLevelName(logging.CRITICAL, "CRITICAL")
    logging.addLevelName(logging.ERROR, "ERROR")
    logging.addLevelName(logging.WARNING, "WARNING")
    logging.addLevelName(logging.INFO, "INFO")
    logging.addLevelName(logging.DEBUG, "DEBUG")

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
    )
