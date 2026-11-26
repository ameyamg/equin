import { describe, expect, test } from "bun:test";
import { createBootHold, releasedHold } from "./boot-hold";

describe("createBootHold", () => {
  test("during the boot a hearing only marks the agent, once", () => {
    const ran: string[] = [];
    const hold = createBootHold((id) => ran.push(id));
    hold.heard("a");
    hold.heard("a");
    hold.heard("b");
    expect(ran).toEqual([]);
    expect(hold.pending()).toEqual(["a", "b"]);
  });

  test("a claimed agent is not caught up again unless heard after its claim", () => {
    const ran: string[] = [];
    const hold = createBootHold((id) => ran.push(id));
    hold.heard("a");
    hold.heard("b");
    hold.claim("a");
    hold.claim("b");
    hold.heard("b"); // appended while the pass ran it
    hold.release();
    expect(ran).toEqual(["b"]);
  });

  test("after release, hearings go straight through", () => {
    const ran: string[] = [];
    const hold = createBootHold((id) => ran.push(id));
    hold.release();
    hold.heard("a");
    hold.claim("a");
    expect(ran).toEqual(["a"]);
    expect(hold.pending()).toEqual([]);
  });

  test("releasedHold passes every hearing through", () => {
    const ran: string[] = [];
    releasedHold((id) => ran.push(id)).heard("x");
    expect(ran).toEqual(["x"]);
  });
});
