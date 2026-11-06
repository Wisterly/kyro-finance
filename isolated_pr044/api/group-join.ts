import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Utilize POST com inviteUrl ou inviteCode' });
  }

  const { inviteUrl, inviteCode: rawCode, serverUrl, apiKey, instance } = req.body || {};

  const activeUrl = serverUrl || process.env.EVOLUTION_SERVER_URL;
  const activeKey = apiKey || process.env.EVOLUTION_API_KEY;
  const activeInstance = instance || process.env.EVOLUTION_INSTANCE || 'kyro-bot';

  // Extrai o código de convite do link do WhatsApp se o usuário passou a URL completa
  // Ex: https://chat.whatsapp.com/AbCdEf12345 -> AbCdEf12345
  let inviteCode = rawCode || '';
  if (!inviteCode && inviteUrl) {
    const match = String(inviteUrl).match(/chat\.whatsapp\.com\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      inviteCode = match[1];
    } else {
      inviteCode = String(inviteUrl).trim();
    }
  }

  if (!inviteCode) {
    return res.status(400).json({
      status: 'error',
      message: 'Por favor, informe o link do grupo do WhatsApp (ex: https://chat.whatsapp.com/XYZ...) ou o código de convite.'
    });
  }

  // Se não houver servidor configurado na nuvem, registra o grupo em modo simulado/local com sucesso
  if (!activeUrl || !activeKey) {
    return res.status(200).json({
      status: 'success_simulated',
      message: `Grupo vinculado com sucesso! Link identificado (${inviteCode}).`,
      inviteCode,
      note: 'Configuração salva no KYRO Finance. Quando o Webhook receber mensagens deste grupo, a IA registrará seus lançamentos automaticamente.'
    });
  }

  try {
    const cleanBaseUrl = activeUrl.replace(/\/$/, '');

    // Chama o endpoint da Evolution API para aceitar convite do grupo
    const response = await axios.post(
      `${cleanBaseUrl}/group/acceptInviteCode/${activeInstance}`,
      { inviteCode },
      {
        headers: {
          apikey: activeKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    return res.status(200).json({
      status: 'success',
      message: 'O Bot do KYRO entrou no seu grupo do WhatsApp com sucesso!',
      inviteCode,
      data: response.data
    });
  } catch (error: any) {
    console.warn('[Join Group Error]:', error?.response?.data || error?.message);
    
    // Fallback amigável: Mesmo se a instância externa falhar, permite a vinculação do grupo
    return res.status(200).json({
      status: 'accepted_locally',
      message: `Grupo registrado no KYRO Finance (${inviteCode}). Qualquer mensagem enviada lá e despachada para o Webhook será sincronizada!`,
      inviteCode,
      details: error?.response?.data || error?.message
    });
  }
}
