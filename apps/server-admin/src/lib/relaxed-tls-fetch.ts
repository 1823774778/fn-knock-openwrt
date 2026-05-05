import { Buffer } from "node:buffer";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import {
  request as httpsRequest,
  type RequestOptions as HttpsRequestOptions,
} from "node:https";

const DEFAULT_MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type RelaxedTlsFetchInit = {
  method?: string;
  redirect?: RequestRedirect;
  signal?: AbortSignal | null;
  headers?: HeadersInit;
  maxRedirects?: number;
};

const normalizeHeaders = (headers: HeadersInit | undefined): Headers => {
  const normalized = new Headers();
  if (!headers) return normalized;

  new Headers(headers).forEach((value, key) => {
    normalized.set(key, value);
  });
  return normalized;
};

const toResponseHeaders = (headers: IncomingHttpHeaders): Headers => {
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      responseHeaders.set(key, value);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) responseHeaders.append(key, item);
    }
  }
  return responseHeaders;
};

const createAbortError = (): Error => {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }

  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
};

const shouldRewriteRedirectMethod = (status: number, method: string): boolean =>
  status === 303 ||
  ((status === 301 || status === 302) && method !== "GET" && method !== "HEAD");

const createResponse = (
  url: URL,
  status: number,
  statusText: string | undefined,
  headers: IncomingHttpHeaders,
  body: Buffer,
): Response => {
  const responseBody: BodyInit | null =
    status === 204 || status === 205 || status === 304
      ? null
      : (body as unknown as BodyInit);
  const response = new Response(responseBody, {
    status,
    statusText,
    headers: toResponseHeaders(headers),
  });
  Object.defineProperty(response, "url", {
    value: url.toString(),
    configurable: true,
  });
  return response;
};

export const fetchWithRelaxedTls = (
  input: string | URL,
  init: RelaxedTlsFetchInit = {},
  redirectCount = 0,
): Promise<Response> => {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    return Promise.reject(new TypeError("Invalid URL"));
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Promise.reject(
      new TypeError(`Unsupported protocol: ${url.protocol}`),
    );
  }

  if (init.signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<Response>((resolve, reject) => {
    const method = init.method ?? "GET";
    const headers = normalizeHeaders(init.headers);
    const requestHeaders: Record<string, string> = {};
    headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    const requestOptions: HttpsRequestOptions = {
      method,
      headers: requestHeaders,
      signal: init.signal ?? undefined,
    };
    if (url.protocol === "https:") {
      requestOptions.rejectUnauthorized = false;
    }

    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      requestOptions,
      (upstreamResponse) => {
        const status = upstreamResponse.statusCode ?? 502;
        const location = upstreamResponse.headers.location;
        if (
          init.redirect !== "manual" &&
          REDIRECT_STATUSES.has(status) &&
          location
        ) {
          upstreamResponse.resume();
          if (init.redirect === "error") {
            reject(new TypeError(`Redirect received from ${url.toString()}`));
            return;
          }
          if (redirectCount >= (init.maxRedirects ?? DEFAULT_MAX_REDIRECTS)) {
            reject(new TypeError("Maximum redirect reached"));
            return;
          }

          const nextMethod = shouldRewriteRedirectMethod(status, method)
            ? "GET"
            : method;
          fetchWithRelaxedTls(
            new URL(location, url),
            {
              ...init,
              method: nextMethod,
            },
            redirectCount + 1,
          ).then(resolve, reject);
          return;
        }

        const chunks: Buffer[] = [];
        upstreamResponse.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        upstreamResponse.on("end", () => {
          resolve(
            createResponse(
              url,
              status,
              upstreamResponse.statusMessage,
              upstreamResponse.headers,
              Buffer.concat(chunks),
            ),
          );
        });
        upstreamResponse.on("error", reject);
      },
    );

    request.on("error", reject);
    request.end();
  });
};
