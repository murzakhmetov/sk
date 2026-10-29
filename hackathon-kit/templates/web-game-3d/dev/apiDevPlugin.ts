/**
 * Serves the Vercel-style functions in `api/` from the Vite dev server, so
 * `npm run dev` runs the game and the API together without the Vercel CLI.
 *
 * Convention (same as Vercel): `api/<route>.ts` exports Web-standard handlers named
 * after HTTP methods, e.g. `export async function POST(request: Request)`.
 * Path segments starting with `_` (like `api/_lib`) are private and never routed.
 */
import { existsSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { loadEnv, type Connect, type Plugin, type ViteDevServer } from 'vite';

type RouteHandler = (request: Request) => Response | Promise<Response>;

const ROUTE_PATTERN = /^\/((?:[a-z0-9][\w-]*\/)*[a-z0-9][\w-]*)\/?$/i;

export function apiDevPlugin(apiDir = 'api'): Plugin {
  return {
    name: 'local-api-routes',
    apply: 'serve',
    configureServer(server) {
      // Server-only variables (no VITE_ prefix) from .env / .env.local; real env vars win.
      const env = loadEnv(server.config.mode, server.config.envDir, '');
      for (const [key, value] of Object.entries(env)) process.env[key] ??= value;

      const apiRoot = path.resolve(server.config.root, apiDir);
      // The whole /api namespace belongs to the functions: unknown routes get a 404
      // instead of falling through to Vite, which would serve the source files.
      server.middlewares.use('/api', (req, res) => {
        handleApiRequest(server, apiRoot, req, res).catch((error: unknown) => {
          if (error instanceof Error) server.ssrFixStacktrace(error);
          server.config.logger.error(`[api] ${req.method} ${req.originalUrl}: ${String(error)}`);
          sendJson(res, 500, { error: 'Internal server error' });
        });
      });
    },
  };
}

async function handleApiRequest(
  server: ViteDevServer,
  apiRoot: string,
  req: Connect.IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Inside `use('/api', ...)` the mount prefix is already stripped from req.url.
  const routePath = new URL(req.url ?? '/', 'http://localhost').pathname;
  const route = ROUTE_PATTERN.exec(routePath)?.[1];
  const file = route ? path.join(apiRoot, `${route}.ts`) : undefined;
  if (!file || !existsSync(file)) return sendJson(res, 404, { error: 'Not found' });

  // ssrLoadModule re-evaluates the module after edits, so handler changes apply without a restart.
  const module = await server.ssrLoadModule(file);
  const handler: unknown = module[req.method ?? 'GET'];
  if (typeof handler !== 'function') return sendJson(res, 405, { error: 'Method not allowed' });

  const response = await (handler as RouteHandler)(await toWebRequest(req));
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function toWebRequest(req: Connect.IncomingMessage): Promise<Request> {
  const url = new URL(req.originalUrl ?? req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, { method: req.method, headers, body: hasBody ? await readBody(req) : undefined });
}

async function readBody(req: Connect.IncomingMessage): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return new Uint8Array(Buffer.concat(chunks));
}
