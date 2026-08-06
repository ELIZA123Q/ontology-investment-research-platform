#!/usr/bin/env python3
"""Forbid silent dual-write drift after ontology → semantic physical move.

Machine-readable ontology YAML truth lives under 01_semantic/01_ontology/.
If 90_compat/ontology/ still contains entity YAML/MD, it must be byte-identical
to the semantic truth (compat mirror only). Prefer deleting ontology entities
and keeping README.compat.md.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

MODEL_TRUTH = ROOT / "01_semantic/01_ontology/models"
MODEL_COMPAT = ROOT / "90_compat/ontology/01_通用/models"

LOCKED_PAIRS: list[tuple[str, str]] = [
    (
        "01_semantic/01_ontology/model_registry.yaml",
        "90_compat/ontology/01_通用/model_registry.yaml",
    ),
    (
        "01_semantic/01_ontology/meta_schema.yaml",
        "90_compat/ontology/01_通用/meta_schema.yaml",
    ),
]

DICTIONARY_PAIRS = [
    ("01_semantic/02_dictionary/00_投研本体框架概述.md", "90_compat/ontology/01_通用/00_投研本体框架概述.md"),
    ("01_semantic/02_dictionary/01_语义结构域规范.md", "90_compat/ontology/01_通用/01_语义结构域规范.md"),
    ("01_semantic/02_dictionary/02_判断推理域规范.md", "90_compat/ontology/01_通用/02_判断推理域规范.md"),
    ("01_semantic/02_dictionary/03_证据域规范.md", "90_compat/ontology/01_通用/03_证据域规范.md"),
]

DOMAIN_PAIRS = [
    (
        "01_semantic/01_ontology/domains/semiconductor/00_半导体领域本体概述.md",
        "90_compat/ontology/02_领域/semiconductor/00_半导体领域本体概述.md",
    ),
    (
        "01_semantic/01_ontology/domains/semiconductor/01_半导体语义结构域说明.md",
        "90_compat/ontology/02_领域/semiconductor/01_半导体语义结构域说明.md",
    ),
    (
        "01_semantic/01_ontology/domains/semiconductor/02_半导体判断推理域说明.md",
        "90_compat/ontology/02_领域/semiconductor/02_半导体判断推理域说明.md",
    ),
    (
        "01_semantic/01_ontology/domains/semiconductor/03_半导体证据域说明.md",
        "90_compat/ontology/02_领域/semiconductor/03_半导体证据域说明.md",
    ),
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_pair(truth_rel: str, mirror_rel: str, errors: list[str]) -> None:
    truth = ROOT / truth_rel
    mirror = ROOT / mirror_rel
    if not truth.is_file():
        errors.append(f"missing semantic truth: {truth_rel}")
        return
    if not mirror.is_file():
        return
    if sha256(truth) != sha256(mirror):
        errors.append(
            f"dual-write drift: {mirror_rel} differs from truth {truth_rel}; "
            "edit 01_semantic/01_ontology (or dictionary) only, then refresh/delete compat mirror"
        )


def main() -> int:
    errors: list[str] = []

    if not MODEL_TRUTH.is_dir():
        errors.append("missing semantic model truth dir: 01_semantic/01_ontology/models")

    for truth_rel, mirror_rel in LOCKED_PAIRS + DICTIONARY_PAIRS + DOMAIN_PAIRS:
        check_pair(truth_rel, mirror_rel, errors)

    if MODEL_COMPAT.is_dir():
        for mirror_file in sorted(MODEL_COMPAT.glob("*.yaml")):
            truth_file = MODEL_TRUTH / mirror_file.name
            if not truth_file.is_file():
                errors.append(
                    f"orphan ontology compat without semantic truth: "
                    f"90_compat/ontology/01_通用/models/{mirror_file.name}"
                )
                continue
            if sha256(truth_file) != sha256(mirror_file):
                errors.append(
                    f"dual-write drift: 90_compat/ontology/01_通用/models/{mirror_file.name} "
                    f"differs from 01_semantic/01_ontology/models/{mirror_file.name}"
                )

    if errors:
        print("SEMANTIC_ONTOLOGY_DOUBLE_WRITE: FAIL")
        for item in errors:
            print(f"  - {item}")
        return 1
    print("SEMANTIC_ONTOLOGY_DOUBLE_WRITE: PASS")
    print("  01_semantic/01_ontology is machine write truth; 90_compat/ontology mirrors must match or be absent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
