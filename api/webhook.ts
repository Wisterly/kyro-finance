import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import axios from 'axios';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, addDoc } from 'firebase/firestore';

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

// 3. System Prompt & Function Calling Tools
const financeSystemPrompt = `
Você é o Copiloto Financeiro KYRO, um assistente inteligente integrado ao WhatsApp e à plataforma web de controle financeiro pessoal Kyro Private Finance.
Seu objetivo é ajudar o usuário a gerenciar suas finanças com agilidade, acolhimento e máxima precisão.

### REGRAS DE ATUAÇÃO:
1. Quando o usuário informar um gasto ou ganho (ex: "Gastei 45 no pix na padaria em Teresina", "Paguei 320 no cartão no mercado em Caxias", "Recebi 6000 de salário"), você DEVE usar a ferramenta registrar_transacao para salvar no banco de dados.
2. Identifique os dados: valor, tipo ('Entrada' ou 'Saída'), método ('PIX', 'Crédito', 'Débito', 'Dinheiro', 'Transferência'), cidade (ex: Teresina, PI, Caxias, MA, Oeiras, PI), categoria e descrição.
3. Confirme com elegância e emojis claros informando: Descrição, Categoria, Valor, Método, Cidade e a mensagem: "✅ Sincronizado no seu painel Kyro Private Finance!"
`;

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
          category: { type: 'string', description: 'Categoria principal' },
          subcategory: { type: 'string', description: 'Subcategoria detalhada' },
          method: { type: 'string', enum: ['PIX', 'Débito', 'Crédito', 'Dinheiro', 'Transferência'], description: 'Forma de pagamento' },
          city: { type: 'string', description: 'Cidade da despesa ou receita' },
          currentInstallment: { type: 'number', description: 'Parcela atual se parcelado' },
          totalInstallments: { type: 'number', description: 'Total de parcelas se parcelado' }
        },
        required: ['description', 'amount', 'type', 'category', 'method', 'city']
      }
    }
  }
];

// 4. Salvar Transação no Firestore
async function saveTransaction(tx: any) {
  const payload = {
    ...tx,
    date: tx.date || new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
    status: tx.status || 'Concluído',
    createdAt: new Date().toISOString()
  };

  if (!db) {
    return { id: Date.now().toString(), ...payload };
  }

  try {
    const docRef = await addDoc(collection(db, 'kyro_transactions'), payload);
    return { id: docRef.id, ...payload };
  } catch (err) {
    console.warn('[Firestore] Erro ao salvar transação:', err);
    return { id: Date.now().toString(), ...payload };
  }
}

// 5. Enviar Mensagem via Evolution API
async function sendWhatsAppMessage({ phoneNumber, message, serverUrl, apiKey, instance }: any) {
  const activeUrl = serverUrl || process.env.EVOLUTION_SERVER_URL;
  const activeKey = apiKey || process.env.EVOLUTION_API_KEY;
  const activeInstance = instance || process.env.EVOLUTION_INSTANCE;

  if (!activeUrl || !activeKey || !activeInstance) {
    return null;
  }

  const cleanNumber = phoneNumber.replace(/\D/g, '');

  try {
    const response = await axios.post(
      `${activeUrl.replace(/\/$/, '')}/message/sendText/${activeInstance}`,
      {
        number: cleanNumber,
        text: message,
        linkPreview: true
      },
      {
        headers: {
          apikey: activeKey,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error: any) {
    console.error('[Evolution API] Erro ao enviar mensagem:', error?.response?.data || error?.message);
    return null;
  }
}

// 6. Processador de IA Financeiro
async function processAssistant(userMessage: string) {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy_key') {
    return {
      reply: `Recebido pelo Copiloto KYRO: "${userMessage}". (Configure sua OPENAI_API_KEY na Vercel para ativar o processamento com GPT-4o-mini!)`,
      savedTx: null
    };
  }

  const messages: any[] = [
    { role: 'system', content: financeSystemPrompt },
    { role: 'user', content: userMessage }
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

    return {
      reply: secondResponse.choices[0]?.message?.content || 'Transação registrada com sucesso!',
      savedTx
    };
  }

  return {
    reply: responseMessage?.content || 'Como posso te ajudar com as finanças hoje?',
    savedTx: null
  };
}

// 7. Handler Serverless Oficial da Vercel
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'active',
      message: 'KYRO Evolution Webhook Endpoint Serverless ativo na Vercel.',
      endpoint: '/api/webhook',
      eventSupported: 'MESSAGES_UPSERT (messages.upsert)'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Utilize POST.' });
  }

  try {
    const payload = req.body || {};
    const data = payload?.data || payload;

    // Ignora mensagens enviadas pelo próprio bot
    if (data?.key?.fromMe === true) {
      return res.status(200).json({ status: 'Ignored fromMe message' });
    }

    // Suporta mensagens diretas (@s.whatsapp.net) e grupos (@g.us)
    const remoteJid = data?.key?.remoteJid || payload?.sender || payload?.number || '558699999999';
    const isGroup = String(remoteJid).endsWith('@g.us');
    const participant = data?.key?.participant || payload?.participant || remoteJid;
    const phoneNumber = String(participant).replace('@s.whatsapp.net', '').replace('@g.us', '');

    let messageText = 
      data?.message?.conversation ||
      data?.message?.extendedTextMessage?.text ||
      payload?.message?.conversation ||
      payload?.message?.extendedTextMessage?.text ||
      (typeof payload?.message === 'string' ? payload.message : '') ||
      payload?.text ||
      '';

    if (!messageText && (data?.message?.audioMessage || payload?.message?.audioMessage)) {
      messageText = '[Áudio de voz recebido via WhatsApp]';
    }

    if (!messageText || typeof messageText !== 'string' || !messageText.trim()) {
      return res.status(200).json({ status: 'No text message to process' });
    }

    console.log(`[Webhook Evolution] Mensagem recebida de ${phoneNumber} (Grupo: ${isGroup ? remoteJid : 'não'}): "${messageText}"`);

    const result = await processAssistant(messageText);

    const customServerUrl = (req.headers['x-evolution-url'] as string) || payload?.evolutionServerUrl;
    const customApiKey = (req.headers['x-evolution-key'] as string) || payload?.evolutionApiKey;
    const customInstance = (req.headers['x-evolution-instance'] as string) || payload?.evolutionInstance;

    // Responde no grupo ou na conversa privada
    const targetRecipient = isGroup ? remoteJid : phoneNumber;
    if (targetRecipient && targetRecipient !== 'test') {
      await sendWhatsAppMessage({
        phoneNumber: targetRecipient,
        message: result.reply,
        serverUrl: customServerUrl,
        apiKey: customApiKey,
        instance: customInstance
      });
    }

    return res.status(200).json({
      status: 'success',
      replySent: result.reply,
      savedTx: result.savedTx,
      eventProcessed: payload?.event || 'direct_message'
    });
  } catch (error: any) {
    console.error('[Webhook Evolution] Erro:', error);
    return res.status(200).json({
      status: 'error_handled',
      message: error?.message
    });
  }
}
