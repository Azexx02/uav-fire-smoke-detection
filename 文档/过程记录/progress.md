# Progress Log

## 2026-07-11
- Prepared false-positive fine-tune dataset from `新的错误样本`.
- Used all unique images under `新的错误样本\**\negative` as empty-label negatives after user confirmed remaining `det_*` files contain no visible boxes.
- Created `fasdd_uav_fp.yaml` and `FASDD_UAV (3)\train_fp.txt`.
- Added 269 unique negative samples; final training list has 12,820 images.
- Continued training from `runs/detect/runs/fasdd_uav_yolov8n_finetune_v2/weights/best.pt`.
- Training output: `runs/detect/runs/fasdd_uav_yolov8n_finetune_v3_fp/weights/best.pt`.
- Final validation metrics: precision 0.89057, recall 0.85927, mAP50 0.91862, mAP50-95 0.67659.
- False-positive evaluation at conf=0.25 on 269 unique negative samples:
  - full: 142/269 = 52.79%.
  - finetune_v2: 102/269 = 37.92%.
  - finetune_v3_fp: 2/269 = 0.74%.
- Updated local `app/config.py` to load `fasdd_uav_yolov8n_finetune_v3_fp`.
- Synced new model to development board `192.168.x.x`, updated remote config, and restarted service.
- Development board health check passed: `model_loaded=true`, model file size 6,232,291 bytes, downward camera available at 1280x720.

## 2026-06-02
- Started FASDD_UAV training preparation.
- Confirmed dataset folder exists and contains `images` and `annotations`.
- Confirmed bundled Python lacks YOLO training dependencies.
- Confirmed FASDD_UAV already provides YOLO split files and labels.
- Determined class mapping from VOC/YOLO samples: `0=fire`, `1=smoke`.
- Added `fasdd_uav.yaml`.
- Copied YOLO split files and labels into Ultralytics-compatible root locations.
- Verified image/label consistency and label value ranges.
- Completed probe training (1 epoch, 2% data): mAP50=0.21, mAP50-95=0.10.
- Started full training: 50 epochs, batch=16, yolov8n, output=`runs/fasdd_uav_yolov8n_full`.
- **Training completed**: mAP50=91.28%, mAP50-95=66.99%, Precision=88.45%, Recall=85.10%.
- Best weights: `runs/detect/runs/fasdd_uav_yolov8n_full/weights/best.pt`
- Added 98 false positive images (negative samples) to training set.
- Training set: 12,551 → 12,649 images.
- Started fine-tune training: 20 epochs, lr=0.001, output=`runs/fasdd_uav_yolov8n_finetune`.
- **Fine-tune completed**: mAP50=91.43%, mAP50-95=67.08%, Precision=88.80%, Recall=84.79%.
- Best weights: `runs/detect/runs/fasdd_uav_yolov8n_finetune/weights/best.pt`
- Added 392 new false positive images to training set.
- Training set: 12,649 → 13,041 images.
- Started fine-tune v2 training: 20 epochs, lr=0.001, output=`runs/fasdd_uav_yolov8n_finetune_v2`.
- **Fine-tune v2 completed**: mAP50=91.77%, mAP50-95=67.47%, Precision=88.77%, Recall=85.66%.
- Best weights: `runs/detect/runs/fasdd_uav_yolov8n_finetune_v2/weights/best.pt`
- False positive test: 30.5% (down from 33.9%).
- Removed all 491 negative samples from training set. Training set: 13,041 → 12,550 images.
