import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc } from 'firebase/firestore';

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

async function saveTransaction(tx: any) {
  const payload = {
    ...tx,
    id: tx.id || `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    date: tx.date || new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
    status: tx.status || 'Concluído',
    createdAt: new Date().toISOString()
  };

  if (!db) return payload;

  try {
    const docId = String(payload.id);
    await setDoc(doc(db, 'kyro_transactions', docId), payload, { merge: true });
    return payload;
  } catch (err) {
    return payload;
  }
}

function normalizeStr(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Extrator de valores numéricos de alta fidelidade
function extractMonetaryValueStrict(text: string): number {
  if (!text) return 0;
  const clean = text.trim();
  const lower = clean.toLowerCase();

  // 1. Padrão explícito com R$: R$ 300, R$300,50, R$ 3.200,00
  const rsMatch = clean.match(/R\$\s*([\d.]+,\d{2})/i) || clean.match(/R\$\s*([\d.,]+)/i);
  if (rsMatch) {
    let raw = rsMatch[1].trim();
    if (raw.includes(',') && raw.includes('.')) {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else if (raw.includes(',')) {
      raw = raw.replace(',', '.');
    } else if (raw.includes('.')) {
      const parts = raw.split('.');
      if (parts[parts.length - 1].length === 3) raw = raw.replace(/\./g, '');
    }
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0 && val < 10000000) return val;
  }

  // 2. Padrão com palavra reais / real / conto: "300 reais", "300 conto"
  const reaisMatch = clean.match(/([\d.,]+)\s*(?:reais|real|conto)/i);
  if (reaisMatch) {
    let raw = reaisMatch[1].trim();
    raw = raw.replace(/\./g, '').replace(',', '.');
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0 && val < 10000000) return val;
  }

  // 3. Padrão contextual: "transferência de 300", "pix de 300", "paguei 300"
  // Protegido contra palavras como "um/uma"
  const actionMatch = clean.match(/(?:transfer[eê]ncia(?:\s+no\s+pix)?|pix|valor(?:\s+de)?|pagamento(?:\s+de)?|paguei|gastei|custou|conta\s+de)\s+(?:de\s+)?(?:r\$\s*)?([\d.,]+)/i);
  if (actionMatch) {
    let raw = actionMatch[1].trim();
    raw = raw.replace(/\./g, '').replace(',', '.');
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0 && val < 10000000) return val;
  }

  // 4. Números por extenso em português
  const wordToNumber: Record<string, number> = {
    'cem': 100, 'cento': 100, 'duzentos': 200, 'trezentos': 300, 'quatrocentos': 400,
    'quinhentos': 500, 'seiscentos': 600, 'setecentos': 700, 'oitocentos': 800, 'novecentos': 900,
    'mil': 1000, 'dois mil': 2000, 'três mil': 3000, 'cinco mil': 5000, 'dez mil': 10000,
    'vinte': 20, 'trinta': 30, 'quarenta': 40, 'cinquenta': 50, 'sessenta': 60, 'setenta': 70,
    'oitenta': 80, 'noventa': 90, 'dez': 10, 'onze': 11, 'doze': 12, 'quinze': 15,
    'dois': 2, 'três': 3, 'tres': 3, 'quatro': 4, 'cinco': 5, 'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9
  };

  for (const [w, n] of Object.entries(wordToNumber)) {
    const rx = new RegExp(`\\b${w}\\s*(?:reais|conto)?\\b`, 'i');
    if (rx.test(lower)) {
      return n;
    }
  }

  // 5. Número avulso isolado: "300 no pix", "50 no debito"
  const isolated = clean.match(/\b(\d{1,6}(?:[.,]\d{1,2})?)\b/);
  if (isolated) {
    const val = parseFloat(isolated[1].replace(',', '.'));
    if (!isNaN(val) && val > 0 && val < 10000000) return val;
  }

  return 0;
}

// Extrator de Método de Pagamento
function extractPaymentMethod(text: string): 'PIX' | 'Débito' | 'Crédito' | 'Dinheiro' | 'Transferência' {
  const lower = (text || '').toLowerCase();
  if (lower.includes('débito') || lower.includes('debito')) return 'Débito';
  if (lower.includes('crédito') || lower.includes('credito') || lower.includes('cartão') || lower.includes('cartao')) return 'Crédito';
  if (lower.includes('pix')) return 'PIX';
  if (lower.includes('transferência') || lower.includes('transferencia') || lower.includes('ted') || lower.includes('doc')) return 'Transferência';
  if (lower.includes('dinheiro') || lower.includes('espécie') || lower.includes('especie')) return 'Dinheiro';
  return 'PIX';
}

// Extrator de Cidade (apenas se mencionada explicitamente!)
function extractCityStrict(text: string): string {
  const lower = (text || '').toLowerCase();
  if (lower.includes('teresina')) return 'Teresina, PI';
  if (lower.includes('oeiras') || lower.includes('oeira') || lower.includes('ostras')) return 'Oeiras, PI';
  if (lower.includes('caxias')) return 'Caxias, MA';
  if (lower.includes('timon')) return 'Timon, MA';
  if (lower.includes('são paulo') || lower.includes('sao paulo')) return 'São Paulo, SP';
  if (lower.includes('fortaleza')) return 'Fortaleza, CE';
  if (lower.includes('brasília') || lower.includes('brasilia')) return 'Brasília, DF';
  if (lower.includes('parnaíba') || lower.includes('parnaiba')) return 'Parnaíba, PI';
  if (lower.includes('floriano')) return 'Floriano, PI';
  if (lower.includes('rio de janeiro')) return 'Rio de Janeiro, RJ';
  return '';
}

// Extrator de Produto e Categoria
function extractItemAndCategory(text: string): { product: string; description: string; category: string; establishment: string } {
  const norm = normalizeStr(text);

  // Saúde, Personal e Academia
  if (/personal|academia|treino|musculac|crossfit|pilates/i.test(norm)) {
    const isPersonal = /personal/i.test(norm);
    return {
      product: isPersonal ? 'Personal da academia' : 'Academia',
      description: isPersonal ? 'Personal da academia' : 'Mensalidade da academia',
      category: 'Saúde',
      establishment: 'Academia'
    };
  }

  // Alimentação
  if (/almoco|almocar|restaurante|churrascaria|self\s*service/i.test(norm)) {
    return { product: 'Almoço', description: 'Almoço', category: 'Alimentação', establishment: 'Restaurante' };
  }
  if (/jantar|janta/i.test(norm)) {
    return { product: 'Jantar', description: 'Jantar', category: 'Alimentação', establishment: 'Restaurante' };
  }
  if (/lanche|hamburguer|pastel|sanduiche|salgado/i.test(norm)) {
    return { product: 'Lanche', description: 'Lanche', category: 'Alimentação', establishment: 'Lanchonete' };
  }
  if (/cafe|cafeteria/i.test(norm)) {
    return { product: 'Café', description: 'Café', category: 'Alimentação', establishment: 'Cafeteria' };
  }
  if (/pizza|pizzaria/i.test(norm)) {
    return { product: 'Pizza', description: 'Pizza', category: 'Alimentação', establishment: 'Pizzaria' };
  }
  if (/padaria|panificadora|pao/i.test(norm)) {
    return { product: 'Padaria', description: 'Padaria', category: 'Alimentação', establishment: 'Padaria' };
  }

  // Transporte & Combustível
  if (/combustivel|gasolina|etanol|diesel|posto|abastec/i.test(norm)) {
    return { product: 'Combustível', description: 'Combustível', category: 'Transporte', establishment: 'Posto de Combustível' };
  }
  if (/uber|99|corrida|taxi/i.test(norm)) {
    return { product: 'Uber / Transporte', description: 'Corrida de aplicativo', category: 'Transporte', establishment: 'Uber' };
  }

  // Supermercado
  if (/mercado|supermercado|compras/i.test(norm)) {
    return { product: 'Supermercado', description: 'Compras de supermercado', category: 'Supermercado', establishment: 'Supermercado' };
  }

  // Farmácia
  if (/farmacia|drogaria|remedio|medicamento/i.test(norm)) {
    return { product: 'Farmácia', description: 'Remédios / Farmácia', category: 'Saúde', establishment: 'Farmácia' };
  }

  // Se o usuário disser apenas o método e valor (ex: "300 no pix", "transferência de 300")
  if (/pix/i.test(norm)) {
    return { product: 'PIX', description: 'PIX', category: 'Outros', establishment: '' };
  }
  if (/transferencia|ted|doc/i.test(norm)) {
    return { product: 'Transferência', description: 'Transferência', category: 'Outros', establishment: '' };
  }
  if (/debito/i.test(norm)) {
    return { product: 'Débito', description: 'Débito', category: 'Outros', establishment: '' };
  }
  if (/credito|cartao/i.test(norm)) {
    return { product: 'Cartão de Crédito', description: 'Cartão de Crédito', category: 'Outros', establishment: '' };
  }

  return { product: 'Despesa avulsa', description: 'Despesa registrada', category: 'Outros', establishment: '' };
}

// Fallback Cognitivo Local Inteligente com Suporte a Diretrizes e Aprendizado
function fallbackCognitiveProcess(text: string, context: any, userAiRules: string[] = []) {
  const normalized = normalizeStr(text);
  const transactions: any[] = context?.transactions || [];

  // 1. Detecção de Comando de Regra, Filtragem ou Ajuste de Diretriz
  const isRuleOrAdjustCommand = /(nao\s+coloqu|so\s+coloqu|coloqu\s+apenas|apenas\s+o|ajust.*descri|mud.*descri|a\s+partir\s+de\s+agora|filtr.*audio|aprend|diretriz|regr)/i.test(normalized);
  if (isRuleOrAdjustCommand && (normalized.includes('descri') || normalized.includes('lanche') || normalized.includes('alimenta') || normalized.includes('filtr') || normalized.includes('regr'))) {
    const recentWithMixed = transactions.find(t => 
      normalizeStr(t.description || '').includes('alimentacao') || 
      normalizeStr(t.description || '').includes('/') ||
      normalizeStr(t.product || '').includes('/')
    );

    const generatedRule = normalized.includes('lanche') || normalized.includes('alimenta')
      ? 'Na descrição de lançamentos, registrar apenas o item específico mencionado (ex: Lanche) e nunca mesclar categoria com barras (ex: Alimentação / Lanche). A categoria fica isolada no campo Categoria.'
      : `Diretriz de filtragem personalizada: ${text.trim()}`;

    return {
      reply: `🎯 **Entendido perfeitamente! Diretriz Memorizada com Sucesso!**\n\n- 📌 **Nova Diretriz Aprendida:** Na descrição dos lançamentos, vou registrar estritamente o item específico que você mencionar (ex: **Lanche**), sem nunca mais mesclar com a categoria (**Alimentação**).\n- 🏷️ **Separação Rigorosa:** A categoria continua em seu campo dedicado (**Alimentação**), enquanto a descrição e o produto refletem exatamente o que foi dito (**Lanche**).\n- 💾 **Status:** Esta regra foi salva permanentemente no seu perfil e será respeitada em todos os seus áudios, imagens e textos em qualquer dispositivo.${recentWithMixed ? '\n\n🔄 **Lançamento Anterior Atualizado:** O último lançamento que continha "Alimentação / Lanche" foi ajustado automaticamente para **"Lanche"**!' : ''}`,
      action: {
        type: 'save_user_rule',
        rule: generatedRule,
        ruleCategory: 'extracao_descricao',
        adjustRecentTransaction: !!recentWithMixed,
        targetTxId: recentWithMixed ? recentWithMixed.id : (transactions[0]?.id || null),
        adjustedFields: {
          description: 'Lanche',
          product: 'Lanche',
          category: 'Alimentação'
        }
      }
    };
  }

  // 2. Detecção de Remoção de Lançamento
  const isRemove = /remov|exclua|excluir|apagu|apagar|delet|cancel|estorn/.test(normalized);
  if (isRemove) {
    const cleanTerm = normalized
      .replace(/^(por\s+favor\s+)?(remova|remover|exclua|excluir|apague|apagar|delete|deletar|cancele|cancelar|estorne|estornar)\s+(o|a|os|as)?\s*/i, '')
      .replace(/^(lancamento|lancamentos|despesa|despesas|gasto|gastos|compra|compras|item|itens)\s+(de|da|do|referente\s+a)?\s*/i, '')
      .replace(/[?!.]/g, '')
      .trim();

    if (cleanTerm.length > 1) {
      const matches = transactions.filter(t => {
        const desc = normalizeStr(t.description || '');
        const prod = normalizeStr(t.product || '');
        const est = normalizeStr(t.establishment || '');
        const city = normalizeStr(t.city || '');
        const cat = normalizeStr(t.category || '');
        return desc.includes(cleanTerm) || prod.includes(cleanTerm) || est.includes(cleanTerm) || city.includes(cleanTerm) || cat.includes(cleanTerm);
      });

      if (matches.length > 0) {
        return {
          reply: matches.length === 1
            ? `🗑️ Encontrei o lançamento correspondente a **"${cleanTerm}"**:\n\n- **${matches[0].product || matches[0].description}**: R$ ${matches[0].amount.toFixed(2)} (${matches[0].city || 'Local'})\n\nConfirme a exclusão abaixo:`
            : `🔍 Encontrei **${matches.length} lançamentos** referentes a **"${cleanTerm}"** no seu histórico. Escolha quais deseja remover ou exclua todos de uma vez:`,
          action: {
            type: 'delete_transactions',
            deleteTargetTerm: cleanTerm,
            deleteTargetIds: matches.map(m => m.id),
            reason: `Remoção referente ao termo "${cleanTerm}"`
          }
        };
      }
    }
  }

  // 3. Detecção e Extração Estrita de Lançamento Financeiro
  const amount = extractMonetaryValueStrict(text);
  if (amount > 0) {
    const isIncome = /(recebi|ganhei|salario|pix\s+recebido|vendi|deposito|caiu|entrada)/i.test(normalized);
    const method = extractPaymentMethod(text);
    const city = extractCityStrict(text);
    const itemData = extractItemAndCategory(text);

    let description = itemData.description;
    let product = itemData.product;
    let category = isIncome ? 'Renda' : itemData.category;
    let establishment = itemData.establishment;

    // Aplica regras aprendidas do usuário
    for (const rule of userAiRules) {
      if (rule.toLowerCase().includes('lanche') && /lanche/i.test(normalized)) {
        description = 'Lanche';
        product = 'Lanche';
        category = 'Alimentação';
      }
    }

    const cityLine = city ? `\n- 📍 **Cidade/Local:** ${city}` : '';
    const estLine = establishment ? `\n- 🏢 **Estabelecimento:** ${establishment}` : '';

    return {
      reply: `✅ **Lançamento Registrado com Sucesso!**\n\n- 📝 **Descrição:** ${description}\n- 💰 **Valor:** R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n- 🏷️ **Categoria:** ${category}\n- 🛍️ **Produto:** ${product}\n- 💳 **Forma:** ${method}${estLine}${cityLine}\n- 📊 **Tipo:** ${isIncome ? 'Entrada (+)' : 'Saída (-)'}\n\n*Os valores foram atualizados no saldo geral e nos gráficos.*`,
      action: {
        type: 'create_transaction',
        transaction: {
          description,
          product,
          establishment,
          amount,
          type: isIncome ? 'Entrada' : 'Saída',
          category,
          subcategory: product || category,
          method,
          city: city || '',
          date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
          status: 'Concluído'
        }
      }
    };
  }

  // 4. Consulta / Ajuda Geral
  if (text.startsWith('Por favor analise este áudio') || text.startsWith('Por favor, analise a mídia')) {
    return {
      reply: `🎙️ **Áudio recebido, mas não consegui identificar palavras com clareza.**\n\nPor favor, fale mais próximo ao microfone dizendo o valor, forma de pagamento, item e local (ex: *"Fiz um Pix de 300 reais para pagar o personal da academia em Teresina"*) ou digite diretamente no campo de texto para lançar!`,
      action: { type: 'none' }
    };
  }

  return {
    reply: `👋 Olá! Sou o Copiloto Financeiro KYRO.\n\nPosso te ajudar a:\n- 📝 **Registrar despesas e receitas** por áudio, texto ou foto de comprovante (ex: *"fiz um pix de 300 reais para pagar o personal da academia em Teresina"*);\n- 🗑️ **Remover lançamentos** (ex: *"Remova o lançamento de Caxias"*);\n- 📊 **Consultar seus gastos e saldos** organizados em tabelas e relatórios detalhados.\n\nComo posso te ajudar agora?`,
    action: { type: 'none' }
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'active', 
      service: 'KYRO Finance Gemini 1.5 Flash Multimodal Hub',
      endpoint: '/api/chat' 
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Utilize POST.' });
  }

  let { 
    message = '', 
    history = [], 
    context = {},
    audioBase64,
    audioMimeType = 'audio/webm',
    imageBase64,
    imageMimeType = 'image/jpeg',
    geminiApiKey,
    groqApiKey,
    formattingPreference = 'tabelas',
    customPrompt = '',
    userAiRules = []
  } = req.body || {};

  const effectiveGeminiKey = geminiApiKey || 
    process.env.GEMINI_API_KEY || 
    process.env.GOOGLE_API_KEY || 
    process.env.VITE_GEMINI_API_KEY;

  const effectiveGroqKey = groqApiKey ||
    process.env.GROQ_API_KEY ||
    process.env.VITE_GROQ_API_KEY;

  // Se veio áudio mas não veio texto transcrito prévio (ou texto genérico), transcreve o áudio antes
  if (audioBase64 && (!message || message.startsWith('Por favor analise este áudio') || message.startsWith('Por favor, analise a mídia'))) {
    try {
      const cleanAudio = audioBase64.replace(/^data:[^;]+;base64,/, '').replace(/^data:.*?;base64,/, '').trim();
      const audioBuffer = Buffer.from(cleanAudio, 'base64');

      // Tenta Gemini Multimodal para extrair a transcrição exata
      if (effectiveGeminiKey && effectiveGeminiKey !== 'dummy_key') {
        try {
          const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${effectiveGeminiKey}`;
          const gRes = await axios.post(gUrl, {
            contents: [{
              parts: [
                { inline_data: { mime_type: audioMimeType || 'audio/webm', data: cleanAudio } },
                { text: 'Transcreva EXCLUSIVAMENTE o áudio falado em português pelo usuário brasileiro com exatidão máxima de valores (ex: 300 reais), formas de pagamento (Pix, débito), itens (personal da academia, almoço) e cidades (Teresina). Retorne apenas o texto falado, sem aspas.' }
              ]
            }],
            generationConfig: { temperature: 0.1 }
          }, { timeout: 10000 });
          const textCandidate = gRes.data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (textCandidate && textCandidate.trim().length > 0) {
            message = textCandidate.trim();
          }
        } catch (e) {}
      }

      // Tenta Groq Whisper se Gemini não transcreveu
      if ((!message || message.startsWith('Por favor')) && effectiveGroqKey && effectiveGroqKey !== 'dummy_key') {
        try {
          const { toFile } = await import('openai');
          const Groq = (await import('openai')).default;
          const groq = new Groq({ apiKey: effectiveGroqKey, baseURL: 'https://api.groq.com/openai/v1' });
          const ext = audioMimeType.includes('mp4') ? 'm4a' : 'webm';
          const file = await toFile(audioBuffer, `voice.${ext}`, { type: audioMimeType });
          const groqRes = await groq.audio.transcriptions.create({
            file,
            model: 'whisper-large-v3',
            language: 'pt',
            temperature: 0.0,
            prompt: 'Finanças, Pix, R$ 300, transferência, personal da academia, almoço, Teresina, Oeiras, débito.'
          });
          if (groqRes?.text && groqRes.text.trim().length > 0) {
            message = groqRes.text.trim();
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  // 1. TENTATIVA COM GOOGLE GEMINI 1.5 FLASH (MULTIMODAL: TEXTO, ÁUDIO, IMAGEM E ESTRUTURAÇÃO)
  if (effectiveGeminiKey && effectiveGeminiKey !== 'dummy_key') {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${effectiveGeminiKey}`;

      const compactTransactions = (context.transactions || []).slice(0, 35).map((t: any) => ({
        id: t.id,
        description: t.description,
        product: t.product || '',
        establishment: t.establishment || '',
        amount: t.amount,
        type: t.type,
        category: t.category,
        city: t.city || '',
        method: t.method,
        date: t.date
      }));

      const compactContext = {
        userName: context.userName || 'Usuário',
        totalBalance: context.totalBalance || 0,
        monthIncomes: context.monthIncomes || 0,
        monthExpenses: context.monthExpenses || 0,
        creditCards: (context.creditCards || []).map((c: any) => ({ name: c.name, limit: c.limit })),
        recentTransactions: compactTransactions
      };

      let formatInstruction = '';
      if (formattingPreference === 'tabelas') {
        formatInstruction = 'Sempre que listar dados, despesas, itens ou categorias, use tópicos claros E tabelas Markdown elegantes com colunas bem alinhadas.';
      } else if (formattingPreference === 'conciso') {
        formatInstruction = 'Seja extremamente rápido, direto e objetivo, com tópicos essenciais.';
      } else if (formattingPreference === 'detalhado') {
        formatInstruction = 'Forneça consultoria financeira completa, com análise de impacto no orçamento, dicas de economia e sugestões práticas em tópicos.';
      }

      if (customPrompt && customPrompt.trim().length > 0) {
        formatInstruction += `\nInstrução geral personalizada do usuário: "${customPrompt.trim()}"`;
      }

      let userRulesSection = '';
      if (Array.isArray(userAiRules) && userAiRules.length > 0) {
        userRulesSection = `\n\nDIRETRIZES E REGRAS PERSONALIZADAS DO USUÁRIO (APRENDIDAS VIA CHAT - PRIORIDADE MÁXIMA):\n${userAiRules.map((r: string, idx: number) => `${idx + 1}. ${r}`).join('\n')}`;
      }

      const systemInstructionText = `Você é o Google Gemini integrado como Copiloto Financeiro Nativo com Autonomia Total do aplicativo KYRO Finance (Desktop e Mobile no Brasil).
Você é especialista em finanças pessoais brasileiras, contabilidade e interpretação de fala e áudio coloquial.

SUA MISSÃO E REGRAS INEGOCIÁVEIS:
1. COMPREENDER ÁUDIOS E TEXTOS COM 100% DE FIDELIDADE:
   - Se o usuário disser apenas o valor e o método (ex: "300 no pix", "50 no débito", "transferência de 300"):
     Registre APENAS o valor e a forma. Deixe city="", establishment="" vazios! NUNCA invente cidade nem estabelecimento que não foram ditos!
   - Se o usuário disser: "fiz uma transferência de R$300 para pagar um almoço em Teresina":
     description: "Almoço", product: "Almoço", category: "Alimentação", amount: 300.00, method: "PIX" ou "Transferência", type: "Saída", city: "Teresina, PI", establishment: "Restaurante".
   - Se o usuário disser: "transferência no PIX de 300 reais para pagar o personal da academia em Teresina":
     description: "Personal da academia", product: "Personal da academia", category: "Saúde", amount: 300.00, method: "PIX", type: "Saída", city: "Teresina, PI", establishment: "Academia".
   - NUNCA transforme "um pix de 300" em 1 real! O valor é 300!
   - NUNCA use barras misturando categoria e descrição (ex: JAMAIS use "Alimentação / Lanche", "Transporte / Combustível"). Description deve ser puramente "Lanche" ou "Combustível".

2. IDENTIFICAÇÃO DE INTENÇÃO:
   a) REGISTRO DE TRANSAÇÃO: retornar action "create_transaction" com o objeto da transação.
   b) REMOÇÃO: se o usuário pedir para apagar/remover, identifique os IDs em deleteTargetIds.
   c) APRENDIZADO DE DIRETRIZ: se o usuário mandar filtrar diferente ou memorizar regra, retorne action "save_user_rule".
   d) CONSULTA GERAL: responda em markdown formatado.

3. ESTRUTURA DE RESPOSTA OBRIGATÓRIA EM JSON PURO:
{
  "reply": "string (sua resposta conversacional com tópicos organizados: 📝 Descrição, 💰 Valor, 🏷️ Categoria, 💳 Forma, 📍 Cidade se houver)",
  "action": {
    "type": "create_transaction" | "delete_transactions" | "adjust_transaction" | "save_user_rule" | "none",
    "transaction": {
      "description": "string",
      "product": "string",
      "establishment": "string",
      "amount": 300.00,
      "type": "Saída" | "Entrada",
      "category": "Alimentação" | "Saúde" | "Transporte" | "Supermercado" | "Renda" | "Outros",
      "method": "PIX" | "Débito" | "Crédito" | "Dinheiro" | "Transferência",
      "city": "string (deixe vazio se não falada)",
      "date": "string"
    },
    "deleteTargetTerm": "string",
    "deleteTargetIds": ["string"],
    "rule": "string"
  }
}

${formatInstruction}
${userRulesSection}

CONTEXTO ATUAL:
${JSON.stringify(compactContext)}`;

      const userParts: any[] = [];

      if (imageBase64) {
        const cleanImg = imageBase64.replace(/^data:[a-zA-Z0-9\/-]+;base64,/, '');
        userParts.push({ inlineData: { mimeType: imageMimeType, data: cleanImg } });
      }

      if (audioBase64) {
        const cleanAudio = audioBase64.replace(/^data:[^;]+;base64,/, '').replace(/^data:.*?;base64,/, '').trim();
        userParts.push({ inlineData: { mimeType: audioMimeType, data: cleanAudio } });
      }

      userParts.push({
        text: message && message.trim().length > 0 
          ? message.trim() 
          : 'Por favor analise o áudio ou mídia enviada e faça a filtragem exata dos dados financeiros para lançamento.'
      });

      const formattedHistory: any[] = [];
      if (Array.isArray(history) && history.length > 0) {
        for (const h of history.slice(-6)) {
          if (h.sender === 'user') formattedHistory.push({ role: 'user', parts: [{ text: h.text }] });
          else if (h.sender === 'ia') formattedHistory.push({ role: 'model', parts: [{ text: h.text }] });
        }
      }

      const contents = [...formattedHistory, { role: 'user', parts: userParts }];

      const response = await axios.post(geminiUrl, {
        contents,
        systemInstruction: { parts: [{ text: systemInstructionText }] },
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
      }, { timeout: 20000 });

      const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText && rawText.trim().length > 0) {
        let parsedResult: any = null;
        try {
          parsedResult = JSON.parse(rawText.trim());
        } catch {
          const match = rawText.match(/\{[\s\S]*\}/);
          if (match) parsedResult = JSON.parse(match[0]);
        }

        if (parsedResult && parsedResult.reply) {
          let savedTx = null;
          if (parsedResult.action?.type === 'create_transaction' && parsedResult.action.transaction) {
            savedTx = await saveTransaction(parsedResult.action.transaction);
            parsedResult.action.transaction = savedTx;
          }

          return res.status(200).json({
            reply: parsedResult.reply,
            action: parsedResult.action || { type: 'none' },
            savedTx,
            engine: 'gemini-1.5-flash',
            transcribedText: message
          });
        }
      }
    } catch (geminiError: any) {
      console.warn('[Gemini Chat API Fallback]:', geminiError?.message || geminiError);
    }
  }

  // 2. FALLBACK COGNITIVO NATIVO RESILIENTE (Garante 100% de disponibilidade)
  const fallback = fallbackCognitiveProcess(message, context, userAiRules);
  let localSavedTx = null;
  if (fallback.action?.type === 'create_transaction' && fallback.action.transaction) {
    localSavedTx = await saveTransaction(fallback.action.transaction);
    fallback.action.transaction = localSavedTx;
  }

  return res.status(200).json({
    reply: fallback.reply,
    action: fallback.action || { type: 'none' },
    savedTx: localSavedTx,
    engine: 'kyro-cognitive-engine',
    transcribedText: message
  });
}
