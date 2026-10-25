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
  reply: string;
  updatedTransactions?: Transaction[];
  deletedTransactionId?: string;
  modifiedTransaction?: Transaction;
}

// 1. DETECÇÃO DE COMANDO PARA REMOVER O ÚLTIMO LANÇAMENTO
export function isRemoveLastCommand(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  
  const hasRemoveVerb = /(remov|exclu|apag|cancel|desfaz|desfaça|está errado|esta errado|tá errado|ta errado)/i.test(lower);
  const hasTargetRef = /(último|ultimo|última|ultima|levantamento|lançamento|lancamento|gasto|despesa|registro|que acabei de|que eu acabei)/i.test(lower);

  return (hasRemoveVerb && hasTargetRef) || 
         lower === 'remova' || 
         lower === 'excluir' || 
         lower === 'apagar último' || 
         lower === 'cancelar último';
}

// 2. DETECÇÃO DE COMANDO PARA AJUSTAR O ÚLTIMO LANÇAMENTO
export function isAdjustLastCommand(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase().trim();

  const hasAdjustVerb = /(ajust|alter|mud|troc|corrij|corrig|atualiz)/i.test(lower);
  const hasTargetRef = /(último|ultimo|última|ultima|levantamento|lançamento|lancamento|gasto|despesa|registro)/i.test(lower);

  const directChangePattern = /(?:o|a|no|na)\s+(?:último|ultimo)\s+(?:lançamento|levantamento|gasto|despesa)?\s+(?:foi|era|para|na verdade foi)\s+/i.test(lower);

  return (hasAdjustVerb && hasTargetRef) || directChangePattern;
}

// 3. DETECÇÃO DE COMANDO PARA ACRESCENTAR INFORMAÇÃO NO ÚLTIMO LANÇAMENTO
export function isEnrichLastCommand(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase().trim();

  const hasEnrichVerb = /(acrescent|adicion|coloqu|inclu|bote|põe|poe)/i.test(lower);
  const hasTargetRef = /(último|ultimo|última|ultima|levantamento|lançamento|lancamento|registro)/i.test(lower);
  const hasFieldRef = /(informação|informacao|cidade|local|estabelecimento|produto|observação|observacao|nota)/i.test(lower);

  return (hasEnrichVerb && (hasTargetRef || hasFieldRef));
}

// EXECUÇÃO: REMOVER ÚLTIMO LANÇAMENTO
export function executeRemoveLastTransaction(transactions: Transaction[]): LastTransactionAction {
  if (!transactions || transactions.length === 0) {
    return {
      type: 'remove',
      reply: '⚠️ Não encontrei nenhum lançamento financeiro recente para remover. Seu histórico está sem movimentações pendentes.'
    };
  }

  const target = transactions[0];
  const remaining = transactions.slice(1);

  const formattedAmount = target.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const typeText = target.type === 'Entrada' ? 'Entrada (+)' : 'Saída (-)';

  const reply = `🗑️ **Último Lançamento Removido com Sucesso!**\n\n` +
    `• **Tipo:** ${typeText}\n` +
    `• **Produto / Descrição:** ${target.product || target.description}\n` +
    `• **Estabelecimento:** ${target.establishment || target.description}\n` +
    `• **Valor Anulado:** R$ ${formattedAmount}\n` +
    `• **Forma de Pagamento:** ${target.method}${target.cardName ? ` (${target.cardName})` : ''}\n` +
    `• **Local / Cidade:** ${target.city}\n\n` +
    `✅ **Ajuste Concluído:** O lançamento foi excluído do histórico e o Saldo Geral, Saídas e Entradas foram recalculados no seu Dashboard!`;

  return {
    type: 'remove',
    reply,
    updatedTransactions: remaining,
    deletedTransactionId: target.id
  };
}

// EXECUÇÃO: AJUSTAR ÚLTIMO LANÇAMENTO
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
  else if (lower.includes('transferência') || lower.includes('ted') || lower.includes('doc')) newMethod = 'Transferência';

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
  else if (lower.includes('são paulo') || lower.includes('sao paulo')) newCity = 'São Paulo, SP';
  else if (lower.includes('fortaleza')) newCity = 'Fortaleza, CE';
  else if (lower.includes('brasília') || lower.includes('brasilia')) newCity = 'Brasília, DF';
  else if (lower.includes('timon')) newCity = 'Timon, MA';
  else if (lower.includes('floriano')) newCity = 'Floriano, PI';
  else if (lower.includes('parnaíba') || lower.includes('parnaiba')) newCity = 'Parnaíba, PI';
  else if (lower.includes('internet')) newCity = 'Internet';

  if (newCity && newCity !== target.city) {
    changes.push(`• **Cidade/Local:** de ${target.city} para **${newCity}**`);
    target.city = newCity;
  }

  // 5. Ajuste de Estabelecimento
  const localMatch = lower.match(/(?:estabelecimento|local|loja|lugar|para|no|na)\s+(farm[aá]cia|supermercado|mercado|posto|padaria|restaurante|lanchonete|academia|oficina)/i);
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
      reply: `ℹ️ Entendi seu pedido de ajuste no último lançamento ("${target.product || target.description}"), mas não identifiquei o dado exato a alterar. Você pode me dizer por exemplo: "Ajuste o valor para R$ 150", "Mude a forma para Débito" ou "Mude a cidade para Oeiras".`
    };
  }

  const updatedTransactions = [target, ...transactions.slice(1)];
  const reply = `✏️ **Último Lançamento Ajustado com Sucesso!**\n\n` +
    changes.join('\n') + `\n\n` +
    `• **Resumo Atual:** ${target.product || target.description} (${target.type}) — R$ ${target.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} via ${target.method}${target.cardName ? ` (${target.cardName})` : ''} em ${target.city}.\n\n` +
    `✅ Todos os cálculos de Saldo e Gráficos foram atualizados no sistema!`;

  return {
    type: 'adjust',
    reply,
    updatedTransactions,
    modifiedTransaction: target
  };
}

// EXECUÇÃO: ACRESCENTAR INFORMAÇÃO NO ÚLTIMO LANÇAMENTO
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
      reply: `ℹ️ Entendi seu desejo de enriquecer o último lançamento ("${target.product || target.description}"), mas não identifiquei a informação exata a adicionar. Você pode me dizer por exemplo: "Acrescente que a cidade foi Oeiras", "Acrescente que o produto foi chocolate" ou "Acrescente que foi na Farmácia".`
    };
  }

  const updatedTransactions = [target, ...transactions.slice(1)];
  const reply = `➕ **Informações Acrescentadas ao Último Lançamento!**\n\n` +
    additions.join('\n') + `\n\n` +
    `• **Registro Completo Atualizado:**\n` +
    `  - Produto: ${target.product || 'Não especificado'}\n` +
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

// 4. MOTOR CONVERSACIONAL DE IA COGNITIVA & CONSULTORIA FINANCEIRA
export function generateThinkingFinancialReply(query: string, ctx: FinancialContext): string {
  const lower = query.toLowerCase().trim();
  const userName = ctx.userName ? ctx.userName.split(' ')[0] : 'você';

  // 1. Consulta de Saldo e Visão Geral
  if (
    lower.includes('saldo') || 
    lower.includes('quanto tenho') || 
    lower.includes('tenho em conta') || 
    lower.includes('resumo financeiro') ||
    lower.includes('como estão minhas finanças') ||
    lower.includes('como estao minhas financas') ||
    lower.includes('como está minha situação') ||
    lower.includes('como esta minha situacao') ||
    lower.includes('minhas finanças') ||
    lower.includes('minhas financas')
  ) {
    const statusSaldo = ctx.totalBalance >= 0 ? '🟢 Positivo e saudável' : '🔴 Atenção: saldo negativo';
    return `📊 **Diagnóstico Financeiro de ${ctx.userName || 'KYRO'}:**\n\n` +
      `• **Saldo Líquido Disponível:** R$ ${ctx.totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
      `• **Total de Entradas no Mês:** R$ ${ctx.monthIncomes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
      `• **Total de Saídas no Mês:** R$ ${ctx.monthExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
      `• **Taxa de Sobra / Poupança:** ${ctx.savingsRate}%\n` +
      `• **Diagnóstico:** ${statusSaldo}\n\n` +
      `💡 *Dica do Copiloto:* Manter uma taxa de sobra acima de 20% garante a construção de reservas e estabilidade para emergências.`;
  }

  // 2. Consulta por Gastos em Cidades (Oeiras, Teresina, Caxias, etc.)
  const cities = [
    { key: 'oeiras', label: 'Oeiras, PI' },
    { key: 'caxias', label: 'Caxias, MA' },
    { key: 'teresina', label: 'Teresina, PI' },
    { key: 'são paulo', label: 'São Paulo, SP' },
    { key: 'sp', label: 'São Paulo, SP' },
    { key: 'fortaleza', label: 'Fortaleza, CE' },
    { key: 'brasília', label: 'Brasília, DF' },
    { key: 'internet', label: 'Internet / Online' }
  ];

  for (const c of cities) {
    if (lower.includes(c.key)) {
      const cityTxs = ctx.transactions.filter(t => 
        t.type === 'Saída' && t.city.toLowerCase().includes(c.key)
      );
      const total = cityTxs.reduce((sum, t) => sum + t.amount, 0);

      if (cityTxs.length === 0) {
        return `📍 **Gastos em ${c.label}:**\nNão identifiquei nenhuma despesa registrada nesta localização até o momento.`;
      }

      const list = cityTxs.slice(0, 5).map(t => `• ${t.product || t.description}: R$ ${t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${t.method})`).join('\n');
      return `📍 **Detalhamento de Gastos em ${c.label}:**\n\n${list}\n\n💰 **Total Gasto na Região:** R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${cityTxs.length} transação${cityTxs.length > 1 ? 'ões' : ''}).`;
    }
  }

  // 3. Consulta por Métodos de Pagamento (PIX, Cartão, Débito)
  if (lower.includes('pix')) {
    const pixTxs = ctx.transactions.filter(t => t.type === 'Saída' && t.method === 'PIX');
    const total = pixTxs.reduce((sum, t) => sum + t.amount, 0);
    return `💸 **Gastos via PIX:**\n\nVocê já movimentou **R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}** via PIX este mês (${pixTxs.length} saídas).`;
  }

  if (lower.includes('crédito') || lower.includes('credito') || lower.includes('fatura') || lower.includes('cartão') || lower.includes('cartao')) {
    const credTxs = ctx.transactions.filter(t => t.type === 'Saída' && t.method === 'Crédito');
    const total = credTxs.reduce((sum, t) => sum + t.amount, 0);

    const cardsDetail = ctx.creditCards.map(c => {
      const cardTotal = credTxs.filter(t => t.cardName?.toLowerCase() === c.name.toLowerCase()).reduce((s, t) => s + t.amount, 0);
      const limit = c.limit || 5000;
      const remaining = Math.max(0, limit - cardTotal);
      return `• **${c.name}:** R$ ${cardTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} na fatura (Limite Disp.: R$ ${remaining.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`;
    }).join('\n');

    return `💳 **Detalhamento das Faturas & Cartões de Crédito:**\n\n` +
      `• **Total Consolidado no Crédito:** R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n` +
      (cardsDetail ? `**Por Cartão:**\n${cardsDetail}\n\n` : '') +
      `📌 *Lembrete:* As faturas serão debitadas na data de vencimento de cada cartão.`;
  }

  // 4. Dívidas Recorrentes / Parcelamentos Pendentes
  if (lower.includes('recorrente') || lower.includes('parcela') || lower.includes('dívida') || lower.includes('divida')) {
    const pending = ctx.recurringExpenses.filter(r => !r.paid && r.active);
    const totalPending = pending.reduce((sum, r) => sum + (r.installmentAmount || r.totalAmount), 0);

    if (pending.length === 0) {
      return `🎉 **Parabéns, ${userName}!** Você não tem nenhuma dívida recorrente pendente no momento. Todas as suas contas cadastradas já foram confirmadas como pagas.`;
    }

    const list = pending.map(r => `• **${r.title}:** R$ ${r.installmentAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${r.dueDateText || `Dia ${r.dueDateDay}`})`).join('\n');
    return `🔁 **Suas Dívidas Recorrentes e Parcelamentos Pendentes:**\n\n${list}\n\n` +
      `💰 **Compromisso Próximo:** R$ ${totalPending.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
      `📌 *Importante:* Esses valores ficam protegidos e só serão subtraídos do seu saldo quando você disser que pagou (ex: "Paguei ${pending[0].title}").`;
  }

  // 5. Maior Gasto do Mês
  if (lower.includes('maior gasto') || lower.includes('onde gastei mais') || lower.includes('qual o maior')) {
    const expenses = ctx.transactions.filter(t => t.type === 'Saída').sort((a, b) => b.amount - a.amount);
    if (expenses.length === 0) {
      return 'Você ainda não possui despesas cadastradas este mês.';
    }
    const top = expenses[0];
    return `🚨 **Seu Maior Gasto Registrado:**\n\n` +
      `• **Item:** ${top.product || top.description}\n` +
      `• **Valor:** R$ ${top.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
      `• **Estabelecimento:** ${top.establishment || top.description}\n` +
      `• **Forma:** ${top.method}${top.cardName ? ` (${top.cardName})` : ''}\n` +
      `• **Local:** ${top.city}\n\n` +
      `💡 Ele representa cerca de **${Math.round((top.amount / (ctx.monthExpenses || 1)) * 100)}%** de todas as suas saídas do mês.`;
  }

  // 6. Consultoria / Dicas / "Posso gastar?"
  if (lower.includes('posso gastar') || lower.includes('posso comprar') || lower.includes('devo gastar') || lower.includes('dica')) {
    const val = extractMonetaryValue(query);
    if (val > 0) {
      if (val > ctx.totalBalance) {
        return `⚠️ **Recomendação Prudente:**\nVocê quer gastar **R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**, porém seu saldo líquido atual é de **R$ ${ctx.totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**.\nEssa compra deixaria sua conta no negativo ou comprometeria suas reservas essenciais. Sugiro adiar ou parcelar sem juros apenas se for prioridade.`;
      } else if (val > ctx.totalBalance * 0.5) {
        return `🤔 **Atenção:** Esse gasto de **R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}** compromete mais da metade do seu saldo atual (R$ ${ctx.totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}). Se tiver contas recorrentes a vencer, recomendo cautela!`;
      } else {
        return `✅ **Compra Viável:** Um gasto de **R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}** cabe dentro do seu saldo disponível (R$ ${ctx.totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}), deixando ainda uma margem segura de R$ ${(ctx.totalBalance - val).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`;
      }
    }
    return `🧠 **Dica Inteligente do Copiloto KYRO:**\nAtualmente sua taxa de poupança está em **${ctx.savingsRate}%**.\nPara otimizar suas finanças, mantenha suas despesas fixas abaixo de 50% dos seus rendimentos, dedique 30% para gastos pessoais e 20% para reserva financeira e investimentos.`;
  }

  // 7. Saudações ou Conversa Aberta
  if (lower.includes('olá') || lower.includes('ola') || lower.includes('bom dia') || lower.includes('boa tarde') || lower.includes('boa noite') || lower.includes('oi')) {
    return `Olá, ${userName}! Sou seu Copiloto Financeiro Inteligente KYRO.\n\n` +
      `Estou pronto para:\n` +
      `• 🎙️ Ouvir ou ler seus gastos e recebimentos e lançá-los na hora;\n` +
      `• ✏️ Ajustar, enriquecer ou remover lançamentos anteriores se houver algum erro;\n` +
      `• 💳 Controlar suas faturas de cartões de crédito e dívidas recorrentes;\n` +
      `• 📊 Analisar seus saldos, gastos por cidade e indicar sua saúde financeira.\n\n` +
      `Como posso te ajudar agora?`;
  }

  // Fallback Inteligente e Contextual
  return `Entendido, ${userName}! Como seu Copiloto Financeiro, estou monitorando suas finanças (Saldo: R$ ${ctx.totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).\n\n` +
    `Você pode me ditar lançamentos (ex: *"comprei um chocolate na farmácia por 12 reais no crédito Nubank"*), pedir ajustes (ex: *"remova o último lançamento"*, *"ajuste o valor do último para 20 reais"*), ou perguntar sobre suas despesas (ex: *"quanto gastei em Oeiras?"*).`;
}
