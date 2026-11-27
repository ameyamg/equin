import { expect, test } from "bun:test";
import { decodeEncodedWords, parseAddressList, parseMailbox } from "./headers";

test("RFC 2047: B and Q words, adjacent words joined, unknown charset kept", () => {
  expect(decodeEncodedWords("=?UTF-8?B?Q2Fmw6k=?= ouvert")).toBe("Café ouvert");
  expect(decodeEncodedWords("=?ISO-8859-1?Q?Caf=E9_ouvert?=")).toBe(
    "Café ouvert",
  );
  expect(decodeEncodedWords("=?UTF-8?Q?a?= =?UTF-8?Q?b?=")).toBe("ab");
  expect(decodeEncodedWords("=?x-nope?Q?a?=")).toBe("=?x-nope?Q?a?=");
  expect(decodeEncodedWords("plain")).toBe("plain");
  // "é" (C3 A9) split across two words.
  expect(decodeEncodedWords("=?UTF-8?B?Q2Fmww==?= =?UTF-8?B?qQ==?=!")).toBe(
    "Café!",
  );
  expect(decodeEncodedWords("Re: =?UTF-8?Q?a?= and =?UTF-8?Q?b?=")).toBe(
    "Re: a and b",
  );
});

test("mailboxes and address lists", () => {
  expect(parseMailbox('"Doe, Ana" <ana@x.test>')).toEqual({
    name: "Doe, Ana",
    address: "ana@x.test",
  });
  expect(parseMailbox("bo@x.test")).toEqual({
    name: null,
    address: "bo@x.test",
  });
  expect(parseMailbox("bo@x.test (Bo)")).toEqual({
    name: "Bo",
    address: "bo@x.test",
  });
  expect(parseMailbox("=?UTF-8?B?w4lsaWU=?= <e@x.test>")).toEqual({
    name: "Élie",
    address: "e@x.test",
  });
  expect(parseAddressList('"Doe, Ana" <ana@x.test>, bo@x.test')).toHaveLength(
    2,
  );
  expect(parseAddressList("undisclosed-recipients:;")).toEqual([]);
  expect(
    parseAddressList("team: a@x.test, b@x.test;").map((p) => p.address),
  ).toEqual(["a@x.test", "b@x.test"]);
  expect(parseAddressList(null)).toEqual([]);
});
