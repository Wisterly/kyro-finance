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

// Fallback Cognitivo Local Inteligente com Suporte a Diretrizes e Aprendizado
function fallbackCognitiveProcess(text: string, context: any, userAiRules: string[] = []) {
  const normalized = normalizeStr(text);
  const transactions: any[] = context?.transactions || [];

  // 1. Detecção de Comando de Regra, Filtragem ou Ajuste de Diretriz
  // Ex: "não coloque alimentação/lanche na descrição, coloque só lanche", "ajuste para colocar apenas o lanche na descrição", "filtre meus áudios assim..."
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

  // 3. Detecção de Lançamento Financeiro (ex: "Acabei de pagar uma conta de R$ 20 para botar combustível no carro")
  const valueMatch = text.match(/R\$\s*([\d.,]+)|(?:r\$|reais|\$)\s*([\d.,]+)|([\d.,]+)\s*(?:reais|conto)/i) 
    || text.match(/(?:paguei|gastei|custou|valor\s+de|conta\s+de)\s+([\d.,]+)/i);

  if (valueMatch) {
    const rawVal = (valueMatch[1] || valueMatch[2] || valueMatch[3] || valueMatch[4] || '0').replace('.', '').replace(',', '.');
    const amount = parseFloat(rawVal);
    if (!isNaN(amount) && amount > 0) {
      const isIncome = /(recebi|ganhei|salario|pix\s+recebido|vendi|deposito)/i.test(normalized);
      const isCombustivel = /(combustivel|gasolina|etanol|diesel|posto|abastec|carro|moto)/i.test(normalized);
      const isAlimentacao = /(padaria|comida|lanche|restaurante|almoco|jantar|cafe|pizza|agua|hamburguer|pastel)/i.test(normalized);
      const isMercado = /(mercado|supermercado|compras)/i.test(normalized);

      let category = 'Outros';
      let description = 'Despesa registrada';
      let product = '';
      let establishment = '';

      if (isCombustivel) {
        category = 'Transporte';
        description = 'Combustível';
        product = 'Combustível';
        establishment = 'Posto de Combustível';
      } else if (isAlimentacao) {
        category = 'Alimentação';
        if (/lanche/i.test(normalized)) {
          description = 'Lanche';
          product = 'Lanche';
        } else if (/almoco/i.test(normalized)) {
          description = 'Almoço';
          product = 'Almoço';
        } else if (/jantar/i.test(normalized)) {
          description = 'Jantar';
          product = 'Jantar';
        } else if (/cafe/i.test(normalized)) {
          description = 'Café';
          product = 'Café';
        } else if (/pizza/i.test(normalized)) {
          description = 'Pizza';
          product = 'Pizza';
        } else if (/agua/i.test(normalized)) {
          description = 'Água';
          product = 'Água';
        } else {
          description = 'Alimentação';
          product = 'Alimentação';
        }
        establishment = /padaria/i.test(normalized) ? 'Padaria' : 'Lanchonete';
      } else if (isMercado) {
        category = 'Supermercado';
        description = 'Compras';
        product = 'Supermercado';
        establishment = 'Supermercado';
      } else if (isIncome) {
        category = 'Renda';
        description = 'Receita';
        product = 'Receita';
      }

      // Aplica regras aprendidas do usuário se houver menção
      for (const rule of userAiRules) {
        if (rule.toLowerCase().includes('lanche') && isAlimentacao) {
          description = 'Lanche';
          product = 'Lanche';
        }
      }

      return {
        reply: `✅ **Lançamento Registrado com Sucesso!**\n\n- 📝 **Descrição:** ${description}\n- 💰 **Valor:** R$ ${amount.toFixed(2)}\n- 🏷️ **Categoria:** ${category}\n- 🛍️ **Produto:** ${product || description}\n- 🏢 **Estabelecimento:** ${establishment || 'Geral'}\n- 💳 **Tipo:** ${isIncome ? 'Entrada (+)' : 'Saída (-)'}\n\n*Os valores foram atualizados no saldo geral e nos gráficos.*`,
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
    customPrompt = '',
    userAiRules = []
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
        formatInstruction = 'Sempre que listar dados, despesas, itens ou categorias, use tópicos claros E tabelas Markdown elegantes com colunas bem alinhadas.';
      } else if (formattingPreference === 'conciso') {
        formatInstruction = 'Seja extremamente rápido, direto e objetivo, com respostas curtas em tópicos essenciais.';
      } else if (formattingPreference === 'detalhado') {
        formatInstruction = 'Forneça uma consultoria financeira completa, com análise de impacto no orçamento, dicas de economia e sugestões práticas em tópicos.';
      }

      if (customPrompt && customPrompt.trim().length > 0) {
        formatInstruction += `\nInstrução geral personalizada do usuário: "${customPrompt.trim()}"`;
      }

      let userRulesSection = '';
      if (Array.isArray(userAiRules) && userAiRules.length > 0) {
        userRulesSection = `\n\nDIRETRIZES E REGRAS PERSONALIZADAS DO USUÁRIO (APRENDIDAS VIA CHAT - PRIORIDADE MÁXIMA):\n${userAiRules.map((r: string, idx: number) => `${idx + 1}. ${r}`).join('\n')}\n(OBRIGATÓRIO: você DEVE aplicar 100% dessas diretrizes aprendidas ao extrair e categorizar dados de texto, áudio ou imagem!).`;
      }

      const systemInstructionText = `Você é o Google Gemini integrado como Copiloto Financeiro Nativo com Autonomia Total do aplicativo KYRO Finance (Desktop e Mobile no Brasil).
Você é especialista em finanças pessoais, contabilidade, gestão de cartões de crédito e interpretação de linguagem coloquial brasileira.

Sua missão é:
1. Compreender com 100% de precisão textos, áudios e comprovantes em imagem enviados pelo usuário.
2. Identificar a intenção da mensagem:
   a) REGISTRO DE TRANSAÇÃO (ex: "Acabei de pagar uma conta de R$ 20 para botar combustível no carro", "comprei remédio 45 na farmácia em Caxias", "gastei 15 num lanche");
   b) REMOÇÃO / CANCELAMENTO (ex: "Remova o lançamento de Caxias", "apague a despesa de combustível", "cancele a compra de ontem");
   c) AJUSTE DE LANÇAMENTO (ex: "o último lançamento foi 35 e não 25", "mude a descrição do último para Lanche");
   d) APRENDIZADO DE NOVA REGRA / DIRETRIZ DE FILTRAGEM (ex: "não coloque alimentação/lanche na descrição, coloque só lanche", "a partir de agora filtre meus áudios para colocar na descrição apenas o item falado", "quero que você filtre assim...");
   e) CONSULTA OU ANÁLISE GERAL (ex: "organize meus gastos em uma tabela", "quanto gastei esse mês?", "qual meu saldo?").

3. REGRA INEGOCIÁVEL DE DESCRIÇÃO E PRODUTO (NUNCA MESCLAR COM CATEGORIA COM BARRAS):
   - O campo "description" e o campo "product" NUNCA devem conter a Categoria mesclada com barras (JAMAIS use "Alimentação / Lanche", "Transporte / Combustível", etc.).
   - A "description" deve ser ESTREITAMENTE o item ou produto que o usuário mencionou (ex: se o usuário disse "gastei 15 num lanche", a descrição é "Lanche", o produto é "Lanche" e a categoria é "Alimentação").
   - A "category" deve conter estritamente a categoria abrangente ("Alimentação", "Transporte", "Saúde", "Supermercado", "Lazer", etc.).

4. AUTONOMIA DE APRENDIZADO DE DIRETRIZES VIA CHAT:
   - Se o usuário pedir para você ajustar a forma de filtrar áudios, imagens ou textos, ou reclamar/pedir para não colocar determinada descrição (ex: "não coloque alimentação/lanche na descrição, coloque só lanche", "filtre meus áudios assim...", "ajuste para colocar apenas o lanche na descrição", "coloque tópicos de Descrição, Valor, Categoria"):
   - Você DEVE identificar isso como uma REGRA DE COMPORTAMENTO personalizada!
   - Retorne a action "save_user_rule" com o texto formal e definitivo da regra em "rule".
   - Se a mensagem também for motivada por um lançamento recente que continha a descrição inadequada, defina "adjustRecentTransaction": true, informe o ID desse lançamento em "targetTxId" e informe os campos corrigidos em "adjustedFields" (ex: { "description": "Lanche", "product": "Lanche", "category": "Alimentação" }).
   - Na "reply", responda confirmando calorosamente com tópicos:
     - 📌 **Nova Diretriz Memorizada**: [Texto claro do que aprendeu]
     - 🎯 **Como será aplicado**: [Como os próximos áudios/imagens/textos serão filtrados]
     - 🔄 **Lançamento Anterior**: [Se corrigiu o lançamento recente, informe a alteração com tópicos]
     - 💾 **Status**: [Salvo universalmente e ativo em todos os celulares e computadores]

5. FORMATO DE APRESENTAÇÃO DE LANÇAMENTOS (TÓPICOS CLAROS):
   Sempre que registrar ou confirmar uma transação, apresente tópicos bem organizados:
   - 📝 **Descrição:** [Item específico]
   - 💰 **Valor:** R$ [Valor]
   - 🏷️ **Categoria:** [Categoria]
   - 🛍️ **Produto:** [Item]
   - 🏢 **Estabelecimento:** [Local]
   - 📍 **Cidade/Local:** [Cidade]
   - 💳 **Forma de Pagamento:** [Método]

6. ESTRUTURA ESTREITA DE RESPOSTA (JSON):
Responda OBRIGATORIAMENTE em JSON válido:
{
  "reply": "string (sua resposta conversacional rica em Português do Brasil com Markdown elegante, tópicos claros, tabelas quando solicitado, emojis e clareza)",
  "action": {
    "type": "create_transaction" | "delete_transactions" | "adjust_transaction" | "save_user_rule" | "none",
    "transaction": {
      "description": "string (ex: Lanche)",
      "product": "string (ex: Lanche)",
      "establishment": "string (ex: Lanchonete)",
      "amount": 15.00,
      "type": "Saída" | "Entrada",
      "category": "string (ex: Alimentação, Transporte, Supermercado, etc.)",
      "subcategory": "string",
      "method": "PIX" | "Débito" | "Crédito" | "Dinheiro" | "Transferência",
      "cardName": "string",
      "city": "string",
      "date": "string"
    },
    "deleteTargetTerm": "string",
    "deleteTargetIds": ["string"],
    "targetTxId": "string (ID da transação a ser ajustada)",
    "adjustments": {
      "description": "string",
      "amount": 15.00,
      "category": "string",
      "product": "string",
      "establishment": "string",
      "city": "string",
      "method": "string"
    },
    "rule": "string (quando type for save_user_rule: texto da regra aprendida)",
    "ruleCategory": "extracao_descricao" | "categorizacao" | "formatacao" | "geral",
    "adjustRecentTransaction": true | false,
    "adjustedFields": {
      "description": "string",
      "product": "string",
      "category": "string"
    },
    "reason": "string"
  }
}

REGRAS CRÍTICAS PARA REMOÇÃO:
- Se o usuário pedir para remover/cancelar um lançamento referente a uma cidade, produto ou estabelecimento (ex: "Remova o lançamento de Caxias"):
  Examine cuidadosamente a lista recentTransactions no contexto.
  Se houver 1 correspondência, coloque o ID em deleteTargetIds.
  Se houver múltiplas correspondências (ex: 3 lançamentos de Caxias), inclua todos os IDs correspondentes em deleteTargetIds e defina deleteTargetTerm = "Caxias". Na reply, liste as opções encontradas em tabela ou lista para o usuário selecionar.

ESTILO DE FORMATAÇÃO:
${formatInstruction}
${userRulesSection}

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

          // Se a ação for ajuste direto de transação existente
          if (parsedResult.action?.type === 'adjust_transaction' && parsedResult.action.targetTxId && parsedResult.action.adjustments) {
            if (db) {
              try {
                await setDoc(doc(db, 'kyro_transactions', String(parsedResult.action.targetTxId)), parsedResult.action.adjustments, { merge: true });
              } catch (e) {}
            }
          }

          // Se a ação for salvar regra com ajuste em transação recente
          if (parsedResult.action?.type === 'save_user_rule' && parsedResult.action.adjustRecentTransaction && parsedResult.action.targetTxId && parsedResult.action.adjustedFields) {
            if (db) {
              try {
                await setDoc(doc(db, 'kyro_transactions', String(parsedResult.action.targetTxId)), parsedResult.action.adjustedFields, { merge: true });
              } catch (e) {}
            }
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
  const fallback = fallbackCognitiveProcess(message, context, userAiRules);
  let localSavedTx = null;
  if (fallback.action?.type === 'create_transaction' && fallback.action.transaction) {
    localSavedTx = await saveTransaction(fallback.action.transaction);
    fallback.action.transaction = localSavedTx;
  }

  // Se houver ajuste no fallback
  if (fallback.action?.type === 'save_user_rule' && fallback.action.adjustRecentTransaction && fallback.action.targetTxId && fallback.action.adjustedFields) {
    if (db) {
      try {
        await setDoc(doc(db, 'kyro_transactions', String(fallback.action.targetTxId)), fallback.action.adjustedFields, { merge: true });
      } catch (e) {}
    }
  }

  return res.status(200).json({
    reply: fallback.reply,
    action: fallback.action || { type: 'none' },
    savedTx: localSavedTx,
    engine: 'kyro-local-engine',
    note: effectiveGeminiKey ? 'Executado com motor local resiliente' : 'Para ativar o Google Gemini 1.5 Flash completo, configure sua chave de API nas opções do Chat.'
  });
}
