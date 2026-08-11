#!/usr/bin/env python3
"""Forbid parallel ontology model trees outside 01_semantic_knowledge/01_ontology.

Machine-readable ontology YAML truth lives only under
01_semantic_knowledge/01_ontology/{models,platform_registry.yaml,meta_schema.yaml}.
No second ontology models/ tree may exist elsewhere in the repo.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

TRUTH_MODELS = ROOT / "01_semantic_knowledge" / "01_ontology" / "models"
TRUTH_REGISTRY = ROOT / "01_semantic_knowledge" / "01_ontology" / "platform_registry.yaml"
TRUTH_META = ROOT / "01_semantic_knowledge" / "01_ontology" / "meta_schema.yaml"

# Directories that may contain YAML named like ontology models without being a parallel tree
ALLOW_SCAN_SKIP = {
    ".git",
    "node_modules",
    ".next",
    "__pycache__",
    ".venv",
    "04_context_state",  # run artifacts / packs may embed copies
    "05_control_evaluation/05_evals",  # eval fixtures
    "legacy",  # historical files are not active ontology models
}


def _skipped(path: Path) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    for prefix in ALLOW_SCAN_SKIP:
        if rel == prefix or rel.startswith(prefix + "/"):
            return True
    return False


def main() -> int:
    errors: list[str] = []

    if not TRUTH_MODELS.is_dir():
        errors.append("missing semantic model truth dir: 01_semantic_knowledge/01_ontology/models")
    if not TRUTH_REGISTRY.is_file():
        errors.append("missing 01_semantic_knowledge/01_ontology/platform_registry.yaml")
    if not TRUTH_META.is_file():
        errors.append("missing 01_semantic_knowledge/01_ontology/meta_schema.yaml")

    # Forbid any other **/models/*.yaml that sits under a sibling ontology tree
    # Heuristic: path contains "/models/" and a sibling model_registry.yaml nearby,
    # or path is **/01_ontology/models or **/ontology/**/models outside truth.
    for models_dir in ROOT.rglob("models"):
        if not models_dir.is_dir():
            continue
        if _skipped(models_dir):
            continue
        try:
            rel = models_dir.relative_to(ROOT).as_posix()
        except ValueError:
            continue
        if rel == "01_semantic_knowledge/01_ontology/models":
            continue
        # Parallel ontology models: parent named ontology / 01_ontology / 01_通用
        parent_name = models_dir.parent.name
        if parent_name in {"01_ontology", "ontology", "01_通用"} or "ontology" in rel.split("/"):
            yamls = list(models_dir.glob("*.yaml"))
            if yamls:
                errors.append(
                    f"forbidden parallel ontology models tree: {rel} "
                    f"({len(yamls)} yaml files); write only under 01_semantic_knowledge/01_ontology/models"
                )

    if errors:
        print("SEMANTIC_ONTOLOGY_DOUBLE_WRITE: FAIL")
        for item in errors:
            print(f"  - {item}")
        return 1
    print("SEMANTIC_ONTOLOGY_DOUBLE_WRITE: PASS")
    print("  ontology models may only live under 01_semantic_knowledge/01_ontology/models")
    return 0


if __name__ == "__main__":
    sys.exit(main())
