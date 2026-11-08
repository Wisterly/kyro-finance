// Metadados Centrais de Versão e Auto-Update do KYRO Finance
export const APP_VERSION = '1.47';
export const APP_BUILD = 47;

export const APP_CHANGELOG = [
  'Subetapa 03.6: Convergência do WhatsApp com o Motor Financeiro Compartilhado (PR.047)',
  'Lote Atômico com Rollback Total: Transação atômica única no motor compartilhado (commitBatchTransactions); falha simulada reverte todo o lote',
  'Mensagem Derivada do Recibo: Confirmações ao WhatsApp montadas estritamente a partir dos recibos e dados persistidos (previsto vs realizado e campos ausentes)',
  'Evento de Mídia Emulado do Provedor: Payload nativo Baileys/Evolution (audioMessage), fronteiras simuladas controladas e rastreio de pipeline',
  'Paridade Estrita Web e WhatsApp: Mesma frase natural comitada com idêntico efeito em centavos inteiros e recibos APPLIED',
  'Segregação Formal de Pareceres: Contrato e artefato 100% homologados; aceite dinâmico Android formalmente catalogado como PENDENTE por ausência de AVD/hardware',
  'Suíte Consolidada: 460 testes aprovados (51 Núcleo + 53 03.3 + 141 03.4 + 126 03.5 + 20 Event Bridge + 69 03.6 = 100% de sucesso)'
];
