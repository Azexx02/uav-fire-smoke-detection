from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / "数据集" / "FASDD_UAV"
BASE_TRAIN = DATASET / "train_v32_print_demo.txt"
SOURCE_DIR = ROOT / "训练" / "素材" / "错误样本"
MODEL_PATH = ROOT / "runs" / "detect" / "runs" / "detect" / "runs" / "fasdd_uav_yolov8n_v32_print_demo_finish" / "weights" / "best.pt"
OUT_DIR = DATASET / "v32_hard_negatives"
OUT_IMAGES = OUT_DIR / "images"
OUT_LABELS = OUT_DIR / "labels"
TRAIN_OUT = DATASET / "train_v32_print_demo_hardneg.txt"
YAML_OUT = ROOT / "训练" / "配置" / "fasdd_uav_v32_print_demo_hardneg.yaml"

NEG_REPEAT = 24
CONF = 0.25


def sha1(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_name(path: Path, prefix: str) -> str:
    digest = sha1(path)[:12]
    stem = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in path.stem)
    return f"{prefix}_{digest}_{stem}{path.suffix.lower()}"


def rel(path: Path) -> str:
    return "./" + path.relative_to(DATASET).as_posix()


def source_images() -> list[Path]:
    exts = {".jpg", ".jpeg", ".png", ".bmp"}
    return sorted(
        p for p in SOURCE_DIR.rglob("*") if p.suffix.lower() in exts and "label_preview" not in p.name.lower()
    )


def main() -> None:
    if not BASE_TRAIN.exists():
        raise FileNotFoundError(f"Missing base train list: {BASE_TRAIN}")
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Missing mining model: {MODEL_PATH}")

    OUT_IMAGES.mkdir(parents=True, exist_ok=True)
    OUT_LABELS.mkdir(parents=True, exist_ok=True)

    model = YOLO(str(MODEL_PATH))
    hard_lines: list[str] = []
    hard_count = 0
    for image in source_images():
        result = model.predict(str(image), conf=CONF, imgsz=640, device=0, verbose=False)[0]
        if not len(result.boxes):
            continue
        dst_img = OUT_IMAGES / safe_name(image, "hardneg")
        dst_label = OUT_LABELS / f"{dst_img.stem}.txt"
        shutil.copy2(image, dst_img)
        dst_label.write_text("", encoding="utf-8")
        hard_lines.extend([rel(dst_img)] * NEG_REPEAT)
        hard_count += 1

    base_lines = [line.strip() for line in BASE_TRAIN.read_text(encoding="utf-8").splitlines() if line.strip()]
    TRAIN_OUT.write_text("\n".join(base_lines + hard_lines) + "\n", encoding="utf-8")
    YAML_OUT.write_text(
        "\n".join(
            [
                f"path: ../../数据集/FASDD_UAV",
                "train: train_v32_print_demo_hardneg.txt",
                "val: val.txt",
                "test: test.txt",
                "",
                "names:",
                "  0: fire",
                "  1: smoke",
                "",
            ]
        ),
        encoding="utf-8",
    )

    print(f"source_images={len(source_images())}")
    print(f"hard_negative_images={hard_count} repeat={NEG_REPEAT} added_lines={hard_count * NEG_REPEAT}")
    print(f"total_train_lines={len(base_lines) + len(hard_lines)}")
    print(f"train={TRAIN_OUT}")
    print(f"yaml={YAML_OUT}")


if __name__ == "__main__":
    main()
