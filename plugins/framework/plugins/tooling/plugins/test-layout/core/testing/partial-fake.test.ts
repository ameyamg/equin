import { expect, test } from "bun:test";
import { partialFake } from "./partial-fake";

interface Contract {
  id: string;
  run(): number;
  subscribe(): () => void;
}

test("a faked member answers; an unfaked one throws naming the fake and the member", () => {
  const fake = partialFake<Contract>("Contract", {
    id: "x",
    run() {
      return 1;
    },
  });
  expect(fake.run()).toBe(1);
  expect(() => fake.subscribe()).toThrow("fake Contract has no `subscribe`");
});

test("probes read as absent: a fake is not a thenable and prints", async () => {
  const fake = partialFake<Contract>("Contract", { id: "x" });
  expect(await Promise.resolve(fake)).toBe(fake);
  expect(String(Symbol.iterator in fake)).toBe("false");
});
