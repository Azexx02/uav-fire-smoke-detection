"""
林焰智巡 - 评分 API
"""

from typing import Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.scoring_manager import ScoringManager
from app.core.history_manager import HistoryManager


router = APIRouter(prefix="/api/scoring", tags=["评分"])


class ScoreRequest(BaseModel):
    """评分请求体"""
    correct: bool
    has_fire_smoke: bool | None = None
    image_decisions: dict[str, Any] | None = None


# ================================================================== #
# GET /api/scoring/summary  —— 评分汇总（放在 /{history_id} 之前）
# ================================================================== #
@router.get("/summary")
async def get_scoring_summary():
    """获取评分汇总"""
    sm = ScoringManager()
    summary = sm.get_summary()
    return {"success": True, **summary}


# ================================================================== #
# POST /api/scoring/reset  —— 重置评分
# ================================================================== #
@router.post("/reset")
async def reset_scoring():
    """重置所有评分"""
    sm = ScoringManager()
    sm.reset()
    return {"success": True, "message": "评分已重置"}


# ================================================================== #
# POST /api/scoring/commit  —— 提交归档为评审批次
# ================================================================== #
@router.post("/commit")
async def commit_scoring_batch():
    """将当前已评分的记录打包提交为一个评审批次，并清除当前活动评分状态"""
    sm = ScoringManager()
    hm = HistoryManager()
    
    summary = sm.get_summary()
    details = summary.get("score_details", [])
    
    if not details:
        raise HTTPException(status_code=400, detail="没有已评分的记录可供归档提交")
        
    record_ids = [d["history_id"] for d in details]
    
    # 提交批次归档
    batch_id = hm.commit_batch(record_ids)
    
    # 重置当前的活动评分
    sm.reset()
    
    return {
        "success": True,
        "batch_id": batch_id,
        "record_count": len(record_ids),
        "message": f"成功归档 {len(record_ids)} 条记录到 {batch_id}",
    }


import shutil
import urllib.parse
from pathlib import Path
from app.config import NEGATIVE_DIR, REINFORCE_DIR, STATIC_DIR, UPLOAD_DIR

def _get_local_original_path(record: dict, url: str) -> Path | None:
    """根据给定的图片 URL，获取对应的原始未标注图片的本地物理路径"""
    target_url = url
    if url == record.get("annotated_path"):
        target_url = record.get("original_path") or url
    else:
        images = record.get("images", [])
        if url in images:
            idx = images.index(url)
            orig_images = record.get("original_images", [])
            if orig_images and idx < len(orig_images):
                target_url = orig_images[idx]
            else:
                # 命名规整兜底
                url_path = urllib.parse.urlparse(url).path
                filename = Path(url_path).name
                if filename.startswith("det_"):
                    orig_filename = filename.replace("det_", "orig_", 1)
                    if (UPLOAD_DIR / orig_filename).exists():
                        target_url = url.replace(filename, orig_filename)
                elif filename.startswith("routine_det_"):
                    orig_filename = filename.replace("routine_det_", "routine_orig_", 1)
                    if (UPLOAD_DIR / orig_filename).exists():
                        target_url = url.replace(filename, orig_filename)

    url_path = urllib.parse.urlparse(target_url).path
    if url_path.startswith("/api/static/"):
        rel_path = url_path.replace("/api/static/", "")
        local_path = STATIC_DIR / rel_path
        if local_path.exists() and local_path.is_file():
            return local_path
            
    # 如果没找到原始图，就用当前传入 URL 的物理路径兜底
    url_path = urllib.parse.urlparse(url).path
    if url_path.startswith("/api/static/"):
        rel_path = url_path.replace("/api/static/", "")
        local_path = STATIC_DIR / rel_path
        if local_path.exists() and local_path.is_file():
            return local_path
            
    return None


def _delete_dataset_sample(record: dict):
    """当记录被标为正确时，从负样本库和强化训练库中物理删除该记录的所有关联图片"""
    urls = []
    if "images" in record and record["images"]:
        urls.extend(record["images"])
    else:
        main_url = record.get("original_path") or record.get("annotated_path")
        if main_url:
            urls.append(main_url)
            
    for url in urls:
        local_orig_path = _get_local_original_path(record, url)
        orig_filename = local_orig_path.name if local_orig_path else Path(urllib.parse.urlparse(url).path).name
        if orig_filename:
            for target_dir in [NEGATIVE_DIR, REINFORCE_DIR]:
                f_path = target_dir / orig_filename
                if f_path.exists() and f_path.is_file():
                    try:
                        f_path.unlink()
                    except Exception as e:
                        print(f"[Dataset Cleaner] Failed to delete file {f_path}: {e}")


def _archive_dataset_sample(record: dict, has_fire_smoke: bool):
    """根据专家反馈，将识别错误的图片/帧复制归档到负样本库或强化训练库"""
    target_dir = REINFORCE_DIR if has_fire_smoke else NEGATIVE_DIR
    target_dir.mkdir(parents=True, exist_ok=True)
    
    # 搜集该记录的所有图片 URL（优先 original_path 以获取无画框原始图，其次 images/annotated_path）
    urls = []
    
    is_video_record = (record.get("type") == "video") or (record.get("video_clip")) or (record.get("original_path", "").lower().endswith(('.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv')))
    
    if is_video_record:
        if "images" in record and record["images"]:
            urls.extend(record["images"])
    else:
        if "images" in record and record["images"]:
            urls.extend(record["images"])
        else:
            main_url = record.get("original_path") or record.get("annotated_path")
            if main_url:
                urls.append(main_url)
                
    for url in urls:
        # 确保只存图片，排除视频
        if any(url.lower().endswith(ext) for ext in ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv']):
            continue
            
        local_path = _get_local_original_path(record, url)
        if local_path and local_path.exists() and local_path.is_file():
            shutil.copy2(local_path, target_dir / local_path.name)


def _archive_dataset_sample_by_decisions(record: dict, decisions: dict[str, Any]):
    """根据专家对每张图片的独立选择进行精细化归档"""
    # 搜集该记录合法的图片 URL 集合，防止越权传入其他 URL
    valid_urls = set()
    if "images" in record and record["images"]:
        valid_urls.update(record["images"])
    else:
        main_url = record.get("original_path") or record.get("annotated_path")
        if main_url:
            valid_urls.add(main_url)
            
    for url, decision in decisions.items():
        # 安全校验：确保传入的 URL 属于当前记录
        if url not in valid_urls:
            print(f"[Security Check] Blocked unauthorized URL decision: {url} for record {record.get('id')}")
            continue
            
        local_orig_path = _get_local_original_path(record, url)
        orig_filename = local_orig_path.name if local_orig_path else Path(urllib.parse.urlparse(url).path).name
        
        # 如果是无错误，从负样本库和强化训练库中物理删除
        if decision is None or decision == "none" or decision == "no_error" or decision == "":
            if orig_filename:
                for target_dir in [NEGATIVE_DIR, REINFORCE_DIR]:
                    f_path = target_dir / orig_filename
                    if f_path.exists() and f_path.is_file():
                        try:
                            f_path.unlink()
                        except Exception as e:
                            print(f"[Dataset Cleaner] Failed to delete file {f_path}: {e}")
            continue
            
        # 确保只存图片，排除视频
        if any(url.lower().endswith(ext) for ext in ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv']):
            continue
            
        has_fire_smoke = (decision is True or decision == "true" or decision == "reinforce")
        
        target_dir = REINFORCE_DIR if has_fire_smoke else NEGATIVE_DIR
        opposite_dir = NEGATIVE_DIR if has_fire_smoke else REINFORCE_DIR
        
        target_dir.mkdir(parents=True, exist_ok=True)
        
        if orig_filename:
            # 确保删除另一侧目录的旧文件
            opp_file = opposite_dir / orig_filename
            if opp_file.exists() and opp_file.is_file():
                try:
                    opp_file.unlink()
                except Exception as e:
                    print(f"[Dataset Cleaner] Failed to delete opp file {opp_file}: {e}")
                    
            if local_orig_path and local_orig_path.exists() and local_orig_path.is_file():
                shutil.copy2(local_orig_path, target_dir / orig_filename)


# ================================================================== #
# POST /api/scoring/{history_id}  —— 对单张图评分
# ================================================================== #
@router.post("/{history_id}")
async def score_image(history_id: str, body: ScoreRequest):
    """对指定历史记录评分"""
    # 校验记录存在
    hm = HistoryManager()
    record = hm.get_by_id(history_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"历史记录不存在: {history_id}")

    sm = ScoringManager()
    result = sm.score_image(history_id, body.correct)
    
    # 如果打分为“正确”，则将该记录之前可能存在的错误复制样本删除
    if body.correct:
        try:
            _delete_dataset_sample(record)
        except Exception as e:
            print(f"[Dataset Cleaner] Failed to clean sample {history_id}: {str(e)}")
    # 如果打分为“错误”，且指定了是否存在火焰/烟雾，则进行数据集归档复制
    else:
        if body.image_decisions:
            try:
                _archive_dataset_sample_by_decisions(record, body.image_decisions)
            except Exception as e:
                print(f"[Dataset Archiver] Failed to archive sample {history_id} by decisions: {str(e)}")
        elif body.has_fire_smoke is not None:
            try:
                _archive_dataset_sample(record, body.has_fire_smoke)
            except Exception as e:
                # 记录异常，但不阻断核心的打分流程
                print(f"[Dataset Archiver] Failed to archive sample {history_id}: {str(e)}")
            
    return {"success": True, **result}
