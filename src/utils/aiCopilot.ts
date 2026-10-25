import { Transaction, RecurringExpense, CreditCardData, PaymentMethod } from '../types';
import { extractMonetaryValue, extractCreditCardName } from './financialParser';

export interface FinancialContext {
  userName: string;
  totalBalance: number;
  monthIncomes: number;
  monthExpenses: number;
  savingsRate: number;
  transactions: Transaction[];
  recurringExpenses: RecurringExpense[];
  creditCards: CreditCardData[];
}

export interface LastTransactionAction {
  type: 'remove' | 'adjust' | 'enrich' | 'none';
  actionType?: 'single_deleted' | 'multiple_found' | 'none_found' | 'history_empty';
  reply: string;
  updatedTransactions?: Transaction[];
  deletedTransactionId?: string;
  modifiedTransaction?: Transaction;
  actionableTransactions?: Transaction[];
}

// Normalizador de texto para análise fonética e semântica
function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^\w\s]/gi, ' ') // remove pontuação
    .replace(/\s+/g, ' ')
    .trim();
}

// Extrator de alvo e termo de busca para remoção
export function extractRemovalTarget(rawText: string): { isLatest: boolean; searchTerm: string } {
  const norm = normalizeText(rawText);

  // Se menciona explicitamente o último lançamento
  if (/(ultimo|ultima|que acabei de|que eu acabei|que falei|que mandei|recente|anterior)/i.test(norm)) {
    return { isLatest: true, searchTerm: 'último' };
  }

  // Remove verbos de remoção e partículas de ligação para obter o termo específico (ex: "caxias", "agua", "farmacia")
  let cleaned = norm
    .replace(/^(favor|por favor|gostaria de|quero|pode|poderia)?\s*/i, '')
    .replace(/^(remova|remover|exclua|excluir|apague|apagar|apaga|cancele|cancelar|cancela|desfazer|desfaz|deletar|deleta|tirar|tira|anular|anule|eliminar|elimine|limpar)\s*/i, '')
    .replace(/^(o|a|os|as|um|uma)?\s*(lancamento|levantamento|gasto|despesa|registro|compra|saida|entrada)?\s*/i, '')
    .replace(/^(de|da|do|em|na|no|sobre|referente a|com|para)\s*/i, '')
    .replace(/^(um|uma)?\s*/i, '')
    .trim();

  return { isLatest: false, searchTerm: cleaned || rawText.trim() };
}

// Mecanismo de busca profunda em todo o histórico de transações
export function searchTransactionsByTerm(searchTerm: string, transactions: Transaction[]): Transaction[] {
  if (!searchTerm || !transactions || transactions.length === 0) return [];
  const termNorm = normalizeText(searchTerm);
  const numVal = extractMonetaryValue(searchTerm);

  return transactions.filter(t => {
    // 1. Busca por Cidade (ex: "Caxias", "Oeiras", "Teresina")
    if (t.city && normalizeText(t.city).includes(termNorm)) return true;

    // 2. Busca por Produto (ex: "água", "gasolina", "chocolate")
    if (t.product && normalizeText(t.product).includes(termNorm)) return true;

    // 3. Busca por Estabelecimento ou Descrição (ex: "Farmácia", "Posto", "Supermercado")
    if (t.establishment && normalizeText(t.establishment).includes(termNorm)) return true;
    if (t.description && normalizeText(t.description).includes(termNorm)) return true;

    // 4. Busca por Categoria
    if (t.category && normalizeText(t.category).includes(termNorm)) return true;

    // 5. Busca por Forma de Pagamento ou Cartão
    if (t.method && normalizeText(t.method).includes(termNorm)) return true;
    if (t.cardName && normalizeText(t.cardName).includes(termNorm)) return true;

    // 6. Busca por Valor Monetário exato
    if (numVal > 0 && Math.abs(t.amount - numVal) < 0.01) return true;

    // 7. Busca por Data
    if (t.date && normalizeText(t.date).includes(termNorm)) return true;

    return false;
  });
}

// =========================================================================
// 1. DETECÇÃO ULTRA ROBUSTA: REMOVER / APAGAR / CANCELAR (ÚLTIMO OU ESPECÍFICO)
// =========================================================================
export function isRemoveTransactionCommand(rawText: string): boolean {
  if (!rawText) return false;
  const norm = normalizeText(rawText);

  // Verbos e intenções de remoção/cancelamento
  const hasRemoveVerb = /(remov|exclu|apag|cancel|desfaz|desfaca|delet|anul|elimin|retir|tirar|tira|limp|arranc|errado|nao era para|desfa)/i.test(norm);

  // Alvos de referência: último OU termos como lançamento, gasto, despesa, ou nomes de cidades, produtos, etc.
  const hasTargetRef = /(ultim|levantamento|lancamento|gasto|despesa|registro|compra|saida|entrada|isso|esse|essa|este|esta|que fiz|que eu fiz|que mandei|que falei|que acabei de|caxias|oeiras|teresina|agua|farmacia|posto|gasolina)/i.test(norm);

  // Comandos diretos e isolados
  const isDirectSingleCommand = /^(remova|remover|exclua|excluir|apague|apagar|apaga|cancele|cancelar|cancela|desfazer|desfaz|deletar|deleta|tirar|tira|anular|anule|eliminar|elimine|limpar)$/i.test(norm) ||
    /^(apagar|remover|excluir|cancelar|deletar|tirar|desfazer)\s+/i.test(norm) ||
    /^(tira|apaga|cancela|remove|exclui|desfaz)\s+/i.test(norm);

  return (hasRemoveVerb && hasTargetRef) || isDirectSingleCommand;
}

export const isRemoveLastCommand = isRemoveTransactionCommand;

// =========================================================================
// EXECUÇÃO INTELIGENTE DE REMOÇÃO: ÚLTIMO, BUSCA DIRETA OU SELEÇÃO INTERATIVA
// =========================================================================
export function executeSmartRemoveTransaction(rawText: string, transactions: Transaction[]): LastTransactionAction {
  if (!transactions || transactions.length === 0) {
    return {
      type: 'remove',
      actionType: 'history_empty',
      reply: '⚠️ **Nenhum lançamento encontrado:** Seu histórico de transações está vazio no momento, portanto não há o que remover.'
    };
  }

  const { isLatest, searchTerm } = extractRemovalTarget(rawText);

  // Caso 1: Usuário pediu para remover explicitamente o último lançamento
  if (isLatest) {
    const target = transactions[0];
    const remaining = transactions.slice(1);
    const formattedAmount = target.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const typeText = target.type === 'Entrada' ? 'Entrada (+)' : 'Saída (-)';
    const itemName = target.product || target.description || 'Lançamento avulso';
    const localName = target.establishment || target.city || 'Geral';

    return {
      type: 'remove',
      actionType: 'single_deleted',
      reply: `🗑️ **Último Lançamento Removido com Sucesso!**\n\n` +
        `• **Item Excluído:** ${itemName}\n` +
        `• **Tipo:** ${typeText}\n` +
        `• **Valor Anulado:** R$ ${formattedAmount}\n` +
        `• **Forma:** ${target.method}${target.cardName ? ` (${target.cardName})` : ''}\n` +
        `• **Local:** ${localName} (${target.city})\n\n` +
        `✅ Operação concluída: Saldo, Saídas e Entradas foram recalculados no Dashboard!`,
      updatedTransactions: remaining,
      deletedTransactionId: target.id
    };
  }

  // Caso 2: Usuário especificou um critério de busca (ex: "Caxias", "água", "farmácia")
  const matches = searchTransactionsByTerm(searchTerm, transactions);

  // 2.1 Nenhum lançamento encontrado com o termo
  if (matches.length === 0) {
    return {
      type: 'remove',
      actionType: 'none_found',
      reply: `⚠️ Não encontrei nenhum lançamento no seu histórico referente a "${searchTerm}". Você pode verificar a lista completa de despesas na aba "Lançamentos".`
    };
  }

  // 2.2 Exatamente 1 lançamento encontrado -> Remove automaticamente com confirmação!
  if (matches.length === 1) {
    const target = matches[0];
    const remaining = transactions.filter(t => t.id !== target.id);
    const formattedAmount = target.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const typeText = target.type === 'Entrada' ? 'Entrada (+)' : 'Saída (-)';

    return {
      type: 'remove',
      actionType: 'single_deleted',
      reply: `🗑️ **Lançamento Encontrado e Removido com Sucesso!**\n\n` +
        `• **Item Excluído:** ${target.product || target.description}\n` +
        `• **Tipo:** ${typeText}\n` +
        `• **Valor Anulado:** R$ ${formattedAmount}\n` +
        `• **Local / Cidade:** ${target.city}\n` +
        `• **Forma:** ${target.method}${target.cardName ? ` (${target.cardName})` : ''}\n` +
        `• **Data:** ${target.date}\n\n` +
        `✅ O Saldo Geral e seus relatórios foram recalculados instantaneamente!`,
      updatedTransactions: remaining,
      deletedTransactionId: target.id
    };
  }

  // 2.3 Múltiplos lançamentos encontrados (ex: 2 ou 3 de Caxias) -> Disponibiliza seleção interativa no chat!
  return {
    type: 'remove',
    actionType: 'multiple_found',
    reply: `🔍 **Encontrei ${matches.length} lançamentos referentes a "${searchTerm}":**\nSelecione abaixo os lançamentos que deseja cancelar ou clique diretamente no botão de excluir de cada um:`,
    actionableTransactions: matches
  };
}

export const executeRemoveLastTransaction = (transactions: Transaction[]) => 
  executeSmartRemoveTransaction('último', transactions);

// =========================================================================
// 2. DETECÇÃO ULTRA ROBUSTA: AJUSTAR / ALTERAR / MODIFICAR ÚLTIMO LANÇAMENTO
// =========================================================================
export function isAdjustLastCommand(rawText: string): boolean {
  if (!rawText) return false;
  const norm = normalizeText(rawText);

  // Não confunde com comando de remoção
  if (isRemoveLastCommand(rawText)) return false;

  const hasAdjustVerb = /(ajust|alter|mud|troc|corrij|corrig|atualiz|modific)/i.test(norm);
  const hasTargetRef = /(ultim|levantamento|lancamento|gasto|despesa|registro|compra|saida|entrada)/i.test(norm);

  const directChangePattern = /(o|a|no|na)\s+(ultimo|ultima)\s+(lancamento|levantamento|gasto|despesa)?\s*(foi|era|para|na verdade foi|muda para)/i.test(norm);

  return (hasAdjustVerb && hasTargetRef) || directChangePattern;
}

// =========================================================================
// 3. DETECÇÃO ULTRA ROBUSTA: ACRESCENTAR / ENRIQUECER ÚLTIMO LANÇAMENTO
// =========================================================================
export function isEnrichLastCommand(rawText: string): boolean {
  if (!rawText) return false;
  const norm = normalizeText(rawText);

  if (isRemoveLastCommand(rawText) || isAdjustLastCommand(rawText)) return false;

  const hasEnrichVerb = /(acrescent|adicion|coloqu|inclu|bote|bota|poe|ponha|insira)/i.test(norm);
  const hasTargetRef = /(ultim|levantamento|lancamento|registro|compra|gasto)/i.test(norm);
  const hasFieldRef = /(informacao|cidade|local|estabelecimento|produto|observacao|nota|cartao)/i.test(norm);

  return (hasEnrichVerb && (hasTargetRef || hasFieldRef));
}

// =========================================================================
// EXECUÇÃO: AJUSTAR ÚLTIMO LANÇAMENTO
// =========================================================================
export function executeAdjustLastTransaction(text: string, transactions: Transaction[]): LastTransactionAction {
  if (!transactions || transactions.length === 0) {
    return {
      type: 'adjust',
      reply: '⚠️ Não encontrei nenhum lançamento recente para ajustar.'
    };
  }

  const target = { ...transactions[0] };
  const lower = text.toLowerCase();
  const changes: string[] = [];

  // 1. Ajuste de Valor Monetário
  const newAmount = extractMonetaryValue(text);
  if (newAmount > 0 && newAmount !== target.amount) {
    const oldAmountStr = target.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const newAmountStr = newAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    target.amount = newAmount;
    changes.push(`• **Valor alterado:** de R$ ${oldAmountStr} para **R$ ${newAmountStr}**`);
  }

  // 2. Ajuste de Forma de Pagamento
  let newMethod: PaymentMethod | null = null;
  if (lower.includes('pix')) newMethod = 'PIX';
  else if (lower.includes('débito') || lower.includes('debito')) newMethod = 'Débito';
  else if (lower.includes('crédito') || lower.includes('credito') || lower.includes('cartão') || lower.includes('cartao')) newMethod = 'Crédito';
  else if (lower.includes('dinheiro') || lower.includes('espécie')) newMethod = 'Dinheiro';
  else if (lower.includes('transferência') || lower.includes('transferencia') || lower.includes('ted') || lower.includes('doc')) newMethod = 'Transferência';

  if (newMethod && newMethod !== target.method) {
    changes.push(`• **Forma de pagamento:** de ${target.method} para **${newMethod}**`);
    target.method = newMethod;
  }

  // 3. Ajuste de Cartão de Crédito
  const detectedCard = extractCreditCardName(text);
  if (detectedCard && detectedCard !== target.cardName) {
    target.cardName = detectedCard;
    target.method = 'Crédito';
    changes.push(`• **Cartão vinculado:** **${detectedCard}**`);
  }

  // 4. Ajuste de Cidade
  let newCity = '';
  if (lower.includes('oeiras') || lower.includes('oeira') || lower.includes('ostras')) newCity = 'Oeiras, PI';
  else if (lower.includes('teresina')) newCity = 'Teresina, PI';
  else if (lower.includes('caxias')) newCity = 'Caxias, MA';
  else if (lower.includes('são paulo') || lower.includes('sao paulo') || lower.includes('sp')) newCity = 'São Paulo, SP';
  else if (lower.includes('fortaleza')) newCity = 'Fortaleza, CE';
  else if (lower.includes('brasília') || lower.includes('brasilia')) newCity = 'Brasília, DF';
  else if (lower.includes('timon')) newCity = 'Timon, MA';
  else if (lower.includes('floriano')) newCity = 'Floriano, PI';
  else if (lower.includes('parnaíba') || lower.includes('parnaiba')) newCity = 'Parnaíba, PI';
  else if (lower.includes('internet')) newCity = 'Internet';

  if (newCity && newCity !== target.city) {
    changes.push(`• **Cidade / Local:** de ${target.city} para **${newCity}**`);
    target.city = newCity;
  }

  // 5. Ajuste de Estabelecimento
  const localMatch = lower.match(/(?:estabelecimento|local|loja|lugar|no|na)\s+(farm[aá]cia|supermercado|mercado|posto|padaria|restaurante|lanchonete|academia|oficina)/i);
  if (localMatch) {
    const rawEst = localMatch[1].toLowerCase();
    let estName = target.establishment || 'Estabelecimento';
    if (rawEst.includes('farm')) estName = 'Farmácia';
    else if (rawEst.includes('supermercado') || rawEst.includes('mercado')) estName = 'Supermercado';
    else if (rawEst.includes('posto')) estName = 'Posto de Combustível';
    else if (rawEst.includes('padaria')) estName = 'Padaria';
    else if (rawEst.includes('restaurante')) estName = 'Restaurante';
    else if (rawEst.includes('lanchonete')) estName = 'Lanchonete';

    if (estName !== target.establishment) {
      changes.push(`• **Estabelecimento:** de ${target.establishment || 'Geral'} para **${estName}**`);
      target.establishment = estName;
      target.description = estName;
    }
  }

  // 6. Ajuste de Produto
  const prodMatch = lower.match(/(?:produto|item|compra|comprei)\s+(?:foi|era|para)?\s*([a-zà-ÿ\s]{3,30})/i);
  if (prodMatch) {
    const rawProd = prodMatch[1].trim();
    const cleanProd = rawProd.charAt(0).toUpperCase() + rawProd.slice(1);
    if (cleanProd && cleanProd !== target.product) {
      changes.push(`• **Produto:** para **${cleanProd}**`);
      target.product = cleanProd;
      target.subcategory = cleanProd;
    }
  }

  if (changes.length === 0) {
    return {
      type: 'adjust',
      reply: `✏️ Identifiquei que você deseja ajustar o último lançamento ("${target.product || target.description}"), mas não identifiquei qual informação mudar. Exemplos de como me dizer:\n• *"Ajuste o valor para R$ 150"*\n• *"Mude para Crédito Nubank"*\n• *"Ajuste a cidade para Oeiras"*`
    };
  }

  const updatedTransactions = [target, ...transactions.slice(1)];
  const reply = `✏️ **Último Lançamento Ajustado com Sucesso!**\n\n` +
    changes.join('\n') + `\n\n` +
    `• **Resumo Atualizado:** ${target.product || target.description} (${target.type}) — R$ ${target.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} via ${target.method}${target.cardName ? ` (${target.cardName})` : ''} em ${target.city}.\n\n` +
    `✅ Seus saldos e relatórios foram recalculados automaticamente!`;

  return {
    type: 'adjust',
    reply,
    updatedTransactions,
    modifiedTransaction: target
  };
}

// =========================================================================
// EXECUÇÃO: ACRESCENTAR INFORMAÇÃO NO ÚLTIMO LANÇAMENTO
// =========================================================================
export function executeEnrichLastTransaction(text: string, transactions: Transaction[]): LastTransactionAction {
  if (!transactions || transactions.length === 0) {
    return {
      type: 'enrich',
      reply: '⚠️ Não encontrei nenhum lançamento recente para enriquecer com novas informações.'
    };
  }

  const target = { ...transactions[0] };
  const lower = text.toLowerCase();
  const additions: string[] = [];

  // 1. Acrescentar Cidade
  let addedCity = '';
  if (lower.includes('oeiras') || lower.includes('oeira') || lower.includes('ostras')) addedCity = 'Oeiras, PI';
  else if (lower.includes('teresina')) addedCity = 'Teresina, PI';
  else if (lower.includes('caxias')) addedCity = 'Caxias, MA';
  else if (lower.includes('são paulo') || lower.includes('sao paulo')) addedCity = 'São Paulo, SP';
  else if (lower.includes('fortaleza')) addedCity = 'Fortaleza, CE';
  else if (lower.includes('brasília') || lower.includes('brasilia')) addedCity = 'Brasília, DF';
  else if (lower.includes('timon')) addedCity = 'Timon, MA';
  else if (lower.includes('parnaíba') || lower.includes('parnaiba')) addedCity = 'Parnaíba, PI';
  else if (lower.includes('floriano')) addedCity = 'Floriano, PI';

  if (addedCity) {
    target.city = addedCity;
    additions.push(`• **Cidade/Local vinculada:** 📍 **${addedCity}**`);
  }

  // 2. Acrescentar Produto
  if (lower.includes('chocolate')) {
    target.product = 'Barra de chocolate';
    target.category = 'Lanche';
    additions.push(`• **Produto:** 🏷️ **Barra de chocolate** (Categoria: Lanche)`);
  } else if (lower.includes('câmera') || lower.includes('camera')) {
    target.product = 'Câmera de vigilância';
    target.category = 'Compras na Internet';
    additions.push(`• **Produto:** 🏷️ **Câmera de vigilância** (Categoria: Compras na Internet)`);
  } else if (lower.includes('água') || lower.includes('agua')) {
    target.product = 'Água mineral';
    additions.push(`• **Produto:** 🏷️ **Água mineral**`);
  } else if (lower.includes('gasolina') || lower.includes('combustível') || lower.includes('combustivel')) {
    target.product = 'Gasolina';
    target.category = 'Transporte';
    additions.push(`• **Produto:** 🏷️ **Gasolina**`);
  } else {
    const prodMatch = lower.match(/(?:produto|item)\s*(?:foi|era|de|como|é)?\s*([a-zà-ÿ0-9\s]{2,30})/i);
    if (prodMatch) {
      let rawProd = prodMatch[1].trim()
        .replace(/\b(no|na|em|de|do|da|com|para|último|ultimo|lançamento|levantamento)\b/gi, ' ')
        .trim();
      if (rawProd) {
        const cleanProd = rawProd.charAt(0).toUpperCase() + rawProd.slice(1);
        target.product = cleanProd;
        target.subcategory = cleanProd;
        additions.push(`• **Produto especificado:** 🏷️ **${cleanProd}**`);
      }
    }
  }

  // 3. Acrescentar Estabelecimento
  if (lower.includes('farmácia') || lower.includes('farmacia') || lower.includes('drogaria')) {
    target.establishment = 'Farmácia';
    target.description = 'Farmácia';
    additions.push(`• **Estabelecimento:** 🏥 **Farmácia**`);
  } else if (lower.includes('mercado') || lower.includes('supermercado')) {
    target.establishment = 'Supermercado';
    target.description = 'Supermercado';
    additions.push(`• **Estabelecimento:** 🛒 **Supermercado**`);
  } else if (lower.includes('posto')) {
    target.establishment = 'Posto de Combustível';
    target.description = 'Posto de Combustível';
    additions.push(`• **Estabelecimento:** ⛽ **Posto de Combustível**`);
  }

  // 4. Acrescentar Cartão
  const detectedCard = extractCreditCardName(text);
  if (detectedCard) {
    target.cardName = detectedCard;
    target.method = 'Crédito';
    additions.push(`• **Cartão de Crédito vinculado:** 💳 **${detectedCard}**`);
  }

  if (additions.length === 0) {
    return {
      type: 'enrich',
      reply: `➕ Entendi que deseja acrescentar detalhes ao último lançamento ("${target.product || target.description}"), mas não identifiquei qual informação adicionar. Você pode me dizer por exemplo: *"Acrescente que a cidade foi Oeiras"* ou *"Acrescente o produto chocolate"*!`
    };
  }

  const updatedTransactions = [target, ...transactions.slice(1)];
  const reply = `➕ **Informações Acrescentadas ao Último Lançamento!**\n\n` +
    additions.join('\n') + `\n\n` +
    `• **Registro Completo:**\n` +
    `  - Produto: ${target.product || 'Geral'}\n` +
    `  - Estabelecimento: ${target.establishment || target.description}\n` +
    `  - Valor: R$ ${target.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
    `  - Forma: ${target.method}${target.cardName ? ` (${target.cardName})` : ''}\n` +
    `  - Local / Cidade: ${target.city}\n\n` +
    `✅ Sincronizado na nuvem e refletido em todos os filtros e relatórios!`;

  return {
    type: 'enrich',
    reply,
    updatedTransactions,
    modifiedTransaction: target
  };
}

// =========================================================================
// 4. MOTOR COGNITIVO CONVERSACIONAL DE IA FINANCEIRA AUTOSSUFICIENTE
// =========================================================================
export function generateThinkingFinancialReply(query: string, ctx: FinancialContext): string {
  const norm = normalizeText(query);
  const lower = query.toLowerCase().trim();
  const userName = ctx.userName ? ctx.userName.split(' ')[0] : 'você';

  // 1. Diagnóstico Geral, Saldo e Saúde Financeira
  if (
    norm.includes('saldo') || 
    norm.includes('quanto tenho') || 
    norm.includes('tenho em conta') || 
    norm.includes('resumo financeiro') ||
    norm.includes('como estao minhas financas') ||
    norm.includes('como estao') ||
    norm.includes('minhas financas') ||
    norm.includes('como esta minha situacao') ||
    norm.includes('situacao financeira') ||
    norm.includes('diagnostico')
  ) {
    const statusSaldo = ctx.totalBalance > 0 
      ? '🟢 Positivo e com reserva disponível' 
      : ctx.totalBalance === 0 
      ? '🟡 Em equilíbrio exato (sem sobra)' 
      : '🔴 Atenção: saldo em déficit';

    const balStr = ctx.totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const incStr = ctx.monthIncomes.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const expStr = ctx.monthExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    return `📊 **Diagnóstico Financeiro Completo de ${ctx.userName || 'KYRO'}:**\n\n` +
      `• **Saldo Líquido Disponível:** R$ ${balStr}\n` +
      `• **Total de Entradas no Mês:** R$ ${incStr}\n` +
      `• **Total de Saídas no Mês:** R$ ${expStr}\n` +
      `• **Taxa de Poupança / Sobra:** ${ctx.savingsRate}%\n` +
      `• **Condição Atual:** ${statusSaldo}\n\n` +
      `💡 *Análise do Copiloto:* ${ctx.savingsRate >= 20 ? 'Excelente gestão! Você está conseguindo poupar mais de 20% das suas receitas.' : 'Recomendo manter atenção nos gastos avulsos para elevar sua taxa de sobra para pelo menos 20%.'}`;
  }

  // 2. Gastos por Categoria (Alimentação, Farmácia, Transporte, Vestuário, etc.)
  const categoryKeywords: Array<{ key: string; label: string; filter: (t: Transaction) => boolean }> = [
    {
      key: 'alimenta',
      label: 'Alimentação & Refeição',
      filter: (t) => t.category.toLowerCase().includes('aliment') || t.category.toLowerCase().includes('lanche') || t.category.toLowerCase().includes('supermercado')
    },
    {
      key: 'farmacia',
      label: 'Farmácia & Saúde',
      filter: (t) => t.category.toLowerCase().includes('saúde') || t.category.toLowerCase().includes('saude') || t.category.toLowerCase().includes('farmácia') || t.category.toLowerCase().includes('farmacia')
    },
    {
      key: 'transporte',
      label: 'Transporte & Combustível',
      filter: (t) => t.category.toLowerCase().includes('transporte') || t.description.toLowerCase().includes('posto') || (t.product || '').toLowerCase().includes('gasolina')
    },
    {
      key: 'vestuario',
      label: 'Vestuário & Roupas',
      filter: (t) => t.category.toLowerCase().includes('vestu') || t.category.toLowerCase().includes('roupa')
    },
    {
      key: 'internet',
      label: 'Compras na Internet / Online',
      filter: (t) => t.category.toLowerCase().includes('internet') || t.city.toLowerCase().includes('internet')
    },
    {
      key: 'viagem',
      label: 'Viagens & Passagens Aéreas',
      filter: (t) => t.category.toLowerCase().includes('passagem') || t.category.toLowerCase().includes('viagem')
    }
  ];

  for (const cat of categoryKeywords) {
    if (norm.includes(cat.key)) {
      const filtered = ctx.transactions.filter(t => t.type === 'Saída' && cat.filter(t));
      const total = filtered.reduce((sum, t) => sum + t.amount, 0);

      if (filtered.length === 0) {
        return `🏷️ **Gastos em ${cat.label}:**\nNão identifiquei nenhuma despesa registrada nesta categoria neste período.`;
      }

      const list = filtered.slice(0, 4).map(t => `• ${t.product || t.description}: R$ ${t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${t.date})`).join('\n');
      return `🏷️ **Gastos na Categoria: ${cat.label}:**\n\n${list}\n\n💰 **Total Gasto:** R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em ${filtered.length} compra${filtered.length > 1 ? 's' : ''}.`;
    }
  }

  // 3. Gastos por Cidade / Localidade
  const cities = [
    { key: 'oeiras', label: 'Oeiras, PI' },
    { key: 'caxias', label: 'Caxias, MA' },
    { key: 'teresina', label: 'Teresina, PI' },
    { key: 'sao paulo', label: 'São Paulo, SP' },
    { key: 'sp', label: 'São Paulo, SP' },
    { key: 'fortaleza', label: 'Fortaleza, CE' },
    { key: 'brasilia', label: 'Brasília, DF' },
    { key: 'timon', label: 'Timon, MA' },
    { key: 'florian', label: 'Floriano, PI' },
    { key: 'parnaiba', label: 'Parnaíba, PI' }
  ];

  for (const c of cities) {
    if (norm.includes(c.key)) {
      const cityTxs = ctx.transactions.filter(t => 
        t.type === 'Saída' && normalizeText(t.city).includes(c.key)
      );
      const total = cityTxs.reduce((sum, t) => sum + t.amount, 0);

      if (cityTxs.length === 0) {
        return `📍 **Gastos em ${c.label}:**\nNão encontrei nenhuma despesa registrada nesta cidade este mês.`;
      }

      const list = cityTxs.slice(0, 5).map(t => `• ${t.product || t.description}: R$ ${t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${t.method})`).join('\n');
      return `📍 **Gastos Registrados em ${c.label}:**\n\n${list}\n\n💰 **Total Gasto na Região:** R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${cityTxs.length} lançamento${cityTxs.length > 1 ? 's' : ''}).`;
    }
  }

  // 4. Métodos de Pagamento e Cartões de Crédito
  if (norm.includes('pix')) {
    const pixTxs = ctx.transactions.filter(t => t.type === 'Saída' && t.method === 'PIX');
    const total = pixTxs.reduce((sum, t) => sum + t.amount, 0);
    return `💸 **Gastos Realizados via PIX:**\n\nVocê já pagou **R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}** via PIX este mês (${pixTxs.length} lançamentos).`;
  }

  if (norm.includes('credito') || norm.includes('fatura') || norm.includes('cartao') || norm.includes('limite')) {
    const credTxs = ctx.transactions.filter(t => t.type === 'Saída' && t.method === 'Crédito');
    const total = credTxs.reduce((sum, t) => sum + t.amount, 0);

    const cardsDetail = ctx.creditCards.map(c => {
      const cardTotal = credTxs.filter(t => (t.cardName || '').toLowerCase() === c.name.toLowerCase()).reduce((s, t) => s + t.amount, 0);
      const limit = c.limit || 5000;
      const remaining = Math.max(0, limit - cardTotal);
      return `• **Cartão ${c.name}:**\n  - Fatura acumulada: R$ ${cardTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n  - Limite disponível: R$ ${remaining.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n  - Vencimento da fatura: Dia ${c.dueDay}`;
    }).join('\n\n');

    return `💳 **Situação dos seus Cartões de Crédito & Faturas:**\n\n` +
      `• **Total Geral em Faturas:** R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n` +
      (cardsDetail ? `${cardsDetail}\n\n` : '') +
      `📌 *Importante:* Seus limites são restabelecidos automaticamente conforme os pagamentos das faturas forem confirmados.`;
  }

  // 5. Dívidas Recorrentes / Parcelamentos Pendentes
  if (norm.includes('recorrente') || norm.includes('parcela') || norm.includes('divida') || norm.includes('contas a pagar') || norm.includes('pendente')) {
    const pending = ctx.recurringExpenses.filter(r => !r.paid && r.active);
    const totalPending = pending.reduce((sum, r) => sum + (r.installmentAmount || r.totalAmount), 0);

    if (pending.length === 0) {
      return `🎉 **Parabéns, ${userName}!** Você não tem nenhuma dívida recorrente pendente no momento. Todas as suas contas cadastradas já foram pagas.`;
    }

    const list = pending.map(r => `• **${r.title}:** R$ ${r.installmentAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${r.dueDateText || `Dia ${r.dueDateDay}`})`).join('\n');
    return `🔁 **Suas Dívidas Recorrentes e Contas a Vencer:**\n\n${list}\n\n` +
      `💰 **Compromisso Total Previsto:** R$ ${totalPending.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n` +
      `📌 *Regra de Controle:* Esses valores ficam protegidos e só saem do seu saldo quando você disser que pagou (ex: *"Paguei ${pending[0].title}"*).`;
  }

  // 6. Maior Gasto Registrado
  if (norm.includes('maior gasto') || norm.includes('onde gastei mais') || norm.includes('qual o maior') || norm.includes('maior despesa')) {
    const expenses = ctx.transactions.filter(t => t.type === 'Saída').sort((a, b) => b.amount - a.amount);
    if (expenses.length === 0) {
      return 'Você ainda não possui despesas cadastradas neste período.';
    }
    const top = expenses[0];
    const pct = Math.round((top.amount / (ctx.monthExpenses || 1)) * 100);
    return `🚨 **Seu Maior Gasto Registrado:**\n\n` +
      `• **Item:** ${top.product || top.description}\n` +
      `• **Valor:** R$ ${top.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
      `• **Estabelecimento:** ${top.establishment || top.description}\n` +
      `• **Forma:** ${top.method}${top.cardName ? ` (${top.cardName})` : ''}\n` +
      `• **Local:** ${top.city}\n\n` +
      `💡 Esta despesa isolada corresponde a aproximadamente **${pct}%** de todos os seus gastos deste mês.`;
  }

  // 7. Consultoria: Posso gastar? / Avaliação de Viabilidade
  if (norm.includes('posso gastar') || norm.includes('posso comprar') || norm.includes('devo gastar') || norm.includes('tenho dinheiro para')) {
    const val = extractMonetaryValue(query);
    if (val > 0) {
      if (val > ctx.totalBalance) {
        return `⚠️ **Recomendação Prudente:**\nVocê consultou sobre um gasto de **R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**, porém seu saldo líquido disponível é de **R$ ${ctx.totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**.\nEssa compra deixaria sua conta no negativo ou comprometeria recursos essenciais. Sugiro adiar a compra ou buscar alternativas.`;
      } else if (val > ctx.totalBalance * 0.4) {
        return `🤔 **Atenção:** Um gasto de **R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}** consumiria cerca de ${Math.round((val / ctx.totalBalance) * 100)}% de todo o seu saldo líquido atual (R$ ${ctx.totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}). Se tiver compromissos fixos até o fim do mês, tenha cautela!`;
      } else {
        return `✅ **Compra Aprovada pelo Planejamento:** O valor de **R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}** é compatível com seu saldo líquido atual (R$ ${ctx.totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}). Após a compra, você ainda preservará uma margem segura de R$ ${(ctx.totalBalance - val).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`;
      }
    }
  }

  // 8. Dicas e Estratégia de Economia
  if (norm.includes('dica') || norm.includes('como economizar') || norm.includes('ajuda para economizar') || norm.includes('conselho')) {
    return `🧠 **Conselho Estratégico do Copiloto KYRO:**\n\n` +
      `1. **Regra 50-30-20:** Direcione 50% para necessidades básicas, 30% para gastos pessoais e 20% para sua reserva de oportunidade.\n` +
      `2. **Acompanhamento Diário:** Continue ditando ou enviando comprovantes aqui para mantermos seus gráficos sempre em dia.\n` +
      `3. **Dívidas Recorrentes:** Priorize a liquidação de contas que cobram juros rotativos. Sua taxa de sobra atual é de **${ctx.savingsRate}%**.`;
  }

  // 9. Saudações e Apresentação
  if (norm.includes('ola') || norm.includes('bom dia') || norm.includes('boa tarde') || norm.includes('boa noite') || norm.includes('oi') || norm.includes('quem e voce') || norm.includes('o que voce faz')) {
    return `Olá, ${userName}! Sou seu **Copiloto Financeiro Inteligente KYRO**.\n\n` +
      `Estou conectado às suas finanças em tempo real (Saldo atual: **R$ ${ctx.totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**).\n\n` +
      `🎯 **O que posso fazer por você agora:**\n` +
      `• **Lançar:** Fale ou envie áudio de qualquer gasto ou ganho;\n` +
      `• **Corrigir:** Diga *"remova o último lançamento"* ou *"ajuste o valor para R$ X"* se algo estiver errado;\n` +
      `• **Consultar:** Pergunte *"quanto gastei em Oeiras?"*, *"qual meu saldo?"* ou *"quanto gastei no cartão?"*;\n` +
      `• **Analisar Comprovantes:** Clique em **+** para enviar fotos ou PDFs, ou na **Câmera** para foto direta.\n\n` +
      `Como posso te ajudar hoje?`;
  }

  // 10. Resposta Cognitiva Geral (Sem Respostas Padrões Engessadas)
  return `Entendido, ${userName}! Analisei sua mensagem no contexto das suas finanças atuais (Saldo Disponível: **R$ ${ctx.totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}** e Total de Saídas: **R$ ${ctx.monthExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**).\n\n` +
    `Você pode ditar novos gastos e ganhos, solicitar relatórios de despesas por cidade ou categoria, gerenciar cartões ou dar comandos de correção (como *"remova o último lançamento"*). Estou à sua disposição!`;
}
