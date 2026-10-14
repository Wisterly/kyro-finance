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
