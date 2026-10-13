export type PaymentMethod = 'PIX' | 'Débito' | 'Crédito' | 'Dinheiro' | 'Transferência';

export type TransactionType = 'Entrada' | 'Saída';

export interface Transaction {
  id: string;
  description: string;
  category: string;
  subcategory?: string;
  city: string;
  amount: number;
  type: TransactionType;
  method: PaymentMethod;
  date: string; // ISO ou DD/MM/AAAA
  time?: string;
  status: 'Concluído' | 'Pendente';
  receiptUrl?: string;
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
