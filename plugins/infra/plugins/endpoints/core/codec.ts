import type { z } from "zod";
import { HttpError } from "./http-error";
import { jsonResponse } from "@plugins/packages/plugins/floor-compat/core";
import {
  ResponseBodyDecodeError,
  ResponseBodyLostError,
} from "./endpoint-error";

/**
 * A transport codec for an endpoint body/response payload.
 *
 * The default codec is `json()` (a bare Zod schema in a `body:`/`response:` slot
 * is normalized to `json(schema)`). Non-JSON payloads opt into `blob()` /
 * `multipart()` in the same slot.
 *
 * - `encodeRequest`/`decodeRequest` are the client→server (request body) pair.
 * - `encodeResponse`/`decodeResponse` are the server→client (response body) pair.
 */
export interface Codec<T> {
  encodeRequest(value: T): { body: BodyInit; contentType?: string };
  decodeRequest(req: Request): Promise<T>;
  encodeResponse(value: T): Response;
  decodeResponse(res: Response): Promise<T>;
}

export function isCodec(x: unknown): x is Codec<unknown> {
  return typeof x === "object" && x !== null && "encodeRequest" in x;
}

/**
 * Default JSON codec. Mirrors the legacy hardwired behavior exactly:
 * `JSON.stringify` + `application/json` on the way out, `req.json()` /
 * `res.json()` on the way in, optionally validated through a Zod schema.
 *
 * Internal — callers write a bare Zod schema (or omit it for raw JSON), which
 * `defineEndpoint` normalizes to `json(schema)`.
 */
export function json<T>(schema?: z.ZodType<T>): Codec<T> {
  return {
    encodeRequest(value) {
      return { body: JSON.stringify(value), contentType: "application/json" };
    },
    async decodeRequest(req) {
      let raw: unknown;
      try {
        raw = await req.json();
      } catch (err) {
        // Only a malformed body is a 400; a stream/transport error is a real
        // failure that must surface, not be masked as client error.
        if (!(err instanceof SyntaxError)) throw err;
        throw new HttpError(400, "Invalid JSON body");
      }
      if (!schema) return raw as T;
      const result = schema.safeParse(raw);
      if (!result.success) {
        throw new HttpError(
          400,
          JSON.stringify({
            error: "Validation failed",
            issues: result.error.issues,
          }),
        );
      }
      return result.data;
    },
    encodeResponse(value) {
      return jsonResponse(value);
    },
    async decodeResponse(res) {
      // Read as text, then parse: a body that is not JSON (empty, cut short)
      // says how much of it arrived (`ResponseBodyDecodeError`), which
      // `res.json()`'s bare SyntaxError cannot.
      const text = await res.text().catch((err: unknown) => {
        // The body stream failed mid-read: the reply was lost on the way.
        if (err instanceof TypeError)
          throw new ResponseBodyLostError(err.message, { cause: err });
        throw err;
      });
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
        throw new ResponseBodyDecodeError(
          new TextEncoder().encode(text).byteLength,
          err,
        );
      }
      return schema ? schema.parse(raw) : (raw as T);
    },
  };
}

/** Binary blob codec. Optional `contentType` overrides the request content-type. */
export function blob(contentType?: string): Codec<Blob> {
  return {
    encodeRequest(value) {
      return { body: value, contentType };
    },
    decodeRequest(req) {
      return req.blob();
    },
    encodeResponse(value) {
      return new Response(
        value,
        value.type ? { headers: { "content-type": value.type } } : undefined,
      );
    },
    decodeResponse(res) {
      return res.blob();
    },
  };
}

/**
 * What a {@link byteStream} body is: the client sends a `Blob` (a `File`),
 * the server's handler is handed the request's own stream.
 */
export type ByteStreamBody = Blob | ReadableStream<Uint8Array>;

/**
 * A raw binary request body the server reads as it arrives, never buffered:
 * for an upload too large to hold in memory (an attached video). Request-only.
 *
 * The client sends a `Blob` — a browser cannot stream a request body (fetch's
 * `duplex: "half"` is Chromium-only, and only over HTTP/2), so a
 * `ReadableStream` handed to `encodeRequest` throws. The handler always gets
 * a `ReadableStream` (`req.body`); `blob()` would have read it whole first.
 * The handler bounds what it reads: the codec has no size of its own.
 */
export function byteStream(contentType?: string): Codec<ByteStreamBody> {
  return {
    encodeRequest(value) {
      if (!(value instanceof Blob)) {
        throw new Error(
          "byteStream(): send a Blob — a browser cannot stream a request body",
        );
      }
      return { body: value, contentType };
    },
    async decodeRequest(req) {
      if (req.body === null) throw new HttpError(400, "missing request body");
      return req.body;
    },
    encodeResponse(): Response {
      throw new Error("byteStream is request-only");
    },
    decodeResponse(): Promise<ByteStreamBody> {
      throw new Error("byteStream is request-only");
    },
  };
}

/**
 * Multipart form-data codec. Request-only: the browser sets the multipart
 * boundary, so `encodeRequest` emits NO content-type. Never valid in a
 * `response:` slot.
 */
export function multipart(): Codec<FormData> {
  return {
    encodeRequest(value) {
      return { body: value };
    },
    async decodeRequest(req) {
      try {
        return await req.formData();
      } catch (err) {
        // Wrong content-type or malformed multipart body → 400, not a 500.
        if (!(err instanceof TypeError) && !(err instanceof SyntaxError))
          throw err;
        throw new HttpError(400, "Invalid multipart body");
      }
    },
    encodeResponse(): Response {
      throw new Error("multipart is request-only");
    },
    decodeResponse(): Promise<FormData> {
      throw new Error("multipart is request-only");
    },
  };
}
