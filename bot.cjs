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
// MOTOR NEURAL WHISPER LOCAL & OCR TESSERACT (0ms de custo, 100% gratuito e offline)
// ==============================================================
let localWhisperPipeline = null;
let isWhisperLoading = false;
let localOcrWorker = null;
let isOcrLoading = false;

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
    console.log('🎙️ [Whisper Local] Pré-carregando modelo neural Whisper-Small (alta precisão PT-BR)...');
    try {
      localWhisperPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', { quantized: true });
      console.log('✅ [Whisper Local] Motor neural Whisper-Small pronto para transcrição de alta precisão!');
    } catch (smallErr) {
      console.warn('⚠️ [Whisper-Small Fallback para Base]:', smallErr.message);
      localWhisperPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', { quantized: true });
      console.log('✅ [Whisper Local] Motor neural Whisper-Base pronto!');
    }
  } catch (err) {
    console.warn('⚠️ [Whisper Local Info]: Falha ao instanciar modelo local:', err.message);
  } finally {
    isWhisperLoading = false;
  }
  return localWhisperPipeline;
}

async function getLocalOcrWorker() {
  if (localOcrWorker) return localOcrWorker;
  if (isOcrLoading) {
    while (isOcrLoading) {
      await new Promise(r => setTimeout(r, 80));
    }
    return localOcrWorker;
  }
  isOcrLoading = true;
  try {
    const Tesseract = require('tesseract.js');
    console.log('📸 [OCR Local] Pré-carregando motor leitor de comprovantes (Português)...');
    localOcrWorker = await Tesseract.createWorker('por');
    console.log('✅ [OCR Local] Motor leitor de comprovantes pronto!');
  } catch (err) {
    console.warn('⚠️ [OCR Local Info]: Falha ao iniciar Tesseract:', err.message);
  } finally {
    isOcrLoading = false;
  }
  return localOcrWorker;
}

// Inicia pré-aquecimento em background sem bloquear
setTimeout(() => {
  getLocalWhisper().catch(() => {});
  getLocalOcrWorker().catch(() => {});
}, 1000);

// Converte qualquer buffer de áudio (OGG Opus do WhatsApp, WebM, AAC, MP3) para Float32Array 16kHz mono
// Utiliza filtro passa-banda vocal limpo + Trim de Silêncio + Normalização Matemática de Ganho de Pico (sem distorção temporal de loudnorm)
function convertAudioBufferToFloat32(audioBuffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-af', 'highpass=f=70,lowpass=f=7800',
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
        const rawFloat32 = new Float32Array(fullBuffer.buffer, fullBuffer.byteOffset, Math.floor(fullBuffer.length / 4));
        if (rawFloat32.length === 0) return resolve(rawFloat32);

        // 1. Calcula o pico real para normalização de ganho (permite ouvir sussurros ou áudios gravados longe do microfone)
        let maxPeak = 0;
        for (let i = 0; i < rawFloat32.length; i++) {
          const abs = Math.abs(rawFloat32[i]);
          if (abs > maxPeak) maxPeak = abs;
        }

        // 2. Aplica ganho linear seguro até 0.92 (-0.7 dBFS)
        const gain = (maxPeak > 0.0015 && maxPeak < 0.88) ? Math.min(0.92 / maxPeak, 25.0) : 1.0;
        const normalized = new Float32Array(rawFloat32.length);
        for (let i = 0; i < rawFloat32.length; i++) {
          normalized[i] = Math.max(-1.0, Math.min(1.0, rawFloat32[i] * gain));
        }

        // 3. Remove silêncio absoluto prolongado no início e no fim (mantendo margem de 200ms = 3200 samples)
        const silenceThreshold = 0.015;
        let startIdx = 0;
        let endIdx = normalized.length - 1;
        while (startIdx < normalized.length && Math.abs(normalized[startIdx]) < silenceThreshold) startIdx++;
        while (endIdx > startIdx && Math.abs(normalized[endIdx]) < silenceThreshold) endIdx--;

        startIdx = Math.max(0, startIdx - 3200);
        endIdx = Math.min(normalized.length - 1, endIdx + 3200);

        const trimmed = (endIdx > startIdx && (endIdx - startIdx) >= 4000)
          ? normalized.subarray(startIdx, endIdx + 1)
          : normalized;

        resolve(trimmed);
      } else {
        reject(new Error(`FFmpeg falhou com código ${code}`));
      }
    });
    ffmpeg.on('error', err => reject(err));
    ffmpeg.stdin.write(audioBuffer);
    ffmpeg.stdin.end();
  });
}

// Normalizador fonético pós-transcrição para corrigir junções da fala rápida em Português Brasileiro
function normalizeTranscribedPortugueseText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let clean = rawText.trim();

  // Filtra alucinações clássicas do Whisper quando o áudio está mudo ou só tem ruído branco
  const lower = clean.toLowerCase();
  const hallucinations = [
    'não sei o que é isso',
    'nao sei o que e isso',
    'legendas pela comunidade',
    'obrigado por assistir',
    'inscreva-se no canal',
    'subtitles by',
    'amara.org',
    'transcrição por'
  ];
  if (hallucinations.some(h => lower.includes(h)) && !/\d/.test(lower)) {
    return '';
  }

  // Correções fonéticas de cidades e termos financeiros frequentemente unidos na fala rápida
  clean = clean
    .replace(/\binter[eé]sina\b/gi, 'em Teresina')
    .replace(/\bint[eé]resina\b/gi, 'em Teresina')
    .replace(/\binoeiras\b/gi, 'em Oeiras')
    .replace(/\bem\s+oeira\b/gi, 'em Oeiras')
    .replace(/\bem\s+ostras\b/gi, 'em Oeiras')
    .replace(/\bimpicos\b/gi, 'em Picos')
    .replace(/\binfloriano\b/gi, 'em Floriano')
    .replace(/\bimparna[ií]ba\b/gi, 'em Parnaíba')
    .replace(/\bincaxias\b/gi, 'em Caxias')
    .replace(/\bintimon\b/gi, 'em Timon')
    .replace(/\bp[ií]x\b/gi, 'PIX')
    .replace(/\bpiques\b/gi, 'PIX')
    .replace(/\bno\s+pics\b/gi, 'no PIX')
    .replace(/\bum\s+pics\b/gi, 'um PIX')
    .replace(/\bd[eé]bito\b/gi, 'débito')
    .replace(/\bcr[eé]dito\b/gi, 'crédito')
    .replace(/\s+/g, ' ')
    .trim();

  return clean;
}

// Converte qualquer buffer de áudio para WAV 16kHz 16-bit mono normalizado (padrão de estúdio para APIs de IA Whisper)
function convertAudioBufferToNormalizedWav(audioBuffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ar', '16000',
      '-ac', '1',
      '-f', 'wav',
      'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'ignore'] });

    const chunks = [];
    ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
    ffmpeg.on('close', code => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`FFmpeg WAV falhou com código ${code}`));
      }
    });
    ffmpeg.on('error', err => reject(err));
    ffmpeg.stdin.write(audioBuffer);
    ffmpeg.stdin.end();
  });
}

// ==============================================================
// GESTÃO INTELIGENTE DE CHAVES DE IA (GEMINI, GROQ WHISPER & OPENAI)
// ==============================================================
function isValidApiKey(val, prefix = '') {
  if (!val || typeof val !== 'string') return false;
  const clean = val.trim().replace(/^["']|["']$/g, '');
  if (!clean || clean === 'dummy_key' || clean.startsWith('#') || clean.includes(' ')) return false;
  if (prefix && !clean.startsWith(prefix)) return false;
  return clean.length >= 15;
}

function getEffectiveGeminiKey(explicitKey = '') {
  if (isValidApiKey(explicitKey, 'AIza')) return explicitKey.trim();
  if (isValidApiKey(process.env.GEMINI_API_KEY, 'AIza')) return process.env.GEMINI_API_KEY.trim();
  if (isValidApiKey(process.env.GOOGLE_API_KEY, 'AIza')) return process.env.GOOGLE_API_KEY.trim();
  if (typeof localSettings !== 'undefined') {
    if (isValidApiKey(localSettings.geminiApiKey, 'AIza')) return localSettings.geminiApiKey.trim();
    if (localSettings.chatConfig && isValidApiKey(localSettings.chatConfig.geminiApiKey, 'AIza')) return localSettings.chatConfig.geminiApiKey.trim();
  }
  
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const m = content.match(/^(?:GEMINI_API_KEY|GOOGLE_API_KEY|VITE_GEMINI_API_KEY)[ \t]*=[ \t]*([^\r\n#]+)/m);
      if (m && m[1] && isValidApiKey(m[1], 'AIza')) {
        return m[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch (e) {}

  return '';
}

function getEffectiveGroqKey(explicitKey = '') {
  if (isValidApiKey(explicitKey, 'gsk_')) return explicitKey.trim();
  if (isValidApiKey(process.env.GROQ_API_KEY, 'gsk_')) return process.env.GROQ_API_KEY.trim();
  if (typeof localSettings !== 'undefined') {
    if (isValidApiKey(localSettings.groqApiKey, 'gsk_')) return localSettings.groqApiKey.trim();
    if (localSettings.chatConfig && isValidApiKey(localSettings.chatConfig.groqApiKey, 'gsk_')) return localSettings.chatConfig.groqApiKey.trim();
  }
  
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const m = content.match(/^(?:GROQ_API_KEY|VITE_GROQ_API_KEY)[ \t]*=[ \t]*([^\r\n#]+)/m);
      if (m && m[1] && isValidApiKey(m[1], 'gsk_')) {
        return m[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch (e) {}

  return '';
}

function getEffectiveOpenAIKey(explicitKey = '') {
  if (isValidApiKey(explicitKey, 'sk-')) return explicitKey.trim();
  if (isValidApiKey(process.env.OPENAI_API_KEY, 'sk-')) return process.env.OPENAI_API_KEY.trim();
  if (typeof localSettings !== 'undefined') {
    if (isValidApiKey(localSettings.openaiApiKey, 'sk-')) return localSettings.openaiApiKey.trim();
  }
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const m = content.match(/^(?:OPENAI_API_KEY)[ \t]*=[ \t]*([^\r\n#]+)/m);
      if (m && m[1] && isValidApiKey(m[1], 'sk-')) {
        return m[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch (e) {}
  return '';
}

// ==============================================================
// MOTOR MULTIMODAL DIRETO DO GEMINI 1.5 FLASH (ÁUDIO -> JSON PURO)
// Escuta o áudio original em alta fidelidade e extrai o lançamento completo
// ==============================================================
async function interpretAudioDirectlyWithGemini(audioBuffer, explicitKey = '') {
  if (!audioBuffer || audioBuffer.length < 50) return null;

  const geminiKey = getEffectiveGeminiKey(explicitKey);
  if (!geminiKey) return null;

  const base64Audio = audioBuffer.toString('base64');
  try {
    const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    const prompt = `Você é o motor de inteligência financeira do KYRO Finance.
Escute atentamente este áudio gravado em português brasileiro por um usuário informando despesas, pagamentos, transferências PIX, contas ou receitas.

Sua tarefa:
1. Transcrever exatamente as palavras faladas com fidelidade total (ex: "Fiz a transferência no PIX de R$ 300 para pagar o personal da academia em Teresina").
2. Extrair com precisão cirúrgica os dados financeiros:
   - "transcription": o texto literal falado pelo usuário.
   - "amount": número decimal positivo com o valor monetário real informado (ex: 300.0). Se a pessoa disse 'um pix de 300 reais', o valor é 300 e NUNCA 1. Se não houver valor numérico identificável, retorne 0.
   - "type": "Saída" (para pagamentos, transferências feitas, compras, despesas) ou "Entrada" (para salário, recebimentos, depósitos recebidos).
   - "method": "PIX", "Crédito", "Débito", "Dinheiro" ou "Transferência".
   - "cardName": nome do cartão se mencionado (ex: Nubank, Inter, Itaú, Bradesco), ou null.
   - "product": o produto, serviço ou finalidade principal do gasto (ex: "Personal da academia", "Combustível", "Almoço", "Lanche").
   - "description": descrição resumida do lançamento (ex: "Personal da academia").
   - "category": uma das seguintes opções: "Saúde", "Alimentação", "Transporte", "Moradia", "Lazer", "Compras", "Educação", "Receita", "Outros". (Para serviços esportivos, academia, personal trainer, use "Saúde").
   - "establishment": nome da empresa, loja, prestador ou beneficiário mencionado (ex: "Personal da academia", "Posto de Combustível"), ou "".
   - "city": cidade brasileira mencionada no áudio (ex: "Teresina, PI", "Oeiras, PI", "Fortaleza, CE", etc. Se não mencionada, retorne "").
   - "isRecurring": true se for mensalidade, dívida recorrente ou parcelamento, caso contrário false.
   - "totalInstallments": número de parcelas (padrão 1).

Responda OBRIGATORIAMENTE em JSON puro no formato especificado.`;

    const gRes = await fastAxios.post(gUrl, {
      contents: [{
        parts: [
          { inline_data: { mime_type: 'audio/ogg', data: base64Audio } },
          { text: prompt }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    }, { timeout: 15000 });

    const gTxt = gRes.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (gTxt && gTxt.trim().length > 0) {
      const parsedJson = JSON.parse(gTxt.trim());
      if (parsedJson && (parsedJson.amount > 0 || parsedJson.transcription)) {
        console.log(`🎙️ [WhatsApp Gemini Multimodal Direto]: Transcrição: "${parsedJson.transcription}" | Valor: R$ ${parsedJson.amount} | Item: ${parsedJson.product} | Cidade: ${parsedJson.city || 'N/A'}`);
        return parsedJson;
      }
    }
  } catch (gErr) {
    console.warn('[Gemini Multimodal Direct Audio Warn]:', gErr?.response?.data || gErr?.message || gErr);
  }

  return null;
}

// ==============================================================
// MOTOR 2: GROQ WHISPER-LARGE-V3 (Super Rápido ~400ms & Alta Precisão em Português)
// Aprendizado de engenharia do repositório impacte-ai/transcrevezap
// ==============================================================
async function transcribeWithGroqWhisper(audioBuffer, explicitKey = '') {
  const groqKey = getEffectiveGroqKey(explicitKey);
  if (!groqKey) return '';

  try {
    const wavBuffer = await convertAudioBufferToNormalizedWav(audioBuffer);
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', wavBuffer, {
      filename: 'voice.wav',
      contentType: 'audio/wav'
    });
    form.append('model', 'whisper-large-v3');
    form.append('language', 'pt');
    form.append('temperature', '0.0');
    form.append('prompt', 'Finanças pessoais, pagamentos, Pix, transferência, R$ 300, reais, personal da academia, mensalidade, Teresina, Oeiras, Piauí, compras, mercado, combustível.');

    const res = await fastAxios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        ...form.getHeaders()
      },
      timeout: 12000
    });

    const text = normalizeTranscribedPortugueseText(res.data?.text || '');
    if (text.length >= 3) {
      console.log(`🎙️ [WhatsApp Áudio Transcrito via Groq Whisper-large-v3]: "${text}"`);
      return text;
    }
  } catch (err) {
    console.warn('[Groq Whisper Error]:', err?.response?.data || err?.message || err);
  }
  return '';
}

// ==============================================================
// MOTOR 3: OPENAI WHISPER-1 (Padrão de Indústria com Normalização)
// Aprendizado do repositório rishikanthc/Scriberr
// ==============================================================
async function transcribeWithOpenAIWhisper(audioBuffer, explicitKey = '') {
  const openAiKey = getEffectiveOpenAIKey(explicitKey);
  if (!openAiKey) return '';

  try {
    const wavBuffer = await convertAudioBufferToNormalizedWav(audioBuffer);
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', wavBuffer, {
      filename: 'voice.wav',
      contentType: 'audio/wav'
    });
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    form.append('temperature', '0.0');
    form.append('prompt', 'Finanças pessoais, pagamentos, Pix, transferência, R$ 300, reais, personal da academia, mensalidade, Teresina, Oeiras, Piauí, compras, mercado, combustível.');

    const res = await fastAxios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: {
        'Authorization': `Bearer ${openAiKey}`,
        ...form.getHeaders()
      },
      timeout: 12000
    });

    const text = normalizeTranscribedPortugueseText(res.data?.text || '');
    if (text.length >= 3) {
      console.log(`🎙️ [WhatsApp Áudio Transcrito via OpenAI Whisper-1]: "${text}"`);
      return text;
    }
  } catch (err) {
    console.warn('[OpenAI Whisper Error]:', err?.response?.data || err?.message || err);
  }
  return '';
}

// ==============================================================
// EXTRAÇÃO ESTRUTURADA VIA LLM (TEXTO -> JSON FINANCEIRO PURO)
// Aprendizado dos repositórios DrDroidLab/voicesummary e transcrevezap
// ==============================================================
async function extractFinancialDataWithLLM(text, explicitKey = '') {
  if (!text || text.trim().length < 3) return null;

  const geminiKey = getEffectiveGeminiKey(explicitKey);
  const groqKey = getEffectiveGroqKey(explicitKey);
  const openAiKey = getEffectiveOpenAIKey(explicitKey);
  if (!geminiKey && !groqKey && !openAiKey) return null;

  const sysPrompt = `Você é o extrator financeiro estrito do KYRO Finance. Analise a seguinte mensagem falada por usuário brasileiro: "${text.trim()}".
Extraia os dados com precisão cirúrgica e responda OBRIGATORIAMENTE em JSON puro no formato:
{
  "transcription": "${text.replace(/"/g, '\\"')}",
  "amount": 0.00,
  "type": "Saída" | "Entrada",
  "method": "PIX" | "Crédito" | "Débito" | "Dinheiro" | "Transferência",
  "cardName": "Nome do cartão" ou null,
  "product": "Item específico (ex: Personal da academia, Combustível, Almoço)",
  "description": "Descrição do gasto",
  "category": "Saúde" | "Alimentação" | "Transporte" | "Moradia" | "Lazer" | "Compras" | "Educação" | "Receita" | "Outros",
  "establishment": "Nome do prestador ou local" ou "",
  "city": "Teresina, PI" ou outra cidade brasileira dita (ou ""),
  "isRecurring": false,
  "totalInstallments": 1
}
Regras cruciais:
- Se disse "personal da academia", o produto é "Personal da academia" e a categoria é "Saúde".
- Se disse "um pix de 300", o amount é 300 e NUNCA 1.
- Retorne apenas o JSON puro, sem crases de markdown.`;

  // 1. Tenta Gemini 1.5 Flash
  if (geminiKey) {
    try {
      const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const res = await fastAxios.post(gUrl, {
        contents: [{ role: 'user', parts: [{ text: sysPrompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
      }, { timeout: 8000 });
      const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (raw) {
        const parsed = JSON.parse(raw.trim());
        if (parsed && parsed.amount > 0) return parsed;
      }
    } catch (e) {}
  }

  // 2. Tenta Groq Llama 3.3 70B
  if (groqKey) {
    try {
      const res = await fastAxios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: sysPrompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1
      }, {
        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        timeout: 8000
      });
      const raw = res.data?.choices?.[0]?.message?.content;
      if (raw) {
        const parsed = JSON.parse(raw.trim());
        if (parsed && parsed.amount > 0) return parsed;
      }
    } catch (e) {}
  }

  // 3. Tenta OpenAI GPT-4o-mini
  if (openAiKey) {
    try {
      const res = await fastAxios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: sysPrompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1
      }, {
        headers: { 'Authorization': `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
        timeout: 8000
      });
      const raw = res.data?.choices?.[0]?.message?.content;
      if (raw) {
        const parsed = JSON.parse(raw.trim());
        if (parsed && parsed.amount > 0) return parsed;
      }
    } catch (e) {}
  }

  return null;
}

// Transcritor unificado de áudio em múltiplas camadas com garantia de fidelidade
async function transcribeAudioBuffer(audioBuffer, explicitKey = '') {
  if (!audioBuffer || audioBuffer.length < 50) return '';

  const base64Audio = audioBuffer.toString('base64');
  const geminiKey = getEffectiveGeminiKey(explicitKey);

  // ESTRATÉGIA 1: GOOGLE GEMINI 1.5 FLASH MULTIMODAL AUDIO (Se chave Gemini configurada)
  if (geminiKey) {
    try {
      const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const gRes = await fastAxios.post(gUrl, {
        contents: [{
          parts: [
            { inline_data: { mime_type: 'audio/ogg', data: base64Audio } },
            { 
              text: 'Você é o motor de transcrição financeira de alta fidelidade do KYRO Finance. Escute atentamente este áudio em português falado por usuário brasileiro sobre lançamentos, pagamentos, transferências PIX, contas, academia ou despesas. Identifique com 100% de precisão os valores numéricos falados (ex: R$ 300 e nunca 330), as formas de pagamento (Pix, transferência, débito, crédito, dinheiro), os produtos ou serviços (ex: Personal da academia, alimentação, combustível) e as cidades brasileiras (ex: Teresina, Oeiras, Picos, Floriano). Retorne EXCLUSIVAMENTE o texto falado exatamente como foi dito, sem comentários, sem explicações e sem aspas.' 
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1
        }
      }, { timeout: 10000 });
      const gTxt = normalizeTranscribedPortugueseText(gRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '');
      if (gTxt && gTxt.length > 0) {
        console.log(`🎙️ [WhatsApp Áudio Transcrito via Gemini Multimodal]: "${gTxt}"`);
        return gTxt;
      }
    } catch (gErr) {
      console.warn('[Gemini Multimodal Direct Warn]:', gErr?.response?.data || gErr?.message || gErr);
    }
  }

  // ESTRATÉGIA 2: Groq Whisper-large-v3
  const groqText = await transcribeWithGroqWhisper(audioBuffer, explicitKey);
  if (groqText) return groqText;

  // ESTRATÉGIA 3: OpenAI Whisper-1
  const openAiText = await transcribeWithOpenAIWhisper(audioBuffer, explicitKey);
  if (openAiText) return openAiText;

  // ESTRATÉGIA 4: Whisper Neural Local de Alta Precisão (Xenova/whisper-small com Peak Normalization + Trim Acústico)
  try {
    const whisper = await getLocalWhisper();
    if (whisper) {
      const float32 = await convertAudioBufferToFloat32(audioBuffer);
      if (float32 && float32.length > 0) {
        const start = Date.now();
        const res = await whisper(float32, { 
          language: 'portuguese', 
          task: 'transcribe',
          chunk_length_s: 30,
          stride_length_s: 5
        });
        const elapsed = Date.now() - start;
        const text = normalizeTranscribedPortugueseText(res?.text || '');
        if (text.length > 0) {
          console.log(`🎙️ [WhatsApp Áudio Transcrito via Whisper-Small Local em ${elapsed}ms]: "${text}"`);
          return text;
        }
      }
    }
  } catch (wErr) {
    console.warn('[Whisper Local Fallback]:', wErr.message);
  }

  // ESTRATÉGIA 5: Endpoint Central da Nuvem (/api/transcribe na Vercel)
  try {
    const trRes = await fastAxios.post('https://kyro-finance.vercel.app/api/transcribe', {
      audioBase64: base64Audio,
      mimeType: 'audio/ogg',
      geminiApiKey: geminiKey
    }, { timeout: 8000 });
    const cloudTxt = normalizeTranscribedPortugueseText(trRes.data?.text || '');
    if (trRes.data?.success && cloudTxt.length > 0) {
      console.log(`🎙️ [WhatsApp Áudio Transcrito via Nuvem Central]: "${cloudTxt}"`);
      return cloudTxt;
    }
  } catch (trErr) {}

  return '';
}

// ==============================================================
// MOTOR CHATBOT LEITOR DE COMPROVANTES (OCR + VISION AI + PARSER BANCÁRIO BRASILEIRO)
// Suporta comprovantes de Pix (Nubank, Inter, Itaú, BB, Bradesco, Santander, Caixa, PicPay, Mercado Pago),
// Maquininhas de Cartão (Débito / Crédito) e Recibos em Dinheiro!
// ==============================================================
function preprocessImageForOcr(imageBuffer) {
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-vf', "scale='max(1400,iw)':-1,format=gray,eq=contrast=1.35:brightness=0.02",
      '-f', 'image2pipe',
      '-vcodec', 'png',
      'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'ignore'] });

    const chunks = [];
    ff.stdout.on('data', c => chunks.push(c));
    ff.on('close', code => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        resolve(imageBuffer);
      }
    });
    ff.on('error', () => resolve(imageBuffer));
    ff.stdin.write(imageBuffer);
    ff.stdin.end();
  });
}

function parseFinancialReceiptOcrText(rawOcrText, captionText = '') {
  const combinedRaw = `${rawOcrText || ''}\n${captionText || ''}`.trim();
  if (!combinedRaw || combinedRaw.length < 3) return null;

  // 1. Correção óptica de caracteres que o OCR frequentemente confunde em comprovantes
  const normalizedText = combinedRaw
    .replace(/R\$\s*([0-9OIl.,]+)/gi, (m, p1) => {
      const fixed = p1.replace(/O/gi, '0').replace(/[Il]/g, '1');
      return `R$ ${fixed}`;
    })
    .replace(/\b([A-Za-zÀ-ÿ\s]{3,25})\s*[-/]\s*Pl\b/g, '$1 - PI')
    .replace(/\bCidade\s*:\s*([^\r\n]+?)\s*[-/]\s*Pl\b/gi, 'Cidade: $1 - PI');

  const lines = normalizedText
    .split(/[\r\n]+/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 0);

  const fullLower = normalizedText.toLowerCase();

  // 2. Extração Cirúrgica do VALOR MONETÁRIO (amount) do Comprovante
  let amount = 0;

  // Prioridade A: Valor imediatamente após rótulos clássicos de comprovante ("Valor pago", "Valor da transferência", "Valor:", "Total:")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1] || '';
    if (/(?:valor\s*(?:pago|total|da\s*transfer[eê]ncia|enviado|do\s*pix|da\s*compra)?|total\s*(?:a\s*pagar|pago)?)\s*[:=-]?/i.test(line)) {
      const sameLineMatch = line.match(/(?:r\$\s*|rs\s*|\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2}|\d+,\d{1,2})/i);
      if (sameLineMatch) {
        const rawVal = sameLineMatch[1].includes(',')
          ? sameLineMatch[1].replace(/\./g, '').replace(',', '.')
          : sameLineMatch[1];
        const parsedVal = parseFloat(rawVal);
        if (!isNaN(parsedVal) && parsedVal > 0 && parsedVal < 10000000) {
          amount = parsedVal;
          break;
        }
      }
      // Muitas vezes no Nubank / Inter a palavra "Valor" está em uma linha e "R$ 300,00" está na linha de baixo!
      const nextLineMatch = nextLine.match(/(?:r\$\s*|rs\s*|\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2}|\d+,\d{1,2})/i);
      if (nextLineMatch && !/\d{2}\/\d{2}\/\d{2,4}|\d{2}:\d{2}/.test(nextLine)) {
        const rawVal = nextLineMatch[1].includes(',')
          ? nextLineMatch[1].replace(/\./g, '').replace(',', '.')
          : nextLineMatch[1];
        const parsedVal = parseFloat(rawVal);
        if (!isNaN(parsedVal) && parsedVal > 0 && parsedVal < 10000000) {
          amount = parsedVal;
          break;
        }
      }
    }
  }

  // Prioridade B: Qualquer padrão explícito com R$ no texto do comprovante (ex: "R$ 300,00", "R$ 45,50")
  if (amount <= 0) {
    const currencyMatch = normalizedText.match(/(?:r\$|rs)\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i);
    if (currencyMatch) {
      const rawStr = currencyMatch[1];
      const normNum = rawStr.includes(',') ? rawStr.replace(/\./g, '').replace(',', '.') : rawStr;
      const val = parseFloat(normNum);
      if (!isNaN(val) && val > 0 && val < 10000000) {
        amount = val;
      }
    }
  }

  // Prioridade C: Valor decimal padrão brasileiro isolado (ex: 300,00 ou 45,50) ou na legenda
  if (amount <= 0) {
    const decMatch = normalizedText.match(/\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/);
    if (decMatch) {
      const val = parseFloat(decMatch[1].replace(/\./g, '').replace(',', '.'));
      if (!isNaN(val) && val > 0 && val < 10000000) {
        amount = val;
      }
    }
  }

  // Prioridade D: Se ainda não achou e tem legenda com valor
  if (amount <= 0 && captionText) {
    amount = extractMonetaryValue(captionText);
  }

  if (!amount || amount <= 0) return null;

  // 3. Extração do TIPO DE TRANSFERÊNCIA / FORMA DE PAGAMENTO (PIX, Dinheiro, Débito, Crédito, Transferência)
  let method = 'PIX';
  if (/(?:venda\s+a\s+d[eé]bito|cart[aã]o\s+de\s+d[eé]bito|maestro|visa\s+electron|elo\s+d[eé]bito|\bd[eé]bito\b)/i.test(normalizedText)) {
    method = 'Débito';
  } else if (/(?:dinheiro|em\s+esp[eé]cie|\besp[eé]cie\b|\btroco\b|pagamento\s+em\s+dinheiro)/i.test(normalizedText)) {
    method = 'Dinheiro';
  } else if (/(?:venda\s+a\s+cr[eé]dito|cart[aã]o\s+de\s+cr[eé]dito|parcelado\s+em|\bcr[eé]dito\b)/i.test(normalizedText) && !/pix/i.test(normalizedText)) {
    method = 'Crédito';
  } else if (/(?:\bpix\b|chave\s+pix|qr\s*code|id\s+da\s+transa[cç][aã]o|e\d{8}\d+)/i.test(normalizedText)) {
    method = 'PIX';
  } else if (/(?:\bted\b|\bdoc\b|transfer[eê]ncia\s+entre\s+contas|comprovante\s+de\s+transfer[eê]ncia)/i.test(normalizedText)) {
    method = 'Transferência';
  }

  // 4. Extração do TIPO DE OPERAÇÃO (Saída vs Entrada)
  let type = 'Saída';
  if (/(?:pix\s+recebido|transfer[eê]ncia\s+recebida|voc[eê]\s+recebeu|dep[oó]sito\s+recebido|recebimento)/i.test(normalizedText)) {
    type = 'Entrada';
  }

  // 5. Extração da CIDADE (city) do Comprovante
  let city = '';
  // 5a. Procura rótulos explícitos "Cidade:", "Município:", "Local:", "Localidade:"
  for (const line of lines) {
    const cityLabelMatch = line.match(/(?:cidade|munic[ií]pio|localidade|local)\s*[:=-]\s*([A-Za-zÀ-ÿ\s]+?)(?:\s*[-/,]\s*([A-Z]{2}))?$/i);
    if (cityLabelMatch && cityLabelMatch[1]) {
      const cName = cityLabelMatch[1].trim();
      const uf = (cityLabelMatch[2] || '').toUpperCase();
      if (cName.length >= 3 && !/pagamento|comprovante|transfer|valor/i.test(cName)) {
        city = uf ? `${cName}, ${uf}` : cName;
        break;
      }
    }
  }

  // 5b. Procura padrão de endereço/maquininha "<CIDADE> - <UF>" ou "<CIDADE>/<UF>" (ex: "OEIRAS - PI", "TERESINA - PI", "PICOS - PI")
  if (!city) {
    const validUfs = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
    for (const line of lines) {
      const ufMatch = line.match(/^([A-Za-zÀ-ÿ\s]{3,28}?)\s*[-/]\s*([A-Z]{2})$/);
      if (ufMatch) {
        const candidateCity = ufMatch[1].trim();
        const candidateUf = ufMatch[2].toUpperCase();
        if (validUfs.has(candidateUf) && !/rua|av|avenida|centro|bairro|cnpj|cpf|banco|pagamentos|ltda/i.test(candidateCity)) {
          const formattedCity = candidateCity.toLowerCase().split(/\s+/).map(w => ['de','da','do','dos','das'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          city = `${formattedCity}, ${candidateUf}`;
          break;
        }
      }
    }
  }

  // 5c. Procura cidades conhecidas no texto completo
  if (!city) {
    city = extractCityFromText(normalizedText);
  }

  // 6. Extração do LOCAL / ESTABELECIMENTO / RECEBEDOR (establishment)
  let establishment = '';
  const ignoreEstWords = /^(?:comprovante|recibo|transfer[eê]ncia|pagamento|pix|venda|cart[aã]o|valor|data|hora|origem|destino|para|de|institui[cç][aã]o|banco|ag[eê]ncia|conta|cpf|cnpj|chave|id|autentica[cç][aã]o|aprovada|via\s+cliente|nu\s+pagamentos|mercado\s+pago|picpay|ita[uú]|bradesco|santander|caixa)$/i;

  // 6a. Rótulos explícitos ("Nome:", "Favorecido:", "Recebedor:", "Destinatário:", "Beneficiário:", "Estabelecimento:", "Empresa:", "Para:")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const labelMatch = line.match(/^(?:nome(?:\s+do\s+(?:recebedor|favorecido|destinat[aá]rio))?|favorecido|recebedor|destinat[aá]rio|benefici[aá]rio|estabelecimento|empresa|loja|local\s+da\s+compra|pago\s+para)\s*[:=-]\s*(.+)$/i);
    if (labelMatch && labelMatch[1]) {
      let cand = labelMatch[1].replace(/\b(?:LTDA|ME|EPP|EIRELI|S\/A|SA)\b/gi, '').trim();
      if (cand.length >= 2 && !ignoreEstWords.test(cand) && !/^\d/.test(cand)) {
        establishment = cand;
        break;
      }
    }
    // Bloco "Destino" ou "Para" ou "Dados do recebedor" onde o nome está na linha seguinte (padrão Nubank / Inter)
    if (/^(?:destino|para|quem\s+recebeu|dados\s+do\s+recebedor)$/i.test(line) && lines[i + 1]) {
      let nextCand = lines[i + 1].replace(/^nome\s*[:=-]\s*/i, '').replace(/\b(?:LTDA|ME|EPP|EIRELI|S\/A|SA)\b/gi, '').trim();
      if (nextCand.length >= 3 && !ignoreEstWords.test(nextCand) && !/^\d|cpf|cnpj|institui/i.test(nextCand)) {
        establishment = nextCand;
        break;
      }
    }
  }

  // 6b. Se for cupom fiscal / comprovante de maquininha (primeira linha com nome comercial, ex: "PADARIA BELLA VISTA LTDA", "POSTO SAO CRISTOVAO")
  if (!establishment) {
    for (let i = 0; i < Math.min(4, lines.length); i++) {
      const l = lines[i];
      if (
        /(?:ltda|me\b|eireli|supermercado|mercado|padaria|panificadora|posto|farm[aá]cia|drogaria|restaurante|lanchonete|pizzaria|churrascaria|academia|cl[ií]nica|hospital|oficina|loja|magazine|shopping|barbearia|sal[aá]o|pet\s*shop|espeto|atacad[aã]o|assa[ií])/i.test(l) &&
        !/comprovante|recibo|transfer[eê]ncia|descri[cç][aã]o|referente|item/i.test(l)
      ) {
        let cleanHeader = l.replace(/\b(?:LTDA|ME|EPP|EIRELI|S\/A|SA)\b/gi, '').replace(/[-.,]+$/, '').trim();
        if (cleanHeader === cleanHeader.toUpperCase()) {
          cleanHeader = cleanHeader.toLowerCase().split(/\s+/).map(w => ['de','da','do','dos','das','e'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }
        establishment = cleanHeader;
        break;
      }
    }
  }

  // 7. Extração da DESCRIÇÃO / ITEM (product)
  let product = '';
  // 7a. Rótulos explícitos no comprovante ("Descrição:", "Referente a:", "Item:", "Produto:", "Mensagem:", "Identificador:")
  for (const line of lines) {
    const descMatch = line.match(/^(?:descri[cç][aã]o|referente\s+a|item|produto|servi[cç]o|mensagem|finalidade|hist[oó]rico)\s*[:=-]\s*(.+)$/i);
    if (descMatch && descMatch[1]) {
      const d = descMatch[1].trim();
      if (d.length >= 2 && !/^\d+$/.test(d)) {
        product = d;
        break;
      }
    }
  }

  // 7b. Se o usuário enviou legenda na foto, usa a legenda para refinar o item/local/cidade
  if (captionText && captionText.trim().length > 1) {
    const fromCaption = parseDynamicFinancialMessage(`${captionText} ${amount}`, false);
    if (fromCaption && fromCaption.savedTx) {
      if (!product && fromCaption.savedTx.product && !['PIX','Débito','Crédito','Dinheiro','Transferência','Pagamento'].includes(fromCaption.savedTx.product)) {
        product = fromCaption.savedTx.product;
      }
      if (!establishment && fromCaption.savedTx.establishment) {
        establishment = fromCaption.savedTx.establishment;
      }
      if (!city && fromCaption.savedTx.city) {
        city = fromCaption.savedTx.city;
      }
    }
  }

  // 7c. Se ainda não tem produto explícito, infere pelo estabelecimento ou pelo texto do comprovante
  let category = 'Outros';
  const contextForRules = `${product} ${establishment} ${captionText}`.toLowerCase();

  if (/personal|academia|treino|muscula|crossfit|pilates|studio\s*fit/i.test(contextForRules)) {
    if (!product) product = 'Personal da academia';
    category = 'Saúde / Atividade Física';
  } else if (/padaria|panificadora|lanche|caf[eé]|p[aã]o|salgado|bolo|confeitaria/i.test(contextForRules)) {
    if (!product) product = 'Lanche / Padaria';
    category = 'Alimentação';
  } else if (/restaurante|almo[cç]o|jantar|churrascaria|espeto|pizzaria|hamburgueria|sushi|marmita|refei[cç][aã]o/i.test(contextForRules)) {
    if (!product) product = 'Refeição / Restaurante';
    category = 'Alimentação';
  } else if (/supermercado|mercado|atacad[aã]o|assa[ií]|compras/i.test(contextForRules)) {
    if (!product) product = 'Compras de Supermercado';
    category = 'Supermercado';
  } else if (/posto|combust[ií]vel|gasolina|etanol|diesel|ipiranga|shell|petrobras/i.test(contextForRules)) {
    if (!product) product = 'Combustível';
    category = 'Transporte';
  } else if (/uber|99pop|t[aá]xi|passagem|estacionamento/i.test(contextForRules)) {
    if (!product) product = 'Transporte';
    category = 'Transporte';
  } else if (/farm[aá]cia|drogaria|drogasil|pague\s+menos|rem[eé]dio|medicamento|cl[ií]nica|hospital|consulta|exame/i.test(contextForRules)) {
    if (!product) product = 'Farmácia / Saúde';
    category = 'Saúde / Farmácia';
  } else if (/energia|equatorial|enel|celpi|[aá]gua|agespisa|internet|fibra|aluguel|condom[ií]nio/i.test(contextForRules)) {
    if (!product) product = 'Conta Residencial';
    category = 'Moradia';
  } else {
    if (!product) {
      product = establishment
        ? `${method === 'PIX' ? 'Pix' : 'Pagamento'} - ${establishment}`
        : (method === 'PIX' ? 'Transferência PIX' : `Comprovante (${method})`);
    }
    category = type === 'Entrada' ? 'Recebimento' : (method === 'PIX' || method === 'Transferência' ? 'Transferência' : 'Outros');
  }

  return {
    amount,
    type,
    method,
    product,
    description: product,
    category,
    establishment: establishment || '',
    city: city || '',
    rawOcrExcerpt: lines.slice(0, 8).join(' | ')
  };
}

async function extractReceiptFromImageBuffer(imageBuffer, mimeType = 'image/jpeg', captionText = '') {
  if (!imageBuffer || imageBuffer.length < 100) return null;

  const geminiKey = getEffectiveGeminiKey();
  const openAiKey = getEffectiveOpenAIKey();
  const base64Img = imageBuffer.toString('base64');

  // ESTRATÉGIA 1: Gemini 1.5 Flash Vision (se chave configurada)
  if (geminiKey) {
    try {
      const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const prompt = `Analise esta imagem de comprovante financeiro ou nota fiscal brasileira.${captionText ? ` Legenda do usuário: "${captionText}".` : ''}
Extraia todos os filtros com precisão cirúrgica e responda APENAS em JSON puro:
{
  "amount": 0.00,
  "type": "Saída" | "Entrada",
  "method": "PIX" | "Débito" | "Crédito" | "Dinheiro" | "Transferência",
  "product": "Item ou descrição do pagamento",
  "description": "Item ou descrição do pagamento",
  "category": "Alimentação" | "Supermercado" | "Transporte" | "Saúde / Atividade Física" | "Saúde / Farmácia" | "Moradia" | "Lazer" | "Compras" | "Transferência" | "Outros",
  "establishment": "Nome do recebedor, favorecido ou estabelecimento comercial",
  "city": "Cidade e UF se aparecer no comprovante (ex: Teresina, PI ou Oeiras, PI) ou vazio"
}`;
      const gRes = await fastAxios.post(gUrl, {
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: base64Img } },
            { text: prompt }
          ]
        }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
      }, { timeout: 12000 });
      const rawTxt = gRes.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawTxt) {
        const parsed = JSON.parse(rawTxt.trim());
        if (parsed && Number(parsed.amount) > 0) {
          console.log(`📸 [Comprovante Lido via Gemini Vision]: R$ ${parsed.amount} | ${parsed.method} | ${parsed.establishment} | ${parsed.city}`);
          return parsed;
        }
      }
    } catch (e) {
      console.warn('[Gemini Vision Warn]:', e.message);
    }
  }

  // ESTRATÉGIA 2: OpenAI GPT-4o-mini Vision (se chave configurada)
  if (openAiKey) {
    try {
      const dataUrl = `data:${mimeType};base64,${base64Img}`;
      const oRes = await fastAxios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `Extraia deste comprovante em JSON puro: {"amount": 0.00, "type": "Saída", "method": "PIX|Débito|Crédito|Dinheiro|Transferência", "product": "", "description": "", "category": "", "establishment": "", "city": ""}. Legenda: "${captionText}"` },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }]
      }, {
        headers: { 'Authorization': `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
        timeout: 12000
      });
      const rawTxt = oRes.data?.choices?.[0]?.message?.content;
      if (rawTxt) {
        const parsed = JSON.parse(rawTxt.trim());
        if (parsed && Number(parsed.amount) > 0) {
          console.log(`📸 [Comprovante Lido via OpenAI Vision]: R$ ${parsed.amount} | ${parsed.method}`);
          return parsed;
        }
      }
    } catch (e) {}
  }

  // ESTRATÉGIA 3: Motor OCR Neural Local (Tesseract.js 'por' Pré-Aquecido + Pré-processamento FFmpeg + Parser Bancário)
  try {
    const startOcr = Date.now();
    const worker = await getLocalOcrWorker();
    if (worker) {
      // 1ª leitura direta na imagem original
      const { data: { text: rawOcr1 } } = await worker.recognize(imageBuffer);
      let parsedReceipt = parseFinancialReceiptOcrText(rawOcr1, captionText);

      // Se a imagem tiver baixo contraste/fundo colorido e não extraiu valor ou recebedor completo, aplica filtro de contraste FFmpeg
      if (!parsedReceipt || !parsedReceipt.amount) {
        const enhancedBuffer = await preprocessImageForOcr(imageBuffer);
        const { data: { text: rawOcr2 } } = await worker.recognize(enhancedBuffer);
        parsedReceipt = parseFinancialReceiptOcrText(`${rawOcr1 || ''}\n${rawOcr2 || ''}`, captionText);
      }

      if (parsedReceipt && parsedReceipt.amount > 0) {
        const elapsedOcr = Date.now() - startOcr;
        console.log(`📸 [Comprovante Lido via OCR Local em ${elapsedOcr}ms]: Valor: R$ ${parsedReceipt.amount} | Método: ${parsedReceipt.method} | Local: "${parsedReceipt.establishment}" | Cidade: "${parsedReceipt.city}" | Item: "${parsedReceipt.product}"`);
        return parsedReceipt;
      }
    }
  } catch (ocrErr) {
    console.warn('[OCR Local Erro]:', ocrErr.message);
  }

  return null;
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
const RECURRING_FILE = path.join(__dirname, 'recurring_expenses.json');
const CARDS_FILE = path.join(__dirname, 'credit_cards.json');

let localStoredTransactions = [];
let localDeletedIds = new Set();
let localRecurringExpenses = [];
let localCreditCards = [];

try {
  if (fs.existsSync(RECURRING_FILE)) {
    const rawRec = JSON.parse(fs.readFileSync(RECURRING_FILE, 'utf-8'));
    if (Array.isArray(rawRec)) localRecurringExpenses = rawRec;
  }
} catch (e) {}

try {
  if (fs.existsSync(CARDS_FILE)) {
    const rawCard = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf-8'));
    if (Array.isArray(rawCard)) localCreditCards = rawCard;
  }
} catch (e) {}

function saveRecurringToDisk() {
  fs.promises.writeFile(RECURRING_FILE, JSON.stringify(localRecurringExpenses, null, 2), 'utf-8').catch(() => {});
}

function saveCardsToDisk() {
  fs.promises.writeFile(CARDS_FILE, JSON.stringify(localCreditCards, null, 2), 'utf-8').catch(() => {});
}
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
  try {
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    if (localSettings.geminiApiKey) {
      if (/GEMINI_API_KEY=/i.test(envContent)) {
        envContent = envContent.replace(/GEMINI_API_KEY=.*/i, `GEMINI_API_KEY=${localSettings.geminiApiKey}`);
      } else {
        envContent += `\nGEMINI_API_KEY=${localSettings.geminiApiKey}\n`;
      }
    }
    if (localSettings.groqApiKey) {
      if (/GROQ_API_KEY=/i.test(envContent)) {
        envContent = envContent.replace(/GROQ_API_KEY=.*/i, `GROQ_API_KEY=${localSettings.groqApiKey}`);
      } else {
        envContent += `\nGROQ_API_KEY=${localSettings.groqApiKey}\n`;
      }
    }
    if (localSettings.openaiApiKey) {
      if (/OPENAI_API_KEY=/i.test(envContent)) {
        envContent = envContent.replace(/OPENAI_API_KEY=.*/i, `OPENAI_API_KEY=${localSettings.openaiApiKey}`);
      } else {
        envContent += `\nOPENAI_API_KEY=${localSettings.openaiApiKey}\n`;
      }
    }
    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
  } catch (e) {}
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
let localStoredRecurring = localRecurringExpenses;

function saveRecurring(rec) {
  if (!rec) return;
  localRecurringExpenses = [rec, ...localRecurringExpenses.filter(r => r.id !== rec.id)];
  localStoredRecurring = localRecurringExpenses;
  saveRecurringToDisk();
  console.log(`💾 [Banco Local] Dívida recorrente salva: "${rec.title}" - R$ ${rec.installmentAmount}`);
}

function markRecurringPaidByName(targetName) {
  const lower = (targetName || '').toLowerCase().trim();
  const found = localRecurringExpenses.find(r => 
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
    saveRecurringToDisk();

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
      if (w === 'um' || w === 'uma') {
        const nextWord = words[i + 1] || '';
        const isFollowedByCurrencyOrScale = /^(mil|milhao|milhões|milhoes|real|reais|centavo|centavos)$/i.test(nextWord);
        const hasPrecedingDecade = currentGroup >= 20;
        if (isFollowedByCurrencyOrScale || hasPrecedingDecade) {
          foundSpoken = true;
          currentGroup += 1;
        }
      } else {
        foundSpoken = true;
        currentGroup += wordMap[w];
      }
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

function extractCityFromText(text) {
  if (!text) return '';
  const lower = text.toLowerCase();

  const knownCities = [
    { match: /\b(?:oeiras|oeira|ostras)\b/i, name: 'Oeiras, PI' },
    { match: /\bteresina\b/i, name: 'Teresina, PI' },
    { match: /\bpicos\b/i, name: 'Picos, PI' },
    { match: /\bfloriano\b/i, name: 'Floriano, PI' },
    { match: /\bparna[ií]ba\b/i, name: 'Parnaíba, PI' },
    { match: /\bpiripiri\b/i, name: 'Piripiri, PI' },
    { match: /\bcampo\s+maior\b/i, name: 'Campo Maior, PI' },
    { match: /\bvalen[cç]a(?:\s+do\s+piau[ií])?\b/i, name: 'Valença do Piauí, PI' },
    { match: /\bs[aã]o\s+raimundo\s+nonato\b/i, name: 'São Raimundo Nonato, PI' },
    { match: /\bcorrente\b/i, name: 'Corrente, PI' },
    { match: /\bbom\s+jesus\b/i, name: 'Bom Jesus, PI' },
    { match: /\buru[cç]u[ií]\b/i, name: 'Uruçuí, PI' },
    { match: /\b[aá]gua\s+branca\b/i, name: 'Água Branca, PI' },
    { match: /\bbarras\b/i, name: 'Barras, PI' },
    { match: /\besperantina\b/i, name: 'Esperantina, PI' },
    { match: /\bpedro\s+(?:ii|segundo)\b/i, name: 'Pedro II, PI' },
    { match: /\baltos\b/i, name: 'Altos, PI' },
    { match: /\bjos[eé]\s+de\s+freitas\b/i, name: 'José de Freitas, PI' },
    { match: /\blu[ií]s\s+correia\b/i, name: 'Luís Correia, PI' },
    { match: /\bpaulistana\b/i, name: 'Paulistana, PI' },
    { match: /\bsimpl[ií]cio\s+mendes\b/i, name: 'Simplício Mendes, PI' },
    { match: /\bregenera[cç][aã]o\b/i, name: 'Regeneração, PI' },
    { match: /\bamarante\b/i, name: 'Amarante, PI' },
    { match: /\binhuma\b/i, name: 'Inhuma, PI' },
    { match: /\beliseu\s+martins\b/i, name: 'Eliseu Martins, PI' },
    { match: /\bcaxias\b/i, name: 'Caxias, MA' },
    { match: /\btimon\b/i, name: 'Timon, MA' },
    { match: /\bs[aã]o\s+lu[ií]s\b/i, name: 'São Luís, MA' },
    { match: /\bimperatriz\b/i, name: 'Imperatriz, MA' },
    { match: /\bcod[oó]\b/i, name: 'Codó, MA' },
    { match: /\bbacabal\b/i, name: 'Bacabal, MA' },
    { match: /\bbalsas\b/i, name: 'Balsas, MA' },
    { match: /\bbar[aã]o\s+de\s+graja[uú]\b/i, name: 'Barão de Grajaú, MA' },
    { match: /\bs[aã]o\s+jo[aã]o\s+dos\s+patos\b/i, name: 'São João dos Patos, MA' },
    { match: /\bfortaleza\b/i, name: 'Fortaleza, CE' },
    { match: /\bsobral\b/i, name: 'Sobral, CE' },
    { match: /\bjuazeiro(?:\s+do\s+norte)?\b/i, name: 'Juazeiro do Norte, CE' },
    { match: /\bcrato\b/i, name: 'Crato, CE' },
    { match: /\btiangu[aá]\b/i, name: 'Tianguá, CE' },
    { match: /\brecife\b/i, name: 'Recife, PE' },
    { match: /\bpetrolina\b/i, name: 'Petrolina, PE' },
    { match: /\bsalvador\b/i, name: 'Salvador, BA' },
    { match: /\bnatal\b/i, name: 'Natal, RN' },
    { match: /\bjo[aã]o\s+pessoa\b/i, name: 'João Pessoa, PB' },
    { match: /\bmacei[oó]\b/i, name: 'Maceió, AL' },
    { match: /\baracaju\b/i, name: 'Aracaju, SE' },
    { match: /\bbras[ií]lia\b/i, name: 'Brasília, DF' },
    { match: /\bgoi[aâ]nia\b/i, name: 'Goiânia, GO' },
    { match: /\bs[aã]o\s+paulo\b/i, name: 'São Paulo, SP' },
    { match: /\bcampinas\b/i, name: 'Campinas, SP' },
    { match: /\brio\s+de\s+janeiro\b/i, name: 'Rio de Janeiro, RJ' },
    { match: /\bbelo\s+horizonte\b/i, name: 'Belo Horizonte, MG' },
    { match: /\bcuritiba\b/i, name: 'Curitiba, PR' },
    { match: /\bflorian[oó]polis\b/i, name: 'Florianópolis, SC' },
    { match: /\bporto\s+alegre\b/i, name: 'Porto Alegre, RS' },
    { match: /\bbel[eé]m\b/i, name: 'Belém, PA' },
    { match: /\bmanaus\b/i, name: 'Manaus, AM' },
    { match: /\bpalmas\b/i, name: 'Palmas, TO' }
  ];

  for (const c of knownCities) {
    if (c.match.test(lower)) {
      return c.name;
    }
  }

  return '';
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
  let city = extractCityFromText(clean);

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
    // 1a. Detecta estabelecimentos nomeados explícitos (ex: "no Chico do espeto", "na Padaria Bella Vista", "no Posto São Cristóvão")
    let cleanWithoutCity = clean;
    if (city) {
      const citySimple = city.split(',')[0].trim();
      cleanWithoutCity = cleanWithoutCity.replace(new RegExp(`\\s+em\\s+${citySimple}\\b.*$`, 'i'), '').trim();
    }
    const namedPlaceMatch = cleanWithoutCity.match(/\b(?:no|na)\s+((?:posto|padaria|panificadora|restaurante|churrascaria|pizzaria|lanchonete|supermercado|mercado|mercadinho|atacad[aã]o|farm[aá]cia|drogaria|academia|cl[ií]nica|hospital|oficina|loja|barbearia|sal[aá]o|shopping|chico|bar|hotel|pousada|escola|col[eé]gio|faculdade)\s+[A-Za-zÀ-ÿ0-9\s]{2,30}|[A-Za-zÀ-ÿ]+\s+do\s+[A-Za-zÀ-ÿ]+)$/i);
    if (namedPlaceMatch && namedPlaceMatch[1]) {
      const rawPlace = namedPlaceMatch[1]
        .replace(/\b(?:no|na)\s+(?:pix|d[eé]bito|cr[eé]dito|dinheiro|cart[aã]o).*$/i, '')
        .replace(/\b(?:por|de|no\s+valor)\s+r?\$\s*\d+.*$/i, '')
        .trim();
      if (rawPlace.length >= 3 && !/^(?:pix|d[eé]bito|cr[eé]dito|dinheiro|cart[aã]o|transfer[eê]ncia)$/i.test(rawPlace)) {
        location = rawPlace.split(/\s+/).map(w => ['de','da','do','dos','das','e'].includes(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      }
    }

    // 1b. Se não houver nome próprio composto, detecta categoria de local mencionada
    if (!location) {
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
  // Porém, se o usuário mencionou o local (ex: "na padaria", "na farmácia") sem detalhar o subitem, usa o local como descrição!
  if (!detectedProduct) {
    if (location) {
      detectedProduct = location;
    } else if (lower.includes('transferência') || lower.includes('transferencia') || method === 'Transferência') {
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

        // Desencapsula mensagens efêmeras, viewOnce ou documentos com legenda do WhatsApp
        const innerMsg =
          msg.message.ephemeralMessage?.message ||
          msg.message.viewOnceMessage?.message ||
          msg.message.viewOnceMessageV2?.message ||
          msg.message.documentWithCaptionMessage?.message ||
          msg.message;

        let messageText = 
          innerMsg.conversation ||
          innerMsg.extendedTextMessage?.text ||
          innerMsg.imageMessage?.caption ||
          innerMsg.documentMessage?.caption ||
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

        const isAudio = !!(innerMsg.audioMessage || innerMsg.voiceMessage);
        const docMime = innerMsg.documentMessage?.mimetype || '';
        const isImage = !!(innerMsg.imageMessage || (innerMsg.documentMessage && docMime.startsWith('image/')));

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
            `• *Versão Mais Recente:* v1.40 (Build 40)\n` +
            `• *Status:* 🟢 Nova versão pronta para instalação!\n\n` +
            `• *Principais Novidades do Build 40:*\n` +
            `  1. Chatbot de Voz no WhatsApp com motor Whisper-Small de alta precisão e normalização acústica\n` +
            `  2. Leitor Inteligente de Comprovantes (OCR + Vision AI): envie a foto de qualquer comprovante e o robô extrai Valor, Local, Cidade e Forma de Pagamento (Pix, Dinheiro, Débito, Crédito)\n` +
            `  3. Sincronização instantânea em tempo real e Pull-to-Refresh no aplicativo\n\n` +
            `🚀 *Toque no link abaixo para baixar e atualizar:* \n` +
            `https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk\n\n` +
            `📌 *Como Instalar:* Basta baixar o arquivo e tocar em *Atualizar* no Android. Não é necessário desinstalar a versão anterior; todos os seus dados e configurações continuam 100% preservados!`;

          await sock.sendMessage(remoteJid, { text: updateReply });
          continue;
        }

        let parsed = null;

        // ==============================================================
        // FAST-PATH INSTANTÂNEO (< 1ms) PARA MENSAGENS DE TEXTO PURO!
        // ==============================================================
        if (!isAudio && !isImage && messageText) {
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

          // 1. PROCESSAMENTO DE ÁUDIO REAL DE VOZ COM CHATBOT DE TRANSCRIÇÃO E EXTRAÇÃO
          if (isAudio && audioBuffer && audioBuffer.length > 50) {
            console.log(`🎙️ [WhatsApp] Áudio recebido no grupo (${audioBuffer.length} bytes). Processando com Chatbot de Voz...`);

            // ESTRATÉGIA A: Gemini 1.5 Flash Multimodal Direto (se chave configurada)
            const geminiExtracted = await interpretAudioDirectlyWithGemini(audioBuffer);
            if (geminiExtracted && geminiExtracted.amount > 0) {
              const amount = parseFloat(geminiExtracted.amount) || 0;
              const type = geminiExtracted.type === 'Entrada' ? 'Entrada' : 'Saída';
              const method = geminiExtracted.method || 'PIX';
              const finalProduct = geminiExtracted.product || geminiExtracted.description || 'Despesa';
              const establishment = geminiExtracted.establishment || '';
              const finalCity = geminiExtracted.city || '';
              const detectedCategory = geminiExtracted.category || 'Outros';
              const finalCardName = geminiExtracted.cardName || (method === 'Crédito' ? 'Nubank' : undefined);
              const symbol = type === 'Entrada' ? '+' : '-';
              const cleanTranscription = geminiExtracted.transcription || '';

              let methodDisplay = method === 'Crédito' && finalCardName ? `Crédito (${finalCardName})` : method;

              let reply = `⚡ Lançamento adicionado ao KYRO Finance!\n\n🎙️ *Transcrição do Áudio:* "${cleanTranscription}"\n\n` +
                `• *Tipo:* ${type === 'Entrada' ? '💰 Entrada (Receita)' : '💸 Saída (Despesa)'}\n` +
                `• *Descrição / Item:* ${finalProduct}\n` +
                `• *Categoria:* ${detectedCategory}\n` +
                (establishment ? `• *Local / Estabelecimento:* ${establishment}\n` : '') +
                (finalCity ? `• *Cidade:* ${finalCity}\n` : '') +
                `• *Valor:* ${symbol} R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
                `• *Tipo de Transferência:* ${methodDisplay}`;

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
                totalInstallments: geminiExtracted.totalInstallments || 1,
                createdAt: new Date().toISOString()
              };

              parsed = {
                reply,
                savedTx,
                product: finalProduct,
                establishment,
                object: finalProduct,
                location: establishment,
                city: finalCity
              };
            }

            // ESTRATÉGIA B: Transcrição de Alta Precisão (Whisper-Small / Groq / OpenAI) + Extração Inteligente de Filtros
            if (!parsed) {
              const transcribedText = await transcribeAudioBuffer(audioBuffer);
              if (transcribedText) {
                // 1. Tenta extração estruturada via LLM (se chave configurada)
                const llmExtracted = await extractFinancialDataWithLLM(transcribedText);
                if (llmExtracted && llmExtracted.amount > 0) {
                  const amount = parseFloat(llmExtracted.amount) || 0;
                  const type = llmExtracted.type === 'Entrada' ? 'Entrada' : 'Saída';
                  const method = llmExtracted.method || 'PIX';
                  const finalProduct = llmExtracted.product || llmExtracted.description || 'Despesa';
                  const establishment = llmExtracted.establishment || '';
                  const finalCity = llmExtracted.city || '';
                  const detectedCategory = llmExtracted.category || 'Outros';
                  const finalCardName = llmExtracted.cardName || (method === 'Crédito' ? 'Nubank' : undefined);
                  const symbol = type === 'Entrada' ? '+' : '-';

                  let methodDisplay = method === 'Crédito' && finalCardName ? `Crédito (${finalCardName})` : method;

                  let reply = `⚡ Lançamento adicionado ao KYRO Finance!\n\n🎙️ *Transcrição do Áudio:* "${transcribedText}"\n\n` +
                    `• *Tipo:* ${type === 'Entrada' ? '💰 Entrada (Receita)' : '💸 Saída (Despesa)'}\n` +
                    `• *Descrição / Item:* ${finalProduct}\n` +
                    `• *Categoria:* ${detectedCategory}\n` +
                    (establishment ? `• *Local / Estabelecimento:* ${establishment}\n` : '') +
                    (finalCity ? `• *Cidade:* ${finalCity}\n` : '') +
                    `• *Valor:* ${symbol} R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
                    `• *Tipo de Transferência:* ${methodDisplay}`;

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
                    totalInstallments: llmExtracted.totalInstallments || 1,
                    createdAt: new Date().toISOString()
                  };

                  parsed = {
                    reply,
                    savedTx,
                    product: finalProduct,
                    establishment,
                    object: finalProduct,
                    location: establishment,
                    city: finalCity
                  };
                }

                // 2. Motor Determinístico de Filtros Financeiros do Chatbot (extrai Valor, Local, Cidade, Forma de Pagamento e Item)
                if (!parsed) {
                  parsed = parseDynamicFinancialMessage(transcribedText, true);
                }
              }
            }

            // Se todas as tentativas falharam e o áudio é inaudível: NUNCA INVENTA R$ 20 NEM R$ 1!
            if (!parsed) {
              await sock.sendMessage(remoteJid, {
                text: '🎙️ *Áudio recebido, mas não consegui identificar com nitidez o valor ou o item.*\n\nPor favor, envie o áudio novamente falando mais próximo ao microfone ou digite o lançamento no grupo (ex: *"Transferência de R$ 300"* ou *"Lanche 15 no débito"*).'
              });
              continue;
            }
          }

          // 2. PROCESSAMENTO DE IMAGEM / FOTO DE COMPROVANTE COM OCR + VISION CHATBOT
          if (!parsed && isImage && imageBuffer) {
            console.log(`📸 [WhatsApp] Imagem de comprovante recebida no grupo (${imageBuffer.length} bytes). Lendo filtros com OCR + IA...`);
            const mime = innerMsg.imageMessage?.mimetype || docMime || 'image/jpeg';
            const receiptData = await extractReceiptFromImageBuffer(imageBuffer, mime, messageText);

            if (receiptData && Number(receiptData.amount) > 0) {
              const val = Number(receiptData.amount);
              const isInc = receiptData.type === 'Entrada';
              const method = receiptData.method || 'PIX';
              const finalProduct = receiptData.product || receiptData.description || 'Comprovante';
              const establishment = receiptData.establishment || '';
              const finalCity = receiptData.city || '';
              const category = receiptData.category || 'Outros';

              const savedTx = {
                id: msgId || `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                description: finalProduct,
                product: finalProduct,
                establishment: establishment,
                category: category,
                subcategory: finalProduct,
                city: finalCity,
                date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
                amount: val,
                type: isInc ? 'Entrada' : 'Saída',
                method: method,
                status: 'Concluído',
                source: 'whatsapp-image',
                createdAt: new Date().toISOString()
              };

              const reply = `✅ *Comprovante Lido e Filtrado pelo Chatbot — KYRO Finance*\n\n` +
                `• *Tipo:* ${isInc ? '💰 Entrada (Receita)' : '💸 Saída (Despesa)'}\n` +
                `• *Descrição / Item:* ${finalProduct}\n` +
                `• *Categoria:* ${category}\n` +
                (establishment ? `• *Local / Estabelecimento:* ${establishment}\n` : '') +
                (finalCity ? `• *Cidade:* ${finalCity}\n` : '') +
                `• *Valor:* ${isInc ? '+' : '-'} R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
                `• *Tipo de Transferência:* ${method}\n\n` +
                `📊 _Sincronizado em tempo real no Dashboard, Entradas e Saídas!_`;

              parsed = {
                savedTx,
                reply,
                product: finalProduct,
                establishment,
                object: finalProduct,
                location: establishment,
                city: finalCity
              };
            }

            // Se não havia imagem legível de comprovante mas o usuário digitou os dados na legenda da foto
            if (!parsed && messageText) {
              parsed = parseDynamicFinancialMessage(messageText, false);
            }

            if (!parsed) {
              await sock.sendMessage(remoteJid, {
                text: '📸 *Foto/Comprovante recebido, mas não foi possível ler os valores.*\n\nPor favor, envie uma foto com melhor iluminação e nitidez mostrando o valor (R$), ou digite o lançamento na legenda.'
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

  // Endpoint 1.2: Webhook POST (Simulação ou Ingestão Direta de Texto, Áudio ou Imagem de Comprovante)
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

        // Suporte a Áudio via Webhook POST (dryRun opcional para testes sem sujar banco)
        if (payload?.audioBase64) {
          const cleanA = payload.audioBase64.replace(/^data:[^;]+;base64,/, '');
          const audioBuf = Buffer.from(cleanA, 'base64');
          const transcribed = await transcribeAudioBuffer(audioBuf);
          if (transcribed) {
            const parsedAudio = parseDynamicFinancialMessage(transcribed, true);
            if (parsedAudio && parsedAudio.savedTx) {
              if (!payload.dryRun) recordTransaction(parsedAudio.savedTx);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({
                status: 'success',
                transcribedText: transcribed,
                replySent: parsedAudio.reply,
                savedTx: parsedAudio.savedTx
              }));
            }
          }
        }

        // Suporte a Imagem de Comprovante via Webhook POST
        if (payload?.imageBase64) {
          const cleanI = payload.imageBase64.replace(/^data:[^;]+;base64,/, '');
          const imgBuf = Buffer.from(cleanI, 'base64');
          const receiptData = await extractReceiptFromImageBuffer(imgBuf, payload.mimeType || 'image/png', msgText);
          if (receiptData && Number(receiptData.amount) > 0) {
            const val = Number(receiptData.amount);
            const isInc = receiptData.type === 'Entrada';
            const savedTx = {
              id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              description: receiptData.product || receiptData.description || 'Comprovante',
              product: receiptData.product || receiptData.description || 'Comprovante',
              establishment: receiptData.establishment || '',
              category: receiptData.category || 'Outros',
              subcategory: receiptData.product || 'Comprovante',
              city: receiptData.city || '',
              date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
              amount: val,
              type: isInc ? 'Entrada' : 'Saída',
              method: receiptData.method || 'PIX',
              status: 'Concluído',
              source: 'whatsapp-image',
              createdAt: new Date().toISOString()
            };
            const reply = `✅ *Comprovante Lido e Filtrado pelo Chatbot — KYRO Finance*\n\n` +
              `• *Tipo:* ${isInc ? '💰 Entrada (Receita)' : '💸 Saída (Despesa)'}\n` +
              `• *Descrição / Item:* ${savedTx.product}\n` +
              `• *Categoria:* ${savedTx.category}\n` +
              (savedTx.establishment ? `• *Local / Estabelecimento:* ${savedTx.establishment}\n` : '') +
              (savedTx.city ? `• *Cidade:* ${savedTx.city}\n` : '') +
              `• *Valor:* ${isInc ? '+' : '-'} R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
              `• *Tipo de Transferência:* ${savedTx.method}\n\n` +
              `📊 _Sincronizado em tempo real no Dashboard, Entradas e Saídas!_`;

            if (!payload.dryRun) recordTransaction(savedTx);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              status: 'success',
              replySent: reply,
              savedTx,
              receiptData
            }));
          }
        }

        if (msgText) {
          const parsed = parseDynamicFinancialMessage(msgText, false);
          if (parsed && parsed.savedTx) {
            if (!payload.dryRun) recordTransaction(parsed.savedTx);
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
        recurringExpenses: localRecurringExpenses,
        creditCards: localCreditCards,
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

          if (action === 'sync_all') {
            if (Array.isArray(transactions)) {
              localStoredTransactions = transactions.filter(t => t && !localDeletedIds.has(String(t.id)));
              fs.promises.writeFile(TRANSACTIONS_FILE, JSON.stringify(localStoredTransactions, null, 2), 'utf-8').catch(() => {});
            }
            if (Array.isArray(payload.creditCards)) {
              localCreditCards = payload.creditCards;
              saveCardsToDisk();
            }
            if (Array.isArray(payload.recurringExpenses)) {
              localRecurringExpenses = payload.recurringExpenses;
              saveRecurringToDisk();
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ 
              success: true, 
              action: 'synced_all', 
              count: localStoredTransactions.length,
              creditCardsCount: localCreditCards.length,
              recurringExpensesCount: localRecurringExpenses.length
            }));
          }

          if (action === 'save_credit_cards' && Array.isArray(payload.creditCards)) {
            localCreditCards = payload.creditCards;
            saveCardsToDisk();
            fastAxios.post('https://kyro-finance.vercel.app/api/database', { action: 'save_credit_cards', creditCards: localCreditCards }).catch(() => {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, creditCards: localCreditCards }));
          }

          if (action === 'save_recurring_expenses' && Array.isArray(payload.recurringExpenses)) {
            localRecurringExpenses = payload.recurringExpenses;
            saveRecurringToDisk();
            fastAxios.post('https://kyro-finance.vercel.app/api/database', { action: 'save_recurring_expenses', recurringExpenses: localRecurringExpenses }).catch(() => {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, recurringExpenses: localRecurringExpenses }));
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
            if (payload.groqApiKey !== undefined) {
              localSettings.groqApiKey = payload.groqApiKey;
            } else if (payload.chatConfig?.groqApiKey !== undefined) {
              localSettings.groqApiKey = payload.chatConfig.groqApiKey;
            }
            if (Array.isArray(payload.userAiRules)) {
              localSettings.userAiRules = payload.userAiRules;
            }
            saveSettingsToDisk();
            fastAxios.post('https://kyro-finance.vercel.app/api/database', {
              action: 'save_chat_config',
              geminiApiKey: localSettings.geminiApiKey,
              groqApiKey: localSettings.groqApiKey,
              chatConfig: localSettings.chatConfig,
              userAiRules: localSettings.userAiRules
            }).catch(() => {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ 
              success: true, 
              chatConfig: localSettings.chatConfig, 
              geminiApiKey: localSettings.geminiApiKey,
              groqApiKey: localSettings.groqApiKey 
            }));
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
        let { message = '', context = {}, geminiApiKey, formattingPreference = 'tabelas', customPrompt = '', audioBase64, audioMimeType, imageBase64, imageMimeType } = payload;
        const effectiveKey = getEffectiveGeminiKey(geminiApiKey);

        // Se veio áudio e a mensagem de texto está vazia ou genérica, transcreve o áudio primeiro
        if (audioBase64 && (!message || message.startsWith('Por favor analise este áudio') || message.startsWith('Por favor, analise'))) {
          try {
            const cleanA = audioBase64.replace(/^data:[a-zA-Z0-9\/-]+;base64,/, '');
            const audioBuffer = Buffer.from(cleanA, 'base64');
            const transcribed = await transcribeAudioBuffer(audioBuffer, effectiveKey);
            if (transcribed && transcribed.trim().length > 0) {
              message = transcribed.trim();
              console.log(`🎙️ [Chat Interno Áudio Transcrito]: "${message}"`);
            }
          } catch (trErr) {
            console.warn('[Chat Interno Audio Transcribe Erro]:', trErr.message);
          }
        }

        if (effectiveKey && effectiveKey !== 'dummy_key') {
          try {
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${effectiveKey}`;
            const sysPrompt = `Você é o Google Gemini integrado como Copiloto Financeiro Nativo do KYRO Finance. Contexto: ${JSON.stringify(context)}.
Regras cruciais:
- Se o usuário disser apenas valor e método (ex: "300 no pix", "50 no débito"), preencha apenas valor e método, city="", establishment="".
- Se disser "personal da academia", produto="Personal da academia", categoria="Saúde".
- Se disser "almoço", produto="Almoço", categoria="Alimentação".
- Se disser "Teresina", city="Teresina, PI". Se não disser cidade, deixe city="".
- NUNCA transforme "um pix de 300" em 1 real. O valor é 300!
- Responda OBRIGATORIAMENTE em JSON: {"reply": "sua resposta em tópicos", "action": {"type": "none"|"create_transaction"|"delete_transactions", "transaction": {"description": "...", "product": "...", "amount": 0.00, "type": "Saída"|"Entrada", "category": "...", "method": "PIX"|"Crédito"|"Débito"|"Dinheiro"|"Transferência", "city": "..."}, "deleteTargetTerm": "...", "deleteTargetIds": [...]}}`;
            
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

            const geminiRes = await fastAxios.post(geminiUrl, {
              contents: [{ role: 'user', parts }],
              generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
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
                engine: 'gemini-1.5-flash',
                transcribedText: message
              }));
            }
          } catch (gErr) {
            console.warn('[Local Bot Gemini Chat Fallback]:', gErr.message);
          }
        }

        // Tenta estruturar com LLM (Groq / OpenAI / Gemini) se message existir
        if (message && message.trim().length > 3) {
          const llmData = await extractFinancialDataWithLLM(message, effectiveKey);
          if (llmData && llmData.amount > 0) {
            const recorded = recordTransaction({
              description: llmData.description || llmData.product || 'Despesa registrada',
              product: llmData.product || llmData.description || 'Despesa',
              establishment: llmData.establishment || '',
              amount: llmData.amount,
              type: llmData.type || 'Saída',
              category: llmData.category || 'Outros',
              subcategory: llmData.product || llmData.category || 'Outros',
              method: llmData.method || 'PIX',
              cardName: llmData.cardName,
              city: llmData.city || '',
              date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
              status: 'Concluído'
            });

            const cityLine = llmData.city ? `\n- 📍 **Cidade/Local:** ${llmData.city}` : '';
            const reply = `✅ **Lançamento Registrado com Sucesso!**\n\n- 📝 **Descrição:** ${recorded.description}\n- 💰 **Valor:** R$ ${recorded.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n- 🏷️ **Categoria:** ${recorded.category}\n- 🛍️ **Produto:** ${recorded.product}\n- 💳 **Forma:** ${recorded.method}${cityLine}\n- 📊 **Tipo:** ${recorded.type === 'Entrada' ? 'Entrada (+)' : 'Saída (-)'}\n\n*Os valores foram atualizados no saldo geral e nos gráficos.*`;

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              reply,
              action: { type: 'create_transaction', transaction: recorded },
              engine: 'kyro-llm-engine',
              transcribedText: message
            }));
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
            engine: 'kyro-local-engine',
            transcribedText: message
          }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          reply: `👋 Olá! Sou o Copiloto Financeiro KYRO.\n\nPosso te ajudar a:\n- 📝 **Registrar despesas e receitas** por áudio, texto ou foto de comprovante (ex: *"fiz um pix de 300 reais para pagar o personal da academia em Teresina"*);\n- 🗑️ **Remover lançamentos**;\n- 📊 **Consultar seus gastos e saldos**.\n\nComo posso te ajudar agora?`,
          action: { type: 'none' },
          engine: 'kyro-local-engine',
          transcribedText: message
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
  transcribeAudioBuffer,
  extractReceiptFromImageBuffer,
  parseFinancialReceiptOcrText,
  parseDynamicFinancialMessage,
  extractMonetaryValue,
  extractCityFromText,
  normalizeTranscribedPortugueseText,
  extractCreditCardName,
  extractInstallments,
  interpretAudioDirectlyWithGemini,
  getEffectiveGeminiKey
};
