from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / "数据集" / "FASDD_UAV"
SOURCE_YOLO = DATASET / "annotations" / "YOLO_UAV"
NEGATIVE_ROOT = ROOT / "训练" / "素材" / "错误样本"
FP_DIR = DATASET / "fp_negatives"
FP_IMAGES = FP_DIR / "images"
FP_LABELS = FP_DIR / "labels"
MANIFEST = FP_DIR / "manifest.json"
TRAIN_FP = DATASET / "train_fp.txt"
YAML_OUT = ROOT / "训练" / "配置" / "fasdd_uav_fp.yaml"


def sha1(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def rel_to_dataset(path: Path) -> str:
    return "./" + path.relative_to(DATASET).as_posix()


def main() -> None:
    if not DATASET.exists():
        raise FileNotFoundError(f"Dataset directory not found: {DATASET}")
    if not SOURCE_YOLO.exists():
        raise FileNotFoundError(f"YOLO annotation directory not found: {SOURCE_YOLO}")
    if not NEGATIVE_ROOT.exists():
        print(f"[warn] Negative sample directory not found: {NEGATIVE_ROOT}; skip false-positive samples.")

    # Ultralytics resolves labels by replacing /images/ with /labels/.
    root_labels = DATASET / "labels"
    root_labels.mkdir(exist_ok=True)
    copied_labels = 0
    for src in (SOURCE_YOLO / "labels").glob("*.txt"):
        dst = root_labels / src.name
        if not dst.exists() or dst.stat().st_size != src.stat().st_size:
            shutil.copy2(src, dst)
            copied_labels += 1

    for split in ("train.txt", "val.txt", "test.txt"):
        shutil.copy2(SOURCE_YOLO / split, DATASET / split)

    FP_IMAGES.mkdir(parents=True, exist_ok=True)
    FP_LABELS.mkdir(parents=True, exist_ok=True)

    candidates: list[Path] = []
    for negative_dir in NEGATIVE_ROOT.rglob("negative"):
        for path in negative_dir.iterdir():
            if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png"}:
                candidates.append(path)

    seen: dict[str, Path] = {}
    manifest: list[dict[str, str]] = []
    for src in sorted(candidates, key=lambda p: str(p).lower()):
        digest = sha1(src)
        if digest in seen:
            continue
        seen[digest] = src
        safe_stem = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in src.stem)
        dst = FP_IMAGES / f"fpneg_{digest[:12]}_{safe_stem}{src.suffix.lower()}"
        shutil.copy2(src, dst)
        (FP_LABELS / f"{dst.stem}.txt").write_text("", encoding="utf-8")
        manifest.append(
            {
                "sha1": digest,
                "source": str(src),
                "image": rel_to_dataset(dst),
                "label": rel_to_dataset(FP_LABELS / f"{dst.stem}.txt"),
            }
        )

    base_train = [
        line.strip()
        for line in (DATASET / "train.txt").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    fp_train = [item["image"] for item in manifest]
    TRAIN_FP.write_text("\n".join(base_train + fp_train) + "\n", encoding="utf-8")

    YAML_OUT.write_text(
        "\n".join(
            [
                f"path: ../../数据集/FASDD_UAV",
                "train: train_fp.txt",
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

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"dataset={DATASET}")
    print(f"base_train={len(base_train)}")
    print(f"negative_candidates={len(candidates)}")
    print(f"unique_negatives={len(manifest)}")
    print(f"copied_labels={copied_labels}")
    print(f"train_fp={TRAIN_FP}")
    print(f"yaml={YAML_OUT}")
    print(f"manifest={MANIFEST}")


if __name__ == "__main__":
    main()
