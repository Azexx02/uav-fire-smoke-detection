# Findings

## Initial Context
- Project: "林焰智巡" forest fire inspection UAV AI vision application.
- Competition requires offline inference, 20 captured prediction screenshots, model evaluation report, and GUI/history review.
- Dataset provided: `FASDD_UAV`（项目根目录下）。

## Dataset
- Initial directory listing shows `images` and `annotations`.
- Images: 25,097 `.jpg` files.
- Annotations include COCO, VOC, TDML, and YOLO formats.
- YOLO split files already exist:
  - train: 12,551 images
  - val: 8,365 images
  - test: 4,181 images
- YOLO objects: 53,530 total; class `0`: 36,308, class `1`: 17,222.
- VOC sample confirms class names: `fire` and `smoke`.
- Existing YOLO labels are under `annotations\YOLO_UAV\labels`; Ultralytics expects labels to resolve from image paths, so create/copy a standard root `labels` directory.
- Created root split files: `FASDD_UAV\train.txt`, `FASDD_UAV\val.txt`, `FASDD_UAV\test.txt`.
- Created root `FASDD_UAV\labels` with 25,097 label files.
- Dataset consistency check passed:
  - train: 12,551 images, 26,776 objects, 0 missing images, 0 missing labels, 5,994 empty labels.
  - val: 8,365 images, 17,828 objects, 0 missing images, 0 missing labels, 3,995 empty labels.
  - test: 4,181 images, 8,926 objects, 0 missing images, 0 missing labels, 1,997 empty labels.
- Empty labels are expected negative samples and useful for false-positive control.

## Environment
- Bundled Python path: `C:\Users\<user>\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`（归档环境记录）。
- Bundled Python currently does not have `ultralytics`, `torch`, or `cv2`.

## False Positive Fine-tune v3
- Current workspace dataset directory is `FASDD_UAV (3)`, while the older `fasdd_uav.yaml` pointed to missing `FASDD_UAV`.
- Created `fasdd_uav_fp.yaml` targeting `FASDD_UAV (3)`.
- Prepared a reproducible false-positive training list:
  - Base train images: 12,551.
  - Added unique negative samples from `新的错误样本\**\negative`: 269.
  - Final `train_fp.txt`: 12,820 images.
  - Empty-label images in training set: 6,263.
- Baseline false-positive rate on the 269 unique negative samples at conf=0.25:
  - full: 142/269 = 52.79%.
  - finetune_v2: 102/269 = 37.92%.
  - finetune_v3_fp: 2/269 = 0.74%.
- finetune_v3_fp validation metrics after epoch 20:
  - precision: 0.89057.
  - recall: 0.85927.
  - mAP50: 0.91862.
  - mAP50-95: 0.67659.
