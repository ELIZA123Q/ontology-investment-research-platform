#!/usr/bin/env python3
"""compat shim: Ontology validate_v3 now lives under 01_semantic/01_ontology/."""
from pathlib import Path
import runpy
import sys
TARGET = Path(__file__).resolve().parents[3] / "01_semantic" / "01_ontology" / "validate_v3.py"
if not TARGET.is_file():
    raise SystemExit(f"missing semantic validate_v3: {TARGET}")
sys.argv[0] = str(TARGET)
runpy.run_path(str(TARGET), run_name="__main__")
