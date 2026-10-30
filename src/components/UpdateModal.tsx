import React, { useState } from 'react';
import { Sparkles, Download, CheckCircle2, X, RefreshCw, Smartphone } from 'lucide-react';
import { isRunningInNativeApk } from '../nativeBridge';

export interface UpdateInfo {
  latestVersion: string;
  buildNumber: number;
  publishedAt: string;
  apkUrl: string;
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
  const [updateStatusText, setUpdateStatusText] = useState<string | null>(null);

  const handleStartUpdate = async () => {
    setIsUpdating(true);
    setUpdateStatusText('Iniciando download do pacote...');

    try {
      const cap = (window as any).Capacitor;
      const appUpdateManager = cap?.Plugins?.AppUpdateManager;

      if (isRunningInNativeApk() && appUpdateManager) {
        // 1. Verifica se tem permissão de instalar pacotes (Android 8+)
        const permResult = await appUpdateManager.checkInstallPermission().catch(() => ({ canInstall: true }));
        if (permResult && permResult.canInstall === false) {
          setUpdateStatusText('Habilite a permissão de atualização nas configurações...');
          await appUpdateManager.requestInstallPermission().catch(() => {});
        }

        // 2. Dispara o download nativo via DownloadManager do Android
        setUpdateStatusText('Baixando atualização... Acompanhe na notificação do celular');
        await appUpdateManager.downloadAndInstall({
          url: updateInfo.apkUrl
        });

        setUpdateStatusText('Download concluído! Abrindo instalador do Android...');
      } else {
        // No navegador/desktop, abre o download direto
        window.open(updateInfo.apkUrl, '_blank');
        setUpdateStatusText('Download iniciado no navegador!');
        setTimeout(() => onClose(), 2500);
      }
    } catch (err: any) {
      console.error('[AutoUpdate] Erro ao atualizar:', err);
      setUpdateStatusText('Abrindo link direto de download...');
      window.open(updateInfo.apkUrl, '_blank');
      setTimeout(() => onClose(), 3000);
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

        <p className="text-xs text-slate-300 mb-4 leading-relaxed">
          Uma nova versão otimizada do aplicativo está pronta para ser instalada no seu celular.
        </p>

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

        {/* Status de Download */}
        {updateStatusText && (
          <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-medium flex items-center gap-2.5 animate-pulse">
            <RefreshCw size={15} className="animate-spin shrink-0 text-amber-400" />
            <span>{updateStatusText}</span>
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
            <div className="w-full py-3 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs text-center flex items-center justify-center gap-2">
              <RefreshCw size={14} className="animate-spin text-amber-400" />
              <span>Instalando atualização...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
