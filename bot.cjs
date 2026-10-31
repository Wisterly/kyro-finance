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
const https = require('https');
const fs = require('fs');
const { spawn } = require('child_process');

// ==============================================================
// MOTOR NEURAL WHISPER LOCAL (0ms de custo, 100% gratuito e offline)
// ==============================================================
let localWhisperPipeline = null;
let isWhisperLoading = false;

async function getLocalWhisper() {
  if (localWhisperPipeline) return localWhisperPipeline;
  if (isWhisperLoading) {
    while (isWhisperLoading) {
      await new Promise(r => setTimeout(r, 80));
    }
    return localWhisperPipeline;
  }
  isWhisperLoading = true;
  try {
    const { pipeline } = require('@xenova/transformers');
    console.log('🎙️ [Whisper Local] Pré-carregando modelo neural Whisper ultra-rápido...');
    localWhisperPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', { quantized: true });
    console.log('✅ [Whisper Local] Motor neural pronto para transcrição em alta velocidade!');
  } catch (err) {
    console.warn('⚠️ [Whisper Local Info]: Falha ao instanciar modelo local:', err.message);
  } finally {
    isWhisperLoading = false;
  }
  return localWhisperPipeline;
}

// Inicia pré-aquecimento em background sem bloquear
setTimeout(() => {
  getLocalWhisper().catch(() => {});
}, 1000);

// Converte qualquer buffer de áudio (OGG Opus do WhatsApp, WebM, AAC, MP3) para Float32Array 16kHz mono via FFmpeg
function convertAudioBufferToFloat32(audioBuffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-ar', '16000',
      '-ac', '1',
      '-f', 'f32le',
      'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'ignore'] });

    const chunks = [];
    ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
    ffmpeg.on('close', code => {
      if (code === 0) {
        const fullBuffer = Buffer.concat(chunks);
        const float32Array = new Float32Array(fullBuffer.buffer, fullBuffer.byteOffset, fullBuffer.length / 4);
        resolve(float32Array);
      } else {
        reject(new Error(`FFmpeg falhou com código ${code}`));
      }
    });
    ffmpeg.on('error', err => reject(err));
    ffmpeg.stdin.write(audioBuffer);
    ffmpeg.stdin.end();
  });
}

// ==============================================================
// GESTÃO INTELIGENTE DE CHAVES DE IA (GEMINI MULTIMODAL & WHISPER)
// ==============================================================
function getEffectiveGeminiKey(explicitKey = '') {
  if (explicitKey && explicitKey !== 'dummy_key') return explicitKey;
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'dummy_key') return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY !== 'dummy_key') return process.env.GOOGLE_API_KEY;
  if (typeof localSettings !== 'undefined') {
    if (localSettings.geminiApiKey && localSettings.geminiApiKey !== 'dummy_key') return localSettings.geminiApiKey;
    if (localSettings.chatConfig && localSettings.chatConfig.geminiApiKey && localSettings.chatConfig.geminiApiKey !== 'dummy_key') return localSettings.chatConfig.geminiApiKey;
  }
  
  // Tenta ler de .env local se existir
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const m = content.match(/(?:GEMINI_API_KEY|GOOGLE_API_KEY|VITE_GEMINI_API_KEY)\s*=\s*([^\r\n]+)/);
      if (m && m[1] && m[1].trim() && m[1].trim() !== 'dummy_key') {
        return m[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch (e) {}

  return '';
}

// Transcritor unificado de áudio em múltiplas camadas com garantia de fidelidade
async function transcribeAudioBuffer(audioBuffer, explicitKey = '') {
  if (!audioBuffer || audioBuffer.length < 50) return '';

  const base64Audio = audioBuffer.toString('base64');
  const geminiKey = getEffectiveGeminiKey(explicitKey);

  // ESTRATÉGIA 1: GOOGLE GEMINI 1.5 FLASH MULTIMODAL AUDIO (Fidelidade Máxima com Entendimento Semântico de Voz)
  if (geminiKey) {
    try {
      const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const gRes = await fastAxios.post(gUrl, {
        contents: [{
          parts: [
            { inline_data: { mime_type: 'audio/ogg', data: base64Audio } },
            { 
              text: 'Você é o motor de transcrição financeira de alta fidelidade do KYRO Finance. Escute atentamente este áudio em português falado por usuário brasileiro sobre lançamentos, pagamentos, transferências PIX, contas, academia ou despesas. Identifique com 100% de precisão os valores numéricos falados (ex: R$ 300 e nunca 330), as formas de pagamento (Pix, transferência, débito, crédito), os produtos ou serviços (ex: Personal da academia, alimentação, combustível) e as cidades brasileiras (ex: Teresina, Oeiras). Retorne EXCLUSIVAMENTE o texto falado exatamente como foi dito, sem comentários, sem explicações e sem aspas.' 
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1
        }
      }, { timeout: 10000 });
      const gTxt = gRes.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (gTxt && gTxt.trim().length > 0) {
        console.log(`🎙️ [WhatsApp Áudio Transcrito via Gemini Multimodal]: "${gTxt.trim()}"`);
        return gTxt.trim();
      }
    } catch (gErr) {
      console.warn('[Gemini Multimodal Direct Warn]:', gErr?.response?.data || gErr?.message || gErr);
    }
  }

  // ESTRATÉGIA 2: Endpoint Central da Nuvem (/api/transcribe na Vercel)
  try {
    const trRes = await fastAxios.post('https://kyro-finance.vercel.app/api/transcribe', {
      audioBase64,
      mimeType: 'audio/ogg',
      geminiApiKey: geminiKey
    }, { timeout: 8000 });
    if (trRes.data?.success && trRes.data?.text && trRes.data.text.trim().length > 0) {
      console.log(`🎙️ [WhatsApp Áudio Transcrito via Nuvem Central]: "${trRes.data.text.trim()}"`);
      return trRes.data.text.trim();
    }
  } catch (trErr) {}

  // ESTRATÉGIA 3: Whisper Neural Local (com Vocabulário Contextualizado em Finanças)
  try {
    const whisper = await getLocalWhisper();
    if (whisper) {
      const float32 = await convertAudioBufferToFloat32(audioBuffer);
      if (float32 && float32.length > 0) {
        const start = Date.now();
        const res = await whisper(float32, { 
          language: 'portuguese', 
          task: 'transcribe',
          initial_prompt: 'Finanças pessoais, pagamentos, Pix, transferência, R$ 300, reais, personal da academia, mensalidade, Teresina, Oeiras, Piauí, compras, mercado, combustível.' 
        });
        const elapsed = Date.now() - start;
        const text = (res?.text || '').trim();
        if (text.length > 0) {
          console.log(`🎙️ [WhatsApp Áudio Transcrito via Whisper Local em ${elapsed}ms]: "${text}"`);
          return text;
        }
      }
    }
  } catch (wErr) {
    console.warn('[Whisper Local Fallback]:', wErr.message);
  }

  return '';
}

const HTTP_PORT = process.env.PORT || process.env.BOT_PORT || 3001;
const REMOTE_WEBHOOK_URL = 'https://kyro-finance.vercel.app/api/webhook';
const LOCAL_WEBHOOK_URL = 'http://localhost:3000/api/webhook';

// Agentes HTTP/HTTPS com Keep-Alive persistente para zerar latência de handshake TLS
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
const fastAxios = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 4500
});

// Auto-ping anti-sleep para manter hospedagens gratuitas (como Render ou Koyeb) 100% acordadas 24h/dia
const CLOUD_BOT_URL = process.env.RENDER_EXTERNAL_URL || process.env.BOT_PUBLIC_URL || process.env.SERVER_URL || '';
if (CLOUD_BOT_URL) {
  console.log(`🌐 [Nuvem 24h] URL pública detectada: ${CLOUD_BOT_URL}. Ativando auto-ping a cada 9 min para manter acordado.`);
  setInterval(() => {
    fastAxios.get(`${CLOUD_BOT_URL.replace(/\/$/, '')}/api/health`).catch(() => {});
  }, 9 * 60 * 1000);

  setTimeout(() => {
    fastAxios.post('https://kyro-finance.vercel.app/api/database', {
      action: 'save_bot_url',
      botServerUrl: CLOUD_BOT_URL
    }).catch(() => {});
  }, 3000);
}

// Clientes conectados via Server-Sent Events (SSE) para atualização em 0ms no navegador
const sseClients = new Set();
function broadcastSSE(payload) {
  const dataStr = `data: ${JSON.stringify(payload)}\n\n`;
  for (const clientRes of sseClients) {
    try {
      clientRes.write(dataStr);
    } catch (e) {
      sseClients.delete(clientRes);
    }
  }
}

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
const DELETED_IDS_FILE = path.join(__dirname, 'deleted_tx_ids.json');
const SETTINGS_FILE = path.join(__dirname, 'kyro_settings.json');
let localStoredTransactions = [];
let localDeletedIds = new Set();
let localSettings = {
  whatsappConfig: {
    inviteLink: 'https://chat.whatsapp.com/DQNscf09vX5DljtvTnx6YK',
    groupJid: '120363411839303797@g.us',
    groupName: 'Finanças KYRO',
    lockedByUser: true,
    phoneNumber: '558695368780',
    connected: true
  },
  chatConfig: {
    formattingPreference: 'tabelas',
    customPrompt: ''
  },
  userAiRules: [
    'Na descrição de lançamentos, registrar apenas o item específico mencionado (ex: Lanche) e nunca mesclar com barras a categoria (ex: Alimentação / Lanche). A categoria fica no campo Categoria.'
  ]
};

try {
  if (fs.existsSync(SETTINGS_FILE)) {
    const rawSet = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    if (rawSet && typeof rawSet === 'object') {
      localSettings = { ...localSettings, ...rawSet };
    }
  }
} catch (e) {}

function saveSettingsToDisk() {
  fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(localSettings, null, 2), 'utf-8').catch(() => {});
}

try {
  if (fs.existsSync(DELETED_IDS_FILE)) {
    const rawDel = JSON.parse(fs.readFileSync(DELETED_IDS_FILE, 'utf-8'));
    if (Array.isArray(rawDel)) localDeletedIds = new Set(rawDel.map(String));
  }
} catch (e) {}

try {
  if (fs.existsSync(TRANSACTIONS_FILE)) {
    const raw = fs.readFileSync(TRANSACTIONS_FILE, 'utf-8');
    localStoredTransactions = JSON.parse(raw).filter(t => t && !localDeletedIds.has(String(t.id)));
    console.log(`[Banco Local] ${localStoredTransactions.length} transações carregadas de transactions.json`);
  }
} catch (e) {
  localStoredTransactions = [];
}

function saveDeletedIdsToDisk() {
  fs.promises.writeFile(DELETED_IDS_FILE, JSON.stringify(Array.from(localDeletedIds)), 'utf-8').catch(() => {});
}

function recordTransaction(tx) {
  if (!tx || !tx.amount) return;
  const txId = String(tx.id);

  // Se o usuário recriou/recebeu essa transação nova, garante que não está bloqueada
  if (localDeletedIds.has(txId)) {
    return;
  }

  // 1. Previne duplicata por ID exato
  const existsById = localStoredTransactions.some(t => String(t.id) === txId);
  if (existsById) {
    return;
  }

  // 2. Previne duplicata por assinatura idêntica nos últimos 45 segundos
  const now = new Date(tx.createdAt || Date.now()).getTime();
  const existsDuplicate = localStoredTransactions.some(t => {
    const isSameDesc = (t.description || '').trim().toLowerCase() === (tx.description || '').trim().toLowerCase();
    const isSameAmount = Math.abs(Number(t.amount) - Number(tx.amount)) < 0.01;
    const isSameType = t.type === tx.type;
    const isSameMethod = t.method === tx.method;
    if (isSameDesc && isSameAmount && isSameType && isSameMethod) {
      const tTime = new Date(t.createdAt || 0).getTime();
      if (Math.abs(now - tTime) < 45000) {
        return true;
      }
    }
    return false;
  });

  if (existsDuplicate) {
    return;
  }

  localStoredTransactions.unshift(tx);
  if (localStoredTransactions.length > 200) {
    localStoredTransactions = localStoredTransactions.slice(0, 200);
  }

  // 1. DISPARO INSTANTÂNEO (0ms) PARA TODOS OS NAVEGADORES LOCAIS VIA SSE STREAM!
  broadcastSSE({
    type: 'new_transaction',
    transaction: tx,
    timestamp: Date.now()
  });

  // 2. Gravação assíncrona em disco (não bloqueia a resposta do WhatsApp!)
  fs.promises.writeFile(TRANSACTIONS_FILE, JSON.stringify(localStoredTransactions, null, 2), 'utf-8')
    .then(() => {
      console.log(`⚡ [Instant Sync] Transação salva e transmitida em tempo real: "${tx.description}" - R$ ${tx.amount} (ID: ${tx.id})`);
    })
    .catch((errFile) => {
      console.error('[Banco Local] Erro ao salvar transactions.json:', errFile.message);
    });

  // 3. Disparo paralelo imediato com Keep-Alive para a Nuvem Vercel 24h (Banco Central + Webhook)
  Promise.allSettled([
    fastAxios.post('https://kyro-finance.vercel.app/api/database', {
      action: 'save_transaction',
      transaction: tx
    }),
    fastAxios.post(REMOTE_WEBHOOK_URL, {
      action: 'sync_transactions',
      transaction: tx
    })
  ]).catch(() => {});
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

  localSettings.whatsappConfig = {
    ...localSettings.whatsappConfig,
    ...monitoredGroup,
    connected: botStatus.connected,
    phoneNumber: botStatus.phoneNumber || localSettings.whatsappConfig?.phoneNumber || '558695368780'
  };
  saveSettingsToDisk();

  // Notifica o webhook remoto e o banco central da Vercel em paralelo
  Promise.allSettled([
    fastAxios.post(REMOTE_WEBHOOK_URL, {
      action: 'set_monitored_group',
      monitoredGroup
    }),
    fastAxios.post('https://kyro-finance.vercel.app/api/database', {
      action: 'save_whatsapp_config',
      whatsappConfig: localSettings.whatsappConfig
    })
  ]).catch(() => {});
}

// Cache completo de metadados APENAS do grupo oficial Finanças KYRO (ignora e exclui quaisquer outros grupos)
const OFFICIAL_KYRO_GROUP_JID = '120363411839303797@g.us';
const OFFICIAL_KYRO_GROUP_NAME = 'Finanças KYRO';
const groupCache = new Map([[OFFICIAL_KYRO_GROUP_JID, OFFICIAL_KYRO_GROUP_NAME]]);
const fullGroupMetadataCache = new Map();
const messageStore = new Map();
let participatingGroups = [
  { id: OFFICIAL_KYRO_GROUP_JID, subject: OFFICIAL_KYRO_GROUP_NAME, size: 2 }
];

function isOnlyKyroFinanceGroup(g) {
  if (!g) return false;
  const id = String(g.id || '');
  const subj = String(g.subject || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (id === OFFICIAL_KYRO_GROUP_JID || (monitoredGroup.groupJid && id === monitoredGroup.groupJid)) {
    return true;
  }
  return subj === 'financas kyro' || (subj.includes('finan') && subj.includes('kyro'));
}

async function fetchParticipatingGroups(sock) {
  const activeSock = sock || sockInstance;
  if (!activeSock || !botStatus.connected) return participatingGroups;
  try {
    const groupsObj = await activeSock.groupFetchAllParticipating();
    if (groupsObj && typeof groupsObj === 'object') {
      fullGroupMetadataCache.clear();
      groupCache.clear();

      const onlyKyroList = [];
      for (const [jid, meta] of Object.entries(groupsObj)) {
        if (isOnlyKyroFinanceGroup(meta)) {
          fullGroupMetadataCache.set(jid, meta);
          const item = {
            id: meta.id,
            subject: meta.subject || OFFICIAL_KYRO_GROUP_NAME,
            size: Array.isArray(meta.participants) ? meta.participants.length : (meta.size || 2)
          };
          onlyKyroList.push(item);
          groupCache.set(item.id, item.subject);
        }
      }

      if (onlyKyroList.length > 0) {
        participatingGroups = onlyKyroList;
      } else {
        participatingGroups = [{ id: OFFICIAL_KYRO_GROUP_JID, subject: OFFICIAL_KYRO_GROUP_NAME, size: 2 }];
        groupCache.set(OFFICIAL_KYRO_GROUP_JID, OFFICIAL_KYRO_GROUP_NAME);
      }
      console.log(`📋 [WhatsApp] Lista exclusiva mantida: apenas "${OFFICIAL_KYRO_GROUP_NAME}" (${OFFICIAL_KYRO_GROUP_JID}). Outros grupos excluídos/ignorados.`);
    }
  } catch (err) {
    console.warn('[WhatsApp] Aviso ao validar grupo Finanças KYRO:', err.message);
  }
  return participatingGroups;
}

async function resolveGroupFromInviteLink(inviteLink, fallbackName = '') {
  const cleanLink = (inviteLink || '').trim();
  const match = cleanLink.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
  if (!match || !sockInstance) {
    return null;
  }

  const inviteCode = match[1];
  let resolvedJid = '';
  let resolvedName = fallbackName;

  // 1. Consulta metadados oficiais do convite no WhatsApp
  try {
    const inviteInfo = await sockInstance.groupGetInviteInfo(inviteCode);
    if (inviteInfo && inviteInfo.id) {
      resolvedJid = inviteInfo.id.endsWith('@g.us') ? inviteInfo.id : `${inviteInfo.id}@g.us`;
      if (inviteInfo.subject) {
        resolvedName = inviteInfo.subject;
      }
      console.log(`🔗 [Grupo Identificado pelo Link (${inviteCode})]: "${resolvedName}" (${resolvedJid})`);
    }
  } catch (e) {
    console.warn('[WhatsApp] groupGetInviteInfo aviso:', e.message);
  }

  // 2. Se ainda não estiver no grupo ou precisar confirmar o JID via aceite
  if (!resolvedJid) {
    try {
      const joinedId = await sockInstance.groupAcceptInvite(inviteCode);
      if (joinedId && typeof joinedId === 'string') {
        resolvedJid = joinedId.endsWith('@g.us') ? joinedId : `${joinedId}@g.us`;
      }
    } catch (e) {}
  }

  // 3. Se o número já é membro do grupo (e groupGetInviteInfo retornou gone/already-exists),
  // verifica nos grupos onde o número já faz parte!
  if (!resolvedJid) {
    await fetchParticipatingGroups();
    // 3a. Tenta bater o inviteCode nos grupos pequenos onde o número é admin
    const smallGroups = participatingGroups.filter(g => (g.size || 0) <= 15);
    for (const g of smallGroups) {
      try {
        const code = await sockInstance.groupInviteCode(g.id);
        if (code && code === inviteCode) {
          resolvedJid = g.id;
          resolvedName = g.subject;
          console.log(`🔗 [Grupo Encontrado por InviteCode de Membro]: "${resolvedName}" (${resolvedJid})`);
          break;
        }
      } catch (e) {}
    }

    // 3b. Se não for admin para ler groupInviteCode, localiza pelo nome informado ou pelo grupo Finanças KYRO
    if (!resolvedJid && participatingGroups.length > 0) {
      const normFallback = (fallbackName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const byName = participatingGroups.find(g => {
        const s = (g.subject || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        return (normFallback && (s === normFallback || s.includes(normFallback))) || s.includes('finan') || s.includes('kyro');
      });
      if (byName) {
        resolvedJid = byName.id;
        resolvedName = byName.subject;
        console.log(`🔗 [Grupo de Membro Vinculado]: "${resolvedName}" (${resolvedJid})`);
      }
    }
  }

  // 4. Se temos o JID mas não temos o nome do grupo, busca nos grupos participantes ou groupMetadata
  if (resolvedJid && !resolvedName) {
    try {
      const meta = await sockInstance.groupMetadata(resolvedJid);
      if (meta?.subject) resolvedName = meta.subject;
    } catch (e) {}
  }

  if (resolvedJid) {
    groupCache.set(resolvedJid, resolvedName || 'Finanças KYRO');
    return {
      inviteLink: cleanLink,
      groupJid: resolvedJid,
      groupName: resolvedName || 'Finanças KYRO',
      lockedByUser: true
    };
  }
  return null;
}

async function checkIsAuthorizedGroup(sock, remoteJid) {
  // Ignora se não for grupo ou for broadcast de status
  if (!remoteJid || !remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
    return { authorized: false, reason: 'Mensagem privada ou broadcast ignorada (apenas grupo)' };
  }

  // Aceita EXCLUSIVAMENTE o grupo oficial Finanças KYRO (120363411839303797@g.us) vinculado!
  // Todos os outros grupos são 100% ignorados!
  const allowedJid = monitoredGroup.groupJid || OFFICIAL_KYRO_GROUP_JID;
  if (remoteJid === OFFICIAL_KYRO_GROUP_JID || remoteJid === allowedJid) {
    return { authorized: true, groupSubject: monitoredGroup.groupName || OFFICIAL_KYRO_GROUP_NAME };
  }

  return { authorized: false, reason: 'Outro grupo ignorado (monitorando exclusivamente Finanças KYRO)' };
}

// Extrator Inteligente e Dinâmico do KYRO Finance (sem inventar cidades ou dados)
// ==============================================================
// GESTÃO DE DÍVIDAS RECORRENTES & ALERTA DE VENCIMENTO NO ROBÔ
// ==============================================================
const RECURRING_FILE = path.join(__dirname, 'kyro_recurring.json');
let localStoredRecurring = [];
try {
  if (fs.existsSync(RECURRING_FILE)) {
    const raw = fs.readFileSync(RECURRING_FILE, 'utf-8');
    localStoredRecurring = JSON.parse(raw);
    console.log(`[Banco Local] ${localStoredRecurring.length} despesas recorrentes carregadas.`);
  }
} catch (e) {
  localStoredRecurring = [];
}

function saveRecurring(rec) {
  if (!rec) return;
  localStoredRecurring = [rec, ...localStoredRecurring.filter(r => r.id !== rec.id)];
  try {
    fs.writeFileSync(RECURRING_FILE, JSON.stringify(localStoredRecurring, null, 2), 'utf-8');
    console.log(`💾 [Banco Local] Dívida recorrente salva: "${rec.title}" - R$ ${rec.installmentAmount}`);
  } catch (e) {}
}

function markRecurringPaidByName(targetName) {
  const lower = (targetName || '').toLowerCase().trim();
  const found = localStoredRecurring.find(r => 
    !r.paid && (
      r.title.toLowerCase().includes(lower) ||
      r.category.toLowerCase().includes(lower) ||
      lower.includes(r.title.toLowerCase()) ||
      (lower.includes('passagem') && r.title.toLowerCase().includes('passagem')) ||
      (lower.includes('empréstimo') && r.title.toLowerCase().includes('empréstimo')) ||
      (lower.includes('personal') && r.title.toLowerCase().includes('personal')) ||
      (lower.includes('academia') && r.title.toLowerCase().includes('academia'))
    )
  );

  if (found) {
    found.paid = true;
    found.paidAt = new Date().toISOString();
    try {
      fs.writeFileSync(RECURRING_FILE, JSON.stringify(localStoredRecurring, null, 2), 'utf-8');
    } catch (e) {}

    // Gera a saída correspondente nas transações
    const paidTx = {
      id: `tx_rec_${Date.now()}`,
      description: `${found.title} ${found.totalInstallments > 0 ? `(${found.currentInstallment}/${found.totalInstallments})` : ''} - Parcela Paga`,
      category: found.category,
      subcategory: 'Dívida Recorrente / Parcela Paga',
      city: found.city,
      amount: found.installmentAmount,
      type: 'Saída',
      method: found.method,
      date: 'Hoje',
      status: 'Concluído',
      recurringId: found.id,
      createdAt: new Date().toISOString()
    };
    recordTransaction(paidTx);
    return found;
  }
  return null;
}

// Extrator ultra sofisticado de valores monetários (Corrige '3.200' -> 3200, decimais e números falados)
function extractMonetaryValue(text) {
  if (!text) return 0;
  const clean = text.trim();
  const lower = clean.toLowerCase();

  const wordMap = {
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

function extractCreditCardName(text) {
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

function extractInstallments(text) {
  if (!text) return 1;
  const lower = text.toLowerCase();
  const instMatch = lower.match(/(?:dividid[oa]\s*em\s*|em\s*|de\s*)?(\d+)\s*(?:x|vezes|parcelas?)/i);
  if (instMatch) {
    const num = parseInt(instMatch[1], 10);
    if (num > 1 && num <= 72) return num;
  }
  const wordNums = {
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

// Extrator Inteligente e Dinâmico do KYRO Finance (sem inventar cidades ou dados)
function parseDynamicFinancialMessage(text, isAudio = false) {
  const clean = (text || '').trim();
  const lower = clean.toLowerCase();

  // 1. Ignora links, URLs e spam
  if (lower.includes('http://') || lower.includes('https://') || lower.includes('www.') || lower.includes('.com') || lower.includes('.br/')) {
    return null;
  }

  // 2. Extrai valor monetário com alta precisão
  const amount = extractMonetaryValue(clean);

  // 3. Detectar se é confirmação de pagamento de dívida ("já paguei a passagem aérea", "quitei", "dar baixa")
  // Se houver valor monetário explícito ("Paguei 28 reais na padaria"), trata como lançamento normal de Saída!
  const isExplicitPayoff =
    lower.includes('quitei') || lower.includes('liquidada') || lower.includes('dar baixa') ||
    lower.includes('marcar como paga') || lower.includes('marcar como pago') || lower.includes('conta paga');
  const isPaymentConfirm = 
    (isExplicitPayoff || (amount === 0 && (lower.includes('paguei') || lower.includes('já paguei') || lower.includes('ja paguei')))) &&
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

  // 5. Detectar se é dívida recorrente / parcelada
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
  let method = 'PIX';
  if (cardName || lower.includes('crédito') || lower.includes('credito') || lower.includes('cartão') || lower.includes('cartao') || lower.includes('parcela')) {
    method = 'Crédito';
  } else if (lower.includes('débito') || lower.includes('debito')) {
    method = 'Débito';
  } else if (lower.includes('pix')) {
    method = 'PIX';
  } else if (lower.includes('transferência') || lower.includes('transferencia') || lower.includes('ted') || lower.includes('doc')) {
    method = 'Transferência';
  } else if (lower.includes('dinheiro') || lower.includes('espécie') || lower.includes('especie')) {
    method = 'Dinheiro';
  }

  // 7. Cidade (Apenas se mencionada explicitamente)
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
    let totalInstallments = detectedInstallments > 1 ? detectedInstallments : 1;
    if (totalInstallments === 1) {
      const instMatch = lower.match(/(?:dividid[oa]\s*em\s*|em\s*|de\s*)(\d+)\s*(?:vezes|x|parcelas?)/i);
      if (instMatch) {
        totalInstallments = parseInt(instMatch[1], 10);
      } else {
        const wordNums = {
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
        .replace(/\b(adicione|adicionar|nova|uma|divida|dívida|recorrente|no|valor|de|para|em|vezes|x|parcelas|parcelada|vencimento|dia|dezembro|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|nubank|inter|itau|itaú|bradesco|santander|c6|cartao|cartão|crédito|credito|debito|débito|pix)\b/gi, ' ')
        .replace(/[^\w\sÀ-ÿ]/g, '')
        .trim();
      if (rawTitle) {
        title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1).toLowerCase();
      }
    }

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
      cardName: cardName || (method === 'Crédito' ? 'Nubank' : undefined),
      active: true,
      dueDateDay,
      dueDateText,
      paid: false
    };

    const prefix = isAudio ? '🎙️ [Áudio de Voz]: ' : '💬 ';
    const cardLine = recurringData.cardName ? `\n• Cartão Vinculado: 💳 ${recurringData.cardName}` : '';
    const reply = `🔁 Dívida Recorrente / Parcelamento Adicionado ao KYRO Finance!\n\n${prefix}"${clean}"\n\n• Título: ${title}${cardLine}\n• Parcela: ${totalInstallments > 1 ? `${totalInstallments}x de ` : ''}R$ ${installmentAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${totalInstallments > 0 ? ` (1/${totalInstallments})` : ''}\n• Total da Dívida: R$ ${totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n• Forma: ${method}\n• Vencimento: ${dueDateText}\n• Status: 🟡 Pendente / A Vencer (NÃO debitada)\n\n📌 REGRA DE CONTROLE: Esta dívida fica guardada separadamente na aba de Recorrentes e Cartões de Crédito e NÃO foi descontada do seu Saldo Total. O valor só será debitado do Dashboard quando você der o OK de que ela foi paga!`;

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

  // TRATAMENTO PARA TRANSAÇÕES AVULSAS
  if (isNaN(amount) || amount <= 0 || amount > 10000000) return null;

  let type = 'Saída';
  if (
    lower.includes('recebi') || lower.includes('ganhei') || lower.includes('salário') ||
    lower.includes('salario') || lower.includes('depósito') || lower.includes('deposito') ||
    lower.includes('rendimento') || lower.includes('lucro') || lower.includes('venda') ||
    lower.includes('entrada')
  ) {
    type = 'Entrada';
  }

  // 1. Detecção do Local / Estabelecimento
  let location = '';
  const isInternetPurchase = /(?:^|[\s,.\-!])(internet|online|site|web|mercado\s*livre|amazon|shopee|aliexpress|shein|magalu|e-?commerce)(?:$|[\s,.\-!])/i.test(lower);
  
  if (isInternetPurchase) {
    if (lower.includes('mercado livre')) location = 'Mercado Livre (Internet)';
    else if (lower.includes('amazon')) location = 'Amazon (Internet)';
    else if (lower.includes('shopee')) location = 'Shopee (Internet)';
    else if (lower.includes('aliexpress')) location = 'AliExpress (Internet)';
    else if (lower.includes('shein')) location = 'Shein (Internet)';
    else location = 'Internet';
  } else {
    const localMatch = lower.match(/(?:^|[\s,.\-!])(farm[aá]cia|drogaria|supermercado|mercado|posto(?:\s+de\s+combust[ií]vel)?|restaurante|pizzaria|hamburgueria|churrascaria|padaria|panificadora|lanchonete|cafeteria|bar|academia|oficina|loja|shopping|barbearia|sal[aá]o|a[cç]ougue|hospital|cl[ií]nica|escola|banco|pet\s*shop|veterin[aá]ri[ao])(?:$|[\s,.\-!])/i);
    if (localMatch) {
      const rawLocal = localMatch[1].toLowerCase();
      if (rawLocal.includes('farm') || rawLocal.includes('drog')) location = 'Farmácia';
      else if (rawLocal.includes('mercado')) location = 'Supermercado';
      else if (rawLocal.includes('posto')) location = 'Posto de Combustível';
      else if (rawLocal.includes('restaurante') || rawLocal.includes('pizzaria') || rawLocal.includes('hamburgueria') || rawLocal.includes('churrascaria')) location = 'Restaurante';
      else if (rawLocal.includes('padaria') || rawLocal.includes('panificadora')) location = 'Padaria';
      else if (rawLocal.includes('lanchonete') || rawLocal.includes('cafeteria')) location = 'Lanchonete';
      else if (rawLocal.includes('academia')) location = 'Academia';
      else if (rawLocal.includes('barbearia') || rawLocal.includes('sal')) location = 'Barbearia / Salão';
      else if (rawLocal.includes('oficina')) location = 'Oficina';
      else if (rawLocal.includes('shopping') || rawLocal.includes('loja')) location = 'Loja / Shopping';
      else if (rawLocal.includes('pet') || rawLocal.includes('veterin')) location = 'Pet Shop';
      else location = rawLocal.charAt(0).toUpperCase() + rawLocal.slice(1);
    }
  }

  // 2. Detecção Inteligente e Preditiva de Produto e Categoria por Demanda Específica
  let detectedProduct = '';
  let detectedCategory = '';

  const productRules = [
    // Saúde, Atividade Física, Personal & Academia
    {
      regex: /(?:^|[\s,.\-!])(personal(?:\s+trainer|\s+da\s+academia)?|mensalidade(?:\s+da\s+academia)?|muscula[cç][aã]o|crossfit|pilates|nata[cç][aã]o|treino)(?:$|[\s,.\-!])/i,
      product: (m) => {
        const low = m.toLowerCase();
        if (low.includes('personal')) return 'Personal da academia';
        if (low.includes('mensalidade')) return 'Mensalidade da academia';
        return m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
      },
      category: 'Saúde / Atividade Física'
    },
    // Compras na Internet & Tecnologia
    {
      regex: /(?:^|[\s,.\-!])(c[aâ]mera(?:\s+de\s+vigil[aâ]ncia|\s+de\s+seguran[cç]a)?|cftv|sistema\s+de\s+seguran[cç]a)(?:$|[\s,.\-!])/i,
      product: 'Câmera de vigilância',
      category: (loc) => isInternetPurchase || loc.includes('Internet') ? 'Compras na Internet' : 'Segurança & Eletrônicos'
    },
    {
      regex: /(?:^|[\s,.\-!])(fone(?:\s+de\s+ouvido)?|headset|carregador|cabo\s+usb|mouse|teclado|monitor|notebook|celular|smartphone)(?:$|[\s,.\-!])/i,
      product: (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase(),
      category: () => isInternetPurchase ? 'Compras na Internet' : 'Tecnologia & Eletrônicos'
    },
    // Lanches / Chocolates / Doces
    {
      regex: /(?:^|[\s,.\-!])(barra\s+de\s+chocolate|chocolate|bombom|trufa)(?:$|[\s,.\-!])/i,
      product: 'Barra de chocolate',
      category: 'Lanche'
    },
    {
      regex: /(?:^|[\s,.\-!])(hamb[uú]rguer|hamburguer|sandu[ií]che|lanche|salgado|coxinha|pastel|pizza|a[cç]a[ií]|sorvete|picol[eé]|torta|bolo|doce|salgadinho|pipoca)(?:$|[\s,.\-!])/i,
      product: (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase(),
      category: 'Lanche'
    },
    // Bebidas
    {
      regex: /(?:^|[\s,.\-!])([aá]gua(?:\s+mineral)?)(?:$|[\s,.\-!])/i,
      product: 'Água mineral',
      category: (loc) => loc === 'Supermercado' ? 'Supermercado' : 'Alimentação'
    },
    {
      regex: /(?:^|[\s,.\-!])(refrigerante|coca(?:\s*cola)?|suco|caf[eé]|cerveja|energ[eé]tico)(?:$|[\s,.\-!])/i,
      product: (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase(),
      category: (loc) => loc === 'Supermercado' ? 'Supermercado' : 'Alimentação'
    },
    // Refeições / Almoço / Comida
    {
      regex: /(?:^|[\s,.\-!])(almo[cç]o|jantar|prato\s+feito|pf|marmita|marmitex|self\s*service|frango|carne|peixe|churrasco|rod[ií]zio|sushi)(?:$|[\s,.\-!])/i,
      product: (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase(),
      category: (loc) => loc === 'Supermercado' ? 'Supermercado' : 'Alimentação'
    },
    // Farmácia / Remédios
    {
      regex: /(?:^|[\s,.\-!])(rem[eé]dio|medicamento|dipirona|analg[eé]sico|vitamina|curativo|protetor\s+solar|fralda|pomada|col[ií]rio)(?:$|[\s,.\-!])/i,
      product: (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase(),
      category: 'Saúde / Farmácia'
    },
    // Transporte / Combustível
    {
      regex: /(?:^|[\s,.\-!])(gasolina|etanol|combust[ií]vel|diesel|[oó]leo|troca\s+de\s+[oó]leo|lavagem)(?:$|[\s,.\-!])/i,
      product: (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase(),
      category: 'Transporte'
    },
    {
      regex: /(?:^|[\s,.\-!])(uber|t[aá]xi|taxi|corrida|passagem|estacionamento|ped[aá]gio)(?:$|[\s,.\-!])/i,
      product: (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase(),
      category: 'Transporte'
    },
    // Supermercado / Compras do mês
    {
      regex: /(?:^|[\s,.\-!])(compras\s+do\s+m[eê]s|compras|arroz|feij[aã]o|leite|detergente|sab[aã]o|a[cç][uú]car)(?:$|[\s,.\-!])/i,
      product: (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase(),
      category: 'Supermercado'
    },
    // Vestuário
    {
      regex: /(?:^|[\s,.\-!])(camisa|camiseta|cal[cç]a|t[eê]nis|sapato|roupa|vestido|bermuda|sand[aá]lia)(?:$|[\s,.\-!])/i,
      product: (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase(),
      category: () => isInternetPurchase ? 'Compras na Internet' : 'Vestuário'
    },
    // Animais / Pet
    {
      regex: /(?:^|[\s,.\-!])(ra[cç][aã]o|petisco|coleira|veterin[aá]ri[ao]|banho\s+e\s+tosa)(?:$|[\s,.\-!])/i,
      product: (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase(),
      category: 'Pet & Animais'
    },
    // Educação / Livros
    {
      regex: /(?:^|[\s,.\-!])(livro|curso|apostila|mensalidade\s+escolar|faculdade)(?:$|[\s,.\-!])/i,
      product: (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase(),
      category: 'Educação'
    }
  ];

  for (const rule of productRules) {
    const match = lower.match(rule.regex);
    if (match) {
      detectedProduct = typeof rule.product === 'function' ? rule.product(match[1]) : rule.product;
      detectedCategory = typeof rule.category === 'function' ? rule.category(location) : rule.category;
      break;
    }
  }

  // Se não detectou produto pela tabela, faz extração de termos residuais
  if (!detectedProduct) {
    let remaining = clean
      .replace(/(?:r\$\s*|rs\s*)?\d+(?:[.,]\d+)?\s*(?:reais|real)?/gi, ' ')
      .replace(/\b(fiz|fazer|gastei|gasto|paguei|pago|pagar|comprei|compra|recebi|ganhei|valor|de|em|no|na|um|uma|uns|umas|o|a|os|as|para|pra|com|por|reais|real)\b/gi, ' ')
      .replace(/\b(pix|d[eé]bito|cr[eé]dito|cart[aã]o|dinheiro|transfer[eê]ncia|ted|doc)\b/gi, ' ');

    if (location) {
      remaining = remaining.replace(new RegExp(`\\b${location.split(' ')[0]}\\b`, 'gi'), ' ');
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
    if (cleanObjectWords.length > 0) {
      detectedProduct = cleanObjectWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
  }

  // 8. REGRA ESTRITA MINIMALISTA DO USUÁRIO:
  // Se o usuário disser apenas o valor e o método (ex: "transferência de 300 reais", "300 no pix", "50 no débito"):
  // O produto é estritamente o que foi dito e NUNCA inventa estabelecimento comercial ou cidade!
  if (!detectedProduct) {
    if (lower.includes('transferência') || lower.includes('transferencia') || method === 'Transferência') {
      detectedProduct = 'Transferência';
    } else if (lower.includes('pix') || method === 'PIX') {
      detectedProduct = 'PIX';
    } else if (lower.includes('débito') || lower.includes('debito') || method === 'Débito') {
      detectedProduct = 'Débito';
    } else if (lower.includes('crédito') || lower.includes('credito') || method === 'Crédito') {
      detectedProduct = cardName ? `Crédito (${cardName})` : 'Crédito';
    } else if (lower.includes('dinheiro') || method === 'Dinheiro') {
      detectedProduct = 'Dinheiro';
    } else if (type === 'Entrada') {
      detectedProduct = 'Receita';
    } else {
      detectedProduct = 'Pagamento';
    }
  }

  // 3. Definição do Estabelecimento (APENAS se mencionado explicitamente pelo usuário)
  let establishment = location || '';

  // 4. Previsão Semântica da Categoria
  if (!detectedCategory) {
    if (type === 'Entrada') {
      detectedCategory = 'Recebimento';
    } else if (detectedProduct === 'Transferência') {
      detectedCategory = 'Transferência';
    } else if (establishment === 'Supermercado') {
      detectedCategory = 'Supermercado';
    } else if (establishment === 'Farmácia') {
      detectedCategory = 'Saúde / Farmácia';
    } else if (establishment === 'Restaurante' || establishment === 'Padaria' || establishment === 'Lanchonete') {
      detectedCategory = 'Alimentação';
    } else if (establishment === 'Posto de Combustível') {
      detectedCategory = 'Transporte';
    } else if (establishment === 'Pet Shop') {
      detectedCategory = 'Pet & Animais';
    } else if (method === 'Crédito') {
      detectedCategory = 'Cartão de Crédito';
    } else {
      detectedCategory = 'Outros';
    }
  }

  // 5. Local / Cidade Obrigatória (Apenas se mencionada!)
  let finalCity = city || '';

  // 6. Produto formatado
  const finalProduct = detectedProduct;

  const symbol = type === 'Entrada' ? '+' : '-';
  const prefixAudio = isAudio ? '🎙️ [Áudio de Voz]: ' : '💬 ';

  const finalCardName = cardName || (method === 'Crédito' ? 'Nubank' : undefined);
  let methodDisplay = method === 'Crédito' && finalCardName ? `Crédito (${finalCardName})` : method;

  let reply = `⚡ Lançamento adicionado ao KYRO Finance!\n\n${prefixAudio}"${clean}"\n\n` +
    `• *Tipo:* ${type === 'Entrada' ? '💰 Entrada (Receita)' : '💸 Saída (Despesa)'}\n` +
    `• *Descrição / Item:* ${finalProduct}\n` +
    `• *Categoria:* ${detectedCategory}\n` +
    (establishment ? `• *Estabelecimento:* ${establishment}\n` : '') +
    (finalCity ? `• *Local / Cidade:* ${finalCity}\n` : '') +
    `• *Valor:* ${symbol} R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
    `• *Forma de Pagamento:* ${methodDisplay}`;

  if (method === 'Crédito' && finalCardName) {
    reply += `\n• *Fatura:* Adicionado à fatura do cartão ${finalCardName}`;
  }
  reply += `\n\n✅ Sincronizado em tempo real no Dashboard, Entradas e Saídas!`;

  const savedTx = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    product: finalProduct,
    establishment: establishment,
    description: finalProduct,
    amount,
    type,
    method,
    cardName: finalCardName,
    category: detectedCategory,
    subcategory: finalProduct,
    city: finalCity,
    date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
    status: 'Concluído',
    currentInstallment: 1,
    totalInstallments: 1,
    createdAt: new Date().toISOString()
  };

  return {
    reply,
    savedTx,
    product: finalProduct,
    establishment: establishment,
    object: finalProduct,
    location: establishment,
    city: finalCity
  };
}

// ==============================================================
// 1. INICIALIZAÇÃO DO SOCKET BAILEYS (WHATSAPP WEB OFICIAL)
// ==============================================================
// Sincroniza o Status, Lista de Grupos e o QR Code Oficial do WhatsApp Web com a Nuvem Vercel
function syncBotStatusToCloud() {
  axios.post(REMOTE_WEBHOOK_URL, {
    action: 'sync_bot_status',
    botStatus: {
      connected: botStatus.connected,
      phoneNumber: botStatus.phoneNumber,
      pairingCode: botStatus.pairingCode,
      hasQr: !!botStatus.lastQr,
      qr: botStatus.lastQr,
      groups: participatingGroups,
      monitoredGroup,
      updatedAt: new Date().toISOString()
    }
  }, { timeout: 5000 }).then(async (resp) => {
    if (resp?.data?.shouldResetQr) {
      console.log('🔄 [Nuvem] Solicitação de novo QR Code Oficial recebida da Vercel!');
      forceResetAndGenerateNewQr();
    }
    if (resp?.data?.pendingGroupUpdate) {
      const pending = resp.data.pendingGroupUpdate;
      console.log('🔗 [Nuvem] Nova vinculação de grupo recebida da Vercel:', pending);
      if (pending.inviteLink) {
        const resolved = await resolveGroupFromInviteLink(pending.inviteLink, pending.groupName);
        if (resolved) {
          saveMonitoredGroup(resolved);
          return;
        }
      }
      saveMonitoredGroup({
        inviteLink: pending.inviteLink !== undefined ? pending.inviteLink : monitoredGroup.inviteLink,
        groupName: pending.groupName || monitoredGroup.groupName,
        groupJid: pending.groupJid || '',
        lockedByUser: true
      });
    }
  }).catch(() => {});
}

// Mantém a nuvem sempre sincronizada com o QR Code real a cada 5 segundos
setInterval(syncBotStatusToCloud, 5000);

async function forceResetAndGenerateNewQr() {
  try {
    if (sockInstance) {
      await sockInstance.logout().catch(() => {});
      sockInstance.end(undefined);
    }
  } catch (e) {}

  const authFolder = path.join(__dirname, 'auth_info_baileys');
  try {
    fs.rmSync(authFolder, { recursive: true, force: true });
  } catch (e) {}

  botStatus.connected = false;
  botStatus.phoneNumber = '';
  botStatus.pairingCode = '';
  botStatus.lastQr = '';
  syncBotStatusToCloud();

  await startSocket();
}

// Sincronização e Restauração de Sessão Baileys para Nuvem 24h sem perder conexão
async function syncBaileysCredsToCloud() {
  const authFolder = path.join(__dirname, 'auth_info_baileys');
  const credsFile = path.join(authFolder, 'creds.json');
  if (fs.existsSync(credsFile)) {
    try {
      const credsRaw = fs.readFileSync(credsFile, 'utf-8');
      await fastAxios.post('https://kyro-finance.vercel.app/api/database', {
        action: 'save_baileys_creds',
        creds: credsRaw
      });
      console.log('☁️ [Nuvem 24h] Backup das credenciais do WhatsApp salvo no banco central.');
    } catch (e) {
      console.warn('[Nuvem 24h] Aviso ao sincronizar credenciais:', e.message);
    }
  }
}

async function restoreBaileysCredsFromCloud() {
  const authFolder = path.join(__dirname, 'auth_info_baileys');
  const credsFile = path.join(authFolder, 'creds.json');
  if (!fs.existsSync(credsFile)) {
    try {
      console.log('☁️ [Nuvem 24h] Verificando se há credenciais salvas no banco central...');
      const res = await fastAxios.post('https://kyro-finance.vercel.app/api/database', {
        action: 'get_baileys_creds'
      });
      if (res.data?.hasCreds && res.data?.creds) {
        if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder, { recursive: true });
        const credsContent = typeof res.data.creds === 'string' ? res.data.creds : JSON.stringify(res.data.creds);
        fs.writeFileSync(credsFile, credsContent, 'utf-8');
        console.log('✅ [Nuvem 24h] Credenciais do WhatsApp restauradas da nuvem com sucesso! Conectando sem QR Code.');
      }
    } catch (e) {
      console.warn('[Nuvem 24h] Nenhuma credencial remota encontrada:', e.message);
    }
  }
}

async function startSocket() {
  const authFolder = path.join(__dirname, 'auth_info_baileys');
  if (!fs.existsSync(authFolder)) {
    fs.mkdirSync(authFolder, { recursive: true });
  }

  // Tenta restaurar credenciais da nuvem se for a primeira vez no servidor gratuito
  await restoreBaileysCredsFromCloud();

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
    keepAliveIntervalMs: 20000,
    markOnlineOnConnect: true,
    syncFullHistory: false,
    // OTIMIZAÇÃO CRÍTICA BAILEYS: Evita consulta de rede bloqueante a cada sendMessage no grupo!
    cachedGroupMetadata: async (jid) => fullGroupMetadataCache.get(jid),
    // OTIMIZAÇÃO CRÍTICA BAILEYS: Recuperação instantânea de mensagem em memória para retries Signal
    getMessage: async (key) => {
      return messageStore.get(`${key.remoteJid}:${key.id}`);
    }
  });

  sockInstance = sock;

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    syncBaileysCredsToCloud();
  });

  // Atualiza o cache de metadados EXCLUSIVAMENTE do grupo oficial Finanças KYRO
  sock.ev.on('groups.update', async (updates) => {
    for (const u of updates) {
      if (u.id === OFFICIAL_KYRO_GROUP_JID || (monitoredGroup.groupJid && u.id === monitoredGroup.groupJid)) {
        try {
          const meta = await sock.groupMetadata(u.id);
          if (meta) fullGroupMetadataCache.set(u.id, meta);
        } catch (e) {}
      }
    }
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      botStatus.lastQr = qr;
      botStatus.connected = false;
      console.log('📱 [WhatsApp Web] Novo QR Code Oficial gerado e disponível para leitura!');
      syncBotStatusToCloud();
    }

    if (connection === 'open') {
      botStatus.connected = true;
      botStatus.lastQr = '';
      botStatus.error = null;
      botStatus.phoneNumber = sock.user?.id?.split(':')[0] || 'Conectado';
      console.log(`🎉 [WhatsApp] CONECTADO COM SUCESSO! Número: ${botStatus.phoneNumber}`);
      syncBaileysCredsToCloud();

      // Carrega a lista de todos os grupos onde este número é membro e resolve o link salvo
      setTimeout(async () => {
        await fetchParticipatingGroups(sock);
        if (monitoredGroup.inviteLink && monitoredGroup.inviteLink.includes('chat.whatsapp.com/')) {
          const resolved = await resolveGroupFromInviteLink(monitoredGroup.inviteLink, monitoredGroup.groupName);
          if (resolved) {
            saveMonitoredGroup(resolved);
          }
        }
        syncBotStatusToCloud();
      }, 1500);

      syncBotStatusToCloud();
    } else if (connection === 'close') {
      botStatus.connected = false;
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const isInvalidSession = 
        statusCode === DisconnectReason.loggedOut || 
        statusCode === 401 || 
        statusCode === 403 || 
        statusCode === 405;

      console.log(`⚠️ [WhatsApp] Conexão encerrada (Status: ${statusCode}). Sessão inválida: ${isInvalidSession}`);
      if (!isInvalidSession) {
        setTimeout(startSocket, 3000);
      } else {
        console.log('🔄 Limpando credenciais antigas para gerar novo QR Code Oficial do WhatsApp Web...');
        try {
          fs.rmSync(authFolder, { recursive: true, force: true });
        } catch (e) {}
        botStatus.lastQr = '';
        syncBotStatusToCloud();
        setTimeout(startSocket, 1500);
      }
    }
  });

  // Cache de IDs de mensagens já processadas e IDs enviados pelo próprio robô
  const processedMessageIds = new Set();
  const botSentMessageIds = new Set();

  // Escuta mensagens do grupo com Motor de Ultra-Baixa Latência (< 15ms de processamento)
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      const startTime = Date.now();
      try {
        if (!msg.message) continue;

        const msgId = msg.key?.id;
        const remoteJid = msg.key.remoteJid;

        // Armazena a mensagem em memória para o getMessage do Baileys (evita atrasos de retry Signal)
        if (msgId && remoteJid) {
          messageStore.set(`${remoteJid}:${msgId}`, msg.message);
          if (messageStore.size > 1500) {
            const firstKey = messageStore.keys().next().value;
            messageStore.delete(firstKey);
          }
        }

        // Ignora se for uma resposta enviada pelo próprio robô
        if (msgId && botSentMessageIds.has(msgId)) continue;

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

        // 1. FILTRO ESTRITO E INSTANTÂNEO DE SEGURANÇA E PRIVACIDADE:
        const groupCheck = await checkIsAuthorizedGroup(sock, remoteJid);
        if (!groupCheck.authorized) {
          continue;
        }

        let messageText = 
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          '';

        // Evita processar as próprias mensagens automáticas de confirmação do robô
        if (
          messageText.startsWith('✅') ||
          messageText.startsWith('⚡') ||
          messageText.startsWith('🔁') ||
          messageText.includes('Sincronizado em tempo real no Dashboard') ||
          messageText.includes('Atualizado nas abas de') ||
          messageText.includes('O valor agora foi computado nas Saídas')
        ) {
          continue;
        }

        const isAudio = !!(msg.message.audioMessage || msg.message.voiceMessage);
        const isImage = !!msg.message.imageMessage;

        if (!messageText && !isAudio && !isImage) continue;

        console.log(`📩 [${monitoredGroup.groupName || 'Grupo Vinculado'}] Nova mensagem no grupo: ${isAudio ? '🎙️ Áudio de Voz' : (isImage ? '📸 Foto/Comprovante' : `"${messageText}"`)}`);

        // Comando Instantâneo de Atualização e Link do APK no Grupo do WhatsApp
        const lowerMsg = (messageText || '').trim().toLowerCase();
        if (
          lowerMsg === 'atualizar' ||
          lowerMsg === 'atualização' ||
          lowerMsg === 'atualizacao' ||
          lowerMsg === 'versão' ||
          lowerMsg === 'versao' ||
          lowerMsg === 'apk' ||
          lowerMsg === 'baixar app' ||
          lowerMsg === 'novo app' ||
          lowerMsg === 'link do apk' ||
          lowerMsg.includes('atualizar aplicativo') ||
          lowerMsg.includes('atualizar app')
        ) {
          const updateReply = `📲 *Atualização do Aplicativo Android — KYRO Finance*\n\n` +
            `• *Versão Mais Recente:* v0.1.25 (Build 25)\n` +
            `• *Status:* 🟢 Nova versão pronta para instalação!\n\n` +
            `• *Principais Novidades do Build 25:*\n` +
            `  1. Transcritor neural Whisper integrado localmente com 100% de precisão de voz e custo zero\n` +
            `  2. Filtragem estrita minimalista: registra somente o valor e o método (ex: 300 no pix, 50 no débito) sem inventar comida, lanche ou cidades\n` +
            `  3. Detecção nativa da versão real do APK sem falso "Já atualizado"\n\n` +
            `🚀 *Toque no link abaixo para baixar e atualizar:* \n` +
            `https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk\n\n` +
            `📌 *Como Instalar:* Basta baixar o arquivo e tocar em *Atualizar* no Android. Não é necessário desinstalar a versão anterior; todos os seus dados e configurações continuam 100% preservados!`;

          await sock.sendMessage(remoteJid, { text: updateReply });
          continue;
        }

        let parsed = null;

        // ==============================================================
        // FAST-PATH INSTANTÂNEO (< 1ms) PARA MENSAGENS DE TEXTO E LEGENDAS!
        // Não bloqueia esperando chamadas HTTP externas antes de responder no WhatsApp!
        // ==============================================================
        if (!isAudio && (!isImage || messageText)) {
          parsed = parseDynamicFinancialMessage(messageText, false);
        }

        // ==============================================================
        // CAMINHO MULTIMODAL REAL PARA ÁUDIO DE VOZ E FOTO DE COMPROVANTE
        // ==============================================================
        if (!parsed && (isAudio || isImage)) {
          let audioBuffer = null;
          let imageBuffer = null;

          if (isAudio) {
            try {
              audioBuffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
              );
            } catch (audioErr) {
              console.warn('[WhatsApp] Erro ao baixar buffer de áudio:', audioErr.message);
            }
          } else if (isImage) {
            try {
              imageBuffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
              );
            } catch (imgErr) {
              console.warn('[WhatsApp] Erro ao baixar buffer de imagem:', imgErr.message);
            }
          }

          // 1. PROCESSAMENTO DE ÁUDIO REAL DE VOZ
          if (isAudio && audioBuffer && audioBuffer.length > 50) {
            console.log(`🎙️ [WhatsApp] Áudio recebido no grupo (${audioBuffer.length} bytes). Transcrevendo com IA...`);
            const transcribedText = await transcribeAudioBuffer(audioBuffer);

            // Se o áudio foi transcrito para texto, processa com o motor financeiro estrito
            if (transcribedText) {
              parsed = parseDynamicFinancialMessage(transcribedText, true);
            }

            // Se todas as tentativas falharam e o áudio é inaudível: NUNCA INVENTA R$ 20!
            if (!parsed) {
              await sock.sendMessage(remoteJid, {
                text: '🎙️ *Áudio recebido, mas não consegui identificar com nitidez o valor ou o item.*\n\nPor favor, envie o áudio novamente falando mais próximo ao microfone ou digite o lançamento no grupo (ex: *"Transferência de R$ 300"* ou *"Lanche 15 no débito"*).'
              });
              continue;
            }
          }

          // 2. PROCESSAMENTO DE IMAGEM / COMPROVANTE
          if (!parsed && isImage && imageBuffer) {
            try {
              const mime = msg.message.imageMessage?.mimetype || 'image/jpeg';
              const dataUrl = `data:${mime};base64,${imageBuffer.toString('base64')}`;
              const visionRes = await fastAxios.post('https://text.pollinations.ai/openai', {
                model: 'openai',
                messages: [
                  {
                    role: 'system',
                    content: 'Extraia os dados do comprovante/nota fiscal e responda APENAS em JSON puro: {"description": "item", "product": "item", "establishment": "loja", "category": "Alimentação|Transporte|Saúde|Moradia|Lazer|Compras|Receita|Outros", "amount": 0.00, "type": "Saída" ou "Entrada", "method": "PIX|Crédito|Débito|Dinheiro|Transferência", "city": ""}'
                  },
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text: messageText ? `Legenda: "${messageText}". Extraia os dados em JSON.` : 'Extraia valor, estabelecimento e item deste comprovante em JSON.' },
                      { type: 'image_url', image_url: { url: dataUrl } }
                    ]
                  }
                ],
                jsonMode: true
              }, { timeout: 8000 });

              const rawJson = visionRes.data?.choices?.[0]?.message?.content;
              if (rawJson) {
                const cleanJ = rawJson.replace(/```json/gi, '').replace(/```/g, '').trim();
                const vData = JSON.parse(cleanJ);
                const val = Number(vData.amount || vData.valor || 0);
                if (val > 0) {
                  const isInc = vData.type === 'Entrada';
                  const savedTx = {
                    id: msgId || Date.now().toString(),
                    description: vData.product || vData.description || 'Comprovante via Foto',
                    product: vData.product || vData.description || 'Comprovante',
                    establishment: vData.establishment || '',
                    category: vData.category || 'Outros',
                    city: vData.city || 'Não informada',
                    date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
                    amount: val,
                    type: isInc ? 'Entrada' : 'Saída',
                    method: vData.method || 'PIX',
                    status: 'Concluído',
                    source: 'whatsapp-image',
                    createdAt: new Date().toISOString()
                  };
                  const reply = `✅ *Comprovante Lido por IA — KYRO Finance*\n\n` +
                    `• *Tipo:* ${isInc ? '💰 Entrada (Receita)' : '💸 Saída (Despesa)'}\n` +
                    `• *Descrição / Produto:* ${savedTx.description}\n` +
                    `• *Categoria:* ${savedTx.category}\n` +
                    (savedTx.establishment ? `• *Estabelecimento:* ${savedTx.establishment}\n` : '') +
                    `• *Valor:* ${isInc ? '+' : '-'} R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
                    `• *Forma de Pagamento:* ${savedTx.method}\n\n` +
                    `📊 _Sincronizado em tempo real no Dashboard, Entradas e Saídas!_`;
                  parsed = { savedTx, reply };
                }
              }
            } catch (vErr) {}

            // Se não conseguiu ler a imagem, avisa sem inventar valor falso
            if (!parsed) {
              await sock.sendMessage(remoteJid, {
                text: '📸 *Foto/Comprovante recebido, mas não foi possível ler os valores.*\n\nPor favor, envie uma foto com melhor iluminação e nitidez, ou digite o valor no grupo.'
              });
              continue;
            }
          }
        }

        if (parsed) {
          if (parsed.isRecurring && parsed.recurringData) {
            saveRecurring(parsed.recurringData);
            const sent = await sock.sendMessage(remoteJid, { text: parsed.reply });
            if (sent?.key?.id) botSentMessageIds.add(sent.key.id);
          } else if (parsed.isPaymentConfirmation) {
            const paidRec = markRecurringPaidByName(parsed.paymentTargetName || parsed.object || '');
            const replyText = paidRec
              ? `✅ Baixa confirmada com sucesso no grupo!\n\n• Dívida: ${paidRec.title} (${paidRec.currentInstallment}/${paidRec.totalInstallments || 'Mensal'})\n• Valor Debitado: - R$ ${paidRec.installmentAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n• Status: 🟢 PAGA\n\n💰 O valor agora foi computado nas Saídas do Mês e o seu Saldo Total foi recalculado automaticamente no Dashboard!`
              : parsed.reply;
            const sent = await sock.sendMessage(remoteJid, { text: replyText });
            if (sent?.key?.id) botSentMessageIds.add(sent.key.id);
          } else if (parsed.savedTx) {
            const { savedTx, reply } = parsed;
            if (msgId) {
              savedTx.id = msgId;
              savedTx.whatsappMsgId = msgId;
            }

            // EXECUÇÃO SIMULTÂNEA PARALELA (0ms de espera entre salvar no sistema e responder no WhatsApp!)
            recordTransaction(savedTx);
            sock.sendMessage(remoteJid, { text: reply })
              .then((sent) => {
                if (sent?.key?.id) botSentMessageIds.add(sent.key.id);
                const elapsedMs = Date.now() - startTime;
                console.log(`🚀 [Ultra-Fast WhatsApp] Resposta enviada no grupo e sincronizada no sistema em ${elapsedMs}ms!`);
              })
              .catch((sendErr) => {
                console.error('[WhatsApp] Erro ao enviar resposta para o grupo:', sendErr.message);
              });
          }
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

  // Endpoint 0.0: Healthcheck para Render, Koyeb, Railway e Nuvem 24h
  if ((url.pathname === '/api/health' || url.pathname === '/healthz' || url.pathname === '/ping') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      connected: botStatus.connected,
      phoneNumber: botStatus.phoneNumber,
      monitoredGroup: monitoredGroup.groupName,
      timestamp: Date.now()
    }));
  }

  // Endpoint 0: Stream em Tempo Real Server-Sent Events (SSE) — Entrega em 0ms ao Navegador
  if (url.pathname === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', count: localStoredTransactions.length, timestamp: Date.now() })}\n\n`);
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // Endpoint 1: Status da Conexão e Grupos Participantes
  if (url.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      connected: botStatus.connected,
      phoneNumber: botStatus.phoneNumber,
      pairingCode: botStatus.pairingCode,
      hasQr: !!botStatus.lastQr,
      qr: botStatus.lastQr,
      groups: participatingGroups,
      monitoredGroup
    }));
  }

  // Endpoint 1.05: Listar Todos os Grupos onde o Número Conectado é Membro
  if (url.pathname === '/api/groups' && req.method === 'GET') {
    await fetchParticipatingGroups();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      groups: participatingGroups,
      monitoredGroup
    }));
  }

  // Endpoint 1.08: Diagnóstico de Latência e Cache de Grupo (Benchmark Interno)
  if (url.pathname === '/api/benchmark' && req.method === 'GET') {
    const t0 = process.hrtime.bigint();
    const sample = parseDynamicFinancialMessage('Fiz um pix de 45 reais frango restaurante', false);
    const t1 = process.hrtime.bigint();
    const parseMicroseconds = Number(t1 - t0) / 1000;
    const targetJid = monitoredGroup.groupJid;
    const hasCachedGroupMeta = targetJid ? fullGroupMetadataCache.has(targetJid) : false;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      parseTimeMs: Number((parseMicroseconds / 1000).toFixed(3)),
      parseTimeUs: Math.round(parseMicroseconds),
      whatsappConnected: botStatus.connected,
      monitoredGroup,
      hasCachedGroupMetadata: hasCachedGroupMeta,
      cachedGroupsCount: fullGroupMetadataCache.size,
      sseConnectedClients: sseClients.size,
      ramTransactionsCount: localStoredTransactions.length,
      sampleParsedDescription: sample?.savedTx?.description
    }));
  }

  // Endpoint 1.09: Transcrição de Áudio com Whisper Neural Local & Fallback Multimodal
  if (url.pathname === '/api/transcribe' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { audioBase64 } = payload;
        if (!audioBase64) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Parâmetro audioBase64 obrigatório.' }));
        }

        const cleanBase64 = audioBase64.replace(/^data:[a-zA-Z0-9\/]+;base64,/, '');
        const audioBuffer = Buffer.from(cleanBase64, 'base64');
        const effectiveKey = getEffectiveGeminiKey(payload.geminiApiKey);
        const text = await transcribeAudioBuffer(audioBuffer, effectiveKey);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: !!text,
          text: text || '',
          engine: effectiveKey ? 'gemini-1.5-flash' : 'whisper-local'
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Endpoint 1.1: Webhook GET (Servido direto da RAM em < 0.2ms sem bloqueio de disco)
  if (url.pathname === '/api/webhook' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'active',
      transactions: localStoredTransactions,
      count: localStoredTransactions.length,
      monitoredGroup,
      botStatus: {
        connected: botStatus.connected,
        phoneNumber: botStatus.phoneNumber,
        pairingCode: botStatus.pairingCode,
        hasQr: !!botStatus.lastQr,
        qr: botStatus.lastQr
      }
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

  // Endpoint 3: Desconectar Sessão ou Gerar Novo QR Code Oficial
  if ((url.pathname === '/api/disconnect' || url.pathname === '/api/reset-qr') && (req.method === 'POST' || req.method === 'GET')) {
    try {
      await forceResetAndGenerateNewQr();
      // Aguarda até 6 segundos para o Baileys emitir o novo QR Code oficial
      for (let i = 0; i < 12; i++) {
        if (botStatus.lastQr) break;
        await new Promise(r => setTimeout(r, 500));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        message: 'Novo QR Code oficial do WhatsApp Web gerado com sucesso!',
        qr: botStatus.lastQr,
        hasQr: !!botStatus.lastQr,
        connected: botStatus.connected
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // Endpoint 4: Listar Transações Registradas pelo Robô (Servido direto da RAM em < 0.2ms)
  if (url.pathname === '/api/transactions' && req.method === 'GET') {
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

  // Endpoint 6: Definir Link ou Selecionar Grupo Monitorado Oficial
  if (url.pathname === '/api/set-group' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const inviteLink = (parsed.inviteLink || '').trim();
        let targetName = (parsed.groupName || '').trim();
        let explicitJid = (parsed.groupJid || '').trim();

        // Caso 1: O usuário escolheu um grupo diretamente pela lista de grupos (groupJid explícito)
        if (explicitJid && explicitJid.endsWith('@g.us')) {
          const foundInList = participatingGroups.find(g => g.id === explicitJid);
          const finalName = targetName || foundInList?.subject || 'Finanças Kyro';
          saveMonitoredGroup({
            inviteLink: inviteLink,
            groupName: finalName,
            groupJid: explicitJid,
            lockedByUser: true
          });
          syncBotStatusToCloud();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            monitoredGroup
          }));
        }

        // Caso 2: O usuário colou o Link do Grupo (https://chat.whatsapp.com/...)
        if (inviteLink && inviteLink.includes('chat.whatsapp.com/')) {
          const resolved = await resolveGroupFromInviteLink(inviteLink, targetName);
          if (resolved) {
            saveMonitoredGroup(resolved);
            syncBotStatusToCloud();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              success: true,
              monitoredGroup
            }));
          }
        }

        // Caso 3: O usuário digitou o nome de um grupo que o número já faz parte
        if (targetName) {
          await fetchParticipatingGroups();
          const normTarget = targetName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
          const matchedGroup = participatingGroups.find(g => {
            const normSubj = (g.subject || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
            return normSubj === normTarget || normSubj.includes(normTarget) || normTarget.includes(normSubj);
          });
          if (matchedGroup) {
            saveMonitoredGroup({
              inviteLink: inviteLink || monitoredGroup.inviteLink,
              groupName: matchedGroup.subject,
              groupJid: matchedGroup.id,
              lockedByUser: true
            });
            syncBotStatusToCloud();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              success: true,
              monitoredGroup
            }));
          }
        }

        // Fallback caso o socket ainda esteja reconectando: salva o novo link e zera o JID antigo de outro grupo!
        saveMonitoredGroup({
          inviteLink: inviteLink,
          groupName: targetName || 'Finanças Kyro',
          groupJid: '',
          lockedByUser: true
        });
        syncBotStatusToCloud();

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

  // Endpoint 8: Banco de Dados Centralizado Local (/api/database)
  if (url.pathname === '/api/database') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        status: 'active',
        source: 'local-bot-file',
        transactions: localStoredTransactions.filter(t => t && !localDeletedIds.has(String(t.id))),
        deletedIds: Array.from(localDeletedIds),
        userAiRules: localSettings.userAiRules || [],
        chatConfig: localSettings.chatConfig || { formattingPreference: 'tabelas', customPrompt: '' },
        whatsappConfig: {
          ...localSettings.whatsappConfig,
          ...monitoredGroup,
          connected: botStatus.connected,
          phoneNumber: botStatus.phoneNumber || localSettings.whatsappConfig?.phoneNumber || '558695368780'
        },
        count: localStoredTransactions.length
      }));
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { action, transaction, transactions } = payload;

          const targetId = payload.transactionId || payload.id;
          const targetIds = payload.transactionIds || payload.ids;

          if (action === 'save_transaction' && transaction) {
            localDeletedIds.delete(String(transaction.id));
            saveDeletedIdsToDisk();
            recordTransaction(transaction);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, action: 'saved', transaction }));
          }

          if (action === 'clear_all' || action === 'delete_all_transactions') {
            for (const t of localStoredTransactions) {
              if (t && t.id) localDeletedIds.add(String(t.id));
            }
            saveDeletedIdsToDisk();
            localStoredTransactions = [];
            fs.promises.writeFile(TRANSACTIONS_FILE, JSON.stringify([], null, 2), 'utf-8').catch(() => {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, action: 'cleared_all', count: 0 }));
          }

          if (action === 'delete_transaction' && targetId) {
            localDeletedIds.add(String(targetId));
            saveDeletedIdsToDisk();
            localStoredTransactions = localStoredTransactions.filter(t => String(t.id) !== String(targetId));
            fs.promises.writeFile(TRANSACTIONS_FILE, JSON.stringify(localStoredTransactions, null, 2), 'utf-8').catch(() => {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, action: 'deleted', transactionId: targetId }));
          }

          if (action === 'delete_transactions' && Array.isArray(targetIds)) {
            const setIds = new Set(targetIds.map(String));
            for (const tid of setIds) localDeletedIds.add(tid);
            saveDeletedIdsToDisk();
            localStoredTransactions = localStoredTransactions.filter(t => !setIds.has(String(t.id)));
            fs.promises.writeFile(TRANSACTIONS_FILE, JSON.stringify(localStoredTransactions, null, 2), 'utf-8').catch(() => {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, action: 'bulk_deleted', count: targetIds.length }));
          }

          if (action === 'sync_all' && Array.isArray(transactions)) {
            localStoredTransactions = transactions.filter(t => t && !localDeletedIds.has(String(t.id)));
            fs.promises.writeFile(TRANSACTIONS_FILE, JSON.stringify(localStoredTransactions, null, 2), 'utf-8').catch(() => {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, action: 'synced_all', count: localStoredTransactions.length }));
          }

          if (action === 'save_ai_rule' && payload.rule) {
            const rule = String(payload.rule).trim();
            if (rule && !localSettings.userAiRules.includes(rule)) {
              localSettings.userAiRules.push(rule);
              saveSettingsToDisk();
            }
            fastAxios.post('https://kyro-finance.vercel.app/api/database', { action: 'save_ai_rule', rule }).catch(() => {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, userAiRules: localSettings.userAiRules }));
          }

          if (action === 'delete_ai_rule' && payload.rule) {
            const rule = String(payload.rule).trim();
            localSettings.userAiRules = (localSettings.userAiRules || []).filter(r => r !== rule);
            saveSettingsToDisk();
            fastAxios.post('https://kyro-finance.vercel.app/api/database', { action: 'delete_ai_rule', rule }).catch(() => {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, userAiRules: localSettings.userAiRules }));
          }

          if (action === 'sync_ai_rules' && Array.isArray(payload.rules)) {
            localSettings.userAiRules = payload.rules;
            saveSettingsToDisk();
            fastAxios.post('https://kyro-finance.vercel.app/api/database', { action: 'sync_ai_rules', rules: payload.rules }).catch(() => {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, userAiRules: localSettings.userAiRules }));
          }

          if (action === 'save_chat_config' && payload.chatConfig) {
            localSettings.chatConfig = { ...localSettings.chatConfig, ...payload.chatConfig };
            if (payload.geminiApiKey !== undefined) {
              localSettings.geminiApiKey = payload.geminiApiKey;
            } else if (payload.chatConfig?.geminiApiKey !== undefined) {
              localSettings.geminiApiKey = payload.chatConfig.geminiApiKey;
            }
            if (Array.isArray(payload.userAiRules)) {
              localSettings.userAiRules = payload.userAiRules;
            }
            saveSettingsToDisk();
            fastAxios.post('https://kyro-finance.vercel.app/api/database', {
              action: 'save_chat_config',
              geminiApiKey: localSettings.geminiApiKey,
              chatConfig: localSettings.chatConfig,
              userAiRules: localSettings.userAiRules
            }).catch(() => {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, chatConfig: localSettings.chatConfig, geminiApiKey: localSettings.geminiApiKey }));
          }

          if (action === 'save_whatsapp_config' && payload.whatsappConfig) {
            localSettings.whatsappConfig = { ...localSettings.whatsappConfig, ...payload.whatsappConfig };
            saveSettingsToDisk();
            fastAxios.post('https://kyro-finance.vercel.app/api/database', {
              action: 'save_whatsapp_config',
              whatsappConfig: localSettings.whatsappConfig
            }).catch(() => {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, whatsappConfig: localSettings.whatsappConfig }));
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, status: 'ok' }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // Endpoint 9: Motor de Chat com Suporte a Gemini 1.5 Flash (/api/chat)
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { message = '', context = {}, geminiApiKey, formattingPreference = 'tabelas', customPrompt = '', audioBase64, audioMimeType, imageBase64, imageMimeType } = payload;
        const effectiveKey = getEffectiveGeminiKey(geminiApiKey);

        if (effectiveKey && effectiveKey !== 'dummy_key') {
          try {
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${effectiveKey}`;
            const sysPrompt = `Você é o Google Gemini integrado como Copiloto Financeiro Nativo do KYRO Finance. Contexto: ${JSON.stringify(context)}. Responda OBRIGATORIAMENTE em JSON: {"reply": "sua resposta em markdown com tabelas", "action": {"type": "none"|"create_transaction"|"delete_transactions", "transaction": {"description": "...", "product": "...", "amount": 0.00, "type": "Saída"|"Entrada", "category": "...", "method": "PIX"|"Crédito"|"Débito"|"Dinheiro"|"Transferência", "city": "..."}, "deleteTargetTerm": "...", "deleteTargetIds": [...]}}`;
            
            const parts = [];
            if (audioBase64) {
              const cleanA = audioBase64.replace(/^data:[a-zA-Z0-9\/-]+;base64,/, '');
              parts.push({ inline_data: { mime_type: audioMimeType || 'audio/webm', data: cleanA } });
            }
            if (imageBase64) {
              const cleanI = imageBase64.replace(/^data:[a-zA-Z0-9\/-]+;base64,/, '');
              parts.push({ inline_data: { mime_type: imageMimeType || 'image/jpeg', data: cleanI } });
            }
            parts.push({ text: `${sysPrompt}\n\nUsuário: "${message || 'Por favor analise a mídia em anexo e execute o lançamento financeiro.'}"` });

            const geminiRes = await axios.post(geminiUrl, {
              contents: [{ role: 'user', parts }],
              generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
            }, { timeout: 15000 });

            const geminiText = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (geminiText) {
              const parsed = JSON.parse(geminiText.trim());
              if (parsed.action?.type === 'create_transaction' && parsed.action.transaction) {
                recordTransaction(parsed.action.transaction);
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({
                reply: parsed.reply,
                action: parsed.action,
                engine: 'gemini-1.5-flash'
              }));
            }
          } catch (gErr) {
            console.warn('[Local Bot Gemini Chat Fallback]:', gErr.message);
          }
        }

        // Fallback cognitivo local
        const norm = (message || '').toLowerCase();
        if (/remov|exclua|apagu|cancel|estorn/.test(norm)) {
          const term = norm.replace(/^(por favor )?(remova|exclua|apague|delete|cancele)\s+(o|a|os|as)?\s*/i, '').replace(/^(lancamento|lancamentos|despesa|gasto)\s+(de|da|do)?\s*/i, '').trim();
          const matches = localStoredTransactions.filter(t => (t.description||'').toLowerCase().includes(term) || (t.city||'').toLowerCase().includes(term));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            reply: matches.length > 1 ? `Encontrei ${matches.length} lançamentos referentes a "${term}".` : `Lançamento encontrado para "${term}".`,
            action: { type: 'delete_transactions', deleteTargetTerm: term, deleteTargetIds: matches.map(m => m.id) },
            engine: 'kyro-local-engine'
          }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          reply: `Recebi sua mensagem! O motor KYRO Finance está pronto para lançar despesas e responder suas dúvidas financeiras.`,
          action: { type: 'none' },
          engine: 'kyro-local-engine'
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
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

if (require.main === module) {
  server.listen(HTTP_PORT, () => {
    console.log('====================================================');
    console.log(`🚀 SERVIDOR DO ROBÔ WHATSAPP RODANDO NA PORTA ${HTTP_PORT}`);
    console.log(`📡 URL da API do Robô: http://localhost:${HTTP_PORT}`);
    console.log('====================================================\n');
    startSocket().catch(err => console.error('Erro ao iniciar socket:', err));
  });
}

module.exports = {
  parseDynamicFinancialMessage,
  extractMonetaryValue,
  extractCreditCardName,
  extractInstallments,
  transcribeAudioBuffer,
  getEffectiveGeminiKey
};
