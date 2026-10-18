# Real Scene v3 No Print/Phone False Positive Model

## Purpose
This model is the current real-scene stable model for the forest fire/smoke inspection demo.

It is intentionally tuned to suppress false positives from non-real scenes such as printed photos and phone-screen photos placed in front of the camera. This behavior is desirable for practical deployment, but it is not suitable for judge demonstrations that expect printed fire/smoke photos to be detected as positives.

## Files
- `best.pt`: selected model weights.
- `last.pt`: final epoch weights.

## Training Source
- Base model: `runs/detect/runs/fasdd_uav_yolov8n_finetune_v2/weights/best.pt`
- Fine-tune dataset config: `fasdd_uav_fp.yaml`
- Training output: `runs/detect/runs/fasdd_uav_yolov8n_finetune_v3_fp`

## Metrics
- Precision: 0.89057
- Recall: 0.85927
- mAP50: 0.91862
- mAP50-95: 0.67659
- False-positive check on 269 unique recent negative samples at conf=0.25: 2/269 = 0.74%

## Demo Guidance
- Use this model for live real-world camera demonstrations and for showing that non-fire scenes do not trigger alarms.
- Do not use this model when the expected judge demonstration requires detecting printed or phone-displayed fire/smoke photos.
