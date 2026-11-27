import type { Transport } from "@plugins/primitives/plugins/networking/web";
import {
  sendEndpointBeacon,
  type EndpointDef,
  type EndpointRequestOpts,
  type WriteEndpoint,
} from "../../core";

/**
 * What became of one beacon: the browser `queued` it (it delivers it even if
 * the page goes away), or `refused` it — its in-flight beacon quota is full.
 * Nothing says whether it arrived: a beacon has no answer.
 */
export type BeaconSent = { kind: "queued" } | { kind: "refused" };

/**
 * A write handed to the browser to deliver after the page may be gone —
 * `navigator.sendBeacon` over the transport's `beacon`. For what a page sends
 * as it is hidden or closed (an analytics engagement report), where a `fetch`,
 * even `keepalive`, is more often dropped.
 *
 * Unlike `fetchEndpoint`, there is no answer to decode: the endpoint's
 * response is never read, and no header is sent (a beacon carries none — so
 * no issuer stamp, no unreverted-write mark — and its body goes as
 * `text/plain`, which the JSON codec reads all the same). So it takes only a
 * plain POST endpoint whose body encodes to a string (JSON);
 * a desktop-only one (`needsMachine`) is refused, as nothing could say it is
 * unavailable (a tsc error: `EndpointDef` has no `needsMachine`).
 */
export type BeaconEndpoint = <
  Route extends string,
  TParams,
  TBody,
  TResponse,
  TQuery,
>(
  endpoint: EndpointDef<Route, TParams, TBody, TResponse, TQuery> &
    WriteEndpoint,
  params: TParams,
  opts: EndpointRequestOpts<TBody, TQuery>,
) => BeaconSent;

/**
 * The beacon sender over `transport` — for sanctioned page-level code
 * (`beaconEndpointOver(pageTransport)`, like `fetchEndpointOver`). Throws on
 * a transport no browser delivers for (`beacon: null`): a beacon there is a
 * programming error, not a lost send.
 */
export function beaconEndpointOver(transport: Transport): BeaconEndpoint {
  const beacon = transport.beacon;
  if (beacon === null)
    throw new Error(
      `beaconEndpointOver: the ${transport.server} transport delivers no beacons`,
    );
  return (endpoint, params, opts) =>
    sendEndpointBeacon(beacon, endpoint, params, opts)
      ? { kind: "queued" }
      : { kind: "refused" };
}
