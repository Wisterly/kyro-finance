// Metadados Centrais de Versão e Auto-Update do KYRO Finance
export const APP_VERSION = '1.46';
export const APP_BUILD = 46;

export const APP_CHANGELOG = [
  'Subetapa 03.5: Saneamento de Rede Cleartext, Prova de Confirmação do Chat e Inspeção do APK (PR.046)',
  'Caminho de Confirmação do Chat: Exercitado via ChatVoiceController sobre a rota HTTP real (/api/database) e Firestore Emulator',
  'Blindagem Contábil contra Áudio Parcial: Zero mutações de saldo ou transações em frames parciais, cancelamento e repetições',
  'Idempotência Estrita no Chat: Saldo debitado uma única vez (R$ 50,00) e identidade estável garantida mesmo com repetição/perda de resposta',
  'Inspeção do APK: Mapeamento de hash SHA-256 do APK legado, substituição de cleartext por TLS obrigatório e preservação de appId com.kyro.finance',
  'Segregação Formal de Pareceres: Contrato e artefato 100% homologados; aceite de runtime Android pendente de ambiente com AVD/hardware',
  'Suíte Consolidada: 308 testes aprovados (51 Núcleo + 53 03.3 + 141 03.4 + 63 03.5 = 100% de sucesso)'
];
