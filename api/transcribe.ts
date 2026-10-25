import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI, { toFile } from 'openai';
import axios from 'axios';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy_key'
});

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
      service: 'KYRO AI Speech-to-Text Multi-Engine (OpenAI Whisper + Google Gemini Multimodal)',
      endpoint: '/api/transcribe' 
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Utilize POST.' });
  }

  try {
    const { audioBase64, mimeType = 'audio/webm' } = req.body || {};

    if (!audioBase64) {
      return res.status(400).json({ error: 'O parâmetro "audioBase64" é obrigatório.' });
    }

    const cleanBase64 = audioBase64.replace(/^data:[a-zA-Z0-9\/]+;base64,/, '');
    const audioBuffer = Buffer.from(cleanBase64, 'base64');

    if (audioBuffer.length < 100) {
      return res.status(400).json({ error: 'Áudio vazio ou corrompido.' });
    }

    let transcribedText = '';

    let cleanMime = 'audio/webm';
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) cleanMime = 'audio/mp4';
    else if (mimeType.includes('aac')) cleanMime = 'audio/aac';
    else if (mimeType.includes('ogg') || mimeType.includes('opus')) cleanMime = 'audio/ogg';
    else if (mimeType.includes('wav')) cleanMime = 'audio/wav';
    else if (mimeType.includes('mp3') || mimeType.includes('mpeg')) cleanMime = 'audio/mp3';

    // ESTRATÉGIA 1: GOOGLE GEMINI MULTIMODAL AUDIO (Se chave do Gemini estiver configurada)
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (geminiKey && geminiKey !== 'dummy_key') {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
        const response = await axios.post(geminiUrl, {
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: cleanMime,
                  data: cleanBase64
                }
              },
              {
                text: 'Transcreva com máxima precisão as palavras ditadas neste áudio em português brasileiro sobre finanças, pagamentos, contas ou comandos de ajuste. Retorne EXCLUSIVAMENTE a frase transcrita, sem aspas, sem pontuações artificiais e sem comentários.'
              }
            ]
          }]
        }, { timeout: 12000 });

        const candidateText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText && candidateText.trim().length > 0) {
          transcribedText = candidateText.trim();
        }
      } catch (geminiErr: any) {
        console.warn('[Gemini Audio Transcribe Erro]:', geminiErr?.message || geminiErr);
      }
    }

    // ESTRATÉGIA 2: OPENAI WHISPER-1 (Se Whisper estiver configurado e Gemini não transcrito)
    if (!transcribedText && process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy_key') {
      try {
        const ext = cleanMime.includes('mp4') || cleanMime.includes('m4a') ? 'm4a'
          : cleanMime.includes('aac') ? 'aac'
          : cleanMime.includes('ogg') ? 'ogg'
          : cleanMime.includes('wav') ? 'wav'
          : 'webm';
        const file = await toFile(audioBuffer, `user_voice.${ext}`, {
          type: cleanMime
        });

        const transcription = await openai.audio.transcriptions.create({
          file,
          model: 'whisper-1',
          language: 'pt',
          prompt: 'Controle financeiro pessoal: pagamentos, pix, combustível, carro, gasolina, padaria, compras, mercado, cartão nubank, valores em reais, despesas.'
        });

        if (transcription?.text && transcription.text.trim().length > 0) {
          transcribedText = transcription.text.trim();
        }
      } catch (whisperErr: any) {
        console.warn('[Whisper Transcribe Erro]:', whisperErr?.message || whisperErr);
      }
    }

    if (!transcribedText) {
      return res.status(200).json({
        success: false,
        text: '',
        message: 'Não foi possível transcrever o áudio pelos servidores de IA (verifique chaves de API OPENAI_API_KEY ou GEMINI_API_KEY).'
      });
    }

    return res.status(200).json({
      success: true,
      text: transcribedText,
      engine: geminiKey ? 'gemini-1.5-flash' : 'whisper-1'
    });

  } catch (error: any) {
    console.error('[API Transcribe Erro Fatal]:', error);
    return res.status(500).json({
      error: 'Falha interna ao processar áudio.',
      details: error?.message || String(error)
    });
  }
}
