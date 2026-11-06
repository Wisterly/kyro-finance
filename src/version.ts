// Metadados Centrais de Versão e Auto-Update do KYRO Finance
export const APP_VERSION = '1.45';
export const APP_BUILD = 45;

export const APP_CHANGELOG = [
  'Subetapa 03.4: Motor de Concorrência, Leases Monotônicos e Fencing Tokens (Componente 04)',
  'Validação Atômica no Commit do Firestore: Fencing tokens conferidos na mesma transação contábil',
  'Proteção contra Escrita Obsoleta: Processos com lease expirado ou substituído falham com HTTP 412 sem tocar em saldos ou recibos',
  'Sobrevivência Pós-Crash/Restart: Recuperação segura de recibos de idempotência e blindagem contra duplo débito',
  'Fronteira Criptográfica do Webhook: Assinatura HMAC SHA-256 sobre raw body, controle temporal de timestamp (5 min) e barreira contra replay com nonce único',
  'Homologação Completa: 168 testes aprovados (51 núcleo contábil + 53 rota 03.3 + 64 concorrência 03.4 = 100% sucesso)'
];
