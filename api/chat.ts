import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, addDoc } from 'firebase/firestore';

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
    const docRef = await addDoc(collection(db, 'kyro_transactions'), payload);
    return { ...payload, id: docRef.id };
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

// Fallback Cognitivo Local Inteligente
function fallbackCognitiveProcess(text: string, context: any) {
  const normalized = normalizeStr(text);
  const transactions: any[] = context?.transactions || [];

  // 1. Detecção de Remoção de Lançamento
  const isRemove = /remov|exclua|excluir|apagu|apagar|delet|cancel|estorn/.test(normalized);
  if (isRemove) {
    // Extrai o termo alvo
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

  // 2. Detecção de Lançamento Financeiro (ex: "Acabei de pagar uma conta de R$ 20 para botar combustível no carro")
  const valueMatch = text.match(/R\$\s*([\d.,]+)|(?:r\$|reais|\$)\s*([\d.,]+)|([\d.,]+)\s*(?:reais|conto)/i) 
    || text.match(/(?:paguei|gastei|custou|valor\s+de|conta\s+de)\s+([\d.,]+)/i);

  if (valueMatch) {
    const rawVal = (valueMatch[1] || valueMatch[2] || valueMatch[3] || valueMatch[4] || '0').replace('.', '').replace(',', '.');
    const amount = parseFloat(rawVal);
    if (!isNaN(amount) && amount > 0) {
      const isIncome = /(recebi|ganhei|salario|pix\s+recebido|vendi|deposito)/i.test(normalized);
      const isCombustivel = /(combustivel|gasolina|etanol|diesel|posto|abastec|carro|moto)/i.test(normalized);
      const isAlimentacao = /(padaria|comida|lanche|restaurante|almoco|jantar|cafe|pizza|agua)/i.test(normalized);
      const isMercado = /(mercado|supermercado|compras)/i.test(normalized);

      let category = 'Outros';
      let description = 'Despesa registrada';
      let product = '';
      let establishment = '';

      if (isCombustivel) {
        category = 'Transporte';
        description = 'Combustível para veículo';
        product = 'Combustível';
        establishment = 'Posto de Combustível';
      } else if (isAlimentacao) {
        category = 'Alimentação';
        description = 'Alimentação / Lanche';
        product = 'Alimentação';
        establishment = 'Restaurante / Padaria';
      } else if (isMercado) {
        category = 'Supermercado';
        description = 'Compras de Supermercado';
        product = 'Supermercado';
        establishment = 'Supermercado';
      } else if (isIncome) {
        category = 'Renda';
        description = 'Receita / Ganho';
        product = 'Receita';
      }

      return {
        reply: `✅ **Lançamento Registrado com Sucesso!**\n\n| Item | Detalhe |\n| :--- | :--- |\n| **Descrição** | ${description} |\n| **Valor** | R$ ${amount.toFixed(2)} |\n| **Tipo** | ${isIncome ? 'Entrada' : 'Saída'} |\n| **Categoria** | ${category} |\n\n*Os valores foram atualizados no saldo geral e nos gráficos.*`,
        action: {
          type: 'create_transaction',
          transaction: {
            description,
            product: product || description,
            establishment: establishment || 'Geral',
            amount,
            type: isIncome ? 'Entrada' : 'Saída',
            category,
            subcategory: product || category,
            method: 'PIX',
            city: 'Teresina',
            date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
            status: 'Concluído'
          }
        }
      };
    }
  }

  // 3. Consulta / Ajuda Geral
  return {
    reply: `👋 Olá! Sou o Copiloto Financeiro KYRO.\n\nPosso te ajudar a:\n- 📝 **Registrar despesas e receitas** por texto, áudio ou foto de comprovante;\n- 🗑️ **Remover lançamentos** (ex: *"Remova o lançamento de Caxias"*);\n- 📊 **Consultar seus gastos e saldos** organizados em tabelas e relatórios detalhados.\n\nComo posso te ajudar agora?`,
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

  const { 
    message = '', 
    history = [], 
    context = {},
    audioBase64,
    audioMimeType = 'audio/webm',
    imageBase64,
    imageMimeType = 'image/jpeg',
    geminiApiKey,
    formattingPreference = 'tabelas',
    customPrompt = ''
  } = req.body || {};

  const effectiveGeminiKey = geminiApiKey || 
    process.env.GEMINI_API_KEY || 
    process.env.GOOGLE_API_KEY || 
    process.env.VITE_GEMINI_API_KEY;

  // 1. TENTATIVA COM GOOGLE GEMINI 1.5 FLASH (MULTIMODAL: TEXTO, ÁUDIO, IMAGEM E FUNÇÕES)
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
        city: t.city || 'Sem cidade',
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
        formatInstruction = 'Sempre que listar dados, despesas, itens ou categorias, use TABELAS MARKDOWN elegantes e organizadas com alinhamento claro. Use tópicos e negrito.';
      } else if (formattingPreference === 'conciso') {
        formatInstruction = 'Seja extremamente rápido, direto e objetivo, com respostas curtas e sem enrolação.';
      } else if (formattingPreference === 'detalhado') {
        formatInstruction = 'Forneça uma consultoria financeira completa, com análise de impacto no orçamento, dicas de economia e sugestões práticas.';
      }

      if (customPrompt && customPrompt.trim().length > 0) {
        formatInstruction += `\nInstrução personalizada do usuário: "${customPrompt.trim()}"`;
      }

      const systemInstructionText = `Você é o Google Gemini integrado como Copiloto Financeiro Nativo do aplicativo KYRO Finance (Desktop e Mobile no Brasil).
Você é especialista em finanças pessoais, contabilidade, gestão de cartões de crédito e interpretação de linguagem coloquial brasileira.

Sua missão é:
1. Compreender com 100% de precisão textos, áudios e comprovantes em imagem enviados pelo usuário.
2. Identificar se a mensagem envolve:
   a) REGISTRO DE TRANSAÇÃO (ex: "Acabei de pagar uma conta de R$ 20 para botar combustível no carro", "comprei remédio 45 na farmácia em Caxias", "recebi 500 de um trabalho");
   b) REMOÇÃO / CANCELAMENTO (ex: "Remova o lançamento de Caxias", "apague a despesa de combustível", "cancele a compra de ontem");
   c) AJUSTE DE LANÇAMENTO (ex: "o último lançamento foi 35 e não 25");
   d) CONSULTA OU ANÁLISE GERAL (ex: "organize meus gastos em uma tabela", "quanto gastei esse mês?", "qual meu saldo?").
3. Manter consistência com os lançamentos existentes no contexto do usuário.
4. Responder OBRIGATORIAMENTE em JSON válido com a seguinte estrutura estrita:
{
  "reply": "string (sua resposta conversacional rica em Português do Brasil com Markdown elegante, tabelas quando solicitado, emojis e clareza)",
  "action": {
    "type": "create_transaction" | "delete_transactions" | "adjust_transaction" | "none",
    "transaction": {
      "description": "string (ex: Combustível no carro)",
      "product": "string (ex: Combustível)",
      "establishment": "string (ex: Posto)",
      "amount": 20.00,
      "type": "Saída" | "Entrada",
      "category": "string (ex: Transporte, Alimentação, Supermercado, Saúde, Lazer, Moradia, Salário, etc.)",
      "subcategory": "string",
      "method": "PIX" | "Débito" | "Crédito" | "Dinheiro" | "Transferência",
      "cardName": "string (se for cartão de crédito e mencionado)",
      "city": "string (ex: Caxias, Teresina, Oeiras ou detectada)",
      "date": "string (ex: 29 de out.)"
    },
    "deleteTargetTerm": "string (termo buscado para exclusão, ex: Caxias)",
    "deleteTargetIds": ["string"] (IDs dos lançamentos correspondentes identificados no recentTransactions),
    "reason": "string (justificativa breve da ação)"
  }
}

REGRAS CRÍTICAS PARA REMOÇÃO:
- Se o usuário pedir para remover/cancelar um lançamento referente a uma cidade, produto ou estabelecimento (ex: "Remova o lançamento de Caxias"):
  Examine cuidadosamente a lista recentTransactions no contexto.
  Se houver 1 correspondência, coloque o ID em deleteTargetIds.
  Se houver múltiplas correspondências (ex: 3 lançamentos de Caxias), inclua todos os IDs correspondentes em deleteTargetIds e defina deleteTargetTerm = "Caxias". Na reply, liste as opções encontradas em tabela ou lista para o usuário selecionar.

ESTILO DE FORMATAÇÃO:
${formatInstruction}

CONTEXTO FINANCEIRO DO USUÁRIO ATUAL:
${JSON.stringify(compactContext)}`;

      // Monta as partes da mensagem do usuário (multimodal: texto + áudio + imagem)
      const userParts: any[] = [];

      // Imagem de comprovante (se fornecida)
      if (imageBase64) {
        const cleanImg = imageBase64.replace(/^data:[a-zA-Z0-9\/-]+;base64,/, '');
        userParts.push({
          inlineData: {
            mimeType: imageMimeType,
            data: cleanImg
          }
        });
      }

      // Áudio gravado (se fornecido)
      if (audioBase64) {
        const cleanAudio = audioBase64.replace(/^data:[a-zA-Z0-9\/-]+;base64,/, '');
        userParts.push({
          inlineData: {
            mimeType: audioMimeType,
            data: cleanAudio
          }
        });
      }

      // Texto da mensagem
      userParts.push({
        text: message && message.trim().length > 0 
          ? message.trim() 
          : 'Por favor, analise a mídia enviada e identifique os dados financeiros.'
      });

      // Histórico recente (últimas mensagens)
      const formattedHistory: any[] = [];
      if (Array.isArray(history) && history.length > 0) {
        const recentHistory = history.slice(-6);
        for (const h of recentHistory) {
          if (h.sender === 'user') {
            formattedHistory.push({ role: 'user', parts: [{ text: h.text }] });
          } else if (h.sender === 'ia') {
            formattedHistory.push({ role: 'model', parts: [{ text: h.text }] });
          }
        }
      }

      const contents = [
        ...formattedHistory,
        { role: 'user', parts: userParts }
      ];

      const geminiPayload = {
        contents,
        systemInstruction: {
          parts: [{ text: systemInstructionText }]
        },
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json'
        }
      };

      const response = await axios.post(geminiUrl, geminiPayload, { timeout: 20000 });
      const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (rawText && rawText.trim().length > 0) {
        let parsedResult: any = null;
        try {
          parsedResult = JSON.parse(rawText.trim());
        } catch (jsonErr) {
          // Tenta extrair JSON delimitado por ```json ... ```
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsedResult = JSON.parse(jsonMatch[0]);
          }
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
            engine: 'gemini-1.5-flash'
          });
        }
      }
    } catch (geminiError: any) {
      console.warn('[Gemini 1.5 Flash API Warn]:', geminiError?.response?.data || geminiError?.message || geminiError);
    }
  }

  // 2. FALLBACK COGNITIVO NATIVO KYRO (Garante 100% de disponibilidade sem quebrar)
  const fallback = fallbackCognitiveProcess(message, context);
  let localSavedTx = null;
  if (fallback.action?.type === 'create_transaction' && fallback.action.transaction) {
    localSavedTx = await saveTransaction(fallback.action.transaction);
    fallback.action.transaction = localSavedTx;
  }

  return res.status(200).json({
    reply: fallback.reply,
    action: fallback.action || { type: 'none' },
    savedTx: localSavedTx,
    engine: 'kyro-local-engine',
    note: effectiveGeminiKey ? 'Executado com motor local resiliente' : 'Para ativar o Google Gemini 1.5 Flash completo, configure sua chave de API nas opções do Chat.'
  });
}
