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
  LogOut,
  Plus,
  TrendingUp,
  Wallet,
  Menu,
  X
} from 'lucide-react';
import { Transaction, ChatMessage, PaymentMethod } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'transacoes' | 'orcamentos' | 'mapa' | 'relatorios' | 'configuracoes'>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [chatOpenMobile, setChatOpenMobile] = useState(false);
  
  // Perfil do Usuário
  const userName = "Wisterly";

  // Transações iniciais exemplares (baseadas no seu mockup real e dados de teste)
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
      amount: 180.00,
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
      subcategory: 'Investimento / Pro-labore',
      city: 'Teresina, PI',
      amount: 5000.00,
      type: 'Entrada',
      method: 'PIX',
      date: '05 Out',
      status: 'Concluído'
    }
  ]);

  // Mensagens do Assistente IA
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'ia',
      text: `Olá, ${userName}! Como posso te ajudar com o seu controle financeiro hoje?`,
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

    // Resposta inteligente simulada (conectada futuramente à API)
    setTimeout(() => {
      let reply = `Entendido, ${userName}! Processei a sua solicitação com sucesso.`;
      const lower = promptText.toLowerCase();

      if (lower.includes('pix') || lower.includes('gastei')) {
        reply = `Analisando seus gastos em PIX: Você acumula R$ ${pixTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em PIX neste mês, distribuídos principalmente em Alimentação e Serviços.`;
      } else if (lower.includes('cidade') || lower.includes('teresina')) {
        reply = `Você realizou 70% das suas transações em Teresina, PI, somando R$ 1.890,00 no mês.`;
      } else if (lower.includes('salvar') || lower.includes('comprei') || lower.includes('paguei')) {
        reply = `Transação identificada e organizada! Registrei o valor e atualizei seu dashboard instantaneamente.`;
      }

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        sender: 'ia',
        text: reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    }, 800);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0A0E1A] text-slate-100">
      
      {/* ===================== SIDEBAR LATERAL ESQUERDA ===================== */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-[#0F1424] border-r border-slate-800/80 flex flex-col justify-between transition-transform duration-300 ease-in-out
        md:static md:translate-x-0 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Topo Sidebar: Logo Kyro */}
        <div>
          <div className="p-6 pb-8 border-b border-slate-800/60 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img 
                src="/kyro-logo.png" 
                alt="KYRO Private Finance" 
                className="h-10 w-auto object-contain drop-shadow-[0_0_12px_rgba(217,119,6,0.3)]" 
              />
            </div>
            <button 
              onClick={() => setMobileMenuOpen(false)}
              className="md:hidden text-slate-400 hover:text-white"
            >
              <X size={20} />
            </button>
          </div>

          {/* Menus de Navegação */}
          <nav className="p-4 space-y-1.5 mt-2">
            <button
              onClick={() => { setActiveTab('dashboard'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'dashboard'
                  ? 'bg-gradient-to-r from-amber-500/20 to-amber-600/10 text-amber-400 border border-amber-500/30 shadow-[0_0_20px_rgba(217,119,6,0.15)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <LayoutDashboard size={19} className={activeTab === 'dashboard' ? 'text-amber-400' : 'text-slate-400'} />
              Dashboard
            </button>

            <button
              onClick={() => { setActiveTab('transacoes'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'transacoes'
                  ? 'bg-gradient-to-r from-amber-500/20 to-amber-600/10 text-amber-400 border border-amber-500/30 shadow-[0_0_20px_rgba(217,119,6,0.15)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <ArrowLeftRight size={19} className={activeTab === 'transacoes' ? 'text-amber-400' : 'text-slate-400'} />
              Transações
            </button>

            <button
              onClick={() => { setActiveTab('orcamentos'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'orcamentos'
                  ? 'bg-gradient-to-r from-amber-500/20 to-amber-600/10 text-amber-400 border border-amber-500/30 shadow-[0_0_20px_rgba(217,119,6,0.15)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <PieChart size={19} className={activeTab === 'orcamentos' ? 'text-amber-400' : 'text-slate-400'} />
              Orçamentos
            </button>

            <button
              onClick={() => { setActiveTab('mapa'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'mapa'
                  ? 'bg-gradient-to-r from-amber-500/20 to-amber-600/10 text-amber-400 border border-amber-500/30 shadow-[0_0_20px_rgba(217,119,6,0.15)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <MapPin size={19} className={activeTab === 'mapa' ? 'text-amber-400' : 'text-slate-400'} />
              Mapa de Gastos
            </button>

            <button
              onClick={() => { setActiveTab('relatorios'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'relatorios'
                  ? 'bg-gradient-to-r from-amber-500/20 to-amber-600/10 text-amber-400 border border-amber-500/30 shadow-[0_0_20px_rgba(217,119,6,0.15)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <FileText size={19} className={activeTab === 'relatorios' ? 'text-amber-400' : 'text-slate-400'} />
              Relatórios
            </button>

            <button
              onClick={() => { setActiveTab('configuracoes'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'configuracoes'
                  ? 'bg-gradient-to-r from-amber-500/20 to-amber-600/10 text-amber-400 border border-amber-500/30 shadow-[0_0_20px_rgba(217,119,6,0.15)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Settings size={19} className={activeTab === 'configuracoes' ? 'text-amber-400' : 'text-slate-400'} />
              Configurações
            </button>
          </nav>
        </div>

        {/* Rodapé da Sidebar: Perfil do Wisterly */}
        <div className="p-4 border-t border-slate-800/80">
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/60 hover:border-slate-700/80 transition-all cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center font-bold text-slate-950 shadow-md">
                W
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-100 leading-none">{userName}</p>
                <p className="text-[11px] font-medium text-amber-400/90 mt-1">Conta Conectada</p>
              </div>
            </div>
            <button className="text-slate-400 hover:text-slate-200 p-1">
              <MoreVertical size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* ===================== ÁREA PRINCIPAL CENTRAL ===================== */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        
        {/* Barra Superior / Header */}
        <header className="sticky top-0 z-20 bg-[#0A0E1A]/90 backdrop-blur-md px-6 md:px-8 py-5 border-b border-slate-800/50 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden text-slate-400 hover:text-white p-2 rounded-lg bg-slate-800/60"
            >
              <Menu size={20} />
            </button>
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                Olá, <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-200">{userName}</span>
              </h1>
              <p className="text-xs text-slate-400 hidden sm:block mt-0.5">Visão geral do seu patrimônio e despesas</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Campo de Busca */}
            <div className="relative hidden sm:block w-64 md:w-80">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar despesa, cidade..."
                className="w-full bg-[#13192B] border border-slate-800/90 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/40 transition-all"
              />
            </div>

            {/* Notificações */}
            <button className="relative p-2.5 rounded-xl bg-[#13192B] border border-slate-800 text-slate-400 hover:text-amber-400 hover:border-slate-700 transition-all">
              <Bell size={18} />
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]"></span>
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

        {/* Conteúdo do Dashboard */}
        <div className="p-6 md:p-8 space-y-6 max-w-7xl">
          
          {/* ================= CARDS DE INDICADORES (KPIs) ================= */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
            
            {/* Saldo Total */}
            <div className="bg-[#11172A] p-5 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden group hover:border-amber-500/40 transition-all duration-300">
              <div className="absolute top-0 right-0 w-28 h-28 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition-all"></div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Saldo Total</p>
              <p className="text-2xl md:text-3xl font-extrabold text-amber-400 mt-2 tracking-tight">
                R$ {totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
              <div className="flex items-center gap-1.5 mt-3 text-[11px] text-emerald-400 font-medium">
                <TrendingUp size={13} />
                <span>+12.4% este mês</span>
              </div>
            </div>

            {/* Entradas (Mês) */}
            <div className="bg-[#11172A] p-5 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden group hover:border-emerald-500/30 transition-all duration-300">
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

            {/* Saídas (Mês) */}
            <div className="bg-[#11172A] p-5 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden group hover:border-orange-500/30 transition-all duration-300">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Saídas (Mês)</p>
                <div className="h-7 w-7 rounded-lg bg-orange-500/10 text-orange-400 flex items-center justify-center">
                  <ArrowDownRight size={17} />
                </div>
              </div>
              <p className="text-2xl font-bold text-slate-100 mt-2">
                R$ {monthExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-[11px] text-orange-400/90 mt-3 font-medium">Dentro do orçamento previsto</p>
            </div>

            {/* Métodos de Pagamento */}
            <div className="bg-[#11172A] p-5 rounded-2xl border border-slate-800 shadow-lg flex flex-col justify-between hover:border-slate-700 transition-all">
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

          {/* ================= GRÁFICOS: ANÁLISE DE FLUXO & CATEGORIAS ================= */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            
            {/* Gráfico 1: Análise de Fluxo (Entradas vs Saídas) */}
            <div className="lg:col-span-3 bg-[#11172A] p-6 rounded-2xl border border-slate-800 shadow-lg flex flex-col justify-between">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-100">Análise de Fluxo (Entradas vs Saídas)</h3>
                  <p className="text-xs text-slate-400">Evolução do ritmo financeiro diário</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5 text-amber-400 font-medium">
                    <span className="h-2 w-2 rounded-full bg-amber-400"></span> Entradas
                  </span>
                  <span className="flex items-center gap-1.5 text-orange-400 font-medium">
                    <span className="h-2 w-2 rounded-full bg-orange-500"></span> Saídas
                  </span>
                </div>
              </div>

              {/* Curvas ilustrativas em SVG com estética Glow idêntica ao design */}
              <div className="h-48 w-full relative flex items-center justify-center pt-2">
                <svg className="w-full h-full overflow-visible" viewBox="0 0 500 150" fill="none">
                  <defs>
                    <linearGradient id="amberGlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.0" />
                    </linearGradient>
                    <linearGradient id="orangeGlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#EA580C" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#EA580C" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Área sob a curva */}
                  <path 
                    d="M 0 110 Q 70 30, 140 80 T 280 40 T 420 70 T 500 30 L 500 150 L 0 150 Z" 
                    fill="url(#amberGlow)" 
                  />
                  {/* Linha Entradas */}
                  <path 
                    d="M 0 110 Q 70 30, 140 80 T 280 40 T 420 70 T 500 30" 
                    stroke="#F59E0B" 
                    strokeWidth="3" 
                    strokeLinecap="round" 
                    className="drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]" 
                  />

                  {/* Linha Saídas */}
                  <path 
                    d="M 0 90 Q 90 140, 180 60 T 320 110 T 450 60 T 500 95" 
                    stroke="#EA580C" 
                    strokeWidth="2.5" 
                    strokeLinecap="round" 
                    className="drop-shadow-[0_0_8px_rgba(234,88,12,0.5)]" 
                  />
                </svg>
              </div>

              <div className="flex justify-between text-[11px] text-slate-500 pt-3 border-t border-slate-800/80">
                <span>01 Out</span>
                <span>05 Out</span>
                <span>10 Out</span>
                <span>15 Out</span>
                <span>20 Out</span>
                <span>25 Out</span>
                <span>Hoje</span>
              </div>
            </div>

            {/* Gráfico 2: Categorias de Gastos (Donut Chart) */}
            <div className="lg:col-span-2 bg-[#11172A] p-6 rounded-2xl border border-slate-800 shadow-lg flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-100">Categorias de Gastos</h3>
                <p className="text-xs text-slate-400">Distribuição percentual deste mês</p>
              </div>

              <div className="flex items-center justify-center my-3 gap-6">
                {/* SVG Donut Chart estilizado */}
                <div className="relative h-32 w-32 flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#1E293B" strokeWidth="4" />
                    {/* Segmento 1: Alimentação (Laranja âmbar) */}
                    <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#F59E0B" strokeWidth="4.5" strokeDasharray="40 60" strokeDashoffset="0" />
                    {/* Segmento 2: Vestuário (Dourado escuro) */}
                    <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#B45309" strokeWidth="4.5" strokeDasharray="25 75" strokeDashoffset="-40" />
                    {/* Segmento 3: Serviços (Azul petróleo / slate) */}
                    <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#38BDF8" strokeWidth="4.5" strokeDasharray="20 80" strokeDashoffset="-65" />
                    {/* Segmento 4: Outros */}
                    <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#E2E8F0" strokeWidth="4.5" strokeDasharray="15 85" strokeDashoffset="-85" />
                  </svg>
                  <div className="absolute flex flex-col items-center">
                    <span className="text-xs font-bold text-slate-200">100%</span>
                    <span className="text-[9px] text-slate-500 uppercase">Total</span>
                  </div>
                </div>

                {/* Legendas das Categorias */}
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
                    <span className="text-slate-300">Alimentação (Padaria/Comida)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-700"></span>
                    <span className="text-slate-300">Vestuário (Roupa/Calçado)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-sky-400"></span>
                    <span className="text-slate-300">Serviços</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-300"></span>
                    <span className="text-slate-300">Transporte</span>
                  </div>
                </div>
              </div>

              <div className="text-center pt-2 border-t border-slate-800/80">
                <span className="text-[11px] text-amber-400/90 font-medium">Alimentação representa o maior volume</span>
              </div>
            </div>

          </div>

          {/* ================= TABELA: ÚLTIMAS TRANSAÇÕES ================= */}
          <div className="bg-[#11172A] p-6 rounded-2xl border border-slate-800 shadow-lg">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-bold text-slate-100">Últimas Transações</h3>
                <p className="text-xs text-slate-400">Detalhamento por estabelecimento, categoria, cidade e método</p>
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
                  <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="pb-3 pl-2">Estabelecimento / Item</th>
                    <th className="pb-3 text-center">Método</th>
                    <th className="pb-3 text-right">Data</th>
                    <th className="pb-3 text-right pr-2">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-sm">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-800/30 transition-colors group">
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

        </div>
      </main>

      {/* ===================== SIDEBAR DIREITA: ASSISTENTE IA ===================== */}
      <aside className={`
        fixed inset-y-0 right-0 z-40 w-80 lg:w-96 bg-[#0E1322] border-l border-slate-800/80 flex flex-col justify-between transition-transform duration-300 ease-in-out
        lg:static lg:translate-x-0 ${chatOpenMobile ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
      `}>
        {/* Topo do Assistente */}
        <div className="p-5 border-b border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.2)]">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Assistente IA</h3>
              <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span> Online & Pronto
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

        {/* Mensagens do Chat */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3.5">
          {messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div className={`max-w-[88%] p-3.5 rounded-2xl text-xs leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-gradient-to-r from-amber-600 to-amber-700 text-white rounded-tr-none shadow-md'
                  : 'bg-[#151C30] border border-slate-800 text-slate-200 rounded-tl-none shadow-sm'
              }`}>
                {msg.text}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 px-1">{msg.timestamp}</span>
            </div>
          ))}
        </div>

        {/* Barra de Digitação e Ações Multimodais */}
        <div className="p-4 border-t border-slate-800/60 bg-[#0A0E1A]/80">
          <div className="flex items-center gap-2 bg-[#13192B] border border-slate-800 rounded-xl px-3 py-2 focus-within:border-amber-500/50 transition-all">
            <button title="Enviar áudio" className="text-slate-400 hover:text-amber-400 transition-colors p-1">
              <Mic size={16} />
            </button>
            <button title="Enviar foto de comprovante" className="text-slate-400 hover:text-amber-400 transition-colors p-1">
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
              className="p-1.5 rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 transition-colors shadow-sm font-bold"
            >
              <Send size={14} />
            </button>
          </div>
          <p className="text-[10px] text-center text-slate-500 mt-2">
            Compatível com áudio, prints e comandos via WhatsApp
          </p>
        </div>
      </aside>

    </div>
  );
}
