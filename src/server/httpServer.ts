/**
 * KYRO FINANCE | SERVIDOR HTTP STANDALONE PARA TESTES DE ROTA MULTI-PROCESSO
 * 
 * Expõe as funções serverless reais de /api/database e /api/webhook como endpoints HTTP
 * em portas configuráveis, permitindo testar múltiplos processos independentes (com PIDs distintos)
 * concorrendo sobre a mesma infraestrutura de emulador do Firestore e Auth.
 */

import http from 'http';
import { parse as parseUrl } from 'url';
import databaseHandler from '../../api/database';
import webhookHandler from '../../api/webhook';

// Extração de porta via CLI (--port 4001) ou env PORT
function getPort(): number {
  const args = process.argv.slice(2);
  const portIdx = args.indexOf('--port');
  if (portIdx !== -1 && args[portIdx + 1]) {
    return parseInt(args[portIdx + 1], 10);
  }
  if (process.env.PORT) {
    return parseInt(process.env.PORT, 10);
  }
  return 4001;
}

const PORT = getPort();

export function createHttpApp() {
  return http.createServer(async (req, res) => {
    const parsed = parseUrl(req.url || '/', true);
    const pathname = parsed.pathname || '/';

    // Health Check
    if (pathname === '/health' || pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'UP',
        pid: process.pid,
        port: PORT,
        firestoreEmulator: process.env.FIRESTORE_EMULATOR_HOST || null,
        authEmulator: process.env.FIREBASE_AUTH_EMULATOR_HOST || null
      }));
    }

    // Leitura do Body
    let bodyBuffer = '';
    req.on('data', chunk => {
      bodyBuffer += chunk;
    });

    req.on('end', async () => {
      let parsedBody: any = {};
      if (bodyBuffer.trim().length > 0) {
        try {
          parsedBody = JSON.parse(bodyBuffer);
        } catch {
          parsedBody = bodyBuffer;
        }
      }

      // Vercel Request Shim
      const vercelReq: any = req;
      vercelReq.query = parsed.query;
      vercelReq.body = parsedBody;
      vercelReq.rawBody = bodyBuffer;

      // Vercel Response Shim
      const vercelRes: any = res;
      let statusCode = 200;

      vercelRes.status = (code: number) => {
        statusCode = code;
        return vercelRes;
      };

      vercelRes.json = (data: any) => {
        if (!res.headersSent) {
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify(data));
        return vercelRes;
      };

      vercelRes.send = (data: any) => {
        if (!res.headersSent) {
          res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
        }
        res.end(typeof data === 'string' ? data : JSON.stringify(data));
        return vercelRes;
      };

      try {
        if (pathname === '/api/database') {
          await databaseHandler(vercelReq, vercelRes);
        } else if (pathname === '/api/webhook') {
          await webhookHandler(vercelReq, vercelRes);
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Rota '${pathname}' não encontrada.` }));
        }
      } catch (err: any) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({
          error: 'Erro não tratado no servidor HTTP',
          details: err?.message || String(err)
        }));
      }
    });
  });
}

// Inicia o servidor HTTP
const server = createHttpApp();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[KYRO_HTTP_SERVER_READY] PID:${process.pid} PORT:${PORT}`);
});

const cleanup = () => {
  console.log(`[KYRO_HTTP_SERVER_SHUTDOWN] PID:${process.pid}`);
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
