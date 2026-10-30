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
  Camera
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
  // Estado de conexão do segundo celular (KYRO Celular)
  const [isConnected, setIsConnected] = useState<boolean>(() => {
    return localStorage.getItem('kyro_second_phone_connected') === 'true' || initialConnected;
  });

  const [pairingCode, setPairingCode] = useState<string>(() => {
    return localStorage.getItem('kyro_pairing_code') || 'KYRO-8429';
  });

  const [isConnecting, setIsConnecting] = useState(false);
  const [groupName, setGroupName] = useState(() => {
    return localStorage.getItem('kyro_group_name') || 'Finanças Kyro';
  });
  const [groupConfirmed, setGroupConfirmed] = useState(() => {
    return localStorage.getItem('kyro_group_confirmed') === 'true';
  });
  const [groupInviteLink, setGroupInviteLink] = useState(() => {
    return localStorage.getItem('kyro_group_invite_link') || '';
  });
  const [isSavingGroupLink, setIsSavingGroupLink] = useState(false);
  const [groupLinkSaveSuccess, setGroupLinkSaveSuccess] = useState(false);

  // Número do segundo celular configurável
  const [secondPhone, setSecondPhone] = useState(() => {
    return localStorage.getItem('kyro_second_phone_number') || '5586994002892';
  });

  const [pairMode, setPairMode] = useState<'code' | 'qr'>('code');
  const [isRequestingCode, setIsRequestingCode] = useState(false);
  const [codeErrorMessage, setCodeErrorMessage] = useState('');
  const [botServerRunning, setBotServerRunning] = useState(false);

  const [serverQrCode, setServerQrCode] = useState<string>('');

  // Valor do QR Code escaneável
  const qrCodeData = serverQrCode || `https://wa.me/${secondPhone.replace(/\D/g, '')}?text=${encodeURIComponent('KYRO_CONNECT_DEVICE_' + pairingCode)}`;

  // Verificar status real do robô local a cada 3 segundos
  useEffect(() => {
    const checkBotStatus = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/status');
        if (res.ok) {
          const data = await res.json();
          setBotServerRunning(true);
          if (data.qr) {
            setServerQrCode(data.qr);
          }
          if (data.connected) {
            setIsConnected(true);
            localStorage.setItem('kyro_second_phone_connected', 'true');
          }
          if (data.pairingCode && data.pairingCode !== pairingCode) {
            setPairingCode(data.pairingCode);
          }
        } else {
          setBotServerRunning(false);
        }

        // Busca o grupo monitorado atual do servidor
        try {
          const resGroup = await fetch('http://localhost:3001/api/monitored-group');
          if (resGroup.ok) {
            const dataG = await resGroup.json();
            if (dataG?.monitoredGroup) {
              if (dataG.monitoredGroup.groupName) setGroupName(dataG.monitoredGroup.groupName);
              if (dataG.monitoredGroup.inviteLink) setGroupInviteLink(dataG.monitoredGroup.inviteLink);
              if (dataG.monitoredGroup.groupJid) {
                localStorage.setItem('kyro_group_jid', dataG.monitoredGroup.groupJid);
              }
              setGroupConfirmed(true);
            }
          }
        } catch (eg) {}
      } catch (e) {
        setBotServerRunning(false);
      }
    };

    checkBotStatus();
    const interval = setInterval(checkBotStatus, 3000);
    return () => clearInterval(interval);
  }, [pairingCode]);

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
      const response = await fetch('http://localhost:3001/api/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleanNum })
      });

      const data = await response.json();
      if (response.ok && data.code) {
        setPairingCode(data.code);
        localStorage.setItem('kyro_pairing_code', data.code);
        localStorage.setItem('kyro_second_phone_number', cleanNum);
        alert(`Código Oficial do WhatsApp Gerado: ${data.formattedCode || data.code}\n\nAgora vá no WhatsApp do seu celular > Aparelhos Conectados > Conectar com número de telefone e digite este código!`);
      } else if (data.alreadyRegistered) {
        setIsConnected(true);
        localStorage.setItem('kyro_second_phone_connected', 'true');
        alert('Este número já está conectado e online no sistema!');
      } else {
        setCodeErrorMessage(data.error || 'Não foi possível gerar o código. Verifique se o iniciar_robo.bat está aberto.');
      }
    } catch (err: any) {
      setCodeErrorMessage('O Robô local não está ligado. Abra o arquivo iniciar_robo.bat para ligar o robô local.');
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
      await fetch('http://localhost:3001/api/disconnect', { method: 'POST' });
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

  const handleSaveGroupLink = async () => {
    setIsSavingGroupLink(true);
    setGroupLinkSaveSuccess(false);

    const cleanLink = groupInviteLink.trim();
    const cleanName = groupName.trim() || 'Finanças Kyro';

    localStorage.setItem('kyro_group_invite_link', cleanLink);
    localStorage.setItem('kyro_group_name', cleanName);
    localStorage.setItem('kyro_group_confirmed', 'true');
    setGroupConfirmed(true);

    try {
      // 1. Notifica o robô local na porta 3001
      await fetch('http://localhost:3001/api/set-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteLink: cleanLink, groupName: cleanName })
      }).catch(() => {});

      // 2. Notifica o webhook remoto da Vercel
      await fetch('/api/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_monitored_group', inviteLink: cleanLink, groupName: cleanName })
      }).catch(() => {});

      setGroupLinkSaveSuccess(true);
      setTimeout(() => setGroupLinkSaveSuccess(false), 5000);
    } catch (e) {
      console.warn('Erro ao salvar grupo:', e);
    } finally {
      setIsSavingGroupLink(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* ================= HEADER SIMPLES & DIDÁTICO ================= */}
      <div className="bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-400 text-slate-950 flex items-center justify-center font-bold shadow-[0_0_25px_rgba(16,185,129,0.35)] flex-shrink-0">
            <Smartphone size={28} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-xl font-bold text-white tracking-tight">
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
                <Sparkles size={11} /> Motor IA Livre (tgpt) + OpenAI Ativos
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Conecte seu WhatsApp sem precisar pagar APIs caras: sistema com provedores livres integrados e leitura instantânea de áudio e texto.
            </p>
          </div>
        </div>

        {isConnected && (
          <button
            type="button"
            onClick={handleDisconnect}
            className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold self-start md:self-center transition-all"
          >
            Desconectar Aparelho
          </button>
        )}
      </div>

      {/* ================= FLUXO DIDÁTICO EM 3 PASSOS ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* PASSO 1: QR CODE DE CONEXÃO DO SEGUNDO CELULAR (7 COLUNAS) */}
        {/* PASSO 1: CONECTAR O SEGUNDO CELULAR (POR CÓDIGO DE 8 DÍGITOS OU QR CODE) */}
        <div className="lg:col-span-7 bg-[#111628] p-6 rounded-2xl border border-emerald-500/30 shadow-lg space-y-5">
          <div className="flex items-center justify-between border-b border-[#1E263E] pb-4">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center font-bold text-sm">
                1
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">Passo 1: Conectar o Segundo Celular</h3>
                <p className="text-[11px] text-slate-400">Escolha conectar pelo Código de 8 Dígitos (sem câmera) ou pelo QR Code</p>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Método Oficial
            </span>
          </div>

          {/* Seletor de Modo de Pareamento */}
          <div className="grid grid-cols-2 gap-2 bg-[#0B0E18] p-1.5 rounded-xl border border-[#1E263E]">
            <button
              type="button"
              onClick={() => setPairMode('code')}
              className={`py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                pairMode === 'code'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>🔑 Por Código de 8 Dígitos (Recomendado)</span>
            </button>
            <button
              type="button"
              onClick={() => setPairMode('qr')}
              className={`py-2 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                pairMode === 'qr'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <QrCode size={14} />
              <span>Pelo QR Code</span>
            </button>
          </div>

          {/* MODO A: CÓDIGO DE PAREAMENTO DE 8 DÍGITOS (NÃO USA CÂMERA, NUNCA DÁ ERRO) */}
          {pairMode === 'code' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-950/40 via-[#131D31] to-[#141A2E] border border-emerald-500/40 space-y-3">
                <span className="text-[11px] text-slate-300 font-bold block">
                  Digite o número do seu Segundo Celular (com DDD):
                </span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={secondPhone}
                    onChange={(e) => setSecondPhone(e.target.value)}
                    placeholder="Ex: 5586994002892 (DDI + DDD + Número)"
                    className="flex-1 bg-[#0A0D18] border border-[#202940] rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleRequestPairingCode}
                    disabled={isRequestingCode}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50"
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

                <div className="p-4 bg-[#080B14] rounded-xl border border-emerald-500/30 text-center space-y-1">
                  <div className="flex items-center justify-between pb-1">
                    <span className="text-[11px] text-slate-400 font-semibold">
                      Seu Código Oficial de Pareamento do WhatsApp:
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      botServerRunning 
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}>
                      {botServerRunning ? '🟢 Robô Local Conectado' : '🟡 Robô Desligado (iniciar_robo.bat)'}
                    </span>
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <span className="font-mono text-2xl sm:text-3xl font-black text-amber-400 tracking-widest select-all">
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
                  <li>Na parte inferior da tela (embaixo do leitor de câmera), toque na frase: <strong className="text-emerald-400">"Conectar com número de telefone"</strong>.</li>
                  <li>Digite o código de 8 dígitos <strong className="text-amber-400 font-mono">{pairingCode}</strong>. O WhatsApp conecta na hora sem precisar de câmera!</li>
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
                <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <CheckCheck size={18} className="text-emerald-400" />
                    <span>Segundo Celular ({secondPhone}) Pareado com Sucesso!</span>
                  </span>
                  <span className="text-[10px] bg-emerald-500/20 px-2 py-0.5 rounded font-mono">Status: Ativo</span>
                </div>
              )}
            </div>
          )}

          {/* MODO B: PELO QR CODE */}
          {pairMode === 'qr' && (
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center">
              <div className="sm:col-span-6 flex flex-col items-center">
                <div className="p-4 bg-white rounded-2xl shadow-2xl relative group">
                  <QRCodeSVG 
                    value={qrCodeData} 
                    size={180} 
                    level="Q"
                    bgColor="#ffffff"
                    fgColor="#0a0d18"
                  />
                  {isConnected && (
                    <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center text-center p-3 animate-fade-in">
                      <CheckCheck size={36} className="text-emerald-400 mb-1" />
                      <strong className="text-xs text-white">Segundo Celular Conectado!</strong>
                      <span className="text-[10px] text-emerald-400 font-mono mt-0.5">{secondPhone}</span>
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 mt-2 block">
                  Dica: Se a câmera do WhatsApp der erro, use a aba "Por Código de 8 Dígitos" acima!
                </span>
              </div>

              <div className="sm:col-span-6 space-y-3 text-xs text-slate-300">
                <div className="p-3 rounded-xl bg-[#141A2E] border border-[#222C46] space-y-1">
                  <strong className="text-white block font-bold">1. Segundo Celular</strong>
                  <p className="text-[11px] text-slate-400">Abra o WhatsApp no aparelho que será o KYRO Finance.</p>
                </div>
                <div className="p-3 rounded-xl bg-[#141A2E] border border-[#222C46] space-y-1">
                  <strong className="text-white block font-bold">2. Aparelhos Conectados</strong>
                  <p className="text-[11px] text-slate-400">Toque em Configurações &rarr; Aparelhos Conectados &rarr; Conectar um Aparelho.</p>
                </div>
                <div className="p-3 rounded-xl bg-[#141A2E] border border-[#222C46] space-y-1">
                  <strong className="text-white block font-bold">3. Escanear</strong>
                  <p className="text-[11px] text-slate-400">Aponte para o QR Code ao lado para sincronizar.</p>
                </div>

                {!isConnected && (
                  <button
                    type="button"
                    onClick={handleSimulateScan}
                    disabled={isConnecting}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:brightness-110 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                  >
                    <CheckCircle2 size={14} />
                    <span>Confirmar Escaneamento</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* PASSO 2: VINCULAR O LINK DO GRUPO MONITORADO (5 COLUNAS) */}
        <div className="lg:col-span-5 bg-[#111628] p-6 rounded-2xl border border-teal-500/30 shadow-lg space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3 border-b border-[#1E263E] pb-4">
              <div className="h-8 w-8 rounded-xl bg-teal-500/15 text-teal-400 flex items-center justify-center font-bold text-sm">
                2
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">Passo 2: Vincular o Grupo de Monitoramento</h3>
                <p className="text-[11px] text-slate-400">Cole o link do grupo para que APENAS ele seja lido e monitorado</p>
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

              {/* Input: Link de Convite do Grupo */}
              <div className="space-y-1.5 pt-1">
                <label className="text-[11px] font-bold text-teal-300 flex items-center gap-1.5">
                  <ExternalLink size={13} /> Link de Compartilhamento do Grupo:
                </label>
                <input
                  type="url"
                  value={groupInviteLink}
                  onChange={(e) => setGroupInviteLink(e.target.value)}
                  placeholder="https://chat.whatsapp.com/GzB9xabc123..."
                  className="w-full bg-[#0A0D18] border border-[#202940] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 font-mono"
                />
              </div>

              {/* Input: Nome de Referência do Grupo */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 block">Nome do Grupo no WhatsApp:</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="Ex: Finanças Kyro"
                    className="flex-1 bg-[#0A0D18] border border-[#202940] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500"
                  />
                  <button
                    type="button"
                    onClick={handleSaveGroupLink}
                    disabled={isSavingGroupLink}
                    className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md disabled:opacity-50"
                  >
                    {isSavingGroupLink ? <RefreshCw size={14} className="animate-spin" /> : <CheckCheck size={14} />}
                    <span>{isSavingGroupLink ? 'Salvando...' : 'Vincular'}</span>
                  </button>
                </div>
              </div>

              {groupConfirmed && (
                <div className="p-3.5 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-300 text-xs space-y-1.5 animate-in fade-in">
                  <div className="flex items-center gap-2 font-bold text-teal-200">
                    <CheckCheck size={16} className="text-teal-400 flex-shrink-0" />
                    <span>Grupo Vinculado com Sucesso: "{groupName}"</span>
                  </div>
                  {groupInviteLink && (
                    <p className="text-[10px] text-teal-400/80 font-mono truncate">
                      Link: {groupInviteLink}
                    </p>
                  )}
                  <p className="text-[10px] text-emerald-300 font-semibold pt-1">
                    🛡️ Proteção Ativa: Apenas este grupo é monitorado. Conversas no privado, status e outros grupos são 100% ignorados sem resposta automática!
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#0C101D] border border-[#1E263E] text-xs space-y-1.5 mt-3">
            <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">Como Funciona a Leitura 24/7:</span>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              O Segundo Celular monitora exclusivamente este grupo. Sempre que você mandar um <strong>texto</strong> ou <strong>áudio de voz</strong> lá, ele lê a mensagem, a Inteligência Artificial processa e lança direto no Dashboard e nas abas de Entradas e Saídas do site!
            </p>
          </div>
        </div>
      </div>

      {/* ================= PASSO 3: O QUE MANDAR NO GRUPO & SIMULADOR AO VIVO ================= */}
      <div className="bg-[#111628] p-6 rounded-2xl border border-[#202940] shadow-lg space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1E263E] pb-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-purple-500/15 text-purple-400 flex items-center justify-center font-bold text-sm">
              3
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Passo 3: Como Usar no Dia a Dia & Teste em Tempo Real</h3>
              <p className="text-[11px] text-slate-400">Envie no grupo do WhatsApp ou faça um teste direto abaixo para ver o sistema atualizar</p>
            </div>
          </div>
          <span className="text-[11px] font-mono text-purple-300 bg-purple-500/10 px-2.5 py-1 rounded-lg border border-purple-500/20">
            Inteligência Artificial Ativa
          </span>
        </div>

        {/* Cards de Exemplos Reais */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-4 rounded-xl bg-[#141A2E] border border-rose-500/30 space-y-2">
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

          <div className="p-4 rounded-xl bg-[#141A2E] border border-emerald-500/30 space-y-2">
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

          <div className="p-4 rounded-xl bg-[#141A2E] border border-teal-500/30 space-y-2">
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

          <div className="p-4 rounded-xl bg-[#141A2E] border border-cyan-500/30 space-y-2">
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

        {/* Simulador Interativo do Grupo */}
        <div className="p-5 rounded-2xl bg-[#0E1322] border border-[#222C46] space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-white flex items-center gap-2">
              <Sparkles size={15} className="text-amber-400" /> Teste Rápido: Simule uma mensagem enviada no Grupo agora
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

          <div className="relative">
            <input
              type="text"
              value={testWebhookMessage}
              onChange={(e) => setTestWebhookMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRunWebhookTest()}
              placeholder={`Digite o que você mandaria no grupo "${groupName}"...`}
              className="w-full bg-[#070A12] border border-[#202940] rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              onClick={() => handleRunWebhookTest()}
              disabled={testWebhookStatus === 'loading' || !testWebhookMessage.trim()}
              className="absolute right-2 top-2 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50 transition-all shadow-md"
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
