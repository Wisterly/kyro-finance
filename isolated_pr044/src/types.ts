export type PaymentMethod = 'PIX' | 'Débito' | 'Crédito' | 'Dinheiro' | 'Transferência';

export type TransactionType = 'Entrada' | 'Saída';

export interface CreditCardData {
  id: string;
  name: string; // ex: "Nubank", "Inter", "Itaú", "Santander", "C6 Bank", "Bradesco"
  closingDay: number; // Dia do fechamento da fatura (ex: dia 15)
  dueDay: number; // Dia de vencimento da fatura (ex: dia 22)
  limit?: number; // Limite total de crédito (ex: 5000)
  color?: string; // Cor visual do cartão (ex: 'purple', 'orange', 'blue', 'red', 'emerald', 'black')
  lastDigits?: string; // Últimos 4 dígitos opcionais (ex: '4821')
}

export type CreditCard = CreditCardData;

export interface RecurringExpense {
  id: string;
  title: string;
  category: string; // Empréstimo, Pessoal, Passagem Aérea, Mensalidade, etc.
  totalAmount: number; // Valor total da despesa
  installmentAmount: number; // Valor de cada parcela mensal
  currentInstallment: number; // Parcela atual (ex: 2)
  totalInstallments: number; // Total de parcelas (ex: 10 ou 0 para infinito/mensalidade contínua)
  city: string;
  method: PaymentMethod;
  cardName?: string; // Nome do cartão vinculado se for crédito (ex: "Nubank", "Inter")
  active: boolean;
  dueDateDay: number; // Dia de vencimento no mês (ex: dia 10)
  dueDateText?: string; // ex: "20 de Dezembro" ou "Dia 20"
  dueMonth?: number; // Mês do vencimento (1 a 12)
  paid?: boolean; // Se foi confirmada como PAGA pelo usuário
  paidAt?: string; // Timestamp em que foi marcada como paga
  transactionId?: string; // ID da transação gerada ao marcar como paga
}

export interface Transaction {
  id: string;
  product?: string; // Produto adquirido (ex: "Barra de chocolate", "Câmera de vigilância", "Água", "Combustível")
  establishment?: string; // Estabelecimento (ex: "Farmácia", "Internet / Mercado Livre", "Supermercado", "Restaurante", "Posto")
  description: string; // Descrição / Estabelecimento (mantém compatibilidade total)
  category: string; // Categoria inteligente (ex: "Lanche", "Compras na Internet", "Alimentação", "Supermercado", "Transporte")
  subcategory?: string;
  city: string; // Local / Cidade (ex: "Oeiras, PI", "Teresina, PI", "Internet" ou "Sem informação")
  amount: number;
  type: TransactionType;
  method: PaymentMethod;
  cardName?: string; // Cartão de crédito utilizado (ex: "Nubank", "Inter")
  date: string;
  time?: string;
  status: 'Concluído' | 'Pendente';
  recurringId?: string; // Se veio de um parcelamento ou saída recorrente
  currentInstallment?: number;
  totalInstallments?: number;
  receiptUrl?: string;
  createdAt?: string;
  whatsappMsgId?: string;
}

export interface BudgetGoal {
  id: string;
  category: string;
  limit: number;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ia';
  text: string;
  timestamp: string;
  audioUrl?: string;
  imageUrl?: string;
  actionableTransactions?: Transaction[]; // Lançamentos encontrados para seleção e remoção interativa no chat
  actionCompleted?: boolean; // Se a ação de exclusão já foi executada para esta mensagem
  engine?: string; // Motor de IA utilizado (ex: 'gemini-1.5-flash', 'kyro-local-engine')
}

export interface UserProfile {
  name: string;
  email?: string;
  avatarUrl?: string;
}
