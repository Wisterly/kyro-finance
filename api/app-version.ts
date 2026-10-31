import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Carrega metadados dinâmicos de version.json se disponível
let localVersionData: any = {
  version: '0.1.24',
  buildNumber: 24,
  releaseDate: new Date().toISOString().split('T')[0],
  changelog: [
    'Interpretação e filtragem precisa de áudios no WhatsApp e no chat interno',
    'Fim de respostas e valores padrão de R$ 20 em áudios de voz',
    'Verificação de atualização dinâmica e em tempo real via GitHub e nuvem',
    'Atualização com 1 toque in-app sem precisar desinstalar o aplicativo'
  ]
};

try {
  const vPath = path.join(process.cwd(), 'version.json');
  if (fs.existsSync(vPath)) {
    localVersionData = JSON.parse(fs.readFileSync(vPath, 'utf8'));
  }
} catch (e) {}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let latestVersion = localVersionData.version || '0.1.24';
  let buildNumber = Number(localVersionData.buildNumber) || 24;
  let changelog = localVersionData.changelog || [];
  let apkDownloadUrl = 'https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk';
  let apkSizeStr = '9.1 MB';
  let publishedAt = new Date().toISOString();

  // 1. Tenta buscar os dados mais frescos diretamente do arquivo version.json no GitHub (cache-busting)
  try {
    const rawRes = await axios.get(`https://raw.githubusercontent.com/Wisterly/kyro-finance/main/version.json?t=${Date.now()}`, {
      timeout: 3500,
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (rawRes.data && typeof rawRes.data.buildNumber === 'number') {
      latestVersion = rawRes.data.version || latestVersion;
      buildNumber = rawRes.data.buildNumber;
      if (Array.isArray(rawRes.data.changelog)) {
        changelog = rawRes.data.changelog;
      }
    }
  } catch (rawErr) {}

  // 2. Tenta obter o tamanho e link do APK da Release oficial no GitHub
  try {
    const ghRes = await axios.get('https://api.github.com/repos/Wisterly/kyro-finance/releases/tags/apk-latest', {
      timeout: 3500,
      headers: {
        'User-Agent': 'KYRO-Finance-AutoUpdate'
      }
    });

    const releaseData = ghRes.data;
    if (releaseData && Array.isArray(releaseData.assets)) {
      const apkAsset = releaseData.assets.find((a: any) => a.name === 'KYRO-Finance.apk') || releaseData.assets[0];
      if (apkAsset) {
        apkDownloadUrl = apkAsset.browser_download_url || apkDownloadUrl;
        if (apkAsset.size) {
          apkSizeStr = `${(apkAsset.size / (1024 * 1024)).toFixed(2)} MB`;
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
    apkSize: apkSizeStr,
    changelog
  });
}
