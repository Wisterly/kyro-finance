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
}

export const sendWhatsAppMessage = async ({ phoneNumber, message }: SendMessageParams) => {
  if (!EVOLUTION_SERVER_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE) {
    console.warn('[Evolution API] Variáveis de ambiente da Evolution não configuradas.');
    return null;
  }

  // Remove caracteres não numéricos do telefone
  const cleanNumber = phoneNumber.replace(/\D/g, '');

  try {
    const response = await evolutionApi.post(`/message/sendText/${EVOLUTION_INSTANCE}`, {
      number: cleanNumber,
      text: message,
      linkPreview: true
    });
    return response.data;
  } catch (error: any) {
    console.error('[Evolution API] Erro ao enviar mensagem:', error?.response?.data || error?.message);
    throw error;
  }
};
