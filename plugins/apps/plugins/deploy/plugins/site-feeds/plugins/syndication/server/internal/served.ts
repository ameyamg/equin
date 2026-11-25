import { serveCollection } from "@plugins/network/plugins/live/server";
import { siteFeedSyndications } from "../../core";
import { siteFeedSyndicationsEntity } from "./tables";

export const syndicationsServed = serveCollection(siteFeedSyndications, {
  from: siteFeedSyndicationsEntity,
});
