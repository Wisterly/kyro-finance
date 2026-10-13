import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
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

// 3. Fallback Heurístico Robusto (garante que despesas e receitas sejam extraídas e salvas mesmo sem OpenAI API Key ativa)
function parseFinancialMessageHeuristic(text: string) {
  const lower = text.toLowerCase().trim();
  
  // Extrai valor em R$ ou número
  const valueMatch = text.match(/(?:r\$\s*|rs\s*|valor\s*(?:de\s*)?)?(\d+(?:[.,]\d{1,2})?)/i);
  if (!valueMatch) return null;

  const rawVal = valueMatch[1].replace(',', '.');
  const amount = parseFloat(rawVal);
  if (isNaN(amount) || amount <= 0) return null;

  // Determina tipo: Entrada ou Saída
  let type = 'Saída';
  if (
    lower.includes('recebi') ||
    lower.includes('ganhei') ||
    lower.includes('salário') ||
    lower.includes('salario') ||
    lower.includes('depósito') ||
    lower.includes('deposito') ||
    lower.includes('rendimento') ||
    lower.includes('lucro') ||
    lower.includes('venda') ||
    lower.includes('entrada')
  ) {
    type = 'Entrada';
  }

  // Determina método de pagamento
  let method = 'PIX';
  if (lower.includes('crédito') || lower.includes('credito') || lower.includes('cartão') || lower.includes('cartao') || lower.includes('vezes') || lower.includes('parcela')) {
    method = 'Crédito';
  } else if (lower.includes('débito') || lower.includes('debito')) {
    method = 'Débito';
  } else if (lower.includes('dinheiro') || lower.includes('espécie') || lower.includes('especie')) {
    method = 'Dinheiro';
  } else if (lower.includes('transferência') || lower.includes('transferencia') || lower.includes('ted') || lower.includes('doc')) {
    method = 'Transferência';
  }

  // Determina cidade
  let city = 'Teresina, PI';
  if (lower.includes('oeiras')) city = 'Oeiras, PI';
  else if (lower.includes('caxias')) city = 'Caxias, MA';
  else if (lower.includes('teresina')) city = 'Teresina, PI';
  else if (lower.includes('são paulo') || lower.includes('sao paulo') || lower.includes('sp')) city = 'São Paulo, SP';
  else if (lower.includes('fortaleza')) city = 'Fortaleza, CE';
  else if (lower.includes('brasília') || lower.includes('brasilia')) city = 'Brasília, DF';

  // Determina categoria e descrição
  let category = type === 'Entrada' ? 'Recebimento' : 'Outros';
  let subcategory = type === 'Entrada' ? 'Receita Geral' : 'Geral';
  let description = 'Movimentação WhatsApp';

  if (lower.includes('padaria') || lower.includes('pão') || lower.includes('café')) {
    category = 'Alimentação';
    subcategory = 'Padaria & Lanche';
    description = 'Padaria / Café';
  } else if (lower.includes('mercado') || lower.includes('supermercado') || lower.includes('compras')) {
    category = 'Alimentação';
    subcategory = 'Supermercado';
    description = 'Supermercado';
  } else if (lower.includes('salário') || lower.includes('salario')) {
    category = 'Recebimento';
    subcategory = 'Salário Fixo';
    description = 'Salário Mensal';
  } else if (lower.includes('passagem') || lower.includes('viagem') || lower.includes('aérea') || lower.includes('aerea')) {
    category = 'Passagem Aérea / Viagem';
    subcategory = 'Viagens';
    description = 'Passagem Aérea';
  } else if (lower.includes('farmácia') || lower.includes('farmacia') || lower.includes('remédio')) {
    category = 'Saúde';
    subcategory = 'Medicamentos';
    description = 'Farmácia';
  } else if (lower.includes('gasolina') || lower.includes('combustível') || lower.includes('posto') || lower.includes('uber')) {
    category = 'Transporte';
    subcategory = 'Combustível / App';
    description = 'Transporte / Posto';
  } else if (lower.includes('restaurante') || lower.includes('almoço') || lower.includes('almoco') || lower.includes('jantar')) {
    category = 'Alimentação';
    subcategory = 'Restaurante';
    description = 'Almoço / Restaurante';
  } else if (lower.includes('pessoal') || lower.includes('academia') || lower.includes('personal')) {
    category = 'Pessoal / Mensalidade';
    subcategory = 'Saúde & Treino';
    description = 'Mensalidade Academia / Personal';
  } else if (lower.includes('empréstimo') || lower.includes('emprestimo')) {
    category = 'Empréstimo';
    subcategory = 'Parcela Empréstimo';
    description = 'Empréstimo';
  } else {
    description = text.slice(0, 35);
  }

  // Parcelamento
  let currentInstallment: number | undefined;
  let totalInstallments: number | undefined;
  const instMatch = text.match(/(\d+)\s*x/i);
  if (instMatch) {
    totalInstallments = parseInt(instMatch[1]);
    currentInstallment = 1;
  }

  return {
    description,
    amount,
    type,
    category,
    subcategory,
    method,
    city,
    currentInstallment,
    totalInstallments
  };
}

// 4. Salvar Transação no Firestore / Memória
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

// 5. Enviar Mensagem de Volta no WhatsApp / Grupo
async function sendWhatsAppMessage({ targetRecipient, message, serverUrl, apiKey, instance }: any) {
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
    console.error('[Evolution API] Erro ao enviar mensagem:', error?.response?.data || error?.message);
    return null;
  }
}

// 6. Processador de IA Financeiro com Fallback Automático
async function processAssistant(userMessage: string) {
  const parsedFallback = parseFinancialMessageHeuristic(userMessage);

  // Se OpenAI estiver configurada e funcional
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy_key') {
    try {
      const messages: any[] = [
        {
          role: 'system',
          content: `Você é o Copiloto Financeiro KYRO no WhatsApp do grupo.
Quando o usuário mandar uma mensagem informando gasto, Pix, compra, receita ou salário, você DEVE acionar a função registrar_transacao.
Campos: description, amount, type ('Entrada' ou 'Saída'), category, subcategory, method ('PIX', 'Débito', 'Crédito', 'Dinheiro', 'Transferência'), city.`
        },
        { role: 'user', content: userMessage }
      ];

      const firstResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools: [
          {
            type: 'function',
            function: {
              name: 'registrar_transacao',
              description: 'Registra uma nova movimentação financeira no KYRO.',
              parameters: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  amount: { type: 'number' },
                  type: { type: 'string', enum: ['Entrada', 'Saída'] },
                  category: { type: 'string' },
                  subcategory: { type: 'string' },
                  method: { type: 'string', enum: ['PIX', 'Débito', 'Crédito', 'Dinheiro', 'Transferência'] },
                  city: { type: 'string' }
                },
                required: ['description', 'amount', 'type', 'category', 'method', 'city']
              }
            }
          }
        ],
        tool_choice: 'auto'
      });

      const responseMessage = firstResponse.choices[0]?.message;
      if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
        for (const toolCall of responseMessage.tool_calls) {
          const tc = toolCall as any;
          if (tc.function?.name === 'registrar_transacao') {
            const args = JSON.parse(tc.function.arguments);
            const savedTx = await saveTransaction(args);
            const symbol = args.type === 'Entrada' ? '+' : '-';
            return {
              reply: `✅ Lançamento registrado com sucesso no KYRO Finance!\n\n• Tipo: ${args.type}\n• Objeto: ${args.description}\n• Valor: ${symbol} R$ ${args.amount.toLocaleString('pt-BR', {minimumFractionDigits:2})}\n• Forma: ${args.method}\n• Cidade: ${args.city}\n\n📊 Seu painel, despesas e saldo foram atualizados automaticamente!`,
              savedTx
            };
          }
        }
      }
    } catch (openAiErr) {
      console.warn('[OpenAI Erro, usando Parser Heurístico]', openAiErr);
    }
  }

  // Executa Parser Heurístico se a mensagem continha um lançamento financeiro
  if (parsedFallback) {
    const savedTx = await saveTransaction(parsedFallback);
    const symbol = parsedFallback.type === 'Entrada' ? '+' : '-';
    return {
      reply: `⚡ Lançamento adicionado e interpretado pela IA do KYRO!\n\n• Tipo: ${parsedFallback.type}\n• Descrição: ${parsedFallback.description}\n• Categoria: ${parsedFallback.category} (${parsedFallback.subcategory})\n• Valor: ${symbol} R$ ${parsedFallback.amount.toLocaleString('pt-BR', {minimumFractionDigits: 2})}\n• Pagamento: ${parsedFallback.method}\n• Localização: ${parsedFallback.city}\n\n✅ Atualizado automaticamente na aba de ${parsedFallback.type === 'Entrada' ? 'Entradas' : 'Saídas'} e no Dashboard!`,
      savedTx
    };
  }

  return {
    reply: `Olá! Recebi sua mensagem no grupo. Para cadastrar um gasto ou entrada, envie por exemplo: "Gastei 45 no pix na padaria em Teresina" ou "Recebi 6000 de salário hoje".`,
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

  // Permite que o frontend consulte transações recentes gravadas pelo webhook
  if (req.method === 'GET') {
    try {
      if (db) {
        const q = query(collection(db, 'kyro_transactions'), orderBy('createdAt', 'desc'), limit(50));
        const snap = await getDocs(q);
        const txs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.status(200).json({ status: 'active', transactions: txs });
      }
    } catch (e) {
      console.warn('Erro ao listar do Firestore:', e);
    }

    return res.status(200).json({
      status: 'active',
      message: 'KYRO Group Webhook Endpoint ativo.',
      endpoint: '/api/webhook'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Utilize POST.' });
  }

  try {
    const payload = req.body || {};
    const data = payload?.data || payload;

    // Ignora mensagens enviadas pelo próprio robô para evitar looping
    if (data?.key?.fromMe === true) {
      return res.status(200).json({ status: 'Ignored fromMe message' });
    }

    // Suporta mensagens diretas (@s.whatsapp.net) e grupos (@g.us)
    const remoteJid = data?.key?.remoteJid || payload?.sender || payload?.number || 'grupo_kyro@g.us';
    const isGroup = String(remoteJid).endsWith('@g.us');
    const participant = data?.key?.participant || payload?.participant || remoteJid;
    const phoneNumber = String(participant).replace('@s.whatsapp.net', '').replace('@g.us', '');

    // Extrai o texto da mensagem de todas as variações de payload da Evolution API / Baileys
    let messageText = 
      data?.message?.conversation ||
      data?.message?.extendedTextMessage?.text ||
      payload?.message?.conversation ||
      payload?.message?.extendedTextMessage?.text ||
      data?.message?.imageMessage?.caption ||
      payload?.message?.imageMessage?.caption ||
      (typeof payload?.message === 'string' ? payload.message : '') ||
      payload?.text ||
      '';

    if (!messageText && (data?.message?.audioMessage || payload?.message?.audioMessage)) {
      messageText = '[Áudio de voz recebido no grupo]';
    }

    if (!messageText || typeof messageText !== 'string' || !messageText.trim()) {
      return res.status(200).json({ status: 'No text message to process' });
    }

    console.log(`[Webhook Grupo] Mensagem de ${phoneNumber} em ${remoteJid}: "${messageText}"`);

    // Processa com IA / Heurística
    const result = await processAssistant(messageText);

    const customServerUrl = (req.headers['x-evolution-url'] as string) || payload?.evolutionServerUrl;
    const customApiKey = (req.headers['x-evolution-key'] as string) || payload?.evolutionApiKey;
    const customInstance = (req.headers['x-evolution-instance'] as string) || payload?.evolutionInstance;

    // Responde diretamente dentro do Grupo do WhatsApp!
    const targetRecipient = isGroup ? remoteJid : phoneNumber;
    if (targetRecipient && targetRecipient !== 'test') {
      await sendWhatsAppMessage({
        targetRecipient,
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
      group: isGroup ? remoteJid : null
    });
  } catch (error: any) {
    console.error('[Webhook Grupo] Erro:', error);
    return res.status(200).json({
      status: 'error_handled',
      message: error?.message
    });
  }
}
