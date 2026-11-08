/**
 * KYRO FINANCE | FRONTEIRA DE AUTORIZAÇÃO E ISOLAMENTO DE TENANT
 * 
 * Regras Estritas:
 * 1. O UID é SEMPRE derivado do token verificado (Firebase Auth / Admin SDK).
 * 2. Qualquer UID fornecido no corpo, na query ou na rota NUNCA permite acesso a outra conta.
 * 3. Tentativas de acesso cross-tenant são bloqueadas sumariamente com erro de autorização.
 * 4. No Webhook, a identidade do provedor (WhatsApp phone/JID) é separada da identidade do usuário (UID).
 *    A origem do webhook é validada e o vínculo com o UID é resolvido no servidor antes de autorizar a escrita.
 *    Vínculos ausentes ou ambíguos são terminantemente rejeitados.
 */

import crypto from 'crypto';
import { verifyRealAuthToken, VerifyTokenOptions } from './firebaseAdminAuth';

export interface AuthContext {
  uid: string;
  email?: string;
  role?: string;
  isValid: boolean;
  error?: string;
}

export class CrossTenantViolationError extends Error {
  public readonly code = 'PERMISSION_DENIED_CROSS_TENANT';
  public readonly statusCode = 403;
  constructor(message: string) {
    super(`[CrossTenantViolation] ${message}`);
    this.name = 'CrossTenantViolationError';
  }
}

export class AuthenticationError extends Error {
  public readonly code = 'UNAUTHORIZED_INVALID_CREDENTIAL';
  public readonly statusCode = 401;
  constructor(message: string) {
    super(`[AuthenticationError] ${message}`);
    this.name = 'AuthenticationError';
  }
}

export class WebhookAuthorizationError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  constructor(message: string, code: string, statusCode: number = 403) {
    super(`[WebhookAuthorizationError] ${message}`);
    this.name = 'WebhookAuthorizationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Valida o cabeçalho Authorization: Bearer <token>.
 * Utiliza o Firebase Admin SDK oficial e verificador criptográfico estrito.
 */
export async function verifyAuthToken(
  authHeader: string | undefined,
  options: VerifyTokenOptions = {}
): Promise<AuthContext> {
  return await verifyRealAuthToken(authHeader, options);
}

/**
 * Aplica a fronteira estrita de isolamento de tenant.
 * O UID retornado é SEMPRE o derivado do token autenticado.
 * Se o chamador tentou passar outro UID (corpo ou rota), lança erro fatal de segurança.
 */
export function enforceTenantBoundary(authContext: AuthContext, requestedUid?: string): string {
  if (!authContext.isValid || !authContext.uid) {
    throw new AuthenticationError('Acesso não autorizado: credencial inválida ou ausente.');
  }

  const tokenUid = authContext.uid;

  if (requestedUid && requestedUid.trim() !== '' && requestedUid !== tokenUid) {
    throw new CrossTenantViolationError(
      `Violação de fronteira: Token autenticado como '${tokenUid}' tentou acessar recursos de '${requestedUid}'. Acesso bloqueado.`
    );
  }

  return tokenUid;
}

// -------------------------------------------------------------
// FRONTEIRA DO WEBHOOK (WHATSAPP BAILEYS / EVOLUTION)
// -------------------------------------------------------------

export interface ProviderBinding {
  providerPhone: string;
  userId: string;
  instanceId?: string;
  status: 'ACTIVE' | 'REVOKED';
  boundAt: string;
}

export interface BindingResolution {
  status: 'RESOLVED' | 'UNBOUND' | 'AMBIGUOUS';
  userId?: string;
  error?: string;
}

/**
 * Valida se a requisição originou-se de um webhook autorizado (segredo / API Key).
 */
export function validateWebhookOrigin(
  headers: Record<string, string | string[] | undefined>,
  configuredSecret?: string
): boolean {
  const secret = configuredSecret || process.env.WEBHOOK_SECRET || 'kyro_webhook_secret_dev';
  
  const incomingSecret = 
    headers['x-webhook-secret'] || 
    headers['x-api-key'] || 
    headers['apikey'] || 
    (typeof headers['authorization'] === 'string' ? headers['authorization'].replace(/Bearer\s+/i, '') : '');

  if (!incomingSecret) return false;
  return incomingSecret === secret;
}

/**
 * Valida se a requisição possui credencial com autorização administrativa (Admin Role).
 * Utilizado para proteger operações operacionais e sensíveis de vínculos e configuração de bot.
 */
export function validateAdminAuthorization(
  headers: Record<string, string | string[] | undefined>,
  configuredAdminKey?: string
): boolean {
  const adminSecret = configuredAdminKey || process.env.KYRO_ADMIN_SECRET || process.env.ADMIN_KEY || 'kyro_admin_master_secret';

  const incomingAdminKey = 
    headers['x-admin-key'] || 
    headers['x-kyro-admin-token'] || 
    (typeof headers['authorization'] === 'string' && (headers['authorization'].toLowerCase().includes('admin') || headers['authorization'] === `Bearer ${adminSecret}`)
      ? headers['authorization'].replace(/Bearer\s+/i, '')
      : '');

  if (!incomingAdminKey) return false;
  return incomingAdminKey === adminSecret;
}

/**
 * Resolve o vínculo entre a identidade do provedor (número de telefone) e o UID interno do usuário.
 * Mantém rejeição estrita quando o vínculo estiver ausente ou ambíguo.
 */
export function resolveProviderBinding(
  bindings: ProviderBinding[],
  providerPhone: string
): BindingResolution {
  if (!providerPhone) {
    return {
      status: 'UNBOUND',
      error: 'Identidade do provedor (telefone) não informada no evento.'
    };
  }

  // Sanitiza número: apenas dígitos (ex: 558695368780)
  const cleanPhone = providerPhone.replace(/\D/g, '');
  const activeMatches = bindings.filter(
    b => b.status === 'ACTIVE' && b.providerPhone.replace(/\D/g, '') === cleanPhone
  );

  if (activeMatches.length === 0) {
    return {
      status: 'UNBOUND',
      error: `Identidade do provedor '${providerPhone}' não possui vínculo ativo com nenhum usuário.`
    };
  }

  // Detecção de ambiguidade: se o mesmo telefone estiver mapeado para mais de um UID diferente
  const uniqueUids = new Set(activeMatches.map(b => b.userId));
  if (uniqueUids.size > 1) {
    return {
      status: 'AMBIGUOUS',
      error: `Identidade do provedor '${providerPhone}' é ambígua: mapeada para múltiplos UIDs (${Array.from(uniqueUids).join(', ')}). Escrita bloqueada.`
    };
  }

  return {
    status: 'RESOLVED',
    userId: activeMatches[0].userId
  };
}

/**
 * Validação Criptográfica de Assinatura HMAC SHA-256 do corpo original (rawBody).
 * Resistente a timing attacks via timingSafeEqual.
 */
export function validateWebhookHmac(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  configuredSecret?: string
): boolean {
  if (!signatureHeader) return false;
  const secret = configuredSecret || process.env.WEBHOOK_SECRET || 'kyro_webhook_secret_dev';

  const cleanSignature = signatureHeader.replace(/^sha256=/i, '').trim();
  if (cleanSignature.length !== 64) return false;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const calculatedHex = hmac.digest('hex');

  const bufIncoming = Buffer.from(cleanSignature, 'hex');
  const bufCalculated = Buffer.from(calculatedHex, 'hex');

  if (bufIncoming.length !== bufCalculated.length) return false;
  return crypto.timingSafeEqual(bufIncoming, bufCalculated);
}

/**
 * Validação de tolerância de Timestamp (tolerância máxima de 5 minutos = 300.000 ms).
 */
export function validateWebhookTimestamp(
  timestampHeader: string | undefined,
  maxToleranceMs: number = 300000
): { valid: boolean; error?: string } {
  if (!timestampHeader) {
    return { valid: false, error: 'Cabeçalho x-webhook-timestamp é obrigatório.' };
  }

  const parsed = Number(timestampHeader) || Date.parse(timestampHeader);
  if (isNaN(parsed) || parsed <= 0) {
    return { valid: false, error: 'Timestamp em formato inválido.' };
  }

  const drift = Math.abs(Date.now() - parsed);
  if (drift > maxToleranceMs) {
    return {
      valid: false,
      error: `Timestamp expirado. Desvio temporal de ${Math.round(drift / 1000)}s excede a tolerância máxima permitida de ${Math.round(maxToleranceMs / 1000)}s.`
    };
  }

  return { valid: true };
}

/**
 * Validação de proteção contra replay com Nonce único.
 * Suporta cache em memória e persistência distribuída via ITransactionalStore.
 */
export async function validateWebhookNonce(
  nonce: string | undefined,
  seenNonces: Set<string>,
  store?: any
): Promise<{ valid: boolean; error?: string }> {
  if (!nonce || nonce.trim().length === 0) {
    return { valid: false, error: 'Cabeçalho x-webhook-nonce é obrigatório para proteção contra replay.' };
  }

  // 1. Verificação rápida em memória local
  if (seenNonces.has(nonce)) {
    return {
      valid: false,
      error: `Replay detectado: Nonce '${nonce}' já foi processado anteriormente.`
    };
  }

  // 2. Verificação atômica no armazenamento persistente compartilhado (multi-processo)
  if (store && typeof store.runTransaction === 'function') {
    try {
      const isReplay = await store.runTransaction(async (t: any) => {
        const noncePath = `webhook_nonces/${nonce}`;
        const existing = await t.get(noncePath);
        if (existing) {
          return true; // Replay detectado no storage compartilhado
        }
        t.set(noncePath, {
          nonce,
          createdAt: new Date().toISOString(),
          timestamp: Date.now()
        });
        return false;
      });

      if (isReplay) {
        seenNonces.add(nonce);
        return {
          valid: false,
          error: `Replay detectado entre instâncias: Nonce '${nonce}' já foi persistido anteriormente no Firestore.`
        };
      }
    } catch (e: any) {
      console.warn('[NonceStorage] Erro ao verificar nonce compartilhado:', e?.message);
    }
  }

  seenNonces.add(nonce);
  return { valid: true };
}

