import { describe, expect, test } from "bun:test";
import { keyOwner } from "./paths";

const ID = "5ab235d4-8a1c-43fe-9de3-c1a3bdb5a18c";
const DIR = "/data/state/attachments";

describe("keyOwner", () => {
  test("a file at the dir's top level is main's", () => {
    expect(keyOwner(`${DIR}/${ID}.png`)).toBeNull();
  });

  test("a file under the legacy apps/attachments dir is main's", () => {
    expect(keyOwner(`/data/apps/attachments/${ID}.mp4`)).toBeNull();
  });

  test("a file under checkouts/<namespace>/ is that namespace's", () => {
    expect(keyOwner(`${DIR}/checkouts/equin.att-1/${ID}.png`)).toBe(
      "equin.att-1",
    );
  });

  test("only the direct parent counts: a deeper path is no checkout's file", () => {
    expect(keyOwner(`${DIR}/checkouts/a/b/${ID}.png`)).toBeNull();
  });
});
