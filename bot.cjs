/**
 * KYRO Finance - Servidor Local do Robô WhatsApp com Suporte a Pareamento Oficial
 * 
 * Este servidor roda na porta 3001 e fornece:
 * 1. Endpoint /api/request-code para gerar o Código Oficial de 8 dígitos do WhatsApp
 * 2. Endpoint /api/status para o painel web saber se está conectado em tempo real
 * 3. Robô Baileys que recebe mensagens e envia ao webhook para registrar despesas e receitas!
 */
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason, 
  fetchLatestBaileysVersion,
  Browsers,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const path = require('path');
const http = require('http');
const fs = require('fs');

const HTTP_PORT = process.env.BOT_PORT || 3001;
const REMOTE_WEBHOOK_URL = 'https://kyro-finance.vercel.app/api/webhook';
const LOCAL_WEBHOOK_URL = 'http://localhost:3000/api/webhook';

// Garante resiliência 24/7 sem encerramento inesperado
process.on('uncaughtException', (err) => {
  console.error('[Bot Resiliência] Exceção tratada:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Bot Resiliência] Rejeição tratada:', reason?.message || reason);
});

let sockInstance = null;
let botStatus = {
  connected: false,
  phoneNumber: '',
  pairingCode: '',
  lastQr: '',
  error: null
};

// ==============================================================
// PERSISTÊNCIA LOCAL DE TRANSAÇÕES DO WHATSAPP
// ==============================================================
const TRANSACTIONS_FILE = path.join(__dirname, 'transactions.json');
let localStoredTransactions = [];
try {
  if (fs.existsSync(TRANSACTIONS_FILE)) {
    const raw = fs.readFileSync(TRANSACTIONS_FILE, 'utf-8');
    localStoredTransactions = JSON.parse(raw);
    console.log(`[Banco Local] ${localStoredTransactions.length} transações carregadas de transactions.json`);
  }
} catch (e) {
  localStoredTransactions = [];
}

function recordTransaction(tx) {
  if (!tx || !tx.amount) return;
  const txId = String(tx.id);

  // 1. Previne duplicata por ID exato
  const existsById = localStoredTransactions.some(t => String(t.id) === txId);
  if (existsById) {
    console.log(`🛡️ [Antiduplicação] Transação com ID ${txId} já registrada.`);
    return;
  }

  // 2. Previne duplicata por assinatura idêntica nos últimos 90 segundos
  const now = new Date(tx.createdAt || Date.now()).getTime();
  const existsDuplicate = localStoredTransactions.some(t => {
    const isSameDesc = (t.description || '').trim().toLowerCase() === (tx.description || '').trim().toLowerCase();
    const isSameAmount = Math.abs(Number(t.amount) - Number(tx.amount)) < 0.01;
    const isSameType = t.type === tx.type;
    const isSameMethod = t.method === tx.method;
    if (isSameDesc && isSameAmount && isSameType && isSameMethod) {
      const tTime = new Date(t.createdAt || 0).getTime();
      if (Math.abs(now - tTime) < 90000) {
        return true;
      }
    }
    return false;
  });

  if (existsDuplicate) {
    console.log(`🛡️ [Antiduplicação] Transação idêntica recente ignorada: "${tx.description}" - R$ ${tx.amount}`);
    return;
  }

  localStoredTransactions.unshift(tx);
  if (localStoredTransactions.length > 200) {
    localStoredTransactions = localStoredTransactions.slice(0, 200);
  }

  try {
    fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(localStoredTransactions, null, 2), 'utf-8');
    console.log(`💾 [Banco Local] Transação única salva: "${tx.description}" - R$ ${tx.amount} (ID: ${tx.id})`);
  } catch (errFile) {
    console.error('[Banco Local] Erro ao salvar transactions.json:', errFile.message);
  }

  // Sincroniza em background com o Webhook Vercel na nuvem
  axios.post(REMOTE_WEBHOOK_URL, {
    action: 'sync_transactions',
    transaction: tx
  }, { timeout: 6000 }).catch(() => {});
}

// ==============================================================
// CONFIGURAÇÃO DO GRUPO MONITORADO OFICIAL
// ==============================================================
const MONITORED_GROUP_FILE = path.join(__dirname, 'monitored_group.json');
let monitoredGroup = {
  inviteLink: '',
  groupJid: '',
  groupName: 'Finanças Kyro'
};

try {
  if (fs.existsSync(MONITORED_GROUP_FILE)) {
    const raw = fs.readFileSync(MONITORED_GROUP_FILE, 'utf-8');
    monitoredGroup = JSON.parse(raw);
    console.log(`[Grupo Monitorado] Carregado: "${monitoredGroup.groupName}" (${monitoredGroup.groupJid || 'JID pendente'})`);
  }
} catch (e) {}

function saveMonitoredGroup(data) {
  monitoredGroup = { ...monitoredGroup, ...data, updatedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(MONITORED_GROUP_FILE, JSON.stringify(monitoredGroup, null, 2), 'utf-8');
    console.log(`📌 [Grupo Monitorado Salvo]:`, monitoredGroup);
  } catch (e) {
    console.error('Erro ao salvar monitored_group.json:', e.message);
  }

  // Notifica o webhook remoto da Vercel
  axios.post(REMOTE_WEBHOOK_URL, {
    action: 'set_monitored_group',
    monitoredGroup
  }, { timeout: 6000 }).catch(() => {});
}

// Cache dos metadados de grupos do WhatsApp
const groupCache = new Map();

async function checkIsAuthorizedGroup(sock, remoteJid) {
  // Ignora se não for grupo ou for broadcast de status
  if (!remoteJid || !remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
    return { authorized: false, reason: 'Mensagem privada ou broadcast ignorada (apenas grupo Finanças Kyro)' };
  }

  // 1. Se o JID bater exatamente com o JID vinculado pelo link do grupo
  if (monitoredGroup.groupJid && remoteJid === monitoredGroup.groupJid) {
    return { authorized: true, groupSubject: monitoredGroup.groupName || 'Finanças Kyro' };
  }

  // 2. Busca o nome/título do grupo via metadados
  let groupSubject = groupCache.get(remoteJid);
  if (!groupSubject) {
    try {
      const meta = await sock.groupMetadata(remoteJid);
      if (meta && meta.subject) {
        groupSubject = meta.subject;
        groupCache.set(remoteJid, groupSubject);
        console.log(`[WhatsApp Grupo Detectado]: "${groupSubject}" (${remoteJid})`);

        // Se ainda não tinha JID e o nome bate, vincula automaticamente
        const normSubject = groupSubject.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const normConfig = (monitoredGroup.groupName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        if (normConfig && (normSubject.includes(normConfig) || normConfig.includes(normSubject))) {
          monitoredGroup.groupJid = remoteJid;
          monitoredGroup.groupName = groupSubject;
          saveMonitoredGroup(monitoredGroup);
        }
      }
    } catch (err) {
      console.warn(`[WhatsApp] Falha ao obter metadados do grupo ${remoteJid}:`, err.message);
    }
  }

  if (!groupSubject) {
    return { authorized: false, reason: 'Grupo sem nome identificado' };
  }

  // Normaliza o título do grupo (sem acentos, minúsculo)
  const norm = groupSubject
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  // Verifica se é o grupo configurado pelo usuário OU contém "financas kyro"
  const normConfigured = (monitoredGroup.groupName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  const isConfiguredMatch = normConfigured && norm.includes(normConfigured);
  const isKyroFinancas = 
    (norm.includes('financas') && norm.includes('kyro')) ||
    norm.includes('financas kyro') ||
    norm.includes('kyro financas') ||
    norm.includes('kyro finance');

  if (!isConfiguredMatch && !isKyroFinancas) {
    return { authorized: false, reason: `Grupo "${groupSubject}" ignorado. Apenas o grupo monitorado oficial é processado.` };
  }

  return { authorized: true, groupSubject };
}

// Extrator Inteligente e Dinâmico do KYRO Finance (sem inventar cidades ou dados)
function parseDynamicFinancialMessage(text, isAudio = false) {
  const clean = (text || '').trim();
  const lower = clean.toLowerCase();

  // 1. Ignora links, URLs e spam
  if (lower.includes('http://') || lower.includes('https://') || lower.includes('www.') || lower.includes('.com') || lower.includes('.br/')) {
    return null;
  }

  // 2. Extrai valor monetário
  let amount = 0;
  const currencyMatch = clean.match(/(?:r\$\s*|rs\s*|valor\s*(?:de\s*)?)(\d+(?:[.,]\d{1,2})?)/i) ||
                        clean.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:reais|real)/i);
  if (currencyMatch) {
    amount = parseFloat(currencyMatch[1].replace(',', '.'));
  } else {
    const hasFinancialKeyword = /(?:gastei|paguei|comprei|recebi|ganhei|sal[aá]rio|pix|d[eé]bito|cr[eé]dito|transfer[eê]ncia|dep[oó]sito|rendimento|lucro|venda|entrada|sa[ií]da|despesa|conta|boleto)/i.test(lower);
    if (hasFinancialKeyword) {
      const numMatch = clean.match(/(\d+(?:[.,]\d{1,2})?)/);
      if (numMatch) {
        amount = parseFloat(numMatch[1].replace(',', '.'));
      }
    }
  }

  if (isNaN(amount) || amount <= 0 || amount > 10000000) return null;

  // 3. Tipo: Entrada ou Saída
  let type = 'Saída';
  if (
    lower.includes('recebi') || lower.includes('ganhei') || lower.includes('salário') ||
    lower.includes('salario') || lower.includes('depósito') || lower.includes('deposito') ||
    lower.includes('rendimento') || lower.includes('lucro') || lower.includes('venda') ||
    lower.includes('entrada')
  ) {
    type = 'Entrada';
  }

  // 4. Forma de Pagamento
  let method = 'PIX';
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

  // 5. Local (se mencionado)
  let location = '';
  const localMatch = lower.match(/\b(restaurante|padaria|supermercado|mercado|posto|farm[aá]cia|farmacia|lanchonete|bar|academia|oficina|loja|shopping|barbearia|sal[aá]o|salao|a[cç]ougue|acougue|hospital|cl[ií]nica|clinica|escola|banco)\b/i);
  if (localMatch) {
    const rawLocal = localMatch[1].toLowerCase();
    location = rawLocal.charAt(0).toUpperCase() + rawLocal.slice(1);
  }

  // 6. Cidade (Apenas se o usuário tiver mencionado explicitamente! Se não disse, fica em branco)
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

  // 7. Objeto (o item consumido ou a finalidade do gasto)
  let remaining = clean
    .replace(/(?:r\$\s*|rs\s*)?\d+(?:[.,]\d{1,2})?\s*(?:reais|real)?/gi, ' ')
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

  // 8. Mensagem de Confirmação no formato padrão solicitado
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
    status: 'Concluído',
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

// ==============================================================
// 1. INICIALIZAÇÃO DO SOCKET BAILEYS (WHATSAPP WEB OFICIAL)
// ==============================================================
async function startSocket() {
  const authFolder = path.join(__dirname, 'auth_info_baileys');
  if (!fs.existsSync(authFolder)) {
    fs.mkdirSync(authFolder, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`[WhatsApp] Inicializando Baileys v${version.join('.')}...`);

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000
  });

  sockInstance = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      botStatus.lastQr = qr;
      console.log('[WhatsApp] Novo QR Code gerado.');
    }

    if (connection === 'open') {
      botStatus.connected = true;
      botStatus.lastQr = '';
      botStatus.error = null;
      botStatus.phoneNumber = sock.user?.id?.split(':')[0] || 'Conectado';
      console.log(`🎉 [WhatsApp] CONECTADO COM SUCESSO! Número: ${botStatus.phoneNumber}`);
    } else if (connection === 'close') {
      botStatus.connected = false;
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️ [WhatsApp] Conexão encerrada (Status: ${statusCode}). Reconectando: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(startSocket, 3000);
      } else {
        console.log('❌ Sessão expirada. Apagando credenciais para novo pareamento...');
        try {
          fs.rmSync(authFolder, { recursive: true, force: true });
        } catch (e) {}
        setTimeout(startSocket, 2000);
      }
    }
  });

  // Cache de IDs de mensagens já processadas para evitar duplicatas do Baileys
  const processedMessageIds = new Set();

  // Escuta mensagens do grupo ou privado
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const msgId = msg.key?.id;
        if (msgId) {
          if (processedMessageIds.has(msgId)) {
            continue; // Já processada, ignora duplicata de rede
          }
          processedMessageIds.add(msgId);
          if (processedMessageIds.size > 2000) {
            const first = processedMessageIds.values().next().value;
            processedMessageIds.delete(first);
          }
        }

        const remoteJid = msg.key.remoteJid;

        // 1. FILTRO ESTRITO DE SEGURANÇA E PRIVACIDADE:
        // Apenas mensagens enviadas dentro do grupo oficial "Finanças Kyro" são processadas!
        // Se alguém mandar mensagem no privado (DM), status ou outro grupo, é COMPLETAMENTE IGNORADO
        // Nenhuma mensagem automática é enviada para privados ou conversas fora do grupo!
        const groupCheck = await checkIsAuthorizedGroup(sock, remoteJid);
        if (!groupCheck.authorized) {
          // Ignora em silêncio absoluto
          continue;
        }

        let messageText = 
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          '';

        const isAudio = !!(msg.message.audioMessage || msg.message.voiceMessage);
        if (!messageText && !isAudio) continue;

        // Se for áudio, tenta transcrever com Whisper se chave da OpenAI estiver presente
        if (isAudio && !messageText) {
          try {
            const audioBuffer = await downloadMediaMessage(
              msg,
              'buffer',
              {},
              {
                logger: pino({ level: 'silent' }),
                reuploadRequest: sock.updateMediaMessage
              }
            );
            if (audioBuffer && process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy_key') {
              const OpenAI = require('openai');
              const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
              const { toFile } = OpenAI;
              const file = await toFile(audioBuffer, 'voice.ogg', { type: 'audio/ogg' });
              const transcription = await openai.audio.transcriptions.create({
                file,
                model: 'whisper-1',
                language: 'pt'
              });
              if (transcription?.text) {
                messageText = transcription.text;
                console.log(`🎙️ [Whisper Transcrição]: "${messageText}"`);
              }
            }
          } catch (audioErr) {
            console.warn('[WhatsApp] Erro ao transcrever áudio:', audioErr.message);
          }
          if (!messageText) {
            messageText = '[Áudio de despesa recebido no grupo]';
          }
        }

        console.log(`📩 [Finanças Kyro] Mensagem recebida: "${messageText}"`);

        // Extrai dados financeiros diretamente com a regra dinâmica inteligente
        const parsed = parseDynamicFinancialMessage(messageText, isAudio);

        if (parsed && parsed.savedTx) {
          const { savedTx, reply } = parsed;
          if (msgId) {
            savedTx.id = msgId;
            savedTx.whatsappMsgId = msgId;
          }
          console.log(`✨ [Transação Detectada]: ${savedTx.description} | R$ ${savedTx.amount} (${savedTx.type})`);
          recordTransaction(savedTx);

          try {
            // Envia resposta oficial diretamente no grupo vinculado
            await sock.sendMessage(remoteJid, { text: reply });
            console.log(`✅ Resposta enviada com sucesso no grupo ${remoteJid}!`);
          } catch (sendErr) {
            console.error('[WhatsApp] Erro ao enviar resposta para o grupo:', sendErr.message);
          }
        } else {
          // Mensagem comum de conversa (não é gasto nem finança) -> NÃO responder para não poluir o grupo
          console.log(`ℹ️ Mensagem no grupo ignorada (não é movimentação financeira).`);
        }
      } catch (innerErr) {
        console.error('[WhatsApp] Erro no processamento da mensagem:', innerErr.message);
      }
    }
  });

  return sock;
}

// ==============================================================
// 2. SERVIDOR HTTP LOCAL PARA O PAINEL WEB CHAMAR
// ==============================================================
const server = http.createServer(async (req, res) => {
  // Configuração CORS total
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);

  // Endpoint 1: Status da Conexão
  if (url.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      connected: botStatus.connected,
      phoneNumber: botStatus.phoneNumber,
      pairingCode: botStatus.pairingCode,
      hasQr: !!botStatus.lastQr,
      qr: botStatus.lastQr
    }));
  }

  // Endpoint 1.1: Webhook GET (Usado pelo Dashboard local via proxy Vite)
  if (url.pathname === '/api/webhook' && req.method === 'GET') {
    try {
      if (fs.existsSync(TRANSACTIONS_FILE)) {
        const raw = fs.readFileSync(TRANSACTIONS_FILE, 'utf-8');
        const fileTxs = JSON.parse(raw);
        if (Array.isArray(fileTxs)) {
          localStoredTransactions = fileTxs;
        }
      }
    } catch (e) {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'active',
      transactions: localStoredTransactions,
      count: localStoredTransactions.length,
      monitoredGroup
    }));
  }

  // Endpoint 1.2: Webhook POST (Simulação ou Ingestão Direta)
  if (url.pathname === '/api/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');

        if (payload?.action === 'ping' || payload?.testPing) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ status: 'pong', ok: true }));
        }

        if (payload?.action === 'sync_transactions') {
          const txsToSync = Array.isArray(payload.transactions) 
            ? payload.transactions 
            : (payload.transaction ? [payload.transaction] : []);
          for (const tx of txsToSync) recordTransaction(tx);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ status: 'synced', count: localStoredTransactions.length }));
        }

        const msgText = payload?.Body || payload?.message || payload?.text || '';
        if (msgText) {
          const parsed = parseDynamicFinancialMessage(msgText, false);
          if (parsed && parsed.savedTx) {
            recordTransaction(parsed.savedTx);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              status: 'success',
              replySent: parsed.reply,
              savedTx: parsed.savedTx
            }));
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ignored_non_financial' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Endpoint 2: Solicitar Código de 8 Dígitos Oficial do WhatsApp
  if (url.pathname === '/api/request-code' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        let rawPhone = parsed.phoneNumber || '';
        const cleanPhone = rawPhone.replace(/\D/g, '');

        if (!cleanPhone || cleanPhone.length < 10) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ 
            error: 'Número de telefone inválido. Digite o número com DDI e DDD (ex: 5586994002892).' 
          }));
        }

        if (!sockInstance) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Socket do WhatsApp ainda não inicializou. Aguarde alguns segundos.' }));
        }

        if (sockInstance.authState.creds.registered) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ 
            alreadyRegistered: true, 
            message: 'Este WhatsApp já está autenticado e conectado!' 
          }));
        }

        console.log(`[WhatsApp] Solicitando Código Oficial de Pareamento para ${cleanPhone}...`);
        
        // Chamada oficial da API do Baileys para o WhatsApp gerar o código
        const code = await sockInstance.requestPairingCode(cleanPhone);
        botStatus.pairingCode = code;
        botStatus.phoneNumber = cleanPhone;

        console.log(`🔑 [WhatsApp] CÓDIGO GERADO: ${code}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          code,
          formattedCode: `${code.slice(0, 4)}-${code.slice(4)}`,
          phoneNumber: cleanPhone
        }));

      } catch (err) {
        console.error('[WhatsApp] Erro ao solicitar código de pareamento:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ 
          error: 'Falha ao solicitar código junto ao WhatsApp.', 
          details: err.message 
        }));
      }
    });
    return;
  }

  // Endpoint 3: Desconectar Sessão
  if (url.pathname === '/api/disconnect' && req.method === 'POST') {
    try {
      if (sockInstance) {
        await sockInstance.logout().catch(() => {});
      }
      const authFolder = path.join(__dirname, 'auth_info_baileys');
      try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch (e) {}
      botStatus.connected = false;
      botStatus.phoneNumber = '';
      botStatus.pairingCode = '';
      setTimeout(startSocket, 1500);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Sessão desconectada.' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // Endpoint 4: Listar Transações Registradas pelo Robô (para o painel web sincronizar)
  if (url.pathname === '/api/transactions' && req.method === 'GET') {
    // Garante que se o arquivo tiver dados novos, recarrega
    try {
      if (fs.existsSync(TRANSACTIONS_FILE)) {
        const raw = fs.readFileSync(TRANSACTIONS_FILE, 'utf-8');
        const fileTxs = JSON.parse(raw);
        if (Array.isArray(fileTxs)) {
          localStoredTransactions = fileTxs;
        }
      }
    } catch (e) {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      transactions: localStoredTransactions,
      count: localStoredTransactions.length
    }));
  }

  // Endpoint 5: Gravar / Sincronizar Transação Externa
  if (url.pathname === '/api/transactions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        if (parsed.transaction) {
          recordTransaction(parsed.transaction);
        } else if (Array.isArray(parsed.transactions)) {
          for (const t of parsed.transactions) recordTransaction(t);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, count: localStoredTransactions.length }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Endpoint 6: Definir Link do Grupo Monitorado Oficial
  if (url.pathname === '/api/set-group' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const inviteLink = (parsed.inviteLink || '').trim();
        let targetName = (parsed.groupName || '').trim() || monitoredGroup.groupName;
        let resolvedJid = '';

        // Extrai código do convite (ex: chat.whatsapp.com/L7abc123)
        const match = inviteLink.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
        if (match && sockInstance) {
          const inviteCode = match[1];
          try {
            const inviteInfo = await sockInstance.groupGetInviteInfo(inviteCode);
            if (inviteInfo) {
              resolvedJid = inviteInfo.id;
              targetName = inviteInfo.subject || targetName;
              console.log(`🔗 [Grupo Identificado pelo Link]: "${targetName}" (${resolvedJid})`);
            }
          } catch (e) {
            console.warn('[WhatsApp] Falha ao consultar inviteCode:', e.message);
          }

          // Se o robô ainda não estiver no grupo, aceita o convite automaticamente
          try {
            await sockInstance.groupAcceptInvite(inviteCode);
            console.log(`🎉 [WhatsApp] Robô ingressou com sucesso no grupo via link de convite!`);
          } catch (e) {
            // Já faz parte do grupo
          }
        }

        saveMonitoredGroup({
          inviteLink: inviteLink || monitoredGroup.inviteLink,
          groupName: targetName || 'Finanças Kyro',
          groupJid: resolvedJid || monitoredGroup.groupJid
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          monitoredGroup
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Endpoint 7: Consultar Grupo Monitorado Atual
  if (url.pathname === '/api/monitored-group' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      monitoredGroup
    }));
  }

  res.writeHead(404);
  res.end('Not Found');
});

// Proteção contra encerramento inesperado por exceções do protocolo Signal
process.on('uncaughtException', (err) => {
  console.warn('[WhatsApp Bot] Exceção interceptada (processo mantido ativo):', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.warn('[WhatsApp Bot] Rejeição interceptada (processo mantido ativo):', reason?.message || reason);
});

server.listen(HTTP_PORT, () => {
  console.log('====================================================');
  console.log(`🚀 SERVIDOR DO ROBÔ WHATSAPP RODANDO NA PORTA ${HTTP_PORT}`);
  console.log(`📡 URL da API do Robô: http://localhost:${HTTP_PORT}`);
  console.log('====================================================\n');
  startSocket().catch(err => console.error('Erro ao iniciar socket:', err));
});
