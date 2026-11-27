import { serveCollection } from "@plugins/network/plugins/live/server";
import { Attachments } from "@plugins/infra/plugins/attachments/server";
import { proposalAttachmentLinks, proposalsList } from "../../core";
import { proposalAttachments } from "./schema-attachments";
import { proposalsEntity } from "./tables";

const listServed = serveCollection(proposalsList, { from: proposalsEntity });

const linksServed = serveCollection(proposalAttachmentLinks, {
  from: proposalAttachments.table,
});

export const proposalsServedContributions = [
  ...listServed.declare,
  ...linksServed.declare,
  Attachments.Link({ link: proposalAttachments, served: linksServed }),
];
