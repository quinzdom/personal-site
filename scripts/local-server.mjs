import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDayLogAiStatus, processDayLogInput } from './daylog-ai.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8000);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function resolveStaticPath(pathname) {
  const normalizedPath = pathname === '/' ? '/index.html' : pathname;
  const candidatePath = resolve(rootDir, `.${normalizedPath}`);
  if (!candidatePath.startsWith(rootDir)) {
    return '';
  }

  if (existsSync(candidatePath)) {
    const stats = statSync(candidatePath);
    if (stats.isDirectory()) {
      const indexPath = resolve(candidatePath, 'index.html');
      return existsSync(indexPath) ? indexPath : '';
    }

    return candidatePath;
  }

  if (!extname(candidatePath)) {
    const indexPath = resolve(candidatePath, 'index.html');
    if (existsSync(indexPath)) {
      return indexPath;
    }
  }

  return '';
}

function readRequestBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let totalLength = 0;

    request.on('data', (chunk) => {
      totalLength += chunk.length;
      if (totalLength > 200_000) {
        rejectBody(new Error('Request body is too large.'));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });
    request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    request.on('error', rejectBody);
  });
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'GET' && requestUrl.pathname === '/api/daylog/status') {
    sendJson(response, 200, getDayLogAiStatus());
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/daylog/submit') {
    try {
      const status = getDayLogAiStatus();
      if (!status.enabled) {
        sendJson(response, 503, {
          error: 'OPENAI_API_KEY is not set. Start this server with your API key to enable AI log input.',
        });
        return;
      }

      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || '{}');
      const result = await processDayLogInput(payload.inputText);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : 'Could not process the log input.',
      });
    }
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, {
      'Content-Type': 'text/plain; charset=utf-8',
      Allow: 'GET, HEAD, POST',
    });
    response.end('Method not allowed.\n');
    return;
  }

  const filePath = resolveStaticPath(requestUrl.pathname);
  if (!filePath) {
    response.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    response.end('Not found.\n');
    return;
  }

  try {
    const fileBuffer = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    response.end(fileBuffer);
  } catch (error) {
    response.writeHead(500, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    response.end(`Could not read ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
  }
});

server.listen(port, () => {
  const status = getDayLogAiStatus();
  console.log(`Tracking site running at http://localhost:${port}`);
  console.log(
    status.enabled
      ? `AI log input enabled with ${status.model} (${status.timeZone}, ${status.dayStartHour}:00 rollover).`
      : 'AI log input disabled because OPENAI_API_KEY is not set.'
  );
});
