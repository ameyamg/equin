import { expect, test } from "bun:test";
import { sendEndpointRequest } from "@plugins/infra/plugins/endpoints/core";
import { bootSnapshot } from "../../core";
import { HEAD_REQUEST_GLOBAL } from "../../shared/head-request";
import { bootSnapshotHeadScript, renderBootSnapshotHead } from "./head-request";
import { pageIssuerHeaders } from "@plugins/primitives/plugins/networking/core";

// The head script sends the boot task's request ahead of it, so the two must be
// the same request: the path the contract builds, a plain GET with no headers
// of its own — only the page's issuer mark, which the page transport the boot
// task sends through adds to every request.
test.each([
  ["no app", null],
  ["an app", "apps/plugins/mail/"],
])(
  "the head script sends the request the boot task would (%s)",
  async (_, app) => {
    let sent: { path: string; init: RequestInit } | undefined;
    await sendEndpointRequest(
      (path, init) => {
        sent = { path, init };
        return Promise.resolve(new Response(null, { status: 204 }));
      },
      bootSnapshot,
      {},
      { query: app === null ? {} : { app } },
    );
    expect(sent?.init.method).toBe("GET");
    expect(sent?.init.headers).toEqual({});
    const script = bootSnapshotHeadScript(app);
    expect(script).toContain(`app: ${JSON.stringify(app)}`);
    expect(script).toContain(
      `fetch(${JSON.stringify(sent?.path)}, { headers: ${JSON.stringify(pageIssuerHeaders())} })`,
    );
    expect(script).toContain(
      `globalThis[${JSON.stringify(HEAD_REQUEST_GLOBAL)}]`,
    );
    expect(script.startsWith(`<script type="module" async>`)).toBe(true);
  },
);

// Each app's pages ask for that app's snapshot (its plugin subtree), every
// other path for none — keyed like the app's module preloads.
test("each app path asks for its own app", () => {
  const head = renderBootSnapshotHead([
    { plugin: "apps.mail.shell", basePath: "/mail", launch: "tab" },
    { plugin: "apps.desktop.shell", basePath: "/desktop", launch: "surface" },
  ]);
  expect(Object.keys(head).sort()).toEqual([
    "",
    "/desktop",
    "/desktop/mail",
    "/mail",
  ]);
  expect(head["/mail"]).toContain("app=apps%2Fplugins%2Fmail%2F");
  expect(head["/desktop/mail"]).toBe(head["/mail"]);
  expect(head["/desktop"]).toContain("app=apps%2Fplugins%2Fdesktop%2F");
  expect(head[""]).not.toContain("app=");
});
