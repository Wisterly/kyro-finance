import type { VercelRequest, VercelResponse } from '@vercel/node';
import { processFinanceAssistant } from './services/financeAssistant';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Configuração de CORS para requisições do site
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Utilize POST.' });
  }

  const { message, history } = req.body || {};

  if (!message) {
    return res.status(400).json({ error: 'O parâmetro "message" é obrigatório.' });
  }

  try {
    const result = await processFinanceAssistant(message, history || []);
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Erro no processamento da API de chat:', error);
    return res.status(500).json({
      error: 'Falha ao processar mensagem.',
      details: error?.message
    });
  }
}
