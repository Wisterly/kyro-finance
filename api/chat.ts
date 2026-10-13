import type { VercelRequest, VercelResponse } from '@vercel/node';
import openai from './config/openai';
import { financeSystemPrompt } from './prompts/finance.prompt';
import { saveTransactionToDb, NewTransactionInput } from './services/financeDb';

const financeTools: any[] = [
  {
    type: 'function',
    function: {
      name: 'registrar_transacao',
      description: 'Registra uma nova movimentação financeira (despesa ou receita) no sistema Kyro Finance.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Descrição da despesa ou receita (ex: Padaria Central, Salário)' },
          amount: { type: 'number', description: 'Valor em reais (ex: 45.50)' },
          type: { type: 'string', enum: ['Entrada', 'Saída'], description: 'Se é Entrada ou Saída' },
          category: { type: 'string', description: 'Categoria (Alimentação, Moradia, Transporte, Vestuário, Viagem, Salário, etc.)' },
          subcategory: { type: 'string', description: 'Subcategoria detalhada opcional' },
          method: { type: 'string', enum: ['PIX', 'Débito', 'Crédito', 'Dinheiro', 'Transferência'], description: 'Forma de pagamento' },
          city: { type: 'string', description: 'Cidade onde foi realizada a compra (ex: Teresina, PI, Caxias, MA)' },
          currentInstallment: { type: 'number', description: 'Parcela atual caso seja parcelado' },
          totalInstallments: { type: 'number', description: 'Total de parcelas caso seja parcelado' }
        },
        required: ['description', 'amount', 'type', 'category', 'method', 'city']
      }
    }
  }
];

export async function processFinanceAssistant(userMessage: string, history: any[] = []) {
  const messages: any[] = [
    { role: 'system', content: financeSystemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ];

  const firstResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    tools: financeTools,
    tool_choice: 'auto'
  });

  const responseMessage = firstResponse.choices[0]?.message;
  let savedTx = null;

  if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
    for (const toolCall of responseMessage.tool_calls) {
      if (toolCall.function.name === 'registrar_transacao') {
        const args: NewTransactionInput = JSON.parse(toolCall.function.arguments);
        savedTx = await saveTransactionToDb(args);

        // Retornar resultado da execução da ferramenta para o modelo gerar a confirmação
        messages.push(responseMessage);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ status: 'success', data: savedTx })
        });
      }
    }

    const secondResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages
    });

    return {
      reply: secondResponse.choices[0]?.message?.content || 'Transação registrada com sucesso!',
      savedTx
    };
  }

  return {
    reply: responseMessage?.content || 'Como posso te ajudar com as finanças hoje?',
    savedTx: null
  };
}

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
