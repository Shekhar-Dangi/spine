/**
 * Catch-all API proxy — local dev AND Vercel production.
 *
 * Why this exists instead of next.config.ts rewrites():
 * Next.js rewrites() buffer the entire response body before forwarding it.
 * This breaks SSE/streaming — the LLM finishes, then the whole response
 * arrives at once. This route handler passes response.body (a ReadableStream)
 * directly to the client with zero buffering.
 *
 * Why Edge Runtime:
 * - Default Node.js serverless functions on Vercel have a 10s timeout, which
 *   cuts off long LLM streaming responses.
 * - Edge runtime supports streaming with a 25s limit and uses Web-standard
 *   fetch/Response, so ReadableStream piping works natively.
 * - On Vercel, Next.js route handlers take precedence over vercel.json rewrites
 *   for the same path, so this handler runs in both local dev and production.
 *
 * File uploads bypass this entirely via NEXT_PUBLIC_UPLOAD_URL (see api.ts).
 */

import type { NextRequest } from "next/server";

export const runtime = "edge";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

async function proxy(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const target = `${BACKEND}${url.pathname}${url.search}`;

  const headers = new Headers(req.headers);
  // Strip Next.js-injected headers that can confuse the backend
  headers.delete("x-forwarded-host");
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    // Edge runtime fetch supports ReadableStream body natively — no duplex hack needed
    body: req.body ?? undefined,
    cache: "no-store",
  });

  // Pipe response.body (ReadableStream) straight to the client — no buffering
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}

export const GET    = proxy;
export const POST   = proxy;
export const PUT    = proxy;
export const PATCH  = proxy;
export const DELETE = proxy;
