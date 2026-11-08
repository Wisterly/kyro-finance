// Metadados Centrais de Versão e Auto-Update do KYRO Finance
export const APP_VERSION = '1.48';
export const APP_BUILD = 48;

export const APP_CHANGELOG = [
  'Subetapa 03.7: Sincronização Offline, Fila Resiliente por Tenant e Tolerância a Conflitos de Tombstone (PR.048)',
  'Persistência Isolada por UID: Fila de mutações particionada estritamente por tenant (kyro_offline_queue_${userId})',
  'Identidade Estável Ponta a Ponta: requestId único e imutável gerado na intenção offline e preservado até reconciliação',
  'Sobrevivência a Reinicializações: Reidratação idêntica com centavos inteiros BigInt e preservação de status',
  'Reconciliação Baseada em Recibo Oficial: Confirmação na interface somente após validação de recibo do servidor',
  'Tratamento Tripartite de Exceções: Falhas transitórias (retry com backoff), rejeições permanentes (sem retentativa infinita) e conflitos de tombstone (ressurreição impedida)',
  'Resiliência a Queda Pós-Commit e Replay Idempotente: Recuperação idêntica com efeito contábil rigorosamente único',
  'Isolamento Multi-Tenant em Troca de Sessão: Sessão ativa bloqueada para ler ou sincronizar filas de terceiros (PERMISSION_DENIED_TENANT_MISMATCH)',
  'Suíte Consolidada: 597 testes aprovados (51 Núcleo + 53 03.3 + 141 03.4 + 126 03.5 + 20 Event Bridge + 138 03.6 + 68 03.7 = 100% de sucesso)'
];
