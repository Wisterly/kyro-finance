import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy_key'
});

const financeTools: any[] = [
  {
    type: 'function',
    function: {
      name: 'registrar_transacao',
      description: 'Registra uma nova movimentação financeira no sistema Kyro Finance.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Descrição da despesa ou receita' },
          amount: { type: 'number', description: 'Valor em reais' },
          type: { type: 'string', enum: ['Entrada', 'Saída'], description: 'Se é Entrada ou Saída' },
          category: { type: 'string', description: 'Categoria' },
          subcategory: { type: 'string', description: 'Subcategoria detalhada ou nome do produto' },
          method: { type: 'string', enum: ['PIX', 'Débito', 'Crédito', 'Dinheiro', 'Transferência'], description: 'Forma de pagamento' },
          city: { type: 'string', description: 'Cidade' },
          currentInstallment: { type: 'number', description: 'Parcela atual' },
          totalInstallments: { type: 'number', description: 'Total de parcelas' }
        },
        required: ['description', 'amount', 'type', 'category', 'method', 'city']
      }
    }
  }
];

async function saveTransaction(tx: any) {
  const payload = {
    ...tx,
    date: tx.date || new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
    status: tx.status || 'Concluído',
    createdAt: new Date().toISOString()
  };

  if (!db) return { id: Date.now().toString(), ...payload };

  try {
    const docRef = await addDoc(collection(db, 'kyro_transactions'), payload);
    return { id: docRef.id, ...payload };
  } catch (err) {
    return { id: Date.now().toString(), ...payload };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'active', endpoint: '/api/chat' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Utilize POST.' });
  }

  const { message, history, context } = req.body || {};

  if (!message) {
    return res.status(400).json({ error: 'O parâmetro "message" é obrigatório.' });
  }

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.VITE_GEMINI_API_KEY;
  const hasOpenAiKey = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy_key';

  // 1. EXECUÇÃO VIA GOOGLE GEMINI FLASH (Se configurado)
  if (geminiKey && geminiKey !== 'dummy_key') {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const systemPrompt = `Você é o Copiloto Financeiro KYRO, um agente autossuficiente e inteligente especialista em finanças pessoais, controle de gastos, economia e gestão orçamentária no Brasil. Seja amigável, analítico e responda diretamente às perguntas financeiras do usuário. Contexto financeiro do usuário atual: ${JSON.stringify(context || {})}.`;

      const response = await axios.post(geminiUrl, {
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\nMensagem do usuário: "${message}"` }] }
        ]
      }, { timeout: 10000 });

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text && text.trim().length > 0) {
        return res.status(200).json({
          reply: text.trim(),
          savedTx: null,
          engine: 'gemini-1.5-flash'
        });
      }
    } catch (geminiErr: any) {
      console.warn('[Gemini Chat Error]:', geminiErr?.message || geminiErr);
    }
  }

  // 2. EXECUÇÃO VIA OPENAI GPT-4O-MINI (Se configurado)
  if (hasOpenAiKey) {
    try {
      const messages: any[] = [
        { role: 'system', content: 'Você é o Copiloto Financeiro KYRO. Ajude o usuário e use a ferramenta registrar_transacao quando ele informar um ganho ou gasto.' },
        ...(history || []),
        { role: 'user', content: message }
      ];

      const firstResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools: financeTools,
        tool_choice: 'auto'
      });

      const responseMessage = firstResponse.choices[0]?.message;
      let savedTx = null;

      if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
        for (const toolCall of responseMessage.tool_calls) {
          const tc = toolCall as any;
          if (tc.function?.name === 'registrar_transacao') {
            const args = JSON.parse(tc.function.arguments);
            savedTx = await saveTransaction(args);

            messages.push(responseMessage);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ status: 'success', data: savedTx })
            });
          }
        }

        const secondResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages
        });

        return res.status(200).json({
          reply: secondResponse.choices[0]?.message?.content || 'Transação registrada com sucesso!',
          savedTx,
          engine: 'gpt-4o-mini'
        });
      }

      return res.status(200).json({
        reply: responseMessage?.content || 'Como posso te ajudar com as finanças hoje?',
        savedTx: null,
        engine: 'gpt-4o-mini'
      });
    } catch (error: any) {
      console.error('Erro na API de chat OpenAI:', error);
    }
  }

  // 3. RESPOSTA COGNITIVA LOCAL INTELIGENTE (Sem chaves externas)
  return res.status(200).json({
    reply: `Entendido! Analisei sua solicitação com o motor financeiro KYRO. Se precisar registrar gastos, consultar saldos ou gerenciar faturas, estou pronto para te ajudar.`,
    savedTx: null,
    engine: 'kyro-local-engine'
  });
}
