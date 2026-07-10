#!/usr/bin/env python3
"""Validate 05 publishable deliverables against the theme-deep-research template contract."""

from __future__ import annotations

import re
import sys
from pathlib import Path

from validator_utils import error_payload, fail, ok_payload, parse_triplet, read_text, require_body_sections


KNOWN_DELIVERY_KINDS = {
    "主题深度研究",
}

REQUIRED_HEADER_FIELDS = [
    "判断时点",
    "前瞻窗口",
    "研究对象",
    "事件口径",
]

REQUIRED_SECTIONS = [
    "一页摘要",
    "核心观点",
    "为什么现在研究这个主题",
    "空间测算",
    "产业链拆解",
    "竞争格局与壁垒",
    "演进路径",
    "图表与关键数据",
    "关键跟踪指标",
    "风险提示",
    "主要资料来源",
]

FORBIDDEN_BODY_TERMS = [
    "证据门禁",
    "包级准入",
    "allowed_04_output",
    "judgment_unit",
    "state_variable",
    "path_readiness",
    "manifest.csv",
    "推理审计",
    "本体视图",
    "倾向判断：",
    "条件判断：",
    "已确认：",
    "暂不可判断：",
    "判断单元",
    "状态变量",
    "路径节点",
]

DISCLAIMER_MARKERS = ("不构成", "证券评级", "交易操作")


def _validate_body(path: Path, body: str) -> None:
    for field in REQUIRED_HEADER_FIELDS:
        if field not in body.split("##", 1)[0]:
            fail(f"{path} 文首必须说明 {field}")
    require_body_sections(body, REQUIRED_SECTIONS, str(path))
    if not any(marker in body for marker in DISCLAIMER_MARKERS):
        fail(f"{path} 文末必须包含合规声明（不构成证券评级/收益承诺/交易操作建议）")
    for term in FORBIDDEN_BODY_TERMS:
        if term in body:
            fail(f"05 正文不得包含系统术语: {term}")
    forbidden = ["目标价", "买入评级", "卖出评级", "仓位建议", "收益率预测"]
    for marker in forbidden:
        for match in re.finditer(re.escape(marker), body):
            context = body[max(0, match.start() - 30) : match.end() + 12]
            if "不构成" in context or "不得" in context or "不输出" in context:
                continue
            fail(f"05 正文不得包含投资建议或评级用语: {marker}")


def validate(path: str | Path, delivery_kind: str) -> dict[str, object]:
    path = Path(path)
    if delivery_kind not in KNOWN_DELIVERY_KINDS:
        fail(f"未知 05 交付形态: {delivery_kind}")
    topic, date, seq = parse_triplet(path, delivery_kind, stage="05")
    body = read_text(path)
    if body.startswith("---"):
        fail(f"{path} 05 交付物不使用 YAML front matter，正文应从标题开始")
    _validate_body(path, body)
    return {
        "schema_version": "1.0.0",
        "delivery_kind": delivery_kind,
        "topic": topic,
        "date": date,
        "seq": seq,
        "path": str(path),
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: validate_05_outputs.py <05交付文件.md> <交付形态>")
        return 2
    try:
        print(ok_payload(**validate(argv[1], argv[2])))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
