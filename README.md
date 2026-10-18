# 林焰智巡 · 森林火灾巡检无人机 AI 视觉应用

> 项目归档版　|　归档日期：2026-10-18　|　运行模型：`v4.0_for_preview`

## 1. 项目简介

“林焰智巡”是面向森林火灾巡检场景的离线火/烟智能检测系统。系统以 YOLOv8n 为检测核心，支持图片、视频与无人机/摄像头实时流检测，并提供专家评审、评分统计、历史记录、数据集归档与模型报告等页面；模型可导出 ONNX / RKNN，部署到 RK3588 开发板运行。

主要能力：

- **实时检测**：图片、视频、MJPEG 摄像头流，识别 `fire`（火焰）与 `smoke`（烟雾）。
- **专家评审闭环**：对误检/漏检结果进行人工判定，自动归档负样本与强化样本。
- **评分与报告**：按图片计分、导出 CSV，生成检测报告与模型性能报告。
- **端侧部署**：PyTorch → ONNX → RKNN（FP / INT8），适配 RK3588 NPU。

## 2. 核心指标

| 指标 | 数值 |
| --- | ---: |
| Precision | 0.882 |
| Recall | 0.864 |
| mAP50 | 0.918 |
| mAP50-95 | 0.669 |
| 旧误报样本池误报 | 2 / 322（0.62%） |
| RK3588 FP RKNN 推理 | 约 42 ms/帧（1280×720 输入） |

> 指标来自 `v4.0_for_preview` 验证集评估，详见 [v4 性能报告](文档/模型评估/Markdown/v4_performance_report.md) 与 [PDF 版](文档/模型评估/PDF/v4_model_performance_report_final.pdf)。

## 3. 目录结构

```
ruicom/
├── app/                        FastAPI 后端（API、检测器、摄像头、历史、评分）
├── frontend/                   前端页面（index / demo / dataset / history / scoring / report）
├── models/                     模型文件（v4.0_for_preview 为当前运行版本）
├── runs/                       本地训练与评估输出（不纳入 GitHub，精选图表见文档目录）
├── 训练/
│   ├── 配置/                   5 个 Ultralytics 数据 YAML
│   ├── 脚本/                   4 个训练数据准备脚本（路径已适配归档结构）
│   └── 预训练权重/             yolo26n.pt、yolov8n.pt
├── 文档/
│   ├── 作品报告与规则/         参赛作品报告、比赛规则
│   ├── 模型评估/               Markdown / Word / PDF 报告、评估图表与精选训练曲线
│   └── 过程记录/               progress、findings、task_plan、future_ideas
├── 部署/
│   ├── 离线依赖/               56 个 aarch64 Linux wheel（RK3588 离线安装）
│   ├── RKNN模型/               best.rknn（历史部署模型）
│   └── RKNN量化校准/           calibrate_100.zip（INT8 量化校准集）
├── 数据集/                     数据集说明（数据集本体不随归档提供）
├── 历史归档/                   早期“系统源码与模型审计版”压缩包
├── 工具脚本/                   报告 DOCX / PDF 生成脚本
├── README.md                   本文件
└── 归档清单.md                 文件统计、SHA256 与清理记录
```

> `训练/素材/`（错误样本、强化样本、2026-07-11 采集素材）已由项目作者删除，不在归档中；因此 v31/v32 两轮增强训练无法直接复现，脚本会给出明确提示。

## 4. 快速开始

### 4.1 环境

- Python 3.10+（本次归档在 Python 3.12.10 下验证）
- Windows / Linux 均可运行；RK3588 板端需额外安装 `rknnlite`
- 依赖：`fastapi`、`uvicorn`、`ultralytics`、`opencv-python`、`numpy`、`python-multipart`

```powershell
python -m pip install fastapi uvicorn ultralytics opencv-python python-multipart
```

`部署/离线依赖/` 中的 wheel 为 **aarch64 Linux** 版本，供 RK3588 离线安装，不适用于 Windows。

### 4.2 启动

```powershell
# 在项目根目录执行
python -m app.main
```

访问 `http://127.0.0.1:8000`。健康检查：`GET /api/health`，返回 `model_loaded: true` 即表示模型加载成功。

> 启动时会自动重建 `app/static/results`、`uploads`、`thumbnails`、`videos` 与 `app/static/dataset` 等运行目录，这些目录不纳入归档。

### 4.3 模型与摄像头

- 运行模型由 `app/config.py` 的 `MODEL_PATH` 指定，当前为 `models/v4.0_for_preview/best.pt`。
- 摄像头采集参数位于 `app/data/camera_settings.json`；摄像头设备索引在 `app/api/camera.py` 中按 `downward` / `forward` 配置。
- 板端如使用 RKNN，可将 `MODEL_PATH` 指向 `.rknn` 文件，检测器会自动切换后端。

## 5. 数据集与训练

### 5.1 数据集

本项目使用武汉大学 FASDD 数据集的无人机子集（`FASDD_UAV`），共 25,097 张图像，类别为 `0=fire`、`1=smoke`；YOLO 切分为 train 12,551 / val 8,365 / test 4,181，标注目标 53,530 个。数据集不随仓库分发。

> 数据来源：Ming Wang, Peng Yue, Liangcun Jiang, Dayu Yu, Tianyu Tuo, Jian Li. *An open flame and smoke detection dataset for deep learning in remote sensing based fire detection*. Geo-spatial Information Science, 2025, 28(2): 511–526. DOI: [10.1080/10095020.2024.2347922](https://doi.org/10.1080/10095020.2024.2347922)；数据集 DOI: [10.57760/sciencedb.j00104.00103](https://doi.org/10.57760/sciencedb.j00104.00103)。获取与重建步骤见 [数据说明](数据集/数据说明.md)。

### 5.2 训练脚本顺序

准备好数据集后，在项目根目录依次执行：

```powershell
python 训练/脚本/prepare_false_positive_training.py   # 重建 labels/、train/val/test 与误报负样本
python 训练/脚本/prepare_v31_print_demo_training.py   # v31 打印场景增强
python 训练/脚本/prepare_v32_print_demo_training.py   # v32 强化样本
python 训练/脚本/prepare_v32_hard_negative_training.py# v32 难负样本
```

脚本通过 `Path(__file__).resolve().parents[2]` 定位项目根目录，读写路径已同步到 `数据集/`、`训练/配置/`；YAML 中的 `path:` 使用相对路径，移动项目目录后无需修改。

### 5.3 训练结果

`runs/` 保留了从基线到 v4 的完整训练/评估输出，包括：

- `runs/detect/runs/fasdd_uav_yolov8n_full`：基线 50 epoch，mAP50 91.28%
- `runs/detect/runs/fasdd_uav_yolov8n_finetune`、`_v2`、`_v3_fp`：误报抑制迭代
- `runs/detect/runs/detect/runs/fasdd_uav_yolov8n_v31_print_demo`、`v32_print_demo`、`v32_print_demo_finish`、`v32_print_demo_hardneg`：打印场景与难负样本迭代
- `runs/detect/runs/test_negative_*`：负样本误报对比测试

最终交付模型位于 `models/v4.0_for_preview/`（`.pt` / `.onnx` / 两个 `.rknn`）。GitHub 版仅保留三组代表性训练图表（约 3.4 MB），见 [训练曲线说明](文档/模型评估/训练曲线/README.md)；完整 `runs/` 保留在本地归档。

## 6. 文档索引

| 文档 | 说明 |
| --- | --- |
| [作品报告](文档/作品报告与规则/林焰智巡_森林火灾巡检无人机AI视觉应用作品报告_new.docx) | 参赛作品报告 |
| [比赛规则](文档/作品报告与规则/比赛规则.pdf) | 赛事规则原文 |
| [v4 性能报告（Markdown）](文档/模型评估/Markdown/v4_performance_report.md) | 指标、补充测试与推理性能 |
| [v4 性能报告（PDF）](文档/模型评估/PDF/v4_model_performance_report_final.pdf) | 最终提交版 |
| [过程记录](文档/过程记录/progress.md) | 逐日进展与指标变化 |
| [Git 开发历史](文档/过程记录/git_history.md) | 重建仓库前导出的 19 条提交记录 |
| [训练曲线](文档/模型评估/训练曲线/README.md) | 基线 / 误报抑制 / 最终模型三组精选图表 |
| [后续设想](文档/过程记录/future_ideas.md) | 在线标注、增量学习、GIS 等 |

## 7. 归档说明

本项目于 **2026-10-18** 整理归档：源码保持可运行，文档、模型与部署资源分类存放，运行产物与数据集不纳入仓库，Git 重建为单次提交。完整统计与清理明细见 [归档清单.md](归档清单.md)。

