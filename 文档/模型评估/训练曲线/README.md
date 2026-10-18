# 精选训练图表

本目录从 `runs/` 的多次训练输出中挑选了三组代表性结果，便于在 GitHub 上直接查看训练过程，而无需携带 208 MB 的完整 `runs/` 目录。

| 目录 | 阶段 | 说明 |
| --- | --- | --- |
| `01_基线_yolov8n_full` | 基线 | 50 epoch，mAP50 91.28% |
| `02_误报抑制_v3_fp` | 误报抑制 | 加入 269 张负样本，mAP50 91.86%，负样本误报率 0.74% |
| `03_最终_v32_hardneg` | 最终 v4 来源 | 打印场景 + 难负样本迭代，交付模型 `v4.0_for_preview` 由此产出 |

每组包含：

- `results.png`：训练损失与验证指标曲线
- `confusion_matrix.png` / `confusion_matrix_normalized.png`：混淆矩阵
- `BoxPR_curve.png`、`BoxF1_curve.png`、`BoxP_curve.png`、`BoxR_curve.png`：PR / F1 / P / R 曲线
- `labels.jpg`：标签与目标框分布
- `results.csv`：逐 epoch 指标
- `args.yaml`：训练参数（本地路径已替换为 `<PROJECT_ROOT>`）

完整训练输出仍保留在本地归档的 `runs/` 中，未上传 GitHub。
