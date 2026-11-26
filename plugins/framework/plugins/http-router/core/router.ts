import { serverTimingValue } from "./server-timing";
import { thrownResponse } from "./thrown-response";
import { jsonResponse } from "@plugins/packages/plugins/floor-compat/core";

/** A route's handler: the request and the values of its `:param` segments. */
export type RouteHandler = (
  req: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

export interface RequestHandlerOptions {
  /** `["METHOD /path/:param", handler]` pairs. A duplicate key throws. */
  routes: Iterable<[key: string, handler: RouteHandler]>;
  /** Called with a handler's throw, before the 500 is returned. */
  onError: (err: Error, req: Request, pathname: string) => void;
  /** The response when no route matches. Default: 404 "Not found". */
  onUnmatched?: (req: Request, pathname: string) => Response;
  /**
   * Called with every 4xx answer, after it is built and before it is
   * returned — a matched route's under its route key (`"GET /api/x/:id"`), an
   * unmatched request's under `null`. Observes only: it must not consume
   * `res`'s body (clone it) and its own failure is its own.
   */
  onRefused?: (refusal: Refusal) => void;
}

/** A 4xx answer, as `onRefused` is handed it. */
export interface Refusal {
  /** The matched route's key, or `null` when no route matched. */
  route: string | null;
  method: string;
  pathname: string;
  res: Response;
}

// ── Route tables ────────────────────────────────────────────────
// Flatten routes into lookup tables. Literal routes go in an O(1)
// map; routes with :param segments are matched linearly in registration
// order.
type Segment = { literal: string } | { param: string };
interface ParamRoute {
  key: string;
  method: string;
  segments: Segment[];
  handler: RouteHandler;
}

function pathSegments(path: string): Segment[] {
  return path
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => (s.startsWith(":") ? { param: s.slice(1) } : { literal: s }));
}

function matchSegments(
  pathname: string,
  routes: ParamRoute[],
  method: string,
): (ParamRoute & { params: Record<string, string> }) | null {
  const parts = pathname.split("/").filter((s) => s.length > 0);
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < route.segments.length; i++) {
      const seg = route.segments[i]!;
      const part = parts[i]!;
      if ("literal" in seg) {
        if (seg.literal !== part) {
          ok = false;
          break;
        }
      } else {
        params[seg.param] = decodeURIComponent(part);
      }
    }
    if (ok) return { ...route, params };
  }
  return null;
}

// Default every API response to `cache-control: no-store` unless the handler set
// its own. The browser HTTP cache storing a live-state body then 304-replaying an
// old-boot copy is the cache-poisoning wedge class (Fix E, the dispatch-layer
// floor beneath handleResourceHttp's own explicit `no-store`); media/raw handlers
// that set their own Cache-Control keep it. Bun's constructed-Response headers are
// mutable in place (probed), so no clone is needed.
function withDefaultCacheControl(res: Response): Response {
  if (!res.headers.has("cache-control"))
    res.headers.set("cache-control", "no-store");
  return res;
}

// Stamp the handler's time (`server-timing.ts`). A response whose headers are
// immutable (a `Response.redirect`, a fetched response passed through, under a
// browser host) is re-wrapped once to carry it.
function withServerTiming(res: Response, handlerMs: number): Response {
  const value = serverTimingValue({ handlerMs, id: crypto.randomUUID() });
  try {
    res.headers.append("server-timing", value);
    return res;
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    const headers = new Headers(res.headers);
    headers.append("server-timing", value);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

/**
 * Builds the request handler for a set of routes: literal fast path, then the
 * `:param` matcher (filtered by method, in registration order). Every handled
 * response (the 500 included) defaults to `cache-control: no-store` and carries
 * the handler's time as `Server-Timing` (`server-timing.ts`); a throw goes to
 * `onError` and answers a generic JSON 500 — or the response the error carries
 * (`answerThrowWith`).
 */
export function createRequestHandler(
  opts: RequestHandlerOptions,
): (req: Request) => Promise<Response> {
  const literalRoutes = new Map<string, RouteHandler>();
  const paramRoutes: ParamRoute[] = [];
  const seen = new Set<string>();
  for (const [key, handler] of opts.routes) {
    if (seen.has(key)) throw new Error(`[http-router] duplicate route: ${key}`);
    seen.add(key);
    const spaceIdx = key.indexOf(" ");
    const method = key.slice(0, spaceIdx);
    const path = key.slice(spaceIdx + 1);
    if (!path.includes("/:")) {
      literalRoutes.set(`${method} ${path}`, handler);
      continue;
    }
    paramRoutes.push({ key, method, segments: pathSegments(path), handler });
  }
  const onUnmatched = opts.onUnmatched ?? notFound;
  const onRefused = opts.onRefused;
  function observed(
    res: Response,
    route: string | null,
    req: Request,
    pathname: string,
  ): Response {
    if (onRefused && res.status >= 400 && res.status < 500)
      onRefused({ route, method: req.method, pathname, res });
    return res;
  }

  async function safeHandle(
    handler: RouteHandler,
    req: Request,
    params: Record<string, string>,
    pathname: string,
  ): Promise<Response> {
    const startedAt = performance.now();
    try {
      const res = await handler(req, params);
      return withServerTiming(
        withDefaultCacheControl(res),
        performance.now() - startedAt,
      );
    } catch (err) {
      const errObj = err instanceof Error ? err : new Error(String(err));
      // Fail loudly: the host's onError emits a durable log line BEFORE the
      // generic 500 is returned. A 500 with zero log line made this class of
      // bug invisible.
      opts.onError(errObj, req, pathname);
      return withServerTiming(
        withDefaultCacheControl(
          thrownResponse(errObj) ??
            jsonResponse({ error: "Internal server error" }, { status: 500 }),
        ),
        performance.now() - startedAt,
      );
    }
  }

  return async (req) => {
    const { pathname } = new URL(req.url);

    // Literal fast-path, then :param matcher.
    const literal = literalRoutes.get(`${req.method} ${pathname}`);
    if (literal) {
      const key = `${req.method} ${pathname}`;
      return observed(
        await safeHandle(literal, req, {}, pathname),
        key,
        req,
        pathname,
      );
    }

    const matched = matchSegments(pathname, paramRoutes, req.method);
    if (matched)
      return observed(
        await safeHandle(matched.handler, req, matched.params, pathname),
        matched.key,
        req,
        pathname,
      );

    return observed(onUnmatched(req, pathname), null, req, pathname);
  };
}
