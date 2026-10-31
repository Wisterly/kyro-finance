import { App as CapApp } from '@capacitor/app';
import { UpdateInfo } from '../components/UpdateModal';
import { isRunningInNativeApk } from '../nativeBridge';
import { APP_VERSION, APP_BUILD, APP_CHANGELOG } from '../version';

// Versão de referência deste bundle de compilação
export const CURRENT_APP_VERSION = APP_VERSION;
export const CURRENT_APP_BUILD = APP_BUILD;

/**
 * Extrai dados semânticos de versão a partir do nome do arquivo .apk no GitHub
 * Exemplos:
 * "KYRO-Finance-1.28.apk" -> versionStr: "1.28", buildNumber: 28
 * "KYRO-Finance-v1.28.apk" -> versionStr: "1.28", buildNumber: 28
 * "KYRO-Finance-0.1.28.apk" -> versionStr: "1.28", buildNumber: 28
 */
export function extractVersionFromFileName(filename: string): { versionStr: string; buildNumber: number } | null {
  if (!filename || !filename.toLowerCase().endsWith('.apk')) return null;

  // Regex busca padrões como: KYRO-Finance-1.28.apk, KYRO-Finance-v1.28.apk, 1.28.apk
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
 * Normaliza qualquer formato de versão para o número sequencial da build (ex: "1.28" -> 28, "0.1.28" -> 28, 28 -> 28)
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
 * No Android nativo, consulta o PackageManager do sistema operacional via @capacitor/app e AppUpdateManager.
 * No navegador / PWA, utiliza as constantes compiladas no bundle.
 */
export async function getInstalledAppInfo(): Promise<{ versionName: string; buildNumber: number }> {
  try {
    // 1. Tenta plugin nativo customizado AppUpdateManager
    const cap = (window as any).Capacitor;
    if (cap?.Plugins?.AppUpdateManager?.getAppVersion) {
      const nativeVer = await cap.Plugins.AppUpdateManager.getAppVersion().catch(() => null);
      if (nativeVer && nativeVer.versionCode) {
        const code = parseInt(nativeVer.versionCode, 10);
        if (!isNaN(code) && code > 0) {
          const vName = nativeVer.versionName ? `1.${normalizeVersionCode(nativeVer.versionName)}` : `1.${code}`;
          console.log(`[AutoUpdate] Versão Nativa lida via AppUpdateManager: ${vName} (build: ${code})`);
          return {
            versionName: vName,
            buildNumber: code
          };
        }
      }
    }

    // 2. Tenta plugin padrão do Capacitor @capacitor/app
    const info = await CapApp.getInfo().catch(() => null);
    if (info && info.build) {
      const code = parseInt(info.build, 10);
      if (!isNaN(code) && code > 0) {
        const vName = info.version ? `1.${normalizeVersionCode(info.version)}` : `1.${code}`;
        console.log(`[AutoUpdate] Versão Nativa lida via CapApp: ${vName} (build: ${code})`);
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
 * Inspeciona a pasta de Downloads (Releases) do GitHub e APIs de versionamento.
 * Compara a versão do arquivo mais recente disponível com a versão instalada no aparelho.
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

  // 1. Consulta diretamente a pasta de Downloads do GitHub (Releases do repositório)
  try {
    const ghRes = await fetch(`https://api.github.com/repos/Wisterly/kyro-finance/releases/tags/apk-latest?t=${Date.now()}`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });

    if (ghRes.ok) {
      const release = await ghRes.json();
      if (release && Array.isArray(release.assets) && release.assets.length > 0) {
        connectionSuccess = true;
        let bestAsset: any = null;
        let highestBuild = 0;
        let bestVersion = '';

        // Prioriza assets de release oficial (sem debug no nome)
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
          const foundBuild = parsed?.buildNumber || highestBuild || 28;
          const foundVersion = parsed?.versionStr || bestVersion || `1.${foundBuild}`;

          latestAssetInfo = {
            versionStr: foundVersion,
            buildNumber: foundBuild,
            downloadUrl: bestAsset.browser_download_url,
            fileName: bestAsset.name,
            sizeStr: bestAsset.size ? `${(bestAsset.size / (1024 * 1024)).toFixed(2)} MB` : '9.5 MB',
            publishedAt: release.published_at || new Date().toISOString()
          };
        }
      }
    }
  } catch (ghErr) {
    console.warn('[AutoUpdate] Consulta direta ao GitHub Releases falhou:', ghErr);
  }

  // 2. Consulta a API na Nuvem Vercel (com URL absoluta para funcionar no WebView do Android e Web)
  try {
    const vercelUrls = [
      `https://kyro-finance.vercel.app/api/app-version?t=${Date.now()}`,
      `/api/app-version?t=${Date.now()}`
    ];

    for (const url of vercelUrls) {
      try {
        const res = await fetch(url, {
          headers: { 'Cache-Control': 'no-cache' }
        });
        if (res.ok) {
          const vData = await res.json();
          if (vData && typeof vData.buildNumber === 'number') {
            connectionSuccess = true;
            if (Array.isArray(vData.changelog) && vData.changelog.length > 0) {
              changelog = vData.changelog;
            }
            if (!latestAssetInfo || vData.buildNumber > latestAssetInfo.buildNumber) {
              latestAssetInfo = {
                versionStr: vData.latestVersion || `1.${vData.buildNumber}`,
                buildNumber: vData.buildNumber,
                downloadUrl: vData.apkUrl || `https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance-1.${vData.buildNumber}.apk`,
                fileName: vData.apkFileName || `KYRO-Finance-1.${vData.buildNumber}.apk`,
                sizeStr: vData.apkSize || '9.5 MB',
                publishedAt: vData.publishedAt || new Date().toISOString()
              };
            }
            break;
          }
        }
      } catch (innerErr) {}
    }
  } catch (vErr) {}

  // 3. Fallback para version.json no repositório GitHub
  try {
    const rawRes = await fetch(`https://raw.githubusercontent.com/Wisterly/kyro-finance/main/version.json?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (rawRes.ok) {
      const rawData = await rawRes.json();
      if (rawData && typeof rawData.buildNumber === 'number') {
        connectionSuccess = true;
        if (Array.isArray(rawData.changelog)) {
          changelog = rawData.changelog;
        }
        if (!latestAssetInfo || rawData.buildNumber > latestAssetInfo.buildNumber) {
          latestAssetInfo = {
            versionStr: rawData.version || `1.${rawData.buildNumber}`,
            buildNumber: rawData.buildNumber,
            downloadUrl: `https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance-1.${rawData.buildNumber}.apk`,
            fileName: `KYRO-Finance-1.${rawData.buildNumber}.apk`,
            sizeStr: '9.5 MB',
            publishedAt: rawData.releaseDate || new Date().toISOString()
          };
        }
      }
    }
  } catch (rawErr) {}

  // Se nenhuma fonte de rede respondeu
  if (!latestAssetInfo) {
    if (!connectionSuccess) {
      return {
        hasUpdate: false,
        installedInfo: installed,
        errorMessage: 'Sem conexão com a internet ou GitHub inacessível no momento.'
      };
    }
    return {
      hasUpdate: false,
      installedInfo: installed
    };
  }

  const remoteBuild = latestAssetInfo.buildNumber;
  const installedBuild = installed.buildNumber;

  console.log(`[AutoUpdate] Comparando versão: GitHub (${latestAssetInfo.fileName} • Build ${remoteBuild}) vs Instalado (Build ${installedBuild})`);

  // Se a versão remota no GitHub for superior à instalada
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

  // Mesma versão ou superior instalada
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
