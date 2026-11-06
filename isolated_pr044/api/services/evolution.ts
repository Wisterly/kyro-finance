import axios from 'axios';

const EVOLUTION_SERVER_URL = process.env.EVOLUTION_SERVER_URL || '';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || '';

const evolutionApi = axios.create({
  baseURL: EVOLUTION_SERVER_URL,
  headers: {
    apikey: EVOLUTION_API_KEY,
    'Content-Type': 'application/json'
  }
});

interface SendMessageParams {
  phoneNumber: string;
  message: string;
  serverUrl?: string;
  apiKey?: string;
  instance?: string;
}

export const sendWhatsAppMessage = async ({ 
  phoneNumber, 
  message,
  serverUrl,
  apiKey,
  instance 
}: SendMessageParams) => {
  const activeUrl = serverUrl || EVOLUTION_SERVER_URL;
  const activeKey = apiKey || EVOLUTION_API_KEY;
  const activeInstance = instance || EVOLUTION_INSTANCE;

  if (!activeUrl || !activeKey || !activeInstance) {
    console.warn('[Evolution API] Credenciais da Evolution API ausentes (configure nas variáveis de ambiente da Vercel ou na aba do painel).');
    return null;
  }

  // Remove caracteres não numéricos do telefone
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
};
