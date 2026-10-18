from __future__ import annotations

import hashlib
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / "数据集" / "FASDD_UAV"
MATERIAL = ROOT / "训练" / "素材" / "强化样本" / "train_material_20260711_075452_fd0e"
BASE_TRAIN = DATASET / "train_v31_print_demo.txt"
OUT_DIR = DATASET / "v32_print_demo"
OUT_IMAGES = OUT_DIR / "images"
OUT_LABELS = OUT_DIR / "labels"
TRAIN_OUT = DATASET / "train_v32_print_demo.txt"
YAML_OUT = ROOT / "训练" / "配置" / "fasdd_uav_v32_print_demo.yaml"

POS_REPEAT = 8
NEG_REPEAT = 4


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


def validate_label(label_path: Path) -> None:
    for line_no, line in enumerate(label_path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) != 5:
            raise ValueError(f"{label_path}:{line_no} expected 5 fields, got {len(parts)}")
        cls = int(float(parts[0]))
        vals = [float(x) for x in parts[1:]]
        if cls not in (0, 1):
            raise ValueError(f"{label_path}:{line_no} invalid class {cls}")
        if any(v < 0 or v > 1 for v in vals):
            raise ValueError(f"{label_path}:{line_no} coordinate out of range: {vals}")
        if vals[2] <= 0 or vals[3] <= 0:
            raise ValueError(f"{label_path}:{line_no} non-positive box size: {vals}")


def find_annotation_dir() -> Path:
    reinforce = MATERIAL / "reinforce"
    candidates = [
        path
        for path in reinforce.iterdir()
        if path.is_dir() and (path / "obj.names").exists() and (path / "obj_train_data").is_dir()
    ]
    if len(candidates) != 1:
        raise RuntimeError(f"Expected exactly one CVAT YOLO export dir under {reinforce}, got {candidates}")
    return candidates[0]


def main() -> None:
    if not BASE_TRAIN.exists():
        raise FileNotFoundError(f"Missing base train list: {BASE_TRAIN}")
    if not MATERIAL.exists():
        raise FileNotFoundError(f"Training materials are not included in this archive: {MATERIAL}")

    ann_dir = find_annotation_dir()
    names = (ann_dir / "obj.names").read_text(encoding="utf-8").splitlines()
    if [x.strip() for x in names if x.strip()] != ["fire", "smoke"]:
        raise ValueError(f"Unexpected class order in obj.names: {names}")

    OUT_IMAGES.mkdir(parents=True, exist_ok=True)
    OUT_LABELS.mkdir(parents=True, exist_ok=True)

    new_lines: list[str] = []
    positive_count = 0
    box_count = 0
    for label in sorted((ann_dir / "obj_train_data").glob("*.txt")):
        validate_label(label)
        image = MATERIAL / "reinforce" / f"{label.stem}.jpg"
        if not image.exists():
            raise FileNotFoundError(f"Missing image for label: {image}")
        dst_img = OUT_IMAGES / safe_name(image, "v32pos")
        dst_label = OUT_LABELS / f"{dst_img.stem}.txt"
        shutil.copy2(image, dst_img)
        shutil.copy2(label, dst_label)
        boxes = [line for line in label.read_text(encoding="utf-8").splitlines() if line.strip()]
        box_count += len(boxes)
        new_lines.extend([rel(dst_img)] * POS_REPEAT)
        positive_count += 1

    negative_count = 0
    seen_neg: set[str] = set()
    for image in sorted((MATERIAL / "negative").glob("*.jpg")):
        digest = sha1(image)
        if digest in seen_neg:
            continue
        seen_neg.add(digest)
        dst_img = OUT_IMAGES / safe_name(image, "v32neg")
        dst_label = OUT_LABELS / f"{dst_img.stem}.txt"
        shutil.copy2(image, dst_img)
        dst_label.write_text("", encoding="utf-8")
        new_lines.extend([rel(dst_img)] * NEG_REPEAT)
        negative_count += 1

    base_lines = [line.strip() for line in BASE_TRAIN.read_text(encoding="utf-8").splitlines() if line.strip()]
    TRAIN_OUT.write_text("\n".join(base_lines + new_lines) + "\n", encoding="utf-8")
    YAML_OUT.write_text(
        "\n".join(
            [
                f"path: ../../数据集/FASDD_UAV",
                "train: train_v32_print_demo.txt",
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

    print(f"annotation_dir={ann_dir}")
    print(f"base_train={len(base_lines)}")
    print(f"positive_images={positive_count} boxes={box_count} repeat={POS_REPEAT} added_lines={positive_count * POS_REPEAT}")
    print(f"negative_images={negative_count} repeat={NEG_REPEAT} added_lines={negative_count * NEG_REPEAT}")
    print(f"total_train_lines={len(base_lines) + len(new_lines)}")
    print(f"train={TRAIN_OUT}")
    print(f"yaml={YAML_OUT}")


if __name__ == "__main__":
    main()
