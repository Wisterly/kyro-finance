import { RecurringExpense, PaymentMethod } from '../types';

export interface ParsedFinancialResult {
  reply: string;
  isRecurring?: boolean;
  recurringData?: RecurringExpense;
  isPaymentConfirmation?: boolean;
  paymentTargetName?: string;
  cardName?: string;
  installments?: number;
  savedTx?: {
    id: string;
    description: string;
    amount: number;
    type: 'Entrada' | 'Saída';
    method: PaymentMethod;
    cardName?: string;
    category: string;
    subcategory: string;
    city: string;
    date: string;
    status: 'Concluído';
    currentInstallment?: number;
    totalInstallments?: number;
    createdAt: string;
    whatsappMsgId?: string;
  };
  object: string;
  location: string;
  city: string;
}

// Extrator de nome de Cartão de Crédito
export function extractCreditCardName(text: string): string {
  if (!text) return '';
  const lower = text.toLowerCase();
  if (lower.includes('nubank') || lower.includes('nu bank') || lower.includes('roxinho')) return 'Nubank';
  if (lower.includes('inter') || lower.includes('banco inter')) return 'Inter';
  if (lower.includes('itaú') || lower.includes('itau')) return 'Itaú';
  if (lower.includes('bradesco')) return 'Bradesco';
  if (lower.includes('santander')) return 'Santander';
  if (lower.includes('c6') || lower.includes('c6 bank')) return 'C6 Bank';
  if (lower.includes('banco do brasil') || lower.includes('bb') || lower.includes('ourocard')) return 'Banco do Brasil';
  if (lower.includes('caixa')) return 'Caixa';
  if (lower.includes('xp')) return 'XP';
  if (lower.includes('btg')) return 'BTG Pactual';
  if (lower.includes('porto seguro') || lower.includes('porto')) return 'Porto Seguro';
  if (lower.includes('mercado pago')) return 'Mercado Pago';
  if (lower.includes('picpay')) return 'PicPay';
  if (lower.includes('will') || lower.includes('will bank')) return 'Will Bank';
  if (lower.includes('neon')) return 'Neon';
  if (lower.includes('rico')) return 'Rico';
  if (lower.includes('sicredi')) return 'Sicredi';
  if (lower.includes('sicoob')) return 'Sicoob';

  // Identificação dinâmica: "cartão X" ou "no crédito X"
  const m = text.match(/(?:cart[aã]o\s+(?:de\s+cr[eé]dito\s+)?|no\s+cr[eé]dito\s+|cr[eé]dito\s+)([A-Za-zÀ-ÿ0-9]+)/i);
  if (m && m[1]) {
    const candidate = m[1].trim();
    const skipWords = ['de', 'da', 'do', 'em', 'para', 'com', 'no', 'na', 'um', 'uma', 'vezes', 'parcelas', 'pix', 'saida', 'saída'];
    if (!skipWords.includes(candidate.toLowerCase()) && candidate.length >= 2) {
      return candidate.charAt(0).toUpperCase() + candidate.slice(1);
    }
  }
  return '';
}

// Extrator de número de parcelas
export function extractInstallments(text: string): number {
  if (!text) return 1;
  const lower = text.toLowerCase();
  
  // Padrão: 3x, em 5x, 10x, 2 vezes, dividido em 4 parcelas
  const instMatch = lower.match(/(?:dividid[oa]\s*em\s*|em\s*|de\s*)?(\d+)\s*(?:x|vezes|parcelas?)/i);
  if (instMatch) {
    const num = parseInt(instMatch[1], 10);
    if (num > 1 && num <= 72) return num;
  }

  const wordNums: Record<string, number> = {
    'duas': 2, 'dois': 2, 'três': 3, 'tres': 3, 'quatro': 4, 'cinco': 5,
    'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10, 'doze': 12, 'vinte e quatro': 24
  };
  for (const [w, n] of Object.entries(wordNums)) {
    if (lower.includes(`${w} vezes`) || lower.includes(`${w} parcelas`)) {
      return n;
    }
  }
  return 1;
}

// Extrator ultra sofisticado de valores monetários (Resolve '3.200' -> 3200, decimais e números falados)
export function extractMonetaryValue(text: string): number {
  if (!text) return 0;
  const clean = text.trim();
  const lower = clean.toLowerCase();

  // Dicionário de conversão de números por extenso em português
  const wordMap: Record<string, number> = {
    'um': 1, 'uma': 1, 'dois': 2, 'duas': 2, 'três': 3, 'tres': 3, 'quatro': 4, 'cinco': 5,
    'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10, 'onze': 11, 'doze': 12, 'treze': 13,
    'quatorze': 14, 'catorze': 14, 'quinze': 15, 'dezesseis': 16, 'dezessete': 17, 'dezoito': 18, 'dezenove': 19,
    'vinte': 20, 'trinta': 30, 'quarenta': 40, 'cinquenta': 50, 'sessenta': 60, 'setenta': 70,
    'oitenta': 80, 'noventa': 90, 'cem': 100, 'cento': 100, 'duzentos': 200, 'duzentas': 200,
    'trezentos': 300, 'trezentas': 300, 'quatrocentos': 400, 'quatrocentas': 400, 'quinhentos': 500, 'quinhentas': 500,
    'seiscentos': 600, 'seiscentas': 600, 'setecentos': 700, 'setecentas': 700, 'oitocentos': 800, 'oitocentas': 800,
    'novecentos': 900, 'novecentas': 900
  };

  // Padrão A: Padrão brasileiro de milhar com ponto (ex: 3.200 ou 3.200,00 ou 15.000,50 ou 1.250)
  const brazilianThousandMatch = clean.match(/(?:r\$\s*|rs\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)/i);
  if (brazilianThousandMatch) {
    const raw = brazilianThousandMatch[1].replace(/\./g, '').replace(',', '.');
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0) return val;
  }

  // Padrão B: Padrão com separador de milhar por vírgula e ponto decimal (ex: 3,200.00 ou 3,200)
  const usThousandMatch = clean.match(/(?:r\$\s*|rs\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?)/i);
  if (usThousandMatch) {
    const raw = usThousandMatch[1].replace(/,/g, '');
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0) return val;
  }

  // Padrão C: Número com vírgula para centavos (ex: 45,50 ou 3200,50 ou 800,00)
  const commaDecimalMatch = clean.match(/(?:r\$\s*|rs\s*)?(\d+,\d{1,2})/i);
  if (commaDecimalMatch) {
    const raw = commaDecimalMatch[1].replace(',', '.');
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0) return val;
  }

  // Padrão D: Ponto decimal explícito com 1 ou 2 casas decimais (ex: 45.50 ou 45.5)
  // Nota: se tiver 3 casas após o ponto (ex: 3.200), foi capturado no Padrão A como milhar
  const dotDecimalMatch = clean.match(/(?:r\$\s*|rs\s*)?(\d+\.\d{1,2})(?!\d)/i);
  if (dotDecimalMatch) {
    const val = parseFloat(dotDecimalMatch[1]);
    if (!isNaN(val) && val > 0) return val;
  }

  // Padrão E: Inteiro simples com contexto de valor ou isolado (ex: 3200 ou 800 ou 45)
  const integerMatch = clean.match(/(?:r\$\s*|rs\s*|valor\s*(?:de\s*|pago\s*:?\s*)?)(\d+)(?:\s*(?:reais|real))?/i);
  if (integerMatch) {
    const val = parseFloat(integerMatch[1]);
    if (!isNaN(val) && val > 0) return val;
  }

  // Padrão F: Qualquer número isolado no texto
  const generalNum = clean.match(/(\d+)/);
  if (generalNum) {
    const val = parseFloat(generalNum[1]);
    if (!isNaN(val) && val > 0) return val;
  }

  // Fallback: Análise de números falados por extenso (ex: "três mil e duzentos", "oitocentos")
  let spokenTotal = 0;
  let currentGroup = 0;
  const words = lower.replace(/[^a-zà-ÿ\s]/g, ' ').split(/\s+/);
  let foundSpoken = false;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'mil') {
      foundSpoken = true;
      const mult = currentGroup === 0 ? 1 : currentGroup;
      spokenTotal += mult * 1000;
      currentGroup = 0;
    } else if (wordMap[w] !== undefined) {
      foundSpoken = true;
      currentGroup += wordMap[w];
    }
  }
  spokenTotal += currentGroup;
  if (foundSpoken && spokenTotal > 0) {
    return spokenTotal;
  }

  return 0;
}

export function parseDynamicFinancialMessage(
  text: string, 
  isAudio: boolean = false, 
  isImage: boolean = false
): ParsedFinancialResult | null {
  const clean = (text || '').trim();
  const lower = clean.toLowerCase();

  // 1. Ignora links, URLs e spam
  if (lower.includes('http://') || lower.includes('https://') || lower.includes('www.') || lower.includes('.com') || lower.includes('.br/')) {
    return null;
  }

  // 2. Extrai valor monetário com algoritmo de alta precisão
  const amount = extractMonetaryValue(clean);

  // 3. Detectar se é CONFIRMAÇÃO DE PAGAMENTO ("Paguei a passagem aérea", "Marcar empréstimo como pago")
  const isPaymentConfirm = 
    (lower.includes('paguei') || lower.includes('já paguei') || lower.includes('ja paguei') ||
     lower.includes('quitei') || lower.includes('liquidada') || lower.includes('dar baixa') ||
     lower.includes('marcar como paga') || lower.includes('marcar como pago') || lower.includes('conta paga')) &&
    !lower.includes('adicione') && !lower.includes('adicionar');

  if (isPaymentConfirm) {
    const cleanTarget = clean
      .replace(/\b(paguei|já|ja|quitei|liquidada|dar|baixa|marcar|como|paga|pago|conta|a|o|as|os|de|da|do|minha|meu)\b/gi, ' ')
      .replace(/[^\w\sÀ-ÿ]/g, '')
      .trim();

    return {
      reply: `✅ Baixa de Pagamento solicitada!\n\nProcurando dívida correspondente a "${cleanTarget}" para confirmar como PAGA e debitar das Saídas...`,
      isPaymentConfirmation: true,
      paymentTargetName: cleanTarget || clean,
      object: cleanTarget,
      location: '',
      city: ''
    };
  }

  // 4. Detecção de Cartão e Parcelamento
  const cardName = extractCreditCardName(clean);
  const detectedInstallments = extractInstallments(clean);
  const hasInstallments = detectedInstallments > 1;

  // 5. Detectar se é DÍVIDA RECORRENTE / PARCELAMENTO
  const isRecurring = 
    hasInstallments ||
    lower.includes('recorrente') || 
    lower.includes('divida recorrente') || 
    lower.includes('dívida recorrente') ||
    lower.includes('recorrentes') ||
    lower.includes('parcelada') ||
    lower.includes('parcelado') ||
    lower.includes('parcelas') ||
    lower.includes('dividida em') ||
    lower.includes('dividido em') ||
    lower.includes('mensalidade') ||
    lower.includes('todo mês') ||
    lower.includes('todo mes');

  // 6. Forma de Pagamento
  let method: PaymentMethod = 'PIX';
  if (cardName || lower.includes('crédito') || lower.includes('credito') || lower.includes('cartão') || lower.includes('cartao')) {
    method = 'Crédito';
  } else if (lower.includes('débito') || lower.includes('debito')) {
    method = 'Débito';
  } else if (lower.includes('dinheiro') || lower.includes('espécie') || lower.includes('especie')) {
    method = 'Dinheiro';
  } else if (lower.includes('transferência') || lower.includes('transferencia') || lower.includes('ted') || lower.includes('doc')) {
    method = 'Transferência';
  } else if (lower.includes('pix')) {
    method = 'PIX';
  }

  // 7. Cidade (Apenas se mencionada explicitamente! Suporte a Oeiras com alias Ostras para ditado por voz)
  let city = '';
  if (lower.includes('oeiras') || lower.includes('oeira') || lower.includes('ostras')) city = 'Oeiras, PI';
  else if (lower.includes('caxias')) city = 'Caxias, MA';
  else if (lower.includes('teresina')) city = 'Teresina, PI';
  else if (lower.includes('são paulo') || lower.includes('sao paulo')) city = 'São Paulo, SP';
  else if (lower.includes('fortaleza')) city = 'Fortaleza, CE';
  else if (lower.includes('brasília') || lower.includes('brasilia')) city = 'Brasília, DF';
  else if (lower.includes('timon')) city = 'Timon, MA';
  else if (lower.includes('parnaíba') || lower.includes('parnaiba')) city = 'Parnaíba, PI';
  else if (lower.includes('floriano')) city = 'Floriano, PI';
  else if (lower.includes('rio de janeiro')) city = 'Rio de Janeiro, RJ';

  // TRATAMENTO DEDICADO PARA DÍVIDAS RECORRENTES E PARCELAMENTOS
  if (isRecurring && amount > 0) {
    // 4.1 Extrair número de parcelas
    let totalInstallments = detectedInstallments > 1 ? detectedInstallments : 1;
    if (totalInstallments === 1) {
      const instMatch = lower.match(/(?:dividid[oa]\s*em\s*|em\s*|de\s*)(\d+)\s*(?:vezes|x|parcelas?)/i);
      if (instMatch) {
        totalInstallments = parseInt(instMatch[1], 10);
      } else {
        const wordNums: Record<string, number> = {
          'duas': 2, 'dois': 2, 'três': 3, 'tres': 3, 'quatro': 4, 'cinco': 5,
          'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10, 'doze': 12, 'vinte e quatro': 24
        };
        for (const [w, n] of Object.entries(wordNums)) {
          if (lower.includes(`${w} vezes`) || lower.includes(`${w} parcelas`)) {
            totalInstallments = n;
            break;
          }
        }
      }
    }

    // 4.2 Extrair vencimento
    let dueDateDay = 10;
    let dueDateText = '';
    const dueMatch = lower.match(/vencimento\s*(?:no\s*dia|dia|para\s*o\s*dia|em|para)?\s*(\d{1,2})(?:\s*de\s*([a-zçã]+))?/i);
    if (dueMatch) {
      dueDateDay = parseInt(dueMatch[1], 10);
      const month = dueMatch[2] ? dueMatch[2].charAt(0).toUpperCase() + dueMatch[2].slice(1).toLowerCase() : '';
      dueDateText = month ? `${dueDateDay} de ${month}` : `Dia ${dueDateDay}`;
    } else {
      const diaMatch = lower.match(/dia\s*(\d{1,2})/i);
      if (diaMatch) {
        dueDateDay = parseInt(diaMatch[1], 10);
        dueDateText = `Dia ${dueDateDay}`;
      } else {
        dueDateText = `Dia ${dueDateDay}`;
      }
    }

    // 4.3 Título e Categoria
    let title = 'Despesa Recorrente';
    let category = 'Outros';
    if (lower.includes('passagem') || lower.includes('passagens') || lower.includes('aérea') || lower.includes('aerea') || lower.includes('voo')) {
      title = 'Passagens Aéreas';
      category = 'Passagem Aérea / Viagem';
    } else if (lower.includes('empréstimo') || lower.includes('emprestimo')) {
      title = 'Empréstimo Bancário';
      category = 'Empréstimo';
    } else if (lower.includes('personal') || lower.includes('academia') || lower.includes('mensalidade')) {
      title = 'Mensalidade Academia / Treino';
      category = 'Pessoal / Mensalidade';
    } else {
      let rawTitle = clean
        .replace(/(?:r\$\s*|rs\s*)?\d+(?:[.,]\d+)?/gi, '')
        .replace(/\b(adicione|adicionar|nova|uma|divida|dívida|recorrente|no|valor|de|para|em|vezes|x|parcelas|parcelada|vencimento|dia|dezembro|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|nubank|inter|itau|itaú|bradesco|santander|c6|cartao|cartão|crédito|credito|debito|débito|pix)\b/gi, ' ')
        .replace(/[^\w\sÀ-ÿ]/g, '')
        .trim();
      if (rawTitle) {
        title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1).toLowerCase();
      }
    }

    // Cálculo inteligente de parcela vs total
    let installmentAmount = amount;
    let totalAmount = amount;
    const isExplicitPerMonth = lower.includes('parcelas de') || lower.includes('parcela de') || lower.includes('por mês') || lower.includes('por mes') || lower.includes('mensal');
    if (totalInstallments > 1) {
      if (isExplicitPerMonth) {
        installmentAmount = amount;
        totalAmount = Math.round(installmentAmount * totalInstallments * 100) / 100;
      } else {
        totalAmount = amount;
        installmentAmount = Math.round((amount / totalInstallments) * 100) / 100;
      }
    }

    const recurringData: RecurringExpense = {
      id: `rec_${Date.now()}`,
      title,
      category,
      totalAmount,
      installmentAmount,
      currentInstallment: 1,
      totalInstallments,
      city: city || 'Teresina, PI',
      method,
      cardName: cardName || (method === 'Crédito' ? 'Nubank' : undefined),
      active: true,
      dueDateDay,
      dueDateText,
      paid: false
    };

    const prefix = isAudio ? '🎙️ [Áudio de Voz]: ' : isImage ? '📄 [Comprovante Lido por IA]: ' : '💬 ';
    const cardLine = recurringData.cardName ? `\n• Cartão Vinculado: 💳 ${recurringData.cardName}` : '';
    const reply = `🔁 Dívida Recorrente / Parcelamento Adicionado ao KYRO Finance!\n\n${prefix}"${clean}"\n\n• Título: ${title}${cardLine}\n• Parcela: ${totalInstallments > 1 ? `${totalInstallments}x de ` : ''}R$ ${installmentAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${totalInstallments > 0 ? ` (1/${totalInstallments})` : ''}\n• Total da Dívida: R$ ${totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n• Forma: ${method}\n• Vencimento: ${dueDateText}\n• Status: 🟡 Pendente / A Vencer (NÃO debitada)\n\n📌 REGRA DE CONTROLE: Esta dívida fica guardada separadamente na aba de Recorrentes e Cartões de Crédito e NÃO foi descontada do seu Saldo Total. O valor só será debitado do Dashboard quando você confirmar o pagamento ("Marcar como Paga")!`;

    return {
      reply,
      isRecurring: true,
      recurringData,
      cardName: recurringData.cardName,
      installments: totalInstallments,
      object: title,
      location: '',
      city: city || ''
    };
  }

  // TRATAMENTO PARA TRANSAÇÕES AVULSAS (ENTRADA / SAÍDA)
  if (amount <= 0 || amount > 10000000) return null;

  // Tipo: Entrada ou Saída
  let type: 'Entrada' | 'Saída' = 'Saída';
  if (
    lower.includes('recebi') || lower.includes('ganhei') || lower.includes('salário') ||
    lower.includes('salario') || lower.includes('depósito') || lower.includes('deposito') ||
    lower.includes('rendimento') || lower.includes('lucro') || lower.includes('venda') ||
    lower.includes('entrada') || lower.includes('recebimento')
  ) {
    type = 'Entrada';
  }

  // Local (se mencionado)
  let location = '';
  const localMatch = lower.match(/\b(restaurante|padaria|supermercado|mercado|posto|farm[aá]cia|farmacia|lanchonete|bar|academia|oficina|loja|shopping|barbearia|sal[aá]o|salao|a[cç]ougue|acougue|hospital|cl[ií]nica|clinica|escola|banco)\b/i);
  if (localMatch) {
    const rawLocal = localMatch[1].toLowerCase();
    location = rawLocal.charAt(0).toUpperCase() + rawLocal.slice(1);
  }

  // Objeto (item consumido ou finalidade)
  let remaining = clean
    .replace(/(?:r\$\s*|rs\s*)?\d+(?:[.,]\d+)?\s*(?:reais|real)?/gi, ' ')
    .replace(/\b(fiz|fazer|gastei|gasto|paguei|pago|comprei|compra|recebi|ganhei|valor|de|em|no|na|um|uma|uns|umas|o|a|os|as|para|pra|com|por|reais|real|comprovante|transferência|pix|pagamento|benefici[aá]rio)\b/gi, ' ')
    .replace(/\b(pix|d[eé]bito|cr[eé]dito|cart[aã]o|dinheiro|transfer[eê]ncia|ted|doc)\b/gi, ' ');

  if (location) {
    remaining = remaining.replace(new RegExp(`\\b${location}\\b`, 'gi'), ' ');
  }
  if (cardName) {
    remaining = remaining.replace(new RegExp(`\\b${cardName}\\b`, 'gi'), ' ');
  }
  if (city) {
    const citySimple = city.split(',')[0].trim();
    remaining = remaining.replace(new RegExp(`\\b${citySimple}\\b`, 'gi'), ' ');
    if (citySimple.toLowerCase() === 'oeiras') {
      remaining = remaining.replace(/\bostras\b/gi, ' ');
    }
  }

  const cleanObjectWords = remaining.replace(/[^\w\sÀ-ÿ]/g, '').trim().split(/\s+/).filter(w => w.length > 1);
  let object = cleanObjectWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

  if (!object && location) object = location;
  if (!object && type === 'Entrada') object = 'Recebimento';
  if (!object && type === 'Saída') object = 'Despesa';

  const symbol = type === 'Entrada' ? '+' : '-';
  let prefix = '💬 ';
  if (isAudio) prefix = '🎙️ [Áudio de Voz]: ';
  if (isImage) prefix = '📄 [Comprovante Lido por IA]: ';

  const finalCardName = cardName || (method === 'Crédito' ? 'Nubank' : undefined);
  let methodDisplay = method === 'Crédito' && finalCardName ? `Crédito (${finalCardName})` : method;

  let reply = `⚡ Lançamento adicionado ao KYRO Finance!\n\n${prefix}"${clean}"\n\n• Tipo: ${type}\n• Objeto: ${object}\n• Valor: ${symbol} R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n• Forma: ${methodDisplay}`;

  if (method === 'Crédito' && finalCardName) {
    reply += `\n• Fatura: Adicionado à fatura do cartão ${finalCardName}`;
  }
  if (location) {
    reply += `\n• Local: ${location}`;
  }
  if (city) {
    reply += `\n• Cidade: ${city}`;
  }
  reply += `\n\n✅ Atualizado nas abas de ${type === 'Entrada' ? 'Entradas' : 'Saídas'}${method === 'Crédito' ? ' e Cartões de Crédito' : ''} e no Dashboard!`;

  const savedTx = {
    id: Date.now().toString(),
    description: object,
    amount,
    type,
    method,
    cardName: finalCardName,
    category: location || (type === 'Entrada' ? 'Recebimento' : (method === 'Crédito' ? 'Cartão de Crédito' : 'Alimentação / Geral')),
    subcategory: object,
    city: city || '',
    date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
    status: 'Concluído' as const,
    currentInstallment: 1,
    totalInstallments: 1,
    createdAt: new Date().toISOString()
  };

  return {
    reply,
    savedTx,
    cardName: finalCardName,
    installments: 1,
    object,
    location,
    city
  };
}
