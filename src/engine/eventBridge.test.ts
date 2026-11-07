/**
 * KYRO FINANCE | SUÍTE DE TESTES DO EVENT BRIDGE (ANTIGRAVITY ⇄ CODEX)
 * 
 * Demonstração do ciclo completo de automação e troca de eventos entre Antigravity e Codex:
 * 1. Emissão de `entrega_pronta` autenticada via HMAC-SHA256 e validação de SHA.
 * 2. Deduplicação estrita por roundId (execução estritamente única).
 * 3. Rejeição de assinaturas adulteradas e SHAs divergentes.
 * 4. Emissão de `auditoria_concluida` pelo Codex com parecer e próximo prompt.
 * 5. Acionamento automático pelo Antigravity exatamente uma vez e encerramento com decisão humana pendente.
 * 6. Integração HTTP real via servidor Webhook/Event Bus.
 */

import { EventBridge, createEventBridgeHttpServer } from '../automation/eventBridge';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Falha na asserção: ${message}`);
  }
  console.log(`  [OK] ${message}`);
}

async function httpRequest(url: string, method: string, data?: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = data ? JSON.stringify(data) : '';
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode || 0, body });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

export async function runEventBridgeTests(): Promise<{ total: number; passed: number }> {
  console.log('\n================================================================');
  console.log('KYRO FINANCE | TESTE DE AUTOMAÇÃO DE EVENTOS: ANTIGRAVITY ⇄ CODEX');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function countTest(fn: () => void) {
    total++;
    fn();
    passed++;
  }

  const testDir = path.resolve(process.cwd(), '.kyro_test_events');
  if (fs.existsSync(testDir)) {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  }

  const bridge = new EventBridge({
    secretKey: 'secret-key-automacao-codex-antigravity-synth',
    ledgerDir: testDir
  });

  const sampleSha = 'd39b83e35bd67e38e2c0d08c13d9125673dfa82f';
  const roundId = `round-${Date.now()}-test-01`;

  // --- GRUPO 1: EMISSÃO E ASSINATURA DE ENTREGA_PRONTA ---
  console.log('--- GRUPO 1: EMISSÃO E INTEGRIDADE CRIPTOGRÁFICA DE ENTREGA_PRONTA ---');

  const entrega = bridge.createEntregaPronta({
    roundId,
    subetapa: '03.5',
    sha: sampleSha,
    evidenceLinks: {
      portalUrl: 'https://kyro-analise.vercel.app/',
      phaseReportUrl: 'https://kyro-fase-03-5.vercel.app/',
      ciRunUrl: 'https://github.com/Wisterly/kyro-finance/actions/runs/42409482915',
      apkDownloadUrl: 'https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk'
    }
  });

  countTest(() => {
    assert(entrega.payload.eventType === 'entrega_pronta', 'Evento emitido possui tipo "entrega_pronta"');
  });

  countTest(() => {
    assert(entrega.payload.roundId === roundId, `Evento possui roundId único: ${roundId}`);
  });

  countTest(() => {
    assert(entrega.payload.sha === sampleSha, `SHA auditado coincide: ${sampleSha}`);
  });

  countTest(() => {
    assert(typeof entrega.signature === 'string' && entrega.signature.length === 64, 'Assinatura HMAC-SHA256 gerada com 64 dígitos hexadecimais');
  });

  countTest(() => {
    assert(bridge.verifySignature(entrega.payload, entrega.signature) === true, 'Assinatura oficial é validada com sucesso pelo receptor');
  });

  // --- GRUPO 2: PROTEÇÃO CONTRA ADULTERAÇÃO E DEDUPLICAÇÃO ---
  console.log('\n--- GRUPO 2: PROTEÇÃO CONTRA ADULTERAÇÃO E DEDUPLICAÇÃO ESTRITA ---');

  countTest(() => {
    const tamperedPayload = { ...entrega.payload, subetapa: '03.9-hacked' };
    const valid = bridge.verifySignature(tamperedPayload, entrega.signature);
    assert(!valid, 'Payload adulterado é imediatamente rejeitado na validação de assinatura');
  });

  countTest(() => {
    const fakeSignature = 'a'.repeat(64);
    const result = bridge.handleEntregaPronta({ payload: entrega.payload, signature: fakeSignature });
    assert(!result.ok && result.status === 'REJECTED_SIGNATURE', 'Evento com assinatura forjada é rejeitado com REJECTED_SIGNATURE');
  });

  countTest(() => {
    const wrongSha = '1111111111222222222233333333334444444444';
    const result = bridge.handleEntregaPronta(entrega, { expectedSha: wrongSha });
    assert(!result.ok && result.status === 'REJECTED_SHA_MISMATCH', 'SHA divergente do esperado é rejeitado com REJECTED_SHA_MISMATCH');
  });

  countTest(() => {
    const result1 = bridge.handleEntregaPronta(entrega, { expectedSha: sampleSha });
    assert(result1.ok && result1.status === 'PROCESSED', 'Primeira entrega processada com sucesso pelo Codex (PROCESSED)');
  });

  countTest(() => {
    const result2 = bridge.handleEntregaPronta(entrega, { expectedSha: sampleSha });
    assert(result2.ok && result2.status === 'DUPLICATE_EVENT_IGNORED', 'Reenvio do mesmo roundId é deduplicado com DUPLICATE_EVENT_IGNORED');
  });

  // --- GRUPO 3: RETORNO DE AUDITORIA DO CODEX PARA O ANTIGRAVITY ---
  console.log('\n--- GRUPO 3: RETORNO DE AUDITORIA DO CODEX PARA O ANTIGRAVITY ---');

  let executionsTriggered = 0;
  let receivedNextPrompt = '';

  const auditoria = bridge.createAuditoriaConcluida({
    roundId,
    sha: sampleSha,
    verdict: 'APPROVED',
    parecer: 'Auditoria automatizada do Codex aprovou a subetapa 03.5 com conformidade integral.',
    nextPrompt: 'Prossiga para a etapa de consolidação final da fase 03.',
    humanPendingDecision: false
  });

  countTest(() => {
    assert(auditoria.payload.eventType === 'auditoria_concluida', 'Evento de auditoria possui tipo "auditoria_concluida"');
  });

  countTest(() => {
    assert(auditoria.payload.verdict === 'APPROVED', 'Parecer oficial do Codex atesta veredito APPROVED');
  });

  countTest(() => {
    const result = bridge.handleAuditoriaConcluida(auditoria, {
      expectedSha: sampleSha,
      onTriggerNextExecution: (prompt) => {
        executionsTriggered++;
        receivedNextPrompt = prompt;
      }
    });
    assert(result.ok && result.triggeredNextExecution === true, 'Antigravity recebeu a conclusão e acionou a execução seguinte automaticamente');
  });

  countTest(() => {
    assert(executionsTriggered === 1, 'Execução seguinte disparada exatamente UMA ÚNICA VEZ (zero duplicações)');
  });

  countTest(() => {
    assert(receivedNextPrompt.includes('consolidação final'), 'Prompt integral recebido com fidelidade no despachante do Antigravity');
  });

  countTest(() => {
    const replayResult = bridge.handleAuditoriaConcluida(auditoria, {
      expectedSha: sampleSha,
      onTriggerNextExecution: () => {
        executionsTriggered++;
      }
    });
    assert(replayResult.status === 'DUPLICATE_EVENT_IGNORED' && executionsTriggered === 1, 'Reenvio de auditoria_concluida é deduplicado sem redisparar execução');
  });

  // --- GRUPO 4: ENCERRAMENTO COM DECISÃO HUMANA PENDENTE ---
  console.log('\n--- GRUPO 4: ENCERRAMENTO QUANDO HÁ DECISÃO HUMANA PENDENTE ---');

  const roundHumanId = `round-${Date.now()}-human-pending`;
  const auditoriaComPendencia = bridge.createAuditoriaConcluida({
    roundId: roundHumanId,
    sha: sampleSha,
    verdict: 'NEEDS_CLARIFICATION',
    parecer: 'Aprovação humana necessária para autorizar migração de banco.',
    humanPendingDecision: true
  });

  countTest(() => {
    let triggeredHuman = false;
    const result = bridge.handleAuditoriaConcluida(auditoriaComPendencia, {
      expectedSha: sampleSha,
      onTriggerNextExecution: () => { triggeredHuman = true; }
    });
    assert(result.ok && result.status === 'ROUND_CLOSED_AWAITING_HUMAN', 'Status registrado é ROUND_CLOSED_AWAITING_HUMAN');
    assert(triggeredHuman === false, 'Nenhuma execução automática disparada sob decisão humana pendente (segurança garantida)');
  });

  // --- GRUPO 5: INTEGRAÇÃO REAL VIA SERVIDOR WEBHOOK HTTP ---
  console.log('\n--- GRUPO 5: INTEGRAÇÃO REAL VIA SERVIDOR WEBHOOK HTTP ---');

  const server = createEventBridgeHttpServer(bridge);
  await new Promise<void>((resolve) => server.listen(4130, '127.0.0.1', () => resolve()));
  console.log('  [OK] Servidor EventBridge HTTP ativo na porta 4130');

  try {
    const netRoundId = `round-${Date.now()}-net`;
    const netEntrega = bridge.createEntregaPronta({
      roundId: netRoundId,
      subetapa: '03.5',
      sha: sampleSha,
      evidenceLinks: {
        portalUrl: 'https://kyro-analise.vercel.app/',
        phaseReportUrl: 'https://kyro-fase-03-5.vercel.app/',
        ciRunUrl: 'https://github.com/Wisterly/kyro-finance/actions/runs/42409482915',
        apkDownloadUrl: 'https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk'
      }
    });

    const httpRespEntrega = await httpRequest('http://127.0.0.1:4130/api/events/entrega_pronta', 'POST', netEntrega);
    countTest(() => {
      assert(httpRespEntrega.status === 200, 'POST /api/events/entrega_pronta via rede HTTP retorna 200 OK');
      assert(httpRespEntrega.body.status === 'PROCESSED', 'Corpo da resposta HTTP confirma evento processado');
    });

    const netAuditoria = bridge.createAuditoriaConcluida({
      roundId: netRoundId,
      sha: sampleSha,
      verdict: 'APPROVED',
      parecer: 'Auditoria via rede concluída com êxito.'
    });

    const httpRespAuditoria = await httpRequest('http://127.0.0.1:4130/api/events/auditoria_concluida', 'POST', netAuditoria);
    countTest(() => {
      assert(httpRespAuditoria.status === 200, 'POST /api/events/auditoria_concluida via rede HTTP retorna 200 OK');
      assert(httpRespAuditoria.body.status === 'PROCESSED', 'Corpo da resposta HTTP confirma auditoria processada');
    });

    const httpHistory = await httpRequest('http://127.0.0.1:4130/api/events/history', 'GET');
    countTest(() => {
      assert(httpHistory.status === 200, 'GET /api/events/history retorna 200 OK');
      assert(Array.isArray(httpHistory.body.history) && httpHistory.body.history.length > 0, 'Histórico de eventos auditável e persistido em ledger');
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    console.log('  [OK] Servidor EventBridge HTTP encerrado com limpeza de recursos');
  }

  // Limpeza de ambiente de teste
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}

  console.log('\n================================================================');
  console.log(`TOTAL DE TESTES DO EVENT BRIDGE: ${passed} / ${total} APROVADOS (100%)`);
  console.log('================================================================\n');

  return { total, passed };
}

// Execução direta
if (process.argv[1]?.includes('eventBridge.test.ts')) {
  runEventBridgeTests().catch(err => {
    console.error('Erro na suíte do EventBridge:', err);
    process.exit(1);
  });
}
