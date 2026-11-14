import { describe, expect, it } from "vitest";
import { RULES, changeRatio, hasLink, isInBangladesh } from "@/lib/incidents";

describe("Mamladibe SRS rules shared by the UI", () => {
  it("keeps the verified comment limits", () => {
    expect(RULES.commentsPerDay).toBe(5);
    expect(RULES.commentsPageSize).toBe(10);
    expect(RULES.commentMin).toBe(5);
    expect(RULES.commentMax).toBe(500);
  });

  it("rejects locations outside Bangladesh", () => {
    expect(isInBangladesh(23.78, 90.41)).toBe(true);
    expect(isInBangladesh(22.57, 87.36)).toBe(false);
    expect(isInBangladesh(28.6, 77.2)).toBe(false);
  });

  it("keeps the quick-edit window and change ratio", () => {
    expect(RULES.quickEditMinutes).toBe(15);
    expect(changeRatio("ফার্মগেটে সংঘর্ষ হয়েছে", "ফার্মগেটে সংঘর্ষ হয়েছে।")).toBeLessThanOrEqual(
      0.2,
    );
    expect(changeRatio("ফার্মগেটে সংঘর্ষ", "সম্পূর্ণ ভিন্ন একটি লেখা")).toBeGreaterThan(0.2);
  });

  it("detects links in comments before submission", () => {
    expect(hasLink("আরও তথ্য https://example.com")).toBe(true);
    expect(hasLink("আমি ঘটনাটি দেখেছি")).toBe(false);
  });
});
