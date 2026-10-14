export type PaymentMethod = 'PIX' | 'Débito' | 'Crédito' | 'Dinheiro' | 'Transferência';

export type TransactionType = 'Entrada' | 'Saída';

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
  description: string;
  category: string;
  subcategory?: string;
  city: string;
  amount: number;
  type: TransactionType;
  method: PaymentMethod;
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
}

export interface UserProfile {
  name: string;
  email?: string;
  avatarUrl?: string;
}
