import { describe, expect, test } from "bun:test";
import { messagePreview, remoteImageUrls, renderMailHtml } from "./render";
import { signMail, verifyMail } from "./sign";

const links = {
  image: (u: string) => `/p?u=${encodeURIComponent(u)}`,
  inline: (cid: string) => (cid === "logo@x" ? `/i/${cid}` : null),
};

describe("renderMailHtml", () => {
  test("remote images go through the proxy, cid: images through the part route", () => {
    const html = `<img src="https://t.example/a.png" srcset="https://t.example/a2.png 2x"><img src="cid:logo@x"><img src="cid:unknown"><img src="data:image/png;base64,AA"><img src="//cdn.example/b.gif"><img src="file:///etc/x">`;
    expect(renderMailHtml(html, links)).toBe(
      `<img src="/p?u=https%3A%2F%2Ft.example%2Fa.png" srcset=""><img src="/i/logo@x"><img src=""><img src="data:image/png;base64,AA"><img src="/p?u=https%3A%2F%2Fcdn.example%2Fb.gif"><img src="">`,
    );
  });

  test("backgrounds — attribute and inline style — are proxied too", () => {
    const html = `<td background="http://t.example/bg.jpg" style="background:url('https://t.example/c.png') no-repeat">x</td>`;
    expect(renderMailHtml(html, links)).toBe(
      `<td background="/p?u=http%3A%2F%2Ft.example%2Fbg.jpg" style="background:url(&quot;/p?u=https%3A%2F%2Ft.example%2Fc.png&quot;) no-repeat">x</td>`,
    );
  });

  test("links open a tab; a refresh, a stylesheet link and a base are cut", () => {
    const html = `<meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="https://t.example/s.css"><base href="https://evil.example/"><a href="https://ok.example">x</a><a href="#top">y</a>`;
    expect(renderMailHtml(html, links)).toBe(
      `<meta http-equiv="x-equin-removed" content="0;url=https://evil.example"><link rel="" href=""><base href=""><a href="https://ok.example" target="_blank" rel="noopener noreferrer">x</a><a href="#top" target="_blank" rel="noopener noreferrer">y</a>`,
    );
  });

  test("no link can navigate the frame itself", () => {
    const html = `<a href="//evil.example/x" target="_self">a</a><area href="https://e.example" target=_self><a href="javascript:alert(1)">j</a><a href="/root">r</a><svg><a xlink:href="https://s.example">s</a></svg>`;
    expect(renderMailHtml(html, links)).toBe(
      `<a href="https://evil.example/x" target="_blank" rel="noopener noreferrer">a</a><area href="https://e.example" target="_blank" rel="noopener noreferrer"><a href="" target="_blank" rel="noopener noreferrer">j</a><a href="" target="_blank" rel="noopener noreferrer">r</a><svg><a xlink:href="https://s.example" target="_blank" rel="noopener noreferrer">s</a></svg>`,
    );
  });

  test("what the server signs is exactly what the rewrite proxies", () => {
    const html = `<img src="https://a.example/1.png"><div style="background-image:url(https://a.example/2.png)"></div><table background="https://a.example/3.png"></table><img src="cid:x">`;
    expect(remoteImageUrls(html)).toEqual([
      "https://a.example/1.png",
      "https://a.example/2.png",
      "https://a.example/3.png",
    ]);
  });
});

describe("messagePreview", () => {
  test("the text, one line, without quoted history", () => {
    expect(messagePreview("Hi Ana,\n\nSee you.\n> old\n> older", null)).toBe(
      "Hi Ana, See you.",
    );
  });

  test("an HTML body's text, styles and tags dropped, entities decoded", () => {
    expect(
      messagePreview(
        null,
        `<html><head><style>p{color:red}</style></head><body><p>Fish &amp; chips</p></body></html>`,
      ),
    ).toBe("Fish & chips");
  });
});

describe("signMail", () => {
  test("a signature verifies only what it was made for", async () => {
    const sig = await signMail("image", ["https://a.example/1.png"]);
    expect(await verifyMail("image", ["https://a.example/1.png"], sig)).toBe(
      true,
    );
    expect(await verifyMail("image", ["https://a.example/2.png"], sig)).toBe(
      false,
    );
    expect(await verifyMail("inline", ["https://a.example/1.png"], sig)).toBe(
      false,
    );
  });
});
