import React, { useState, useEffect, useRef, useCallback } from 'react';
import { App as CapApp } from '@capacitor/app';
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
  Camera,
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
  Shield,
  Square,
  CheckSquare,
  Loader2
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Transaction, ChatMessage, PaymentMethod, TransactionType, RecurringExpense, CreditCardData } from './types';
import { kyroCloud } from './firebase';
import { WhatsAppTab } from './components/WhatsAppTab';
import { parseDynamicFinancialMessage } from './utils/financialParser';
import { processUploadedFinancialDocument } from './utils/documentExtractor';
import {
  isRemoveTransactionCommand,
  isRemoveLastCommand,
  isAdjustLastCommand,
  isEnrichLastCommand,
  executeSmartRemoveTransaction,
  executeRemoveLastTransaction,
  executeAdjustLastTransaction,
  executeEnrichLastTransaction,
  generateThinkingFinancialReply,
  searchTransactionsByTerm
} from './utils/aiCopilot';
import { UpdateModal, UpdateInfo } from './components/UpdateModal';
import { checkForAppUpdate, checkUpdateDetailed, getInstalledAppInfo, CURRENT_APP_BUILD, CURRENT_APP_VERSION } from './utils/appUpdater';

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'transacoes' | 'orcamentos' | 'mapa' | 'relatorios' | 'whatsapp' | 'configuracoes' | 'cartoes'>('dashboard');
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

  // Gestão de Cartões de Crédito e Faturas (100% Sincronizado e Persistente na Nuvem)
  const [creditCards, setCreditCards] = useState<CreditCardData[]>(() => {
    const saved = localStorage.getItem('kyro_credit_cards');
    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {}
    }
    // Novo dispositivo / App recém-instalado: inicia vazio e aguarda o pull da nuvem central (sem recriar dados deletados)
    return [];
  });

  useEffect(() => {
    localStorage.setItem('kyro_credit_cards', JSON.stringify(creditCards));
  }, [creditCards]);

  // Purga agressiva e definitiva de Service Worker e Caches legados em celulares e desktops
  useEffect(() => {
    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const reg of registrations) {
            reg.unregister().then(() => console.log('[PWA] Service Worker legado desregistrado.'));
          }
        });
      }
      if (typeof window !== 'undefined' && 'caches' in window) {
        caches.keys().then((names) => {
          for (const name of names) {
            caches.delete(name).then(() => console.log('[PWA] Cache antigo eliminado:', name));
          }
        });
      }
    } catch (e) {
      console.warn('[Cache Purge Info]:', e);
    }
  }, []);

  const [selectedCardId, setSelectedCardId] = useState<string>('todos');
  const [newCardModalOpen, setNewCardModalOpen] = useState(false);
  const [cartoesInnerTab, setCartoesInnerTab] = useState<'fatura' | 'recorrentes'>('fatura');

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
  const [whatsappSyncToast, setWhatsappSyncToast] = useState<{ show: boolean; text: string } | null>(null);

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

  // Base de Saídas Recorrentes & Parcelamentos (100% Sincronizado e Persistente na Nuvem)
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>(() => {
    const saved = localStorage.getItem('kyro_recurring');
    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {}
    }
    // Novo dispositivo / App recém-instalado: inicia vazio e aguarda o pull da nuvem central (sem recriar dados deletados)
    return [];
  });

  useEffect(() => {
    localStorage.setItem('kyro_recurring', JSON.stringify(recurringExpenses));
  }, [recurringExpenses]);

  // ==============================================================
  // REGISTRO PERMANENTE DE IDs EXCLUÍDOS (TOMBSTONES ANTILOOP)
  // Impede que qualquer transação deletada pelo usuário retorne via cache ou webhook
  // ==============================================================
  const [deletedTxIds, setDeletedTxIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('kyro_deleted_tx_ids');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const markTransactionsAsDeleted = (ids: (string | number)[]) => {
    setDeletedTxIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(String(id)));
      localStorage.setItem('kyro_deleted_tx_ids', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  // Base de Transações (Persistente e Fiel - Sem Mocks Engessados)
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem('kyro_transactions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const deletedRaw = localStorage.getItem('kyro_deleted_tx_ids');
          const deletedSet = deletedRaw ? new Set(JSON.parse(deletedRaw)) : new Set();
          const clean = parsed.filter((t: any) => t && t.id && !deletedSet.has(String(t.id)));
          return clean;
        }
      } catch (e) {}
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('kyro_transactions', JSON.stringify(transactions));
  }, [transactions]);

  // ==============================================================
  // BANCO DE DADOS CENTRALIZADO E UNIVERSAL DO KYRO FINANCE (24H)
  // Compartilhado automaticamente entre todos os Celulares, PCs e IPs
  // ==============================================================
  const syncSaveToCentralDb = async (tx: Transaction) => {
    try {
      // Se a transação foi salva/recriada, remove da lista de deletados
      setDeletedTxIds(prev => {
        if (!prev.has(String(tx.id))) return prev;
        const next = new Set(prev);
        next.delete(String(tx.id));
        localStorage.setItem('kyro_deleted_tx_ids', JSON.stringify(Array.from(next)));
        return next;
      });

      await fetch('/api/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_transaction', transaction: tx })
      });
    } catch (e) {
      console.warn('[Central DB Sync Error]:', e);
    }
  };

  const syncDeleteFromCentralDb = async (id: string) => {
    try {
      markTransactionsAsDeleted([id]);
      await fetch('/api/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_transaction', id: String(id) })
      });
    } catch (e) {
      console.warn('[Central DB Delete Error]:', e);
    }
  };

  const syncDeleteManyFromCentralDb = async (ids: string[]) => {
    try {
      markTransactionsAsDeleted(ids);
      await fetch('/api/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_transactions', ids: ids.map(String) })
      });
    } catch (e) {
      console.warn('[Central DB Delete Many Error]:', e);
    }
  };

  // Limpeza Completa e Definitiva de todas as Transações do Sistema
  const handleClearAllTransactions = async () => {
    if (window.confirm("⚠️ ATENÇÃO: Deseja realmente excluir TODOS os lançamentos e zerar o histórico? Esta ação é definitiva e sincronizará todos os dispositivos e a nuvem.")) {
      const allIds = transactions.map(t => String(t.id));
      markTransactionsAsDeleted(allIds);
      setTransactions([]);
      localStorage.setItem('kyro_transactions', '[]');
      setSelectedEntryIds(new Set());
      setSelectedExitIds(new Set());
      setSelectedTxTabIds(new Set());

      try {
        await fetch('/api/database', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'clear_all' })
        });
      } catch (e) {}

      setWhatsappSyncToast({
        show: true,
        text: '🗑️ Todos os lançamentos foram excluídos com sucesso!'
      });
      setTimeout(() => setWhatsappSyncToast(null), 4000);
    }
  };

  // Sincronização Universal de Cartões de Crédito e Dívidas Recorrentes na Nuvem (Persistente)
  const syncSaveCreditCardsToCentralDb = async (cards: CreditCardData[]) => {
    try {
      await fetch('/api/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_credit_cards', creditCards: cards })
      });
    } catch (e) {
      console.warn('[Central DB Sync Cards Error]:', e);
    }
  };

  const syncSaveRecurringToCentralDb = async (recs: RecurringExpense[]) => {
    try {
      await fetch('/api/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_recurring_expenses', recurringExpenses: recs })
      });
    } catch (e) {
      console.warn('[Central DB Sync Recurring Error]:', e);
    }
  };

  // Carregamento Inicial e Sincronização Contínua em Tempo Real com o Banco Central da Nuvem
  useEffect(() => {
    let isMounted = true;

    const pullCentralDb = async () => {
      try {
        let res = await fetch('/api/database').catch(() => null);
        let data: any = res && res.ok ? await res.json().catch(() => null) : null;

        // Se o endpoint padrão estiver vazio ou falhar, consulta o banco persistente do Render
        if (!data || !Array.isArray(data.transactions) || data.transactions.length === 0) {
          try {
            const fallbackBotUrl = 'https://kyro-finance-bot.onrender.com';
            const botRes = await fetch(`${fallbackBotUrl.replace(/\/$/, '')}/api/database`);
            if (botRes.ok) {
              const botData = await botRes.json();
              if (botData?.success && Array.isArray(botData.transactions) && botData.transactions.length > 0) {
                data = { ...(data || {}), ...botData };
              }
            }
          } catch (e) {}
        }

        if (data?.success && isMounted) {
          // 1. Sincroniza a lista de IDs excluídos
          if (Array.isArray(data.deletedIds) && data.deletedIds.length > 0) {
            setDeletedTxIds(prev => {
              let changed = false;
              const next = new Set(prev);
              data.deletedIds.forEach((id: string) => {
                if (!next.has(String(id))) {
                  next.add(String(id));
                  changed = true;
                }
              });
              if (changed) {
                localStorage.setItem('kyro_deleted_tx_ids', JSON.stringify(Array.from(next)));
                return next;
              }
              return prev;
            });
          }

          // 2. Transações do servidor filtradas por exclusão (anti-loop)
          const incomingTxs: any[] = Array.isArray(data.transactions) ? data.transactions : [];
          const deletedRaw = localStorage.getItem('kyro_deleted_tx_ids');
          const localDeletedSet = deletedRaw ? new Set(JSON.parse(deletedRaw)) : new Set();

          const cleanIncoming = incomingTxs.filter((t: any) => t && t.id && !localDeletedSet.has(String(t.id)));

          setTransactions(prev => {
            const validPrev = prev.filter((t: any) => t && t.id && !localDeletedSet.has(String(t.id)));

            // Se o servidor estiver vazio (banco zerado ou cold start) mas o cliente tiver dados locais:
            // NUNCA APAGA OS DADOS DO USUÁRIO! Pelo contrário: re-hidrata a nuvem enviando o acervo local!
            if (cleanIncoming.length === 0) {
              if (validPrev.length > 0) {
                console.log('[Central DB Sync] Re-hidratando banco central da nuvem com lançamentos locais...');
                fetch('/api/database', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'sync_all', transactions: validPrev })
                }).catch(() => {});
                return validPrev;
              }
              return [];
            }

            // Se a nuvem tem transações, faz merge preservando lançamentos locais que ainda não subiram
            const incomingIds = new Set(cleanIncoming.map((t: any) => String(t.id)));
            const pendingLocal = validPrev.filter(t => !incomingIds.has(String(t.id)));

            // Se há transações locais que ainda não estão na nuvem, dispara salvamento na nuvem
            if (pendingLocal.length > 0) {
              pendingLocal.forEach(tx => syncSaveToCentralDb(tx));
            }

            const merged = [...pendingLocal, ...cleanIncoming];

            const currentSig = prev.map(t => `${t.id}_${t.amount}_${t.description}`).join('|');
            const incomingSig = merged.map((t: any) => `${t.id}_${t.amount}_${t.description}`).join('|');
            if (currentSig !== incomingSig) {
              localStorage.setItem('kyro_transactions', JSON.stringify(merged));
              return merged;
            }
            return prev;
          });

          // 3. Sincroniza Regras e Diretrizes do Gemini Aprendidas via Chat
          if (Array.isArray(data.userAiRules) && data.userAiRules.length > 0) {
            setUserAiRules(prev => {
              const set = new Set([...prev, ...data.userAiRules]);
              const merged = Array.from(set);
              if (merged.length !== prev.length) {
                localStorage.setItem('kyro_user_ai_rules', JSON.stringify(merged));
                return merged;
              }
              return prev;
            });
          }

          // 4. Sincroniza Configurações de Formato e Instrução do Chat Gemini entre Desktop e Mobile
          if (data.chatConfig && typeof data.chatConfig === 'object') {
            if (data.chatConfig.formattingPreference) {
              setGeminiFormatStyle(prev => {
                if (prev !== data.chatConfig.formattingPreference) {
                  localStorage.setItem('kyro_gemini_format', data.chatConfig.formattingPreference);
                  return data.chatConfig.formattingPreference;
                }
                return prev;
              });
            }
            if (typeof data.chatConfig.customPrompt === 'string') {
              setGeminiCustomPrompt(prev => {
                if (prev !== data.chatConfig.customPrompt) {
                  localStorage.setItem('kyro_gemini_custom_prompt', data.chatConfig.customPrompt);
                  return data.chatConfig.customPrompt;
                }
                return prev;
              });
            }
          }

          // 5. Sincroniza Configurações do WhatsApp (Grupo Vinculado & Número) entre Desktop e Mobile
          if (data.whatsappConfig && typeof data.whatsappConfig === 'object') {
            if (data.whatsappConfig.groupName) {
              localStorage.setItem('kyro_group_name', data.whatsappConfig.groupName);
            }
            if (data.whatsappConfig.inviteLink) {
              localStorage.setItem('kyro_group_invite_link', data.whatsappConfig.inviteLink);
            }
            if (data.whatsappConfig.groupJid) {
              localStorage.setItem('kyro_group_jid', data.whatsappConfig.groupJid);
            }
            if (data.whatsappConfig.phoneNumber) {
              localStorage.setItem('kyro_second_phone_number', data.whatsappConfig.phoneNumber);
            }
            localStorage.setItem('kyro_group_confirmed', 'true');
          }

          // 6. Sincroniza Cartões de Crédito entre Desktop, Mobile e Nuvem (Persistência Universal)
          if (Array.isArray(data.creditCards)) {
            setCreditCards(prev => {
              const currentSig = JSON.stringify(prev);
              const incomingSig = JSON.stringify(data.creditCards);
              if (currentSig !== incomingSig) {
                localStorage.setItem('kyro_credit_cards', incomingSig);
                return data.creditCards;
              }
              return prev;
            });
          }

          // 7. Sincroniza Despesas Recorrentes / Dívidas entre Desktop, Mobile e Nuvem (Persistência Universal)
          if (Array.isArray(data.recurringExpenses)) {
            setRecurringExpenses(prev => {
              const currentSig = JSON.stringify(prev);
              const incomingSig = JSON.stringify(data.recurringExpenses);
              if (currentSig !== incomingSig) {
                localStorage.setItem('kyro_recurring', incomingSig);
                return data.recurringExpenses;
              }
              return prev;
            });
          }
        }
      } catch (err) {}
    };

    pullCentralDb();
    const interval = setInterval(pullCentralDb, 1500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Listener em tempo real do Firestore se conectado
  useEffect(() => {
    if (kyroCloud.isConnected) {
      const unsub = kyroCloud.subscribeTransactions((cloudTxs) => {
        const deletedRaw = localStorage.getItem('kyro_deleted_tx_ids');
        const localDeletedSet = deletedRaw ? new Set(JSON.parse(deletedRaw)) : new Set();
        const clean = (cloudTxs || []).filter(t => t && t.id && !localDeletedSet.has(String(t.id)));
        setTransactions(clean);
      });
      return () => unsub();
    }
  }, [isCloudSynced]);

  // Sincronização Ultra-Rápida em Tempo Real (SSE Stream 0ms + Polling Paralelo 1s Local & Nuvem Vercel)
  useEffect(() => {
    const ingestIncomingTransactions = (incoming: any[]) => {
      if (!incoming || incoming.length === 0) return;
      setTransactions(prev => {
        const existingIds = new Set(prev.map(t => String(t.id)));
        const deletedRaw = localStorage.getItem('kyro_deleted_tx_ids');
        const localDeletedSet = deletedRaw ? new Set(JSON.parse(deletedRaw)) : new Set();

        const newOnes = incoming.filter((t: any) => {
          if (!t || !t.amount) return false;
          const tid = String(t.id);
          // SE JÁ EXISTE NA TELA OU FOI EXCLUÍDO PELO USUÁRIO, IGNORA SUMARIAMENTE!
          if (existingIds.has(tid) || localDeletedSet.has(tid)) return false;

          // Apenas aceita se for mensagem recebida recentemente (últimos 10 minutos)
          if (t.createdAt) {
            const diff = Date.now() - new Date(t.createdAt).getTime();
            if (diff > 10 * 60 * 1000) return false;
          }

          // Antiduplicação por assinatura idêntica recente (últimos 30 segundos)
          const isDuplicate = prev.some(p => {
            const sameDesc = (p.description || '').trim().toLowerCase() === (t.description || '').trim().toLowerCase();
            const sameAmount = Math.abs(Number(p.amount) - Number(t.amount)) < 0.01;
            const sameType = p.type === t.type;
            const sameMethod = p.method === t.method;
            const pAge = (p as any).createdAt ? Math.abs(Date.now() - new Date((p as any).createdAt).getTime()) : 0;
            return sameDesc && sameAmount && sameType && sameMethod && pAge < 30000;
          });

          if (isDuplicate) return false;
          existingIds.add(tid);
          return true;
        });

        if (newOnes.length > 0) {
          const latest = newOnes[0];
          const symbol = latest.type === 'Entrada' ? '+' : '-';
          setWhatsappSyncToast({
            show: true,
            text: `⚡ WhatsApp Instantâneo: ${latest.description} (${symbol} R$ ${Number(latest.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) sincronizado!`
          });
          setTimeout(() => setWhatsappSyncToast(null), 4500);

          // PERSISTE NO FIRESTORE E NO BANCO CENTRAL UNIVERSAL EM PARALELO
          newOnes.forEach(ntx => {
            kyroCloud.syncSaveTransaction(ntx);
            syncSaveToCentralDb(ntx);
          });

          const updated = [...newOnes, ...prev];
          localStorage.setItem('kyro_transactions', JSON.stringify(updated));
          return updated;
        }
        return prev;
      });
    };

    // 1. Stream Server-Sent Events (SSE) para Latência Zero (< 5ms) quando o servidor local está acessível
    let sseProxy: EventSource | null = null;
    let sseDirect: EventSource | null = null;
    try {
      sseProxy = new EventSource('/api/stream');
      sseProxy.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data);
          if (payload?.type === 'new_transaction' && payload.transaction) {
            ingestIncomingTransactions([payload.transaction]);
          }
        } catch (e) {}
      };
    } catch (e) {}

    try {
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        sseDirect = new EventSource('http://localhost:3001/api/stream');
        sseDirect.onmessage = (ev) => {
          try {
            const payload = JSON.parse(ev.data);
            if (payload?.type === 'new_transaction' && payload.transaction) {
              ingestIncomingTransactions([payload.transaction]);
            }
          } catch (e) {}
        };
      }
    } catch (e) {}

    // 2. Polling Paralelo de Alta Velocidade (1 segundo) entre Local e Nuvem Vercel (Sem bloqueio sequencial!)
    const fetchWebhookTxs = async () => {
      try {
        const fetchWithTimeout = async (url: string, ms: number) => {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), ms);
          try {
            const res = await fetch(url, { signal: ctrl.signal });
            clearTimeout(tid);
            if (res.ok) return await res.json();
          } catch (e) {
            clearTimeout(tid);
          }
          return null;
        };

        const cloudBotUrl = localStorage.getItem('kyro_cloud_bot_url') || '';
        const fetchPromises = [
          fetchWithTimeout('http://localhost:3001/api/transactions', 1000),
          fetchWithTimeout('/api/webhook', 1200)
        ];
        if (cloudBotUrl) {
          fetchPromises.push(fetchWithTimeout(`${cloudBotUrl.replace(/\/$/, '')}/api/transactions`, 1200));
        }

        const results = await Promise.all(fetchPromises);
        const dataLocal = results[0];
        const dataCloud = results[1];
        const dataRemoteBot = results[2];

        const incoming: any[] = [];
        if (dataLocal?.transactions && Array.isArray(dataLocal.transactions)) {
          incoming.push(...dataLocal.transactions);
        }
        if (dataCloud?.transactions && Array.isArray(dataCloud.transactions)) {
          incoming.push(...dataCloud.transactions);
        }
        if (dataRemoteBot?.transactions && Array.isArray(dataRemoteBot.transactions)) {
          incoming.push(...dataRemoteBot.transactions);
        }

        if (incoming.length > 0) {
          ingestIncomingTransactions(incoming);
        }
      } catch (err) {
        // Silencioso em caso de offline
      }
    };

    fetchWebhookTxs();
    const interval = setInterval(fetchWebhookTxs, 1000); // Polling paralelo turbo a cada 1 segundo
    return () => {
      clearInterval(interval);
      if (sseProxy) sseProxy.close();
      if (sseDirect) sseDirect.close();
    };
  }, []);

  // Exclusão Funcional de Transações
  const handleDeleteTransaction = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (window.confirm("Deseja realmente excluir esta transação? Os saldos serão recalculados instantaneamente.")) {
      setTransactions(prev => prev.filter(t => t.id !== id));
      kyroCloud.syncDeleteTransaction(id);
      syncDeleteFromCentralDb(id);
      if (selectedTx && selectedTx.id === id) {
        setSelectedTx(null);
      }
    }
  };

  // Exclusão de Recorrente
  const handleDeleteRecurring = (id: string) => {
    if (window.confirm("Deseja cancelar esta despesa recorrente?")) {
      const target = recurringExpenses.find(r => r.id === id);
      if (target?.transactionId) {
        setTransactions(prev => prev.filter(t => t.id !== target.transactionId && t.recurringId !== id));
        kyroCloud.syncDeleteTransaction(target.transactionId);
      }
      const next = recurringExpenses.filter(r => r.id !== id);
      setRecurringExpenses(next);
      localStorage.setItem('kyro_recurring', JSON.stringify(next));
      kyroCloud.syncDeleteRecurring(id);
      syncSaveRecurringToCentralDb(next);
    }
  };

  // 1. Dar Baixa / Marcar Dívida Recorrente como Paga (SÓ AQUI ela é debitada das saídas e do saldo!)
  const handleMarkRecurringAsPaid = (recId: string) => {
    const target = recurringExpenses.find(r => r.id === recId);
    if (!target) return;

    const txId = `tx_rec_${Date.now()}`;
    const paidTx: Transaction = {
      id: txId,
      description: `${target.title} ${target.totalInstallments > 0 ? `(${target.currentInstallment}/${target.totalInstallments})` : ''} - Parcela Paga`,
      category: target.category,
      subcategory: 'Dívida Recorrente / Parcela Paga',
      city: target.city,
      amount: target.installmentAmount,
      type: 'Saída',
      method: target.method,
      date: 'Hoje',
      status: 'Concluído',
      recurringId: target.id,
      currentInstallment: target.currentInstallment,
      totalInstallments: target.totalInstallments,
      createdAt: new Date().toISOString()
    };

    const nextRecs = recurringExpenses.map(r => r.id === recId ? { ...r, paid: true, paidAt: new Date().toISOString(), transactionId: txId } : r);
    setRecurringExpenses(nextRecs);
    localStorage.setItem('kyro_recurring', JSON.stringify(nextRecs));
    setTransactions(prev => [paidTx, ...prev]);
    kyroCloud.syncSaveTransaction(paidTx);
    syncSaveToCentralDb(paidTx);
    syncSaveRecurringToCentralDb(nextRecs);

    setWhatsappSyncToast({
      show: true,
      text: `🎉 ${target.title} confirmada como PAGA! Saída de R$ ${target.installmentAmount.toLocaleString('pt-BR', {minimumFractionDigits:2})} debitada no Dashboard.`
    });
    setTimeout(() => setWhatsappSyncToast(null), 5000);
  };

  // 2. Desfazer Pagamento de Dívida Recorrente (Estorna o valor do saldo)
  const handleUnmarkRecurringPaid = (recId: string) => {
    const target = recurringExpenses.find(r => r.id === recId);
    if (!target) return;

    const nextRecs = recurringExpenses.map(r => r.id === recId ? { ...r, paid: false, paidAt: undefined, transactionId: undefined } : r);
    setRecurringExpenses(nextRecs);
    localStorage.setItem('kyro_recurring', JSON.stringify(nextRecs));
    setTransactions(prev => prev.filter(t => t.recurringId !== recId && t.id !== target.transactionId));
    if (target.transactionId) {
      kyroCloud.syncDeleteTransaction(target.transactionId);
    }
    syncSaveRecurringToCentralDb(nextRecs);

    setWhatsappSyncToast({
      show: true,
      text: `↩️ Pagamento de ${target.title} desfeito. Valor estornado do Dashboard.`
    });
    setTimeout(() => setWhatsappSyncToast(null), 4000);
  };

  // 3. Dar baixa em dívida via IA / Chat / Áudio por nome
  const handleConfirmRecurringPaymentByName = (targetName: string): string => {
    const lowerName = (targetName || '').toLowerCase().trim();
    const found = recurringExpenses.find(r => 
      !r.paid && (
        r.title.toLowerCase().includes(lowerName) ||
        r.category.toLowerCase().includes(lowerName) ||
        lowerName.includes(r.title.toLowerCase()) ||
        (lowerName.includes('passagem') && r.title.toLowerCase().includes('passagem')) ||
        (lowerName.includes('empréstimo') && r.title.toLowerCase().includes('empréstimo')) ||
        (lowerName.includes('personal') && r.title.toLowerCase().includes('personal')) ||
        (lowerName.includes('academia') && r.title.toLowerCase().includes('academia'))
      )
    );

    if (found) {
      handleMarkRecurringAsPaid(found.id);
      return `✅ Baixa confirmada com sucesso!\n\n• Dívida: ${found.title} (${found.currentInstallment}/${found.totalInstallments || 'Mensal'})\n• Valor Debitado: - R$ ${found.installmentAmount.toLocaleString('pt-BR', {minimumFractionDigits:2})}\n• Status: 🟢 PAGA\n\n💰 O valor de R$ ${found.installmentAmount.toLocaleString('pt-BR', {minimumFractionDigits:2})} agora foi computado nas Saídas do Mês e o seu Saldo Total foi recalculado automaticamente!`;
    }

    const pendingList = recurringExpenses.filter(r => !r.paid).map(r => `• ${r.title}: R$ ${r.installmentAmount.toLocaleString('pt-BR', {minimumFractionDigits:2})} (Vencimento ${r.dueDateText || 'dia ' + r.dueDateDay})`).join('\n');
    return `ℹ️ Não encontrei nenhuma dívida pendente exata com o nome "${targetName}".\n\nDívidas pendentes aguardando seu pagamento:\n${pendingList || '• Nenhuma dívida pendente no momento.'}\n\nPara dar baixa, diga: "Paguei a passagem aérea" ou clique no botão "Dar OK / Marcar como Paga" na aba de Recorrentes.`;
  };

  // 4. Calculador de Status Visual da Dívida Recorrente (Paga, Próxima 5 dias, Em Atraso, Pendente)
  const getRecurringStatus = (rec: RecurringExpense) => {
    if (rec.paid) {
      return {
        status: 'paga' as const,
        label: '🟢 Paga',
        badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 font-bold'
      };
    }

    const today = new Date().getDate();
    const dueDay = rec.dueDateDay || 10;
    
    if (today > dueDay) {
      const daysLate = today - dueDay;
      return {
        status: 'atrasada' as const,
        label: `🔴 Em Atraso (${daysLate} dias)`,
        badgeClass: 'bg-red-500/15 text-red-400 border-red-500/30 font-bold'
      };
    }

    const daysLeft = dueDay - today;
    if (daysLeft <= 5) {
      return {
        status: 'proxima' as const,
        label: daysLeft === 0 ? '🟡 Vence Hoje!' : `🟡 Vence em ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}`,
        badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30 font-bold animate-pulse'
      };
    }

    return {
      status: 'pendente' as const,
      label: `⚪ A Vencer (${rec.dueDateText || 'Dia ' + dueDay})`,
      badgeClass: 'bg-slate-800 text-slate-300 border-slate-700'
    };
  };

  // 5. Calculador de Métricas e Faturas de Cartões de Crédito
  const getCardMetrics = (card: CreditCardData) => {
    // 1. Lançamentos no crédito vinculados a este cartão
    const cardTransactions = transactions.filter(t => 
      t.type === 'Saída' && 
      (t.cardName?.toLowerCase() === card.name.toLowerCase() || 
       (t.method === 'Crédito' && (!t.cardName || t.cardName.toLowerCase() === card.name.toLowerCase())))
    );

    // 2. Dívidas recorrentes / parcelamentos vinculados a este cartão
    const cardRecurring = recurringExpenses.filter(r => 
      r.active && 
      (r.cardName?.toLowerCase() === card.name.toLowerCase() || 
       (r.method === 'Crédito' && (!r.cardName || r.cardName.toLowerCase() === card.name.toLowerCase())))
    );

    const directTotal = cardTransactions.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const recurringCurrentMonthTotal = cardRecurring
      .filter(r => !r.paid)
      .reduce((acc, r) => acc + (Number(r.installmentAmount) || 0), 0);
    const currentInvoiceTotal = directTotal + recurringCurrentMonthTotal;

    const futureInvoicesTotal = cardRecurring.reduce((acc, r) => {
      const remaining = Math.max(0, (r.totalInstallments || 1) - (r.currentInstallment || 1));
      return acc + (remaining * (Number(r.installmentAmount) || 0));
    }, 0);

    const totalCommitted = currentInvoiceTotal + futureInvoicesTotal;
    const limitTotal = card.limit || 5000;
    const limitAvailable = Math.max(0, limitTotal - totalCommitted);

    const now = new Date();
    const today = now.getDate();
    let daysUntilDue = card.dueDay - today;
    if (daysUntilDue < 0) {
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      daysUntilDue = (daysInMonth - today) + card.dueDay;
    }

    const isDueSoon = daysUntilDue <= 5 && daysUntilDue >= 0;
    const isOverdue = today > card.dueDay && currentInvoiceTotal > 0 && (today - card.dueDay <= 10);

    return {
      cardTransactions,
      cardRecurring,
      currentInvoiceTotal,
      futureInvoicesTotal,
      totalCommitted,
      limitTotal,
      limitAvailable,
      daysUntilDue,
      isDueSoon,
      isOverdue
    };
  };

  const hasAnyCardDueSoon = creditCards.some(card => {
    const m = getCardMetrics(card);
    return m.currentInvoiceTotal > 0 && (m.isDueSoon || m.isOverdue);
  });

  const handlePayCardInvoice = (card: CreditCardData) => {
    const metrics = getCardMetrics(card);
    if (metrics.currentInvoiceTotal <= 0) {
      alert('Esta fatura já está zerada ou sem lançamentos pendentes.');
      return;
    }

    const confirmPay = window.confirm(
      `Confirmar pagamento da fatura do ${card.name} no valor de R$ ${metrics.currentInvoiceTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}?\n\nEste valor será debitado do seu Saldo no Dashboard.`
    );
    if (!confirmPay) return;

    const recurringIdsToMark = metrics.cardRecurring.filter(r => !r.paid).map(r => r.id);
    if (recurringIdsToMark.length > 0) {
      const nextRecs = recurringExpenses.map(r => {
        if (recurringIdsToMark.includes(r.id)) {
          return { ...r, paid: true, paidAt: new Date().toISOString() };
        }
        return r;
      });
      setRecurringExpenses(nextRecs);
      localStorage.setItem('kyro_recurring', JSON.stringify(nextRecs));
      syncSaveRecurringToCentralDb(nextRecs);
    }

    const paymentTx: Transaction = {
      id: `pay_inv_${Date.now()}`,
      description: `Pagamento Fatura ${card.name}`,
      category: 'Cartão de Crédito',
      subcategory: 'Fatura Mensal',
      city: 'Teresina, PI',
      amount: metrics.currentInvoiceTotal,
      type: 'Saída',
      method: 'PIX',
      cardName: card.name,
      date: 'Hoje',
      status: 'Concluído',
      createdAt: new Date().toISOString()
    };

    setTransactions(prev => [paymentTx, ...prev]);
    kyroCloud.syncSaveTransaction(paymentTx);
    syncSaveToCentralDb(paymentTx);

    setWhatsappSyncToast({
      show: true,
      text: `💳 Fatura do ${card.name} (R$ ${metrics.currentInvoiceTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}) PAGA e debitada do Saldo!`
    });
    setTimeout(() => setWhatsappSyncToast(null), 5000);
  };

  const handleDeleteCard = (cardId: string) => {
    const target = creditCards.find(c => c.id === cardId);
    if (!target) return;
    if (window.confirm(`Deseja realmente remover o cartão ${target.name}?`)) {
      const next = creditCards.filter(c => c.id !== cardId);
      setCreditCards(next);
      localStorage.setItem('kyro_credit_cards', JSON.stringify(next));
      if (selectedCardId === cardId) setSelectedCardId('todos');
      syncSaveCreditCardsToCentralDb(next);
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

  // =========================================================================
  // CONFIGURAÇÕES DO GOOGLE GEMINI 1.5 FLASH (MULTIMODAL & FUNCTION CALLING)
  // =========================================================================
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    return localStorage.getItem('kyro_gemini_api_key') || '';
  });
  const [geminiFormatStyle, setGeminiFormatStyle] = useState<string>(() => {
    return localStorage.getItem('kyro_gemini_format') || 'tabelas';
  });
  const [geminiCustomPrompt, setGeminiCustomPrompt] = useState<string>(() => {
    return localStorage.getItem('kyro_gemini_custom_prompt') || '';
  });
  // DIRETRIZES E REGRAS PERSONALIZADAS APRENDIDAS PELO GEMINI VIA CHAT
  const [userAiRules, setUserAiRules] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('kyro_user_ai_rules');
      return saved ? JSON.parse(saved) : [
        'Na descrição de lançamentos, registrar apenas o item específico mencionado (ex: Lanche) e nunca mesclar com barras a categoria (ex: Alimentação / Lanche). A categoria fica no campo Categoria.'
      ];
    } catch {
      return [
        'Na descrição de lançamentos, registrar apenas o item específico mencionado (ex: Lanche) e nunca mesclar com barras a categoria (ex: Alimentação / Lanche). A categoria fica no campo Categoria.'
      ];
    }
  });
  const [newRuleInput, setNewRuleInput] = useState('');
  const [isGeminiModalOpen, setIsGeminiModalOpen] = useState(false);
  const [isTestingGemini, setIsTestingGemini] = useState(false);
  const [geminiTestFeedback, setGeminiTestFeedback] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // ==========================================================================
  // NAVEGAÇÃO SEQUENCIAL DE ABAS E BOTÃO VOLTAR ANDROID (DUPLO TOQUE PARA SAIR)
  // ==========================================================================
  const [tabHistory, setTabHistory] = useState<Array<'dashboard' | 'transacoes' | 'orcamentos' | 'mapa' | 'relatorios' | 'whatsapp' | 'configuracoes' | 'cartoes'>>(['dashboard']);
  const isBackNavigatingRef = useRef(false);
  const lastBackPressRef = useRef<number>(0);
  const exitToastTimerRef = useRef<any>(null);
  const [exitToastVisible, setExitToastVisible] = useState(false);

  // Pop-up e Gerenciador de Auto-Update no Aplicativo (Discreto e Não Intrusivo)
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [isCheckingUpdateManual, setIsCheckingUpdateManual] = useState(false);
  const availableUpdateRef = useRef(availableUpdate);
  availableUpdateRef.current = availableUpdate;

  // Verificação discreta de novas versões (sem pop-ups repetitivos na tela)
  useEffect(() => {
    let isSubscribed = true;

    const performUpdateCheck = async () => {
      if (!isSubscribed) return;
      try {
        const info = await checkForAppUpdate();
        if (info && isSubscribed) {
          const dismissedBuild = localStorage.getItem('kyro_dismissed_update_build');
          // Só define se o usuário não tiver dispensado esta versão anteriormente
          if (String(info.buildNumber) !== dismissedBuild) {
            setAvailableUpdate(info);
          }
        }
      } catch (err) {}
    };

    // Apenas uma checagem única silenciosa 8 segundos após abrir o app
    const initialTimer = setTimeout(performUpdateCheck, 8000);

    return () => {
      isSubscribed = false;
      clearTimeout(initialTimer);
    };
  }, []);

  const handleManualCheckUpdate = async () => {
    setIsCheckingUpdateManual(true);
    try {
      const detailed = await checkUpdateDetailed();
      if (detailed.hasUpdate && detailed.updateInfo) {
        setAvailableUpdate(detailed.updateInfo);
      } else if (detailed.errorMessage) {
        alert(`⚠️ Não foi possível verificar no GitHub: ${detailed.errorMessage}\n\nVerifique sua conexão à internet e tente novamente.`);
      } else {
        const pkgName = detailed.remoteInfo?.apkFileName ? `\n• Pacote no GitHub: ${detailed.remoteInfo.apkFileName}` : '';
        alert(`✅ Você já está usando a versão mais recente do KYRO Finance!\n\n• Versão Instalada: v${detailed.installedInfo.versionName} (Build ${detailed.installedInfo.buildNumber})${pkgName}\n\nNenhuma atualização pendente.`);
      }
    } catch (err: any) {
      alert(`⚠️ Erro ao consultar atualizações: ${err?.message || 'Verifique sua conexão'}`);
    } finally {
      setIsCheckingUpdateManual(false);
    }
  };

  // Sincronização em tempo real das refs para evitar stale-closure no listener nativo
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const tabHistoryRef = useRef(tabHistory);
  tabHistoryRef.current = tabHistory;

  const chatOpenMobileRef = useRef(chatOpenMobile);
  chatOpenMobileRef.current = chatOpenMobile;

  const mobileMenuOpenRef = useRef(mobileMenuOpen);
  mobileMenuOpenRef.current = mobileMenuOpen;

  const selectedTxRef = useRef(selectedTx);
  selectedTxRef.current = selectedTx;

  const activeKpiModalRef = useRef(activeKpiModal);
  activeKpiModalRef.current = activeKpiModal;

  const profileModalOpenRef = useRef(profileModalOpen);
  profileModalOpenRef.current = profileModalOpen;

  const notificationsOpenRef = useRef(notificationsOpen);
  notificationsOpenRef.current = notificationsOpen;

  const newTxModalOpenRef = useRef(newTxModalOpen);
  newTxModalOpenRef.current = newTxModalOpen;

  const newRecModalOpenRef = useRef(newRecModalOpen);
  newRecModalOpenRef.current = newRecModalOpen;

  const newCardModalOpenRef = useRef(newCardModalOpen);
  newCardModalOpenRef.current = newCardModalOpen;

  const whatsAppModalOpenRef = useRef(whatsAppModalOpen);
  whatsAppModalOpenRef.current = whatsAppModalOpen;

  const cloudConfigModalOpenRef = useRef(cloudConfigModalOpen);
  cloudConfigModalOpenRef.current = cloudConfigModalOpen;

  const isGeminiModalOpenRef = useRef(isGeminiModalOpen);
  isGeminiModalOpenRef.current = isGeminiModalOpen;

  // Rastreia navegação voluntária entre abas para empilhar no histórico
  useEffect(() => {
    if (isBackNavigatingRef.current) {
      isBackNavigatingRef.current = false;
      return;
    }
    setTabHistory(prev => {
      if (prev.length > 0 && prev[prev.length - 1] === activeTab) {
        return prev;
      }
      return [...prev, activeTab];
    });
  }, [activeTab]);

  // Manipulador hierárquico do botão voltar do celular Android
  const handleAndroidBack = useCallback(() => {
    // 0. Se o pop-up de atualização estiver aberto, fecha o pop-up
    if (availableUpdateRef.current) {
      setAvailableUpdate(null);
      return;
    }

    // 1. Camada 1: Fecha modais, gaveta do chat ou menu hambúrguer abertos
    if (chatOpenMobileRef.current) {
      setChatOpenMobile(false);
      return;
    }
    if (mobileMenuOpenRef.current) {
      setMobileMenuOpen(false);
      return;
    }
    if (selectedTxRef.current) {
      setSelectedTx(null);
      return;
    }
    if (activeKpiModalRef.current) {
      setActiveKpiModal(null);
      return;
    }
    if (newTxModalOpenRef.current) {
      setNewTxModalOpen(false);
      return;
    }
    if (newRecModalOpenRef.current) {
      setNewRecModalOpen(false);
      return;
    }
    if (newCardModalOpenRef.current) {
      setNewCardModalOpen(false);
      return;
    }
    if (profileModalOpenRef.current) {
      setProfileModalOpen(false);
      return;
    }
    if (notificationsOpenRef.current) {
      setNotificationsOpen(false);
      return;
    }
    if (whatsAppModalOpenRef.current) {
      setWhatsAppModalOpen(false);
      return;
    }
    if (cloudConfigModalOpenRef.current) {
      setCloudConfigModalOpen(false);
      return;
    }
    if (isGeminiModalOpenRef.current) {
      setIsGeminiModalOpen(false);
      return;
    }

    // 2. Camada 2: Histórico sequencial de abas (volta uma a uma na ordem navegada)
    const history = tabHistoryRef.current;
    if (history.length > 1) {
      const nextHistory = [...history];
      nextHistory.pop(); // Remove a aba atual
      const previousTab = nextHistory[nextHistory.length - 1];
      isBackNavigatingRef.current = true;
      setTabHistory(nextHistory);
      setActiveTab(previousTab);
      return;
    }

    // Se estiver em outra aba e o histórico só tiver 1 elemento, volta para a principal (dashboard)
    if (activeTabRef.current !== 'dashboard') {
      isBackNavigatingRef.current = true;
      setTabHistory(['dashboard']);
      setActiveTab('dashboard');
      return;
    }

    // 3. Camada 3: Já está na aba principal ('dashboard') sem nenhum modal aberto
    // Requer dois toques rápidos (em menos de 2s) para sair do aplicativo
    const now = Date.now();
    if (now - lastBackPressRef.current < 2000) {
      try {
        CapApp.exitApp();
      } catch (err) {
        console.warn('Erro ao finalizar app:', err);
      }
      return;
    }

    // Primeiro toque na aba principal: registra timestamp e exibe aviso flutuante
    lastBackPressRef.current = now;
    setExitToastVisible(true);
    if (exitToastTimerRef.current) {
      clearTimeout(exitToastTimerRef.current);
    }
    exitToastTimerRef.current = setTimeout(() => {
      setExitToastVisible(false);
    }, 2000);
  }, []);

  // Registra listener no Capacitor App Plugin e no DOM
  useEffect(() => {
    let capListenerHandle: any = null;

    try {
      CapApp.addListener('backButton', () => {
        handleAndroidBack();
      }).then(handle => {
        capListenerHandle = handle;
      }).catch(() => {});
    } catch {
      // Ignora se não estiver em ambiente nativo Capacitor
    }

    const onDocBack = (e: Event) => {
      e.preventDefault();
      handleAndroidBack();
    };
    document.addEventListener('backbutton', onDocBack);

    // Gancho global para chamada direta nativa (Android WebView)
    (window as any).__handleAndroidBackButton = handleAndroidBack;

    return () => {
      if (capListenerHandle && typeof capListenerHandle.remove === 'function') {
        capListenerHandle.remove();
      }
      document.removeEventListener('backbutton', onDocBack);
      delete (window as any).__handleAndroidBackButton;
      if (exitToastTimerRef.current) {
        clearTimeout(exitToastTimerRef.current);
      }
    };
  }, [handleAndroidBack]);

  const handleAddAiRule = (ruleText: string) => {
    const clean = ruleText.trim();
    if (!clean) return;
    setUserAiRules(prev => {
      if (prev.includes(clean)) return prev;
      const next = [...prev, clean];
      localStorage.setItem('kyro_user_ai_rules', JSON.stringify(next));
      fetch('/api/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_ai_rule', rule: clean })
      }).catch(() => {});
      return next;
    });
    setNewRuleInput('');
    setWhatsappSyncToast({
      show: true,
      text: '🧠 Nova diretriz de filtragem gravada com sucesso!'
    });
    setTimeout(() => setWhatsappSyncToast(null), 3000);
  };

  const handleDeleteAiRule = (ruleToDelete: string) => {
    setUserAiRules(prev => {
      const next = prev.filter(r => r !== ruleToDelete);
      localStorage.setItem('kyro_user_ai_rules', JSON.stringify(next));
      fetch('/api/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_ai_rule', rule: ruleToDelete })
      }).catch(() => {});
      return next;
    });
    setWhatsappSyncToast({
      show: true,
      text: '🗑️ Diretriz removida.'
    });
    setTimeout(() => setWhatsappSyncToast(null), 3000);
  };

  const handleClearAllAiRules = () => {
    setUserAiRules([]);
    localStorage.setItem('kyro_user_ai_rules', '[]');
    fetch('/api/database', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync_ai_rules', rules: [] })
    }).catch(() => {});
    setWhatsappSyncToast({
      show: true,
      text: '🧹 Todas as diretrizes de IA foram redefinidas.'
    });
    setTimeout(() => setWhatsappSyncToast(null), 3000);
  };

  const handleSaveGeminiConfig = (key: string, format: string, prompt: string) => {
    setGeminiApiKey(key);
    setGeminiFormatStyle(format);
    setGeminiCustomPrompt(prompt);
    localStorage.setItem('kyro_gemini_api_key', key);
    localStorage.setItem('kyro_gemini_format', format);
    localStorage.setItem('kyro_gemini_custom_prompt', prompt);
    fetch('/api/database', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save_chat_config',
        geminiApiKey: key,
        chatConfig: { formattingPreference: format, customPrompt: prompt, geminiApiKey: key },
        userAiRules
      })
    }).catch(() => {});
    setWhatsappSyncToast({
      show: true,
      text: '⚡ Configurações do Google Gemini 1.5 Flash salvas e sincronizadas entre Desktop e Mobile!'
    });
    setTimeout(() => setWhatsappSyncToast(null), 4000);
    setIsGeminiModalOpen(false);
  };

  const handleTestGeminiConnection = async (keyToTest: string) => {
    setIsTestingGemini(true);
    setGeminiTestFeedback(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Olá, faça um teste de conexão!',
          geminiApiKey: keyToTest || geminiApiKey,
          formattingPreference: geminiFormatStyle,
          context: { userName: userFullName, transactions: [] }
        })
      });
      const data = await res.json();
      if (res.ok && data?.reply) {
        setGeminiTestFeedback({
          type: 'success',
          text: `✅ Conectado com sucesso ao ${data.engine === 'gemini-1.5-flash' ? 'Google Gemini 1.5 Flash' : 'Motor Local KYRO'}!`
        });
      } else {
        setGeminiTestFeedback({
          type: 'error',
          text: `⚠️ Erro na validação: ${data?.error || 'Verifique a chave informada.'}`
        });
      }
    } catch (err: any) {
      setGeminiTestFeedback({
        type: 'error',
        text: `⚠️ Falha ao conectar: ${err.message}`
      });
    } finally {
      setIsTestingGemini(false);
    }
  };

  // Estados de Seleção Múltipla para Exclusão em Lote
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [selectedExitIds, setSelectedExitIds] = useState<Set<string>>(new Set());
  const [selectedTxTabIds, setSelectedTxTabIds] = useState<Set<string>>(new Set());

  const handleToggleSelectEntry = (id: string) => {
    setSelectedEntryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectExit = (id: string) => {
    setSelectedExitIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectTxTab = (id: string) => {
    setSelectedTxTabIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDeleteTransactions = (idsToDelete: Set<string>, label: string = 'transações') => {
    if (idsToDelete.size === 0) return;
    const count = idsToDelete.size;
    if (window.confirm(`Deseja realmente excluir as ${count} ${label} selecionadas? Os saldos, métricas e o Dashboard serão recalculados instantaneamente.`)) {
      setTransactions(prev => prev.filter(t => !idsToDelete.has(t.id)));
      idsToDelete.forEach(id => kyroCloud.syncDeleteTransaction(id));
      syncDeleteManyFromCentralDb(Array.from(idsToDelete));
      setSelectedEntryIds(new Set());
      setSelectedExitIds(new Set());
      setSelectedTxTabIds(new Set());
      setWhatsappSyncToast({
        show: true,
        text: `🗑️ ${count} ${label} excluídas com sucesso! Saldos recalculados.`
      });
      setTimeout(() => setWhatsappSyncToast(null), 4000);
    }
  };

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
      const groupJid = localStorage.getItem('kyro_group_jid') || '120363411839303797@g.us';
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
              remoteJid: groupJid,
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
          syncSaveToCentralDb(data.savedTx);
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
      const localReply = generateThinkingFinancialReply(textToSend, {
        userName: userFullName,
        totalBalance,
        monthIncomes,
        monthExpenses,
        savingsRate,
        transactions,
        recurringExpenses,
        creditCards
      });
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
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [audioRecordingTime, setAudioRecordingTime] = useState(0);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  const speechRecognitionRef = React.useRef<any>(null);
  const timerIntervalRef = React.useRef<any>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const cameraInputRef = React.useRef<HTMLInputElement | null>(null);

  // Estado para seleção e exclusão interativa de lançamentos no chat
  const [selectedTxIdsForRemoval, setSelectedTxIdsForRemoval] = useState<Set<string>>(new Set());
  const [editingTxFromChat, setEditingTxFromChat] = useState<Transaction | null>(null);

  const handleSaveEditedTransaction = (updatedTx: Transaction) => {
    if (!updatedTx || !updatedTx.id) return;

    setTransactions(prev => prev.map(t => t.id === updatedTx.id ? updatedTx : t));
    kyroCloud.syncSaveTransaction(updatedTx);
    syncSaveToCentralDb(updatedTx);

    setWhatsappSyncToast({
      show: true,
      text: `✏️ Lançamento "${updatedTx.product || updatedTx.description}" atualizado com sucesso!`
    });
    setTimeout(() => setWhatsappSyncToast(null), 4000);

    const typeSign = updatedTx.type === 'Saída' ? '-' : '+';
    const confirmMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'ia',
      text: `✏️ **Lançamento Ajustado com Sucesso!**\n\n` +
        `• **Item:** ${updatedTx.product || updatedTx.description}\n` +
        `• **Valor Atualizado:** ${typeSign} R$ ${updatedTx.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
        `• **Forma de Pagamento:** ${updatedTx.method}${updatedTx.cardName ? ` (${updatedTx.cardName})` : ''}\n` +
        `• **Local / Estabelecimento:** ${updatedTx.establishment || 'Geral'} (${updatedTx.city || 'Sem cidade'})\n` +
        `• **Data:** ${updatedTx.date}\n\n` +
        `✅ Operação concluída: Seus saldos, total de saídas e gráficos foram recalculados imediatamente!`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, confirmMsg]);
    setEditingTxFromChat(null);
  };

  const toggleSelectTxForRemoval = (txId: string) => {
    setSelectedTxIdsForRemoval(prev => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  };

  const handleRemoveSpecificTransactions = (txIds: string[], parentMessageId?: string) => {
    if (!txIds || txIds.length === 0) return;

    const itemsToRemove = transactions.filter(t => txIds.includes(t.id));
    if (itemsToRemove.length === 0) return;

    // 1. Remove do estado local
    setTransactions(prev => prev.filter(t => !txIds.includes(t.id)));

    // 2. Deleta do Firestore e do Banco Central
    txIds.forEach(id => kyroCloud.syncDeleteTransaction(id));
    syncDeleteManyFromCentralDb(txIds);

    // 3. Limpa seleções pendentes
    setSelectedTxIdsForRemoval(new Set());

    // 4. Marca o card da mensagem anterior como concluído
    if (parentMessageId) {
      setMessages(prev => prev.map(m => m.id === parentMessageId ? { ...m, actionCompleted: true } : m));
    }

    // 5. Exibe confirmação detalhada no chat
    const totalVal = itemsToRemove.reduce((s, t) => s + t.amount, 0);
    const summaryList = itemsToRemove.map(t => `• **${t.product || t.description}:** R$ ${t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${t.city})`).join('\n');

    const confirmMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'ia',
      text: `🗑️ **${itemsToRemove.length} lançamento${itemsToRemove.length > 1 ? 's excluídos' : ' excluído'} com sucesso!**\n\n${summaryList}\n\n💰 **Total estornado:** R$ ${totalVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n✅ Seus saldos, total de saídas e relatórios foram recalculados imediatamente!`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, confirmMsg]);
    setWhatsappSyncToast({
      show: true,
      text: `🗑️ ${itemsToRemove.length} lançamento(s) removido(s) com sucesso!`
    });
    setTimeout(() => setWhatsappSyncToast(null), 4000);
  };

  // =========================================================================
  // RENDERIZADOR DE MARKDOWN E TABELAS ESTRUTURADAS DO GEMINI 1.5 FLASH
  // =========================================================================
  const renderInlineMarkdown = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-bold text-slate-100">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={i} className="italic text-amber-200">{part.slice(1, -1)}</em>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="px-1.5 py-0.5 rounded bg-black/40 text-amber-300 font-mono text-[10px]">{part.slice(1, -1)}</code>;
      }
      return part;
    });
  };

  const renderFormattedMessageText = (content: string) => {
    if (!content) return null;

    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let tableRows: string[] = [];
    let inTable = false;

    const flushTable = (keyIndex: number) => {
      if (tableRows.length === 0) return;
      const headerRow = tableRows[0];
      const dataRows = tableRows.slice(2);

      const parseCells = (row: string) => 
        row.split('|')
          .map(c => c.trim())
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

      const headers = parseCells(headerRow);

      elements.push(
        <div key={`table-${keyIndex}`} className="my-2.5 overflow-x-auto rounded-xl border border-slate-700/60 bg-[#0c101d] shadow-sm">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/60 text-slate-200">
                {headers.map((h, i) => (
                  <th key={i} className="py-2 px-3 font-bold text-amber-300">
                    {renderInlineMarkdown(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {dataRows.map((r, rowIdx) => {
                const cells = parseCells(r);
                return (
                  <tr key={rowIdx} className="hover:bg-slate-800/30 transition-colors">
                    {cells.map((cell, cellIdx) => (
                      <td key={cellIdx} className="py-2 px-3 text-[11px]">
                        {renderInlineMarkdown(cell)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
      inTable = false;
    };

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        inTable = true;
        tableRows.push(trimmed);
      } else {
        if (inTable) {
          flushTable(index);
        }
        if (trimmed.length === 0) {
          elements.push(<div key={`br-${index}`} className="h-1.5" />);
        } else if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          const bulletText = trimmed.replace(/^[•\-*]\s+/, '');
          elements.push(
            <div key={`bullet-${index}`} className="flex items-start gap-1.5 my-0.5">
              <span className="text-amber-400 font-bold shrink-0 mt-0.5">•</span>
              <span className="flex-1">{renderInlineMarkdown(bulletText)}</span>
            </div>
          );
        } else {
          elements.push(
            <p key={`p-${index}`} className="my-0.5 leading-relaxed">
              {renderInlineMarkdown(line)}
            </p>
          );
        }
      }
    });

    if (inTable) {
      flushTable(lines.length);
    }

    return <div>{elements}</div>;
  };

  // Manipulador Unificado do Assistente IA (Texto, Áudio e Imagem de Comprovante)
  const handleProcessUserInteraction = async ({
    type,
    text,
    audioUrl,
    audioBase64,
    audioMimeType,
    imageUrl,
    imageBase64,
    imageMimeType,
    replaceMessageId
  }: {
    type: 'text' | 'audio' | 'image';
    text: string;
    audioUrl?: string;
    audioBase64?: string;
    audioMimeType?: string;
    imageUrl?: string;
    imageBase64?: string;
    imageMimeType?: string;
    replaceMessageId?: string;
  }) => {
    const isAudio = type === 'audio';
    const isImage = type === 'image';

    // =========================================================================
    // INTEGRAÇÃO NATIVA COM GOOGLE GEMINI 1.5 FLASH (MULTIMODAL & FUNCTION CALLING)
    // =========================================================================
    try {
      const apiResponse = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          audioBase64,
          audioMimeType,
          imageBase64,
          imageMimeType,
          history: messages.slice(-6).map(m => ({ sender: m.sender, text: m.text })),
          context: {
            userName: userFullName,
            totalBalance,
            monthIncomes,
            monthExpenses,
            transactions: transactions.slice(0, 35),
            creditCards,
            recurringExpenses
          },
          geminiApiKey: geminiApiKey || undefined,
          formattingPreference: geminiFormatStyle,
          customPrompt: geminiCustomPrompt,
          userAiRules: userAiRules
        })
      });

      if (apiResponse.ok) {
        const data = await apiResponse.json();
        if (data && data.reply) {
          const action = data.action || { type: 'none' };

          // 1. Criação de transação pelo Gemini
          if (action.type === 'create_transaction' && action.transaction) {
            const tx = action.transaction;
            const newTx: Transaction = {
              ...tx,
              id: tx.id || `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              date: tx.date || new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
              status: 'Concluído'
            };

            if (newTx.cardName) {
              const cardExists = creditCards.some(c => c.name.toLowerCase() === newTx.cardName?.toLowerCase());
              if (!cardExists) {
                const newCard: CreditCardData = {
                  id: `card_${Date.now()}`,
                  name: newTx.cardName,
                  closingDay: 15,
                  dueDay: 20,
                  limit: 5000,
                  color: 'purple'
                };
                setCreditCards(prev => {
                  const nextCards = [...prev, newCard];
                  localStorage.setItem('kyro_credit_cards', JSON.stringify(nextCards));
                  syncSaveCreditCardsToCentralDb(nextCards);
                  return nextCards;
                });
              }
            }

            setTransactions(prev => [newTx, ...prev]);
            kyroCloud.syncSaveTransaction(newTx);
            syncSaveToCentralDb(newTx);

            setWhatsappSyncToast({
              show: true,
              text: `✨ ${newTx.description} (${newTx.type === 'Saída' ? '-' : '+'} R$ ${newTx.amount.toFixed(2)}) lançado com sucesso!`
            });
            setTimeout(() => setWhatsappSyncToast(null), 4000);
          }

          // 2. Remoção de transação pelo Gemini
          let actionableTxs: Transaction[] | undefined = undefined;
          if (action.type === 'delete_transactions') {
            const targetIds: string[] = action.deleteTargetIds || [];
            const targetTerm = action.deleteTargetTerm || '';

            let matched: Transaction[] = [];
            if (targetIds.length > 0) {
              matched = transactions.filter(t => targetIds.includes(t.id));
            }
            if (matched.length === 0 && targetTerm) {
              matched = searchTransactionsByTerm(targetTerm, transactions);
            }

            if (matched.length === 1) {
              const toDelete = matched[0];
              setTransactions(prev => prev.filter(t => t.id !== toDelete.id));
              kyroCloud.syncDeleteTransaction(toDelete.id);
              syncDeleteFromCentralDb(toDelete.id);

              setWhatsappSyncToast({
                show: true,
                text: `🗑️ Lançamento "${toDelete.product || toDelete.description}" removido com sucesso!`
              });
              setTimeout(() => setWhatsappSyncToast(null), 4000);
            } else if (matched.length > 1) {
              actionableTxs = matched;
              setSelectedTxIdsForRemoval(new Set(matched.map(t => t.id)));
            }
          }

          // 3. Aprendizado e Memorização de Nova Regra de Filtragem pelo Gemini
          if (action.type === 'save_user_rule') {
            const ruleText = typeof action.rule === 'string' ? action.rule.trim() : '';
            if (ruleText) {
              setUserAiRules(prev => {
                if (prev.includes(ruleText)) return prev;
                const next = [...prev, ruleText];
                localStorage.setItem('kyro_user_ai_rules', JSON.stringify(next));
                fetch('/api/database', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'save_ai_rule', rule: ruleText })
                }).catch(() => {});
                return next;
              });
            }

            // Se a regra requerer ajuste retroativo do lançamento recente
            if (action.adjustRecentTransaction && action.adjustedFields) {
              const targetId = action.targetTxId;
              setTransactions(prev => {
                let found = false;
                const updated = prev.map(t => {
                  if (targetId && t.id === targetId) {
                    found = true;
                    const mod = { ...t, ...action.adjustedFields };
                    kyroCloud.syncSaveTransaction(mod);
                    syncSaveToCentralDb(mod);
                    return mod;
                  }
                  return t;
                });

                if (!found && updated.length > 0) {
                  const idx = updated.findIndex(t => 
                    (t.description || '').includes('/') || 
                    (t.description || '').toLowerCase().includes('alimenta')
                  );
                  const targetIndex = idx >= 0 ? idx : 0;
                  const mod = { ...updated[targetIndex], ...action.adjustedFields };
                  updated[targetIndex] = mod;
                  kyroCloud.syncSaveTransaction(mod);
                  syncSaveToCentralDb(mod);
                }

                localStorage.setItem('kyro_transactions', JSON.stringify(updated));
                return updated;
              });
            }

            setWhatsappSyncToast({
              show: true,
              text: '🧠 Nova diretriz de filtragem memorizada pelo Gemini!'
            });
            setTimeout(() => setWhatsappSyncToast(null), 4000);
          }

          // 4. Ajuste Direto de Lançamento pelo Gemini
          if (action.type === 'adjust_transaction') {
            const targetId = action.targetTxId;
            const adjustments = action.adjustments || {};
            setTransactions(prev => {
              const updated = prev.map(t => {
                if (targetId && t.id === targetId) {
                  const mod = { ...t, ...adjustments };
                  kyroCloud.syncSaveTransaction(mod);
                  syncSaveToCentralDb(mod);
                  return mod;
                }
                return t;
              });
              localStorage.setItem('kyro_transactions', JSON.stringify(updated));
              return updated;
            });

            setWhatsappSyncToast({
              show: true,
              text: '✏️ Lançamento ajustado com sucesso!'
            });
            setTimeout(() => setWhatsappSyncToast(null), 4000);
          }

          const aiReplyMsg: ChatMessage = {
            id: (Date.now() + 2).toString(),
            sender: 'ia',
            text: data.reply,
            actionableTransactions: actionableTxs,
            actionCompleted: false,
            engine: data.engine || 'gemini-1.5-flash',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };

          setMessages(prev => {
            if (replaceMessageId) {
              return prev.map(m => m.id === replaceMessageId ? aiReplyMsg : m);
            }
            return [...prev, aiReplyMsg];
          });
          return;
        }
      }
    } catch (geminiApiError) {
      console.warn('[Gemini 1.5 Flash Chat API Fallback]:', geminiApiError);
    }

    // =========================================================================
    // COMANDO 1: REMOÇÃO INTELIGENTE DE LANÇAMENTOS (ÚLTIMO OU BUSCA POR TERMO/CIDADE)
    // =========================================================================
    if (isRemoveTransactionCommand(text)) {
      const action = executeSmartRemoveTransaction(text, transactions);

      // Se encontrou exatamente 1 e já excluiu automaticamente
      if (action.actionType === 'single_deleted' && action.updatedTransactions && action.deletedTransactionId) {
        setTransactions(action.updatedTransactions);
        kyroCloud.syncDeleteTransaction(action.deletedTransactionId);
        syncDeleteFromCentralDb(action.deletedTransactionId);
        setWhatsappSyncToast({
          show: true,
          text: '🗑️ Lançamento removido com sucesso!'
        });
        setTimeout(() => setWhatsappSyncToast(null), 4000);
      }

      const aiReplyMsg: ChatMessage = {
        id: (Date.now() + 2).toString(),
        sender: 'ia',
        text: action.reply,
        actionableTransactions: action.actionableTransactions,
        actionCompleted: false,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => {
        if (replaceMessageId) {
          return prev.map(m => m.id === replaceMessageId ? aiReplyMsg : m);
        }
        return [...prev, aiReplyMsg];
      });
      return;
    }

    // =========================================================================
    // COMANDO 2: AJUSTE DO ÚLTIMO LANÇAMENTO ("ajuste o valor do último para R$...", etc.)
    // =========================================================================
    if (isAdjustLastCommand(text)) {
      const action = executeAdjustLastTransaction(text, transactions);
      if (action.updatedTransactions && action.modifiedTransaction) {
        setTransactions(action.updatedTransactions);
        kyroCloud.syncSaveTransaction(action.modifiedTransaction);
        syncSaveToCentralDb(action.modifiedTransaction);
        setWhatsappSyncToast({
          show: true,
          text: `✏️ Último lançamento atualizado: R$ ${action.modifiedTransaction.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}!`
        });
        setTimeout(() => setWhatsappSyncToast(null), 4000);
      }

      const aiReplyMsg: ChatMessage = {
        id: (Date.now() + 2).toString(),
        sender: 'ia',
        text: action.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => {
        if (replaceMessageId) {
          return prev.map(m => m.id === replaceMessageId ? aiReplyMsg : m);
        }
        return [...prev, aiReplyMsg];
      });
      return;
    }

    // =========================================================================
    // COMANDO 3: ENRIQUECER/ACRESCENTAR INFORMAÇÃO NO ÚLTIMO LANÇAMENTO
    // =========================================================================
    if (isEnrichLastCommand(text)) {
      const action = executeEnrichLastTransaction(text, transactions);
      if (action.updatedTransactions && action.modifiedTransaction) {
        setTransactions(action.updatedTransactions);
        kyroCloud.syncSaveTransaction(action.modifiedTransaction);
        syncSaveToCentralDb(action.modifiedTransaction);
        setWhatsappSyncToast({
          show: true,
          text: `➕ Informação acrescentada ao último lançamento!`
        });
        setTimeout(() => setWhatsappSyncToast(null), 4000);
      }

      const aiReplyMsg: ChatMessage = {
        id: (Date.now() + 2).toString(),
        sender: 'ia',
        text: action.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => {
        if (replaceMessageId) {
          return prev.map(m => m.id === replaceMessageId ? aiReplyMsg : m);
        }
        return [...prev, aiReplyMsg];
      });
      return;
    }

    // Extrai dados financeiros diretamente com o algoritmo dinâmico de alta precisão
    const parsed = parseDynamicFinancialMessage(text, isAudio, isImage);

    if (parsed) {
      // Caso 1: Cadastro de Dívida Recorrente (NÃO debita do saldo até o usuário dar o OK de paga!)
      if (parsed.isRecurring && parsed.recurringData) {
        const newRec = parsed.recurringData;
        setRecurringExpenses(prev => {
          const nextRecs = [newRec, ...prev];
          localStorage.setItem('kyro_recurring', JSON.stringify(nextRecs));
          syncSaveRecurringToCentralDb(nextRecs);
          return nextRecs;
        });
        kyroCloud.syncSaveRecurring(newRec);

        if (newRec.cardName) {
          const cardExists = creditCards.some(c => c.name.toLowerCase() === newRec.cardName?.toLowerCase());
          if (!cardExists) {
            const newCard: CreditCardData = {
              id: `card_${Date.now()}`,
              name: newRec.cardName,
              closingDay: 15,
              dueDay: newRec.dueDateDay || 20,
              limit: 5000,
              color: 'purple'
            };
            setCreditCards(prev => {
              const nextCards = [...prev, newCard];
              localStorage.setItem('kyro_credit_cards', JSON.stringify(nextCards));
              syncSaveCreditCardsToCentralDb(nextCards);
              return nextCards;
            });
          }
        }

        setWhatsappSyncToast({
          show: true,
          text: `🔁 Dívida Recorrente "${newRec.title}" salva! Ficará separada até você confirmar o pagamento.`
        });
        setTimeout(() => setWhatsappSyncToast(null), 5000);

        const aiReplyMsg: ChatMessage = {
          id: (Date.now() + 2).toString(),
          sender: 'ia',
          text: parsed.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setMessages(prev => {
          if (replaceMessageId) {
            return prev.map(m => m.id === replaceMessageId ? aiReplyMsg : m);
          }
          return [...prev, aiReplyMsg];
        });
        return;
      }

      // Caso 2: Confirmação de Pagamento de Dívida Recorrente ("Paguei a passagem aérea")
      if (parsed.isPaymentConfirmation) {
        const replyText = handleConfirmRecurringPaymentByName(parsed.paymentTargetName || parsed.object || '');
        const aiReplyMsg: ChatMessage = {
          id: (Date.now() + 2).toString(),
          sender: 'ia',
          text: replyText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setMessages(prev => {
          if (replaceMessageId) {
            return prev.map(m => m.id === replaceMessageId ? aiReplyMsg : m);
          }
          return [...prev, aiReplyMsg];
        });
        return;
      }

      // Caso 3: Lançamento Financeiro Avulso (Entrada ou Saída)
      if (parsed.savedTx) {
        const newTx: Transaction = {
          ...parsed.savedTx,
          status: 'Concluído'
        };

        if (newTx.cardName) {
          const cardExists = creditCards.some(c => c.name.toLowerCase() === newTx.cardName?.toLowerCase());
          if (!cardExists) {
            const newCard: CreditCardData = {
              id: `card_${Date.now()}`,
              name: newTx.cardName,
              closingDay: 15,
              dueDay: 20,
              limit: 5000,
              color: 'purple'
            };
            setCreditCards(prev => {
              const nextCards = [...prev, newCard];
              localStorage.setItem('kyro_credit_cards', JSON.stringify(nextCards));
              syncSaveCreditCardsToCentralDb(nextCards);
              return nextCards;
            });
          }
        }

        setTransactions(prev => [newTx, ...prev]);
        kyroCloud.syncSaveTransaction(newTx);
        syncSaveToCentralDb(newTx);

        const symbol = newTx.type === 'Entrada' ? '+' : '-';
        setWhatsappSyncToast({
          show: true,
          text: `Lançamento: ${newTx.description} (${symbol} R$ ${newTx.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) atualizado no Dashboard e nas abas!`
        });
        setTimeout(() => setWhatsappSyncToast(null), 5000);

        const aiReplyMsg: ChatMessage = {
          id: (Date.now() + 2).toString(),
          sender: 'ia',
          text: parsed.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setMessages(prev => {
          if (replaceMessageId) {
            return prev.map(m => m.id === replaceMessageId ? aiReplyMsg : m);
          }
          return [...prev, aiReplyMsg];
        });
        return;
      }
    }

    // Se não for lançamento financeiro direto nem comando de dívida, processa com o Motor Cognitivo Conversacional KYRO
    const reply = generateThinkingFinancialReply(text, {
      userName: userFullName,
      totalBalance,
      monthIncomes,
      monthExpenses,
      savingsRate,
      transactions,
      recurringExpenses,
      creditCards
    });

    const aiReplyMsg: ChatMessage = {
      id: (Date.now() + 2).toString(),
      sender: 'ia',
      text: reply,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => {
      if (replaceMessageId) {
        return prev.map(m => m.id === replaceMessageId ? aiReplyMsg : m);
      }
      return [...prev, aiReplyMsg];
    });
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isAiLoading) return;

    const userText = inputMessage;
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setIsAiLoading(true);

    try {
      await handleProcessUserInteraction({
        type: 'text',
        text: userText
      });
    } finally {
      setIsAiLoading(false);
    }
  };

  // Higienizador e desduplicador cirúrgico contra repetições de palavras e frases no reconhecimento de voz
  const cleanAndDeduplicateTranscript = (rawText: string): string => {
    if (!rawText) return '';
    let clean = rawText.replace(/\s+/g, ' ').trim();
    if (!clean) return '';

    // 1. Eliminação de frases ou blocos de palavras repetidas consecutivas (ex: "acabei de fazer acabei de fazer")
    let words = clean.split(' ');
    let changed = true;
    let maxLoops = 8;
    while (changed && maxLoops-- > 0 && words.length > 1) {
      changed = false;
      for (let len = Math.floor(words.length / 2); len >= 1; len--) {
        for (let i = 0; i + 2 * len <= words.length; i++) {
          const b1 = words.slice(i, i + len).map(w => w.toLowerCase().replace(/[,.!?;:]/g, '')).join(' ');
          const b2 = words.slice(i + len, i + 2 * len).map(w => w.toLowerCase().replace(/[,.!?;:]/g, '')).join(' ');
          if (b1 && b1 === b2) {
            words.splice(i + len, len);
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }

    // 2. Remove repetições consecutivas de palavras adjacentes idênticas
    const out: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const cur = words[i];
      const prev = out.length > 0 ? out[out.length - 1] : '';
      const curNorm = cur.toLowerCase().replace(/[,.!?;:]/g, '');
      const prevNorm = prev.toLowerCase().replace(/[,.!?;:]/g, '');
      if (curNorm && curNorm === prevNorm) {
        continue;
      }
      out.push(cur);
    }
    return out.join(' ').trim();
  };

  // Gravação de Áudio ao Vivo no Chat Lateral (Unificado Mobile & Desktop com Áudio Real + Gemini)
  const [liveAudioTranscript, setLiveAudioTranscript] = useState('');
  const recordedTextRef = React.useRef<string>('');
  const finalTranscriptRef = React.useRef<string>('');
  const isRecordingAudioRef = React.useRef<boolean>(false);

  const startRecordingAudio = async () => {
    try {
      isRecordingAudioRef.current = true;
      recordedTextRef.current = '';
      finalTranscriptRef.current = '';
      setLiveAudioTranscript('');

      // Formato de áudio suportado pelo dispositivo
      let selectedMimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          selectedMimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          selectedMimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          selectedMimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/aac')) {
          selectedMimeType = 'audio/aac';
        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
          selectedMimeType = 'audio/ogg';
        }
      }

      // 1. Reconhecimento de fala auxiliar (apenas para prévia visual enquanto fala, sem duplicações)
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const recognitionInstance = new SpeechRecognition();
          recognitionInstance.lang = 'pt-BR';
          recognitionInstance.continuous = true;
          recognitionInstance.interimResults = true;
          recognitionInstance.maxAlternatives = 1;

          recognitionInstance.onresult = (event: any) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const part = event.results[i][0]?.transcript || '';
              if (event.results[i].isFinal) {
                finalTranscriptRef.current += (finalTranscriptRef.current ? ' ' : '') + part;
              } else {
                interimTranscript += (interimTranscript ? ' ' : '') + part;
              }
            }
            const fullCombined = (finalTranscriptRef.current + ' ' + interimTranscript).trim();
            const cleaned = cleanAndDeduplicateTranscript(fullCombined);
            setLiveAudioTranscript(cleaned);
            setInputMessage(cleaned);
            recordedTextRef.current = cleaned;
          };

          recognitionInstance.onerror = (e: any) => {
            console.warn('[Speech Recognition Live Feedback]:', e.error || e);
          };

          recognitionInstance.onend = () => {
            // Não reinicia em loop para não sobrescrever nem duplicar áudio
          };

          recognitionInstance.start();
          speechRecognitionRef.current = recognitionInstance;
        } catch (e) {
          console.warn('[Speech Recognition Init Info]:', e);
        }
      }

      // 2. Captura do microfone real com filtros de cancelamento de ruído e eco
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000
        } 
      });

      const recorder = selectedMimeType 
        ? new MediaRecorder(stream, { mimeType: selectedMimeType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const mime = selectedMimeType || recorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mime });
        const audioUrl = URL.createObjectURL(audioBlob);
        stream.getTracks().forEach(track => track.stop());

        let finalText = cleanAndDeduplicateTranscript(recordedTextRef.current || liveAudioTranscript || inputMessage);

        // Extrai Base64 do áudio para envio multimodal
        let audioBase64 = '';
        if (audioBlob.size > 200) {
          try {
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => resolve('');
            });
            reader.readAsDataURL(audioBlob);
            audioBase64 = await base64Promise;
          } catch (e) {}
        }

        // Se o reconhecimento nativo não capturou nenhuma palavra, recorre à transcrição em nuvem
        if (!finalText && audioBase64) {
          const tempMsgId = `temp_audio_${Date.now()}`;
          setMessages(prev => [...prev, {
            id: tempMsgId,
            sender: 'user',
            text: '🎙️ [Áudio de Voz]: Interpretando sua voz com IA...',
            audioUrl,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }]);

          setInputMessage('');
          setLiveAudioTranscript('');
          setIsAiLoading(true);

          try {
            // Tenta 1: Endpoint relativo (Vite proxy para bot local ou Vercel)
            let res = await fetch('/api/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audioBase64, mimeType: mime, geminiApiKey: geminiApiKey || undefined })
            }).catch(() => null);

            // Tenta 2: Bot local direto na porta 3001 (se no desktop ou rede local)
            if (!res || !res.ok) {
              res = await fetch('http://localhost:3001/api/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audioBase64, mimeType: mime, geminiApiKey: geminiApiKey || undefined })
              }).catch(() => null);
            }

            // Tenta 3: Nuvem Vercel
            if (!res || !res.ok) {
              res = await fetch('https://kyro-finance.vercel.app/api/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audioBase64, mimeType: mime, geminiApiKey: geminiApiKey || undefined })
              }).catch(() => null);
            }

            if (res && res.ok) {
              const data = await res.json().catch(() => null);
              if (data?.success && data?.text) {
                finalText = cleanAndDeduplicateTranscript(data.text);
                setMessages(prev => prev.map(m => m.id === tempMsgId ? { ...m, text: `🎙️ "${finalText}"` } : m));
              }
            }
          } catch (err) {
            console.warn('[Audio Transcribe Fallback]:', err);
          } finally {
            setIsAiLoading(false);
          }
        }

        if (!finalText && !audioBase64) {
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            sender: 'ia',
            text: 'Não consegui captar a sua voz com nitidez neste momento. Por favor, fale mais próximo ao microfone ou digite na caixa de texto.',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }]);
          return;
        }

        setMessages(prev => {
          const alreadyHas = prev.some(m => m.audioUrl === audioUrl);
          if (alreadyHas) return prev;
          return [...prev, {
            id: Date.now().toString(),
            sender: 'user',
            text: finalText ? `🎙️ "${finalText}"` : '🎙️ [Áudio enviado ao Gemini 1.5 Flash]',
            audioUrl,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }];
        });

        setInputMessage('');
        setLiveAudioTranscript('');

        await handleProcessUserInteraction({
          type: 'audio',
          text: finalText || 'Por favor analise este áudio e realize o lançamento ou comando financeiro.',
          audioUrl,
          audioBase64,
          audioMimeType: mime
        });
      };

      recorder.start(250);
      mediaRecorderRef.current = recorder;

      setIsRecordingAudio(true);
      setAudioRecordingTime(0);

      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        setAudioRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err: any) {
      isRecordingAudioRef.current = false;
      setIsRecordingAudio(false);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender: 'ia',
        text: 'Não foi possível acessar o microfone do seu dispositivo. Por favor, autorize a permissão de áudio nas configurações do aparelho ou digite diretamente na caixa de texto.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    }
  };

  const stopRecordingAudio = async () => {
    isRecordingAudioRef.current = false;
    setIsRecordingAudio(false);

    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch (e) {}
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { 
        mediaRecorderRef.current.stop(); 
      } catch (e) {
        console.warn('[MediaRecorder Stop Erro]:', e);
      }
    } else {
      const finalText = cleanAndDeduplicateTranscript(recordedTextRef.current || liveAudioTranscript || inputMessage);
      if (finalText) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          sender: 'user',
          text: `🎙️ "${finalText}"`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
        setInputMessage('');
        setLiveAudioTranscript('');
        await handleProcessUserInteraction({
          type: 'audio',
          text: finalText
        });
      }
    }
  };

  // Upload e Análise IA de Documento (Foto, Câmera ou PDF)
  const handleFileAttachmentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Url = reader.result as string;
      await handleProcessDocumentAttachment(file, base64Url, isPdf);
    };
    reader.readAsDataURL(file);
  };

  const handleProcessDocumentAttachment = async (file: File, fileUrl: string, isPdf: boolean) => {
    setIsOcrProcessing(true);

    const userDocMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: isPdf 
        ? `📄 [Documento PDF Anexado: "${file.name}"]` 
        : '📸 [Foto / Comprovante Anexado para Análise da IA]',
      imageUrl: isPdf ? undefined : fileUrl,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, userDocMsg]);

    const loadingId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, {
      id: loadingId,
      sender: 'ia',
      text: isPdf ? '⏳ Analisando PDF com Google Gemini 1.5 Flash...' : '⏳ Analisando comprovante com Google Gemini 1.5 Flash (Multimodal)...',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }]);

    try {
      let extractedText = '';
      try {
        const docResult = await processUploadedFinancialDocument(file, fileUrl);
        extractedText = docResult.text;
        console.log('📄 [Texto Extraído do Documento]:', extractedText);
      } catch (ocrErr) {
        console.warn('[OCR Fallback]:', ocrErr);
      }

      await handleProcessUserInteraction({
        type: 'image',
        text: extractedText || file.name.replace(/[._-]/g, ' '),
        imageUrl: isPdf ? undefined : fileUrl,
        imageBase64: fileUrl,
        imageMimeType: file.type || (isPdf ? 'application/pdf' : 'image/jpeg'),
        replaceMessageId: loadingId
      });
    } catch (err: any) {
      console.warn('[Process Document Error]:', err);
      await handleProcessUserInteraction({
        type: 'image',
        text: file.name.replace(/[._-]/g, ' '),
        imageUrl: isPdf ? undefined : fileUrl,
        imageBase64: fileUrl,
        imageMimeType: file.type || (isPdf ? 'application/pdf' : 'image/jpeg'),
        replaceMessageId: loadingId
      });
    } finally {
      setIsOcrProcessing(false);
    }
  };

  // Filtragem
  const filteredTransactions = transactions.filter(t => {
    const matchSearch = t.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
                        (t.product && t.product.toLowerCase().includes(searchTerm.toLowerCase())) ||
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
              onClick={() => { setActiveTab('cartoes'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'cartoes'
                  ? 'bg-gradient-to-r from-purple-500/20 to-indigo-500/10 text-purple-300 border border-purple-500/40 shadow-[0_0_22px_rgba(168,85,247,0.22)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <CreditCard size={19} className={activeTab === 'cartoes' ? 'text-purple-400' : 'text-slate-400'} />
                <span>Cartões de Crédito</span>
              </div>
              {hasAnyCardDueSoon && (
                <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full font-bold animate-pulse">
                  Alerta
                </span>
              )}
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
              onClick={() => { setChatOpenMobile(true); setMobileMenuOpen(false); }}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 text-amber-300 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-purple-500/15 border border-amber-500/30 hover:border-amber-400 hover:bg-amber-500/20 cursor-pointer shadow-sm"
            >
              <div className="flex items-center gap-3.5">
                <Sparkles size={19} className="text-amber-400 animate-pulse" />
                <span>Chat Gemini 1.5 Flash</span>
              </div>
              <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full font-bold">
                IA
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
              {/* ================= ALERTA DE DÍVIDAS RECORRENTES (5 DIAS OU EM ATRASO) ================= */}
              {(() => {
                const pendingAlerts = recurringExpenses.filter(r => {
                  if (r.paid || !r.active) return false;
                  const today = new Date().getDate();
                  const due = r.dueDateDay || 10;
                  return today > due || (due - today <= 5 && due >= today);
                });

                if (pendingAlerts.length === 0) return null;

                const overdueCount = pendingAlerts.filter(r => new Date().getDate() > (r.dueDateDay || 10)).length;
                const upcomingCount = pendingAlerts.length - overdueCount;

                return (
                  <div className="p-4 rounded-2xl bg-[#1B1812] border border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.15)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in mb-2">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/40">
                        <AlertCircle size={22} className="animate-pulse" />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-amber-300 flex items-center gap-2">
                          Alertas de Vencimento de Dívidas Recorrentes
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-300 font-extrabold border border-amber-500/40">
                            {pendingAlerts.length} {pendingAlerts.length === 1 ? 'pendência' : 'pendências'}
                          </span>
                        </h4>
                        <p className="text-xs text-slate-300 mt-0.5">
                          {overdueCount > 0 && <span className="text-red-400 font-bold mr-2">🔴 {overdueCount} em atraso</span>}
                          {upcomingCount > 0 && <span className="text-amber-300 font-medium">🟡 {upcomingCount} vencendo em até 5 dias</span>}
                          <span className="text-slate-400 ml-1.5">• Não debitadas do saldo até você dar o OK de paga!</span>
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setActiveKpiModal('saidas'); setSaidasTab('recorrentes'); }}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:brightness-110 text-slate-950 font-bold text-xs transition-all shadow-md shrink-0 flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 size={15} /> Conferir & Dar Baixa
                    </button>
                  </div>
                );
              })()}

              {/* ================= ALERTA DE VENCIMENTO DE FATURA DE CARTÕES DE CRÉDITO ================= */}
              {(() => {
                const cardsDueSoon = creditCards.filter(card => {
                  const metrics = getCardMetrics(card);
                  return metrics.currentInvoiceTotal > 0 && (metrics.isDueSoon || metrics.isOverdue);
                });

                if (cardsDueSoon.length === 0) return null;

                return (
                  <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-950/40 via-[#1A1429] to-[#12172A] border border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.18)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-purple-500/20 text-purple-300 flex items-center justify-center shrink-0 border border-purple-500/40">
                        <CreditCard size={22} className="animate-pulse" />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-purple-200 flex items-center gap-2">
                          Aviso de Vencimento de Cartão de Crédito
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/20 text-purple-300 font-extrabold border border-purple-500/40">
                            {cardsDueSoon.length} {cardsDueSoon.length === 1 ? 'cartão' : 'cartões'}
                          </span>
                        </h4>
                        <div className="text-xs text-slate-300 mt-1 flex flex-wrap gap-2">
                          {cardsDueSoon.map(card => {
                            const m = getCardMetrics(card);
                            return (
                              <span key={card.id} className="inline-flex items-center gap-1 bg-purple-900/30 px-2 py-0.5 rounded-md border border-purple-500/30 text-purple-200">
                                💳 <strong>{card.name}</strong>: Fatura R$ {m.currentInvoiceTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2})} • 
                                {m.isOverdue ? (
                                  <span className="text-red-400 font-bold">Venceu dia {card.dueDay}!</span>
                                ) : (
                                  <span className="text-amber-300 font-bold">Vence em {m.daysUntilDue} {m.daysUntilDue === 1 ? 'dia' : 'dias'} (Dia {card.dueDay})</span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setActiveTab('cartoes')}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:brightness-110 text-white font-bold text-xs transition-all shadow-md shrink-0 flex items-center justify-center gap-1.5"
                    >
                      <CreditCard size={15} /> Ver Faturas dos Cartões
                    </button>
                  </div>
                );
              })()}

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
                      {filteredTransactions.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-slate-400">
                            <p className="text-xs text-slate-400">Nenhum lançamento recente. O extrato está 100% limpo.</p>
                          </td>
                        </tr>
                      )}
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
                  {selectedTxTabIds.size > 0 && (
                    <button 
                      onClick={() => handleBulkDeleteTransactions(selectedTxTabIds, 'transações')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all shadow-md ml-1"
                    >
                      <Trash2 size={13} /> Excluir ({selectedTxTabIds.size})
                    </button>
                  )}
                  {transactions.length > 0 && (
                    <button 
                      onClick={handleClearAllTransactions}
                      title="Excluir todos os lançamentos permanentemente e zerar o banco de dados"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 hover:text-white border border-rose-600/40 text-xs font-bold transition-all ml-1 cursor-pointer"
                    >
                      <Trash2 size={13} /> Zerar Extrato
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#1E2740] text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      <th className="pb-3 pl-3 w-10">
                        <input 
                          type="checkbox"
                          checked={filteredTransactions.length > 0 && filteredTransactions.every(t => selectedTxTabIds.has(t.id))}
                          onChange={() => {
                            if (filteredTransactions.length > 0 && filteredTransactions.every(t => selectedTxTabIds.has(t.id))) {
                              setSelectedTxTabIds(new Set());
                            } else {
                              setSelectedTxTabIds(new Set(filteredTransactions.map(t => t.id)));
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500 cursor-pointer accent-amber-500"
                          title="Selecionar todas as transações da lista"
                        />
                      </th>
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
                      <tr 
                        key={tx.id} 
                        onClick={() => setSelectedTx(tx)} 
                        className={`transition-colors cursor-pointer ${
                          selectedTxTabIds.has(tx.id) ? 'bg-amber-500/10 hover:bg-amber-500/15' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-3.5 pl-3" onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="checkbox"
                            checked={selectedTxTabIds.has(tx.id)}
                            onChange={() => handleToggleSelectTxTab(tx.id)}
                            className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500 cursor-pointer accent-amber-500"
                          />
                        </td>
                        <td className="py-3.5 pl-2 font-semibold text-slate-100">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {tx.product ? (
                              <>
                                <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold">
                                  {tx.product}
                                </span>
                                <span className="text-slate-400 font-normal text-xs">em</span>
                                <span className="text-slate-100">{tx.description}</span>
                              </>
                            ) : (
                              <span>{tx.description}</span>
                            )}
                            {tx.totalInstallments && tx.totalInstallments > 0 && (
                              <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded-full font-bold">
                                {tx.currentInstallment}/{tx.totalInstallments}
                              </span>
                            )}
                          </div>
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
                    {filteredTransactions.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400">
                          <div className="flex flex-col items-center justify-center gap-2">
                            <div className="h-12 w-12 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center text-slate-500">
                              <ArrowLeftRight size={22} />
                            </div>
                            <p className="text-sm font-semibold text-slate-300">Nenhum lançamento no extrato</p>
                            <p className="text-xs text-slate-500 max-w-sm">
                              Adicione uma entrada ou saída pelo botão "+ Adicionar" ou dite mensagens/áudios no Chat com o Gemini!
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
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

              {/* Relatório de Vinculação de Gastos por Produto */}
              <div className="p-5 rounded-xl bg-[#141A2E] border border-[#222C46] space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-amber-400 flex items-center gap-2">
                    <Layers size={16} /> Relatório de Gastos por Produto & Vinculação
                  </h4>
                  <span className="text-xs text-slate-400">Classificação inteligente automática</span>
                </div>

                {(() => {
                  const productMap = new Map<string, { product: string; total: number; count: number; locations: Set<string>; categories: Set<string> }>();
                  transactions.filter(t => t.type === 'Saída').forEach(t => {
                    const prodKey = (t.product || t.description).trim();
                    const estKey = (t.establishment || t.description).trim();
                    if (!productMap.has(prodKey)) {
                      productMap.set(prodKey, {
                        product: prodKey,
                        total: 0,
                        count: 0,
                        locations: new Set(),
                        categories: new Set()
                      });
                    }
                    const item = productMap.get(prodKey)!;
                    item.total += t.amount;
                    item.count += 1;
                    if (estKey) item.locations.add(estKey);
                    if (t.category) item.categories.add(t.category);
                  });

                  const sortedProducts = Array.from(productMap.values()).sort((a, b) => b.total - a.total);

                  if (sortedProducts.length === 0) {
                    return <p className="text-xs text-slate-500 py-3">Nenhum produto registrado ainda.</p>;
                  }

                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[#1E2740] text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                            <th className="pb-2.5">Produto</th>
                            <th className="pb-2.5">Categoria</th>
                            <th className="pb-2.5">Estabelecimento / Local Vinculado</th>
                            <th className="pb-2.5 text-center">Compras</th>
                            <th className="pb-2.5 text-right">Total Gasto</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#1E2740]/50">
                          {sortedProducts.map((p, idx) => (
                            <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                              <td className="py-2.5 font-bold text-slate-100 flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-amber-400"></span>
                                {p.product}
                              </td>
                              <td className="py-2.5 text-slate-300">
                                <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-medium">
                                  {Array.from(p.categories).join(', ') || 'Geral'}
                                </span>
                              </td>
                              <td className="py-2.5 text-slate-400">
                                {Array.from(p.locations).join(', ') || 'Estabelecimento'}
                              </td>
                              <td className="py-2.5 text-center text-slate-300">{p.count}x</td>
                              <td className="py-2.5 text-right font-bold text-orange-400">
                                R$ {p.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ===================== ABA DEDICADA: CARTÕES DE CRÉDITO & FATURAS ===================== */}
          {activeTab === 'cartoes' && (
            <div className="space-y-6 animate-in fade-in">
              {/* Header da Aba */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg">
                <div>
                  <h2 className="text-xl md:text-2xl font-extrabold text-white flex items-center gap-2.5">
                    <span className="p-2 rounded-xl bg-purple-500/15 text-purple-400 border border-purple-500/30">
                      <CreditCard size={22} />
                    </span>
                    Cartões de Crédito & Faturas
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Visualize o total a pagar da fatura atual, parcelamentos futuros e limites separados por cada cartão.
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => setNewCardModalOpen(true)}
                    className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:brightness-110 text-white font-bold text-xs transition-all shadow-md flex items-center gap-2"
                  >
                    <Plus size={16} /> Cadastrar Cartão
                  </button>
                </div>
              </div>

              {/* Sub-abas / Filtro por Cartão */}
              <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
                <button
                  onClick={() => setSelectedCardId('todos')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-2 border ${
                    selectedCardId === 'todos'
                      ? 'bg-purple-600/20 text-purple-300 border-purple-500/50 shadow-md'
                      : 'bg-[#12172A] text-slate-400 border-[#202940] hover:text-white'
                  }`}
                >
                  <Layers size={14} /> Todos os Cartões ({creditCards.length})
                </button>

                {creditCards.map(c => {
                  const m = getCardMetrics(c);
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCardId(c.id)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-2 border ${
                        selectedCardId === c.id
                          ? 'bg-purple-600 text-white border-purple-400 shadow-lg shadow-purple-600/30'
                          : 'bg-[#12172A] text-slate-400 border-[#202940] hover:text-white'
                      }`}
                    >
                      <span className={`h-2.5 w-2.5 rounded-full ${
                        c.color === 'purple' ? 'bg-purple-400' :
                        c.color === 'orange' ? 'bg-orange-400' :
                        c.color === 'blue' ? 'bg-blue-400' :
                        c.color === 'red' ? 'bg-red-400' : 'bg-emerald-400'
                      }`}></span>
                      <span>{c.name}</span>
                      {m.currentInvoiceTotal > 0 && (
                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                          m.isOverdue ? 'bg-red-500/30 text-red-300' : m.isDueSoon ? 'bg-amber-500/30 text-amber-300' : 'bg-slate-800 text-slate-300'
                        }`}>
                          R$ {m.currentInvoiceTotal.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Grid de Cartões Físicos / Visual */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {(selectedCardId === 'todos' ? creditCards : creditCards.filter(c => c.id === selectedCardId)).map(card => {
                  const m = getCardMetrics(card);
                  const limitPercent = Math.min(100, Math.round((m.totalCommitted / m.limitTotal) * 100));

                  const gradientClass = 
                    card.color === 'purple' ? 'from-purple-900 via-indigo-950 to-[#0A0D18] border-purple-500/40' :
                    card.color === 'orange' ? 'from-orange-900 via-amber-950 to-[#0A0D18] border-orange-500/40' :
                    card.color === 'blue' ? 'from-blue-900 via-sky-950 to-[#0A0D18] border-blue-500/40' :
                    card.color === 'red' ? 'from-red-900 via-rose-950 to-[#0A0D18] border-red-500/40' :
                    'from-slate-800 via-zinc-900 to-[#0A0D18] border-slate-600';

                  return (
                    <div 
                      key={card.id}
                      className={`relative rounded-3xl p-6 bg-gradient-to-br ${gradientClass} border shadow-2xl space-y-4 flex flex-col justify-between overflow-hidden group`}
                    >
                      {/* Efeito Glow */}
                      <div className="absolute top-0 right-0 w-36 h-36 bg-white/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>

                      <div>
                        {/* Topo do Cartão */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-base tracking-wide text-white drop-shadow">
                              {card.name.toUpperCase()}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-slate-300 font-semibold border border-white/10 uppercase tracking-wider">
                              Black Private
                            </span>
                          </div>
                          <button
                            onClick={() => handleDeleteCard(card.id)}
                            title="Remover Cartão"
                            className="p-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        {/* Chip e Contactless */}
                        <div className="flex items-center gap-3 my-4">
                          <div className="w-10 h-7 rounded-md bg-gradient-to-tr from-amber-400 via-yellow-200 to-amber-500 border border-amber-300/40 shadow-inner flex items-center justify-center">
                            <div className="w-6 h-4 border border-amber-800/40 rounded-sm"></div>
                          </div>
                          <Zap size={16} className="text-amber-300/70 rotate-90" />
                        </div>

                        {/* Número mascarado */}
                        <p className="font-mono text-sm tracking-widest text-slate-200 drop-shadow">
                          •••• •••• •••• {card.lastDigits || '4821'}
                        </p>
                      </div>

                      {/* Dados de Fatura e Vencimento */}
                      <div className="space-y-3 pt-3 border-t border-white/10">
                        <div className="flex justify-between items-end">
                          <div>
                            <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">Fatura Atual</span>
                            <span className="text-xl font-black text-white">
                              R$ {m.currentInvoiceTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                            </span>
                          </div>

                          <div className="text-right">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold inline-block ${
                              m.isOverdue ? 'bg-red-500/20 text-red-300 border-red-500/40' :
                              m.isDueSoon ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse' :
                              'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            }`}>
                              {m.isOverdue ? `🔴 Venceu dia ${card.dueDay}` :
                               m.isDueSoon ? (m.daysUntilDue === 0 ? '🟡 Vence HOJE!' : `🟡 Vence em ${m.daysUntilDue}d`) :
                               `🟢 Vence dia ${card.dueDay}`}
                            </span>
                            <p className="text-[10px] text-slate-400 mt-1">Fecha dia {card.closingDay}</p>
                          </div>
                        </div>

                        {/* Barra de Limite */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-slate-300">
                            <span>Limite Usado: <strong>{limitPercent}%</strong></span>
                            <span>Disponível: R$ {m.limitAvailable.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</span>
                          </div>
                          <div className="w-full bg-black/40 h-1.5 rounded-full overflow-hidden border border-white/5">
                            <div 
                              className={`h-full rounded-full transition-all ${
                                limitPercent > 85 ? 'bg-red-500' : limitPercent > 50 ? 'bg-amber-400' : 'bg-emerald-400'
                              }`}
                              style={{ width: `${limitPercent}%` }}
                            ></div>
                          </div>
                        </div>

                        {/* Botão de Pagar Fatura */}
                        {m.currentInvoiceTotal > 0 && (
                          <button
                            type="button"
                            onClick={() => handlePayCardInvoice(card)}
                            className="w-full py-2 rounded-xl bg-white/10 hover:bg-emerald-600 hover:text-white text-slate-200 font-bold text-xs transition-all border border-white/10 flex items-center justify-center gap-1.5 shadow-md"
                          >
                            <CheckCircle2 size={14} /> Dar Baixa / Pagar Fatura
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Detalhes de Lançamentos e Parcelamentos por Cartão */}
              {(() => {
                const targetCard = selectedCardId === 'todos' ? null : creditCards.find(c => c.id === selectedCardId);

                // Transações no crédito filtradas
                const displayedTxs = transactions.filter(t => 
                  t.type === 'Saída' && (
                    t.method === 'Crédito' || t.category === 'Cartão de Crédito'
                  ) && (
                    !targetCard || t.cardName?.toLowerCase() === targetCard.name.toLowerCase()
                  )
                );

                // Dívidas recorrentes / parcelamentos filtrados
                const displayedRecs = recurringExpenses.filter(r => 
                  r.active && (
                    r.method === 'Crédito' || r.cardName || r.totalInstallments > 1
                  ) && (
                    !targetCard || r.cardName?.toLowerCase() === targetCard.name.toLowerCase()
                  )
                );

                return (
                  <div className="bg-[#111628] rounded-2xl border border-[#202940] p-6 shadow-lg space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1E2740] pb-4">
                      <div>
                        <h3 className="text-base font-bold text-white flex items-center gap-2">
                          <Layers size={18} className="text-purple-400" />
                          Lançamentos & Parcelamentos {targetCard ? `do ${targetCard.name}` : '(Todos os Cartões)'}
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {displayedTxs.length} compras na fatura e {displayedRecs.length} dívidas parceladas/recorrentes registradas.
                        </p>
                      </div>

                      {/* Seletor interno: Fatura Atual vs Parcelas Futuras */}
                      <div className="flex rounded-xl bg-[#0B0E18] p-1 border border-[#1E2740]">
                        <button
                          onClick={() => setCartoesInnerTab('fatura')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            cartoesInnerTab === 'fatura'
                              ? 'bg-purple-600 text-white shadow'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Fatura Atual ({displayedTxs.length})
                        </button>
                        <button
                          onClick={() => setCartoesInnerTab('recorrentes')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            cartoesInnerTab === 'recorrentes'
                              ? 'bg-purple-600 text-white shadow'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Dívidas Parceladas / Recorrentes ({displayedRecs.length})
                        </button>
                      </div>
                    </div>

                    {/* Conteúdo Aba A: Fatura Atual (Transações Avulsas no Crédito) */}
                    {cartoesInnerTab === 'fatura' && (
                      <div className="space-y-3">
                        {displayedTxs.length === 0 ? (
                          <div className="py-12 text-center text-slate-500">
                            <CreditCard size={36} className="mx-auto mb-2 opacity-30 text-purple-400" />
                            <p className="text-xs font-medium">Nenhum lançamento no crédito registrado neste cartão ainda.</p>
                            <p className="text-[11px] text-slate-600 mt-1">Diga ou mande por áudio no WhatsApp: "Passei R$ 120 no crédito Nubank restaurante Oeiras"</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {displayedTxs.map(t => (
                              <div key={t.id} className="p-3.5 rounded-xl bg-[#141A2E] border border-[#202940] flex items-center justify-between gap-3 hover:border-purple-500/40 transition-all">
                                <div className="flex items-center gap-3">
                                  <div className="h-9 w-9 rounded-xl bg-purple-500/15 text-purple-400 flex items-center justify-center font-bold">
                                    💳
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <h4 className="font-bold text-xs text-white">{t.description}</h4>
                                      {t.cardName && (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-900/40 text-purple-300 border border-purple-500/30 font-semibold">
                                          {t.cardName}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                      {t.category} {t.city ? `• ${t.city}` : ''} • {t.date}
                                    </p>
                                  </div>
                                </div>

                                <div className="text-right">
                                  <span className="font-extrabold text-sm text-red-400 block">
                                    - R$ {t.amount.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                                  </span>
                                  <span className="text-[10px] text-slate-500">Crédito</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Conteúdo Aba B: Dívidas Parceladas / Recorrentes vinculadas ao Cartão */}
                    {cartoesInnerTab === 'recorrentes' && (
                      <div className="space-y-3">
                        {displayedRecs.length === 0 ? (
                          <div className="py-12 text-center text-slate-500">
                            <Repeat size={36} className="mx-auto mb-2 opacity-30 text-amber-400" />
                            <p className="text-xs font-medium">Nenhum parcelamento ativo neste cartão.</p>
                            <p className="text-[11px] text-slate-600 mt-1">Diga: "Adicione dívida no crédito Nubank de 800 dividida em 5x"</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            {displayedRecs.map(rec => {
                              const st = getRecurringStatus(rec);
                              return (
                                <div key={rec.id} className={`p-4 rounded-xl border space-y-3 transition-all ${
                                  rec.paid ? 'bg-[#0E1526] border-emerald-500/30' : 'bg-[#141A2E] border-[#222C46]'
                                }`}>
                                  <div className="flex justify-between items-start">
                                    <div>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="font-bold text-slate-100 text-xs">{rec.title}</h4>
                                        {rec.cardName && (
                                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-900/40 text-purple-300 border border-purple-500/30 font-semibold">
                                            💳 {rec.cardName}
                                          </span>
                                        )}
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] border ${st.badgeClass}`}>
                                          {st.label}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-amber-400/90 font-medium mt-1">
                                        Vencimento: <strong>{rec.dueDateText || `Dia ${rec.dueDateDay}`}</strong>
                                      </p>
                                    </div>

                                    <div className="text-right">
                                      <span className="font-extrabold text-white text-sm">
                                        R$ {rec.installmentAmount.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                                      </span>
                                      <span className="text-[10px] text-slate-400 block">/mês</span>
                                    </div>
                                  </div>

                                  {/* Progresso de Parcelas */}
                                  {rec.totalInstallments > 0 && (
                                    <div className="pt-2 border-t border-[#1E2740] space-y-1">
                                      <div className="flex justify-between text-[11px] text-slate-300">
                                        <span>Parcela: <strong>{rec.currentInstallment} de {rec.totalInstallments}</strong></span>
                                        <span>Total: R$ {rec.totalAmount.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                                      </div>
                                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                        <div 
                                          className={`h-full rounded-full ${rec.paid ? 'bg-emerald-500' : 'bg-gradient-to-r from-purple-500 to-indigo-500'}`}
                                          style={{ width: `${Math.round((rec.currentInstallment / rec.totalInstallments) * 100)}%` }}
                                        ></div>
                                      </div>
                                    </div>
                                  )}

                                  {/* Ação de baixa */}
                                  <div className="flex items-center justify-between pt-1">
                                    <span className="text-[11px] text-slate-400">
                                      {rec.paid ? '✅ Parcela debitada nas saídas' : '⏸️ Aguardando confirmação de paga'}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      {!rec.paid ? (
                                        <button
                                          type="button"
                                          onClick={() => handleMarkRecurringAsPaid(rec.id)}
                                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all flex items-center gap-1"
                                        >
                                          <CheckCircle2 size={13} /> Pagar
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => handleUnmarkRecurringPaid(rec.id)}
                                          className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-all"
                                        >
                                          Desfazer
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteRecurring(rec.id)}
                                        className="p-1 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
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

                {/* 3. Atualização e Versão do Aplicativo (In-App Auto-Update) */}
                <div className="p-5 rounded-xl bg-[#141A2E] border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="h-11 w-11 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center font-bold">
                      <Smartphone size={24} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-slate-200">Aplicativo Android (KYRO Finance)</h4>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          v{CURRENT_APP_VERSION} (Build {CURRENT_APP_BUILD})
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Atualizações automáticas diretas pelo aplicativo com 1 toque, sem precisar de Play Store
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button 
                      type="button"
                      onClick={handleManualCheckUpdate}
                      disabled={isCheckingUpdateManual}
                      className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:brightness-110 text-slate-950 text-xs font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw size={14} className={isCheckingUpdateManual ? 'animate-spin' : ''} />
                      <span>{isCheckingUpdateManual ? 'Verificando...' : 'Verificar Atualização'}</span>
                    </button>
                  </div>
                </div>

                {/* 3. Limpeza Geral e Reset de Lançamentos */}
                <div className="p-5 rounded-xl bg-[#141A2E] border border-rose-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="h-11 w-11 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center font-bold">
                      <Trash2 size={24} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-200">Zerar Base de Dados & Lançamentos</h4>
                      <p className="text-xs text-slate-400">
                        {transactions.length > 0 
                          ? `Atualmente há ${transactions.length} lançamento(s) registrados. Clique para apagar tudo e zerar o saldo.`
                          : 'A base está atualmente zerada e sem nenhum lançamento.'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button 
                      onClick={handleClearAllTransactions}
                      disabled={transactions.length === 0}
                      className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 size={14} /> Zerar Lançamentos ({transactions.length})
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* Backdrop suave para o chat no celular */}
      {chatOpenMobile && (
        <div 
          onClick={() => setChatOpenMobile(false)}
          className="fixed inset-0 bg-black/75 backdrop-blur-sm z-30 lg:hidden transition-opacity duration-300"
        />
      )}

      {/* ===================== SIDEBAR DIREITA: ASSISTENTE IA & WHATSAPP ===================== */}
      <aside className={`
        fixed inset-y-0 right-0 z-40 w-full sm:w-96 lg:w-96 max-w-full bg-[#0E1322] border-l border-[#1B2338] flex flex-col justify-between transition-transform duration-300 ease-in-out shadow-2xl
        lg:static lg:translate-x-0 ${chatOpenMobile ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-4 border-b border-[#1B2338]/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber-500/20 via-orange-500/20 to-purple-500/20 text-amber-400 flex items-center justify-center border border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
              <Sparkles size={16} className="text-amber-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-sm text-white">Gemini 1.5 Flash</h3>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">IA</span>
              </div>
              <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span> 
                {geminiApiKey ? 'Chave Ativa • Multimodal' : 'Google AI Multimodal • Ativo'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button 
              type="button"
              onClick={() => setIsGeminiModalOpen(true)}
              title="Configurar Chave e Formatação do Gemini"
              className="p-1.5 px-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:border-amber-400 transition-all flex items-center gap-1 text-[11px] font-bold cursor-pointer"
            >
              <Sliders size={13} className="text-amber-400" />
              <span>Ajustes</span>
            </button>
            <button onClick={() => setChatOpenMobile(false)} className="lg:hidden text-slate-400 hover:text-white p-1">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 p-4 overflow-y-auto space-y-3.5">
          {messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div className={`max-w-[88%] p-3.5 rounded-2xl text-xs leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-[#6D3811] text-amber-100 rounded-tr-none shadow-md border border-amber-600/40 whitespace-pre-line'
                  : 'bg-[#151C30] border border-[#202940] text-slate-200 rounded-tl-none shadow-sm'
              }`}>
                {msg.imageUrl && (
                  <div className="mb-2 overflow-hidden rounded-lg border border-slate-700/50">
                    <img src={msg.imageUrl} alt="Comprovante" className="max-h-48 w-full object-cover rounded-lg" />
                  </div>
                )}
                {msg.sender === 'user' ? msg.text : renderFormattedMessageText(msg.text)}
                {msg.sender === 'ia' && (
                  <div className="flex items-center justify-between gap-2 mt-2 pt-1 border-t border-slate-700/40 text-[9px] text-amber-400/70">
                    <span className="flex items-center gap-1">
                      <Sparkles size={10} className="text-amber-400" />
                      {msg.engine === 'kyro-local-engine' ? 'Motor Cognitivo KYRO' : 'Google Gemini 1.5 Flash'}
                    </span>
                    <span className="text-slate-500">{msg.timestamp}</span>
                  </div>
                )}
                {msg.audioUrl && (
                  <div className="mt-2 w-full pt-1">
                    <audio src={msg.audioUrl} controls className="w-full h-8 rounded" />
                  </div>
                )}

                {/* Card Interativo de Seleção e Remoção Múltipla */}
                {msg.actionableTransactions && msg.actionableTransactions.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-700/60 flex flex-col gap-2">
                    {msg.actionCompleted ? (
                      <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2">
                        <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                        <span>Ação já concluída para esta mensagem.</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between text-[11px] text-amber-300 font-bold mb-1">
                          <span>Selecione quais deseja cancelar:</span>
                          <button
                            type="button"
                            onClick={() => {
                              const allIds = msg.actionableTransactions!.map(t => t.id);
                              const allSelected = allIds.every(id => selectedTxIdsForRemoval.has(id));
                              setSelectedTxIdsForRemoval(prev => {
                                const next = new Set(prev);
                                if (allSelected) {
                                  allIds.forEach(id => next.delete(id));
                                } else {
                                  allIds.forEach(id => next.add(id));
                                }
                                return next;
                              });
                            }}
                            className="text-[10px] text-amber-400/80 hover:text-amber-300 underline"
                          >
                            {msg.actionableTransactions.every(t => selectedTxIdsForRemoval.has(t.id)) ? 'Desmarcar Todos' : 'Marcar Todos'}
                          </button>
                        </div>

                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                          {msg.actionableTransactions.map(tx => {
                            const isSelected = selectedTxIdsForRemoval.has(tx.id);
                            return (
                              <div
                                key={tx.id}
                                className={`p-2.5 rounded-xl border transition-all flex items-start justify-between gap-2.5 ${
                                  isSelected
                                    ? 'bg-amber-500/15 border-amber-500/60 shadow-sm'
                                    : 'bg-[#0E1322]/90 border-slate-700/70 hover:border-slate-600'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleSelectTxForRemoval(tx.id)}
                                  className="flex items-start gap-2 text-left flex-1 cursor-pointer"
                                >
                                  <div className="pt-0.5 text-amber-400">
                                    {isSelected ? <CheckSquare size={16} /> : <Square size={16} className="text-slate-500" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-1">
                                      <p className="font-bold text-slate-100 text-xs truncate">
                                        {tx.product || tx.description}
                                      </p>
                                      <span className={`text-[11px] font-bold shrink-0 ${tx.type === 'Saída' ? 'text-rose-400' : 'text-emerald-400'}`}>
                                        {tx.type === 'Saída' ? '- ' : '+ '}R$ {tx.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                      </span>
                                    </div>
                                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                                      📍 {tx.city || 'Local'} • 🏢 {tx.establishment || tx.category || 'Geral'}
                                    </p>
                                    <p className="text-[9px] text-slate-500 mt-0.5">
                                      📅 {tx.date} • 💳 {tx.method}{tx.cardName ? ` (${tx.cardName})` : ''}
                                    </p>
                                  </div>
                                </button>

                                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingTxFromChat({ ...tx });
                                    }}
                                    title="Ajustar / Editar este lançamento"
                                    className="p-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 transition-all cursor-pointer"
                                  >
                                    <Sliders size={13} />
                                  </button>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveSpecificTransactions([tx.id], msg.id);
                                    }}
                                    title="Excluir este lançamento agora"
                                    className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 transition-all shrink-0 cursor-pointer"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Botão de Excluir Selecionados */}
                        <div className="mt-2 pt-2 border-t border-slate-700/40 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={selectedTxIdsForRemoval.size === 0}
                            onClick={() => {
                              const idsToDelete = Array.from(selectedTxIdsForRemoval).filter(id => 
                                msg.actionableTransactions?.some(t => t.id === id)
                              );
                              if (idsToDelete.length > 0) {
                                handleRemoveSpecificTransactions(idsToDelete, msg.id);
                              }
                            }}
                            className={`w-full py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                              selectedTxIdsForRemoval.size > 0
                                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/40 cursor-pointer'
                                : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                            }`}
                          >
                            <Trash2 size={14} />
                            {selectedTxIdsForRemoval.size > 0
                              ? `Excluir Selecionados (${selectedTxIdsForRemoval.size})`
                              : 'Selecione acima para excluir em lote'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 px-1">{msg.timestamp}</span>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-[#1B2338]/80 bg-[#0A0D18]/90">
          {/* Indicador de Gravação de Áudio ao Vivo com Feedback Visual Imediato */}
          {isRecordingAudio && (
            <div className="mb-2.5 p-3 rounded-2xl bg-gradient-to-r from-red-950/60 via-[#181124] to-[#12172A] border border-red-500/40 text-xs text-slate-100 flex flex-col gap-2 animate-in fade-in shadow-xl">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-bold text-red-400 text-xs">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  </span>
                  Ouvindo sua voz ao vivo ({audioRecordingTime}s)...
                </span>
                <button 
                  type="button"
                  onClick={stopRecordingAudio}
                  className="px-3 py-1 rounded-lg bg-red-500 hover:bg-red-600 text-white font-bold text-xs transition-all shadow-md flex items-center gap-1.5"
                >
                  <Check size={13} /> Concluir & Lançar
                </button>
              </div>

              {liveAudioTranscript ? (
                <div className="p-2.5 rounded-xl bg-black/50 border border-amber-500/40 text-amber-200 text-xs font-medium leading-relaxed max-h-28 overflow-y-auto shadow-inner">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-amber-400 font-bold text-[10px] uppercase tracking-wider flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      Transcrição ao Vivo:
                    </span>
                    <span className="text-[10px] text-amber-300/80 bg-amber-500/10 px-1.5 py-0.5 rounded">Fidelidade Alta</span>
                  </div>
                  <p className="text-slate-100 font-sans text-xs">"{liveAudioTranscript}"</p>
                </div>
              ) : (
                <div className="p-2.5 rounded-xl bg-[#0F1424] border border-[#1E2842] flex items-center gap-3">
                  <div className="flex items-center gap-1 h-5 px-1 bg-amber-500/10 rounded-lg border border-amber-500/20">
                    <span className="w-1 bg-amber-400 rounded-full animate-bounce [animation-delay:0ms] h-3"></span>
                    <span className="w-1 bg-amber-400 rounded-full animate-bounce [animation-delay:150ms] h-4"></span>
                    <span className="w-1 bg-amber-400 rounded-full animate-bounce [animation-delay:300ms] h-2"></span>
                    <span className="w-1 bg-amber-400 rounded-full animate-bounce [animation-delay:450ms] h-5"></span>
                    <span className="w-1 bg-amber-400 rounded-full animate-bounce [animation-delay:200ms] h-3"></span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-200">Captando sua voz com Google Gemini...</p>
                    <p className="text-[10px] text-slate-400 truncate">Dite o valor, o item e a forma (ex: <em>"Transferência de 300 reais no Pix para o personal"</em>)</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Indicador de Processamento OCR da Imagem */}
          {isOcrProcessing && (
            <div className="mb-2.5 p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center gap-2 text-xs text-amber-300 animate-in fade-in">
              <Loader2 size={14} className="animate-spin text-amber-400" />
              <span>Analisando comprovante com IA OCR...</span>
            </div>
          )}

          {/* Inputs ocultos para selecionar Arquivo/PDF ou Câmera direta */}
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileAttachmentChange} 
            accept="image/*,application/pdf" 
            className="hidden" 
          />
          <input 
            type="file" 
            ref={cameraInputRef} 
            onChange={handleFileAttachmentChange} 
            accept="image/*" 
            capture="environment" 
            className="hidden" 
          />

          <div className="flex items-center gap-1.5 bg-[#12172A] border border-[#202940] rounded-xl px-2.5 py-2 focus-within:border-amber-500/50 transition-all">
            {/* 1. Botão "+" (Mais): Selecionar Foto ou PDF do Computador / Celular */}
            <button 
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isOcrProcessing}
              title="Anexar Arquivo (Foto ou PDF)" 
              className={`p-1.5 rounded-lg transition-all ${
                isOcrProcessing 
                  ? 'bg-amber-500/20 text-amber-400' 
                  : 'text-slate-400 hover:text-amber-400 hover:bg-slate-800'
              }`}
            >
              {isOcrProcessing ? <Loader2 size={16} className="animate-spin text-amber-400" /> : <Plus size={16} />}
            </button>

            {/* 2. Botão Câmera: Abre imediatamente a câmera do celular ou notebook */}
            <button 
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={isOcrProcessing}
              title="Tirar Foto com a Câmera" 
              className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-all"
            >
              <Camera size={16} />
            </button>

            {/* 3. Botão Microfone: Gravação de Voz / Áudio */}
            <button 
              type="button"
              onClick={isRecordingAudio ? stopRecordingAudio : startRecordingAudio}
              title={isRecordingAudio ? "Parar gravação de voz" : "Gravar áudio com IA"} 
              className={`p-1.5 rounded-lg transition-all ${
                isRecordingAudio 
                  ? 'bg-red-500 text-white animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]' 
                  : 'text-slate-400 hover:text-amber-400 hover:bg-slate-800'
              }`}
            >
              <Mic size={16} />
            </button>

            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder={isRecordingAudio ? "Fale agora... ouvindo sua voz em tempo real..." : "Digite, fale ou envie comprovante..."}
              className="flex-1 bg-transparent text-xs text-slate-200 placeholder-slate-400 focus:outline-none min-w-0"
            />
            <button
              onClick={handleSendMessage}
              disabled={isAiLoading || !inputMessage.trim()}
              className="p-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 hover:brightness-110 disabled:opacity-40 transition-colors shadow-sm font-bold shrink-0"
            >
              {isAiLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
          <p className="text-[10px] text-center text-slate-500 mt-2">
            + (Foto/PDF) • Câmera • Áudio • Texto: extração e lançamento automático
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
              kyroCloud.syncSaveTransaction(newEntry);
              syncSaveToCentralDb(newEntry);
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

            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold text-slate-300">Entradas Registradas Este Mês:</h4>
                <span className="text-[11px] text-slate-400">({transactions.filter(t => t.type === 'Entrada').length})</span>
              </div>
              {transactions.filter(t => t.type === 'Entrada').length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const allEntries = transactions.filter(t => t.type === 'Entrada');
                      if (allEntries.length > 0 && allEntries.every(t => selectedEntryIds.has(t.id))) {
                        setSelectedEntryIds(new Set());
                      } else {
                        setSelectedEntryIds(new Set(allEntries.map(t => t.id)));
                      }
                    }}
                    className="text-[11px] text-amber-400 hover:text-amber-300 font-semibold px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-800 transition-colors"
                  >
                    {transactions.filter(t => t.type === 'Entrada').every(t => selectedEntryIds.has(t.id)) ? 'Desmarcar Todas' : 'Selecionar Todas'}
                  </button>
                  {selectedEntryIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => handleBulkDeleteTransactions(selectedEntryIds, 'entradas')}
                      className="flex items-center gap-1 text-[11px] bg-red-600 hover:bg-red-500 text-white font-bold px-2 py-0.5 rounded shadow-sm transition-colors"
                    >
                      <Trash2 size={12} /> Excluir ({selectedEntryIds.size})
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {transactions.filter(t => t.type === 'Entrada').length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">Nenhuma entrada cadastrada no momento.</p>
              ) : (
                transactions.filter(t => t.type === 'Entrada').map(t => (
                  <div 
                    key={t.id} 
                    onClick={() => handleToggleSelectEntry(t.id)}
                    className={`p-3 rounded-xl border flex justify-between items-center text-xs group cursor-pointer transition-all ${
                      selectedEntryIds.has(t.id)
                        ? 'bg-amber-500/10 border-amber-500/60 shadow-[0_0_10px_rgba(245,158,11,0.15)]'
                        : 'bg-[#0E1322] border-[#1E2740] hover:border-emerald-500/30'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input 
                        type="checkbox"
                        checked={selectedEntryIds.has(t.id)}
                        onChange={() => handleToggleSelectEntry(t.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500 cursor-pointer accent-amber-500"
                      />
                      <div>
                        <p className="font-semibold text-slate-100">{t.description}</p>
                        <p className="text-[11px] text-slate-400">{t.method} • {t.city} • {t.date}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-emerald-400 text-sm">+ R$ {t.amount.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTransaction(t.id);
                        }}
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
                    product: f.produto?.value?.trim() || undefined,
                    description: f.desc.value,
                    category: f.cat.value,
                    subcategory: f.produto?.value?.trim() || f.cat.value,
                    city: f.cidade.value || 'Sem informação',
                    amount: parseFloat(f.valor.value),
                    type: 'Saída',
                    method: f.metodo.value,
                    date: 'Hoje',
                    status: 'Concluído'
                  };
                  setTransactions(prev => [newExit, ...prev]);
                  kyroCloud.syncSaveTransaction(newExit);
                  syncSaveToCentralDb(newExit);
                  f.reset();
                }} className="p-4 rounded-xl bg-[#0E1322] border border-[#1E2740] space-y-3">
                  <h4 className="text-xs font-bold text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Plus size={14} /> Registrar Nova Saída Manualmente
                  </h4>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="text-slate-400 block mb-1">Produto (Item Adquirido):</label>
                      <input name="produto" placeholder="Ex: Barra de chocolate, Câmera..." className="w-full bg-[#161D32] border border-[#2A3554] p-2.5 rounded-lg text-slate-100 outline-none" />
                    </div>

                    <div>
                      <label className="text-slate-400 block mb-1">Estabelecimento:</label>
                      <input required name="desc" placeholder="Ex: Farmácia, Internet, Supermercado..." className="w-full bg-[#161D32] border border-[#2A3554] p-2.5 rounded-lg text-slate-100 outline-none" />
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
                        <option value="Lanche">Lanche</option>
                        <option value="Compras na Internet">Compras na Internet</option>
                        <option value="Alimentação">Alimentação</option>
                        <option value="Supermercado">Supermercado</option>
                        <option value="Saúde">Saúde & Farmácia</option>
                        <option value="Transporte">Transporte / Posto</option>
                        <option value="Segurança & Eletrônicos">Segurança & Eletrônicos</option>
                        <option value="Vestuário">Vestuário / Compras</option>
                        <option value="Pet & Animais">Pet & Animais</option>
                        <option value="Educação">Educação</option>
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
                      <label className="text-slate-400 block mb-1">Local / Cidade:</label>
                      <input name="cidade" defaultValue="Sem informação" placeholder="Ex: Oeiras, PI, Internet..." className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100 outline-none" />
                    </div>
                  </div>

                  <button type="submit" className="w-full py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs transition-all shadow-md flex items-center justify-center gap-1.5">
                    <Plus size={15} /> Adicionar às Saídas
                  </button>
                </form>

                <div className="flex items-center justify-between pb-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold text-slate-300">Saídas Registradas Este Mês:</h4>
                    <span className="text-[11px] text-slate-400">({transactions.filter(t => t.type === 'Saída').length})</span>
                  </div>
                  {transactions.filter(t => t.type === 'Saída').length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const allExits = transactions.filter(t => t.type === 'Saída');
                          if (allExits.length > 0 && allExits.every(t => selectedExitIds.has(t.id))) {
                            setSelectedExitIds(new Set());
                          } else {
                            setSelectedExitIds(new Set(allExits.map(t => t.id)));
                          }
                        }}
                        className="text-[11px] text-amber-400 hover:text-amber-300 font-semibold px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-800 transition-colors"
                      >
                        {transactions.filter(t => t.type === 'Saída').every(t => selectedExitIds.has(t.id)) ? 'Desmarcar Todas' : 'Selecionar Todas'}
                      </button>
                      {selectedExitIds.size > 0 && (
                        <button
                          type="button"
                          onClick={() => handleBulkDeleteTransactions(selectedExitIds, 'saídas')}
                          className="flex items-center gap-1 text-[11px] bg-red-600 hover:bg-red-500 text-white font-bold px-2 py-0.5 rounded shadow-sm transition-colors"
                        >
                          <Trash2 size={12} /> Excluir ({selectedExitIds.size})
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2.5 max-h-96 overflow-y-auto">
                  {transactions.filter(t => t.type === 'Saída').length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-6">Nenhuma saída registrada no momento.</p>
                  ) : (
                    transactions.filter(t => t.type === 'Saída').map(tx => (
                      <div 
                        key={tx.id} 
                        onClick={() => handleToggleSelectExit(tx.id)}
                        className={`p-3.5 rounded-xl border transition-all group cursor-pointer ${
                          selectedExitIds.has(tx.id)
                            ? 'bg-amber-500/10 border-amber-500/60 shadow-[0_0_10px_rgba(245,158,11,0.15)]'
                            : 'bg-[#141A2E] border-[#222C46] hover:border-amber-500/40'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2.5">
                            <input 
                              type="checkbox"
                              checked={selectedExitIds.has(tx.id)}
                              onChange={() => handleToggleSelectExit(tx.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500 cursor-pointer accent-amber-500 mr-1"
                            />
                            <span className="p-2 rounded-lg bg-amber-500/10 text-amber-400 font-bold text-sm">
                              {tx.category.includes('Alimentação') ? '🍞' : tx.category.includes('Vestuário') ? '👟' : tx.category.includes('Passagem') ? '✈️' : '🛍️'}
                            </span>
                            <div>
                              <h4 className="font-bold text-slate-100 text-sm flex items-center gap-1.5 flex-wrap">
                                {tx.product ? (
                                  <>
                                    <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-md font-bold">
                                      {tx.product}
                                    </span>
                                    <span className="text-slate-400 font-normal text-xs">em</span>
                                    <span>{tx.description}</span>
                                  </>
                                ) : (
                                  <span>{tx.description}</span>
                                )}
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
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTransaction(tx.id);
                              }}
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
                    recurringExpenses.map(rec => {
                      const st = getRecurringStatus(rec);
                      return (
                        <div key={rec.id} className={`p-4 rounded-xl border space-y-2.5 transition-all group ${
                          rec.paid ? 'bg-[#0E1526] border-emerald-500/30' : 'bg-[#141A2E] border-[#222C46] hover:border-amber-500/40'
                        }`}>
                          <div className="flex justify-between items-start">
                            <div className="flex items-center gap-2.5">
                              <span className="p-2 rounded-lg bg-amber-500/15 text-amber-400 font-bold text-base">
                                {rec.category.includes('Passagem') ? '✈️' : rec.category.includes('Empréstimo') ? '🏦' : '👤'}
                              </span>
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="font-bold text-slate-100 text-sm">{rec.title}</h4>
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] border ${st.badgeClass}`}>
                                    {st.label}
                                  </span>
                                </div>
                                <p className="text-xs text-amber-400/90 font-medium">
                                  {rec.category} • Vencimento: <strong>{rec.dueDateText || `Dia ${rec.dueDateDay}`}</strong>
                                </p>
                              </div>
                            </div>

                            <div className="text-right">
                              <span className="font-extrabold text-white text-base">
                                R$ {rec.installmentAmount.toLocaleString('pt-BR', {minimumFractionDigits:2})}
                              </span>
                              <span className="text-xs text-slate-400 block">/mês</span>
                            </div>
                          </div>

                          {/* Status de Contabilização no Saldo */}
                          <div className="flex items-center justify-between text-[11px] pt-1">
                            {rec.paid ? (
                              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                                <CheckCircle2 size={13} /> Debitado no Dashboard (- R$ {rec.installmentAmount.toLocaleString('pt-BR', {minimumFractionDigits:2})})
                              </span>
                            ) : (
                              <span className="text-slate-400 font-medium flex items-center gap-1">
                                ⏸️ NÃO debitado do Saldo (Aguardando seu OK de paga)
                              </span>
                            )}

                            <div className="flex items-center gap-2">
                              {!rec.paid ? (
                                <button
                                  type="button"
                                  onClick={() => handleMarkRecurringAsPaid(rec.id)}
                                  className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md flex items-center gap-1.5 transition-all"
                                >
                                  <CheckCircle2 size={13} /> Dar OK / Marcar como Paga
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleUnmarkRecurringPaid(rec.id)}
                                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-all"
                                >
                                  Desfazer Pagamento
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteRecurring(rec.id)}
                                title="Excluir dívida recorrente"
                                className="p-1 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                              >
                                <Trash2 size={15} />
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
                                  className={`h-full rounded-full ${rec.paid ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-500 to-orange-500'}`}
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
                      );
                    })
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
                cardName: f.cartao?.value || (f.metodo.value === 'Crédito' ? 'Nubank' : undefined),
                active: true,
                dueDateDay: parseInt(f.diaVenc.value) || 10,
                dueDateText: `Dia ${parseInt(f.diaVenc.value) || 10}`,
                paid: false
              };

              setRecurringExpenses(prev => {
                const nextRecs = [newRec, ...prev];
                localStorage.setItem('kyro_recurring', JSON.stringify(nextRecs));
                syncSaveRecurringToCentralDb(nextRecs);
                return nextRecs;
              });
              kyroCloud.syncSaveRecurring(newRec);

              setNewRecModalOpen(false);
              setWhatsappSyncToast({
                show: true,
                text: `🔁 Dívida Recorrente "${newRec.title}" salva! Ficará separada até você confirmar o pagamento.`
              });
              setTimeout(() => setWhatsappSyncToast(null), 4000);
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
                  <label className="text-slate-400 block mb-1">Cartão Vinculado (se Crédito):</label>
                  <select name="cartao" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100">
                    <option value="">Automático / Padrão</option>
                    {creditCards.map(c => (
                      <option key={c.id} value={c.name}>{c.name} (Vence dia {c.dueDay})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Dia do Vencimento Mensal:</label>
                  <input type="number" name="diaVenc" min="1" max="31" defaultValue="10" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Cidade / Estado:</label>
                  <input name="cidade" defaultValue="Teresina, PI" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
              </div>

              <button type="submit" className="w-full mt-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-all shadow-md">
                Salvar e Ativar Recorrência
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ===================== MODAL DE CADASTRO DE NOVO CARTÃO DE CRÉDITO ===================== */}
      {newCardModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-md w-full p-6 shadow-2xl relative animate-in fade-in">
            <button onClick={() => setNewCardModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={20} />
            </button>

            <h3 className="font-bold text-base text-white mb-2 flex items-center gap-2">
              <CreditCard size={18} className="text-purple-400" /> Cadastrar Cartão de Crédito
            </h3>
            <p className="text-xs text-slate-400 mb-4">Adicione seus cartões para separar faturas, parcelamentos e alertas de vencimento:</p>

            <form onSubmit={(e) => {
              e.preventDefault();
              const f = e.target as any;
              const newCard: CreditCardData = {
                id: `card_${Date.now()}`,
                name: f.nome.value.trim(),
                closingDay: parseInt(f.diaFechamento.value) || 15,
                dueDay: parseInt(f.diaVencimento.value) || 22,
                limit: parseFloat(f.limite.value) || 5000,
                color: f.cor.value || 'purple',
                lastDigits: f.ultimosDigitos.value || '4821'
              };

              setCreditCards(prev => {
                const nextCards = [...prev, newCard];
                localStorage.setItem('kyro_credit_cards', JSON.stringify(nextCards));
                syncSaveCreditCardsToCentralDb(nextCards);
                return nextCards;
              });
              setSelectedCardId(newCard.id);
              setNewCardModalOpen(false);
              setWhatsappSyncToast({
                show: true,
                text: `💳 Cartão "${newCard.name}" cadastrado com sucesso! Fatura pronta para monitoramento.`
              });
              setTimeout(() => setWhatsappSyncToast(null), 4000);
            }} className="space-y-3 text-xs">

              <div>
                <label className="text-slate-400 block mb-1">Nome do Banco / Cartão:</label>
                <input required name="nome" placeholder="Ex: Nubank, Inter, Itaú, Santander, C6 Bank..." className="w-full bg-[#161D32] border border-[#2A3554] p-2.5 rounded-lg text-slate-100" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Dia de Fechamento:</label>
                  <input required type="number" min="1" max="31" defaultValue="15" name="diaFechamento" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Dia de Vencimento:</label>
                  <input required type="number" min="1" max="31" defaultValue="22" name="diaVencimento" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Limite Total (R$):</label>
                  <input required type="number" step="0.01" defaultValue="5000" name="limite" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100 font-bold text-purple-400" />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Últimos 4 Dígitos (opcional):</label>
                  <input maxLength={4} name="ultimosDigitos" placeholder="Ex: 4821" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Tema / Cor Visual do Cartão:</label>
                <select name="cor" defaultValue="purple" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100">
                  <option value="purple">🟣 Roxo (Nubank / C6)</option>
                  <option value="orange">🟠 Laranja (Inter)</option>
                  <option value="blue">🔵 Azul (Itaú / Caixa / BB)</option>
                  <option value="red">🔴 Vermelho (Santander / Bradesco)</option>
                  <option value="black">⚫ Grafite / Black Private</option>
                  <option value="emerald">🟢 Esmeralda / Verde (Sicredi / Safra)</option>
                </select>
              </div>

              <button type="submit" className="w-full mt-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:brightness-110 text-white font-bold text-xs transition-all shadow-md">
                Salvar Cartão
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
              const installments = parseInt(form.parcelas?.value) || 1;
              const totalVal = parseFloat(form.val.value);
              const selectedMethod = form.metodo.value;
              const selectedCard = form.cartao?.value || (selectedMethod === 'Crédito' ? 'Nubank' : undefined);

              if (installments > 1) {
                // Se parcelado, cadastra automaticamente como dívida recorrente
                const parcelaVal = Math.round((totalVal / installments) * 100) / 100;
                const newRec: RecurringExpense = {
                  id: `rec_${Date.now()}`,
                  title: `${form.desc.value} (${installments}x)`,
                  category: form.cat.value || 'Cartão de Crédito',
                  totalAmount: totalVal,
                  installmentAmount: parcelaVal,
                  currentInstallment: 1,
                  totalInstallments: installments,
                  city: form.cidade.value || 'Teresina, PI',
                  method: selectedMethod,
                  cardName: selectedCard,
                  active: true,
                  dueDateDay: 20,
                  dueDateText: 'Dia 20',
                  paid: false
                };

                setRecurringExpenses(prev => {
                  const nextRecs = [newRec, ...prev];
                  localStorage.setItem('kyro_recurring', JSON.stringify(nextRecs));
                  syncSaveRecurringToCentralDb(nextRecs);
                  return nextRecs;
                });
                kyroCloud.syncSaveRecurring(newRec);
                setNewTxModalOpen(false);
                setWhatsappSyncToast({
                  show: true,
                  text: `🔁 Compra parcelada (${installments}x) adicionada automaticamente em DÍVIDAS RECORRENTES e no Cartão ${selectedCard || ''}!`
                });
                setTimeout(() => setWhatsappSyncToast(null), 5000);
                return;
              }

              const newObj: Transaction = {
                id: Date.now().toString(),
                product: form.produto?.value?.trim() || undefined,
                establishment: form.desc.value,
                description: form.desc.value,
                category: form.cat.value,
                subcategory: form.subcat.value || form.produto?.value?.trim() || form.desc.value,
                city: form.cidade.value || 'Sem informação',
                amount: totalVal,
                type: form.tipo.value,
                method: selectedMethod,
                cardName: selectedCard,
                date: 'Hoje',
                status: 'Concluído'
              };
              setTransactions(prev => [newObj, ...prev]);
              kyroCloud.syncSaveTransaction(newObj);
              syncSaveToCentralDb(newObj);
              setNewTxModalOpen(false);
            }} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Produto / Item Adquirido</label>
                  <input name="produto" placeholder="Ex: Barra de chocolate, Câmera..." className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Estabelecimento</label>
                  <input required name="desc" placeholder="Ex: Farmácia, Internet, Mercado Livre..." className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Categoria</label>
                  <input required name="cat" placeholder="Ex: Compras na Internet, Lanche, Mercado..." className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Subcategoria</label>
                  <input name="subcat" placeholder="Ex: Eletrônicos, Doces, Gasolina" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Valor (R$)</label>
                  <input required type="number" step="0.01" name="val" placeholder="0.00" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100 font-bold" />
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
                    <option value="Crédito">Crédito</option>
                    <option value="Débito">Débito</option>
                    <option value="Dinheiro">Dinheiro</option>
                    <option value="Transferência">Transferência</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Cartão (se Crédito):</label>
                  <select name="cartao" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100">
                    <option value="">Nenhum / Padrão</option>
                    {creditCards.map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Nº de Parcelas (se parcelado):</label>
                  <input type="number" min="1" max="72" defaultValue="1" name="parcelas" className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-slate-100" />
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

      {/* Modal de Ajuste Rápido de Lançamento Selecionado no Chat */}
      {editingTxFromChat && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-md w-full p-6 shadow-2xl relative animate-in fade-in max-h-[90vh] overflow-y-auto">
            <button 
              type="button"
              onClick={() => setEditingTxFromChat(null)} 
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/40">
                <Sliders size={16} />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">Ajustar Lançamento</h3>
                <p className="text-[11px] text-slate-400">Modifique os dados abaixo para recalcular saldos</p>
              </div>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              handleSaveEditedTransaction(editingTxFromChat);
            }} className="space-y-3 text-xs">
              
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1 font-semibold">Tipo:</label>
                  <select 
                    value={editingTxFromChat.type}
                    onChange={(e) => setEditingTxFromChat({ ...editingTxFromChat, type: e.target.value as TransactionType })}
                    className="w-full bg-[#161D32] border border-[#2A3554] p-2.5 rounded-lg text-slate-100"
                  >
                    <option value="Saída">Saída (-)</option>
                    <option value="Entrada">Entrada (+)</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1 font-semibold">Valor (R$):</label>
                  <input 
                    type="number"
                    step="0.01"
                    required
                    value={editingTxFromChat.amount}
                    onChange={(e) => setEditingTxFromChat({ ...editingTxFromChat, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-[#161D32] border border-[#2A3554] p-2.5 rounded-lg text-slate-100 font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-semibold">Produto / Item:</label>
                <input 
                  type="text"
                  required
                  value={editingTxFromChat.product || editingTxFromChat.description}
                  onChange={(e) => setEditingTxFromChat({ 
                    ...editingTxFromChat, 
                    product: e.target.value,
                    description: editingTxFromChat.description || e.target.value 
                  })}
                  className="w-full bg-[#161D32] border border-[#2A3554] p-2.5 rounded-lg text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1 font-semibold">Estabelecimento:</label>
                  <input 
                    type="text"
                    value={editingTxFromChat.establishment || ''}
                    onChange={(e) => setEditingTxFromChat({ ...editingTxFromChat, establishment: e.target.value })}
                    className="w-full bg-[#161D32] border border-[#2A3554] p-2.5 rounded-lg text-slate-100"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1 font-semibold">Cidade / Local:</label>
                  <input 
                    type="text"
                    value={editingTxFromChat.city || ''}
                    onChange={(e) => setEditingTxFromChat({ ...editingTxFromChat, city: e.target.value })}
                    className="w-full bg-[#161D32] border border-[#2A3554] p-2.5 rounded-lg text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1 font-semibold">Forma de Pagamento:</label>
                  <select 
                    value={editingTxFromChat.method}
                    onChange={(e) => setEditingTxFromChat({ ...editingTxFromChat, method: e.target.value as PaymentMethod })}
                    className="w-full bg-[#161D32] border border-[#2A3554] p-2.5 rounded-lg text-slate-100"
                  >
                    <option value="PIX">PIX</option>
                    <option value="Débito">Débito</option>
                    <option value="Crédito">Crédito</option>
                    <option value="Dinheiro">Dinheiro</option>
                    <option value="Transferência">Transferência</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1 font-semibold">Cartão de Crédito:</label>
                  <select 
                    value={editingTxFromChat.cardName || ''}
                    onChange={(e) => setEditingTxFromChat({ ...editingTxFromChat, cardName: e.target.value || undefined })}
                    disabled={editingTxFromChat.method !== 'Crédito'}
                    className="w-full bg-[#161D32] border border-[#2A3554] p-2.5 rounded-lg text-slate-100 disabled:opacity-40"
                  >
                    <option value="">Nenhum / Não vinculado</option>
                    {creditCards.map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingTxFromChat(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:brightness-110 text-slate-950 font-bold transition-all shadow-md"
                >
                  Salvar Ajustes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================== MODAL DE CONFIGURAÇÃO DO GOOGLE GEMINI 1.5 FLASH ===================== */}
      {isGeminiModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12172A] border border-[#2A3554] rounded-2xl max-w-lg w-full p-6 shadow-2xl relative animate-in fade-in max-h-[92vh] overflow-y-auto">
            <button 
              type="button" 
              onClick={() => setIsGeminiModalOpen(false)} 
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-amber-500/20 via-orange-500/20 to-purple-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.25)]">
                <Sparkles size={22} className="text-amber-400 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-lg text-white">Google Gemini 1.5 Flash</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">IA Multimodal</span>
                </div>
                <p className="text-xs text-slate-400">Personalize o formato das respostas e a inteligência do Chat</p>
              </div>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              const f = e.target as any;
              handleSaveGeminiConfig(
                f.apiKey.value.trim(),
                geminiFormatStyle,
                f.customPrompt.value
              );
            }} className="space-y-4">
              
              {/* 1. Chave de API do Google Gemini */}
              <div className="p-3.5 rounded-xl bg-[#0E1322] border border-[#1E2740] space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <Key size={14} className="text-amber-400" />
                    Chave de API do Google Gemini (Opcional / Pessoal):
                  </label>
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noreferrer"
                    className="text-[10px] text-amber-400 hover:underline flex items-center gap-1"
                  >
                    <span>Pegar chave grátis</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    name="apiKey"
                    defaultValue={geminiApiKey}
                    placeholder="AIzaSy... (se vazio, usa a chave padrão do servidor)"
                    className="flex-1 bg-[#161D32] border border-[#2A3554] px-3 py-2 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const input = document.querySelector('input[name="apiKey"]') as HTMLInputElement;
                      if (input) handleTestGeminiConnection(input.value);
                    }}
                    disabled={isTestingGemini}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {isTestingGemini ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} className="text-amber-400" />}
                    <span>Testar</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-400">
                  O Google Gemini 1.5 Flash é gratuito pelo Google AI Studio e permite análise instantânea de textos, áudios e comprovantes.
                </p>

                {geminiTestFeedback && (
                  <div className={`p-2 rounded-lg text-[11px] font-medium flex items-center gap-2 ${
                    geminiTestFeedback.type === 'success' 
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300' 
                      : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                  }`}>
                    {geminiTestFeedback.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                    <span>{geminiTestFeedback.text}</span>
                  </div>
                )}
              </div>

              {/* 2. Estilo de Organização e Formatação das Respostas */}
              <div className="p-3.5 rounded-xl bg-[#0E1322] border border-[#1E2740] space-y-2.5">
                <label className="text-xs font-bold text-slate-200 block">
                  Como você quer que o Gemini formate as respostas no Chat?
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <label className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-start gap-2 ${
                    geminiFormatStyle === 'tabelas' 
                      ? 'bg-amber-500/15 border-amber-500/60 text-slate-100' 
                      : 'bg-[#161D32] border-[#2A3554] text-slate-300 hover:border-slate-600'
                  }`}>
                    <input 
                      type="radio" 
                      name="formatStyleChoice" 
                      value="tabelas" 
                      checked={geminiFormatStyle === 'tabelas'}
                      onChange={() => setGeminiFormatStyle('tabelas')}
                      className="mt-0.5 accent-amber-500" 
                    />
                    <div>
                      <strong className="block text-amber-300 text-xs">📊 Tabelas e Tópicos</strong>
                      <span className="text-[10px] text-slate-400 block mt-0.5 leading-tight">
                        Organiza despesas e comparações em tabelas claras e listas com marcadores.
                      </span>
                    </div>
                  </label>

                  <label className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-start gap-2 ${
                    geminiFormatStyle === 'conciso' 
                      ? 'bg-amber-500/15 border-amber-500/60 text-slate-100' 
                      : 'bg-[#161D32] border-[#2A3554] text-slate-300 hover:border-slate-600'
                  }`}>
                    <input 
                      type="radio" 
                      name="formatStyleChoice" 
                      value="conciso" 
                      checked={geminiFormatStyle === 'conciso'}
                      onChange={() => setGeminiFormatStyle('conciso')}
                      className="mt-0.5 accent-amber-500" 
                    />
                    <div>
                      <strong className="block text-amber-300 text-xs">⚡ Rápido e Conciso</strong>
                      <span className="text-[10px] text-slate-400 block mt-0.5 leading-tight">
                        Respostas curtas, objetivas e práticas para consultas instantâneas.
                      </span>
                    </div>
                  </label>

                  <label className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-start gap-2 ${
                    geminiFormatStyle === 'detalhado' 
                      ? 'bg-amber-500/15 border-amber-500/60 text-slate-100' 
                      : 'bg-[#161D32] border-[#2A3554] text-slate-300 hover:border-slate-600'
                  }`}>
                    <input 
                      type="radio" 
                      name="formatStyleChoice" 
                      value="detalhado" 
                      checked={geminiFormatStyle === 'detalhado'}
                      onChange={() => setGeminiFormatStyle('detalhado')}
                      className="mt-0.5 accent-amber-500" 
                    />
                    <div>
                      <strong className="block text-amber-300 text-xs">💡 Consultoria Completa</strong>
                      <span className="text-[10px] text-slate-400 block mt-0.5 leading-tight">
                        Dicas de economia, análise profunda de gastos e orientação orçamentária.
                      </span>
                    </div>
                  </label>

                  <label className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-start gap-2 ${
                    geminiFormatStyle === 'personalizado' 
                      ? 'bg-amber-500/15 border-amber-500/60 text-slate-100' 
                      : 'bg-[#161D32] border-[#2A3554] text-slate-300 hover:border-slate-600'
                  }`}>
                    <input 
                      type="radio" 
                      name="formatStyleChoice" 
                      value="personalizado" 
                      checked={geminiFormatStyle === 'personalizado'}
                      onChange={() => setGeminiFormatStyle('personalizado')}
                      className="mt-0.5 accent-amber-500" 
                    />
                    <div>
                      <strong className="block text-amber-300 text-xs">✍️ Personalizado</strong>
                      <span className="text-[10px] text-slate-400 block mt-0.5 leading-tight">
                        Sua própria regra de fala (digite abaixo como quer que o Gemini responda).
                      </span>
                    </div>
                  </label>
                </div>

                {/* Campo de Instrução Customizada */}
                <div className="pt-1">
                  <label className="text-[11px] text-slate-400 block mb-1">
                    Instrução Personalizada para o Gemini (Opcional):
                  </label>
                  <textarea
                    name="customPrompt"
                    defaultValue={geminiCustomPrompt}
                    rows={2}
                    placeholder="Ex: 'Sempre me responda de forma motivadora, destacando valores em negrito e resumindo meu saldo restante.'"
                    className="w-full bg-[#161D32] border border-[#2A3554] p-2 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 leading-relaxed"
                  />
                </div>
              </div>

              {/* 3. Recursos Multimodais Ativos */}
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                  Alimentação Automática do Sistema Conectada
                </p>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Tudo o que você falar por áudio, escrever ou enviar foto/comprovante pelo Chat será interpretado pelo Gemini e lançado instantaneamente no seu banco de dados, Dashboard e gráficos, tanto no computador quanto no celular!
                </p>
              </div>

              {/* 4. DIRETRIZES & REGRAS APRENDIDAS PELO GEMINI VIA CONVERSA */}
              <div className="p-3.5 rounded-xl bg-[#161D32] border border-[#2A3554] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles size={15} className="text-amber-400" />
                    <h4 className="text-xs font-bold text-slate-200">
                      Diretrizes de Filtragem Aprendidas pelo Gemini ({userAiRules.length})
                    </h4>
                  </div>
                  {userAiRules.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllAiRules}
                      className="text-[10px] text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                      title="Apagar todas as diretrizes aprendidas"
                    >
                      Limpar Todas
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  O Gemini aprende com o que você fala no chat (ex: <em>"não coloque alimentação/lanche na descrição, coloque só lanche"</em>). Abaixo estão as regras ativas que ele respeita em todos os seus áudios, textos e fotos:
                </p>

                {/* Lista de regras memorizadas */}
                {userAiRules.length === 0 ? (
                  <div className="p-2.5 rounded-lg bg-[#0F1423] border border-[#1E2640] text-center text-[11px] text-slate-500">
                    Nenhuma regra personalizada ainda. Peça diretamente no chat para o Gemini ajustar qualquer padrão!
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {userAiRules.map((rule, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-[#0F1423] border border-amber-500/20 flex items-start justify-between gap-2 text-xs group hover:border-amber-500/40 transition-colors"
                      >
                        <div className="flex items-start gap-1.5 flex-1 min-w-0">
                          <span className="text-amber-400 text-[10px] font-bold mt-0.5">#{idx + 1}</span>
                          <span className="text-slate-200 text-[11px] leading-tight break-words">{rule}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteAiRule(rule)}
                          className="text-slate-500 hover:text-rose-400 p-0.5 transition-colors shrink-0 cursor-pointer"
                          title="Remover esta diretriz"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Input para adicionar nova regra manualmente */}
                <div className="flex gap-1.5 pt-1">
                  <input
                    type="text"
                    value={newRuleInput}
                    onChange={(e) => setNewRuleInput(e.target.value)}
                    placeholder="Ensinar nova regra (ex: 'Na descrição use apenas o item')..."
                    className="flex-1 bg-[#0F1423] border border-[#2A3554] px-2.5 py-1.5 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddAiRule(newRuleInput);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleAddAiRule(newRuleInput)}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors shrink-0 cursor-pointer"
                  >
                    Ensinar
                  </button>
                </div>
              </div>

              {/* Botões de Ação */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsGeminiModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-all cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:brightness-110 text-slate-950 font-bold text-xs transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Sparkles size={14} />
                  <span>Salvar Preferências</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast flutuante de Notificação em Tempo Real do WhatsApp */}
      {whatsappSyncToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 border border-emerald-400/30 animate-in slide-in-from-bottom-5 duration-300">
          <div className="h-8 w-8 rounded-xl bg-white/20 flex items-center justify-center font-bold">
            <Zap size={18} className="text-amber-300 animate-pulse" />
          </div>
          <div>
            <p className="text-xs font-bold leading-tight">Lançamento WhatsApp Registrado!</p>
            <p className="text-[11px] text-emerald-100">{whatsappSyncToast.text}</p>
          </div>
        </div>
      )}

      {/* Toast flutuante de confirmação de saída do aplicativo Android */}
      {exitToastVisible && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[9999] px-5 py-2.5 rounded-full bg-[#0F172A]/95 border border-amber-500/60 text-amber-300 text-xs font-bold shadow-[0_10px_30px_rgba(0,0,0,0.85)] backdrop-blur-md flex items-center gap-2.5 pointer-events-none transition-all duration-300 animate-in fade-in slide-in-from-bottom-3">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping shrink-0" />
          <span>Pressione voltar novamente para sair</span>
        </div>
      )}

      {/* Pop-up inteligente de Atualização do Aplicativo (In-App Auto-Update) */}
      {availableUpdate && (
        <UpdateModal
          updateInfo={availableUpdate}
          currentBuild={CURRENT_APP_BUILD}
          currentVersion={CURRENT_APP_VERSION}
          onClose={() => {
            if (availableUpdate?.buildNumber) {
              localStorage.setItem('kyro_dismissed_update_build', String(availableUpdate.buildNumber));
            }
            setAvailableUpdate(null);
          }}
        />
      )}

    </div>
  );
}

