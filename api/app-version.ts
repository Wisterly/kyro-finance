import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

let localVersionData: any = {
  version: '1.28',
  buildNumber: 28,
  releaseDate: new Date().toISOString().split('T')[0],
  changelog: [
    'Identificação inteligente da versão exata dos arquivos na pasta de downloads do GitHub (Releases)',
    'Publicação do APK com o nome expressando a versão (KYRO-Finance-1.28.apk)',
    'Comparação fidedigna entre o aplicativo instalado e a última versão disponível no GitHub',
    'Download e atualização automática do novo aplicativo sem necessidade de desinstalar',
    'Aviso informativo preciso quando o aplicativo já se encontra na versão mais recente'
  ]
};

try {
  const vPath = path.join(process.cwd(), 'version.json');
  if (fs.existsSync(vPath)) {
    localVersionData = JSON.parse(fs.readFileSync(vPath, 'utf8'));
  }
} catch (e) {}

// Função auxiliar para extrair versão de nomes como KYRO-Finance-1.28.apk ou KYRO-Finance-v1.28.apk
function parseVersionFromName(filename: string) {
  if (!filename || !filename.toLowerCase().endsWith('.apk')) return null;
  const match = filename.match(/(?:KYRO[-_]Finance[-_]|v)?(\d+[\._]\d+(?:[\._]\d+)?)(?:[-_]debug)?\.apk/i);
  if (!match) return null;
  const versionStr = match[1].replace(/_/g, '.');
  const parts = versionStr.split('.').map(Number);
  let buildNumber = 0;
  if (parts.length >= 3) buildNumber = parts[2];
  else if (parts.length === 2) buildNumber = parts[1];
  else buildNumber = parts[0] || 0;
  return { versionStr, buildNumber };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let latestVersion = localVersionData.version || '1.28';
  let buildNumber = Number(localVersionData.buildNumber) || 28;
  let changelog = localVersionData.changelog || [];
  let apkDownloadUrl = `https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance-1.${buildNumber}.apk`;
  let apkFileName = `KYRO-Finance-1.${buildNumber}.apk`;
  let apkSizeStr = '9.5 MB';
  let publishedAt = new Date().toISOString();

  // 1. Tenta buscar os dados mais frescos diretamente de version.json no GitHub (cache-busting)
  try {
    const rawRes = await axios.get(`https://raw.githubusercontent.com/Wisterly/kyro-finance/main/version.json?t=${Date.now()}`, {
      timeout: 3500,
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (rawRes.data && typeof rawRes.data.buildNumber === 'number') {
      latestVersion = rawRes.data.version || latestVersion;
      buildNumber = rawRes.data.buildNumber;
      apkFileName = `KYRO-Finance-1.${buildNumber}.apk`;
      apkDownloadUrl = `https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/${apkFileName}`;
      if (Array.isArray(rawRes.data.changelog)) {
        changelog = rawRes.data.changelog;
      }
    }
  } catch (rawErr) {}

  // 2. Consulta os downloads na pasta de Releases do GitHub
  try {
    const ghRes = await axios.get('https://api.github.com/repos/Wisterly/kyro-finance/releases/tags/apk-latest', {
      timeout: 3500,
      headers: {
        'User-Agent': 'KYRO-Finance-AutoUpdate',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    const releaseData = ghRes.data;
    if (releaseData && Array.isArray(releaseData.assets) && releaseData.assets.length > 0) {
      let targetAsset: any = null;
      let highestBuild = 0;

      // Procura primeiro os assets que contêm a versão no nome e prioriza pacotes de release
      const nonDebugAssets = releaseData.assets.filter((a: any) => !a.name.toLowerCase().includes('debug'));
      const candidateAssets = nonDebugAssets.length > 0 ? nonDebugAssets : releaseData.assets;

      for (const asset of candidateAssets) {
        const parsed = parseVersionFromName(asset.name);
        if (parsed && parsed.buildNumber > highestBuild) {
          highestBuild = parsed.buildNumber;
          targetAsset = asset;
          latestVersion = parsed.versionStr;
          buildNumber = parsed.buildNumber;
        }
      }

      // Se não encontrou asset com versão no nome, pega o arquivo KYRO-Finance.apk padrão
      if (!targetAsset) {
        targetAsset = releaseData.assets.find((a: any) => a.name === 'KYRO-Finance.apk') || releaseData.assets[0];
      }

      if (targetAsset) {
        apkDownloadUrl = targetAsset.browser_download_url || apkDownloadUrl;
        apkFileName = targetAsset.name || apkFileName;
        if (targetAsset.size) {
          apkSizeStr = `${(targetAsset.size / (1024 * 1024)).toFixed(2)} MB`;
        }
      }

      if (releaseData.published_at) {
        publishedAt = releaseData.published_at;
      }
    }
  } catch (ghErr) {}

  return res.status(200).json({
    status: 'success',
    latestVersion,
    buildNumber,
    publishedAt,
    apkUrl: apkDownloadUrl,
    apkFileName,
    apkSize: apkSizeStr,
    changelog
  });
}
