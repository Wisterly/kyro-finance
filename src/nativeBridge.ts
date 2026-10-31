// ============================================================================
// PONTE NATIVA ANDROID (CAPACITOR) <-> VERCEL CLOUD (KYRO FINANCE)
// Garante que o APK instalado no Android carregue a interface instantaneamente
// da memória do celular (0ms) enquanto sincroniza 100% das rotas /api/* com a Vercel.
// ============================================================================

const DEFAULT_VERCEL_CLOUD_URL = 'https://kyro-finance.vercel.app';

export function isRunningInNativeApk(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) {
    return true;
  }
  if (window.location.protocol === 'capacitor:' || window.location.protocol === 'file:') {
    return true;
  }
  // No Capacitor Android com androidScheme: 'https', a origem é https://localhost (sem porta)
  if (window.location.hostname === 'localhost' && !window.location.port) {
    return true;
  }
  return false;
}

export function getCloudBaseUrl(): string {
  try {
    const customUrl = localStorage.getItem('kyro_vercel_cloud_url');
    if (customUrl && customUrl.startsWith('http')) {
      return customUrl.replace(/\/$/, '');
    }
  } catch {
    // Ignora erro de storage
  }
  return DEFAULT_VERCEL_CLOUD_URL;
}

export function initNativeBridge(): void {
  if (typeof window === 'undefined') return;
  if (!isRunningInNativeApk()) return;

  const cloudBase = getCloudBaseUrl();
  console.log(`[KYRO Native APK] Modo Aplicativo Android Ativo. Conectado à nuvem: ${cloudBase}`);

  // 1. Interceptador transparente de window.fetch para rotas relativas "/api/*"
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const modifiedInit: RequestInit = { ...(init || {}) };
      const reqHeaders = new Headers(modifiedInit.headers || {});
      if (!reqHeaders.has('Cache-Control')) {
        reqHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
      if (!reqHeaders.has('Pragma')) {
        reqHeaders.set('Pragma', 'no-cache');
      }
      modifiedInit.headers = reqHeaders;
      if (!modifiedInit.cache) {
        modifiedInit.cache = 'no-store';
      }

      if (typeof input === 'string') {
        if (input.startsWith('/api/') || input === '/api') {
          const sep = input.includes('?') ? '&' : '?';
          const antiCache = `_nc=${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          return originalFetch(`${cloudBase}${input}${sep}${antiCache}`, modifiedInit);
        }
      } else if (input instanceof URL) {
        if (input.origin === window.location.origin && input.pathname.startsWith('/api/')) {
          const sep = input.search ? '&' : '?';
          const antiCache = `_nc=${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          return originalFetch(`${cloudBase}${input.pathname}${input.search}${sep}${antiCache}`, modifiedInit);
        }
      } else if (input instanceof Request) {
        const reqUrl = new URL(input.url, window.location.origin);
        if (reqUrl.origin === window.location.origin && reqUrl.pathname.startsWith('/api/')) {
          const sep = reqUrl.search ? '&' : '?';
          const antiCache = `_nc=${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const targetUrl = `${cloudBase}${reqUrl.pathname}${reqUrl.search}${sep}${antiCache}`;
          const newReq = new Request(targetUrl, { ...input, ...modifiedInit });
          return originalFetch(newReq);
        }
      }
    } catch (err) {
      console.warn('[KYRO Native APK] Aviso ao redirecionar rota para nuvem:', err);
    }
    return originalFetch(input, init);
  };

  // 2. Interceptador transparente de EventSource (SSE) para rotas "/api/*"
  if (typeof window.EventSource !== 'undefined') {
    const OriginalEventSource = window.EventSource;
    const PatchedEventSource = function (url: string | URL, eventSourceInitDict?: EventSourceInit) {
      let finalUrl = url;
      if (typeof url === 'string' && url.startsWith('/api/')) {
        finalUrl = `${cloudBase}${url}`;
      }
      return new OriginalEventSource(finalUrl, eventSourceInitDict);
    } as unknown as typeof EventSource;
    PatchedEventSource.prototype = OriginalEventSource.prototype;
    (PatchedEventSource as any).CONNECTING = OriginalEventSource.CONNECTING;
    (PatchedEventSource as any).OPEN = OriginalEventSource.OPEN;
    (PatchedEventSource as any).CLOSED = OriginalEventSource.CLOSED;
    window.EventSource = PatchedEventSource;
  }
}

// ============================================================================
// SERVIÇO DE RECONHECIMENTO DE VOZ NATIVO ANDROID (GOOGLE SPEECH RECOGNIZER)
// Permite que o app Android transcreva a fala em tempo real exatamente igual
// ao Chrome Desktop, alimentando o input e o card ao vivo com 100% de precisão.
// ============================================================================

let speechListeners: any[] = [];

export async function isNativeSpeechAvailable(): Promise<boolean> {
  try {
    const cap = (window as any).Capacitor;
    if (!cap || !cap.Plugins || !cap.Plugins.NativeSpeechRecognizer) {
      return false;
    }
    const res = await cap.Plugins.NativeSpeechRecognizer.isAvailable();
    return !!res?.available;
  } catch {
    return false;
  }
}

export async function startNativeSpeech({
  onPartial,
  onFinal,
  onError
}: {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (err: any) => void;
}): Promise<boolean> {
  try {
    const cap = (window as any).Capacitor;
    const plugin = cap?.Plugins?.NativeSpeechRecognizer;
    if (!plugin) return false;

    // Limpa listeners antigos
    for (const handle of speechListeners) {
      try {
        if (typeof handle.remove === 'function') handle.remove();
      } catch {}
    }
    speechListeners = [];

    const partialSub = await plugin.addListener('partialResult', (data: { text: string }) => {
      if (data && data.text) {
        onPartial(data.text);
      }
    });
    speechListeners.push(partialSub);

    const finalSub = await plugin.addListener('finalResult', (data: { text: string }) => {
      if (data && data.text) {
        onFinal(data.text);
      }
    });
    speechListeners.push(finalSub);

    const errSub = await plugin.addListener('error', (data: any) => {
      if (onError) onError(data);
    });
    speechListeners.push(errSub);

    await plugin.startListening();
    return true;
  } catch (err) {
    if (onError) onError(err);
    return false;
  }
}

export async function stopNativeSpeech(): Promise<void> {
  try {
    const cap = (window as any).Capacitor;
    const plugin = cap?.Plugins?.NativeSpeechRecognizer;
    if (plugin) {
      await plugin.stopListening();
    }
  } catch {}
}

export async function cancelNativeSpeech(): Promise<void> {
  try {
    const cap = (window as any).Capacitor;
    const plugin = cap?.Plugins?.NativeSpeechRecognizer;
    if (plugin) {
      await plugin.cancelListening();
    }
    for (const handle of speechListeners) {
      try {
        if (typeof handle.remove === 'function') handle.remove();
      } catch {}
    }
    speechListeners = [];
  } catch {}
}

