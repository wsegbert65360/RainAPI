import http from 'http';
import { IncomingMessage, ServerResponse } from 'http';
import handler from '../api/rain';

const PORT = 3000;

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  
  // Simple path routing to match vercel.json rewrites
  const path = url.pathname;
  if (path !== '/rain' && path !== '/api/rain' && path !== '/rainfall') {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  let body = '';
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  body = Buffer.concat(chunks).toString();

  // Determine if we should use mock IEM
  const useMock = process.env.MOCK_IEM === 'true';
  if (useMock) {
    console.log('Using MOCK IEM data');
  }

  // Adapt Node req/res to Vercel-shaped objects
  const vercelReq = Object.assign(req, {
    query: Object.fromEntries(url.searchParams),
    body: body ? JSON.parse(body) : undefined,
    cookies: {},
    // Pass mock flag in req for the handler to pick up (if we modify handler)
    // Or we can rely on the same env var in the handler
  });

  const originalSetHeader = res.setHeader.bind(res);
  const vercelRes = Object.assign(res, {
    status(code: number) { res.statusCode = code; return vercelRes; },
    json(data: unknown) {
      originalSetHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    },
    setHeader(name: string, value: string) {
      originalSetHeader(name, value);
      return vercelRes;
    }
  });

  try {
    await handler(vercelReq as any, vercelRes as any);
  } catch (err) {
    console.error('Handler error:', err);
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }
});

server.listen(PORT, () => console.log(`Rain API running at http://localhost:${PORT}`));
