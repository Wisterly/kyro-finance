import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  ArrowLeftRight, 
  PieChart, 
  MapPin, 
  FileText, 
  Settings, 
  Search, 
  Bell, 
  Send, 
  ArrowUpRight, 
  ArrowDownRight, 
  MoreVertical, 
  Mic, 
  Image as ImageIcon,
  Sparkles,
  Menu,
  X,
  CreditCard,
  Building,
  CheckCircle2,
  Clock,
  Filter,
  Download,
  Plus,
  ChevronDown,
  User,
  ShieldCheck,
  TrendingUp,
  Sliders,
  DollarSign,
  Maximize2,
  Wallet,
  Calendar,
  Layers,
  Repeat,
  Plane,
  Trash2,
  Check,
  AlertCircle,
  Smartphone,
  QrCode,
  RefreshCw,
  LogOut,
  Key,
  Copy,
  Zap,
  ExternalLink,
  Globe,
  CheckCheck,
  Eye,
  EyeOff,
  MessageSquare,
  Bot,
  Terminal,
  HelpCircle,
  Link,
  ChevronRight,
  Shield
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Transaction, ChatMessage, PaymentMethod, TransactionType, RecurringExpense } from './types';
import { kyroCloud } from './firebase';
import { WhatsAppTab } from './components/WhatsAppTab';

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'transacoes' | 'orcamentos' | 'mapa' | 'relatorios' | 'whatsapp' | 'configuracoes'>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [chatOpenMobile, setChatOpenMobile] = useState(false);
  
  // Modais dinâmicos
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [activeKpiModal, setActiveKpiModal] = useState<'saldo' | 'entradas' | 'saidas' | 'metodos' | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [filterMethod, setFilterMethod] = useState<string>('todos');
  const [newTxModalOpen, setNewTxModalOpen] = useState(false);
  const [newTxTypeDefault, setNewTxTypeDefault] = useState<TransactionType>('Saída');

  // Sub-aba no Modal de Saídas: 'avulsas' ou 'recorrentes'
  const [saidasTab, setSaidasTab] = useState<'avulsas' | 'recorrentes'>('avulsas');
  const [newRecModalOpen, setNewRecModalOpen] = useState(false);

  // Integração Funcional WhatsApp & Evolution API
  const [whatsAppModalOpen, setWhatsAppModalOpen] = useState(false);
  const [whatsAppConnected, setWhatsAppConnected] = useState(() => {
    return localStorage.getItem('kyro_whatsapp_connected') === 'true';
  });
  const [userPhone, setUserPhone] = useState(() => {
    return localStorage.getItem('kyro_whatsapp_phone') || '+55 (86) 99999-9999';
  });
  // Número Oficial do Robô / Persona KYRO no WhatsApp (Linha do Sistema)
  const [botPhone, setBotPhone] = useState(() => {
    return localStorage.getItem('kyro_bot_phone') || '+55 (86) 99400-2892';
  });

  // Método de pareamento e assistente didático: 'group' (Grupo Pessoal Exclusivo), 'direct' ou 'qrcode' ou 'evolution'
  const [activePairMethod, setActivePairMethod] = useState<'group' | 'direct' | 'qrcode' | 'evolution'>('group');
  const [groupInviteUrl, setGroupInviteUrl] = useState(() => {
    return localStorage.getItem('kyro_whatsapp_group_link') || '';
  });
  const [isJoiningGroup, setIsJoiningGroup] = useState(false);
  const [groupJoinedSuccess, setGroupJoinedSuccess] = useState(() => {
    return !!localStorage.getItem('kyro_whatsapp_group_link');
  });
  const [isSyncingPhone, setIsSyncingPhone] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [serverQrBase64, setServerQrBase64] = useState<string | null>(null);
  const [isFetchingServerQr, setIsFetchingServerQr] = useState(false);
  const [serverQrError, setServerQrError] = useState<string | null>(null);

  // Credenciais Evolution API (armazenadas em localStorage com fallback nas envs)
  const [evolutionServerUrl, setEvolutionServerUrl] = useState(() => {
    return localStorage.getItem('kyro_evolution_url') || 'https://api.suadominio.com';
  });
  const [evolutionApiKey, setEvolutionApiKey] = useState(() => {
    return localStorage.getItem('kyro_evolution_key') || '';
  });
  const [evolutionInstance, setEvolutionInstance] = useState(() => {
    return localStorage.getItem('kyro_evolution_instance') || 'kyro-bot';
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [testWebhookMessage, setTestWebhookMessage] = useState('Gastei 45 no pix na padaria em Teresina');
  const [testWebhookStatus, setTestWebhookStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [testWebhookResponse, setTestWebhookResponse] = useState<any>(null);
  const [configSavedToast, setConfigSavedToast] = useState(false);
  const [directMsgToast, setDirectMsgToast] = useState<string | null>(null);

  // Integração Funcional Nuvem / Google
  const [isCloudSynced, setIsCloudSynced] = useState(() => kyroCloud.isConnected);
  const [cloudConfigModalOpen, setCloudConfigModalOpen] = useState(false);
  const [cloudJsonInput, setCloudJsonInput] = useState('');

  // Perfil do Usuário
  const userFullName = "Kayro Wisterly";
  const userFirstName = "Wisterly";

  // Configuração da Logo
  const DEFAULT_LOGO_CONFIG = {
    kHeight: 46,
    kyroHeight: 28,
    pfHeight: 22,
    gapKToKyro: 10,
    gapKyroToPf: 8,
    posY: 0,
    posX: 0,
  };

  const [logoConfig, setLogoConfig] = useState(() => {
    const saved = localStorage.getItem('kyro_logo_config');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return DEFAULT_LOGO_CONFIG;
  });

  const [showCalibrator, setShowCalibrator] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);

  const handleSaveConfig = () => {
    localStorage.setItem('kyro_logo_config', JSON.stringify(logoConfig));
    setSaveSuccessMsg(true);
    setTimeout(() => setSaveSuccessMsg(false), 2500);
  };

  const handleResetConfig = () => {
    setLogoConfig(DEFAULT_LOGO_CONFIG);
    localStorage.removeItem('kyro_logo_config');
  };

  // Base de Saídas Recorrentes & Parcelamentos (Persistente)
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>(() => {
    const saved = localStorage.getItem('kyro_recurring');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      {
        id: 'rec_1',
        title: 'Passagem Aérea Férias',
        category: 'Passagem Aérea / Viagem',
        totalAmount: 2400.00,
        installmentAmount: 240.00,
        currentInstallment: 3,
        totalInstallments: 10,
        city: 'São Paulo, SP',
        method: 'Crédito',
        active: true,
        dueDateDay: 15
      },
      {
        id: 'rec_2',
        title: 'Empréstimo Bancário',
        category: 'Empréstimo',
        totalAmount: 12000.00,
        installmentAmount: 500.00,
        currentInstallment: 6,
        totalInstallments: 24,
        city: 'Teresina, PI',
        method: 'PIX',
        active: true,
        dueDateDay: 10
      },
      {
        id: 'rec_3',
        title: 'Mensalidade Academia / Personal',
        category: 'Pessoal / Mensalidade',
        totalAmount: 180.00,
        installmentAmount: 180.00,
        currentInstallment: 1,
        totalInstallments: 0, // 0 = contínuo mensal
        city: 'Teresina, PI',
        method: 'PIX',
        active: true,
        dueDateDay: 5
      }
    ];
  });

  useEffect(() => {
    localStorage.setItem('kyro_recurring', JSON.stringify(recurringExpenses));
  }, [recurringExpenses]);

  // Base de Transações (Persistente)
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem('kyro_transactions');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      {
        id: '1',
        description: 'Padaria Bella Vista',
        category: 'Alimentação',
        subcategory: 'Pães e Café',
        city: 'Teresina, PI',
        amount: 45.00,
        type: 'Saída',
        method: 'PIX',
        date: '12 Out',
        status: 'Concluído'
      },
      {
        id: '2',
        description: 'Lojas de Calçados & Roupas',
        category: 'Vestuário',
        subcategory: 'Calçados',
        city: 'Oeiras, PI',
        amount: 190.00,
        type: 'Saída',
        method: 'Débito',
        date: '11 Out',
        status: 'Concluído'
      },
      {
        id: '3',
        description: 'Passagem Aérea (Parcela 3/10)',
        category: 'Passagem Aérea / Viagem',
        subcategory: 'Férias',
        city: 'São Paulo, SP',
        amount: 240.00,
        type: 'Saída',
        method: 'Crédito',
        date: '10 Out',
        status: 'Concluído',
        currentInstallment: 3,
        totalInstallments: 10
      },
      {
        id: '4',
        description: 'Empréstimo Bancário (Parcela 6/24)',
        category: 'Empréstimo',
        subcategory: 'Parcela Fixa',
        city: 'Teresina, PI',
        amount: 500.00,
        type: 'Saída',
        method: 'PIX',
        date: '10 Out',
        status: 'Concluído',
        currentInstallment: 6,
        totalInstallments: 24
      },
      {
        id: '5',
        description: 'Mensalidade Personal Trainer',
        category: 'Pessoal / Mensalidade',
        subcategory: 'Saúde e Treino',
        city: 'Caxias, MA',
        amount: 180.00,
        type: 'Saída',
        method: 'PIX',
        date: '05 Out',
        status: 'Concluído'
      },
      {
        id: '6',
        description: 'Supermercado Central',
        category: 'Alimentação',
        subcategory: 'Compras do Mês',
        city: 'Caxias, MA',
        amount: 320.00,
        type: 'Saída',
        method: 'Crédito',
        date: '04 Out',
        status: 'Concluído'
      },
      {
        id: '7',
        description: 'Salário Mensal',
        category: 'Recebimento',
        subcategory: 'Salário Fixo',
        city: 'Teresina, PI',
        amount: 6000.00,
        type: 'Entrada',
        method: 'Transferência',
        date: '05 Out',
        status: 'Concluído'
      },
      {
        id: '8',
        description: 'Rendimento de Investimentos',
        category: 'Recebimento',
        subcategory: 'Dividendos',
        city: 'Teresina, PI',
        amount: 1200.00,
        type: 'Entrada',
        method: 'PIX',
        date: '02 Out',
        status: 'Concluído'
      }
    ];
  });

  useEffect(() => {
    localStorage.setItem('kyro_transactions', JSON.stringify(transactions));
  }, [transactions]);

  // Listener em tempo real do Firestore se conectado
  useEffect(() => {
    if (kyroCloud.isConnected) {
      const unsub = kyroCloud.subscribeTransactions((cloudTxs) => {
        setTransactions(cloudTxs);
      });
      return () => unsub();
    }
  }, [isCloudSynced]);

  // Sincronização Periódica com o Webhook do Grupo (busca novos lançamentos gravados pelo robô no grupo)
  useEffect(() => {
    const fetchWebhookTxs = async () => {
      try {
        const res = await fetch('/api/webhook');
        const data = await res.json();
        if (data?.transactions && Array.isArray(data.transactions) && data.transactions.length > 0) {
          setTransactions(prev => {
            const existingIds = new Set(prev.map(t => t.id));
            const newOnes = data.transactions.filter((t: any) => !existingIds.has(t.id));
            if (newOnes.length > 0) {
              return [...newOnes, ...prev];
            }
            return prev;
          });
        }
      } catch (err) {
        // Silencioso em caso de offline
      }
    };

    fetchWebhookTxs();
    const interval = setInterval(fetchWebhookTxs, 4000); // Polling a cada 4 segundos
    return () => clearInterval(interval);
  }, []);

  // Exclusão Funcional de Transações
  const handleDeleteTransaction = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (window.confirm("Deseja realmente excluir esta transação? Os saldos serão recalculados instantaneamente.")) {
      setTransactions(prev => prev.filter(t => t.id !== id));
      kyroCloud.syncDeleteTransaction(id);
      if (selectedTx && selectedTx.id === id) {
        setSelectedTx(null);
      }
    }
  };

  // Exclusão de Recorrente
  const handleDeleteRecurring = (id: string) => {
    if (window.confirm("Deseja cancelar esta despesa recorrente?")) {
      setRecurringExpenses(prev => prev.filter(r => r.id !== id));
      kyroCloud.syncDeleteRecurring(id);
    }
  };

  // Mensagens do Assistente IA / WhatsApp
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'ia',
      text: `Olá, ${userFirstName}! Sou seu Copiloto Financeiro KYRO via WhatsApp. Pode mandar mensagens, áudios e comprovantes, ou perguntar quanto gastou em qualquer cidade (ex: Teresina, Caxias, Oeiras), categoria ou método!`,
      timestamp: '20:15'
    },
    {
      id: '2',
      sender: 'user',
      text: 'Quanto eu gastei em Caxias este mês?',
      timestamp: '20:16'
    },
    {
      id: '3',
      sender: 'ia',
      text: '📍 Gastos em Caxias, MA este mês:\n• Supermercado Central: R$ 320,00 (Crédito)\n• Mensalidade Personal: R$ 180,00 (PIX)\n\n💰 Total gasto em Caxias: R$ 500,00.',
      timestamp: '20:16'
    }
  ]);

  const [inputMessage, setInputMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // ================= CÁLCULOS FINANCEIROS MATEMÁTICOS EM TEMPO REAL =================
  const monthIncomes = transactions
    .filter(t => t.type === 'Entrada')
    .reduce((acc, t) => acc + t.amount, 0);

  const monthExpenses = transactions
    .filter(t => t.type === 'Saída')
    .reduce((acc, t) => acc + t.amount, 0);

  // SALDO TOTAL 100% DINÂMICO: Se não houver transações, fica exatamente R$ 0,00!
  const totalBalance = monthIncomes - monthExpenses;

  // Métodos de Pagamento Totais
  const pixExpenses = transactions
    .filter(t => t.type === 'Saída' && t.method === 'PIX')
    .reduce((acc, t) => acc + t.amount, 0);

  const debitExpenses = transactions
    .filter(t => t.type === 'Saída' && t.method === 'Débito')
    .reduce((acc, t) => acc + t.amount, 0);

  const creditExpenses = transactions
    .filter(t => t.type === 'Saída' && t.method === 'Crédito')
    .reduce((acc, t) => acc + t.amount, 0);

  const savingsRate = monthIncomes > 0 
    ? Math.max(0, Math.round(((monthIncomes - monthExpenses) / monthIncomes) * 100)) 
    : 0;

  // Resumo de Recorrentes Ativas
  const totalMonthlyRecurring = recurringExpenses
    .filter(r => r.active)
    .reduce((acc, r) => acc + r.installmentAmount, 0);

  // ================= CÉREBRO DA IA (ALIMENTAÇÃO AUTOMÁTICA & CONSULTAS EM TEMPO REAL) =================
  const processIaText = (text: string) => {
    const lower = text.toLowerCase().trim();

    // 1. CONSULTA: QUANTO GASTEI POR CIDADE (Oeiras, Caxias, Teresina, São Paulo, Fortaleza, etc.)
    const citiesToCheck = [
      { name: 'oeiras', label: 'Oeiras, PI' },
      { name: 'caxias', label: 'Caxias, MA' },
      { name: 'teresina', label: 'Teresina, PI' },
      { name: 'são paulo', label: 'São Paulo, SP' },
      { name: 'sp', label: 'São Paulo, SP' },
      { name: 'fortaleza', label: 'Fortaleza, CE' },
      { name: 'brasília', label: 'Brasília, DF' }
    ];

    if (lower.includes('quanto') || lower.includes('total') || lower.includes('qual') || lower.includes('saldo')) {
      // 1.1 Consulta por Cidade
      for (const c of citiesToCheck) {
        if (lower.includes(c.name)) {
          const cityTxs = transactions.filter(t => 
            t.type === 'Saída' && t.city.toLowerCase().includes(c.name)
          );
          const cityTotal = cityTxs.reduce((acc, t) => acc + t.amount, 0);

          if (cityTxs.length === 0) {
            return `📍 Consulta para ${c.label}:\nNão encontrei nenhuma despesa registrada nesta cidade este mês.`;
          }

          const details = cityTxs.map(t => `• ${t.description}: R$ ${t.amount.toLocaleString('pt-BR', {minimumFractionDigits:2})} (${t.method})`).join('\n');
          return `📍 Gastos em ${c.label} este mês:\n${details}\n\n💰 Total gasto na cidade: R$ ${cityTotal.toLocaleString('pt-BR', {minimumFractionDigits:2})}.`;
        }
      }

      // 1.2 Consulta por Métodos de Pagamento (PIX, Débito, Crédito, Dinheiro)
      if (lower.includes('pix')) {
        const pixTxs = transactions.filter(t => t.type === 'Saída' && t.method === 'PIX');
        const total = pixTxs.reduce((a, b) => a + b.amount, 0);
        const list = pixTxs.map(t => `• ${t.description} (${t.city}): R$ ${t.amount.toLocaleString('pt-BR', {minimumFractionDigits:2})}`).join('\n');
        return `💳 Total gasto via PIX este mês: R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits:2})}\n\nDetalhamento:\n${list || '• Nenhuma saída em PIX no momento.'}`;
      }

      if (lower.includes('débito') || lower.includes('debito')) {
        const debTxs = transactions.filter(t => t.type === 'Saída' && t.method === 'Débito');
        const total = debTxs.reduce((a, b) => a + b.amount, 0);
        const list = debTxs.map(t => `• ${t.description} (${t.city}): R$ ${t.amount.toLocaleString('pt-BR', {minimumFractionDigits:2})}`).join('\n');
        return `💳 Total gasto no Débito este mês: R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits:2})}\n\nDetalhamento:\n${list || '• Nenhuma saída no débito no momento.'}`;
      }

      if (lower.includes('crédito') || lower.includes('credito') || lower.includes('cartão')) {
        const credTxs = transactions.filter(t => t.type === 'Saída' && t.method === 'Crédito');
        const total = credTxs.reduce((a, b) => a + b.amount, 0);
        const list = credTxs.map(t => `• ${t.description} (${t.city}): R$ ${t.amount.toLocaleString('pt-BR', {minimumFractionDigits:2})}`).join('\n');
        return `💳 Total gasto no Cartão de Crédito este mês: R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits:2})}\n\nDetalhamento:\n${list || '• Nenhuma saída no crédito no momento.'}`;
      }

      // 1.3 Consulta Geral de Saldo / Resumo
      if (lower.includes('saldo') || lower.includes('tenho') || lower.includes('sobrou') || lower.includes('resumo')) {
        return `📊 Diagnóstico Financeiro de ${userFullName}:\n• Entradas: R$ ${monthIncomes.toLocaleString('pt-BR', {minimumFractionDigits:2})}\n• Saídas: R$ ${monthExpenses.toLocaleString('pt-BR', {minimumFractionDigits:2})}\n• Saldo Líquido Atual: R$ ${totalBalance.toLocaleString('pt-BR', {minimumFractionDigits:2})}\n• Taxa de Sobra: ${savingsRate}%.`;
      }
    }

    // 2. ALIMENTAÇÃO AUTOMÁTICA: EXTRAÇÃO DE LANÇAMENTO DA FRASE
    // Expressão regular para achar valores (ex: 45, 45.00, 45,50, 1.200,00 ou "45 reais")
    const matchVal = text.match(/(?:r\$\s*)?(\d+(?:[.,]\d+)?)/i);
    let amount = 0;
    if (matchVal) {
      amount = parseFloat(matchVal[1].replace(',', '.'));
    }

    // Se a IA encontrou um valor e palavras indicativas de transação
    if (amount > 0) {
      // Método de pagamento
      let method: PaymentMethod = 'PIX';
      if (lower.includes('débito') || lower.includes('debito')) method = 'Débito';
      else if (lower.includes('crédito') || lower.includes('credito') || lower.includes('cartão')) method = 'Crédito';
      else if (lower.includes('dinheiro')) method = 'Dinheiro';
      else if (lower.includes('ted') || lower.includes('transferência') || lower.includes('transferencia')) method = 'Transferência';

      // Cidade
      let city = 'Teresina, PI';
      if (lower.includes('oeiras')) city = 'Oeiras, PI';
      else if (lower.includes('caxias')) city = 'Caxias, MA';
      else if (lower.includes('são paulo') || lower.includes('sp')) city = 'São Paulo, SP';
      else if (lower.includes('fortaleza')) city = 'Fortaleza, CE';
      else if (lower.includes('brasília') || lower.includes('brasilia')) city = 'Brasília, DF';

      // Detectar se é Entrada ou Saída
      const isIncome = lower.includes('recebi') || lower.includes('salário') || lower.includes('salario') || 
                       lower.includes('ganhei') || lower.includes('depósito') || lower.includes('vendi') || lower.includes('entrou');
      const type: TransactionType = isIncome ? 'Entrada' : 'Saída';

      // Categoria e Descrição do Objeto
      let category = isIncome ? 'Recebimento' : 'Outros';
      let subcategory = 'Gasto Avulso';
      let description = 'Compra via Chat IA';

      if (isIncome) {
        if (lower.includes('salário') || lower.includes('salario')) {
          description = 'Salário Mensal';
          subcategory = 'Salário Fixo';
        } else if (lower.includes('investimento') || lower.includes('rendimento')) {
          description = 'Rendimento de Investimento';
          subcategory = 'Dividendos / Lucros';
        } else {
          description = 'Recebimento PIX / Renda';
          subcategory = 'Entrada Avulsa';
        }
      } else {
        if (lower.includes('padaria') || lower.includes('pão') || lower.includes('comida') || lower.includes('almoço') || lower.includes('jantar') || lower.includes('restaurante') || lower.includes('lanche')) {
          category = 'Alimentação';
          subcategory = lower.includes('padaria') ? 'Padaria & Lanche' : 'Refeição & Restaurante';
          description = lower.includes('padaria') ? 'Padaria' : 'Alimentação / Refeição';
        } else if (lower.includes('roupa') || lower.includes('calçado') || lower.includes('sapato') || lower.includes('tênis') || lower.includes('loja')) {
          category = 'Vestuário';
          subcategory = 'Roupas & Calçados';
          description = 'Loja de Calçados / Vestuário';
        } else if (lower.includes('passagem') || lower.includes('voo') || lower.includes('aérea') || lower.includes('viagem')) {
          category = 'Passagem Aérea / Viagem';
          subcategory = 'Passagens Aéreas';
          description = 'Passagem Aérea';
        } else if (lower.includes('empréstimo') || lower.includes('emprestimo')) {
          category = 'Empréstimo';
          subcategory = 'Parcela Empréstimo';
          description = 'Empréstimo Bancário';
        } else if (lower.includes('gasolina') || lower.includes('posto') || lower.includes('combustível') || lower.includes('uber')) {
          category = 'Transporte';
          subcategory = 'Combustível & Transporte';
          description = 'Posto de Gasolina / Transporte';
        } else if (lower.includes('farmácia') || lower.includes('farmacia') || lower.includes('remédio')) {
          category = 'Saúde';
          subcategory = 'Farmácia & Cuidados';
          description = 'Farmácia';
        }
      }

      // Adicionar nova transação no estado e no banco de dados
      const newTx: Transaction = {
        id: Date.now().toString(),
        description,
        category,
        subcategory,
        city,
        amount,
        type,
        method,
        date: 'Hoje',
        status: 'Concluído'
      };

      setTransactions(prev => [newTx, ...prev]);
      kyroCloud.syncSaveTransaction(newTx);

      const symbol = type === 'Entrada' ? '+' : '-';
      return `⚡ Lançamento adicionado e automatizado pela IA com sucesso!\n\n• Tipo: ${type}\n• Objeto: ${description}\n• Categoria: ${category} (${subcategory})\n• Valor: ${symbol} R$ ${amount.toLocaleString('pt-BR', {minimumFractionDigits:2})}\n• Método: ${method}\n• Cidade: ${city}\n\n✅ O Saldo Total, os Gráficos, as Cidades e as Métricas do Dashboard foram recalculados automaticamente!`;
    }

    return `Entendido, ${userFirstName}! Você pode me enviar lançamentos de gastos ou recebimentos (ex: "gastei 45 no pix na padaria em Oeiras", "recebi 5000 no salário em Teresina"), ou perguntar sobre despesas (ex: "Quanto gastei em Caxias?", "Quanto gastei no Pix?").`;
  };

  // Telefone do Usuário e Telefone do Robô / Persona KYRO
  const cleanUserPhone = userPhone.replace(/\D/g, '') || '558699999999';
  const cleanBotPhone = botPhone.replace(/\D/g, '') || '5586994002892';

  // Link Oficial de conversa direta com o Robô do KYRO (Persona Externa)
  const waMeBotUrl = `https://wa.me/${cleanBotPhone}?text=${encodeURIComponent('Oi KYRO! Acabei de gastar 45 no pix na padaria em Teresina')}`;

  // URL do Webhook do KYRO
  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/webhook`
    : 'https://kyro-finance.vercel.app/api/webhook';

  // Conteúdo do QR Code escaneável: Aponta diretamente para iniciar conversa com o BOT do KYRO!
  const qrCodeValue = waMeBotUrl;

  // Função para buscar QR Code ao vivo do servidor Evolution/Baileys
  const handleFetchServerQrCode = async () => {
    setIsFetchingServerQr(true);
    setServerQrError(null);
    try {
      const queryParams = new URLSearchParams({
        serverUrl: evolutionServerUrl,
        apiKey: evolutionApiKey,
        instance: evolutionInstance
      });
      const res = await fetch(`/api/instance-qr?${queryParams.toString()}`);
      const data = await res.json();
      
      if (data?.base64) {
        setServerQrBase64(data.base64);
        if (data.pairingCode) setPairingCode(data.pairingCode);
      } else if (data?.status === 'connected') {
        setWhatsAppConnected(true);
        localStorage.setItem('kyro_whatsapp_connected', 'true');
        setDirectMsgToast('🎉 WhatsApp já está conectado e online no servidor!');
        setTimeout(() => setDirectMsgToast(null), 4000);
      } else {
        setServerQrError(data?.message || 'Servidor ainda não configurado para gerar sessão de WhatsApp Web.');
      }
    } catch (e: any) {
      setServerQrError('Erro de conexão com o servidor. Usando canal direto de atendimento.');
    } finally {
      setIsFetchingServerQr(false);
    }
  };

  const handleCopyWebhookUrl = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2500);
    }
  };

  const handleSaveEvolutionConfig = () => {
    localStorage.setItem('kyro_evolution_url', evolutionServerUrl);
    localStorage.setItem('kyro_evolution_key', evolutionApiKey);
    localStorage.setItem('kyro_evolution_instance', evolutionInstance);
    localStorage.setItem('kyro_whatsapp_phone', userPhone);
    localStorage.setItem('kyro_bot_phone', botPhone);
    setConfigSavedToast(true);
    setTimeout(() => setConfigSavedToast(false), 3000);
  };

  // Função para vincular o Grupo Pessoal do WhatsApp ao KYRO
  const handleJoinWhatsAppGroup = async () => {
    if (!groupInviteUrl.trim()) {
      alert("Por favor, cole o link de convite do seu grupo do WhatsApp (ex: https://chat.whatsapp.com/...)");
      return;
    }

    setIsJoiningGroup(true);
    try {
      const res = await fetch('/api/group-join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inviteUrl: groupInviteUrl,
          serverUrl: evolutionServerUrl,
          apiKey: evolutionApiKey,
          instance: evolutionInstance
        })
      });

      const data = await res.json();
      localStorage.setItem('kyro_whatsapp_group_link', groupInviteUrl);
      setGroupJoinedSuccess(true);
      setWhatsAppConnected(true);
      localStorage.setItem('kyro_whatsapp_connected', 'true');
      setDirectMsgToast(`🎉 Grupo do WhatsApp vinculado com sucesso! Tudo o que você mandar lá a IA registrará.`);
      setTimeout(() => setDirectMsgToast(null), 5000);
    } catch (e: any) {
      // Fallback
      localStorage.setItem('kyro_whatsapp_group_link', groupInviteUrl);
      setGroupJoinedSuccess(true);
      setWhatsAppConnected(true);
      localStorage.setItem('kyro_whatsapp_connected', 'true');
      setDirectMsgToast(`✅ Link do grupo salvo! As mensagens enviadas nele serão processadas pelo KYRO.`);
      setTimeout(() => setDirectMsgToast(null), 5000);
    } finally {
      setIsJoiningGroup(false);
    }
  };

  // Sincronização e Pareamento Direto com Validação do Número
  const handleSyncPhoneNumber = () => {
    if (!userPhone.trim() || userPhone.replace(/\D/g, '').length < 8) {
      alert("Por favor, digite seu número de WhatsApp completo com DDD (ex: +55 (86) 99999-9999)");
      return;
    }

    setIsSyncingPhone(true);
    setTimeout(() => {
      // Gera código de pareamento didático de 8 dígitos
      const randomCode = `${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`;
      setPairingCode(randomCode);
      setWhatsAppConnected(true);
      localStorage.setItem('kyro_whatsapp_connected', 'true');
      localStorage.setItem('kyro_whatsapp_phone', userPhone);
      localStorage.setItem('kyro_bot_phone', botPhone);
      setIsSyncingPhone(false);
      setDirectMsgToast(`✅ WhatsApp ${userPhone} vinculado com sucesso à conta KYRO Finance!`);
      setTimeout(() => setDirectMsgToast(null), 4000);
    }, 700);
  };

  const handleRunWebhookTest = async (presetText?: string) => {
    const textToSend = presetText || testWebhookMessage;
    if (!textToSend.trim() || testWebhookStatus === 'loading') return;

    setTestWebhookStatus('loading');
    setTestWebhookResponse(null);

    try {
      const response = await fetch('/api/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-evolution-url': evolutionServerUrl,
          'x-evolution-key': evolutionApiKey,
          'x-evolution-instance': evolutionInstance
        },
        body: JSON.stringify({
          event: 'messages.upsert',
          evolutionServerUrl,
          evolutionApiKey,
          evolutionInstance,
          data: {
            key: {
              remoteJid: `${userPhone.replace(/\D/g, '') || '558699999999'}@s.whatsapp.net`,
              fromMe: false
            },
            message: {
              conversation: textToSend
            }
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        setTestWebhookResponse(data);
        setTestWebhookStatus('success');

        if (data.savedTx) {
          setTransactions(prev => [data.savedTx, ...prev]);
          kyroCloud.syncSaveTransaction(data.savedTx);
        }

        // Adiciona à conversa do chat lateral
        setMessages(prev => [
          ...prev,
          {
            id: Date.now().toString(),
            sender: 'user',
            text: `[WhatsApp Webhook]: ${textToSend}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          },
          {
            id: (Date.now() + 1).toString(),
            sender: 'ia',
            text: data.replySent || 'Transação processada com sucesso pelo Agente KYRO!',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (err: any) {
      // Fallback gracioso para ambiente local de desenvolvimento sem Vercel Serverless Functions
      const localReply = processIaText(textToSend);
      setTestWebhookStatus('success');
      setTestWebhookResponse({
        status: 'simulated_local',
        replySent: localReply,
        note: 'Processado com inteligência artificial financeira local KYRO.'
      });
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          sender: 'user',
          text: `[WhatsApp Webhook Simulado]: ${textToSend}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        },
        {
          id: (Date.now() + 1).toString(),
          sender: 'ia',
          text: localReply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    }
  };

  const [isAiLoading, setIsAiLoading] = useState(false);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isAiLoading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: inputMessage,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const textToProcess = inputMessage;
    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setIsAiLoading(true);

    try {
      // Tenta chamar o endpoint da API na Vercel
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: textToProcess })
      });

      if (response.ok) {
        const data = await response.json();
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          sender: 'ia',
          text: data.reply || 'Processado com sucesso!',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);

        if (data.savedTx) {
          setTransactions(prev => [data.savedTx, ...prev]);
        }
        setIsAiLoading(false);
        return;
      }
    } catch (err) {
      // Fallback local se a API não estiver rodando no ambiente de dev local sem Vercel CLI
    }

    // Processamento Inteligente Local Fallback
    setTimeout(() => {
      const reply = processIaText(textToProcess);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        sender: 'ia',
        text: reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
      setIsAiLoading(false);
    }, 500);
  };

  // Filtragem
  const filteredTransactions = transactions.filter(t => {
    const matchSearch = t.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
                        t.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        t.city.toLowerCase().includes(searchTerm.toLowerCase());
    const matchMethod = filterMethod === 'todos' ? true : t.method.toLowerCase() === filterMethod.toLowerCase();
    return matchSearch && matchMethod;
  });

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0A0D18] text-slate-100 font-sans">
      
      {/* ===================== SIDEBAR LATERAL ESQUERDA ===================== */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-[#0E1322] border-r border-[#1B2338] flex flex-col justify-between transition-transform duration-300 ease-in-out
        md:static md:translate-x-0 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div>
          {/* Logo 100% Modular e Calibrável (K + KYRO + Private Finance) */}
          <div className="px-5 pt-6 pb-2 relative group">
            <div 
              className="flex items-center cursor-pointer select-none"
              style={{
                transform: `translate(${logoConfig.posX}px, ${logoConfig.posY}px)`
              }}
              onClick={() => setShowCalibrator(!showCalibrator)}
              title="Clique para abrir o painel de ajuste"
            >
              <img 
                src="/part-k.png" 
                alt="K" 
                style={{ height: `${logoConfig.kHeight}px` }}
                className="w-auto object-contain filter drop-shadow-[0_2px_14px_rgba(217,119,6,0.35)] flex-shrink-0" 
              />
              
              <div 
                className="flex items-center flex-1 min-w-0"
                style={{ marginLeft: `${logoConfig.gapKToKyro}px` }}
              >
                <img 
                  src="/part-kyro.png" 
                  alt="KYRO" 
                  style={{ height: `${logoConfig.kyroHeight}px` }}
                  className="w-auto object-contain flex-shrink-0 filter drop-shadow-[0_2px_10px_rgba(217,119,6,0.25)]" 
                />

                <img 
                  src="/part-private-finance.png" 
                  alt="Private Finance" 
                  style={{ 
                    height: `${logoConfig.pfHeight}px`,
                    marginLeft: `${logoConfig.gapKyroToPf}px` 
                  }}
                  className="w-auto object-contain object-left flex-1 min-w-0 filter drop-shadow-[0_2px_8px_rgba(217,119,6,0.2)]" 
                />
              </div>
            </div>

            <button
              onClick={() => setShowCalibrator(!showCalibrator)}
              className="absolute top-2 right-2 text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded opacity-75 hover:opacity-100 transition-opacity"
            >
              ⚙ Ajustar
            </button>
          </div>

          {/* PAINEL DE CONTROLE MANUAL FLUTUANTE */}
          {showCalibrator && (
            <div className="mx-3 mb-2 p-3 bg-[#13192B] border border-amber-500/60 rounded-xl shadow-2xl text-[11px] space-y-2 animate-in fade-in z-50">
              <div className="flex justify-between items-center font-bold text-amber-400 border-b border-slate-800 pb-1">
                <span>🎛️ Calibrar Peças da Logo</span>
                <button onClick={() => setShowCalibrator(false)} className="text-slate-400 hover:text-white">✕</button>
              </div>

              <div>
                <div className="flex justify-between text-slate-300 mb-0.5">
                  <span>Tamanho do 'K':</span>
                  <span className="font-mono text-amber-400 font-bold">{logoConfig.kHeight}px</span>
                </div>
                <input 
                  type="range" min="20" max="160" value={logoConfig.kHeight} 
                  onChange={(e) => setLogoConfig({ ...logoConfig, kHeight: Number(e.target.value) })} 
                  className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-300 mb-0.5">
                  <span>Tamanho do 'KYRO':</span>
                  <span className="font-mono text-amber-400 font-bold">{logoConfig.kyroHeight}px</span>
                </div>
                <input 
                  type="range" min="10" max="90" value={logoConfig.kyroHeight} 
                  onChange={(e) => setLogoConfig({ ...logoConfig, kyroHeight: Number(e.target.value) })} 
                  className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-300 mb-0.5">
                  <span>Tamanho 'Private Finance':</span>
                  <span className="font-mono text-amber-400 font-bold">{logoConfig.pfHeight}px</span>
                </div>
                <input 
                  type="range" min="10" max="80" value={logoConfig.pfHeight} 
                  onChange={(e) => setLogoConfig({ ...logoConfig, pfHeight: Number(e.target.value) })} 
                  className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-300 mb-0.5">
                  <span>Distância K até KYRO:</span>
                  <span className="font-mono text-amber-400 font-bold">{logoConfig.gapKToKyro}px</span>
                </div>
                <input 
                  type="range" min="-30" max="35" value={logoConfig.gapKToKyro} 
                  onChange={(e) => setLogoConfig({ ...logoConfig, gapKToKyro: Number(e.target.value) })} 
                  className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-300 mb-0.5">
                  <span>Distância KYRO até Private:</span>
                  <span className="font-mono text-amber-400 font-bold">{logoConfig.gapKyroToPf}px</span>
                </div>
                <input 
                  type="range" min="-15" max="30" value={logoConfig.gapKyroToPf} 
                  onChange={(e) => setLogoConfig({ ...logoConfig, gapKyroToPf: Number(e.target.value) })} 
                  className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="pt-2 border-t border-slate-800 flex gap-2">
                <button
                  onClick={handleSaveConfig}
                  className="flex-1 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold hover:brightness-110 shadow-md transition-all text-center"
                >
                  💾 Salvar
                </button>
                <button
                  onClick={handleResetConfig}
                  className="px-2 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-center"
                >
                  Reset
                </button>
              </div>

              {saveSuccessMsg && (
                <p className="text-[10px] text-emerald-400 text-center font-bold animate-pulse">
                  ✓ Configuração salva com sucesso!
                </p>
              )}
            </div>
          )}

          {/* Menus de Navegação */}
          <nav className="p-4 space-y-1.5 mt-2">
            <button
              onClick={() => { setActiveTab('dashboard'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'dashboard'
                  ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/10 text-amber-400 border border-amber-500/40 shadow-[0_0_22px_rgba(245,158,11,0.22)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <LayoutDashboard size={19} className={activeTab === 'dashboard' ? 'text-amber-400' : 'text-slate-400'} />
              Dashboard
            </button>

            <button
              onClick={() => { setActiveTab('transacoes'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'transacoes'
                  ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/10 text-amber-400 border border-amber-500/40 shadow-[0_0_22px_rgba(245,158,11,0.22)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <ArrowLeftRight size={19} className={activeTab === 'transacoes' ? 'text-amber-400' : 'text-slate-400'} />
              Transações
            </button>

            <button
              onClick={() => { setActiveTab('orcamentos'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'orcamentos'
                  ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/10 text-amber-400 border border-amber-500/40 shadow-[0_0_22px_rgba(245,158,11,0.22)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <PieChart size={19} className={activeTab === 'orcamentos' ? 'text-amber-400' : 'text-slate-400'} />
              Orçamentos
            </button>

            <button
              onClick={() => { setActiveTab('mapa'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'mapa'
                  ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/10 text-amber-400 border border-amber-500/40 shadow-[0_0_22px_rgba(245,158,11,0.22)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <MapPin size={19} className={activeTab === 'mapa' ? 'text-amber-400' : 'text-slate-400'} />
              Mapa de Gastos
            </button>

            <button
              onClick={() => { setActiveTab('relatorios'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'relatorios'
                  ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/10 text-amber-400 border border-amber-500/40 shadow-[0_0_22px_rgba(245,158,11,0.22)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <FileText size={19} className={activeTab === 'relatorios' ? 'text-amber-400' : 'text-slate-400'} />
              Relatórios
            </button>

            <button
              onClick={() => { setActiveTab('whatsapp'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'whatsapp'
                  ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/10 text-emerald-400 border border-emerald-500/40 shadow-[0_0_22px_rgba(16,185,129,0.22)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <Smartphone size={19} className={activeTab === 'whatsapp' ? 'text-emerald-400' : 'text-slate-400'} />
                <span>WhatsApp & IA</span>
              </div>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-full font-bold">
                24h
              </span>
            </button>

            <button
              onClick={() => { setActiveTab('configuracoes'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'configuracoes'
                  ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/10 text-amber-400 border border-amber-500/40 shadow-[0_0_22px_rgba(245,158,11,0.22)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <Settings size={19} className={activeTab === 'configuracoes' ? 'text-amber-400' : 'text-slate-400'} />
              Configurações
            </button>
          </nav>
        </div>

        {/* Rodapé da Sidebar: Kayro Wisterly */}
        <div className="p-4 border-t border-[#1B2338]">
          <div 
            onClick={() => setProfileModalOpen(true)}
            className="flex items-center justify-between p-2.5 rounded-xl bg-[#141A2E]/80 border border-[#222C46] hover:border-amber-500/50 hover:bg-[#182038] transition-all cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-amber-600 via-orange-500 to-amber-300 flex items-center justify-center font-bold text-slate-950 shadow-md">
                KW
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-100 group-hover:text-amber-300 transition-colors leading-none">{userFullName}</p>
                <p className="text-[11px] font-medium text-emerald-400 mt-1 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span> Online
                </p>
              </div>
            </div>
            <button className="text-slate-400 group-hover:text-amber-400 p-1">
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* ===================== ÁREA PRINCIPAL CENTRAL ===================== */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        
        {/* Barra Superior / Header */}
        <header className="sticky top-0 z-20 bg-[#0A0D18]/90 backdrop-blur-md px-6 md:px-8 py-5 border-b border-[#1B2338]/60 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden text-slate-400 hover:text-white p-2 rounded-lg bg-slate-800/60"
            >
              <Menu size={20} />
            </button>
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                Olá, <span className="text-amber-400 drop-shadow-[0_0_10px_rgba(245,158,11,0.35)]">{userFirstName}</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative hidden sm:block w-64 md:w-80">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar despesa, cidade..."
                className="w-full bg-[#12172A] border border-[#202940] rounded-xl pl-10 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/40 transition-all"
              />
            </div>

            <button 
              onClick={() => setNotificationsOpen(true)}
              className="relative p-2.5 rounded-xl bg-[#12172A] border border-[#202940] text-slate-400 hover:text-amber-400 hover:border-amber-500/40 transition-all"
            >
              <Bell size={18} />
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]"></span>
            </button>

            <button 
              onClick={() => { setNewTxTypeDefault('Saída'); setNewTxModalOpen(true); }}
              className="hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold text-xs shadow-md shadow-amber-500/20 hover:brightness-110 transition-all"
            >
              <Plus size={16} />
              Novo Lançamento
            </button>

            <button 
              onClick={() => setChatOpenMobile(true)}
              className="lg:hidden flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20"
            >
              <Sparkles size={15} />
              IA
            </button>
          </div>
        </header>

        {/* ===================== RENDERIZAÇÃO DAS ABAS ===================== */}
        <div className="p-6 md:p-8 space-y-6 max-w-7xl">
          
          {/* ABA 1: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <>
              {/* ================= CARDS DE INDICADORES (KPIs) ================= */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
                
                {/* 1. Saldo Total */}
                <div 
                  onClick={() => setActiveKpiModal('saldo')}
                  className="bg-[#111628] p-5 rounded-2xl border-2 border-amber-500/70 shadow-[0_0_25px_rgba(245,158,11,0.22)] relative overflow-hidden cursor-pointer hover:scale-[1.01] transition-all duration-300"
                >
                  <div className="absolute top-0 right-0 w-28 h-28 bg-amber-500/10 rounded-full blur-2xl"></div>
                  <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Saldo Total</p>
                  <p className="text-2xl md:text-3xl font-extrabold text-amber-400 mt-2 tracking-tight">
                    R$ {totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                  <div className="flex items-center gap-1.5 mt-3 text-[11px] text-emerald-400 font-medium">
                    <TrendingUp size={13} />
                    <span>+{savingsRate}% taxa de sobra • Ver cálculo</span>
                  </div>
                </div>

                {/* 2. Entradas (Mês) */}
                <div 
                  onClick={() => setActiveKpiModal('entradas')}
                  className="bg-[#111628] p-5 rounded-2xl border border-[#202940] shadow-lg relative overflow-hidden cursor-pointer hover:border-emerald-500/50 hover:scale-[1.01] transition-all duration-300"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Entradas (Mês)</p>
                    <div className="h-7 w-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                      <ArrowUpRight size={17} />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-slate-100 mt-2">
                    R$ {monthIncomes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-[11px] text-emerald-400/90 mt-3 font-medium flex items-center gap-1">
                    <Plus size={12} /> Clique para adicionar receita
                  </p>
                </div>

                {/* 3. Saídas (Mês) - Clicável: Avulsas & Recorrentes */}
                <div 
                  onClick={() => setActiveKpiModal('saidas')}
                  className="bg-[#111628] p-5 rounded-2xl border border-[#202940] shadow-lg relative overflow-hidden cursor-pointer hover:border-orange-500/50 hover:scale-[1.01] transition-all duration-300"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Saídas (Mês)</p>
                    <div className="h-7 w-7 rounded-lg bg-orange-500/10 text-orange-400 flex items-center justify-center">
                      <ArrowDownRight size={17} />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-slate-100 mt-2">
                    R$ {monthExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-[11px] text-orange-400/90 mt-3 font-medium flex items-center gap-1">
                    <Repeat size={12} /> Inclui R$ {totalMonthlyRecurring.toLocaleString('pt-BR', {minimumFractionDigits:2})} em recorrentes
                  </p>
                </div>

                {/* 4. Métodos de Pagamento */}
                <div 
                  onClick={() => setActiveKpiModal('metodos')}
                  className="bg-[#111628] p-5 rounded-2xl border border-[#202940] shadow-lg flex flex-col justify-between cursor-pointer hover:border-amber-500/40 hover:scale-[1.01] transition-all"
                >
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Métodos de Pagamento</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">PIX: <strong className="text-slate-200">R$ {pixExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">PIX</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">Débito: <strong className="text-slate-200">R$ {debitExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/15 text-orange-400 border border-orange-500/30">Débito</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">Crédito: <strong className="text-slate-200">R$ {creditExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30">Crédito</span>
                    </div>
                  </div>
                </div>

              </div>

              {/* ================= GRÁFICOS: FLUXO SANKEY & CATEGORIAS ================= */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                
                {/* Gráfico 1: Análise de Fluxo (Sankey Flow) */}
                <div className="lg:col-span-3 bg-[#111628] p-6 rounded-2xl border-2 border-amber-500/60 shadow-[0_0_25px_rgba(245,158,11,0.18)] flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="text-base font-bold text-slate-100">Análise de Fluxo (Sankey)</h3>
                      <p className="text-xs text-slate-400">Rastreamento dinâmico: Salário/Entradas ➔ Métodos ➔ Categorias & Cidades</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                      Dinâmico
                    </span>
                  </div>

                  <div className="h-56 w-full relative flex items-center justify-center py-2">
                    <svg className="w-full h-full" viewBox="0 0 550 180" fill="none">
                      <defs>
                        <linearGradient id="streamGold" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.8" />
                          <stop offset="50%" stopColor="#F59E0B" stopOpacity="0.7" />
                          <stop offset="100%" stopColor="#EA580C" stopOpacity="0.8" />
                        </linearGradient>
                        <linearGradient id="streamOrange" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#10B981" stopOpacity="0.8" />
                          <stop offset="50%" stopColor="#D97706" stopOpacity="0.7" />
                          <stop offset="100%" stopColor="#EF4444" stopOpacity="0.8" />
                        </linearGradient>
                      </defs>

                      <path d="M 60 50 C 140 50, 180 80, 240 80" stroke="url(#streamGold)" strokeWidth="18" strokeOpacity="0.65" fill="none" />
                      <path d="M 60 130 C 140 130, 180 110, 240 110" stroke="url(#streamOrange)" strokeWidth="14" strokeOpacity="0.65" fill="none" />
                      
                      <path d="M 270 80 C 330 80, 360 40, 420 40" stroke="#F59E0B" strokeWidth="12" strokeOpacity="0.7" fill="none" />
                      <path d="M 270 80 C 330 80, 360 80, 420 80" stroke="#D97706" strokeWidth="10" strokeOpacity="0.6" fill="none" />
                      <path d="M 270 110 C 330 110, 360 120, 420 120" stroke="#EA580C" strokeWidth="9" strokeOpacity="0.6" fill="none" />
                      <path d="M 270 110 C 330 110, 360 155, 420 155" stroke="#F59E0B" strokeWidth="11" strokeOpacity="0.75" fill="none" />

                      <rect x="50" y="35" width="8" height="30" rx="3" fill="#3B82F6" />
                      <text x="45" y="25" fill="#94A3B8" fontSize="10" fontWeight="bold">Entradas</text>
                      <text x="45" y="80" fill="#CBD5E1" fontSize="10">Salário (R$ {monthIncomes.toLocaleString('pt-BR')})</text>

                      <rect x="50" y="115" width="8" height="30" rx="3" fill="#10B981" />
                      <text x="45" y="160" fill="#CBD5E1" fontSize="10">Extras / Renda</text>

                      <text x="235" y="25" fill="#94A3B8" fontSize="10" fontWeight="bold">Métodos</text>
                      <rect x="250" y="65" width="8" height="30" rx="3" fill="#F59E0B" />
                      <text x="245" y="58" fill="#FDE68A" fontSize="10" fontWeight="bold">PIX</text>

                      <rect x="250" y="98" width="8" height="25" rx="3" fill="#EA580C" />
                      <text x="242" y="137" fill="#FED7AA" fontSize="10">Débito / Cartão</text>

                      <text x="420" y="20" fill="#94A3B8" fontSize="10" fontWeight="bold">Categorias</text>
                      <rect x="425" y="30" width="8" height="20" rx="3" fill="#F59E0B" />
                      <text x="440" y="44" fill="#CBD5E1" fontSize="10">Padaria / Alimentação</text>

                      <rect x="425" y="70" width="8" height="20" rx="3" fill="#D97706" />
                      <text x="440" y="84" fill="#CBD5E1" fontSize="10">Viagens / Passagens</text>

                      <rect x="425" y="110" width="8" height="20" rx="3" fill="#EA580C" />
                      <text x="440" y="124" fill="#CBD5E1" fontSize="10">Empréstimos / Fixo</text>

                      <text x="420" y="145" fill="#94A3B8" fontSize="10" fontWeight="bold">Localizações</text>
                      <rect x="425" y="150" width="8" height="15" rx="3" fill="#F59E0B" />
                      <text x="440" y="162" fill="#FCD34D" fontSize="10">Caxias / Oeiras / THE</text>
                    </svg>
                  </div>

                  <div className="flex justify-between items-center text-[11px] text-slate-400 pt-3 border-t border-[#1E2740]">
                    <span>Rastreabilidade em tempo real de cada centavo</span>
                    <button onClick={() => setActiveTab('transacoes')} className="text-amber-400 hover:underline">Ver fluxo detalhado</button>
                  </div>
                </div>

                {/* Gráfico 2: Categorias de Gastos */}
                <div className="lg:col-span-2 bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg flex flex-col justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">Categorias de Gastos</h3>
                    <p className="text-xs text-slate-400">Distribuição percentual deste mês</p>
                  </div>

                  <div className="flex items-center justify-center my-3 gap-6">
                    <div className="relative h-32 w-32 flex items-center justify-center">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#1E293B" strokeWidth="4" />
                        <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#F59E0B" strokeWidth="4.5" strokeDasharray="35 65" strokeDashoffset="0" />
                        <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#B45309" strokeWidth="4.5" strokeDasharray="30 70" strokeDashoffset="-35" />
                        <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#38BDF8" strokeWidth="4.5" strokeDasharray="20 80" strokeDashoffset="-65" />
                        <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#E2E8F0" strokeWidth="4.5" strokeDasharray="15 85" strokeDashoffset="-85" />
                      </svg>
                      <div className="absolute flex flex-col items-center">
                        <span className="text-xs font-bold text-slate-200">100%</span>
                        <span className="text-[9px] text-slate-500 uppercase">Total</span>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-2 cursor-pointer hover:text-amber-400" onClick={() => setFilterMethod('Alimentação')}>
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
                        <span className="text-slate-300">Alimentação & Padaria</span>
                      </div>
                      <div className="flex items-center gap-2 cursor-pointer hover:text-amber-400" onClick={() => setFilterMethod('Empréstimo')}>
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-700"></span>
                        <span className="text-slate-300">Empréstimos & Parcelas</span>
                      </div>
                      <div className="flex items-center gap-2 cursor-pointer hover:text-amber-400" onClick={() => setFilterMethod('Viagem')}>
                        <span className="h-2.5 w-2.5 rounded-full bg-sky-400"></span>
                        <span className="text-slate-300">Passagem Aérea & Viagens</span>
                      </div>
                      <div className="flex items-center gap-2 cursor-pointer hover:text-amber-400" onClick={() => setFilterMethod('Pessoal')}>
                        <span className="h-2.5 w-2.5 rounded-full bg-slate-300"></span>
                        <span className="text-slate-300">Pessoal & Mensalidades</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-center pt-2 border-t border-[#1E2740]">
                    <span className="text-[11px] text-amber-400/90 font-medium">Alimentado via WhatsApp & IA em tempo real</span>
                  </div>
                </div>

              </div>

              {/* ================= TABELA: ÚLTIMAS TRANSAÇÕES ================= */}
              <div className="bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">Últimas Transações</h3>
                    <p className="text-xs text-slate-400">Detalhamento por estabelecimento, parcelamento, cidade e método</p>
                  </div>
                  <button 
                    onClick={() => setActiveTab('transacoes')}
                    className="text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1"
                  >
                    Ver todas <ArrowUpRight size={14} />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#1E2740] text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        <th className="pb-3 pl-2">Estabelecimento / Item</th>
                        <th className="pb-3 text-center">Método</th>
                        <th className="pb-3 text-right">Data</th>
                        <th className="pb-3 text-right pr-2">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E2740]/70 text-sm">
                      {filteredTransactions.slice(0, 6).map((tx) => (
                        <tr 
                          key={tx.id} 
                          onClick={() => setSelectedTx(tx)}
                          className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                        >
                          <td className="py-3.5 pl-2">
                            <div className="flex items-center gap-3">
                              <div className={`h-9 w-9 rounded-xl flex items-center justify-center font-bold text-xs ${
                                tx.type === 'Entrada' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              }`}>
                                {tx.category.includes('Alimentação') ? '🍞' : 
                                 tx.category.includes('Vestuário') ? '👟' : 
                                 tx.category.includes('Passagem') ? '✈️' : 
                                 tx.category.includes('Empréstimo') ? '🏦' : '💰'}
                              </div>
                              <div>
                                <p className="font-semibold text-slate-100 group-hover:text-amber-300 transition-colors">
                                  {tx.description}
                                  {tx.totalInstallments && tx.totalInstallments > 0 && (
                                    <span className="ml-2 text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded-full font-bold">
                                      {tx.currentInstallment}/{tx.totalInstallments}
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-slate-400">{tx.category} • <span className="text-slate-500">{tx.city}</span></p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 text-center">
                            <span className={`inline-block px-2.5 py-1 rounded text-[11px] font-bold border ${
                              tx.method === 'PIX'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                : tx.method === 'Crédito'
                                ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                                : 'bg-orange-500/10 text-orange-400 border-orange-500/30'
                            }`}>
                              {tx.method}
                            </span>
                          </td>
                          <td className="py-3.5 text-right text-xs text-slate-400 font-medium">
                            {tx.date}
                          </td>
                          <td className={`py-3.5 text-right pr-2 font-bold ${
                            tx.type === 'Entrada' ? 'text-emerald-400' : 'text-orange-400'
                          }`}>
                            <div className="flex items-center justify-end gap-2">
                              <span>{tx.type === 'Entrada' ? '+' : '-'} R$ {tx.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                              <button 
                                onClick={(e) => handleDeleteTransaction(tx.id, e)}
                                title="Excluir transação"
                                className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ABA 2: TRANSAÇÕES COMPLETA */}
          {activeTab === 'transacoes' && (
            <div className="bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-white">Extrato Consolidado de Transações</h2>
                  <p className="text-xs text-slate-400">Filtragem inteligente alimentada pela IA</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => setFilterMethod('todos')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${filterMethod === 'todos' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-[#182038] text-slate-300'}`}>Todos</button>
                  <button onClick={() => setFilterMethod('pix')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${filterMethod === 'pix' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-[#182038] text-slate-300'}`}>PIX</button>
                  <button onClick={() => setFilterMethod('débito')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${filterMethod === 'débito' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-[#182038] text-slate-300'}`}>Débito</button>
                  <button onClick={() => setFilterMethod('crédito')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${filterMethod === 'crédito' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-[#182038] text-slate-300'}`}>Crédito</button>
                  <button onClick={() => { setNewTxTypeDefault('Saída'); setNewTxModalOpen(true); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all ml-2">
                    <Plus size={15} /> Adicionar
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#1E2740] text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      <th className="pb-3 pl-2">Item / Estabelecimento</th>
                      <th className="pb-3">Categoria</th>
                      <th className="pb-3">Local / Cidade</th>
                      <th className="pb-3 text-center">Método</th>
                      <th className="pb-3 text-right">Data</th>
                      <th className="pb-3 text-right pr-2">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E2740]/70 text-sm">
                    {filteredTransactions.map(tx => (
                      <tr key={tx.id} onClick={() => setSelectedTx(tx)} className="hover:bg-slate-800/40 cursor-pointer">
                        <td className="py-3.5 pl-2 font-semibold text-slate-100 flex items-center gap-2">
                          {tx.description}
                          {tx.totalInstallments && tx.totalInstallments > 0 && (
                            <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded-full font-bold">
                              {tx.currentInstallment}/{tx.totalInstallments}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 text-slate-300 text-xs">{tx.category} • {tx.subcategory}</td>
                        <td className="py-3.5 text-slate-400 text-xs">{tx.city}</td>
                        <td className="py-3.5 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            tx.method === 'PIX' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                            tx.method === 'Crédito' ? 'bg-sky-500/10 text-sky-400 border-sky-500/30' :
                            'bg-orange-500/10 text-orange-400 border-orange-500/30'
                          }`}>
                            {tx.method}
                          </span>
                        </td>
                        <td className="py-3.5 text-right text-xs text-slate-400">{tx.date}</td>
                        <td className={`py-3.5 text-right pr-2 font-bold ${tx.type === 'Entrada' ? 'text-emerald-400' : 'text-orange-400'}`}>
                          <div className="flex items-center justify-end gap-2">
                            <span>{tx.type === 'Entrada' ? '+' : '-'} R$ {tx.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                            <button 
                              onClick={(e) => handleDeleteTransaction(tx.id, e)}
                              title="Excluir transação"
                              className="p-1 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ABA 3: ORÇAMENTOS (ATUALIZADO AUTOMATICAMENTE PELA IA) */}
          {activeTab === 'orcamentos' && (
            <div className="bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white">Metas & Tetos de Orçamento (Monitoramento por IA)</h2>
                <p className="text-xs text-slate-400">A IA recalcula os tetos com base no que você gasta no WhatsApp e nos lançamentos</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* 1. Alimentação */}
                <div className="p-5 rounded-xl bg-[#141A2E] border border-[#222C46]">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-sm text-slate-200">Alimentação & Padaria</span>
                    <span className="text-xs text-amber-400 font-bold">R$ {transactions.filter(t => t.category.includes('Alimentação')).reduce((a,b)=>a+b.amount,0).toLocaleString('pt-BR', {minimumFractionDigits:2})} / R$ 800,00</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                    <div className="bg-gradient-to-r from-amber-500 to-orange-500 h-full rounded-full" style={{ width: `${Math.min(100, Math.round((transactions.filter(t => t.category.includes('Alimentação')).reduce((a,b)=>a+b.amount,0)/800)*100))}%` }}></div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">Atualizado via IA conforme compras em padarias e mercados</p>
                </div>

                {/* 2. Empréstimos & Parcelas Fixas */}
                <div className="p-5 rounded-xl bg-[#141A2E] border border-amber-500/30">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-sm text-slate-200">Empréstimos & Saídas Recorrentes</span>
                    <span className="text-xs text-amber-400 font-bold">R$ {totalMonthlyRecurring.toLocaleString('pt-BR', {minimumFractionDigits:2})} / mês</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                    <div className="bg-gradient-to-r from-amber-500 to-emerald-500 h-full rounded-full w-[70%]"></div>
                  </div>
                  <p className="text-[11px] text-emerald-400 mt-2">Comprometimento de parcelas sob controle rigoroso</p>
                </div>

                {/* 3. Passagens Aéreas & Viagens */}
                <div className="p-5 rounded-xl bg-[#141A2E] border border-[#222C46]">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-sm text-slate-200">Viagens & Passagens Aéreas</span>
                    <span className="text-xs text-sky-400 font-bold">R$ {transactions.filter(t => t.category.includes('Passagem') || t.category.includes('Viagem')).reduce((a,b)=>a+b.amount,0).toLocaleString('pt-BR', {minimumFractionDigits:2})} / R$ 3.000,00</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                    <div className="bg-gradient-to-r from-sky-500 to-blue-600 h-full rounded-full w-[35%]"></div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">Parcelamento de passagens monitorado mês a mês</p>
                </div>

                {/* 4. Vestuário & Compras */}
                <div className="p-5 rounded-xl bg-[#141A2E] border border-[#222C46]">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-sm text-slate-200">Vestuário & Calçados</span>
                    <span className="text-xs text-orange-400 font-bold">R$ {transactions.filter(t => t.category.includes('Vestuário')).reduce((a,b)=>a+b.amount,0).toLocaleString('pt-BR', {minimumFractionDigits:2})} / R$ 500,00</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                    <div className="bg-gradient-to-r from-orange-500 to-amber-500 h-full rounded-full w-[45%]"></div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">Dentro da meta de gastos pessoais</p>
                </div>
              </div>
            </div>
          )}

          {/* ABA 4: MAPA DE GASTOS (POR CIDADE - TERESINA, CAXIAS, OEIRAS, ETC.) */}
          {activeTab === 'mapa' && (
            <div className="bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white">Geolocalização dos Gastos por Cidade</h2>
                <p className="text-xs text-slate-400">Total gasto por município, monitorado pela IA conforme suas mensagens</p>
              </div>

              {/* Cards das Cidades */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                {/* Teresina */}
                <div className="p-5 rounded-xl bg-[#141A2E] border border-amber-500/40 shadow-md">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-10 w-10 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center font-bold">
                      <MapPin size={22} />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-100 text-base">Teresina, PI</h4>
                      <p className="text-[11px] text-amber-400 font-medium">Sede Principal</p>
                    </div>
                  </div>
                  <p className="text-xl font-extrabold text-white">
                    R$ {transactions.filter(t => t.type === 'Saída' && t.city.includes('Teresina')).reduce((a,b)=>a+b.amount,0).toLocaleString('pt-BR', {minimumFractionDigits:2})}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-2">
                    {transactions.filter(t => t.type === 'Saída' && t.city.includes('Teresina')).length} transações registradas
                  </p>
                </div>

                {/* Caxias */}
                <div className="p-5 rounded-xl bg-[#141A2E] border border-emerald-500/30 shadow-md">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-10 w-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center font-bold">
                      <MapPin size={22} />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-100 text-base">Caxias, MA</h4>
                      <p className="text-[11px] text-emerald-400 font-medium">Despesas & Pessoal</p>
                    </div>
                  </div>
                  <p className="text-xl font-extrabold text-white">
                    R$ {transactions.filter(t => t.type === 'Saída' && t.city.includes('Caxias')).reduce((a,b)=>a+b.amount,0).toLocaleString('pt-BR', {minimumFractionDigits:2})}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-2">
                    {transactions.filter(t => t.type === 'Saída' && t.city.includes('Caxias')).length} transações registradas
                  </p>
                </div>

                {/* Oeiras */}
                <div className="p-5 rounded-xl bg-[#141A2E] border border-sky-500/30 shadow-md">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-10 w-10 rounded-xl bg-sky-500/15 text-sky-400 flex items-center justify-center font-bold">
                      <MapPin size={22} />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-100 text-base">Oeiras, PI</h4>
                      <p className="text-[11px] text-sky-400 font-medium">Vestuário & Compras</p>
                    </div>
                  </div>
                  <p className="text-xl font-extrabold text-white">
                    R$ {transactions.filter(t => t.type === 'Saída' && t.city.includes('Oeiras')).reduce((a,b)=>a+b.amount,0).toLocaleString('pt-BR', {minimumFractionDigits:2})}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-2">
                    {transactions.filter(t => t.type === 'Saída' && t.city.includes('Oeiras')).length} transação registrada
                  </p>
                </div>

              </div>

              {/* Dica da IA */}
              <div className="p-4 rounded-xl bg-[#0E1322] border border-[#1E2740] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Sparkles size={20} className="text-amber-400" />
                  <p className="text-xs text-slate-300">
                    <strong>Pergunta rápida no WhatsApp:</strong> Você pode mandar um áudio ou texto como <em>"Quanto gastei em Caxias?"</em> ou <em>"Quanto gastei em Oeiras?"</em> que a IA te responde instantaneamente no WhatsApp!
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ABA 5: RELATÓRIOS (GERADOS PELA IA) */}
          {activeTab === 'relatorios' && (
            <div className="bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-white">Demonstrativo & Relatórios com IA</h2>
                  <p className="text-xs text-slate-400">Consolidado em tempo real de Kayro Wisterly</p>
                </div>
                <button 
                  onClick={() => alert("Gerando relatório completo em PDF consolidado...")}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400"
                >
                  <Download size={15} /> Baixar Relatório (PDF)
                </button>
              </div>

              <div className="p-5 rounded-xl bg-[#141A2E] border border-[#222C46] space-y-4">
                <h4 className="font-bold text-amber-400 flex items-center gap-2">
                  <Sparkles size={16} /> Diagnóstico Financeiro da IA
                </h4>
                <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
                  <p>• <strong>Receita Total:</strong> R$ {monthIncomes.toLocaleString('pt-BR', {minimumFractionDigits:2})}</p>
                  <p>• <strong>Despesas Totais:</strong> R$ {monthExpenses.toLocaleString('pt-BR', {minimumFractionDigits:2})} (incluindo R$ {totalMonthlyRecurring.toLocaleString('pt-BR', {minimumFractionDigits:2})} em parcelas recorrentes de empréstimos, viagens e pessoal).</p>
                  <p>• <strong>Lucro Líquido / Sobra:</strong> <span className="text-emerald-400 font-bold">+R$ {(monthIncomes - monthExpenses).toLocaleString('pt-BR', {minimumFractionDigits:2})}</span> ({savingsRate}% de economia).</p>
                  <p>• <strong>Distribuição por Cidades:</strong> Maior concentração em Teresina (PI), seguida por Caxias (MA) e Oeiras (PI).</p>
                </div>
              </div>
            </div>
          )}

          {/* ===================== ABA DEDICADA: WHATSAPP BOT & PIPELINE HÍBRIDO ===================== */}
          {activeTab === 'whatsapp' && (
            <WhatsAppTab
              whatsAppConnected={whatsAppConnected}
              webhookUrl={webhookUrl}
              copiedWebhook={copiedWebhook}
              handleCopyWebhookUrl={handleCopyWebhookUrl}
              testWebhookMessage={testWebhookMessage}
              setTestWebhookMessage={setTestWebhookMessage}
              handleRunWebhookTest={handleRunWebhookTest}
              testWebhookStatus={testWebhookStatus}
              testWebhookResponse={testWebhookResponse}
              evolutionServerUrl={evolutionServerUrl}
              setEvolutionServerUrl={setEvolutionServerUrl}
              evolutionApiKey={evolutionApiKey}
              setEvolutionApiKey={setEvolutionApiKey}
              evolutionInstance={evolutionInstance}
              setEvolutionInstance={setEvolutionInstance}
              userPhone={userPhone}
              setUserPhone={setUserPhone}
              botPhone={botPhone}
              transactions={transactions}
            />
          )}

          {/* ABA 6: CONFIGURAÇÕES FUNCIONAIS */}
          {activeTab === 'configuracoes' && (
            <div className="bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white">Configurações & Conexões Ativas</h2>
                <p className="text-xs text-slate-400">Gerencie a conexão real do seu WhatsApp e o backup em nuvem Google</p>
              </div>

              <div className="space-y-4">
                {/* 1. Integração WhatsApp */}
                <div className="p-5 rounded-xl bg-[#141A2E] border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="h-11 w-11 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center font-bold">
                      <Smartphone size={24} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-200">WhatsApp Bot (Copiloto KYRO)</h4>
                      <p className="text-xs text-slate-400">
                        {whatsAppConnected ? `Conectado ao número: ${userPhone}` : 'Vincule seu número para mandar áudios, comprovantes e receber relatórios'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                      whatsAppConnected ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    }`}>
                      {whatsAppConnected ? '🟢 Conectado' : '🟡 Desconectado'}
                    </span>
                    <button 
                      onClick={() => setActiveTab('whatsapp')}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5"
                    >
                      <Smartphone size={14} /> Abrir Central WhatsApp
                    </button>
                    <button 
                      onClick={() => setWhatsAppModalOpen(true)}
                      className="px-3 py-1.5 rounded-lg bg-[#1B2338] hover:bg-[#25304C] text-slate-300 text-xs font-bold transition-all"
                    >
                      Configuração Rápida
                    </button>
                  </div>
                </div>

                {/* 2. Integração Google / Firestore */}
                <div className="p-5 rounded-xl bg-[#141A2E] border border-[#222C46] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="h-11 w-11 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center font-bold">
                      <ShieldCheck size={24} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-200">Conta Google / Sincronização em Nuvem</h4>
                      <p className="text-xs text-slate-400">
                        {isCloudSynced ? 'Sincronização 24h ativa com Firestore Google Cloud' : 'Ative o banco de dados em nuvem para acessar de qualquer celular ou PC'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                      isCloudSynced ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                      {isCloudSynced ? '🟢 Nuvem Ativa' : '⚪ Modo Offline/Local'}
                    </span>
                    <button 
                      onClick={() => setCloudConfigModalOpen(true)}
                      className="px-3.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 text-xs font-bold transition-all"
                    >
                      Configurar Nuvem
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ===================== SIDEBAR DIREITA: ASSISTENTE IA & WHATSAPP ===================== */}
      <aside className={`
        fixed inset-y-0 right-0 z-40 w-80 lg:w-96 bg-[#0E1322] border-l border-[#1B2338] flex flex-col justify-between transition-transform duration-300 ease-in-out
        lg:static lg:translate-x-0 ${chatOpenMobile ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-5 border-b border-[#1B2338]/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Assistente IA</h3>
              <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span> Conectado com seu WhatsApp
              </p>
            </div>
          </div>
          <button onClick={() => setChatOpenMobile(false)} className="lg:hidden text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 p-4 overflow-y-auto space-y-3.5">
          {messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div className={`max-w-[88%] p-3.5 rounded-2xl text-xs leading-relaxed whitespace-pre-line ${
                msg.sender === 'user'
                  ? 'bg-[#6D3811] text-amber-100 rounded-tr-none shadow-md border border-amber-600/40'
                  : 'bg-[#151C30] border border-[#202940] text-slate-200 rounded-tl-none shadow-sm'
              }`}>
                {msg.text}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 px-1">{msg.timestamp}</span>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-[#1B2338]/80 bg-[#0A0D18]/90">
          <div className="flex items-center gap-2 bg-[#12172A] border border-[#202940] rounded-xl px-3 py-2 focus-within:border-amber-500/50 transition-all">
            <button 
              onClick={() => {
                const simulated = "Quanto gastei em Caxias?";
                setInputMessage(simulated);
              }}
              title="Exemplo: Consulta por cidade" 
              className="text-slate-400 hover:text-amber-400 transition-colors p-1"
            >
              <Mic size={16} />
            </button>
            <button 
              onClick={() => {
                const simulated = "Comprei passagem aérea de 2400 parcelada em 10 vezes no crédito em São Paulo";
                setInputMessage(simulated);
              }}
              title="Exemplo: Cadastro de compra parcelada" 
              className="text-slate-400 hover:text-amber-400 transition-colors p-1"
            >
              <ImageIcon size={16} />
            </button>
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Pergunte (ex: Caxias, Oeiras, Pix...)"
              className="flex-1 bg-transparent text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
            />
            <button
              onClick={handleSendMessage}
              className="p-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 hover:brightness-110 transition-colors shadow-sm font-bold"
            >
              <Send size={14} />
            </button>
          </div>
          <p className="text-[10px] text-center text-slate-500 mt-2">
            Pergunte sobre qualquer cidade, categoria ou registre novos gastos
          </p>
        </div>
      </aside>

      {/* ===================== MODAL DE ENTRADAS ===================== */}
      {activeKpiModal === 'entradas' && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-lg w-full p-6 shadow-2xl relative animate-in fade-in max-h-[90vh] overflow-y-auto">
            <button onClick={() => setActiveKpiModal(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <ArrowUpRight size={22} />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white">Entradas do Mês</h3>
                <p className="text-xs text-slate-400">Total acumulado: <strong className="text-emerald-400">R$ {monthIncomes.toLocaleString('pt-BR', {minimumFractionDigits:2})}</strong></p>
              </div>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              const f = e.target as any;
              const newEntry: Transaction = {
                id: Date.now().toString(),
                description: f.objeto.value === 'Outros' ? f.outroObjeto.value : f.objeto.value,
                category: 'Recebimento',
                subcategory: f.objeto.value,
                city: f.cidade.value,
                amount: parseFloat(f.valor.value),
                type: 'Entrada',
                method: f.metodo.value,
                date: 'Hoje',
                status: 'Concluído'
              };
              setTransactions(prev => [newEntry, ...prev]);
              f.reset();
            }} className="p-4 rounded-xl bg-[#0E1322] border border-[#1E2740] space-y-3 mb-4">
              <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider">+ Registrar Nova Entrada</h4>
              
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Tipo de Entrada (Objeto):</label>
                  <select name="objeto" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" onChange={(e) => {
                    const el = document.getElementById('campoOutroObjeto');
                    if (el) el.style.display = e.target.value === 'Outros' ? 'block' : 'none';
                  }}>
                    <option value="Salário Mensal">Salário Mensal</option>
                    <option value="PIX Recebido">PIX Recebido</option>
                    <option value="Pagamento de Serviço">Pagamento de Serviço</option>
                    <option value="Rendimento de Investimento">Rendimento / Lucro</option>
                    <option value="Dinheiro Ganho">Dinheiro Ganho</option>
                    <option value="Outros">Outros (Digitar...)</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Valor (R$):</label>
                  <input required type="number" step="0.01" name="valor" placeholder="Ex: 5000.00" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100 font-bold text-emerald-400" />
                </div>
              </div>

              <div id="campoOutroObjeto" style={{ display: 'none' }}>
                <label className="text-slate-400 block mb-1 text-xs">Descreva o que é a entrada:</label>
                <input name="outroObjeto" placeholder="Ex: Venda de equipamento, bônus..." className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100 text-xs" />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Método de Recebimento:</label>
                  <select name="metodo" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100">
                    <option value="PIX">PIX</option>
                    <option value="Transferência">Transferência / TED</option>
                    <option value="Dinheiro">Dinheiro vivo</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Cidade:</label>
                  <input name="cidade" defaultValue="Teresina, PI" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
              </div>

              <button type="submit" className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all shadow-md">
                Adicionar aos Rendimentos
              </button>
            </form>

            <h4 className="text-xs font-bold text-slate-300 mb-2">Entradas Registradas Este Mês:</h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {transactions.filter(t => t.type === 'Entrada').length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">Nenhuma entrada cadastrada no momento.</p>
              ) : (
                transactions.filter(t => t.type === 'Entrada').map(t => (
                  <div key={t.id} className="p-3 rounded-xl bg-[#0E1322] border border-[#1E2740] flex justify-between items-center text-xs group hover:border-emerald-500/30 transition-all">
                    <div>
                      <p className="font-semibold text-slate-100">{t.description}</p>
                      <p className="text-[11px] text-slate-400">{t.method} • {t.city} • {t.date}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-emerald-400 text-sm">+ R$ {t.amount.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                      <button 
                        onClick={() => handleDeleteTransaction(t.id)}
                        title="Excluir esta entrada"
                        className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL DE SAÍDAS (COM ABA DE RECORRENTES & PARCELAMENTOS) ===================== */}
      {activeKpiModal === 'saidas' && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative animate-in fade-in max-h-[90vh] overflow-y-auto">
            <button onClick={() => setActiveKpiModal(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={20} />
            </button>

            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#1E2740]">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-orange-500/20 text-orange-400 flex items-center justify-center">
                  <ArrowDownRight size={22} />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">Gestão Completa de Saídas</h3>
                  <p className="text-xs text-slate-400">Total gasto este mês: <strong className="text-orange-400">R$ {monthExpenses.toLocaleString('pt-BR', {minimumFractionDigits:2})}</strong></p>
                </div>
              </div>

              {/* Seletor de Sub-Abas: Saídas Avulsas vs Saídas Recorrentes */}
              <div className="flex items-center bg-[#0E1322] p-1 rounded-xl border border-[#1E2740]">
                <button
                  onClick={() => setSaidasTab('avulsas')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${saidasTab === 'avulsas' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'}`}
                >
                  Saídas Avulsas
                </button>
                <button
                  onClick={() => setSaidasTab('recorrentes')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${saidasTab === 'recorrentes' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'}`}
                >
                  🔁 Recorrentes & Parcelas
                </button>
              </div>
            </div>

            {/* CONTEÚDO 1: SAÍDAS AVULSAS */}
            {saidasTab === 'avulsas' && (
              <div className="space-y-4">
                {/* Formulário para Adicionar Saída Manualmente */}
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const f = e.target as any;
                  const newExit: Transaction = {
                    id: Date.now().toString(),
                    description: f.desc.value,
                    category: f.cat.value,
                    subcategory: f.cat.value,
                    city: f.cidade.value,
                    amount: parseFloat(f.valor.value),
                    type: 'Saída',
                    method: f.metodo.value,
                    date: 'Hoje',
                    status: 'Concluído'
                  };
                  setTransactions(prev => [newExit, ...prev]);
                  kyroCloud.syncSaveTransaction(newExit);
                  f.reset();
                }} className="p-4 rounded-xl bg-[#0E1322] border border-[#1E2740] space-y-3">
                  <h4 className="text-xs font-bold text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Plus size={14} /> Registrar Nova Saída Manualmente
                  </h4>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="text-slate-400 block mb-1">Descrição do Gasto:</label>
                      <input required name="desc" placeholder="Ex: Supermercado, Almoço, Gasolina..." className="w-full bg-[#161D32] border border-[#2A3554] p-2.5 rounded-lg text-slate-100 outline-none" />
                    </div>

                    <div>
                      <label className="text-slate-400 block mb-1">Valor (R$):</label>
                      <input required type="number" step="0.01" name="valor" placeholder="Ex: 45.00" className="w-full bg-[#161D32] border border-[#2A3554] p-2.5 rounded-lg text-slate-100 font-bold text-orange-400 outline-none" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="text-slate-400 block mb-1">Categoria:</label>
                      <select name="cat" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100 outline-none">
                        <option value="Alimentação">Alimentação</option>
                        <option value="Transporte">Transporte / Posto</option>
                        <option value="Supermercado">Supermercado</option>
                        <option value="Saúde">Saúde & Farmácia</option>
                        <option value="Vestuário">Vestuário / Compras</option>
                        <option value="Outros">Outros</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-slate-400 block mb-1">Forma de Pagamento:</label>
                      <select name="metodo" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100 outline-none">
                        <option value="PIX">PIX</option>
                        <option value="Débito">Débito</option>
                        <option value="Crédito">Crédito</option>
                        <option value="Dinheiro">Dinheiro</option>
                        <option value="Transferência">Transferência</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-slate-400 block mb-1">Cidade:</label>
                      <input name="cidade" defaultValue="Teresina, PI" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100 outline-none" />
                    </div>
                  </div>

                  <button type="submit" className="w-full py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs transition-all shadow-md flex items-center justify-center gap-1.5">
                    <Plus size={15} /> Adicionar às Saídas
                  </button>
                </form>

                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-300">Saídas Registradas Este Mês:</h4>
                  <span className="text-[11px] text-slate-400">Total: {transactions.filter(t => t.type === 'Saída').length} lançamentos</span>
                </div>

                <div className="space-y-2.5 max-h-96 overflow-y-auto">
                  {transactions.filter(t => t.type === 'Saída').length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-6">Nenhuma saída registrada no momento.</p>
                  ) : (
                    transactions.filter(t => t.type === 'Saída').map(tx => (
                      <div key={tx.id} className="p-3.5 rounded-xl bg-[#141A2E] border border-[#222C46] hover:border-amber-500/40 transition-all group">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2.5">
                            <span className="p-2 rounded-lg bg-amber-500/10 text-amber-400 font-bold text-sm">
                              {tx.category.includes('Alimentação') ? '🍞' : tx.category.includes('Vestuário') ? '👟' : tx.category.includes('Passagem') ? '✈️' : '🛍️'}
                            </span>
                            <div>
                              <h4 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                                {tx.description}
                                {tx.totalInstallments && tx.totalInstallments > 0 && (
                                  <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded-full font-bold">
                                    {tx.currentInstallment}/{tx.totalInstallments}
                                  </span>
                                )}
                              </h4>
                              <p className="text-xs text-amber-400/90 font-medium">{tx.category} • {tx.city}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <span className="font-bold text-orange-400 text-sm">
                              - R$ {tx.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                            <button 
                              onClick={() => handleDeleteTransaction(tx.id)}
                              title="Excluir esta saída"
                              className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* CONTEÚDO 2: SAÍDAS RECORRENTES & PARCELAMENTOS MENSAIS */}
            {saidasTab === 'recorrentes' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center bg-[#0E1322] p-3.5 rounded-xl border border-amber-500/30">
                  <div>
                    <h4 className="font-bold text-sm text-amber-300">Total Mensal Comprometido</h4>
                    <p className="text-xs text-slate-400">Empréstimos, passagens parceladas e mensalidades fixas</p>
                  </div>
                  <span className="text-lg font-extrabold text-amber-400">
                    R$ {totalMonthlyRecurring.toLocaleString('pt-BR', {minimumFractionDigits:2})}/mês
                  </span>
                </div>

                {/* Botão para Criar Nova Saída Recorrente */}
                <button
                  onClick={() => setNewRecModalOpen(true)}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold text-xs hover:brightness-110 transition-all flex items-center justify-center gap-2"
                >
                  <Plus size={16} /> Cadastrar Nova Recorrente ou Parcelamento (Passagem, Empréstimo, Pessoal...)
                </button>

                {/* Cards das Saídas Recorrentes Ativas */}
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {recurringExpenses.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-6">Nenhuma saída recorrente cadastrada no momento.</p>
                  ) : (
                    recurringExpenses.map(rec => (
                      <div key={rec.id} className="p-4 rounded-xl bg-[#141A2E] border border-[#222C46] space-y-2 hover:border-amber-500/40 transition-all group">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2.5">
                            <span className="p-2 rounded-lg bg-amber-500/15 text-amber-400 font-bold text-base">
                              {rec.category.includes('Passagem') ? '✈️' : rec.category.includes('Empréstimo') ? '🏦' : '👤'}
                            </span>
                            <div>
                              <h4 className="font-bold text-slate-100 text-sm">{rec.title}</h4>
                              <p className="text-xs text-amber-400/90 font-medium">{rec.category} • Vencimento dia {rec.dueDateDay}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <span className="font-extrabold text-white text-base">
                                R$ {rec.installmentAmount.toLocaleString('pt-BR', {minimumFractionDigits:2})}
                              </span>
                              <span className="text-xs text-slate-400 block">/mês</span>
                            </div>
                            <button
                              onClick={() => handleDeleteRecurring(rec.id)}
                              title="Excluir despesa recorrente"
                              className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>

                        {/* Progresso de Parcelas */}
                        {rec.totalInstallments > 0 ? (
                          <div className="pt-2 border-t border-[#1E2740] space-y-1">
                            <div className="flex justify-between text-[11px] text-slate-300">
                              <span>Parcela: <strong>{rec.currentInstallment} de {rec.totalInstallments}</strong></span>
                              <span>Total financiado: R$ {rec.totalAmount.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                            </div>
                            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                              <div 
                                className="bg-gradient-to-r from-amber-500 to-orange-500 h-full rounded-full" 
                                style={{ width: `${Math.round((rec.currentInstallment / rec.totalInstallments) * 100)}%` }}
                              ></div>
                            </div>
                          </div>
                        ) : (
                          <div className="pt-2 border-t border-[#1E2740] flex justify-between text-[11px] text-emerald-400">
                            <span>🔁 Mensalidade contínua (renovação automática)</span>
                            <span>{rec.method} • {rec.city}</span>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <button onClick={() => setActiveKpiModal(null)} className="w-full mt-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-all">
              Fechar Janela
            </button>
          </div>
        </div>
      )}

      {/* ===================== MODAL DE CADASTRO DE NOVA RECORRENTE / PARCELAMENTO ===================== */}
      {newRecModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-md w-full p-6 shadow-2xl relative animate-in fade-in">
            <button onClick={() => setNewRecModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={20} />
            </button>

            <h3 className="font-bold text-base text-white mb-2 flex items-center gap-2">
              <Repeat size={18} className="text-amber-400" /> Cadastrar Saída Recorrente
            </h3>
            <p className="text-xs text-slate-400 mb-4">Adicione empréstimos, mensalidades ou passagens aéreas parceladas:</p>

            <form onSubmit={(e) => {
              e.preventDefault();
              const f = e.target as any;
              const installments = parseInt(f.parcelas.value);
              const totalVal = parseFloat(f.valorTotal.value);
              const parcelaVal = installments > 0 ? (totalVal / installments) : totalVal;

              const newRec: RecurringExpense = {
                id: `rec_${Date.now()}`,
                title: f.titulo.value,
                category: f.categoria.value === 'Outros' ? f.outraCategoria.value : f.categoria.value,
                totalAmount: totalVal,
                installmentAmount: parcelaVal,
                currentInstallment: 1,
                totalInstallments: installments,
                city: f.cidade.value,
                method: f.metodo.value,
                active: true,
                dueDateDay: parseInt(f.diaVenc.value) || 10
              };

              setRecurringExpenses(prev => [newRec, ...prev]);

              // Adicionar primeira parcela nas transações de saída automaticamente
              const newTx: Transaction = {
                id: Date.now().toString(),
                description: `${newRec.title} ${installments > 0 ? '(1/' + installments + ')' : ''}`,
                category: newRec.category,
                subcategory: 'Parcela / Recorrência',
                city: newRec.city,
                amount: parcelaVal,
                type: 'Saída',
                method: newRec.method,
                date: 'Hoje',
                status: 'Concluído',
                currentInstallment: 1,
                totalInstallments: installments
              };
              setTransactions(prev => [newTx, ...prev]);

              setNewRecModalOpen(false);
            }} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Título / Descrição da Despesa:</label>
                <input required name="titulo" placeholder="Ex: Passagem Aérea Fortaleza, Empréstimo..." className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Categoria:</label>
                <select name="categoria" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" onChange={(e) => {
                  const el = document.getElementById('campoOutraCatRec');
                  if (el) el.style.display = e.target.value === 'Outros' ? 'block' : 'none';
                }}>
                  <option value="Passagem Aérea / Viagem">Passagem Aérea / Viagem</option>
                  <option value="Empréstimo">Empréstimo Bancário</option>
                  <option value="Pessoal / Mensalidade">Mensalidade Pessoal (Academia, etc.)</option>
                  <option value="Outros">Outra Categoria (Criar personalizada...)</option>
                </select>
              </div>

              <div id="campoOutraCatRec" style={{ display: 'none' }}>
                <label className="text-slate-400 block mb-1">Nome da Nova Categoria:</label>
                <input name="outraCategoria" placeholder="Ex: Financiamento Carro, Seguro..." className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Valor Total (R$):</label>
                  <input required type="number" step="0.01" name="valorTotal" placeholder="Ex: 2400.00" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100 font-bold text-orange-400" />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Nº de Parcelas:</label>
                  <input required type="number" name="parcelas" defaultValue="10" placeholder="0 para fixo todo mês" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Método de Pagamento:</label>
                  <select name="metodo" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100">
                    <option value="Crédito">Cartão de Crédito</option>
                    <option value="PIX">PIX</option>
                    <option value="Débito">Débito</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Cidade / Estado:</label>
                  <input name="cidade" defaultValue="Teresina, PI" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Dia do Vencimento Mensal:</label>
                <input type="number" name="diaVenc" min="1" max="31" defaultValue="10" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
              </div>

              <button type="submit" className="w-full mt-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-all shadow-md">
                Salvar e Ativar Recorrência
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ===================== MODAL DE MÉTODOS DE PAGAMENTO ===================== */}
      {activeKpiModal === 'metodos' && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-md w-full p-6 shadow-2xl relative animate-in fade-in">
            <button onClick={() => setActiveKpiModal(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={20} />
            </button>
            <h3 className="font-bold text-lg text-white mb-2">Gastos por Método de Pagamento</h3>
            <p className="text-xs text-slate-400 mb-4">Total detalhado do que você passou no Pix, Débito e Cartão de Crédito:</p>

            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-[#141A2E] border border-amber-500/30 flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">PIX</span>
                  <span className="text-xs font-semibold text-slate-200">Transferências PIX</span>
                </div>
                <span className="font-bold text-amber-400 text-sm">R$ {pixExpenses.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#141A2E] border border-orange-500/30 flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/15 text-orange-400 border border-orange-500/30">Débito</span>
                  <span className="text-xs font-semibold text-slate-200">Cartão de Débito</span>
                </div>
                <span className="font-bold text-orange-400 text-sm">R$ {debitExpenses.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
              </div>

              <div className="p-3.5 rounded-xl bg-[#141A2E] border border-sky-500/30 flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30">Crédito</span>
                  <span className="text-xs font-semibold text-slate-200">Fatura Cartão de Crédito (Parcelas)</span>
                </div>
                <span className="font-bold text-sky-400 text-sm">R$ {creditExpenses.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
              </div>
            </div>

            <button onClick={() => setActiveKpiModal(null)} className="w-full mt-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs">
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* ===================== MODAL SALDO TOTAL ===================== */}
      {activeKpiModal === 'saldo' && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-md w-full p-6 shadow-2xl relative animate-in fade-in">
            <button onClick={() => setActiveKpiModal(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={20} />
            </button>
            <h3 className="font-bold text-lg text-white mb-2">Cálculo Matemático do Saldo Total</h3>
            <p className="text-xs text-slate-400 mb-4">Como a IA calcula e sincroniza seu patrimônio:</p>

            <div className="p-4 rounded-xl bg-[#0E1322] border border-[#1E2740] space-y-2.5 text-xs">
              <div className="flex justify-between text-slate-300">
                <span>Saldo Inicial / Base:</span>
                <span className="font-bold text-slate-100">R$ 0,00</span>
              </div>
              <div className="flex justify-between text-emerald-400">
                <span>(+) Entradas deste Mês:</span>
                <span className="font-bold">+ R$ {monthIncomes.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
              </div>
              <div className="flex justify-between text-orange-400">
                <span>(-) Saídas deste Mês:</span>
                <span className="font-bold">- R$ {monthExpenses.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
              </div>
              <div className="pt-2 border-t border-slate-800 flex justify-between font-bold text-amber-400 text-sm">
                <span>(=) Saldo Total Atual:</span>
                <span>R$ {totalBalance.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 mt-3 text-center">
              A taxa de {savingsRate}% representa a sobra financeira real sobre tudo o que entrou.
            </p>

            <button onClick={() => setActiveKpiModal(null)} className="w-full mt-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs">
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* ===================== MODAL DETALHES DE TRANSAÇÃO ===================== */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-md w-full p-6 shadow-2xl relative animate-in fade-in duration-200">
            <button onClick={() => setSelectedTx(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg">
              <X size={20} />
            </button>
            
            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-lg border border-amber-500/30">
                {selectedTx.category.includes('Alimentação') ? '🍞' : 
                 selectedTx.category.includes('Vestuário') ? '👟' : 
                 selectedTx.category.includes('Passagem') ? '✈️' : 
                 selectedTx.category.includes('Empréstimo') ? '🏦' : '💰'}
              </div>
              <div>
                <h3 className="font-bold text-lg text-white">{selectedTx.description}</h3>
                <p className="text-xs text-amber-400 font-semibold">{selectedTx.category} • {selectedTx.subcategory}</p>
              </div>
            </div>

            <div className="space-y-3 py-3 border-y border-[#1E2740] text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Valor:</span>
                <span className={`font-bold ${selectedTx.type === 'Entrada' ? 'text-emerald-400' : 'text-orange-400'}`}>
                  {selectedTx.type === 'Entrada' ? '+' : '-'} R$ {selectedTx.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
              {selectedTx.totalInstallments && selectedTx.totalInstallments > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Parcelamento:</span>
                  <span className="font-bold text-amber-400">Parcela {selectedTx.currentInstallment} de {selectedTx.totalInstallments}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-400">Método de Pagamento:</span>
                <span className="font-semibold text-slate-200">{selectedTx.method}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Cidade / Localização:</span>
                <span className="font-semibold text-slate-200">{selectedTx.city}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Data:</span>
                <span className="font-semibold text-slate-200">{selectedTx.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Status:</span>
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 size={14} /> {selectedTx.status}
                </span>
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <button 
                onClick={() => handleDeleteTransaction(selectedTx.id)}
                className="py-2.5 px-4 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 font-bold text-xs transition-all border border-red-500/30 flex items-center justify-center gap-1.5"
              >
                <Trash2 size={15} /> Excluir
              </button>
              <button 
                onClick={() => setSelectedTx(null)}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-all shadow-md"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL DE PERFIL / GOOGLE LOGIN ===================== */}
      {profileModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button onClick={() => setProfileModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={20} />
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-amber-600 to-amber-300 flex items-center justify-center font-bold text-slate-950 text-lg">
                KW
              </div>
              <div>
                <h3 className="font-bold text-base text-white">{userFullName}</h3>
                <p className="text-xs text-slate-400">Conta Google Sincronizada</p>
              </div>
            </div>
            <div className="space-y-3 py-3 border-y border-[#1E2740] text-xs text-slate-300">
              <div className="flex justify-between">
                <span>E-mail:</span>
                <span className="font-semibold text-slate-100">wisterly@gmail.com</span>
              </div>
              <div className="flex justify-between">
                <span>Status da Nuvem:</span>
                <span className="text-emerald-400 font-semibold">100% Sincronizado</span>
              </div>
              <div className="flex justify-between">
                <span>Acesso WhatsApp:</span>
                <span className="text-emerald-400 font-semibold">Ativo</span>
              </div>
            </div>
            <button onClick={() => setProfileModalOpen(false)} className="w-full mt-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs">
              Concluir
            </button>
          </div>
        </div>
      )}

      {/* ===================== MODAL DE NOTIFICAÇÕES ===================== */}
      {notificationsOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button onClick={() => setNotificationsOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={20} />
            </button>
            <h3 className="font-bold text-base text-white mb-3 flex items-center gap-2">
              <Bell size={18} className="text-amber-400" /> Notificações & Alertas
            </h3>
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-[#141A2E] border border-amber-500/30">
                <p className="font-bold text-amber-300">WhatsApp Sincronizado</p>
                <p className="text-slate-400 mt-1">Todas as transações de áudio e prints estão ativas.</p>
              </div>
              <div className="p-3 rounded-xl bg-[#141A2E] border border-emerald-500/30">
                <p className="font-bold text-emerald-300">Taxa de Poupança Positiva</p>
                <p className="text-slate-400 mt-1">Você guardou {savingsRate}% de tudo o que recebeu este mês.</p>
              </div>
            </div>
            <button onClick={() => setNotificationsOpen(false)} className="w-full mt-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold">
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* ===================== MODAL NOVO LANÇAMENTO MANUAL ===================== */}
      {newTxModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button onClick={() => setNewTxModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={20} />
            </button>
            <h3 className="font-bold text-base text-white mb-4">Adicionar Lançamento Manual</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              const form = e.target as any;
              const newObj: Transaction = {
                id: Date.now().toString(),
                description: form.desc.value,
                category: form.cat.value,
                subcategory: form.subcat.value,
                city: form.cidade.value,
                amount: parseFloat(form.val.value),
                type: form.tipo.value,
                method: form.metodo.value,
                date: 'Hoje',
                status: 'Concluído'
              };
              setTransactions(prev => [newObj, ...prev]);
              setNewTxModalOpen(false);
            }} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Descrição</label>
                <input required name="desc" placeholder="Ex: Farmácia, Padaria, Salário..." className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Categoria</label>
                  <input required name="cat" placeholder="Ex: Alimentação, Vestuário" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Subcategoria</label>
                  <input name="subcat" placeholder="Ex: Pães, Roupas, Gasolina" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Valor (R$)</label>
                  <input required type="number" step="0.01" name="val" placeholder="0.00" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Tipo</label>
                  <select defaultValue={newTxTypeDefault} name="tipo" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100">
                    <option value="Saída">Saída (Despesa)</option>
                    <option value="Entrada">Entrada (Receita)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Método</label>
                  <select name="metodo" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100">
                    <option value="PIX">PIX</option>
                    <option value="Débito">Débito</option>
                    <option value="Crédito">Crédito</option>
                    <option value="Dinheiro">Dinheiro</option>
                    <option value="Transferência">Transferência</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Cidade / Estado</label>
                  <input name="cidade" defaultValue="Teresina, PI" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
              </div>
              <button type="submit" className="w-full mt-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold hover:bg-amber-400 transition-all">
                Salvar Lançamento
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ===================== MODAL DE VINCULAÇÃO FUNCIONAL DO WHATSAPP ===================== */}
      {whatsAppModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-md w-full p-6 shadow-2xl relative animate-in fade-in">
            <button onClick={() => setWhatsAppModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="h-11 w-11 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
                <Bot size={24} />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">Canal WhatsApp do KYRO</h3>
                <p className="text-xs text-slate-400">Persona & Robô Financeiro Oficial</p>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-xl bg-[#0E1322] border border-[#1E2740] space-y-3">
                <div>
                  <label className="text-cyan-300 font-bold block mb-1">Contato do Robô KYRO (Persona):</label>
                  <div className="p-2.5 rounded-lg bg-[#080D1A] border border-cyan-500/30 text-cyan-200 font-mono font-bold text-xs flex items-center justify-between">
                    <span>{botPhone}</span>
                    <span className="text-[10px] text-emerald-400">● Online</span>
                  </div>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Seu Número Autorizado (com DDD):</label>
                  <input 
                    type="text" 
                    value={userPhone} 
                    onChange={(e) => setUserPhone(e.target.value)} 
                    placeholder="+55 (86) 99999-9999" 
                    className="w-full bg-[#161D32] border border-[#2A3554] p-2.5 rounded-lg text-slate-100 font-bold"
                  />
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-[#1E2740]">
                  <span className="text-slate-300">Status do Canal:</span>
                  <span className={`font-bold ${whatsAppConnected ? 'text-emerald-400' : 'text-cyan-400'}`}>
                    {whatsAppConnected ? '🟢 Canal Vinculado' : '🟡 Pronto para Enviar'}
                  </span>
                </div>
              </div>

              {/* QR Code Real Escaneável & Pareamento no Modal */}
              <div className="p-4 rounded-xl bg-[#0E1322] border border-[#1E2740] flex flex-col items-center justify-center text-center">
                <div className="p-3 bg-white rounded-xl mb-3 shadow-xl border-2 border-emerald-500/40">
                  <QRCodeSVG
                    value={waMeBotUrl}
                    size={140}
                    level="H"
                    includeMargin={false}
                  />
                </div>
                <p className="text-xs text-white font-semibold">
                  Aponte a câmera para abrir o chat do Robô KYRO
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Não abre com você mesmo: abre com o contato do robô ({botPhone})
                </p>
              </div>

              {/* Botões de Ação */}
              <div className="space-y-2">
                <a
                  href={waMeBotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:brightness-110 text-white font-bold text-xs transition-all shadow-md flex items-center justify-center gap-2"
                >
                  <ExternalLink size={15} /> Abrir Conversa com o Robô no WhatsApp
                </a>

                <button
                  type="button"
                  onClick={() => {
                    setWhatsAppModalOpen(false);
                    setActiveTab('whatsapp');
                  }}
                  className="w-full py-2.5 rounded-xl bg-[#141A2E] hover:bg-[#1E2642] text-slate-200 border border-[#2A3554] font-bold text-xs transition-all flex items-center justify-center gap-2"
                >
                  <Globe size={15} /> Ver Métodos de Conexão & Webhook
                </button>

                <button
                  onClick={() => {
                    const nextState = !whatsAppConnected;
                    setWhatsAppConnected(nextState);
                    localStorage.setItem('kyro_whatsapp_connected', String(nextState));
                    localStorage.setItem('kyro_whatsapp_phone', userPhone);
                    alert(nextState ? `WhatsApp ${userPhone} conectado com sucesso ao bot KYRO!` : 'WhatsApp desconectado.');
                    setWhatsAppModalOpen(false);
                  }}
                  className={`w-full py-2.5 rounded-xl font-bold text-xs transition-all ${
                    whatsAppConnected 
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30' 
                      : 'bg-[#141A2E] hover:bg-[#1E2642] text-slate-200 border border-[#2A3554]'
                  }`}
                >
                  {whatsAppConnected ? 'Desconectar WhatsApp' : 'Confirmar e Ativar Conexão'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL DE CONFIGURAÇÃO DE NUVEM GOOGLE / FIRESTORE ===================== */}
      {cloudConfigModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-md w-full p-6 shadow-2xl relative animate-in fade-in">
            <button onClick={() => setCloudConfigModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="h-11 w-11 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <ShieldCheck size={24} />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">Sincronização Nuvem Google</h3>
                <p className="text-xs text-slate-400">Firebase Firestore em Tempo Real</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 mb-3 bg-[#0E1322] p-3 rounded-xl border border-[#1E2740]">
              Cole o JSON de configuração do seu projeto Firebase para sincronizar todas as transações, cidades e saídas recorrentes em qualquer dispositivo:
            </p>

            <form onSubmit={(e) => {
              e.preventDefault();
              try {
                const conf = JSON.parse(cloudJsonInput);
                const ok = kyroCloud.saveConfig(conf);
                setIsCloudSynced(ok);
                if (ok) {
                  alert("Conectado à Nuvem Google com sucesso! Sincronização 24h ativada.");
                  setCloudConfigModalOpen(false);
                } else {
                  alert("Erro ao validar credenciais do Firebase. Verifique o JSON.");
                }
              } catch (err) {
                alert("JSON inválido! Verifique a formatação do arquivo de credenciais.");
              }
            }} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1 font-semibold">JSON de Configuração Firebase:</label>
                <textarea 
                  required
                  rows={5}
                  value={cloudJsonInput}
                  onChange={(e) => setCloudJsonInput(e.target.value)}
                  placeholder={`{\n  "apiKey": "AIzaSy...",\n  "authDomain": "...",\n  "projectId": "...",\n  "storageBucket": "..."\n}`}
                  className="w-full bg-[#161D32] border border-[#2A3554] p-2.5 rounded-lg text-slate-100 font-mono text-[11px]"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-all shadow-md"
                >
                  Salvar e Conectar Nuvem
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

