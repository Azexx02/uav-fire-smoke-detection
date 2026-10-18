"""
林焰智巡 - 训练报告 & 模型信息 API
"""

import csv
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.config import TRAINING_RESULTS_DIR, MODEL_PATH, CLASS_NAMES
from app.core.detector import FireSmokeDetector

router = APIRouter(prefix="/api/report", tags=["报告"])


def _static_url_for_training(abs_path: str) -> str:
    """
    训练结果图片不在 app/static 下，无法通过静态文件路由直接访问。
    这里返回一个专用 API URL，由下面的 training_image 端点代理读取。
    """
    name = Path(abs_path).name
    return f"/api/report/training/image/{name}"


# ================================================================== #
# GET /api/report/training  —— 训练结果
# ================================================================== #
@router.get("/training")
async def get_training_report():
    """
    读取训练目录中的 results.csv，提取最终 epoch 指标；
    列出所有训练曲线图片。
    """
    results_csv = TRAINING_RESULTS_DIR / "results.csv"
    if not results_csv.exists():
        raise HTTPException(status_code=404, detail="results.csv 不存在")

    # ---- 解析 CSV ----
    metrics: dict = {}
    try:
        with open(results_csv, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)

        if rows:
            last = rows[-1]
            # 去掉列名中的前后空白
            last = {k.strip(): v.strip() for k, v in last.items()}
            metrics = {
                "epochs": len(rows),
                "precision": _safe_float(last.get("metrics/precision(B)")),
                "recall": _safe_float(last.get("metrics/recall(B)")),
                "mAP50": _safe_float(last.get("metrics/mAP50(B)")),
                "mAP50_95": _safe_float(last.get("metrics/mAP50-95(B)")),
                "box_loss": _safe_float(last.get("val/box_loss")),
                "cls_loss": _safe_float(last.get("val/cls_loss")),
                "dfl_loss": _safe_float(last.get("val/dfl_loss")),
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析 results.csv 失败: {e}")

    # ---- 列出曲线图 ----
    image_exts = {".png", ".jpg", ".jpeg"}
    curves: dict[str, str] = {}
    for fp in sorted(TRAINING_RESULTS_DIR.iterdir()):
        if fp.suffix.lower() in image_exts:
            curves[fp.stem] = _static_url_for_training(str(fp))

    return {
        "success": True,
        "metrics": metrics,
        "curves": curves,
        "training_dir": str(TRAINING_RESULTS_DIR),
    }


# ================================================================== #
# GET /api/report/training/image/{filename}  —— 代理返回训练图片
# ================================================================== #
@router.get("/training/image/{filename}")
async def get_training_image(filename: str):
    """代理返回训练结果目录下的图片"""
    from fastapi.responses import FileResponse

    safe_name = Path(filename).name  # 防目录穿越
    file_path = TRAINING_RESULTS_DIR / safe_name
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"文件不存在: {filename}")

    suffix = file_path.suffix.lower()
    media_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
    media_type = media_map.get(suffix, "application/octet-stream")
    return FileResponse(str(file_path), media_type=media_type)


# ================================================================== #
# GET /api/report/model  —— 模型信息
# ================================================================== #
@router.get("/model")
async def get_model_info():
    """返回当前模型基本信息"""
    detector = FireSmokeDetector()
    model = detector.model

    # 从模型中提取信息
    model_info: dict = {
        "name": "v4.0_for_preview.pt",
        "classes": CLASS_NAMES,
        "num_classes": len(CLASS_NAMES),
        "weights_path": str(MODEL_PATH),
        "input_size": 640,
        "model_size": "6.2 MB",
        "version_note": "面向摄像头展示场景的打印/手机照片识别模型",
    }

    # 尝试读取训练指标
    results_csv = TRAINING_RESULTS_DIR / "results.csv"
    if results_csv.exists():
        try:
            with open(results_csv, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                rows = list(reader)
            if rows:
                last = {k.strip(): v.strip() for k, v in rows[-1].items()}
                model_info["metrics"] = {
                    "precision": _safe_float(last.get("metrics/precision(B)")),
                    "recall": _safe_float(last.get("metrics/recall(B)")),
                    "mAP50": _safe_float(last.get("metrics/mAP50(B)")),
                    "mAP50_95": _safe_float(last.get("metrics/mAP50-95(B)")),
                }
        except Exception:
            model_info["metrics"] = None

    return {"success": True, **model_info}


# ================================================================== #
# 辅助函数
# ================================================================== #
def _safe_float(val) -> float | None:
    """安全转浮点数"""
    if val is None:
        return None
    try:
        return round(float(val), 5)
    except (ValueError, TypeError):
        return None
