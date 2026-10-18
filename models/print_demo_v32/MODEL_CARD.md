# print_demo_v32

Purpose: judge-demo model for camera-based recognition of printed or phone-displayed fire/smoke images.

Lineage:
- Started from `models/print_demo_v31/best.pt`.
- Added material from `强化1/train_material_20260711_075452_fd0e`.
- Added hard-negative mining from `新的错误样本` after the first v3.2 pass.

Training outputs:
- Main pass: `runs/detect/runs/detect/runs/fasdd_uav_yolov8n_v32_print_demo`
- Continued pass: `runs/detect/runs/detect/runs/fasdd_uav_yolov8n_v32_print_demo_finish`
- Final hard-negative pass: `runs/detect/runs/detect/runs/fasdd_uav_yolov8n_v32_print_demo_hardneg`

Final validation:
- Precision: 0.882
- Recall: 0.864
- mAP50: 0.918
- mAP50-95: 0.669

Focused checks at `conf=0.25`:
- New v3.2 printed/phone positive samples: 25/25 detected.
- New v3.2 negatives: 0/12 false positives.
- Previous v3.1 printed/phone positives: 4/4 detected.
- Previous v3.1 negatives: 0/4 false positives.
- Old false-positive sample pool: 2/322 false positives.

Notes:
- This version is intended for demonstration where the fire/smoke image must be shown through the camera.
- Keep `models/real_scene_v3_no_print_phone_fp` as the better real-scene conservative model when printed or phone-displayed images should not trigger detection.
