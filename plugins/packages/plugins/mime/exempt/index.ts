import type { Exemptions } from "@plugins/framework/plugins/tooling/plugins/exempt/core";

export default [
  {
    rule: "endpoints/no-raw-content-disposition",
    paths: ["core/internal/build.ts"],
    kind: "sanctioned",
    reason:
      "A MIME message builder: it writes an attachment part's own Content-Disposition header inside an email (RFC 2183), its filename encoded by RFC 2231 (filenameParams), never an HTTP response header, so contentDisposition() (a response header builder) does not apply.",
  },
  {
    rule: "endpoints/no-raw-content-disposition",
    paths: ["core/internal/parse.ts"],
    kind: "sanctioned",
    reason:
      "A MIME message reader: it reads an attachment part's own Content-Disposition header inside an email (RFC 2183) to tell an attachment from a body, never an HTTP response header.",
  },
] satisfies Exemptions;
