import React, { useState } from 'react';
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
  Maximize2
} from 'lucide-react';
import { Transaction, ChatMessage, PaymentMethod } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'transacoes' | 'orcamentos' | 'mapa' | 'relatorios' | 'configuracoes'>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [chatOpenMobile, setChatOpenMobile] = useState(false);
  
  // Modais interativos para elementos clicáveis
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [activeKpiModal, setActiveKpiModal] = useState<'saldo' | 'entradas' | 'saidas' | 'metodos' | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [filterMethod, setFilterMethod] = useState<string>('todos');
  const [newTxModalOpen, setNewTxModalOpen] = useState(false);

  // Perfil do Usuário baseado fielmente na imagem
  const userFullName = "Kayro Wisterly";
  const userFirstName = "Wisterly";

  // Transações baseadas na imagem
  const [transactions, setTransactions] = useState<Transaction[]>([
    {
      id: '1',
      description: 'Padaria Bella Vista',
      category: 'Alimentação',
      subcategory: 'Padaria & Comida',
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
      subcategory: 'Centro',
      city: 'Teresina, PI',
      amount: 190.00,
      type: 'Saída',
      method: 'Débito',
      date: '11 Out',
      status: 'Concluído'
    },
    {
      id: '3',
      description: 'Assinatura Software',
      category: 'Serviços',
      subcategory: 'Online',
      city: 'São Paulo, SP',
      amount: 59.90,
      type: 'Saída',
      method: 'PIX',
      date: '10 Out',
      status: 'Concluído'
    },
    {
      id: '4',
      description: 'Rendimento mensal',
      category: 'Recebimento',
      subcategory: 'Recebimento / Pró-labore',
      city: 'Teresina, PI',
      amount: 5000.00,
      type: 'Entrada',
      method: 'PIX',
      date: '05 Out',
      status: 'Concluído'
    }
  ]);

  // Mensagens do Assistente IA da imagem
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'ia',
      text: `Olá, ${userFirstName}! Como posso te ajudar com seu controle financeiro hoje?`,
      timestamp: '20:15'
    },
    {
      id: '2',
      sender: 'user',
      text: 'Quanto gastei em PIX com comida e padaria este mês?',
      timestamp: '20:16'
    },
    {
      id: '3',
      sender: 'ia',
      text: 'Você gastou R$ 342,50 em PIX nas categorias de Alimentação e Padaria este mês. A maior parte foi na "Padaria Bella Vista".',
      timestamp: '20:16'
    }
  ]);

  const [inputMessage, setInputMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Cálculos dinâmicos
  const totalBalance = 15420.50;
  const monthIncomes = 6300.00;
  const monthExpenses = 4120.30;
  const pixTotal = 2450.00;
  const debitTotal = 1670.30;

  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: inputMessage,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    const promptText = inputMessage;
    setInputMessage('');

    setTimeout(() => {
      let reply = `Entendido, ${userFirstName}!`;
      const lower = promptText.toLowerCase();

      if (lower.includes('pix') || lower.includes('gastei')) {
        reply = `Analisando seus gastos: você acumula R$ ${pixTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em PIX neste mês, principalmente com Alimentação e Serviços.`;
      } else if (lower.includes('teresina') || lower.includes('cidade')) {
        reply = `Você realizou transações totalizando R$ 2.450,00 na cidade de Teresina, PI neste mês.`;
      } else if (lower.includes('saldo') || lower.includes('conta')) {
        reply = `Seu saldo consolidado atual é de R$ ${totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`;
      } else {
        reply = `Informação registrada com sucesso no seu painel KYRO Private Finance!`;
      }

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        sender: 'ia',
        text: reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    }, 800);
  };

  // Filtragem de transações
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
          {/* Logo KYRO | Private Finance preenchendo o espaço disponível perfeitamente */}
          <div className="px-4 pt-6 pb-2 flex items-center justify-between">
            <div className="flex items-center cursor-pointer w-full" onClick={() => setActiveTab('dashboard')}>
              <img 
                src="/kyro-cropped.png" 
                alt="KYRO Private Finance" 
                className="w-full h-auto max-h-24 object-contain filter drop-shadow-[0_2px_16px_rgba(217,119,6,0.3)] transition-transform duration-200" 
              />
            </div>
            <button 
              onClick={() => setMobileMenuOpen(false)}
              className="md:hidden text-slate-400 hover:text-white ml-1"
            >
              <X size={20} />
            </button>
          </div>

          {/* Menus de Navegação com Glow Laranja/Âmbar */}
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
            {/* Campo de Busca Funcional */}
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

            {/* Notificações Clicável */}
            <button 
              onClick={() => setNotificationsOpen(true)}
              className="relative p-2.5 rounded-xl bg-[#12172A] border border-[#202940] text-slate-400 hover:text-amber-400 hover:border-amber-500/40 transition-all"
            >
              <Bell size={18} />
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]"></span>
            </button>

            {/* Botão Nova Transação */}
            <button 
              onClick={() => setNewTxModalOpen(true)}
              className="hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold text-xs shadow-md shadow-amber-500/20 hover:brightness-110 transition-all"
            >
              <Plus size={16} />
              Novo Lançamento
            </button>

            {/* Botão Assistente IA no Celular */}
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
          
          {/* ABA 1: DASHBOARD (Principal da Imagem) */}
          {activeTab === 'dashboard' && (
            <>
              {/* ================= CARDS DE INDICADORES (KPIs) CLICÁVEIS ================= */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
                
                {/* 1. Saldo Total (com Glow Âmbar Forte como na imagem) */}
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
                    <span>+12.4% este mês • Clique para detalhes</span>
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
                  <p className="text-[11px] text-slate-500 mt-3 font-medium">Previsão atingida em 92%</p>
                </div>

                {/* 3. Saídas (Mês) */}
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
                  <p className="text-[11px] text-orange-400/90 mt-3 font-medium">Dentro do limite planejado</p>
                </div>

                {/* 4. Métodos de Pagamento */}
                <div 
                  onClick={() => setActiveKpiModal('metodos')}
                  className="bg-[#111628] p-5 rounded-2xl border border-[#202940] shadow-lg flex flex-col justify-between cursor-pointer hover:border-amber-500/40 hover:scale-[1.01] transition-all"
                >
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Métodos de Pagamento</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">PIX: <strong className="text-slate-200">R$ {pixTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">PIX</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-medium">Débito: <strong className="text-slate-200">R$ {debitTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/15 text-orange-400 border border-orange-500/30">Débito</span>
                    </div>
                  </div>
                </div>

              </div>

              {/* ================= GRÁFICOS: FLUXO SANKEY & CATEGORIAS ================= */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                
                {/* Gráfico 1: Análise de Fluxo (Sankey Flow) com Efeito Glow Dourado */}
                <div className="lg:col-span-3 bg-[#111628] p-6 rounded-2xl border-2 border-amber-500/60 shadow-[0_0_25px_rgba(245,158,11,0.18)] flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="text-base font-bold text-slate-100">Análise de Fluxo (Sankey)</h3>
                      <p className="text-xs text-slate-400">Rastreamento dinâmico: Origem ➔ Métodos ➔ Categorias & Cidades</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                      Dinâmico
                    </span>
                  </div>

                  {/* Diagrama de Sankey estilizado fielmente com curvas interligadas */}
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

                      {/* Fluxos conectados (Sankey Ribbon) */}
                      {/* Salário -> PIX */}
                      <path d="M 60 50 C 140 50, 180 80, 240 80" stroke="url(#streamGold)" strokeWidth="18" strokeOpacity="0.65" fill="none" />
                      {/* Extras -> Débito */}
                      <path d="M 60 130 C 140 130, 180 110, 240 110" stroke="url(#streamOrange)" strokeWidth="14" strokeOpacity="0.65" fill="none" />
                      
                      {/* PIX -> Padaria */}
                      <path d="M 270 80 C 330 80, 360 40, 420 40" stroke="#F59E0B" strokeWidth="12" strokeOpacity="0.7" fill="none" />
                      {/* PIX -> Roupa */}
                      <path d="M 270 80 C 330 80, 360 80, 420 80" stroke="#D97706" strokeWidth="10" strokeOpacity="0.6" fill="none" />
                      {/* Débito -> Serviços */}
                      <path d="M 270 110 C 330 110, 360 120, 420 120" stroke="#EA580C" strokeWidth="9" strokeOpacity="0.6" fill="none" />
                      {/* Débito -> Teresina, PI */}
                      <path d="M 270 110 C 330 110, 360 155, 420 155" stroke="#F59E0B" strokeWidth="11" strokeOpacity="0.75" fill="none" />

                      {/* Coluna 1: Entradas */}
                      <rect x="50" y="35" width="8" height="30" rx="3" fill="#3B82F6" />
                      <text x="45" y="25" fill="#94A3B8" fontSize="10" fontWeight="bold">Entradas</text>
                      <text x="45" y="80" fill="#CBD5E1" fontSize="10">Salário</text>

                      <rect x="50" y="115" width="8" height="30" rx="3" fill="#10B981" />
                      <text x="45" y="160" fill="#CBD5E1" fontSize="10">Extras</text>

                      {/* Coluna 2: Métodos */}
                      <text x="235" y="25" fill="#94A3B8" fontSize="10" fontWeight="bold">Métodos</text>
                      <rect x="250" y="65" width="8" height="30" rx="3" fill="#F59E0B" />
                      <text x="245" y="58" fill="#FDE68A" fontSize="10" fontWeight="bold">PIX</text>

                      <rect x="250" y="98" width="8" height="25" rx="3" fill="#EA580C" />
                      <text x="242" y="137" fill="#FED7AA" fontSize="10">Débito</text>

                      {/* Coluna 3: Categorias e Cidades */}
                      <text x="420" y="20" fill="#94A3B8" fontSize="10" fontWeight="bold">Categorias</text>
                      <rect x="425" y="30" width="8" height="20" rx="3" fill="#F59E0B" />
                      <text x="440" y="44" fill="#CBD5E1" fontSize="10">Padaria</text>

                      <rect x="425" y="70" width="8" height="20" rx="3" fill="#D97706" />
                      <text x="440" y="84" fill="#CBD5E1" fontSize="10">Roupa</text>

                      <rect x="425" y="110" width="8" height="20" rx="3" fill="#EA580C" />
                      <text x="440" y="124" fill="#CBD5E1" fontSize="10">Serviços</text>

                      <text x="420" y="145" fill="#94A3B8" fontSize="10" fontWeight="bold">Localizações</text>
                      <rect x="425" y="150" width="8" height="15" rx="3" fill="#F59E0B" />
                      <text x="440" y="162" fill="#FCD34D" fontSize="10">Teresina, PI</text>
                    </svg>
                  </div>

                  <div className="flex justify-between items-center text-[11px] text-slate-400 pt-3 border-t border-[#1E2740]">
                    <span>Rastreabilidade em tempo real de cada centavo</span>
                    <button onClick={() => setActiveTab('transacoes')} className="text-amber-400 hover:underline">Ver fluxo detalhado</button>
                  </div>
                </div>

                {/* Gráfico 2: Categorias de Gastos (Donut Chart) */}
                <div className="lg:col-span-2 bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg flex flex-col justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">Categorias de Gastos</h3>
                    <p className="text-xs text-slate-400">Distribuição percentual deste mês</p>
                  </div>

                  <div className="flex items-center justify-center my-3 gap-6">
                    {/* SVG Donut Chart estilizado */}
                    <div className="relative h-32 w-32 flex items-center justify-center">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#1E293B" strokeWidth="4" />
                        <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#F59E0B" strokeWidth="4.5" strokeDasharray="40 60" strokeDashoffset="0" />
                        <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#B45309" strokeWidth="4.5" strokeDasharray="25 75" strokeDashoffset="-40" />
                        <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#38BDF8" strokeWidth="4.5" strokeDasharray="20 80" strokeDashoffset="-65" />
                        <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#E2E8F0" strokeWidth="4.5" strokeDasharray="15 85" strokeDashoffset="-85" />
                      </svg>
                      <div className="absolute flex flex-col items-center">
                        <span className="text-xs font-bold text-slate-200">100%</span>
                        <span className="text-[9px] text-slate-500 uppercase">Total</span>
                      </div>
                    </div>

                    {/* Legendas das Categorias */}
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-2 cursor-pointer hover:text-amber-400" onClick={() => setFilterMethod('Alimentação')}>
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
                        <span className="text-slate-300">Alimentação (Padaria & Comida)</span>
                      </div>
                      <div className="flex items-center gap-2 cursor-pointer hover:text-amber-400" onClick={() => setFilterMethod('Vestuário')}>
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-700"></span>
                        <span className="text-slate-300">Vestuário (Roupa/Calçado)</span>
                      </div>
                      <div className="flex items-center gap-2 cursor-pointer hover:text-amber-400" onClick={() => setFilterMethod('Serviços')}>
                        <span className="h-2.5 w-2.5 rounded-full bg-sky-400"></span>
                        <span className="text-slate-300">Serviços</span>
                      </div>
                      <div className="flex items-center gap-2 cursor-pointer hover:text-amber-400" onClick={() => setFilterMethod('Transporte')}>
                        <span className="h-2.5 w-2.5 rounded-full bg-slate-300"></span>
                        <span className="text-slate-300">Transporte</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-center pt-2 border-t border-[#1E2740]">
                    <span className="text-[11px] text-amber-400/90 font-medium">Alimentação representa o maior volume</span>
                  </div>
                </div>

              </div>

              {/* ================= TABELA: ÚLTIMAS TRANSAÇÕES ================= */}
              <div className="bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">Últimas Transações</h3>
                    <p className="text-xs text-slate-400">Clique em qualquer item para ver recibo e detalhes completos</p>
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
                      {filteredTransactions.map((tx) => (
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
                                {tx.category === 'Alimentação' ? '🍞' : tx.category === 'Vestuário' ? '👟' : tx.category === 'Serviços' ? '💳' : '💰'}
                              </div>
                              <div>
                                <p className="font-semibold text-slate-100 group-hover:text-amber-300 transition-colors">{tx.description}</p>
                                <p className="text-xs text-slate-400">{tx.category} • <span className="text-slate-500">{tx.city}</span></p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 text-center">
                            <span className={`inline-block px-2.5 py-1 rounded text-[11px] font-bold border ${
                              tx.method === 'PIX'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
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
                            {tx.type === 'Entrada' ? '+' : '-'} R$ {tx.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
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
                  <p className="text-xs text-slate-400">Filtragem avançada por método de pagamento, data e localidade</p>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setFilterMethod('todos')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${filterMethod === 'todos' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-[#182038] text-slate-300'}`}
                  >
                    Todos
                  </button>
                  <button 
                    onClick={() => setFilterMethod('pix')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${filterMethod === 'pix' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-[#182038] text-slate-300'}`}
                  >
                    Somente PIX
                  </button>
                  <button 
                    onClick={() => setFilterMethod('débito')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${filterMethod === 'débito' ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-[#182038] text-slate-300'}`}
                  >
                    Somente Débito
                  </button>
                  <button 
                    onClick={() => setNewTxModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all ml-2"
                  >
                    <Plus size={15} /> Adicionar
                  </button>
                </div>
              </div>

              {/* Tabela de Transações */}
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
                        <td className="py-3.5 pl-2 font-semibold text-slate-100">{tx.description}</td>
                        <td className="py-3.5 text-slate-300 text-xs">{tx.category}</td>
                        <td className="py-3.5 text-slate-400 text-xs">{tx.city}</td>
                        <td className="py-3.5 text-center">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            {tx.method}
                          </span>
                        </td>
                        <td className="py-3.5 text-right text-xs text-slate-400">{tx.date}</td>
                        <td className={`py-3.5 text-right pr-2 font-bold ${tx.type === 'Entrada' ? 'text-emerald-400' : 'text-orange-400'}`}>
                          {tx.type === 'Entrada' ? '+' : '-'} R$ {tx.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ABA 3: ORÇAMENTOS */}
          {activeTab === 'orcamentos' && (
            <div className="bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white">Metas & Tetos de Orçamento</h2>
                <p className="text-xs text-slate-400">A IA monitora quando você está perto de atingir o limite estipulado</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="p-5 rounded-xl bg-[#141A2E] border border-[#222C46]">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-sm text-slate-200">Alimentação & Padaria</span>
                    <span className="text-xs text-amber-400 font-bold">R$ 342,50 / R$ 800,00</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                    <div className="bg-gradient-to-r from-amber-500 to-orange-500 h-full rounded-full w-[43%]"></div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">43% consumido • Dentro da meta mensal</p>
                </div>

                <div className="p-5 rounded-xl bg-[#141A2E] border border-[#222C46]">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-sm text-slate-200">Vestuário & Calçados</span>
                    <span className="text-xs text-orange-400 font-bold">R$ 190,00 / R$ 400,00</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                    <div className="bg-gradient-to-r from-orange-500 to-amber-500 h-full rounded-full w-[47%]"></div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">47% consumido • Dentro da meta mensal</p>
                </div>
              </div>
            </div>
          )}

          {/* ABA 4: MAPA DE GASTOS */}
          {activeTab === 'mapa' && (
            <div className="bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white">Geolocalização dos Gastos</h2>
                <p className="text-xs text-slate-400">Identificação das cidades e regiões com maior movimentação financeira</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-5 rounded-xl bg-[#141A2E] border border-amber-500/30">
                  <div className="flex items-center gap-3">
                    <MapPin className="text-amber-400" size={24} />
                    <div>
                      <h4 className="font-bold text-slate-100">Teresina, PI</h4>
                      <p className="text-xs text-slate-400">R$ 3.820,00 gastos (85%)</p>
                    </div>
                  </div>
                </div>

                <div className="p-5 rounded-xl bg-[#141A2E] border border-[#222C46]">
                  <div className="flex items-center gap-3">
                    <MapPin className="text-sky-400" size={24} />
                    <div>
                      <h4 className="font-bold text-slate-100">São Paulo, SP</h4>
                      <p className="text-xs text-slate-400">R$ 59,90 gastos (Online)</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ABA 5: RELATÓRIOS */}
          {activeTab === 'relatorios' && (
            <div className="bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-white">Demonstrativo e Relatórios Financeiros</h2>
                  <p className="text-xs text-slate-400">Exportação consolidada dos seus números</p>
                </div>
                <button 
                  onClick={() => alert("Gerando relatório em PDF e enviando para sincronização...")}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400"
                >
                  <Download size={15} /> Baixar Relatório (PDF)
                </button>
              </div>

              <div className="p-5 rounded-xl bg-[#141A2E] border border-[#222C46] space-y-3">
                <h4 className="font-bold text-slate-200">Resumo Executivo do Mês (Outubro)</h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  • <strong>Total de Entradas:</strong> R$ 6.300,00<br/>
                  • <strong>Total de Saídas:</strong> R$ 4.120,30<br/>
                  • <strong>Resultado Líquido Positivo:</strong> +R$ 2.179,70<br/>
                  • <strong>Método Mais Utilizado:</strong> PIX (68% do volume movimentado)
                </p>
              </div>
            </div>
          )}

          {/* ABA 6: CONFIGURAÇÕES */}
          {activeTab === 'configuracoes' && (
            <div className="bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white">Configurações & Integrações</h2>
                <p className="text-xs text-slate-400">Conexão do WhatsApp, backup em nuvem e preferências do perfil</p>
              </div>

              <div className="space-y-4">
                <div className="p-5 rounded-xl bg-[#141A2E] border border-[#222C46] flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-slate-200">Integração WhatsApp Bot</h4>
                    <p className="text-xs text-slate-400">Permite enviar áudios, textos e fotos de comprovantes diretamente pelo WhatsApp</p>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    🟢 Conectado
                  </span>
                </div>

                <div className="p-5 rounded-xl bg-[#141A2E] border border-[#222C46] flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-slate-200">Login Google / Nuvem</h4>
                    <p className="text-xs text-slate-400">Sincronização 24h na conta de Kayro Wisterly</p>
                  </div>
                  <button 
                    onClick={() => setProfileModalOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40 text-xs font-bold hover:bg-amber-500/30"
                  >
                    Gerenciar Conta
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ===================== SIDEBAR DIREITA: ASSISTENTE IA ===================== */}
      <aside className={`
        fixed inset-y-0 right-0 z-40 w-80 lg:w-96 bg-[#0E1322] border-l border-[#1B2338] flex flex-col justify-between transition-transform duration-300 ease-in-out
        lg:static lg:translate-x-0 ${chatOpenMobile ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
      `}>
        {/* Topo do Assistente */}
        <div className="p-5 border-b border-[#1B2338]/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Assistente IA</h3>
              <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span> Conectado & Treinado
              </p>
            </div>
          </div>
          <button 
            onClick={() => setChatOpenMobile(false)}
            className="lg:hidden text-slate-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mensagens do Chat com Visual do Mockup */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3.5">
          {messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div className={`max-w-[88%] p-3.5 rounded-2xl text-xs leading-relaxed ${
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

        {/* Barra de Digitação e Ações Multimodais */}
        <div className="p-4 border-t border-[#1B2338]/80 bg-[#0A0D18]/90">
          <div className="flex items-center gap-2 bg-[#12172A] border border-[#202940] rounded-xl px-3 py-2 focus-within:border-amber-500/50 transition-all">
            <button 
              onClick={() => alert("Microfone ativado! Gravando áudio para transcrição e categorização...")}
              title="Gravar áudio" 
              className="text-slate-400 hover:text-amber-400 transition-colors p-1"
            >
              <Mic size={16} />
            </button>
            <button 
              onClick={() => alert("Selecione um print ou foto de comprovante PIX para a IA ler...")}
              title="Anexar foto de comprovante" 
              className="text-slate-400 hover:text-amber-400 transition-colors p-1"
            >
              <ImageIcon size={16} />
            </button>
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Pergunte ao assistente..."
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
            Compatível com áudio, prints e WhatsApp
          </p>
        </div>
      </aside>

      {/* ===================== MODAL DE DETALHES DA TRANSAÇÃO ===================== */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-md w-full p-6 shadow-2xl relative animate-in fade-in duration-200">
            <button 
              onClick={() => setSelectedTx(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X size={20} />
            </button>
            
            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-lg border border-amber-500/30">
                {selectedTx.category === 'Alimentação' ? '🍞' : selectedTx.category === 'Vestuário' ? '👟' : selectedTx.category === 'Serviços' ? '💳' : '💰'}
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
                onClick={() => setSelectedTx(null)}
                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-all shadow-md"
              >
                Fechar Detalhes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL DE INDICADORES (KPIs) ===================== */}
      {activeKpiModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button onClick={() => setActiveKpiModal(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={20} />
            </button>
            <h3 className="font-bold text-lg text-white mb-2">
              {activeKpiModal === 'saldo' && 'Detalhamento do Saldo Consolidado'}
              {activeKpiModal === 'entradas' && 'Detalhamento das Entradas do Mês'}
              {activeKpiModal === 'saidas' && 'Detalhamento das Saídas do Mês'}
              {activeKpiModal === 'metodos' && 'Detalhamento por Métodos de Pagamento'}
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Sincronizado automaticamente com todas as contas de Kayro Wisterly.
            </p>
            <div className="p-4 rounded-xl bg-[#0E1322] border border-[#1E2740] space-y-2 text-xs text-slate-300">
              <p>• Dados atualizados em tempo real via WhatsApp e entradas manuais.</p>
              <p>• Categorização automática assistida pelo modelo KYRO IA.</p>
            </div>
            <button onClick={() => setActiveKpiModal(null)} className="w-full mt-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs">
              Entendido
            </button>
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
                <p className="font-bold text-amber-300">Alerta de Lançamento PIX</p>
                <p className="text-slate-400 mt-1">Gasto de R$ 45,00 na Padaria Bella Vista catalogado com sucesso.</p>
              </div>
              <div className="p-3 rounded-xl bg-[#141A2E] border border-emerald-500/30">
                <p className="font-bold text-emerald-300">Meta do Mês Positiva</p>
                <p className="text-slate-400 mt-1">Suas despesas continuam abaixo das receitas deste mês.</p>
              </div>
            </div>
            <button onClick={() => setNotificationsOpen(false)} className="w-full mt-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold">
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* ===================== MODAL NOVO LANÇAMENTO ===================== */}
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
                <input required name="desc" placeholder="Ex: Farmácia, Posto..." className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Categoria</label>
                  <input required name="cat" placeholder="Ex: Alimentação" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Subcategoria</label>
                  <input name="subcat" placeholder="Ex: Remédios" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Valor (R$)</label>
                  <input required type="number" step="0.01" name="val" placeholder="0.00" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Tipo</label>
                  <select name="tipo" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100">
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

    </div>
  );
}
