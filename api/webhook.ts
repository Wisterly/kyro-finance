import type { VercelRequest, VercelResponse } from '@vercel/node';
import { processFinanceAssistant } from './chat';
import { sendWhatsAppMessage } from './services/evolution';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verificação de método
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'Webhook endpoint pronto para receber eventos POST da Evolution API.' });
  }

  try {
    const payload = req.body;

    // A Evolution API envia eventos como 'messages.upsert'
    // Exemplo de estrutura padrão da Evolution API v1/v2:
    // data.key.remoteJid (ex: "553199999999@s.whatsapp.net")
    // data.message.conversation ou data.message.extendedTextMessage.text
    // data.key.fromMe (true se for enviada por nós)

    const event = payload?.event;
    const data = payload?.data;

    // Ignora mensagens enviadas pelo próprio bot para evitar looping
    if (data?.key?.fromMe) {
      return res.status(200).json({ status: 'Ignored fromMe message' });
    }

    // Extrai o número do remetente
    const remoteJid = data?.key?.remoteJid || payload?.sender || '';
    const phoneNumber = remoteJid.replace('@s.whatsapp.net', '');

    if (!phoneNumber) {
      return res.status(200).json({ status: 'No phone number identified' });
    }

    // Extrai o texto da mensagem
    const messageText = 
      data?.message?.conversation ||
      data?.message?.extendedTextMessage?.text ||
      payload?.message ||
      '';

    if (!messageText || typeof messageText !== 'string' || !messageText.trim()) {
      return res.status(200).json({ status: 'No text message to process' });
    }

    console.log(`[Webhook Evolution] Mensagem recebida de ${phoneNumber}: "${messageText}"`);

    // Processa a mensagem pelo agente inteligente de finanças (com OpenAI + Function Calling + Firestore)
    const result = await processFinanceAssistant(messageText);

    // Envia a resposta de volta ao WhatsApp do usuário via Evolution API
    await sendWhatsAppMessage({
      phoneNumber,
      message: result.reply
    });

    return res.status(200).json({
      status: 'success',
      replySent: result.reply,
      savedTx: result.savedTx
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
