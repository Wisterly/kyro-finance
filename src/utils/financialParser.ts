export interface ParsedFinancialResult {
  reply: string;
  savedTx: {
    id: string;
    description: string;
    amount: number;
    type: 'Entrada' | 'Saída';
    method: 'PIX' | 'Débito' | 'Crédito' | 'Dinheiro' | 'Transferência';
    category: string;
    subcategory: string;
    city: string;
    date: string;
    status: 'Concluído';
    createdAt: string;
    whatsappMsgId?: string;
  };
  object: string;
  location: string;
  city: string;
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

  // 2. Extrai valor monetário
  let amount = 0;
  const currencyMatch = clean.match(/(?:r\$\s*|rs\s*|valor\s*(?:de\s*|pago\s*:?\s*)?)(\d+(?:[.,]\d{1,2})?)/i) ||
                        clean.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:reais|real)/i);
  if (currencyMatch) {
    amount = parseFloat(currencyMatch[1].replace(',', '.'));
  } else {
    const numMatch = clean.match(/(\d+(?:[.,]\d{1,2})?)/);
    if (numMatch) {
      amount = parseFloat(numMatch[1].replace(',', '.'));
    }
  }

  if (isNaN(amount) || amount <= 0 || amount > 10000000) return null;

  // 3. Tipo: Entrada ou Saída
  let type: 'Entrada' | 'Saída' = 'Saída';
  if (
    lower.includes('recebi') || lower.includes('ganhei') || lower.includes('salário') ||
    lower.includes('salario') || lower.includes('depósito') || lower.includes('deposito') ||
    lower.includes('rendimento') || lower.includes('lucro') || lower.includes('venda') ||
    lower.includes('entrada') || lower.includes('recebimento')
  ) {
    type = 'Entrada';
  }

  // 4. Forma de Pagamento
  let method: 'PIX' | 'Débito' | 'Crédito' | 'Dinheiro' | 'Transferência' = 'PIX';
  if (lower.includes('crédito') || lower.includes('credito') || lower.includes('cartão') || lower.includes('cartao') || lower.includes('parcela')) {
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

  // 5. Local (se mencionado explicitamente)
  let location = '';
  const localMatch = lower.match(/\b(restaurante|padaria|supermercado|mercado|posto|farm[aá]cia|farmacia|lanchonete|bar|academia|oficina|loja|shopping|barbearia|sal[aá]o|salao|a[cç]ougue|acougue|hospital|cl[ií]nica|clinica|escola|banco)\b/i);
  if (localMatch) {
    const rawLocal = localMatch[1].toLowerCase();
    location = rawLocal.charAt(0).toUpperCase() + rawLocal.slice(1);
  }

  // 6. Cidade (Apenas se mencionada explicitamente! Suporte a Oeiras com alias Ostras para ditado por voz)
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

  // 7. Objeto (item consumido ou finalidade)
  let remaining = clean
    .replace(/(?:r\$\s*|rs\s*)?\d+(?:[.,]\d{1,2})?\s*(?:reais|real)?/gi, ' ')
    .replace(/\b(fiz|fazer|gastei|gasto|paguei|pago|comprei|compra|recebi|ganhei|valor|de|em|no|na|um|uma|uns|umas|o|a|os|as|para|pra|com|por|reais|real|comprovante|transferência|pix|pagamento|benefici[aá]rio)\b/gi, ' ')
    .replace(/\b(pix|d[eé]bito|cr[eé]dito|cart[aã]o|dinheiro|transfer[eê]ncia|ted|doc)\b/gi, ' ');

  if (location) {
    remaining = remaining.replace(new RegExp(`\\b${location}\\b`, 'gi'), ' ');
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

  // 8. Mensagem de Confirmação no formato padrão solicitado
  const symbol = type === 'Entrada' ? '+' : '-';
  let prefix = '💬 ';
  if (isAudio) prefix = '🎙️ [Áudio de Voz]: ';
  if (isImage) prefix = '📄 [Comprovante Lido por IA]: ';

  let reply = `⚡ Lançamento adicionado ao KYRO Finance!\n\n${prefix}"${clean}"\n\n• Tipo: ${type}\n• Objeto: ${object}\n• Valor: ${symbol} R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n• Forma: ${method}`;

  if (location) {
    reply += `\n• Local: ${location}`;
  }
  if (city) {
    reply += `\n• Cidade: ${city}`;
  }
  reply += `\n\n✅ Atualizado nas abas de ${type === 'Entrada' ? 'Entradas' : 'Saídas'} e no Dashboard!`;

  const savedTx = {
    id: Date.now().toString(),
    description: object,
    amount,
    type,
    method,
    category: location || (type === 'Entrada' ? 'Recebimento' : 'Alimentação / Geral'),
    subcategory: object,
    city: city || '',
    date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
    status: 'Concluído' as const,
    createdAt: new Date().toISOString()
  };

  return {
    reply,
    savedTx,
    object,
    location,
    city
  };
}
