import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const serverUrl = (req.query.serverUrl as string) || (req.headers['x-evolution-url'] as string) || process.env.EVOLUTION_SERVER_URL;
  const apiKey = (req.query.apiKey as string) || (req.headers['x-evolution-key'] as string) || process.env.EVOLUTION_API_KEY;
  const instance = (req.query.instance as string) || (req.headers['x-evolution-instance'] as string) || process.env.EVOLUTION_INSTANCE || 'kyro-bot';

  // Se não houver servidor configurado ainda, informa claramente com status orientativo
  if (!serverUrl || !apiKey) {
    return res.status(200).json({
      status: 'unconfigured',
      message: 'Servidor Evolution API não configurado. Informe a URL e API Key do seu servidor para gerar o QR Code oficial de pareamento ou crie sua instância gratuita.',
      instance,
      instructions: {
        step1: 'Insira a URL da sua Evolution API (ou use um servidor Baileys/Evolution na nuvem)',
        step2: 'Insira sua chave de API (API Key)',
        step3: 'O sistema gerará o QR Code oficial diretamente do servidor WhatsApp'
      }
    });
  }

  const cleanBaseUrl = serverUrl.replace(/\/$/, '');

  try {
    // 1. Tenta obter o QR code da instância existente
    try {
      const connectRes = await axios.get(`${cleanBaseUrl}/instance/connect/${instance}`, {
        headers: { apikey: apiKey },
        timeout: 8000
      });

      if (connectRes.data?.base64 || connectRes.data?.qrcode?.base64) {
        return res.status(200).json({
          status: 'qrcode_ready',
          base64: connectRes.data?.base64 || connectRes.data?.qrcode?.base64,
          pairingCode: connectRes.data?.pairingCode || connectRes.data?.code,
          instance,
          state: 'connecting'
        });
      }

      // Se já estiver conectado
      if (connectRes.data?.state === 'open' || connectRes.data?.instance?.state === 'open') {
        return res.status(200).json({
          status: 'connected',
          message: 'Instância já conectada e online no WhatsApp!',
          instance,
          state: 'open'
        });
      }
    } catch (connectErr: any) {
      console.log('[API instance-qr] Instância não conectada ainda, tentando criar:', connectErr?.message);
    }

    // 2. Tenta criar a instância se não existir e solicitar QR Code
    const createRes = await axios.post(
      `${cleanBaseUrl}/instance/create`,
      {
        instanceName: instance,
        token: apiKey,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS'
      },
      {
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        timeout: 10000
      }
    );

    const qrcodeBase64 = createRes.data?.qrcode?.base64 || createRes.data?.base64;
    return res.status(200).json({
      status: qrcodeBase64 ? 'qrcode_ready' : 'created',
      base64: qrcodeBase64,
      pairingCode: createRes.data?.qrcode?.code,
      instance,
      message: 'Instância do KYRO criada com sucesso na Evolution API!'
    });
  } catch (err: any) {
    const errorDetails = err?.response?.data || err?.message;
    console.error('[API instance-qr] Erro:', errorDetails);

    return res.status(200).json({
      status: 'error',
      message: 'Não foi possível conectar ao servidor Evolution informado. Verifique se a URL e a API Key estão ativas e acessíveis.',
      details: errorDetails
    });
  }
}
