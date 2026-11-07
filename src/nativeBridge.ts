// ============================================================================
// PONTE NATIVA ANDROID (CAPACITOR) <-> VERCEL CLOUD (KYRO FINANCE)
// Garante que o APK instalado no Android carregue a interface instantaneamente
// da memória do celular (0ms) enquanto sincroniza 100% das rotas /api/* com a Vercel.
// ============================================================================

const DEFAULT_VERCEL_CLOUD_URL = 'https://kyro-finance.vercel.app';

export class CleartextTrafficBlockedError extends Error {
  public readonly code = 'CLEARTEXT_TRAFFIC_BLOCKED';
  public readonly statusCode = 400;
  constructor(url: string) {
    super(`[SecurityPolicy] Tráfego em texto claro (HTTP) bloqueado pela política do APK para '${url}'. Apenas conexões seguras HTTPS (TLS) são permitidas.`);
    this.name = 'CleartextTrafficBlockedError';
  }
}

export function isCleartextBlocked(url: string): boolean {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  // Bloqueia qualquer chamada para http:// insegura (cleartext)
  if (trimmed.startsWith('http://')) {
    return true;
  }
  return false;
}

export function enforceSecureTransport(url: string): string {
  if (isCleartextBlocked(url)) {
    throw new CleartextTrafficBlockedError(url);
  }
  return url;
}

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
    if (customUrl) {
      const sanitized = customUrl.replace(/\/$/, '');
      if (isCleartextBlocked(sanitized)) {
        console.warn(`[KYRO Security] URL personalizada rejeitada por violar política cleartext: ${sanitized}`);
        return DEFAULT_VERCEL_CLOUD_URL;
      }
      if (sanitized.startsWith('https://')) {
        return sanitized;
      }
    }
  } catch {
    // Ignora erro de storage
  }
  return DEFAULT_VERCEL_CLOUD_URL;
}

export function initNativeBridge(): void {
  if (typeof window === 'undefined') return;
  if (!isRunningInNativeApk()) return;

  const cloudBase = enforceSecureTransport(getCloudBaseUrl());
  console.log(`[KYRO Native APK] Modo Aplicativo Android Ativo. Conectado com segurança à nuvem: ${cloudBase}`);

  // 1. Interceptador transparente de window.fetch para rotas relativas "/api/*"
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      if (typeof input === 'string') {
        if (isCleartextBlocked(input)) {
          throw new CleartextTrafficBlockedError(input);
        }
        if (input.startsWith('/api/') || input === '/api') {
          const sep = input.includes('?') ? '&' : '?';
          const antiCache = `_nc=${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          return originalFetch(`${cloudBase}${input}${sep}${antiCache}`, init);
        }
      } else if (input instanceof URL) {
        if (isCleartextBlocked(input.toString())) {
          throw new CleartextTrafficBlockedError(input.toString());
        }
        if (input.origin === window.location.origin && input.pathname.startsWith('/api/')) {
          const sep = input.search ? '&' : '?';
          const antiCache = `_nc=${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          return originalFetch(`${cloudBase}${input.pathname}${input.search}${sep}${antiCache}`, init);
        }
      } else if (input instanceof Request) {
        if (isCleartextBlocked(input.url)) {
          throw new CleartextTrafficBlockedError(input.url);
        }
        const reqUrl = new URL(input.url, window.location.origin);
        if (reqUrl.origin === window.location.origin && reqUrl.pathname.startsWith('/api/')) {
          const sep = reqUrl.search ? '&' : '?';
          const antiCache = `_nc=${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const targetUrl = `${cloudBase}${reqUrl.pathname}${reqUrl.search}${sep}${antiCache}`;
          const newReq = new Request(targetUrl, input);
          return originalFetch(newReq);
        }
      }
    } catch (err) {
      if (err instanceof CleartextTrafficBlockedError) {
        return Promise.reject(err);
      }
      console.warn('[KYRO Native APK] Aviso ao redirecionar rota para nuvem:', err);
    }
    return originalFetch(input, init);
  };

  // 2. Interceptador transparente de EventSource (SSE) para rotas "/api/*"
  if (typeof window.EventSource !== 'undefined') {
    const OriginalEventSource = window.EventSource;
    const PatchedEventSource = function (url: string | URL, eventSourceInitDict?: EventSourceInit) {
      let finalUrl = url;
      if (typeof url === 'string') {
        if (isCleartextBlocked(url)) {
          throw new CleartextTrafficBlockedError(url);
        }
        if (url.startsWith('/api/')) {
          finalUrl = `${cloudBase}${url}`;
        }
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

// Higienizador e desduplicador de transcrição falada contra repetições de frames
export function cleanAndDeduplicateTranscript(rawText: string): string {
  if (!rawText) return '';
  let clean = rawText.replace(/\s+/g, ' ').trim();
  if (!clean) return '';

  // Normaliza pontuação duplicada (ex: ", ," ou "..")
  clean = clean.replace(/([,.!?;:])(?:\s*[,.!?;:])+/g, '$1');
  // Remove espaço antes de pontuações
  clean = clean.replace(/\s+([,.!?;:])/g, '$1');

  let words = clean.split(' ');
  let changed = true;
  let maxLoops = 8;
  while (changed && maxLoops-- > 0 && words.length > 1) {
    changed = false;
    for (let len = Math.floor(words.length / 2); len >= 1; len--) {
      for (let i = 0; i + 2 * len <= words.length; i++) {
        const b1 = words.slice(i, i + len).map(w => w.toLowerCase().replace(/[,.!?;:]/g, '')).join(' ');
        const b2 = words.slice(i + len, i + 2 * len).map(w => w.toLowerCase().replace(/[,.!?;:]/g, '')).join(' ');
        if (b1 && b1 === b2) {
          words.splice(i + len, len);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const cur = words[i];
    const prev = out.length > 0 ? out[out.length - 1] : '';
    const curNorm = cur.toLowerCase().replace(/[,.!?;:]/g, '');
    const prevNorm = prev.toLowerCase().replace(/[,.!?;:]/g, '');
    if ((curNorm && curNorm === prevNorm) || (!curNorm && cur === prev)) {
      continue;
    }
    out.push(cur);
  }
  return out.join(' ').replace(/\s+([,.!?;:])/g, '$1').trim();
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

