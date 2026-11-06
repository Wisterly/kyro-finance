import React, { useState, useEffect } from 'react';
import { Sparkles, Download, CheckCircle2, X, RefreshCw, Smartphone } from 'lucide-react';
import { isRunningInNativeApk } from '../nativeBridge';

export interface UpdateInfo {
  latestVersion: string;
  buildNumber: number;
  publishedAt: string;
  apkUrl: string;
  apkFileName?: string;
  apkSize: string;
  changelog: string[];
}

interface UpdateModalProps {
  updateInfo: UpdateInfo;
  currentBuild: number;
  currentVersion: string;
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  updateInfo,
  currentBuild,
  currentVersion,
  onClose
}) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState<number>(-1);
  const [updateStatusText, setUpdateStatusText] = useState<string | null>(null);

  useEffect(() => {
    let progressSub: any = null;
    let compSub: any = null;
    let errSub: any = null;

    const setupListeners = async () => {
      try {
        const cap = (window as any).Capacitor;
        const appUpdateManager = cap?.Plugins?.AppUpdateManager;
        if (appUpdateManager && isRunningInNativeApk()) {
          progressSub = await appUpdateManager.addListener('downloadProgress', (data: any) => {
            if (typeof data?.percent === 'number' && data.percent >= 0) {
              setDownloadPercent(data.percent);
              setUpdateStatusText(`Baixando atualização: ${data.percent}% concluído...`);
            } else if (data?.downloaded && data?.total) {
              const mbDown = (data.downloaded / (1024 * 1024)).toFixed(1);
              const mbTotal = (data.total / (1024 * 1024)).toFixed(1);
              setUpdateStatusText(`Baixando: ${mbDown} MB de ${mbTotal} MB...`);
            }
          });

          compSub = await appUpdateManager.addListener('downloadCompleted', () => {
            setDownloadPercent(100);
            setUpdateStatusText('Download 100% concluído! Abrindo instalador do Android...');
          });

          errSub = await appUpdateManager.addListener('downloadError', (data: any) => {
            console.warn('[AutoUpdate] Erro no download nativo:', data);
            setUpdateStatusText('Abrindo download seguro no navegador...');
            setTimeout(() => {
              window.open(updateInfo.apkUrl, '_blank');
              onClose();
            }, 1200);
          });
        }
      } catch (e) {}
    };

    setupListeners();

    return () => {
      if (progressSub && typeof progressSub.remove === 'function') progressSub.remove();
      if (compSub && typeof compSub.remove === 'function') compSub.remove();
      if (errSub && typeof errSub.remove === 'function') errSub.remove();
    };
  }, [updateInfo, onClose]);

  const handleStartUpdate = async () => {
    setIsUpdating(true);
    setDownloadPercent(0);
    setUpdateStatusText('Conectando ao servidor para baixar o pacote...');

    try {
      const cap = (window as any).Capacitor;
      const appUpdateManager = cap?.Plugins?.AppUpdateManager;

      if (isRunningInNativeApk() && appUpdateManager) {
        // 1. Verifica permissão de instalar pacotes (Android 8+)
        const permResult = await appUpdateManager.checkInstallPermission().catch(() => ({ canInstall: true }));
        if (permResult && permResult.canInstall === false) {
          setUpdateStatusText('Habilitando permissão de instalação...');
          await appUpdateManager.requestInstallPermission().catch(() => {});
        }

        // 2. Dispara o download nativo com streaming e progresso real
        setUpdateStatusText('Baixando pacote APK em alta velocidade...');
        await appUpdateManager.downloadAndInstall({
          url: updateInfo.apkUrl
        });

      } else {
        // No navegador/desktop, abre o download direto
        window.open(updateInfo.apkUrl, '_blank');
        setUpdateStatusText('Download iniciado no navegador!');
        setTimeout(() => onClose(), 2500);
      }
    } catch (err: any) {
      console.error('[AutoUpdate] Erro ao atualizar:', err);
      setUpdateStatusText('Abrindo link direto no navegador...');
      window.open(updateInfo.apkUrl, '_blank');
      setTimeout(() => onClose(), 2500);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-md bg-gradient-to-b from-[#131B2E] to-[#0B0F19] border border-amber-500/40 rounded-3xl p-6 shadow-[0_20px_50px_rgba(0,0,0,0.9)] relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow de fundo */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Botão fechar */}
        {!isUpdating && (
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
            title="Mais tarde"
          >
            <X size={18} />
          </button>
        )}

        {/* Cabeçalho */}
        <div className="flex items-center gap-3.5 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-slate-950 shadow-lg shadow-amber-500/30 shrink-0">
            <Smartphone size={24} className="animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Nova Versão
              </span>
              <span className="text-xs text-slate-400 font-medium">
                v{updateInfo.latestVersion} ({updateInfo.apkSize})
              </span>
            </div>
            <h3 className="text-lg font-bold text-white leading-tight mt-0.5">
              Atualização do KYRO Finance
            </h3>
          </div>
        </div>

        <p className="text-xs text-slate-300 mb-3 leading-relaxed">
          Uma nova versão otimizada do aplicativo está pronta para ser instalada no seu celular.
        </p>

        {updateInfo.apkFileName && (
          <div className="mb-4 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 flex items-center justify-between text-[11px] text-slate-300">
            <span className="text-slate-400">Pacote GitHub:</span>
            <code className="text-amber-300 font-mono font-semibold">{updateInfo.apkFileName}</code>
          </div>
        )}

        {/* Novidades da versão */}
        {updateInfo.changelog && updateInfo.changelog.length > 0 && (
          <div className="mb-5 bg-slate-900/70 border border-slate-800/80 rounded-2xl p-3.5 max-h-40 overflow-y-auto">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400 mb-2 flex items-center gap-1.5">
              <Sparkles size={13} />
              O que há de novo:
            </p>
            <ul className="space-y-1.5">
              {updateInfo.changelog.map((item, idx) => (
                <li key={idx} className="text-xs text-slate-300 flex items-start gap-2">
                  <CheckCircle2 size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Barra de Progresso Real de Download */}
        {isUpdating && downloadPercent >= 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs font-bold text-amber-300 mb-1.5">
              <span>Progresso do Download</span>
              <span>{downloadPercent}%</span>
            </div>
            <div className="w-full h-3 bg-slate-800/90 rounded-full overflow-hidden border border-amber-500/30">
              <div 
                className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-400 transition-all duration-200"
                style={{ width: `${Math.max(5, Math.min(100, downloadPercent))}%` }}
              />
            </div>
          </div>
        )}

        {/* Status de Download */}
        {updateStatusText && (
          <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-medium flex items-center gap-2.5">
            <RefreshCw size={15} className="animate-spin shrink-0 text-amber-400" />
            <span className="leading-tight">{updateStatusText}</span>
          </div>
        )}

        {/* Botões de Ação */}
        <div className="flex items-center gap-2.5 pt-1">
          {!isUpdating ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 font-bold text-xs transition-all cursor-pointer"
              >
                Mais Tarde
              </button>
              <button
                type="button"
                onClick={handleStartUpdate}
                className="flex-[2] py-3 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:brightness-110 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download size={15} />
                <span>Atualizar Agora</span>
              </button>
            </>
          ) : (
            <div className="w-full py-3 rounded-xl bg-slate-800/90 border border-amber-500/30 text-slate-200 font-bold text-xs text-center flex items-center justify-center gap-2">
              <RefreshCw size={14} className="animate-spin text-amber-400" />
              <span>{downloadPercent >= 100 ? 'Iniciando instalador...' : 'Baixando atualização...'}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
