import { UpdateInfo } from '../components/UpdateModal';
import { isRunningInNativeApk } from '../nativeBridge';

// Versão do código empacotado neste cliente
export const CURRENT_APP_VERSION = '0.1.10';
export const CURRENT_APP_BUILD = 20;

export async function checkForAppUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch('/api/app-version', {
      headers: {
        'Cache-Control': 'no-cache'
      }
    });

    if (!res.ok) return null;

    const data: UpdateInfo = await res.json();
    if (!data || !data.buildNumber) return null;

    // Se houver build superior na nuvem
    if (data.buildNumber > CURRENT_APP_BUILD) {
      return data;
    }

    return null;
  } catch (err) {
    console.warn('[AutoUpdate] Erro ao verificar atualização:', err);
    return null;
  }
}
