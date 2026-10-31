import { App as CapApp } from '@capacitor/app';
import { UpdateInfo } from '../components/UpdateModal';
import { isRunningInNativeApk } from '../nativeBridge';
import { APP_VERSION, APP_BUILD, APP_CHANGELOG } from '../version';

// Versão de referência deste bundle de compilação
export const CURRENT_APP_VERSION = APP_VERSION;
export const CURRENT_APP_BUILD = APP_BUILD;

/**
 * Função utilitária com timeout estrito e proteção contra cache do WebView/navegador
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = 3500): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        ...(options.headers || {})
      }
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Extrai dados semânticos de versão a partir do nome do arquivo .apk no GitHub
 */
export function extractVersionFromFileName(filename: string): { versionStr: string; buildNumber: number } | null {
  if (!filename || !filename.toLowerCase().endsWith('.apk')) return null;

  const match = filename.match(/(?:KYRO[-_]Finance[-_]|v)?(\d+[\._]\d+(?:[\._]\d+)?)(?:[-_]debug)?\.apk/i);
  if (!match) return null;

  const rawStr = match[1].replace(/_/g, '.');
  const parts = rawStr.split('.').map(p => parseInt(p, 10) || 0);

  let buildNumber = 0;
  let versionStr = rawStr;

  if (parts.length >= 3) {
    buildNumber = parts[2];
    versionStr = `1.${parts[2]}`;
  } else if (parts.length === 2) {
    buildNumber = parts[1];
    versionStr = `1.${parts[1]}`;
  } else {
    buildNumber = parts[0] || 0;
    versionStr = `1.${buildNumber}`;
  }

  return { versionStr, buildNumber };
}

/**
 * Normaliza qualquer formato de versão para o número sequencial da build
 */
export function normalizeVersionCode(versionInput?: string | number): number {
  if (typeof versionInput === 'number' && !isNaN(versionInput)) {
    return versionInput;
  }
  if (!versionInput) return 0;
  const str = String(versionInput).replace(/^v/i, '').trim();
  const parts = str.split('.').map(p => parseInt(p, 10) || 0);
  if (parts.length >= 3) return parts[2];
  if (parts.length === 2 && parts[0] === 1) return parts[1];
  if (parts.length === 1) return parts[0];
  return parts[parts.length - 1] || 0;
}

/**
 * Obtém os dados de versão reais instalados no dispositivo.
 */
export async function getInstalledAppInfo(): Promise<{ versionName: string; buildNumber: number }> {
  try {
    const cap = (window as any).Capacitor;
    if (cap?.Plugins?.AppUpdateManager?.getAppVersion) {
      const nativeVer = await cap.Plugins.AppUpdateManager.getAppVersion().catch(() => null);
      if (nativeVer && nativeVer.versionCode) {
        const code = parseInt(nativeVer.versionCode, 10);
        if (!isNaN(code) && code > 0) {
          const vName = nativeVer.versionName ? `1.${normalizeVersionCode(nativeVer.versionName)}` : `1.${code}`;
          return {
            versionName: vName,
            buildNumber: code
          };
        }
      }
    }

    const info = await CapApp.getInfo().catch(() => null);
    if (info && info.build) {
      const code = parseInt(info.build, 10);
      if (!isNaN(code) && code > 0) {
        const vName = info.version ? `1.${normalizeVersionCode(info.version)}` : `1.${code}`;
        return {
          versionName: vName,
          buildNumber: code
        };
      }
    }
  } catch (err) {
    console.warn('[AutoUpdate] Fallback para constantes locais do build:', err);
  }

  return {
    versionName: CURRENT_APP_VERSION,
    buildNumber: CURRENT_APP_BUILD
  };
}

export interface CheckUpdateResult {
  hasUpdate: boolean;
  updateInfo?: UpdateInfo;
  installedInfo: { versionName: string; buildNumber: number };
  remoteInfo?: { versionName: string; buildNumber: number; apkFileName?: string };
  errorMessage?: string;
}

/**
 * Inspeciona imediatamente a nuvem e GitHub com timeout estrito e anti-cache.
 */
export async function checkUpdateDetailed(): Promise<CheckUpdateResult> {
  const installed = await getInstalledAppInfo();
  let latestAssetInfo: {
    versionStr: string;
    buildNumber: number;
    downloadUrl: string;
    fileName: string;
    sizeStr: string;
    publishedAt: string;
  } | null = null;
  let changelog: string[] = [...APP_CHANGELOG];
  let connectionSuccess = false;

  // 1. PRIMEIRA PRIORIDADE (MAIS RÁPIDA E SEM CACHE): API Vercel Nuvem
  try {
    const vercelEndpoints = [
      `https://kyro-finance.vercel.app/api/app-version?t=${Date.now()}_${Math.random()}`,
      `/api/app-version?t=${Date.now()}_${Math.random()}`
    ];

    for (const endpoint of vercelEndpoints) {
      try {
        const res = await fetchWithTimeout(endpoint, {}, 3500);
        if (res.ok) {
          const vData = await res.json().catch(() => null);
          if (vData && typeof vData.buildNumber === 'number') {
            connectionSuccess = true;
            if (Array.isArray(vData.changelog) && vData.changelog.length > 0) {
              changelog = vData.changelog;
            }
            latestAssetInfo = {
              versionStr: vData.latestVersion || `1.${vData.buildNumber}`,
              buildNumber: vData.buildNumber,
              downloadUrl: vData.apkUrl || `https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance-1.${vData.buildNumber}.apk`,
              fileName: vData.apkFileName || `KYRO-Finance-1.${vData.buildNumber}.apk`,
              sizeStr: vData.apkSize || '9.8 MB',
              publishedAt: vData.publishedAt || new Date().toISOString()
            };
            break;
          }
        }
      } catch (inner) {}
    }
  } catch (vErr) {}

  // 2. SEGUNDA PRIORIDADE: version.json no repositório GitHub (com anti-cache)
  if (!latestAssetInfo) {
    try {
      const rawRes = await fetchWithTimeout(`https://raw.githubusercontent.com/Wisterly/kyro-finance/main/version.json?t=${Date.now()}_${Math.random()}`, {}, 3500);
      if (rawRes.ok) {
        const rawData = await rawRes.json().catch(() => null);
        if (rawData && typeof rawData.buildNumber === 'number') {
          connectionSuccess = true;
          if (Array.isArray(rawData.changelog)) {
            changelog = rawData.changelog;
          }
          latestAssetInfo = {
            versionStr: rawData.version || `1.${rawData.buildNumber}`,
            buildNumber: rawData.buildNumber,
            downloadUrl: `https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance-1.${rawData.buildNumber}.apk`,
            fileName: `KYRO-Finance-1.${rawData.buildNumber}.apk`,
            sizeStr: '9.8 MB',
            publishedAt: rawData.releaseDate || new Date().toISOString()
          };
        }
      }
    } catch (rawErr) {}
  }

  // 3. TERCEIRA PRIORIDADE: GitHub Releases API
  if (!latestAssetInfo) {
    try {
      const ghRes = await fetchWithTimeout(`https://api.github.com/repos/Wisterly/kyro-finance/releases/tags/apk-latest?t=${Date.now()}_${Math.random()}`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      }, 3500);

      if (ghRes.ok) {
        const release = await ghRes.json().catch(() => null);
        if (release && Array.isArray(release.assets) && release.assets.length > 0) {
          connectionSuccess = true;
          let bestAsset: any = null;
          let highestBuild = 0;
          let bestVersion = '';

          const nonDebugAssets = release.assets.filter((a: any) => !a.name.toLowerCase().includes('debug'));
          const candidateAssets = nonDebugAssets.length > 0 ? nonDebugAssets : release.assets;

          for (const asset of candidateAssets) {
            const parsed = extractVersionFromFileName(asset.name);
            if (parsed && parsed.buildNumber > highestBuild) {
              highestBuild = parsed.buildNumber;
              bestVersion = parsed.versionStr;
              bestAsset = asset;
            }
          }

          if (!bestAsset) {
            bestAsset = release.assets.find((a: any) => a.name === 'KYRO-Finance.apk') || release.assets[0];
          }

          if (bestAsset) {
            const parsed = extractVersionFromFileName(bestAsset.name);
            const foundBuild = parsed?.buildNumber || highestBuild || 35;
            const foundVersion = parsed?.versionStr || bestVersion || `1.${foundBuild}`;

            latestAssetInfo = {
              versionStr: foundVersion,
              buildNumber: foundBuild,
              downloadUrl: bestAsset.browser_download_url,
              fileName: bestAsset.name,
              sizeStr: bestAsset.size ? `${(bestAsset.size / (1024 * 1024)).toFixed(1)} MB` : '9.8 MB',
              publishedAt: release.published_at || new Date().toISOString()
            };
          }
        }
      }
    } catch (ghErr) {}
  }

  // Se nenhuma fonte respondeu
  if (!latestAssetInfo) {
    return {
      hasUpdate: false,
      installedInfo: installed,
      errorMessage: connectionSuccess ? undefined : 'Não foi possível conectar ao servidor de atualizações. Verifique sua conexão com a internet.'
    };
  }

  const remoteBuild = latestAssetInfo.buildNumber;
  const installedBuild = installed.buildNumber;

  console.log(`[AutoUpdate] Comparação instantânea: Remoto Build ${remoteBuild} (${latestAssetInfo.versionStr}) vs Instalado Build ${installedBuild} (${installed.versionName})`);

  if (remoteBuild > installedBuild) {
    const updateInfo: UpdateInfo = {
      latestVersion: latestAssetInfo.versionStr,
      buildNumber: remoteBuild,
      publishedAt: latestAssetInfo.publishedAt,
      apkUrl: latestAssetInfo.downloadUrl,
      apkFileName: latestAssetInfo.fileName,
      apkSize: latestAssetInfo.sizeStr,
      changelog
    };

    return {
      hasUpdate: true,
      updateInfo,
      installedInfo: installed,
      remoteInfo: {
        versionName: latestAssetInfo.versionStr,
        buildNumber: remoteBuild,
        apkFileName: latestAssetInfo.fileName
      }
    };
  }

  return {
    hasUpdate: false,
    installedInfo: installed,
    remoteInfo: {
      versionName: latestAssetInfo.versionStr,
      buildNumber: remoteBuild,
      apkFileName: latestAssetInfo.fileName
    }
  };
}

/**
 * Função simplificada para verificação automática contínua
 */
export async function checkForAppUpdate(): Promise<UpdateInfo | null> {
  const result = await checkUpdateDetailed();
  if (result.hasUpdate && result.updateInfo) {
    return result.updateInfo;
  }
  return null;
}
