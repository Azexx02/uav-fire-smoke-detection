# FASDD_UAV YOLO Training Plan

## Goal
Train a YOLO fire/smoke detector using `FASDD_UAV` for the forest fire UAV inspection project.

## Phases
1. Inspect dataset structure and annotation format - complete
2. Convert/split dataset into YOLO format - complete
3. Verify labels and image/annotation consistency - complete
4. Check/install training environment - complete
5. Start training and capture outputs - complete
6. Fine-tune with false positive samples - complete
7. Continue false-positive reduction with `新的错误样本` - complete

## Decisions
- Prefer two model classes for training: `fire` and `smoke`.
- Treat `suspected_fire` as application logic rather than a direct training class unless the dataset has consistent labels for it.
- For false-positive reduction, use original negative frames as empty-label images; avoid training on annotated `det_*.jpg` overlays unless explicitly needed for evaluation only.
- User confirmed remaining `det_*.jpg` files in `新的错误样本\**\negative` do not contain visible boxes, so all unique `negative` images were used as empty-label false-positive samples.

## Errors Encountered
- Current `fasdd_uav.yaml` points to `FASDD_UAV`, but the present dataset directory is `FASDD_UAV (3)`. Continuing training requires a corrected YAML or reconstructed standard dataset directory.
- Initial fine-tune command timed out after 20 minutes during epoch 7/20; resumed from `last.pt` and completed successfully.
