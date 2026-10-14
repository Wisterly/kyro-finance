import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI, { toFile } from 'openai';
import axios from 'axios';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';

// 1. Firebase Firestore Setup
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
};

let db: any = null;
if (firebaseConfig.apiKey && firebaseConfig.projectId) {
  try {
    const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
    db = getFirestore(app);
  } catch (e) {
    console.warn('[Firestore] Inicialização falhou:', e);
  }
}

// 2. OpenAI Setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy_key'
});

// Extrator ultra sofisticado de valores monetários (Corrige '3.200' -> 3200, decimais e números falados)
function extractMonetaryValue(text: string): number {
  if (!text) return 0;
  const clean = text.trim();
  const lower = clean.toLowerCase();

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

  // Padrão A: Padrão brasileiro de milhar com ponto (ex: 3.200 ou 3.200,00 ou 15.000,50)
  const brazilianThousandMatch = clean.match(/(?:r\$\s*|rs\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)/i);
  if (brazilianThousandMatch) {
    const raw = brazilianThousandMatch[1].replace(/\./g, '').replace(',', '.');
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0) return val;
  }

  // Padrão B: Padrão americano de milhar com vírgula (ex: 3,200.00 ou 3,200)
  const usThousandMatch = clean.match(/(?:r\$\s*|rs\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?)/i);
  if (usThousandMatch) {
    const raw = usThousandMatch[1].replace(/,/g, '');
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0) return val;
  }

  // Padrão C: Número com vírgula para centavos (ex: 45,50 ou 800,00)
  const commaDecimalMatch = clean.match(/(?:r\$\s*|rs\s*)?(\d+,\d{1,2})/i);
  if (commaDecimalMatch) {
    const raw = commaDecimalMatch[1].replace(',', '.');
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0) return val;
  }

  // Padrão D: Ponto decimal explícito com 1 ou 2 casas decimais (ex: 45.50)
  const dotDecimalMatch = clean.match(/(?:r\$\s*|rs\s*)?(\d+\.\d{1,2})(?!\d)/i);
  if (dotDecimalMatch) {
    const val = parseFloat(dotDecimalMatch[1]);
    if (!isNaN(val) && val > 0) return val;
  }

  // Padrão E: Inteiro simples (ex: 3200 ou 800 ou 45)
  const integerMatch = clean.match(/(?:r\$\s*|rs\s*|valor\s*(?:de\s*|pago\s*:?\s*)?)(\d+)(?:\s*(?:reais|real))?/i);
  if (integerMatch) {
    const val = parseFloat(integerMatch[1]);
    if (!isNaN(val) && val > 0) return val;
  }

  // Padrão F: Qualquer número isolado
  const generalNum = clean.match(/(\d+)/);
  if (generalNum) {
    const val = parseFloat(generalNum[1]);
    if (!isNaN(val) && val > 0) return val;
  }

  // Fallback: Análise de números falados por extenso ("três mil e duzentos", "oitocentos")
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

// 3. Extrator Dinâmico Inteligente (Sem inventar dados ou cidades não mencionadas)
function parseDynamicFinancialMessage(text: string, isAudio: boolean = false) {
  const clean = (text || '').trim();
  const lower = clean.toLowerCase();

  // 1. Ignora links, URLs e spam
  if (lower.includes('http://') || lower.includes('https://') || lower.includes('www.') || lower.includes('.com') || lower.includes('.br/')) {
    return null;
  }

  // 2. Extrai valor monetário com alta precisão
  const amount = extractMonetaryValue(clean);

  // 3. Detectar se é dívida recorrente / parcelada
  const isRecurring = 
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

  // 4. Detectar se é confirmação de pagamento de dívida ("paguei a passagem aérea", "quitei")
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

  // 5. Forma de Pagamento
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

  // 6. Cidade (Apenas se mencionada explicitamente)
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

  // TRATAMENTO DEDICADO PARA DÍVIDAS RECORRENTES
  if (isRecurring && amount > 0) {
    let totalInstallments = 1;
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
        .replace(/\b(adicione|adicionar|nova|uma|divida|dívida|recorrente|no|valor|de|para|em|vezes|x|parcelas|parcelada|vencimento|dia|dezembro|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro)\b/gi, ' ')
        .replace(/[^\w\sÀ-ÿ]/g, '')
        .trim();
      if (rawTitle) {
        title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1).toLowerCase();
      }
    }

    const installmentAmount = amount;
    const totalAmount = totalInstallments > 0 ? (installmentAmount * totalInstallments) : installmentAmount;

    const recurringData = {
      id: `rec_${Date.now()}`,
      title,
      category,
      totalAmount,
      installmentAmount,
      currentInstallment: 1,
      totalInstallments,
      city: city || 'Teresina, PI',
      method,
      active: true,
      dueDateDay,
      dueDateText,
      paid: false
    };

    const prefix = isAudio ? '🎙️ [Áudio de Voz]: ' : '💬 ';
    const reply = `🔁 Dívida Recorrente Adicionada com Sucesso ao KYRO Finance!\n\n${prefix}"${clean}"\n\n• Título: ${title}\n• Parcela Mensal: R$ ${installmentAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${totalInstallments > 0 ? ` (1/${totalInstallments})` : ''}\n• Total da Dívida: R$ ${totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n• Forma: ${method}\n• Vencimento: ${dueDateText}\n• Status: 🟡 Pendente / A Vencer (NÃO debitada)\n\n📌 REGRA DE CONTROLE: Esta dívida fica guardada separadamente na aba de Recorrentes e NÃO foi descontada do seu Saldo Total. O valor de - R$ ${installmentAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} só será debitado do Dashboard quando você der o OK de que ela foi paga!`;

    return {
      reply,
      isRecurring: true,
      recurringData,
      object: title,
      location: '',
      city: city || ''
    };
  }

  // TRATAMENTO PARA TRANSAÇÕES AVULSAS
  if (isNaN(amount) || amount <= 0 || amount > 10000000) return null;

  let type: 'Entrada' | 'Saída' = 'Saída';
  if (
    lower.includes('recebi') || lower.includes('ganhei') || lower.includes('salário') ||
    lower.includes('salario') || lower.includes('depósito') || lower.includes('deposito') ||
    lower.includes('rendimento') || lower.includes('lucro') || lower.includes('venda') ||
    lower.includes('entrada')
  ) {
    type = 'Entrada';
  }

  let location = '';
  const localMatch = lower.match(/\b(restaurante|padaria|supermercado|mercado|posto|farm[aá]cia|farmacia|lanchonete|bar|academia|oficina|loja|shopping|barbearia|sal[aá]o|salao|a[cç]ougue|acougue|hospital|cl[ií]nica|clinica|escola|banco)\b/i);
  if (localMatch) {
    const rawLocal = localMatch[1].toLowerCase();
    location = rawLocal.charAt(0).toUpperCase() + rawLocal.slice(1);
  }

  let remaining = clean
    .replace(/(?:r\$\s*|rs\s*)?\d+(?:[.,]\d+)?\s*(?:reais|real)?/gi, ' ')
    .replace(/\b(fiz|fazer|gastei|gasto|paguei|pago|comprei|compra|recebi|ganhei|valor|de|em|no|na|um|uma|uns|umas|o|a|os|as|para|pra|com|por|reais|real)\b/gi, ' ')
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

  if (!object && location) {
    object = location;
  }
  if (!object && type === 'Entrada') {
    object = 'Recebimento';
  }
  if (!object && type === 'Saída') {
    object = 'Despesa';
  }

  const symbol = type === 'Entrada' ? '+' : '-';
  const prefixAudio = isAudio ? '🎙️ [Áudio de Voz]: ' : '💬 ';

  let reply = `⚡ Lançamento adicionado ao KYRO Finance!\n\n${prefixAudio}"${clean}"\n\n• Tipo: ${type}\n• Objeto: ${object}\n• Valor: ${symbol} R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n• Forma: ${method}`;

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

// 4. Salvar Transação no Firestore / Memória Global
const globalAny: any = global;
if (!globalAny.__KYRO_WEBHOOK_TRANSACTIONS__) {
  globalAny.__KYRO_WEBHOOK_TRANSACTIONS__ = [];
}

async function saveTransaction(tx: any) {
  const txId = tx.id ? String(tx.id) : Date.now().toString();
  const payload = {
    ...tx,
    id: txId,
    date: tx.date || new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
    status: tx.status || 'Concluído',
    createdAt: tx.createdAt || new Date().toISOString()
  };

  // Previne duplicação em memória global por ID ou assinatura recente
  const now = new Date(payload.createdAt).getTime();
  const exists = globalAny.__KYRO_WEBHOOK_TRANSACTIONS__.some((t: any) => {
    if (String(t.id) === txId) return true;
    if (t.whatsappMsgId && payload.whatsappMsgId && t.whatsappMsgId === payload.whatsappMsgId) return true;
    const sameDesc = (t.description || '').trim().toLowerCase() === (payload.description || '').trim().toLowerCase();
    const sameAmount = Math.abs(Number(t.amount) - Number(payload.amount)) < 0.01;
    const sameType = t.type === payload.type;
    if (sameDesc && sameAmount && sameType) {
      const tTime = new Date(t.createdAt || 0).getTime();
      if (Math.abs(now - tTime) < 90000) return true;
    }
    return false;
  });

  if (exists) {
    return payload;
  }

  if (db) {
    try {
      await addDoc(collection(db, 'kyro_transactions'), payload);
    } catch (err) {
      console.warn('[Firestore] Erro ao salvar transação:', err);
    }
  }

  // Sempre armazena no buffer global em memória para sincronização imediata
  globalAny.__KYRO_WEBHOOK_TRANSACTIONS__.unshift(payload);
  if (globalAny.__KYRO_WEBHOOK_TRANSACTIONS__.length > 100) {
    globalAny.__KYRO_WEBHOOK_TRANSACTIONS__ = globalAny.__KYRO_WEBHOOK_TRANSACTIONS__.slice(0, 100);
  }

  return payload;
}

// 5. Transcrever Áudio via OpenAI Whisper
async function transcribeAudioBuffer(audioBuffer: Buffer, mimetype: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy_key') {
    return null;
  }

  try {
    const extension = mimetype.includes('ogg') || mimetype.includes('opus') ? 'ogg' : 'mp3';
    const file = await toFile(audioBuffer, `whatsapp_voice.${extension}`, {
      type: mimetype || 'audio/ogg'
    });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'pt',
      prompt: 'Controle financeiro pessoal: pagamentos, pix, cartao, despesas, mercado, salario, valores em reais.'
    });

    return transcription.text || null;
  } catch (err: any) {
    console.error('[Whisper Transcricao Erro]:', err?.message || err);
    return null;
  }
}

// 6. Baixar Áudio da Evolution API / Meta Cloud API
async function fetchAudioMedia({
  evolutionServerUrl,
  evolutionApiKey,
  evolutionInstance,
  messageId,
  audioUrl,
  metaToken
}: any): Promise<{ buffer: Buffer; mimetype: string } | null> {
  // Caso 1: Meta WhatsApp Cloud API (Graph API)
  if (audioUrl && metaToken) {
    try {
      const audioRes = await axios.get(audioUrl, {
        headers: { Authorization: `Bearer ${metaToken}`, 'User-Agent': 'curl/7.68.0' },
        responseType: 'arraybuffer',
        timeout: 10000
      });
      return { buffer: Buffer.from(audioRes.data), mimetype: 'audio/ogg' };
    } catch (e: any) {
      console.warn('[Meta Audio Download Erro]:', e?.message);
    }
  }

  // Caso 2: Evolution API (/chat/getBase64FromMediaMessage)
  if (evolutionServerUrl && evolutionApiKey && evolutionInstance && messageId) {
    try {
      const cleanUrl = evolutionServerUrl.replace(/\/$/, '');
      const mediaRes = await axios.post(
        `${cleanUrl}/chat/getBase64FromMediaMessage/${evolutionInstance}`,
        {
          message: { key: { id: messageId } },
          convertToMp4: false
        },
        {
          headers: { apikey: evolutionApiKey, 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      const base64Data = mediaRes.data?.base64 || mediaRes.data?.data;
      if (base64Data) {
        const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');
        return {
          buffer: Buffer.from(cleanBase64, 'base64'),
          mimetype: mediaRes.data?.mimetype || 'audio/ogg'
        };
      }
    } catch (e: any) {
      console.warn('[Evolution Audio Download Erro]:', e?.message);
    }
  }

  return null;
}

// 7. Enviar Mensagem de Resposta no WhatsApp
async function sendWhatsAppReply({ targetRecipient, message, serverUrl, apiKey, instance }: any) {
  const activeUrl = serverUrl || process.env.EVOLUTION_SERVER_URL;
  const activeKey = apiKey || process.env.EVOLUTION_API_KEY;
  const activeInstance = instance || process.env.EVOLUTION_INSTANCE;

  if (!activeUrl || !activeKey || !activeInstance) {
    return null;
  }

  try {
    const isGroup = String(targetRecipient).endsWith('@g.us');
    const recipientParam = isGroup ? targetRecipient : targetRecipient.replace(/\D/g, '');

    const response = await axios.post(
      `${activeUrl.replace(/\/$/, '')}/message/sendText/${activeInstance}`,
      {
        number: recipientParam,
        text: message,
        linkPreview: true
      },
      {
        headers: {
          apikey: activeKey,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      }
    );
    return response.data;
  } catch (error: any) {
    console.error('[Evolution API] Erro ao enviar resposta:', error?.response?.data || error?.message);
    return null;
  }
}

// 8. Processador de IA Multi-Provedores (Inspirado no tgpt: Provedores Gratuitos + OpenAI + Fallback)
async function queryFreeAiProvider(promptText: string): Promise<any | null> {
  // Provedor 1: Pollinations AI (Livre, sem necessidade de API Key, padrão do tgpt)
  try {
    const res = await axios.post(
      'https://text.pollinations.ai/openai',
      {
        model: 'openai',
        messages: [
          {
            role: 'system',
            content: `Você é um extrator de dados financeiros em JSON estrito.
Retorne EXCLUSIVAMENTE um objeto JSON válido (sem markdown, sem texto antes ou depois) no formato:
{
  "descricao": "string",
  "valor": number,
  "categoria": "string",
  "subcategoria": "string",
  "tipo": "Entrada" ou "Saída",
  "forma_pagamento": "PIX" | "Débito" | "Crédito" | "Dinheiro" | "Transferência",
  "cidade": "string"
}`
          },
          { role: 'user', content: promptText }
        ],
        jsonMode: true
      },
      { timeout: 4000, headers: { 'Content-Type': 'application/json' } }
    );

    const content = res.data?.choices?.[0]?.message?.content;
    if (content) {
      // Limpa qualquer bloco ```json se vier
      const cleanJson = content.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (parsed && (parsed.valor || parsed.amount)) {
        return parsed;
      }
    }
  } catch (err: any) {
    console.warn('[Free AI Provider Pollinations]:', err?.message || err);
  }

  return null;
}

async function processAssistant(userMessage: string, isAudio: boolean = false) {
  const parsed = parseDynamicFinancialMessage(userMessage, isAudio);

  if (parsed && parsed.savedTx) {
    const savedTx = await saveTransaction(parsed.savedTx);
    return {
      reply: parsed.reply,
      savedTx: savedTx || parsed.savedTx
    };
  }

  return {
    reply: null,
    savedTx: null
  };
}

// 9. Endpoint Serverless Vercel (GET para sincronização, POST para webhook)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verificação GET (WhatsApp Cloud API Challenge ou consulta do Frontend)
  if (req.method === 'GET') {
    // 1. Meta Webhook Verification Challenge
    const hubMode = req.query['hub.mode'];
    const hubToken = req.query['hub.verify_token'];
    const hubChallenge = req.query['hub.challenge'];
    const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN || 'kyro_token_seguro';

    if (hubMode === 'subscribe' && hubToken === verifyToken) {
      return res.status(200).send(hubChallenge);
    }

    // 2. Consulta de transações recentes (Firestore + Memória Global)
    let allTxs: any[] = [...(globalAny.__KYRO_WEBHOOK_TRANSACTIONS__ || [])];

    try {
      if (db) {
        const q = query(collection(db, 'kyro_transactions'), orderBy('createdAt', 'desc'), limit(50));
        const snap = await getDocs(q);
        const cloudTxs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const ids = new Set(allTxs.map(t => t.id));
        for (const ctx of cloudTxs) {
          if (!ids.has(ctx.id)) {
            allTxs.push(ctx);
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao listar Firestore:', e);
    }

    return res.status(200).json({
      status: 'active',
      transactions: allTxs,
      count: allTxs.length,
      monitoredGroup: globalAny.__KYRO_MONITORED_GROUP__ || { groupName: 'Finanças Kyro' },
      message: 'KYRO WhatsApp Financial Webhook ativo (Texto & Áudio Whisper).',
      endpoint: '/api/webhook'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Utilize POST.' });
  }

  try {
    const payload = req.body || {};

    // Suporte a ping de diagnóstico e teste de conectividade
    if (payload?.action === 'ping' || payload?.testPing === true) {
      return res.status(200).json({
        status: 'pong',
        ok: true,
        timestamp: Date.now(),
        message: 'Conexão com Webhook KYRO validada com sucesso! Rota operacional 24/7.'
      });
    }

    // Suporte a sincronização direta de transações do robô local para a nuvem
    if (payload?.action === 'sync_transactions') {
      const txsToSync = Array.isArray(payload.transactions) 
        ? payload.transactions 
        : (payload.transaction ? [payload.transaction] : []);
      
      for (const tx of txsToSync) {
        if (tx && tx.amount) {
          await saveTransaction(tx);
        }
      }

      return res.status(200).json({
        status: 'synced',
        count: globalAny.__KYRO_WEBHOOK_TRANSACTIONS__?.length || 0
      });
    }

    // Suporte a salvar/configurar o grupo monitorado
    if (payload?.action === 'set_monitored_group') {
      const g = payload.monitoredGroup || { 
        inviteLink: payload.inviteLink, 
        groupName: payload.groupName || 'Finanças Kyro',
        groupJid: payload.groupJid
      };
      globalAny.__KYRO_MONITORED_GROUP__ = g;
      return res.status(200).json({ status: 'saved', monitoredGroup: g });
    }

    const data = payload?.data || payload;

    // Ignora mensagens enviadas pelo próprio robô (fromMe)
    if (data?.key?.fromMe === true) {
      return res.status(200).json({ status: 'Ignored fromMe message' });
    }

    // Identifica remetente e destinatário
    const remoteJid = data?.key?.remoteJid || payload?.sender || payload?.number || '';
    const isGroup = String(remoteJid).endsWith('@g.us');
    const participant = data?.key?.participant || payload?.participant || remoteJid;
    const phoneNumber = String(participant).replace('@s.whatsapp.net', '').replace('@g.us', '');
    const messageId = data?.key?.id || payload?.id;

    // FILTRO ESTRITO: Apenas mensagens vindas de grupos são permitidas!
    // Mensagens diretas (DMs no privado), broadcasts e status são ignoradas sem resposta.
    if (!isGroup && payload?.testPing !== true && payload?.action !== 'ping') {
      return res.status(200).json({ 
        status: 'ignored_private_message', 
        message: 'Apenas mensagens vindas do grupo oficial Finanças Kyro são processadas.' 
      });
    }

    // 1. Extrai Texto (Evolution API, Meta Cloud API ou Twilio Sandbox)
    let messageText = 
      payload?.Body ||
      data?.message?.conversation ||
      data?.message?.extendedTextMessage?.text ||
      payload?.message?.conversation ||
      payload?.message?.extendedTextMessage?.text ||
      data?.message?.imageMessage?.caption ||
      payload?.message?.imageMessage?.caption ||
      (typeof payload?.message === 'string' ? payload.message : '') ||
      payload?.text ||
      '';

    let isAudio = false;

    // 2. Extrai e Transcreve Áudio se for mensagem de voz
    const hasAudio = !!(data?.message?.audioMessage || payload?.message?.audioMessage || payload?.audio || payload?.MediaUrl0);
    if (!messageText && hasAudio) {
      isAudio = true;
      const customServerUrl = (req.headers['x-evolution-url'] as string) || payload?.evolutionServerUrl;
      const customApiKey = (req.headers['x-evolution-key'] as string) || payload?.evolutionApiKey;
      const customInstance = (req.headers['x-evolution-instance'] as string) || payload?.evolutionInstance;

      const audioMedia = await fetchAudioMedia({
        evolutionServerUrl: customServerUrl,
        evolutionApiKey: customApiKey,
        evolutionInstance: customInstance,
        messageId
      });

      if (audioMedia?.buffer) {
        const transcribed = await transcribeAudioBuffer(audioMedia.buffer, audioMedia.mimetype);
        if (transcribed) {
          messageText = transcribed;
        }
      }

      if (!messageText) {
        messageText = '[Áudio de despesa recebido via WhatsApp]';
      }
    }

    if (!messageText || typeof messageText !== 'string' || !messageText.trim()) {
      return res.status(200).json({ status: 'No message to process' });
    }

    console.log(`[Webhook WhatsApp] ${isAudio ? '🎙️ Áudio' : '💬 Texto'} de ${phoneNumber}: "${messageText}"`);

    // 3. Processamento de IA & Gravação no Banco
    const result = await processAssistant(messageText, isAudio);

    // 4. Envia Resposta de Feedback no WhatsApp SOMENTE se foi um lançamento válido
    const customServerUrl = (req.headers['x-evolution-url'] as string) || payload?.evolutionServerUrl;
    const customApiKey = (req.headers['x-evolution-key'] as string) || payload?.evolutionApiKey;
    const customInstance = (req.headers['x-evolution-instance'] as string) || payload?.evolutionInstance;
    const targetRecipient = isGroup ? remoteJid : phoneNumber;

    // Se NÃO for transação financeira salva, NUNCA envia mensagem automática (silêncio total)
    if (result.savedTx && result.reply && targetRecipient && targetRecipient !== 'test') {
      await sendWhatsAppReply({
        targetRecipient,
        message: result.reply,
        serverUrl: customServerUrl,
        apiKey: customApiKey,
        instance: customInstance
      });
    }

    return res.status(200).json({
      status: result.savedTx ? 'success' : 'ignored_non_financial',
      replySent: result.savedTx ? result.reply : null,
      savedTx: result.savedTx,
      transcribed: isAudio ? messageText : null
    });
  } catch (error: any) {
    console.error('[Webhook Fatal Error]:', error);
    return res.status(200).json({
      status: 'error_handled',
      message: error?.message
    });
  }
}
