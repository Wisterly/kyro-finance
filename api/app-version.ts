import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

// Versão de referência e changelog da última release oficial do KYRO Finance
const FALLBACK_RELEASE_INFO = {
  latestVersion: '0.1.10',
  buildNumber: 20,
  publishedAt: new Date().toISOString(),
  apkUrl: 'https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk',
  apkSize: '9.09 MB',
  changelog: [
    'Correção definitiva da gravação de áudio no celular Android (fim da repetição de palavras)',
    'Gravação unificada com MediaRecorder nativo de alta fidelidade e filtros de ruído',
    'Deduplicador inteligente de fala e transcrição multimodal via Google Gemini 1.5 Flash',
    'Solicitação proativa de permissões de microfone nativo no Android',
    'Notificação automática in-app de novas versões com pop-up e atualização em 1 toque'
  ]
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Tenta obter os metadados mais frescos diretamente da Release do GitHub
    const ghRes = await axios.get('https://api.github.com/repos/Wisterly/kyro-finance/releases/tags/apk-latest', {
      timeout: 5000,
      headers: {
        'User-Agent': 'KYRO-Finance-AutoUpdate'
      }
    });

    const releaseData = ghRes.data;
    let apkSizeStr = FALLBACK_RELEASE_INFO.apkSize;
    let apkDownloadUrl = FALLBACK_RELEASE_INFO.apkUrl;

    if (releaseData && Array.isArray(releaseData.assets)) {
      const apkAsset = releaseData.assets.find((a: any) => a.name === 'KYRO-Finance.apk') || releaseData.assets[0];
      if (apkAsset) {
        apkDownloadUrl = apkAsset.browser_download_url || apkDownloadUrl;
        if (apkAsset.size) {
          apkSizeStr = `${(apkAsset.size / (1024 * 1024)).toFixed(2)} MB`;
        }
      }
    }

    return res.status(200).json({
      status: 'success',
      latestVersion: FALLBACK_RELEASE_INFO.latestVersion,
      buildNumber: FALLBACK_RELEASE_INFO.buildNumber,
      publishedAt: releaseData?.published_at || FALLBACK_RELEASE_INFO.publishedAt,
      apkUrl: apkDownloadUrl,
      apkSize: apkSizeStr,
      changelog: FALLBACK_RELEASE_INFO.changelog
    });

  } catch (err: any) {
    // Em caso de rate-limit do GitHub ou falha de conexão, responde com os dados oficiais locais
    return res.status(200).json({
      status: 'fallback',
      ...FALLBACK_RELEASE_INFO
    });
  }
}
