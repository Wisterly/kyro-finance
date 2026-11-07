// Metadados Centrais de Versão e Auto-Update do KYRO Finance
export const APP_VERSION = '1.46';
export const APP_BUILD = 46;

export const APP_CHANGELOG = [
  'Subetapa 03.5: Saneamento de Rede Cleartext e Validação do Bridge de Voz Nativo (PR.046)',
  'Bloqueio Estrito de Cleartext: usesCleartextTraffic="false", cleartextTrafficPermitted="false" e allowMixedContent="false"',
  'Segregação de Segurança: Configurações de rede com TLS obrigatório e debug-overrides isolado',
  'Ponte Nativa de Voz Blindada: Ciclo de vida completo do NativeSpeechRecognizer com cancelamento seguro e retorno à UI',
  'Proteção Contábil contra Áudio Parcial: Zero mutações de saldo ou transações em frames parciais e callbacks duplicados',
  'Desduplicação e Limpeza de Voz: cleanAndDeduplicateTranscript eliminando repetições em tempo real',
  'Preservação da Identidade do APK: applicationId "com.kyro.finance", keystore oficial e alinhamento de versão 1.46 (Build 46)'
];
