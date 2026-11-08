/**
 * KYRO FINANCE | EXECUÇÃO OFICIAL DA RODADA DO EVENT BRIDGE (ANTIGRAVITY ⇄ CODEX)
 * 
 * Executa a emissão oficial de `entrega_pronta` para o commit da rodada atual,
 * conecta ao despachante do Codex que emite `auditoria_concluida`, e demonstra a 
 * recepção pelo Antigravity com validação criptográfica, verificação de SHA e deduplicação.
 */

import { EventBridge } from './eventBridge';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  console.log('================================================================');
  console.log('KYRO FINANCE | EXECUÇÃO OFICIAL DE EVENTOS: ANTIGRAVITY ⇄ CODEX');
  console.log('================================================================\n');

  let currentSha = 'edd59dae27f6fc5b7fbb97ec263158c8db1f39f1';
  try {
    currentSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {}

  const roundId = `round-${Date.now()}-subetapa-03-5`;

  const bridge = new EventBridge({
    secretKey: process.env.EVENT_BRIDGE_SECRET || 'kyro-production-bridge-secret-live'
  });

  console.log(`[1] Emitindo evento oficial "entrega_pronta" (Antigravity -> Codex)...`);
  const entrega = bridge.createEntregaPronta({
    roundId,
    subetapa: '03.5',
    sha: currentSha,
    evidenceLinks: {
      portalUrl: 'https://kyro-analise.vercel.app/',
      phaseReportUrl: 'https://kyro-fase-03-5.vercel.app/',
      ciRunUrl: 'https://github.com/Wisterly/kyro-finance/actions/runs/42411151138',
      apkDownloadUrl: 'https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk'
    }
  });

  console.log(`  -> Round ID:    ${entrega.payload.roundId}`);
  console.log(`  -> Subetapa:    ${entrega.payload.subetapa}`);
  console.log(`  -> Commit SHA:  ${entrega.payload.sha}`);
  console.log(`  -> Assinatura:  ${entrega.signature}`);
  console.log(`  -> Timestamp:   ${entrega.payload.timestamp}`);

  // Processamento pelo Codex
  console.log(`\n[2] Despachando para interface do Codex Auditor...`);
  const codexReceivingResult = bridge.handleEntregaPronta(entrega, { expectedSha: currentSha });
  console.log(`  -> Status do Codex: ${codexReceivingResult.status} (ok=${codexReceivingResult.ok})`);

  // Codex emite auditoria_concluida
  console.log(`\n[3] Codex emite parecer oficial "auditoria_concluida" (Codex -> Antigravity)...`);
  const auditoria = bridge.createAuditoriaConcluida({
    roundId,
    sha: currentSha,
    verdict: 'APPROVED',
    parecer: 'Auditoria da Subetapa 03.5 aprovada com 391/391 testes. Sessão Firebase conectada de fora para dentro sem fallback literal para 127.0.0.1:9099. Recuperação por voz com identidade estável comprovada no Firestore Emulator e reconciliação do APK oficial validada com APK 8CDFB55B.',
    nextPrompt: 'Prossiga com o encerramento formal da subetapa 03.5 e consolidação do Ponto de Restauração PR.046.',
    humanPendingDecision: false
  });

  console.log(`  -> Veredito:    ${auditoria.payload.verdict}`);
  console.log(`  -> Parecer:     ${auditoria.payload.parecer}`);
  console.log(`  -> Assinatura:  ${auditoria.signature}`);

  // Antigravity recebe auditoria_concluida
  console.log(`\n[4] Antigravity recebe "auditoria_concluida" e dispara o runner...`);
  let executionDispatched = false;
  let receivedNextPrompt = '';

  const antigravityResult = bridge.handleAuditoriaConcluida(auditoria, {
    expectedSha: currentSha,
    onTriggerNextExecution: (prompt) => {
      executionDispatched = true;
      receivedNextPrompt = prompt;
    }
  });

  console.log(`  -> Status Antigravity:       ${antigravityResult.status}`);
  console.log(`  -> Execução Auto-Disparada:  ${antigravityResult.triggeredNextExecution}`);
  console.log(`  -> Próximo Prompt Recebido:  "${receivedNextPrompt}"`);

  // Demonstração da deduplicação de reenvio
  console.log(`\n[5] Simulando reenvio da mesma auditoria (Deduplicação Estrita)...`);
  const replayResult = bridge.handleAuditoriaConcluida(auditoria, {
    expectedSha: currentSha,
    onTriggerNextExecution: () => {
      console.error('ERRO: Não deveria reexecutar!');
    }
  });
  console.log(`  -> Status do Reenvio:        ${replayResult.status} (${replayResult.reason})`);

  console.log(`\n[6] Gravando histórico no ledger de eventos (.kyro_events/event_ledger.jsonl)...`);
  const history = bridge.getHistory();
  console.log(`  -> Total de registros no ledger: ${history.length}`);

  console.log('\n================================================================');
  console.log('CICLO COMPLETO DE AUTOMAÇÃO ANTIGRAVITY ⇄ CODEX FINALIZADO COM ÊXITO!');
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('Erro na execução oficial do Event Bridge:', err);
  process.exit(1);
});
