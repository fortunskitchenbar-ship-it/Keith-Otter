// tests/dev-server.mjs
// Minimal Vercel-like local server: static files + api/*.js handlers.
// Usage: node tests/dev-server.mjs   → http://127.0.0.1:4310

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
};

function wrapRes(nodeRes) {
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(key, value) {
      headers[key.toLowerCase()] = value;
      nodeRes.setHeader(key, value);
    },
    getHeader(key) { return headers[key.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) {
      const body = JSON.stringify(payload);
      if (!headers['content-type']) nodeRes.setHeader('Content-Type', MIME['.json']);
      nodeRes.statusCode = this.statusCode;
      nodeRes.end(body);
      return this;
    },
    send(payload) {
      nodeRes.statusCode = this.statusCode;
      nodeRes.end(payload);
      return this;
    },
    write(chunk) { return nodeRes.write(chunk); },
    end(chunk) { return nodeRes.end(chunk); },
    flushHeaders() { nodeRes.flushHeaders?.(); },
  };
  return res;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  const type = req.headers['content-type'] || '';
  if (type.includes('application/json')) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      res.writeHead(404).end('Not found');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Length': data.length,
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

export async function createServer() {
  const apiCache = new Map();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      const name = pathname.slice('/api/'.length).replace(/\/$/, '');
      if (!/^[a-z0-9-]+$/i.test(name)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad API path');
        return;
      }
      const file = path.join(ROOT, 'api', `${name}.js`);
      try {
        let handler = apiCache.get(file);
        if (!handler) {
          const mod = await import(pathToFileURL(file).href);
          handler = mod.default;
          apiCache.set(file, handler);
        }
        const query = {};
        url.searchParams.forEach((value, key) => { query[key] = value; });
        req.query = query;
        req.body = await readBody(req);
        await handler(req, wrapRes(res));
      } catch (err) {
        console.error(`[api/${name}]`, err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: err.message }));
        } else {
          res.end();
        }
      }
      return;
    }

    await serveStatic(req, res, pathname);
  });

  return server;
}

export async function startServer(port = Number(process.env.PORT) || 4310) {
  const server = await createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { url } = await startServer();
  console.log(`Keith Command Center dev server → ${url}`);
  console.log('Press Ctrl+C to stop.');
}
