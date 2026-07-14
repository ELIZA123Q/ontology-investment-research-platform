#!/usr/bin/env python3
"""Freeze transparent structured source packets and update snapshot hashes.

This helper does not download or reproduce the original source. It creates a
structured evidence packet from already recorded source metadata and claims.
When original bytes are available, place that file inside the snapshot and set
``raw_artifact_ref`` to it instead of using this fallback helper.
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "运行校验"))
from _path_setup import ensure_run_path  # noqa: E402

ensure_run_path()

from validator_utils import file_sha256, split_refs  # noqa: E402


CAPTURE_SCHEMA_VERSION = "1.1.0"
CAPTURE_KIND = "structured_evidence_packet"


def _read_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), [dict(row) for row in reader]


def _write_rows(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def freeze(snapshot_dir: Path) -> int:
    asset_dir = snapshot_dir / "02_assets"
    snapshot_path = asset_dir / "source_snapshot.csv"
    source_fields, source_rows = _read_rows(snapshot_path)
    _, document_rows = _read_rows(asset_dir / "source_documents.csv")
    _, claim_rows = _read_rows(asset_dir / "evidence_claims.csv")
    _, record_rows = _read_rows(asset_dir / "evidence_records.csv")
    capture_dir = asset_dir / "source_captures"
    capture_dir.mkdir(exist_ok=True)

    for source_row in source_rows:
        source_run_id = source_row["source_run_id"]
        source_id = source_row["source_id"]
        payload = {
            "capture_schema_version": CAPTURE_SCHEMA_VERSION,
            "capture_kind": CAPTURE_KIND,
            "raw_content_included": False,
            "disclosure": "本文件是结构化取证记录包，不是原始网页、PDF、接口响应或数据库导出。",
            "source_locator": source_row.get("source_locator", ""),
            "source_snapshot": {
                key: value
                for key, value in source_row.items()
                if key not in {"raw_artifact_ref", "content_hash"}
            },
            "source_documents": [row for row in document_rows if row.get("source_id") == source_id],
            "evidence_claims": [
                row for row in claim_rows if source_run_id in split_refs(row.get("source_run_refs"))
            ],
            "evidence_records": [
                row for row in record_rows if source_run_id in split_refs(row.get("source_run_id"))
            ],
        }
        capture_path = capture_dir / f"{source_run_id}.json"
        capture_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        source_row["raw_artifact_ref"] = f"02_assets/source_captures/{capture_path.name}"
        source_row["content_hash"] = file_sha256(capture_path)

    _write_rows(snapshot_path, source_fields, source_rows)
    print(f"FROZEN_STRUCTURED_SOURCE_PACKETS: {snapshot_dir} ({len(source_rows)} sources)")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: freeze_source_captures.py <03快照目录>")
        return 2
    return freeze(Path(argv[1]).resolve())


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
