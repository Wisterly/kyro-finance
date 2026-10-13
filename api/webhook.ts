import type { VercelRequest, VercelResponse } from '@vercel/node';
import { processFinanceAssistant } from './services/financeAssistant';
import { sendWhatsAppMessage } from './services/evolution';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Configuração de CORS para permitir testes direto do painel KYRO
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verificação de método GET para teste de sanidade
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

    // A Evolution API envia eventos como 'messages.upsert' ou 'MESSAGES_UPSERT'
    const event = payload?.event;
    const data = payload?.data || payload;

    // Ignora mensagens enviadas pelo próprio bot para evitar looping
    if (data?.key?.fromMe === true) {
      return res.status(200).json({ status: 'Ignored fromMe message' });
    }

    // Extrai o número do remetente (suporta remoteJid da Evolution API ou campo de teste direto)
    const remoteJid = data?.key?.remoteJid || payload?.sender || payload?.number || '558699999999';
    const phoneNumber = String(remoteJid).replace('@s.whatsapp.net', '');

    // Extrai o texto da mensagem ou detecta áudio
    let messageText = 
      data?.message?.conversation ||
      data?.message?.extendedTextMessage?.text ||
      payload?.message?.conversation ||
      payload?.message?.extendedTextMessage?.text ||
      (typeof payload?.message === 'string' ? payload.message : '') ||
      payload?.text ||
      '';

    // Suporte a mensagens de áudio da Evolution API
    if (!messageText && (data?.message?.audioMessage || payload?.message?.audioMessage)) {
      messageText = '[Áudio de voz recebido via WhatsApp]';
    }

    if (!messageText || typeof messageText !== 'string' || !messageText.trim()) {
      return res.status(200).json({ status: 'No text message to process' });
    }

    console.log(`[Webhook Evolution] Mensagem recebida de ${phoneNumber}: "${messageText}"`);

    // Processa a mensagem pelo agente inteligente de finanças (OpenAI GPT-4o-mini + Function Calling + Firestore)
    const result = await processFinanceAssistant(messageText);

    // Opcional: credenciais passadas no header ou body pelo teste da UI
    const customServerUrl = (req.headers['x-evolution-url'] as string) || payload?.evolutionServerUrl;
    const customApiKey = (req.headers['x-evolution-key'] as string) || payload?.evolutionApiKey;
    const customInstance = (req.headers['x-evolution-instance'] as string) || payload?.evolutionInstance;

    // Envia a resposta de volta ao WhatsApp do usuário via Evolution API
    if (phoneNumber && phoneNumber !== 'test') {
      await sendWhatsAppMessage({
        phoneNumber,
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
      eventProcessed: event || 'direct_message'
    });

  } catch (error: any) {
    console.error('[Webhook Evolution] Erro ao processar webhook:', error);
    // Sempre retorna 200 para a Evolution API não ficar repetindo retentativas infinitas em caso de erro
    return res.status(200).json({
      status: 'error_handled',
      message: error?.message
    });
  }
}
