import { UpdateInfo } from '../components/UpdateModal';
import { isRunningInNativeApk } from '../nativeBridge';
import { APP_VERSION, APP_BUILD, APP_CHANGELOG } from '../version';

// Versão de referência deste bundle de compilação
export const CURRENT_APP_VERSION = APP_VERSION;
export const CURRENT_APP_BUILD = APP_BUILD;

/**
 * Obtém os dados de versão reais instalados no dispositivo.
 * No Android nativo, consulta o PackageManager do sistema operacional (versionCode e versionName).
 * No navegador / PWA, utiliza as constantes compiladas no bundle.
 */
export async function getInstalledAppInfo(): Promise<{ versionName: string; buildNumber: number }> {
  if (isRunningInNativeApk()) {
    try {
      const cap = (window as any).Capacitor;
      const manager = cap?.Plugins?.AppUpdateManager;
      if (manager && typeof manager.getAppVersion === 'function') {
        const res = await manager.getAppVersion();
        if (res && res.versionCode) {
          const code = Number(res.versionCode);
          const name = String(res.versionName || CURRENT_APP_VERSION);
          console.log(`[AutoUpdate] Versão Nativa do APK Instalado: v${name} (buildCode: ${code})`);
          return {
            versionName: name,
            buildNumber: code
          };
        }
      }
    } catch (err) {
      console.warn('[AutoUpdate] Não foi possível ler versão nativa do APK:', err);
    }
  }

  return {
    versionName: CURRENT_APP_VERSION,
    buildNumber: CURRENT_APP_BUILD
  };
}

/**
 * Consulta a nuvem (/api/app-version) e compara com a versão instalada no aparelho.
 * Se houver versão com buildNumber superior na nuvem, retorna os dados para abertura do pop-up.
 */
export async function checkForAppUpdate(): Promise<UpdateInfo | null> {
  try {
    const installed = await getInstalledAppInfo();

    const res = await fetch('/api/app-version', {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });

    if (!res.ok) return null;

    const data: UpdateInfo = await res.json();
    if (!data || typeof data.buildNumber !== 'number') return null;

    console.log(`[AutoUpdate] Comparando: Nuvem Build ${data.buildNumber} vs Instalado Build ${installed.buildNumber}`);

    // Se houver build superior na nuvem, aciona a atualização
    if (data.buildNumber > installed.buildNumber) {
      return data;
    }

    return null;
  } catch (err) {
    console.warn('[AutoUpdate] Erro ao verificar atualização na nuvem:', err);
    return null;
  }
}
