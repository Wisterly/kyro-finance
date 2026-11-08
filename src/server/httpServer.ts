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
import webhookHandler, {
  setTestBatchFailureIndex,
  setTestBatchFailureTarget,
  clearTestBatchFailureIndex,
  getCapturedWhatsAppReplies,
  clearCapturedWhatsAppReplies,
  getAudioPipelineTrace,
  clearAudioPipelineTrace,
  getServerChannelPolicy,
  setServerChannelPolicy,
  resetServerChannelPolicy
} from '../../api/webhook';
import chatHandler from '../../api/chat';

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
        } else if (pathname === '/api/chat') {
          await chatHandler(vercelReq, vercelRes);
        } else if (pathname === '/api/test-control') {
          // Rota isolada exclusivamente para a infraestrutura da suíte de testes
          const payload = vercelReq.body || {};
          const action = payload.action || vercelReq.query?.action;

          if (action === 'set_test_batch_failure_index' || action === 'set_test_targeted_batch_failure') {
            const hasTarget = payload.targetMessageId || payload.targetRequestId || payload.targetPhone || payload.targetAuthUid;
            if (hasTarget) {
              setTestBatchFailureTarget({
                failureIndex: payload.failureIndex !== undefined ? Number(payload.failureIndex) : 0,
                targetMessageId: payload.targetMessageId,
                targetRequestId: payload.targetRequestId,
                targetPhone: payload.targetPhone,
                targetAuthUid: payload.targetAuthUid
              });
            } else {
              setTestBatchFailureIndex(payload.failureIndex !== undefined ? Number(payload.failureIndex) : undefined);
            }
            return vercelRes.status(200).json({ success: true, failureIndex: payload.failureIndex, hasTarget: !!hasTarget });
          }
          if (action === 'clear_test_batch_failure_index') {
            clearTestBatchFailureIndex();
            return vercelRes.status(200).json({ success: true });
          }
          if (action === 'set_channel_policy') {
            setServerChannelPolicy(payload.policy || {});
            return vercelRes.status(200).json({ success: true, policy: getServerChannelPolicy() });
          }
          if (action === 'reset_channel_policy') {
            resetServerChannelPolicy();
            return vercelRes.status(200).json({ success: true, policy: getServerChannelPolicy() });
          }
          if (action === 'set_test_audio_mocks') {
            const globalAny = global as any;
            globalAny.__KYRO_TEST_AUDIO_MOCK_ACTIVE__ = true;
            globalAny.__KYRO_TEST_AUDIO_TRANSCRIPTION__ = payload.transcription || 'Gasolina 73 reais e 45 centavos no débito';
            globalAny.__KYRO_TEST_AUDIO_MIMETYPE__ = payload.mimetype || 'audio/ogg';
            globalAny.__KYRO_TEST_AUDIO_BUFFER__ = Buffer.from(payload.audioBase64 || 'synthetic_ogg_voice_payload', 'utf-8');
            return vercelRes.status(200).json({ success: true });
          }
          if (action === 'clear_test_audio_mocks') {
            const globalAny = global as any;
            globalAny.__KYRO_TEST_AUDIO_MOCK_ACTIVE__ = false;
            globalAny.__KYRO_TEST_AUDIO_TRANSCRIPTION__ = undefined;
            globalAny.__KYRO_TEST_AUDIO_BUFFER__ = undefined;
            return vercelRes.status(200).json({ success: true });
          }
          if (action === 'get_captured_replies') {
            return vercelRes.status(200).json({ success: true, replies: getCapturedWhatsAppReplies() });
          }
          if (action === 'clear_captured_replies') {
            clearCapturedWhatsAppReplies();
            return vercelRes.status(200).json({ success: true });
          }
          if (action === 'get_audio_pipeline_trace') {
            return vercelRes.status(200).json({ success: true, trace: getAudioPipelineTrace() });
          }
          if (action === 'clear_audio_pipeline_trace') {
            clearAudioPipelineTrace();
            return vercelRes.status(200).json({ success: true });
          }

          return vercelRes.status(400).json({ error: `Ação de controle de teste '${action}' desconhecida.` });
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
