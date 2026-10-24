/**
 * Local production preview.
 *
 * The build emits a Cloudflare Worker (`fetch` handler), not a Node server, so
 * `vite preview` cannot serve it. This adapter runs the exact production bundle on
 * Node — same routes, same streaming, same headers — which makes a pre-deploy check
 * possible without deploying.
 *
 *   npm run build && npm run preview        # http://localhost:8080
 *   PORT=9000 npm run preview
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../.output/", import.meta.url).pathname;
const publicDir = join(root, "public");
const serverEntry = join(root, "server/index.mjs");
const port = Number(process.env.PORT ?? 8080);

const TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/** Static files first, exactly like the asset binding in production. */
async function fromPublic(pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(publicDir, rel);
  if (!file.startsWith(publicDir)) return null;
  try {
    const info = await stat(file);
    if (!info.isFile()) return null;
    const body = await readFile(file);
    return new Response(body, {
      headers: {
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        "Content-Length": String(info.size),
        ...(pathname.startsWith("/assets/")
          ? { "Cache-Control": "public, max-age=31536000, immutable" }
          : {}),
      },
    });
  } catch {
    return null;
  }
}

const { default: handler } = await import(pathToFileURL(serverEntry).href);

const server = createServer(async (req, res) => {
  const url = `http://${req.headers.host ?? `localhost:${port}`}${req.url ?? "/"}`;
  try {
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : req,
      duplex: "half",
    });
    const staticHit = req.method === "GET" ? await fromPublic(new URL(url).pathname) : null;
    // The worker expects the Cloudflare execution context: `waitUntil` keeps work alive
    // after the response; there is nothing to keep alive in a preview, so it drains.
    const waitUntil = (promise) => void Promise.resolve(promise).catch(() => {});
    const response = staticHit ?? (await handler.fetch(request, {}, { waitUntil, context: { waitUntil } }));

    res.statusCode = response.status;
    for (const [key, value] of response.headers) {
      if (key.toLowerCase() === "content-encoding") continue; // fetch already decoded it
      res.setHeader(key, value);
    }
    if (!response.body) return res.end();
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Preview failed");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Production preview → http://localhost:${port}`);
});
