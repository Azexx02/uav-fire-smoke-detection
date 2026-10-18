"""
林焰智巡 - 检测历史记录 API
"""

import os
import shutil
import zipfile
import urllib.parse
import asyncio
import random
from datetime import datetime
from fastapi import APIRouter, HTTPException

from app.core.history_manager import HistoryManager
from app.config import STATIC_DIR, NEGATIVE_DIR, REINFORCE_DIR, DATASET_DIR

router = APIRouter(prefix="/api/history", tags=["历史记录"])

# 全局归档互斥锁，防范并发点击导致的文件移动/写入冲突
archive_lock = asyncio.Lock()



# ================================================================== #
# GET /api/history/dataset/status  —— 获取素材库状态 (未归档/已归档列表)
# ================================================================== #
@router.get("/dataset/status")
async def get_dataset_status():
    """获取数据集状态，包括未归档素材和已归档包列表"""
    # 1. 获取未归档素材
    unarchived_negative = []
    unarchived_reinforce = []
    
    if NEGATIVE_DIR.exists():
        for f in NEGATIVE_DIR.iterdir():
            if f.is_file() and f.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                unarchived_negative.append({
                    "name": f.name,
                    "url": f"/api/static/dataset/negative/{f.name}",
                    "size_kb": round(f.stat().st_size / 1024, 1),
                    "type": "negative"
                })
                
    if REINFORCE_DIR.exists():
        for f in REINFORCE_DIR.iterdir():
            if f.is_file() and f.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                unarchived_reinforce.append({
                    "name": f.name,
                    "url": f"/api/static/dataset/reinforce/{f.name}",
                    "size_kb": round(f.stat().st_size / 1024, 1),
                    "type": "reinforce"
                })
                
    # 2. 获取已归档素材包
    archived_batches = []
    archives_dir = DATASET_DIR / "archives"
    if archives_dir.exists():
        for item in archives_dir.iterdir():
            if item.is_dir() and item.name.startswith("train_material_"):
                batch_id = item.name
                ts_str = batch_id.replace("train_material_", "")
                formatted_time = ts_str
                try:
                    dt = datetime.strptime(ts_str, "%Y%m%d_%H%M%S")
                    formatted_time = dt.strftime("%Y-%m-%d %H:%M:%S")
                except:
                    pass
                
                neg_count = 0
                reinf_count = 0
                hist_count = 0
                
                neg_files = []
                reinf_files = []
                
                neg_dir = item / "negative"
                if neg_dir.exists() and neg_dir.is_dir():
                    for f in neg_dir.iterdir():
                        if f.is_file():
                            neg_count += 1
                            neg_files.append({
                                "name": f.name,
                                "url": f"/api/static/dataset/archives/{batch_id}/negative/{f.name}"
                            })
                            
                reinf_dir = item / "reinforce"
                if reinf_dir.exists() and reinf_dir.is_dir():
                    for f in reinf_dir.iterdir():
                        if f.is_file():
                            reinf_count += 1
                            reinf_files.append({
                                "name": f.name,
                                "url": f"/api/static/dataset/archives/{batch_id}/reinforce/{f.name}"
                            })
                            
                hist_dir = item / "history"
                if hist_dir.exists() and hist_dir.is_dir():
                    for f in hist_dir.iterdir():
                        if f.is_file():
                            hist_count += 1
                            
                zip_filename = f"{batch_id}.zip"
                zip_url = f"/api/static/dataset/archives/{zip_filename}"
                
                archived_batches.append({
                    "batch_id": batch_id,
                    "timestamp": formatted_time,
                    "zip_url": zip_url,
                    "negative_count": neg_count,
                    "reinforce_count": reinf_count,
                    "history_count": hist_count,
                    "negative_files": neg_files,
                    "reinforce_files": reinf_files
                })
                
    archived_batches.sort(key=lambda x: x["batch_id"], reverse=True)
    
    return {
        "success": True,
        "unarchived": {
            "negative": unarchived_negative,
            "reinforce": unarchived_reinforce,
            "total_count": len(unarchived_negative) + len(unarchived_reinforce)
        },
        "archived": archived_batches
    }


def _archive_and_package_sync(archive_name: str, timestamp: str) -> dict:
    """在子线程中同步执行素材文件的剪切、复制与压缩打包"""
    archives_dir = DATASET_DIR / "archives"
    current_archive_dir = archives_dir / archive_name
    current_archive_dir.mkdir(parents=True, exist_ok=True)
    
    neg_dest = current_archive_dir / "negative"
    reinf_dest = current_archive_dir / "reinforce"
    hist_dest = current_archive_dir / "history"
    
    neg_dest.mkdir(exist_ok=True)
    reinf_dest.mkdir(exist_ok=True)
    hist_dest.mkdir(exist_ok=True)
    
    file_count = 0
    neg_count = 0
    reinf_count = 0
    
    # 2. 剪切移动负样本 (negative) 并物理删除原图
    if NEGATIVE_DIR.exists():
        for f in NEGATIVE_DIR.iterdir():
            if f.is_file() and f.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                shutil.copy2(f, neg_dest / f.name)
                os.remove(f)
                neg_count += 1
                file_count += 1
                
    # 3. 剪切移动强化训练样本 (reinforce) 并物理删除原图
    if REINFORCE_DIR.exists():
        for f in REINFORCE_DIR.iterdir():
            if f.is_file() and f.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                shutil.copy2(f, reinf_dest / f.name)
                os.remove(f)
                reinf_count += 1
                file_count += 1
                
    # 4. 复制历史检测记录中的原始图片 (history) 为基础素材 (仅限已评审过的非正确记录，且带有视频的记录只存核心图片)
    hm = HistoryManager()
    records = hm.get_all()
    
    # 获取专家评审结果，找出已评审及被判定为正确的记录 ID
    from app.core.scoring_manager import ScoringManager
    sm = ScoringManager()
    scores = sm.get_summary().get("score_details", [])
    correct_ids = {d["history_id"] for d in scores if d.get("correct") is True}
    reviewed_ids = {d["history_id"] for d in scores}
    
    hist_count = 0
    for rec in records:
        rec_id = rec.get("id")
        # 仅限专家评审过的记录进入素材
        if rec_id not in reviewed_ids:
            continue
        # 跳过专家评审判定为正确的图片和记录
        if rec_id in correct_ids:
            continue
            
        urls = []
        is_video_record = (rec.get("type") == "video") or (rec.get("video_clip")) or (rec.get("original_path", "").lower().endswith(('.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv')))
        
        if is_video_record:
            # 带有视频的记录若存入素材管理则只存核心图片
            if "images" in rec and rec["images"]:
                urls.extend(rec["images"])
        else:
            if "images" in rec and rec["images"]:
                urls.extend(rec["images"])
            else:
                main_url = rec.get("original_path") or rec.get("annotated_path")
                if main_url:
                    urls.append(main_url)
                
        for url in urls:
            # 确保只存图片，排除视频
            if any(url.lower().endswith(ext) for ext in ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv']):
                continue
                
            url_path = urllib.parse.urlparse(url).path
            if url_path.startswith("/api/static/"):
                rel_path = url_path.replace("/api/static/", "")
                local_path = STATIC_DIR / rel_path
                if local_path.exists() and local_path.is_file():
                    shutil.copy2(local_path, hist_dest / local_path.name)
                    hist_count += 1
                    file_count += 1
                    
    # 5. 打包为 zip
    zip_filename = f"{archive_name}.zip"
    zip_path = archives_dir / zip_filename
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(current_archive_dir):
            for file in files:
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, archives_dir)
                zipf.write(file_path, rel_path)
                
    download_url = f"/api/static/dataset/archives/{zip_filename}"
    
    return {
        "message": f"打包归档成功！移动负样本 {neg_count} 个，强化样本 {reinf_count} 个，复制基础历史样本 {hist_count} 个。",
        "download_url": download_url,
        "timestamp": timestamp,
        "file_count": file_count
    }


# ================================================================== #
# POST /api/history/dataset/archive  —— 执行归档打包并清空未归档
# ================================================================== #
@router.post("/dataset/archive")
async def archive_and_package_dataset():
    """执行素材归档打包：剪切移动当前未归档样本到归档库，复制历史图片，并生成 zip 压缩包"""
    async with archive_lock:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        rand_suffix = f"{random.randint(0, 0xffff):04x}"
        archive_name = f"train_material_{timestamp}_{rand_suffix}"
        
        try:
            res = await asyncio.to_thread(_archive_and_package_sync, archive_name, timestamp)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"打包归档失败: {str(e)}")
            
        return {
            "success": True,
            **res
        }



# ================================================================== #
# GET /api/history  —— 全部记录
# ================================================================== #
@router.get("")
@router.get("/")
async def get_all_history():
    """获取所有检测历史记录"""
    hm = HistoryManager()
    records = hm.get_all()
    return {
        "success": True,
        "count": len(records),
        "records": records,
    }


# ================================================================== #
# DELETE /api/history/clear/all  —— 清空全部
# ================================================================== #
@router.delete("/clear/all")
async def clear_all_history():
    """清空全部历史记录"""
    # 1. 清除历史记录
    hm = HistoryManager()
    hm.clear_all()
    
    # 2. 清除所有活动评分
    try:
        from app.core.scoring_manager import ScoringManager
        sm = ScoringManager()
        sm.reset()
    except Exception as e:
        print(f"[Scoring Manager] Error resetting scores on clear all: {e}")
        
    # 3. 物理删除所有未归档素材图片
    try:
        for target_dir in [NEGATIVE_DIR, REINFORCE_DIR]:
            if target_dir.exists():
                for f in target_dir.iterdir():
                    if f.is_file() and f.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                        try:
                            f.unlink()
                        except Exception as e:
                            print(f"[Dataset Cleaner] Failed to delete file {f} on clear all: {e}")
    except Exception as e:
        print(f"[Dataset Cleaner] Error unlinking files on clear all: {e}")
        
    return {"success": True, "message": "已清空所有历史记录及相关未归档评审与素材数据"}


# ================================================================== #
# GET /api/history/{record_id}  —— 单条记录
# ================================================================== #
@router.get("/{record_id}")
async def get_history_by_id(record_id: str):
    """根据 ID 获取单条历史记录"""
    hm = HistoryManager()
    record = hm.get_by_id(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"记录不存在: {record_id}")
    return {"success": True, "record": record}


# ================================================================== #
# DELETE /api/history/{record_id}  —— 删除单条
# ================================================================== #
@router.delete("/{record_id}")
async def delete_history_by_id(record_id: str):
    """删除指定历史记录"""
    hm = HistoryManager()
    record = hm.get_by_id(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"记录不存在: {record_id}")
        
    ok = hm.delete_by_id(record_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"记录不存在: {record_id}")
        
    # 如果该记录未归档 (batch_id 不存在)，则进行级联清理，防止数据残留和评审冗余
    if not record.get("batch_id"):
        # 1. 物理删除该未归档记录在素材库中已复制的所有图片
        try:
            from app.api.scoring import _delete_dataset_sample
            _delete_dataset_sample(record)
        except Exception as e:
            print(f"[Dataset Cleaner] Error cleaning sample on delete: {e}")
            
        # 2. 从专家评分活动数据中移除该历史记录打分状态
        try:
            from app.core.scoring_manager import ScoringManager
            sm = ScoringManager()
            sm.remove_score(record_id)
        except Exception as e:
            print(f"[Scoring Manager] Error removing score on delete: {e}")
            
    return {"success": True, "message": f"已删除记录: {record_id}"}


# ================================================================== #
# DELETE /api/history/dataset/unarchived/clear  —— 一键清除未归档素材
# ================================================================== #
@router.delete("/dataset/unarchived/clear")
async def clear_unarchived_dataset():
    """一键清除当前所有的未归档素材图片，并重置这些样本在专家评分中的状态"""
    from pathlib import Path
    
    # 1. 搜集并物理删除未归档图片
    deleted_count = 0
    deleted_filenames = set()
    
    try:
        for target_dir in [NEGATIVE_DIR, REINFORCE_DIR]:
            if target_dir.exists():
                for f in target_dir.iterdir():
                    if f.is_file() and f.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                        try:
                            deleted_filenames.add(f.name)
                            f.unlink()
                            deleted_count += 1
                        except Exception as e:
                            print(f"[Dataset Cleaner] Failed to delete file {f}: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"清除未归档素材文件失败: {str(e)}")
        
    # 2. 从专家评分活动数据中移除判定为“错误”(correct: False) 且与已删图片关联的评分条目
    # 这样做会将对应的历史记录在“专家评分”中回滚为“未评分”状态
    try:
        from app.core.scoring_manager import ScoringManager
        from app.core.history_manager import HistoryManager
        sm = ScoringManager()
        hm = HistoryManager()
        
        scores = sm.get_summary().get("score_details", [])
        for d in scores:
            if d.get("correct") is False:
                history_id = d["history_id"]
                record = hm.get_by_id(history_id)
                if record:
                    urls = []
                    if "images" in record and record["images"]:
                        urls.extend(record["images"])
                    else:
                        main_url = record.get("original_path") or record.get("annotated_path")
                        if main_url:
                            urls.append(main_url)
                            
                    has_matching_deleted_file = False
                    for url in urls:
                        url_path = urllib.parse.urlparse(url).path
                        filename = Path(url_path).name
                        if filename in deleted_filenames:
                            has_matching_deleted_file = True
                            break
                            
                    if has_matching_deleted_file:
                        sm.remove_score(history_id)
    except Exception as e:
        print(f"[Scoring Manager] Error rolling back scores during dataset clear: {e}")
        
    return {
        "success": True,
        "deleted_count": deleted_count,
        "message": f"成功清除 {deleted_count} 个未归档素材文件，且相关的错误评分已回滚。"
    }


# ================================================================== #
# DELETE /api/history/unarchived/clear  —— 一键清除未归档历史记录
# ================================================================== #
@router.delete("/unarchived/clear")
async def clear_unarchived_history():
    """一键清除所有未归档的历史记录，并级联清理它们的评分状态与素材文件"""
    hm = HistoryManager()
    records = hm.get_all()
    
    unarchived_count = 0
    from app.api.scoring import _delete_dataset_sample
    from app.core.scoring_manager import ScoringManager
    sm = ScoringManager()
    
    for rec in records:
        if not rec.get("batch_id"):
            rec_id = rec.get("id")
            # 1. 物理删除该未归档记录在素材库中已复制的所有图片
            try:
                _delete_dataset_sample(rec)
            except Exception as e:
                print(f"[Dataset Cleaner] Error cleaning sample on delete cascade: {e}")
                
            # 2. 从专家评分活动数据中移除评分状态
            try:
                sm.remove_score(rec_id)
            except Exception as e:
                print(f"[Scoring Manager] Error removing score on delete cascade: {e}")
                
            # 3. 从数据库中物理删除记录
            try:
                hm.delete_by_id(rec_id)
                unarchived_count += 1
            except Exception as e:
                print(f"[History Manager] Error deleting record {rec_id}: {e}")
                
    return {
        "success": True,
        "count": unarchived_count,
        "message": f"已成功清除 {unarchived_count} 条未归档的历史检测记录及相关评审与素材数据。"
    }


# ================================================================== #
# DELETE /api/history/dataset/archives/{batch_id}  —— 删除指定已归档批次
# ================================================================== #
@router.delete("/dataset/archives/{batch_id}")
async def delete_archived_batch(batch_id: str):
    """物理删除指定的归档素材批次，包括其文件夹、ZIP 文件，并级联删除归属于此批次的历史记录"""
    # 安全检查：防止路径注入 (限制 batch_id 的字符)
    import re
    if not re.match(r"^[a-zA-Z0-9_\-]+$", batch_id):
        raise HTTPException(status_code=400, detail="非法的批次 ID 格式")
        
    archives_dir = DATASET_DIR / "archives"
    target_dir = archives_dir / batch_id
    zip_path = archives_dir / f"{batch_id}.zip"
    
    # 1. 物理删除批次文件夹
    if target_dir.exists() and target_dir.is_dir():
        try:
            shutil.rmtree(target_dir, ignore_errors=True)
        except Exception as e:
            print(f"[Archive Manager] Failed to rmtree {target_dir}: {e}")
            
    # 2. 物理删除对应的 ZIP 文件
    if zip_path.exists() and zip_path.is_file():
        try:
            zip_path.unlink(missing_ok=True)
        except Exception as e:
            print(f"[Archive Manager] Failed to delete zip file {zip_path}: {e}")
            
    # 3. 级联删除属于此批次的历史记录
    hm = HistoryManager()
    records = hm.get_all()
    deleted_history_count = 0
    
    for rec in records:
        if rec.get("batch_id") == batch_id:
            try:
                hm.delete_by_id(rec["id"])
                deleted_history_count += 1
            except Exception as e:
                print(f"[History Manager] Failed to delete archived history record {rec.get('id')}: {e}")
                
    return {
        "success": True,
        "batch_id": batch_id,
        "deleted_history_count": deleted_history_count,
        "message": f"成功删除批次 {batch_id} 及其归档文件，且物理清理了相关已归档的 {deleted_history_count} 条历史记录。"
    }
