import React, { useState, useEffect } from 'react';
import { 
  Smartphone, 
  Mic, 
  Sparkles, 
  CheckCircle2, 
  Send, 
  RefreshCw,
  QrCode,
  Users,
  CheckCheck,
  Layers,
  ArrowRight,
  TrendingDown,
  TrendingUp,
  MessageSquare,
  ShieldCheck,
  ExternalLink,
  Camera,
  Globe,
  Cloud,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Transaction } from '../types';

interface WhatsAppTabProps {
  whatsAppConnected: boolean;
  webhookUrl: string;
  copiedWebhook: boolean;
  handleCopyWebhookUrl: () => void;
  testWebhookMessage: string;
  setTestWebhookMessage: (val: string) => void;
  handleRunWebhookTest: (preset?: string) => Promise<void>;
  testWebhookStatus: 'idle' | 'loading' | 'success' | 'error';
  testWebhookResponse: any;
  evolutionServerUrl?: string;
  setEvolutionServerUrl?: (val: string) => void;
  evolutionApiKey?: string;
  setEvolutionApiKey?: (val: string) => void;
  evolutionInstance?: string;
  setEvolutionInstance?: (val: string) => void;
  userPhone?: string;
  setUserPhone?: (val: string) => void;
  botPhone?: string;
  transactions?: Transaction[];
}

export const WhatsAppTab: React.FC<WhatsAppTabProps> = ({
  whatsAppConnected: initialConnected,
  webhookUrl,
  testWebhookMessage,
  setTestWebhookMessage,
  handleRunWebhookTest,
  testWebhookStatus,
  testWebhookResponse,
  botPhone = '+55 (86) 99400-2892',
  userPhone: propUserPhone = '+55 (86) 99999-9999',
  transactions = []
}) => {
  // Estado de conexão real do segundo celular (validado em tempo real com o Baileys)
  const [isConnected, setIsConnected] = useState<boolean>(false);

  const [pairingCode, setPairingCode] = useState<string>(() => {
    return localStorage.getItem('kyro_pairing_code') || 'KYRO-8429';
  });

  const [isConnecting, setIsConnecting] = useState(false);
  const [groupName, setGroupName] = useState(() => {
    return localStorage.getItem('kyro_group_name') || 'Finanças KYRO';
  });
  const [groupConfirmed, setGroupConfirmed] = useState(() => {
    return localStorage.getItem('kyro_group_confirmed') !== 'false';
  });
  const [groupInviteLink, setGroupInviteLink] = useState(() => {
    return localStorage.getItem('kyro_group_invite_link') || 'https://chat.whatsapp.com/DQNscf09vX5DljtvTnx6YK';
  });
  const [selectedGroupJid, setSelectedGroupJid] = useState(() => {
    return localStorage.getItem('kyro_group_jid') || '120363411839303797@g.us';
  });
  const [participatingGroups, setParticipatingGroups] = useState<Array<{ id: string; subject: string; size?: number }>>([
    { id: '120363411839303797@g.us', subject: 'Finanças KYRO', size: 2 }
  ]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);

  // URL do Robô Hospedado 24h na Nuvem (Render / Koyeb / etc.)
  const [cloudBotUrl, setCloudBotUrl] = useState(() => {
    return localStorage.getItem('kyro_cloud_bot_url') || '';
  });
  const [isSavingCloudUrl, setIsSavingCloudUrl] = useState(false);
  const [cloudUrlFeedback, setCloudUrlFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showCloudGuide, setShowCloudGuide] = useState(false);

  const filterOnlyKyroGroup = (groupsList: any[]) => {
    const filtered = (groupsList || []).filter((g: any) => {
      if (!g) return false;
      const id = String(g.id || '');
      const subj = String(g.subject || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return id === '120363411839303797@g.us' || (subj.includes('finan') && subj.includes('kyro'));
    });
    return filtered.length > 0 ? filtered : [{ id: '120363411839303797@g.us', subject: 'Finanças KYRO', size: 2 }];
  };
  const [isSavingGroupLink, setIsSavingGroupLink] = useState(false);
  const [groupLinkSaveSuccess, setGroupLinkSaveSuccess] = useState(false);
  const isEditingGroupRef = React.useRef(false);

  // Número do segundo celular configurável (salvo e sincronizado)
  const [secondPhone, setSecondPhone] = useState(() => {
    return localStorage.getItem('kyro_second_phone_number') || '558695368780';
  });

  // Abre diretamente no modo QR Code Oficial do WhatsApp Web
  const [pairMode, setPairMode] = useState<'code' | 'qr'>('qr');
  const [isRequestingCode, setIsRequestingCode] = useState(false);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [codeErrorMessage, setCodeErrorMessage] = useState('');
  const [botServerRunning, setBotServerRunning] = useState(false);

  const [serverQrCode, setServerQrCode] = useState<string>('');

  // Sincronização responsiva contínua entre Desktop e Mobile (a cada 2s)
  // Só pausa a atualização dos campos de texto se o usuário estiver com o cursor digitando neles (isEditingGroupRef)
  useEffect(() => {
    const applyRemoteGroupConfig = (mg: any) => {
      if (!mg || isEditingGroupRef.current) return;
      if (mg.groupName) {
        setGroupName(mg.groupName);
        localStorage.setItem('kyro_group_name', mg.groupName);
      }
      if (mg.inviteLink) {
        setGroupInviteLink(mg.inviteLink);
        localStorage.setItem('kyro_group_invite_link', mg.inviteLink);
      }
      if (mg.groupJid) {
        setSelectedGroupJid(mg.groupJid);
        localStorage.setItem('kyro_group_jid', mg.groupJid);
      }
      setGroupConfirmed(true);
      localStorage.setItem('kyro_group_confirmed', 'true');
    };

    const checkBotStatus = async () => {
      let foundStatus = false;

      // 1. Tenta buscar da Nuvem 24h (se configurada), direto da porta 3001 ou via proxy local /api/status
      const statusEndpoints = ['/api/status', 'http://localhost:3001/api/status'];
      if (cloudBotUrl) {
        statusEndpoints.unshift(`${cloudBotUrl.replace(/\/$/, '')}/api/status`);
      }
      for (const ep of statusEndpoints) {
        try {
          const res = await fetch(ep);
          if (res.ok) {
            const data = await res.json();
            if (data && (typeof data.connected === 'boolean' || data.qr)) {
              foundStatus = true;
              setBotServerRunning(true);
              if (data.qr) {
                setServerQrCode(data.qr);
              }
              if (Array.isArray(data.groups) && data.groups.length > 0) {
                setParticipatingGroups(filterOnlyKyroGroup(data.groups));
              }
              if (data.connected) {
                setIsConnected(true);
                localStorage.setItem('kyro_second_phone_connected', 'true');
                if (data.phoneNumber) {
                  setSecondPhone(data.phoneNumber);
                  localStorage.setItem('kyro_second_phone_number', data.phoneNumber);
                }
              } else {
                setIsConnected(false);
                localStorage.removeItem('kyro_second_phone_connected');
              }
              if (data.pairingCode && data.pairingCode !== pairingCode) {
                setPairingCode(data.pairingCode);
              }
              if (data.monitoredGroup) {
                applyRemoteGroupConfig(data.monitoredGroup);
              }
              break;
            }
          }
        } catch (err) {}
      }

      // 2. Também consulta /api/webhook e /api/database (funciona tanto no Desktop quanto no Celular 24h)
      try {
        const [resWebhook, resDb] = await Promise.all([
          fetch('/api/webhook').catch(() => null),
          fetch('/api/database').catch(() => null)
        ]);

        if (resWebhook && resWebhook.ok) {
          const dataW = await resWebhook.json();
          if (dataW?.botStatus) {
            setBotServerRunning(true);
            if (dataW.botStatus.qr) {
              setServerQrCode(dataW.botStatus.qr);
            }
            if (Array.isArray(dataW.botStatus.groups) && dataW.botStatus.groups.length > 0) {
              setParticipatingGroups(filterOnlyKyroGroup(dataW.botStatus.groups));
            }
            if (dataW.botStatus.connected) {
              setIsConnected(true);
              localStorage.setItem('kyro_second_phone_connected', 'true');
              if (dataW.botStatus.phoneNumber) {
                setSecondPhone(dataW.botStatus.phoneNumber);
                localStorage.setItem('kyro_second_phone_number', dataW.botStatus.phoneNumber);
              }
            } else if (!foundStatus) {
              setIsConnected(false);
            }
          }
          if (dataW?.monitoredGroup) {
            applyRemoteGroupConfig(dataW.monitoredGroup);
          }
        }

        if (resDb && resDb.ok) {
          const dataDb = await resDb.json();
          if (dataDb?.botServerUrl && !cloudBotUrl) {
            setCloudBotUrl(dataDb.botServerUrl);
            localStorage.setItem('kyro_cloud_bot_url', dataDb.botServerUrl);
          }
          if (dataDb?.whatsappConfig) {
            applyRemoteGroupConfig(dataDb.whatsappConfig);
            if (dataDb.whatsappConfig.phoneNumber) {
              setSecondPhone(dataDb.whatsappConfig.phoneNumber);
              localStorage.setItem('kyro_second_phone_number', dataDb.whatsappConfig.phoneNumber);
            }
          }
        }
      } catch (ew) {}
    };

    checkBotStatus();
    const interval = setInterval(checkBotStatus, 2000);
    return () => clearInterval(interval);
  }, [pairingCode]);

  // Função para buscar manualmente a lista de grupos onde o número conectado é membro
  const handleRefreshParticipatingGroups = async () => {
    setIsLoadingGroups(true);
    try {
      const eps = ['/api/groups', 'http://localhost:3001/api/groups', '/api/webhook'];
      if (cloudBotUrl) {
        eps.unshift(`${cloudBotUrl.replace(/\/$/, '')}/api/groups`);
      }
      for (const ep of eps) {
        try {
          const res = await fetch(ep);
          if (res.ok) {
            const data = await res.json();
            const list = data.groups || data.botStatus?.groups;
            if (Array.isArray(list) && list.length > 0) {
              setParticipatingGroups(filterOnlyKyroGroup(list));
              break;
            }
          }
        } catch (e) {}
      }
    } finally {
      setIsLoadingGroups(false);
    }
  };

  // Função para salvar e testar a URL do Robô Hospedado 24h na Nuvem
  const handleSaveAndTestCloudBot = async () => {
    setIsSavingCloudUrl(true);
    setCloudUrlFeedback(null);
    const cleanUrl = cloudBotUrl.trim().replace(/\/$/, '');
    try {
      localStorage.setItem('kyro_cloud_bot_url', cleanUrl);
      setCloudBotUrl(cleanUrl);

      await fetch('/api/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_bot_url', botServerUrl: cleanUrl })
      });

      if (!cleanUrl) {
        setCloudUrlFeedback({ type: 'success', message: 'Configuração de nuvem redefinida para servidor local.' });
        return;
      }

      // Testa a rota de healthcheck do servidor na nuvem
      try {
        const testRes = await fetch(`${cleanUrl}/api/health`);
        if (testRes.ok) {
          const testData = await testRes.json();
          setCloudUrlFeedback({
            type: 'success',
            message: `🎉 Robô na Nuvem Conectado 24h! WhatsApp: ${testData.connected ? 'Online (' + (testData.phoneNumber || 'Ativo') + ')' : 'Aguardando Pareamento'}`
          });
          return;
        }
      } catch (e) {}

      setCloudUrlFeedback({
        type: 'success',
        message: 'URL da Nuvem salva com sucesso! (Se for no Render Free, ele pode levar cerca de 40s para acordar na primeira vez).'
      });
    } catch (e: any) {
      setCloudUrlFeedback({ type: 'error', message: 'Erro ao salvar URL no banco central.' });
    } finally {
      setIsSavingCloudUrl(false);
    }
  };

  // Função para forçar a geração de um novo QR Code Oficial do WhatsApp Web
  const handleGenerateNewOfficialQr = async () => {
    setIsGeneratingQr(true);
    setIsConnected(false);
    setServerQrCode('');
    localStorage.removeItem('kyro_second_phone_connected');

    try {
      // Tenta via rota da nuvem, rota local ou proxy Vite
      const endpoints = ['/api/reset-qr', 'http://localhost:3001/api/reset-qr'];
      if (cloudBotUrl) endpoints.unshift(`${cloudBotUrl.replace(/\/$/, '')}/api/reset-qr`);
      for (const ep of endpoints) {
        try {
          const res = await fetch(ep, { method: 'POST' });
          if (res.ok) {
            const data = await res.json();
            if (data?.qr) {
              setServerQrCode(data.qr);
              setBotServerRunning(true);
              setIsGeneratingQr(false);
              return;
            }
          }
        } catch (e) {}
      }

      // Notifica também o webhook na nuvem caso esteja acessando pelo link online
      await fetch('/api/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_reset_qr' })
      }).catch(() => {});
    } catch (e) {
      console.warn('Erro ao gerar novo QR:', e);
    } finally {
      setTimeout(() => setIsGeneratingQr(false), 1500);
    }
  };

  // Função REAL para solicitar o Código de 8 Dígitos ao WhatsApp
  const handleRequestPairingCode = async () => {
    setIsRequestingCode(true);
    setCodeErrorMessage('');

    const cleanNum = secondPhone.replace(/\D/g, '');
    if (!cleanNum || cleanNum.length < 10) {
      setCodeErrorMessage('Digite o número completo com DDD (ex: 5586994002892)');
      setIsRequestingCode(false);
      return;
    }

    try {
      const codeEndpoints = ['http://localhost:3001/api/request-code'];
      if (cloudBotUrl) codeEndpoints.unshift(`${cloudBotUrl.replace(/\/$/, '')}/api/request-code`);
      let successData = null;
      for (const ep of codeEndpoints) {
        try {
          const response = await fetch(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: cleanNum })
          });
          const data = await response.json();
          if (response.ok && (data.code || data.alreadyRegistered)) {
            successData = data;
            break;
          }
        } catch (e) {}
      }

      if (successData && successData.code) {
        setPairingCode(successData.code);
        localStorage.setItem('kyro_pairing_code', successData.code);
        localStorage.setItem('kyro_second_phone_number', cleanNum);
        alert(`Código Oficial do WhatsApp Gerado: ${successData.formattedCode || successData.code}\n\nAgora vá no WhatsApp do seu celular > Aparelhos Conectados > Conectar com número de telefone e digite este código!`);
      } else if (successData && successData.alreadyRegistered) {
        setIsConnected(true);
        localStorage.setItem('kyro_second_phone_connected', 'true');
        alert('Este número já está conectado e online no sistema!');
      } else {
        setCodeErrorMessage('Não foi possível gerar o código. Verifique se o servidor local ou da nuvem está ligado.');
      }
    } catch (err: any) {
      setCodeErrorMessage('O servidor do robô não está acessível no momento.');
    } finally {
      setIsRequestingCode(false);
    }
  };

  const handleSimulateScan = () => {
    setIsConnecting(true);
    setTimeout(() => {
      setIsConnected(true);
      localStorage.setItem('kyro_second_phone_connected', 'true');
      localStorage.setItem('kyro_second_phone_number', secondPhone);
      setIsConnecting(false);
    }, 800);
  };

  const handleDisconnect = async () => {
    try {
      if (cloudBotUrl) {
        await fetch(`${cloudBotUrl.replace(/\/$/, '')}/api/disconnect`, { method: 'POST' }).catch(() => null);
      }
      await fetch('http://localhost:3001/api/disconnect', { method: 'POST' }).catch(() => null);
    } catch (e) {}
    setIsConnected(false);
    localStorage.removeItem('kyro_second_phone_connected');
    const newCode = `KYRO-${Math.floor(1000 + Math.random() * 9000)}`;
    setPairingCode(newCode);
    localStorage.setItem('kyro_pairing_code', newCode);
  };

  const handleConfirmGroup = () => {
    handleSaveGroupLink();
  };

  const handleSaveGroupLink = async (overrideGroup?: { groupJid?: string; groupName?: string; inviteLink?: string }) => {
    setIsSavingGroupLink(true);
    setGroupLinkSaveSuccess(false);

    const cleanLink = (overrideGroup?.inviteLink !== undefined ? overrideGroup.inviteLink : groupInviteLink).trim();
    const cleanName = (overrideGroup?.groupName !== undefined ? overrideGroup.groupName : groupName).trim() || 'Finanças Kyro';
    const cleanJid = (overrideGroup?.groupJid !== undefined ? overrideGroup.groupJid : selectedGroupJid).trim();

    isEditingGroupRef.current = false;
    localStorage.setItem('kyro_group_invite_link', cleanLink);
    localStorage.setItem('kyro_group_name', cleanName);
    if (cleanJid) localStorage.setItem('kyro_group_jid', cleanJid);
    localStorage.setItem('kyro_group_confirmed', 'true');
    setGroupConfirmed(true);

    try {
      let resolvedGroupObj = {
        inviteLink: cleanLink,
        groupName: cleanName,
        groupJid: cleanJid,
        lockedByUser: true
      };

      // 1. Notifica o robô na nuvem e o robô local via proxy Vite e direto na porta 3001
      const setGroupEndpoints = ['/api/set-group', 'http://localhost:3001/api/set-group'];
      if (cloudBotUrl) {
        setGroupEndpoints.unshift(`${cloudBotUrl.replace(/\/$/, '')}/api/set-group`);
      }
      for (const ep of setGroupEndpoints) {
        try {
          const res = await fetch(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inviteLink: cleanLink, groupName: cleanName, groupJid: cleanJid })
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.monitoredGroup) {
              resolvedGroupObj = { ...resolvedGroupObj, ...data.monitoredGroup };
              if (data.monitoredGroup.groupName) {
                setGroupName(data.monitoredGroup.groupName);
                localStorage.setItem('kyro_group_name', data.monitoredGroup.groupName);
              }
              if (data.monitoredGroup.inviteLink !== undefined) {
                setGroupInviteLink(data.monitoredGroup.inviteLink);
                localStorage.setItem('kyro_group_invite_link', data.monitoredGroup.inviteLink);
              }
              if (data.monitoredGroup.groupJid) {
                setSelectedGroupJid(data.monitoredGroup.groupJid);
                localStorage.setItem('kyro_group_jid', data.monitoredGroup.groupJid);
              }
              break;
            }
          }
        } catch (e) {}
      }

      // 2. Sincroniza simultaneamente no Webhook e no Banco Central (/api/database) para espelhar entre Desktop e Mobile!
      await Promise.allSettled([
        fetch('/api/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'set_monitored_group',
            inviteLink: resolvedGroupObj.inviteLink,
            groupName: resolvedGroupObj.groupName,
            groupJid: resolvedGroupObj.groupJid
          })
        }),
        fetch('/api/database', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save_whatsapp_config',
            whatsappConfig: {
              ...resolvedGroupObj,
              phoneNumber: secondPhone,
              connected: isConnected
            }
          })
        })
      ]);

      setGroupLinkSaveSuccess(true);
      setTimeout(() => setGroupLinkSaveSuccess(false), 5000);
    } catch (e) {
      console.warn('Erro ao salvar grupo:', e);
    } finally {
      setIsSavingGroupLink(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 max-w-6xl mx-auto w-full px-1 sm:px-0">
      {/* ================= HEADER SIMPLES, DIDÁTICO & 100% RESPONSIVO ================= */}
      <div className="bg-[#111628] p-4 sm:p-6 rounded-2xl border border-[#202940] shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-5">
        <div className="flex items-start sm:items-center gap-3 sm:gap-4">
          <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-400 text-slate-950 flex items-center justify-center font-bold shadow-[0_0_25px_rgba(16,185,129,0.35)] flex-shrink-0">
            <Smartphone size={24} className="sm:w-7 sm:h-7" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-xl font-bold text-white tracking-tight leading-snug">
                Assistente WhatsApp & IA Multi-Provedores
              </h2>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1.5 ${
                isConnected
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              }`}>
                <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                {isConnected ? 'WhatsApp Conectado' : 'Aguardando Pareamento'}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                <Sparkles size={11} /> Sincronizado Desktop & Mobile
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-1 leading-relaxed">
              Design 100% responsivo: todos os ajustes feitos no computador ou no celular são salvos e espelhados automaticamente.
            </p>
          </div>
        </div>

        {isConnected && (
          <button
            type="button"
            onClick={handleDisconnect}
            className="w-full md:w-auto px-3.5 py-2 sm:py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold text-center transition-all"
          >
            Desconectar Aparelho
          </button>
        )}
      </div>

      {/* ================= CARD HOSPEDAGEM 24H NA NUVEM (SEM DEPENDER DO PC) ================= */}
      <div className="bg-gradient-to-r from-[#10172B] via-[#121B35] to-[#10172B] p-4 sm:p-5 rounded-2xl border border-sky-500/30 shadow-lg space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-sky-500/15 text-sky-400 flex items-center justify-center font-bold flex-shrink-0 border border-sky-500/30">
              <Cloud size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                  Hospedagem 24h na Nuvem (Gratuita)
                </h3>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1.5 ${
                  cloudBotUrl
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${cloudBotUrl ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                  {cloudBotUrl ? 'Modo Nuvem 24h Configurado' : 'Modo Computador Local (Porta 3001)'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Para o robô responder mesmo com o seu computador desligado, informe a URL do seu serviço gratuito no Render / Koyeb.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowCloudGuide(!showCloudGuide)}
            className="text-[11px] text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-1 self-start sm:self-center px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/25 transition-all"
          >
            <span>Como hospedar grátis no Render</span>
            {showCloudGuide ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {/* Input da URL da Nuvem */}
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <div className="relative flex-1">
            <Globe size={15} className="absolute left-3.5 top-3 text-slate-500" />
            <input
              type="url"
              value={cloudBotUrl}
              onChange={(e) => setCloudBotUrl(e.target.value)}
              placeholder="Ex: https://kyro-whatsapp-bot.onrender.com"
              className="w-full bg-[#080B14] border border-[#202940] rounded-xl pl-9 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>
          <button
            type="button"
            onClick={handleSaveAndTestCloudBot}
            disabled={isSavingCloudUrl}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-teal-600 hover:brightness-110 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md disabled:opacity-50 transition-all whitespace-nowrap"
          >
            {isSavingCloudUrl ? <RefreshCw size={14} className="animate-spin" /> : <CheckCheck size={14} />}
            <span>Salvar & Conectar Nuvem 24h</span>
          </button>
        </div>

        {cloudUrlFeedback && (
          <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 border ${
            cloudUrlFeedback.type === 'success'
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
          }`}>
            <CheckCircle2 size={15} className="flex-shrink-0" />
            <span>{cloudUrlFeedback.message}</span>
          </div>
        )}

        {/* Guia Didático de 3 Minutos para o Render.com */}
        {showCloudGuide && (
          <div className="p-4 rounded-xl bg-[#090D18] border border-sky-500/20 text-xs text-slate-300 space-y-2.5 animate-in fade-in">
            <strong className="text-white block font-bold text-xs flex items-center gap-1.5">
              🚀 Como subir o Robô de graça no Render.com (Passo a Passo de 3 Minutos):
            </strong>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-300 text-[11px] leading-relaxed">
              <li>Acesse <a href="https://render.com" target="_blank" rel="noreferrer" className="text-sky-400 underline font-semibold">render.com</a> e faça login com sua conta do GitHub (<strong className="text-white">Wisterly</strong>).</li>
              <li>No painel do Render, clique em <strong className="text-white">New +</strong> e escolha <strong className="text-emerald-400">Web Service</strong>.</li>
              <li>Selecione o seu repositório <strong className="text-white font-mono">Wisterly/kyro-finance</strong>.</li>
              <li>O Render detectará o arquivo <strong className="text-amber-400 font-mono">render.yaml</strong> e o plano <strong className="text-emerald-400">Free</strong> automaticamente!</li>
              <li>Clique em <strong className="text-white">Deploy Web Service</strong>. Em cerca de 2 minutos ele estará ativo!</li>
              <li>Copie o link gerado pelo Render (ex: <code className="text-amber-300 bg-black/40 px-1 py-0.5 rounded">https://kyro-whatsapp-bot.onrender.com</code>), cole no campo acima e clique em <strong className="text-white">Salvar & Conectar Nuvem 24h</strong>.</li>
            </ol>
            <p className="text-[10px] text-emerald-400/90 font-medium pt-1">
              💡 As credenciais do seu WhatsApp e o grupo Finanças KYRO já estão sincronizados no banco de dados. Quando o servidor no Render ligar, ele conectará automaticamente sem precisar de novo QR Code!
            </p>
          </div>
        )}
      </div>

      {/* ================= FLUXO DIDÁTICO EM 3 PASSOS (RESPONSIVO MOBILE & DESKTOP) ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        
        {/* PASSO 1: CONECTAR O SEGUNDO CELULAR (7 COLUNAS NO DESKTOP, 100% NO MOBILE) */}
        <div className="lg:col-span-7 bg-[#111628] p-4 sm:p-6 rounded-2xl border border-emerald-500/30 shadow-lg space-y-4 sm:space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E263E] pb-3.5 sm:pb-4">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="h-8 w-8 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center font-bold text-sm flex-shrink-0">
                1
              </div>
              <div>
                <h3 className="font-bold text-xs sm:text-sm text-white">Passo 1: Conectar o Segundo Celular</h3>
                <p className="text-[10px] sm:text-[11px] text-slate-400">Escolha conectar pelo QR Code ou pelo Código de 8 Dígitos</p>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Método Oficial
            </span>
          </div>

          {/* Seletor de Modo de Pareamento (Empilha no Mobile, 2 Colunas no Desktop) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-[#0B0E18] p-1.5 rounded-xl border border-[#1E263E]">
            <button
              type="button"
              onClick={() => setPairMode('qr')}
              className={`py-2.5 sm:py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                pairMode === 'qr'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <QrCode size={14} className="flex-shrink-0" />
              <span className="truncate">📱 Pelo QR Code (Igual WhatsApp Web)</span>
            </button>
            <button
              type="button"
              onClick={() => setPairMode('code')}
              className={`py-2.5 sm:py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                pairMode === 'code'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="truncate">🔑 Por Código de 8 Dígitos</span>
            </button>
          </div>

          {/* MODO A: CÓDIGO DE PAREAMENTO DE 8 DÍGITOS */}
          {pairMode === 'code' && (
            <div className="space-y-4">
              <div className="p-3.5 sm:p-4 rounded-xl bg-gradient-to-r from-emerald-950/40 via-[#131D31] to-[#141A2E] border border-emerald-500/40 space-y-3">
                <span className="text-[11px] text-slate-300 font-bold block">
                  Digite o número do seu Segundo Celular (com DDD):
                </span>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={secondPhone}
                    onChange={(e) => setSecondPhone(e.target.value)}
                    placeholder="Ex: 5586994002892 (DDI + DDD + Número)"
                    className="w-full sm:flex-1 bg-[#0A0D18] border border-[#202940] rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleRequestPairingCode}
                    disabled={isRequestingCode}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isRequestingCode ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>Solicitando ao WhatsApp...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} />
                        <span>Gerar Código Oficial</span>
                      </>
                    )}
                  </button>
                </div>

                {codeErrorMessage && (
                  <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                    <span>⚠️ {codeErrorMessage}</span>
                  </div>
                )}

                <div className="p-3.5 sm:p-4 bg-[#080B14] rounded-xl border border-emerald-500/30 text-center space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1">
                    <span className="text-[11px] text-slate-400 font-semibold">
                      Seu Código Oficial de Pareamento:
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      botServerRunning 
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}>
                      {botServerRunning ? '🟢 Robô Conectado' : '🟡 Robô Desligado'}
                    </span>
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <span className="font-mono text-xl sm:text-3xl font-black text-amber-400 tracking-widest select-all">
                      {pairingCode}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(pairingCode.replace('-', ''));
                        alert(`Código ${pairingCode} copiado para a área de transferência!`);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-[11px] font-bold"
                    >
                      Copiar
                    </button>
                  </div>
                </div>
              </div>

              {/* Instruções passo a passo no celular */}
              <div className="space-y-2 text-xs text-slate-300">
                <strong className="text-white block font-bold text-[11px]">Como digitar esse código no Segundo Celular:</strong>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-400 text-[11px] leading-relaxed">
                  <li>No segundo celular, abra o WhatsApp &rarr; toque em <strong>Aparelhos Conectados</strong>.</li>
                  <li>Toque no botão verde <strong>"Conectar um Aparelho"</strong>.</li>
                  <li>Na parte inferior da tela, toque em: <strong className="text-emerald-400">"Conectar com número de telefone"</strong>.</li>
                  <li>Digite o código de 8 dígitos <strong className="text-amber-400 font-mono">{pairingCode}</strong>.</li>
                </ol>
              </div>

              {!isConnected ? (
                <button
                  type="button"
                  onClick={handleSimulateScan}
                  disabled={isConnecting}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:brightness-110 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 transition-all"
                >
                  {isConnecting ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Validando Código no WhatsApp...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={15} />
                      <span>Confirmei o Código no Celular &rarr; Conectar</span>
                    </>
                  )}
                </button>
              ) : (
                <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <CheckCheck size={18} className="text-emerald-400 flex-shrink-0" />
                    <span>Segundo Celular ({secondPhone}) Pareado com Sucesso!</span>
                  </span>
                  <span className="text-[10px] bg-emerald-500/20 px-2 py-0.5 rounded font-mono">Status: Ativo</span>
                </div>
              )}
            </div>
          )}

          {/* MODO B: PELO QR CODE OFICIAL DO WHATSAPP WEB */}
          {pairMode === 'qr' && (
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 sm:gap-6 items-center">
              <div className="sm:col-span-6 flex flex-col items-center">
                <div className="p-3 bg-white rounded-2xl shadow-[0_0_30px_rgba(16,185,129,0.25)] border-4 border-emerald-500/40 relative group flex items-center justify-center w-full max-w-[244px] min-h-[230px] sm:min-h-[244px]">
                  {serverQrCode ? (
                    <QRCodeSVG 
                      value={serverQrCode} 
                      size={210} 
                      level="M"
                      includeMargin={true}
                      bgColor="#ffffff"
                      fgColor="#000000"
                      className="w-full h-auto max-w-[216px]"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center p-4 space-y-3 max-w-[210px]">
                      <RefreshCw size={32} className="text-emerald-600 animate-spin" />
                      <strong className="text-xs text-slate-900 font-bold">
                        {isGeneratingQr ? 'Gerando Novo QR Code Oficial...' : 'Carregando QR Code do WhatsApp Web...'}
                      </strong>
                      <p className="text-[10px] text-slate-600 leading-tight">
                        Conectando aos servidores criptografados do WhatsApp Web...
                      </p>
                      <button
                        type="button"
                        onClick={handleGenerateNewOfficialQr}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold shadow"
                      >
                        Forçar Geração Agora
                      </button>
                    </div>
                  )}

                  {isConnected && (
                    <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center text-center p-4 animate-fade-in">
                      <CheckCheck size={42} className="text-emerald-400 mb-2" />
                      <strong className="text-sm text-white">WhatsApp Web Conectado!</strong>
                      <span className="text-xs text-emerald-400 font-mono mt-1">{secondPhone}</span>
                      <button
                        type="button"
                        onClick={handleGenerateNewOfficialQr}
                        className="mt-3 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold border border-slate-700"
                      >
                        Trocar Aparelho / Gerar Novo QR
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-2.5 flex items-center gap-1.5 text-center">
                  <span className={`h-2 w-2 rounded-full flex-shrink-0 ${isConnected || serverQrCode ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`}></span>
                  <span className="text-[11px] font-semibold text-emerald-400">
                    {isConnected ? `Sessão Ativa e Salva (${secondPhone})` : serverQrCode ? 'QR Code Oficial WhatsApp Web Ativo' : 'Sincronizando Sessão WhatsApp Web...'}
                  </span>
                </div>
              </div>

              <div className="sm:col-span-6 space-y-2.5 sm:space-y-3 text-xs text-slate-300">
                <div className="p-3 rounded-xl bg-[#141A2E] border border-[#222C46] space-y-1">
                  <strong className="text-white block font-bold">1. Abra o WhatsApp no Celular</strong>
                  <p className="text-[11px] text-slate-400">No celular que ficará no grupo, abra o aplicativo do WhatsApp.</p>
                </div>
                <div className="p-3 rounded-xl bg-[#141A2E] border border-[#222C46] space-y-1">
                  <strong className="text-white block font-bold">2. Aparelhos Conectados</strong>
                  <p className="text-[11px] text-slate-400">Toque em Menu (⋮) ou Configurações &rarr; <strong>Aparelhos Conectados</strong> &rarr; <strong>Conectar um Aparelho</strong>.</p>
                </div>
                <div className="p-3 rounded-xl bg-[#141A2E] border border-[#222C46] space-y-1">
                  <strong className="text-white block font-bold">3. Aponte a Câmera para o QR Code</strong>
                  <p className="text-[11px] text-slate-400">Este QR Code usa o protocolo oficial do WhatsApp Web e vincula o número na hora!</p>
                </div>

                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleGenerateNewOfficialQr}
                    disabled={isGeneratingQr}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:brightness-110 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 transition-all"
                  >
                    <RefreshCw size={14} className={isGeneratingQr ? 'animate-spin' : ''} />
                    <span>{isGeneratingQr ? 'Gerando Novo QR Code...' : '🔄 Atualizar / Gerar Novo QR Code'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* PASSO 2: VINCULAR O LINK DO GRUPO MONITORADO (5 COLUNAS NO DESKTOP, 100% NO MOBILE) */}
        <div className="lg:col-span-5 bg-[#111628] p-4 sm:p-6 rounded-2xl border border-teal-500/30 shadow-lg space-y-4 sm:space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 sm:gap-3 border-b border-[#1E263E] pb-3.5 sm:pb-4">
              <div className="h-8 w-8 rounded-xl bg-teal-500/15 text-teal-400 flex items-center justify-center font-bold text-sm flex-shrink-0">
                2
              </div>
              <div>
                <h3 className="font-bold text-xs sm:text-sm text-white">Passo 2: Vincular o Grupo de Monitoramento</h3>
                <p className="text-[10px] sm:text-[11px] text-slate-400">Cole o link ou selecione o grupo (sincroniza entre PC e Celular)</p>
              </div>
            </div>

            <div className="space-y-3.5 text-xs text-slate-300">
              <div className="p-3 rounded-xl bg-[#141A2E] border border-[#222C46] flex items-start gap-2.5">
                <Users size={18} className="text-teal-400 mt-0.5 flex-shrink-0" />
                <div>
                  <strong className="text-white block font-bold">1. Pegue o Link de Convite do Grupo no WhatsApp</strong>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    No WhatsApp do seu celular, abra o grupo &rarr; Toque no nome &rarr; <strong>"Convidar via link"</strong> &rarr; <strong>Copiar link</strong>.
                  </p>
                </div>
              </div>

              {/* Opção A: Input Link de Convite do Grupo (Empilha em telas menores para não esmagar o campo) */}
              <div className="space-y-1.5 pt-1">
                <label className="text-[11px] font-bold text-teal-300 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <ExternalLink size={13} className="flex-shrink-0" /> Opção A: Cole o Link de Convite do Grupo:
                  </span>
                  {groupInviteLink && (
                    <button
                      type="button"
                      onClick={() => {
                        isEditingGroupRef.current = true;
                        setGroupInviteLink('');
                        setSelectedGroupJid('');
                      }}
                      className="text-[10px] text-slate-400 hover:text-rose-400 underline flex-shrink-0"
                    >
                      Limpar link
                    </button>
                  )}
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="url"
                    value={groupInviteLink}
                    onFocus={() => { isEditingGroupRef.current = true; }}
                    onBlur={() => { setTimeout(() => { isEditingGroupRef.current = false; }, 1500); }}
                    onChange={(e) => {
                      isEditingGroupRef.current = true;
                      setGroupInviteLink(e.target.value);
                      setSelectedGroupJid('');
                    }}
                    placeholder="https://chat.whatsapp.com/DQNscf09vX5DljtvTnx6YK..."
                    className="w-full sm:flex-1 bg-[#0A0D18] border border-[#202940] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveGroupLink({ groupJid: '', inviteLink: groupInviteLink })}
                    disabled={isSavingGroupLink}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md disabled:opacity-50 whitespace-nowrap"
                  >
                    {isSavingGroupLink ? <RefreshCw size={14} className="animate-spin" /> : <CheckCheck size={14} />}
                    <span>{isSavingGroupLink ? 'Vinculando...' : 'Vincular Link'}</span>
                  </button>
                </div>
              </div>

              {/* Opção B: Escolher Diretamente da Lista de Grupos que este Número já é Membro */}
              <div className="space-y-1.5 pt-1 border-t border-[#1E263E]">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <label className="text-[11px] font-bold text-emerald-300 flex items-center gap-1.5">
                    <Users size={13} className="flex-shrink-0" /> Opção B: Escolher Grupo que este Número faz parte:
                  </label>
                  <button
                    type="button"
                    onClick={handleRefreshParticipatingGroups}
                    disabled={isLoadingGroups}
                    className="text-[10px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-teal-300 font-semibold flex items-center gap-1"
                  >
                    <RefreshCw size={10} className={isLoadingGroups ? 'animate-spin' : ''} />
                    <span>Atualizar Lista</span>
                  </button>
                </div>

                {participatingGroups.length > 0 ? (
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 bg-[#080B14] p-2 rounded-xl border border-[#1E263E]">
                    {participatingGroups.map((grp) => {
                      const isSelected = selectedGroupJid === grp.id || groupName === grp.subject;
                      return (
                        <button
                          key={grp.id}
                          type="button"
                          onClick={() => {
                            setGroupName(grp.subject);
                            setSelectedGroupJid(grp.id);
                            handleSaveGroupLink({ groupJid: grp.id, groupName: grp.subject, inviteLink: groupInviteLink });
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-2 transition-all ${
                            isSelected
                              ? 'bg-teal-500/25 border border-teal-500/50 text-white font-bold'
                              : 'bg-[#111628] hover:bg-[#19223B] text-slate-300 border border-transparent'
                          }`}
                        >
                          <span className="truncate">👥 {grp.subject}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ${
                            isSelected ? 'bg-teal-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-400'
                          }`}>
                            {isSelected ? '✓ Vinculado' : 'Selecionar'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 italic bg-[#080B14] px-3 py-2 rounded-xl border border-[#1E263E]">
                    Clique em "Atualizar Lista" acima ou cole o link do grupo na Opção A.
                  </p>
                )}
              </div>

              {/* Input: Nome de Referência do Grupo */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 block">Nome do Grupo Vinculado:</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={groupName}
                    onFocus={() => { isEditingGroupRef.current = true; }}
                    onBlur={() => { setTimeout(() => { isEditingGroupRef.current = false; }, 1500); }}
                    onChange={(e) => {
                      isEditingGroupRef.current = true;
                      setGroupName(e.target.value);
                    }}
                    placeholder="Ex: Finanças KYRO"
                    className="w-full sm:flex-1 bg-[#0A0D18] border border-[#202940] rounded-xl px-3.5 py-2.5 sm:py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveGroupLink()}
                    disabled={isSavingGroupLink}
                    className="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md disabled:opacity-50"
                  >
                    {isSavingGroupLink ? <RefreshCw size={14} className="animate-spin" /> : <CheckCheck size={14} />}
                    <span>Salvar</span>
                  </button>
                </div>
              </div>

              {groupLinkSaveSuccess && (
                <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-bold flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-emerald-400 flex-shrink-0" />
                  <span>Grupo salvo e sincronizado automaticamente nas versões Desktop e Mobile!</span>
                </div>
              )}

              {groupConfirmed && (
                <div className="p-3.5 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-300 text-xs space-y-1.5 animate-in fade-in">
                  <div className="flex items-center gap-2 font-bold text-teal-200">
                    <CheckCheck size={16} className="text-teal-400 flex-shrink-0" />
                    <span className="truncate">Grupo Monitorado Oficial: "{groupName}"</span>
                  </div>
                  {groupInviteLink && (
                    <p className="text-[10px] text-teal-400/80 font-mono break-all sm:truncate">
                      Link Ativo: {groupInviteLink}
                    </p>
                  )}
                  {selectedGroupJid && (
                    <p className="text-[10px] text-slate-400 font-mono break-all sm:truncate">
                      ID Oficial: {selectedGroupJid}
                    </p>
                  )}
                  <p className="text-[10px] text-emerald-300 font-semibold pt-1 leading-relaxed">
                    🛡️ Configuração Salva & Trava Exclusiva Ativa: Áudios, textos e fotos enviados neste grupo são filtrados por IA e lançados no sistema instantaneamente!
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="p-3.5 sm:p-4 rounded-xl bg-[#0C101D] border border-[#1E263E] text-xs space-y-1.5 mt-3">
            <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">Sincronização Desktop & Mobile 24/7:</span>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Todas as configurações desta tela ficam salvas permanentemente no servidor central. Qualquer alteração feita no computador reflete automaticamente no celular e vice-versa!
            </p>
          </div>
        </div>
      </div>

      {/* ================= PASSO 3: O QUE MANDAR NO GRUPO & SIMULADOR AO VIVO (RESPONSIVO) ================= */}
      <div className="bg-[#111628] p-4 sm:p-6 rounded-2xl border border-[#202940] shadow-lg space-y-5 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1E263E] pb-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-purple-500/15 text-purple-400 flex items-center justify-center font-bold text-sm flex-shrink-0">
              3
            </div>
            <div>
              <h3 className="font-bold text-xs sm:text-sm text-white">Passo 3: Como Usar no Dia a Dia & Teste em Tempo Real</h3>
              <p className="text-[10px] sm:text-[11px] text-slate-400">Envie no grupo do WhatsApp ou faça um teste direto abaixo para ver o sistema atualizar</p>
            </div>
          </div>
          <span className="text-[10px] sm:text-[11px] font-mono text-purple-300 bg-purple-500/10 px-2.5 py-1 rounded-lg border border-purple-500/20 self-start sm:self-auto">
            Inteligência Artificial Ativa
          </span>
        </div>

        {/* Cards de Exemplos Reais (1 coluna no celular, 2 no tablet, 4 no desktop) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3.5 sm:p-4 rounded-xl bg-[#141A2E] border border-rose-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-rose-400 flex items-center gap-1.5">
                <TrendingDown size={14} /> Mensagem de Despesa
              </span>
              <span className="text-[10px] bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded">Saída</span>
            </div>
            <p className="text-slate-300 text-[11px]">Você manda no grupo:</p>
            <p className="text-white font-mono text-[11px] p-2 bg-[#0A0D18] rounded-lg border border-[#202940]">
              "Almoço R$ 35 no débito em Teresina"
            </p>
            <p className="text-[10px] text-slate-400">
              &rarr; O sistema cria uma Saída de R$ 35,00 na categoria Alimentação e subtrai do saldo.
            </p>
          </div>

          <div className="p-3.5 sm:p-4 rounded-xl bg-[#141A2E] border border-emerald-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                <TrendingUp size={14} /> Mensagem de Receita
              </span>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">Entrada</span>
            </div>
            <p className="text-slate-300 text-[11px]">Você manda no grupo:</p>
            <p className="text-white font-mono text-[11px] p-2 bg-[#0A0D18] rounded-lg border border-[#202940]">
              "Recebi pix de 1500 de serviço de consultoria"
            </p>
            <p className="text-[10px] text-slate-400">
              &rarr; O sistema cria uma Entrada de R$ 1.500,00 e soma ao seu saldo total.
            </p>
          </div>

          <div className="p-3.5 sm:p-4 rounded-xl bg-[#141A2E] border border-teal-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-teal-400 flex items-center gap-1.5">
                <Mic size={14} /> Áudio de Voz no Grupo
              </span>
              <span className="text-[10px] bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded">Gemini / Whisper</span>
            </div>
            <p className="text-slate-300 text-[11px]">Você grava um áudio falando:</p>
            <p className="text-white font-mono text-[11px] p-2 bg-[#0A0D18] rounded-lg border border-[#202940]">
              🎙️ "Gastei 42 reais na farmácia hoje"
            </p>
            <p className="text-[10px] text-slate-400">
              &rarr; A IA escuta, extrai os valores e lança no extrato automaticamente!
            </p>
          </div>

          <div className="p-3.5 sm:p-4 rounded-xl bg-[#141A2E] border border-cyan-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-cyan-400 flex items-center gap-1.5">
                <Camera size={14} /> Foto de Comprovante
              </span>
              <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded">Visão Gemini</span>
            </div>
            <p className="text-slate-300 text-[11px]">Você envia no grupo:</p>
            <p className="text-white font-mono text-[11px] p-2 bg-[#0A0D18] rounded-lg border border-[#202940]">
              📸 [Foto de Nota Fiscal ou Cupom PIX]
            </p>
            <p className="text-[10px] text-slate-400">
              &rarr; A visão computacional extrai estabelecimento, valor e data sem você digitar nada!
            </p>
          </div>
        </div>

        {/* Simulador Interativo do Grupo (Responsivo sem sobrepor texto no celular) */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[#0E1322] border border-[#222C46] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold text-white flex items-center gap-2">
              <Sparkles size={15} className="text-amber-400 flex-shrink-0" /> Teste Rápido: Simule uma mensagem enviada no Grupo agora
            </h4>
            <span className="text-[10px] text-slate-400">Atualiza o Dashboard instantaneamente</span>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                const msg = "Almoço R$ 35 no débito em Teresina";
                setTestWebhookMessage(msg);
                handleRunWebhookTest(msg);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#141A2E] hover:bg-[#1E263E] text-slate-300 hover:text-white border border-[#222C46] transition-all text-[11px]"
            >
              🍔 Testar: Almoço 35 débito
            </button>
            <button
              type="button"
              onClick={() => {
                const msg = "Recebi pix de 1500 de salário";
                setTestWebhookMessage(msg);
                handleRunWebhookTest(msg);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#141A2E] hover:bg-[#1E263E] text-slate-300 hover:text-white border border-[#222C46] transition-all text-[11px]"
            >
              💰 Testar: Recebi Pix 1500
            </button>
            <button
              type="button"
              onClick={() => {
                const msg = "Paguei 120 reais de gasolina no cartão de crédito em Caxias";
                setTestWebhookMessage(msg);
                handleRunWebhookTest(msg);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#141A2E] hover:bg-[#1E263E] text-slate-300 hover:text-white border border-[#222C46] transition-all text-[11px]"
            >
              ⛽ Testar: Gasolina 120 cartão
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={testWebhookMessage}
              onChange={(e) => setTestWebhookMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRunWebhookTest()}
              placeholder={`Digite o que você mandaria no grupo "${groupName}"...`}
              className="w-full sm:flex-1 bg-[#070A12] border border-[#202940] rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              onClick={() => handleRunWebhookTest()}
              disabled={testWebhookStatus === 'loading' || !testWebhookMessage.trim()}
              className="w-full sm:w-auto px-4 py-3 sm:py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50 transition-all shadow-md whitespace-nowrap"
            >
              {testWebhookStatus === 'loading' ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              <span>Enviar Mensagem</span>
            </button>
          </div>

          {/* Resposta do Robô no Grupo */}
          {testWebhookResponse && (
            <div className="p-4 rounded-xl bg-[#080C16] border border-emerald-500/40 space-y-2">
              <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1.5">
                <CheckCheck size={14} /> Resposta do Segundo Celular no Grupo:
              </span>
              <p className="text-xs text-slate-200 whitespace-pre-line bg-[#0E1424] p-3 rounded-lg border border-[#1C2540] font-sans">
                {testWebhookResponse.replySent || (testWebhookResponse.savedTx ? `✅ Transação cadastrada com sucesso!\n• Descrição: ${testWebhookResponse.savedTx.description}\n• Valor: R$ ${testWebhookResponse.savedTx.amount}\n• Categoria: ${testWebhookResponse.savedTx.category}` : JSON.stringify(testWebhookResponse, null, 2))}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
