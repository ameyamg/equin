import { describe, expect, it } from "bun:test";
import { MB, planUploads } from "./upload-plan";

const img = (filename: string, mb: number) => ({
  filename,
  mime: "image/png",
  size: mb * MB,
});
const vid = (filename: string, mb: number) => ({
  filename,
  mime: "video/mp4",
  size: mb * MB,
});

describe("planUploads", () => {
  const limit = 10 * MB;

  it("sends everything as it is when it fits", () => {
    expect(planUploads([img("a", 2), vid("b", 5)], limit, 0)).toEqual({
      kind: "plan",
      steps: [
        { index: 0, action: "send" },
        { index: 1, action: "send" },
      ],
    });
  });

  it("re-encodes a lone video over the limit to what is left", () => {
    expect(planUploads([vid("b", 40)], limit, 1 * MB)).toEqual({
      kind: "plan",
      steps: [{ index: 0, action: "transcode", budgetBytes: 9 * MB }],
    });
  });

  it("refuses an image over the limit, naming its size and the limit", () => {
    const plan = planUploads([img("huge.png", 12), vid("b", 1)], limit, 0);
    expect(plan.kind).toBe("refused");
    expect(plan.kind === "refused" && plan.message).toContain(
      "huge.png 12.0 MB",
    );
    expect(plan.kind === "refused" && plan.message).toContain("10.0 MB");
  });

  it("refuses files that fit alone but not together when none is a video", () => {
    const plan = planUploads([img("a.png", 6), img("b.png", 6)], limit, 0);
    expect(plan.kind).toBe("refused");
    expect(plan.kind === "refused" && plan.message).toContain(
      "a.png 6.0 MB, b.png 6.0 MB",
    );
  });

  it("gives the videos what the images leave: small ones kept, the rest an equal share", () => {
    // 10 MB: an image of 2 → 8 left for three videos. The 1 MB one fits its
    // share (2.67) and is kept; 7 left for the two big ones: 3.5 each.
    const plan = planUploads(
      [vid("big", 30), img("shot", 2), vid("small", 1), vid("bigger", 50)],
      limit,
      0,
    );
    expect(plan).toEqual({
      kind: "plan",
      steps: [
        { index: 0, action: "transcode", budgetBytes: 3.5 * MB },
        { index: 1, action: "send" },
        { index: 2, action: "send" },
        { index: 3, action: "transcode", budgetBytes: 3.5 * MB },
      ],
    });
  });

  it("refuses when the images leave no room for the videos", () => {
    const plan = planUploads(
      [img("a.png", 5), img("b.png", 5), vid("v.mp4", 3)],
      limit,
      1,
    );
    expect(plan.kind).toBe("refused");
    expect(plan.kind === "refused" && plan.message).toContain("v.mp4 3.0 MB");
  });

  it("never plans more than the budget in total", () => {
    const files = [vid("a", 11), vid("b", 4), img("c", 1), vid("d", 7)];
    const plan = planUploads(files, limit, 512 * 1024);
    if (plan.kind !== "plan") throw new Error("expected a plan");
    const total = plan.steps.reduce(
      (n, s) =>
        n + (s.action === "send" ? (files[s.index]?.size ?? 0) : s.budgetBytes),
      0,
    );
    expect(total).toBeLessThanOrEqual(limit - 512 * 1024);
  });
});
