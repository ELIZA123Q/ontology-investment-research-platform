from __future__ import annotations

import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_only_adapter_imports_semantica() -> None:
    violations: list[str] = []
    for path in (ROOT / "src" / "ir_platform").rglob("*.py"):
        if path.as_posix().endswith("/adapters/semantica.py"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    continue
                modules = [node.module or ""]
            else:
                continue
            if any(module == "semantica" or module.startswith("semantica.") for module in modules):
                violations.append(str(path.relative_to(ROOT)))
    assert violations == []
