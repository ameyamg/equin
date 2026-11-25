import { serveCollection } from "@plugins/network/plugins/live/server";
import { Attachments } from "@plugins/infra/plugins/attachments/server";
import { decisionAttachmentLinks } from "../../core";
import { decisionAttachments } from "./schema-attachments";

const served = serveCollection(decisionAttachmentLinks, {
  from: decisionAttachments.table,
});

/** The decisions' link set, served for `attachments.by-owner` to follow. */
export const attachmentLinkContributions = [
  ...served.declare,
  Attachments.Link({ link: decisionAttachments, served }),
];
