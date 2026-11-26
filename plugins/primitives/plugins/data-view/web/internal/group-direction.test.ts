import { describe, expect, it } from "bun:test";
import { groupDirection } from "./group-direction";

describe("groupDirection", () => {
  const byDate = { orderBy: [["date", "desc"]] as const, column: "date" };

  it("follows the view's own sort on the grouped field", () => {
    expect(
      groupDirection([{ fieldId: "date", direction: "asc" }], "date", byDate),
    ).toBe("asc");
  });

  it("with no sort, reads the collection's default order on its column", () => {
    expect(groupDirection([], "date", byDate)).toBe("desc");
  });

  it("is ascending otherwise", () => {
    expect(groupDirection([], "date", undefined)).toBe("asc");
    expect(
      groupDirection([{ fieldId: "other", direction: "desc" }], "date", byDate),
    ).toBe("asc");
  });
});
