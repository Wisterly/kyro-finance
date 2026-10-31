import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Função auxiliar para extrair versão de nomes como KYRO-Finance-1.35.apk ou KYRO-Finance-v1.35.apk
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Pragma');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Sempre lê o version.json do deploy atual da Vercel (garantia de frescor a cada requisição)
  let localVersionData: any = {
    version: '1.35',
    buildNumber: 35,
    releaseDate: new Date().toISOString().split('T')[0],
    changelog: []
  };

  try {
    const vPath = path.join(process.cwd(), 'version.json');
    if (fs.existsSync(vPath)) {
      localVersionData = JSON.parse(fs.readFileSync(vPath, 'utf8'));
    }
  } catch (e) {}

  let latestVersion = localVersionData.version || '1.35';
  let buildNumber = Number(localVersionData.buildNumber) || 35;
  let changelog = Array.isArray(localVersionData.changelog) ? localVersionData.changelog : [];
  let apkDownloadUrl = `https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance-1.${buildNumber}.apk`;
  let apkFileName = `KYRO-Finance-1.${buildNumber}.apk`;
  let apkSizeStr = '9.8 MB';
  let publishedAt = localVersionData.releaseDate || new Date().toISOString();

  // 2. Tenta buscar os dados mais frescos diretamente de version.json no repositório GitHub
  try {
    const rawRes = await axios.get(`https://raw.githubusercontent.com/Wisterly/kyro-finance/main/version.json?t=${Date.now()}`, {
      timeout: 2500,
      headers: { 
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    if (rawRes.data && typeof rawRes.data.buildNumber === 'number') {
      if (rawRes.data.buildNumber >= buildNumber) {
        latestVersion = rawRes.data.version || latestVersion;
        buildNumber = rawRes.data.buildNumber;
        apkFileName = `KYRO-Finance-1.${buildNumber}.apk`;
        apkDownloadUrl = `https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/${apkFileName}`;
        if (Array.isArray(rawRes.data.changelog) && rawRes.data.changelog.length > 0) {
          changelog = rawRes.data.changelog;
        }
      }
    }
  } catch (rawErr) {}

  // 3. Consulta os downloads na pasta de Releases do GitHub (sem travar se der rate limit)
  try {
    const ghRes = await axios.get(`https://api.github.com/repos/Wisterly/kyro-finance/releases/tags/apk-latest?t=${Date.now()}`, {
      timeout: 2500,
      headers: {
        'User-Agent': 'KYRO-Finance-AutoUpdate',
        'Accept': 'application/vnd.github.v3+json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

    const releaseData = ghRes.data;
    if (releaseData && Array.isArray(releaseData.assets) && releaseData.assets.length > 0) {
      let highestBuild = buildNumber;
      let targetAsset: any = null;

      const nonDebugAssets = releaseData.assets.filter((a: any) => !a.name.toLowerCase().includes('debug'));
      const candidateAssets = nonDebugAssets.length > 0 ? nonDebugAssets : releaseData.assets;

      for (const asset of candidateAssets) {
        const parsed = parseVersionFromName(asset.name);
        if (parsed && parsed.buildNumber >= highestBuild) {
          highestBuild = parsed.buildNumber;
          targetAsset = asset;
          latestVersion = parsed.versionStr;
          buildNumber = parsed.buildNumber;
        }
      }

      if (targetAsset) {
        apkDownloadUrl = targetAsset.browser_download_url;
        apkFileName = targetAsset.name;
        if (targetAsset.size) {
          apkSizeStr = `${(targetAsset.size / (1024 * 1024)).toFixed(1)} MB`;
        }
        publishedAt = releaseData.published_at || publishedAt;
      }
    }
  } catch (ghErr) {}

  return res.status(200).json({
    latestVersion,
    buildNumber,
    apkUrl: apkDownloadUrl,
    apkFileName,
    apkSize: apkSizeStr,
    publishedAt,
    changelog,
    directReleaseDownload: 'https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk'
  });
}
