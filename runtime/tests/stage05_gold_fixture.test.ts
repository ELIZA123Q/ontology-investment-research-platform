import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  STAGE05_REQUIRED_FIXED_SECTIONS,
  collectStage05StructureIssues,
  countArgumentChapters,
  hasPublishableStage05Structure,
} from "@/engine/stage05_quality";

describe("7/13 Stage05 gold structure fixture", () => {
  it("reference industry cycle report contains required fixed sections and argument chapters", () => {
    const path = resolve(
      process.cwd(),
      "../7:13/05-存储芯片周期行业周期判断-20260713-1.md",
    );
    const body = readFileSync(path, "utf8");
    for (const section of STAGE05_REQUIRED_FIXED_SECTIONS) {
      expect(body, `missing ${section}`).toContain(`## ${section}`);
    }
    const chapters = countArgumentChapters(body);
    expect(chapters).toBeGreaterThanOrEqual(2);
    expect(chapters).toBeLessThanOrEqual(5);
    expect(hasPublishableStage05Structure(body)).toBe(true);
    const errors = collectStage05StructureIssues(body).filter((item) => item.severity === "error");
    expect(errors.map((item) => item.code)).not.toContain("missing_fixed_section");
    expect(errors.map((item) => item.code)).not.toContain("argument_chapter_count");
    expect(errors.map((item) => item.code)).not.toContain("inline_audit_details");
    expect(body).not.toContain("<details>");
    expect(body).not.toContain("审计索引");
    expect(body).not.toMatch(/J[0-4]\/(supported|indeterminate|blocked)/);
  });
});
