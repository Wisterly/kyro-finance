import { App as CapApp } from '@capacitor/app';
import { UpdateInfo } from '../components/UpdateModal';
import { isRunningInNativeApk } from '../nativeBridge';
import { APP_VERSION, APP_BUILD, APP_CHANGELOG } from '../version';

// Versão de referência deste bundle de compilação
export const CURRENT_APP_VERSION = APP_VERSION;
export const CURRENT_APP_BUILD = APP_BUILD;

/**
 * Obtém os dados de versão reais instalados no dispositivo.
 * No Android nativo, consulta o PackageManager do sistema operacional via @capacitor/app (versionCode e versionName).
 * No navegador / PWA, utiliza as constantes compiladas no bundle.
 */
export async function getInstalledAppInfo(): Promise<{ versionName: string; buildNumber: number }> {
  try {
    const info = await CapApp.getInfo();
    if (info && info.build) {
      const code = parseInt(info.build, 10);
      if (!isNaN(code) && code > 0) {
        console.log(`[AutoUpdate] Versão Nativa do APK Instalado lida com sucesso: v${info.version} (buildCode: ${code})`);
        return {
          versionName: info.version || CURRENT_APP_VERSION,
          buildNumber: code
        };
      }
    }
  } catch (err) {
    console.warn('[AutoUpdate] Fallback para constantes do build:', err);
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
    let data: UpdateInfo | null = null;

    // 1. Tenta buscar no endpoint serverless /api/app-version
    try {
      const res = await fetch(`/api/app-version?t=${Date.now()}`, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
      if (res.ok) {
        data = await res.json();
      }
    } catch (e) {}

    // 2. Fallback direto para o GitHub raw version.json (sempre atualizado no push)
    if (!data || typeof data.buildNumber !== 'number') {
      try {
        const ghRes = await fetch(`https://raw.githubusercontent.com/Wisterly/kyro-finance/main/version.json?t=${Date.now()}`, {
          headers: { 'Cache-Control': 'no-cache' }
        });
        if (ghRes.ok) {
          const rawV = await ghRes.json();
          if (rawV && typeof rawV.buildNumber === 'number') {
            data = {
              latestVersion: rawV.version || '0.1.24',
              buildNumber: rawV.buildNumber,
              publishedAt: rawV.releaseDate || new Date().toISOString(),
              apkUrl: 'https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk',
              apkSize: '9.1 MB',
              changelog: rawV.changelog || []
            };
          }
        }
      } catch (ghErr) {}
    }

    if (!data || typeof data.buildNumber !== 'number') return null;

    console.log(`[AutoUpdate] Comparando: Nuvem Build ${data.buildNumber} vs Instalado Build ${installed.buildNumber}`);

    // Se houver build superior na nuvem, retorna para abertura do modal
    if (data.buildNumber > installed.buildNumber) {
      return data;
    }

    return null;
  } catch (err) {
    console.warn('[AutoUpdate] Erro ao verificar atualização na nuvem:', err);
    return null;
  }
}
