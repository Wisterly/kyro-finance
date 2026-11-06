/**
 * KYRO FINANCE | AUTENTICAÇÃO REAL COM FIREBASE ADMIN SDK
 * 
 * Implementação oficial para verificação de ID Tokens com o Firebase Admin SDK (API modular v12+).
 * - Validação de ID Tokens reais via getAuth().verifyIdToken()
 * - Conexão transparente com Firebase Auth Emulator via FIREBASE_AUTH_EMULATOR_HOST
 * - Validação estrita de assinatura RS256, expiração, issuer e audience (projectId)
 * - Restrição categórica de credenciais sintéticas exclusivamente a testes isolados
 */

import { initializeApp, getApps, getApp, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import * as crypto from 'crypto';
import { AuthContext } from './authBoundary';

export const DEMO_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'demo-kyro-synthetic';

export function getAdminApp(): App {
  const apps = getApps();
  if (apps.length > 0 && apps[0]) {
    return apps[0];
  }
  return initializeApp({
    projectId: DEMO_PROJECT_ID
  });
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export interface VerifyTokenOptions {
  allowSyntheticInTest?: boolean;
  expectedProjectId?: string;
}

/**
 * Valida o cabeçalho Authorization usando o Firebase Admin SDK oficial.
 * Testa formato Bearer, decodificação, assinatura criptográfica,
 * expiração (exp), audience (aud = projectId) e issuer (iss).
 */
export async function verifyRealAuthToken(
  authHeader: string | undefined,
  options: VerifyTokenOptions = {}
): Promise<AuthContext> {
  if (!authHeader) {
    return { uid: '', isValid: false, error: 'Cabeçalho Authorization ausente' };
  }

  const parts = authHeader.trim().split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return { uid: '', isValid: false, error: 'Formato do cabeçalho inválido. Esperado Bearer <token>' };
  }

  const token = parts[1];

  // 1. Tratamento Restrito de Tokens Sintéticos: Apenas com flag explícita de teste no código interno
  if (token.startsWith('demo-token:')) {
    if (options.allowSyntheticInTest !== true) {
      return {
        uid: '',
        isValid: false,
        error: 'Credenciais sintéticas (demo-token) são terminantemente proibidas na entrada pública do produto.'
      };
    }
    const uid = token.replace('demo-token:', '').trim();
    if (!uid) return { uid: '', isValid: false, error: 'Token sintético com UID vazio.' };
    return { uid, isValid: true };
  }

  // 2. Verificação via Firebase Admin SDK Oficial (Com ou Sem Emulador)
  // Qualquer falha de assinatura, projeto incorreto ou chave inexistente resulta em rejeição estrita
  try {
    const auth = getAdminAuth();
    
    // Chama verifyIdToken() oficial em qualquer ambiente (com ou sem FIREBASE_AUTH_EMULATOR_HOST)
    const decoded = await auth.verifyIdToken(token, true);
    const expectedProj = options.expectedProjectId || DEMO_PROJECT_ID;
    
    if (decoded.aud !== expectedProj) {
      return {
        uid: '',
        isValid: false,
        error: `Audience do token inválido: esperado '${expectedProj}', recebido '${decoded.aud}' (projeto incorreto).`
      };
    }

    return {
      uid: decoded.uid,
      email: decoded.email,
      isValid: true
    };
  } catch (adminErr: any) {
    // Qualquer falha no verificador oficial termina obrigatoriamente em rejeição
    const msg = adminErr?.message || 'Token inválido perante o verificador oficial Firebase Admin.';
    return {
      uid: '',
      isValid: false,
      error: `Rejeição de autenticação Firebase Admin: ${msg}`
    };
  }
}

/**
 * Verificação criptográfica completa de JWT reservada EXCLUSIVAMENTE à prova criptográfica
 * isolada de testes de contrato com par de chaves RSA gerado localmente.
 * 
 * Regra Estrita: A chave pública PEM é OBRIGATÓRIA. Ausência de chave falha explicitamente.
 */
export function verifyJwtCryptographically(
  token: string,
  expectedProjectId: string,
  publicKeyPem: string
): AuthContext {
  if (!publicKeyPem || typeof publicKeyPem !== 'string' || publicKeyPem.trim() === '') {
    return {
      uid: '',
      isValid: false,
      error: 'Chave pública não fornecida para verificação criptográfica estrita. Ausência de chave falha explicitamente.'
    };
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { uid: '', isValid: false, error: 'JWT malformado: não possui 3 segmentos.' };
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    // Validação de Algoritmo
    if (header.alg !== 'RS256') {
      return { uid: '', isValid: false, error: `Algoritmo não suportado: '${header.alg}'. Apenas RS256 é aceito.` };
    }

    // Validação de Expiração (exp)
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSec) {
      return { uid: '', isValid: false, error: `Token expirado em ${new Date(payload.exp * 1000).toISOString()}.` };
    }

    // Validação de Audience (aud = projectId)
    if (payload.aud !== expectedProjectId) {
      return {
        uid: '',
        isValid: false,
        error: `Projeto incorreto: token emitido para '${payload.aud}', mas o sistema exige '${expectedProjectId}'.`
      };
    }

    // Validação de Issuer (iss)
    const expectedIss = `https://securetoken.google.com/${expectedProjectId}`;
    if (payload.iss !== expectedIss && payload.iss !== `demo-kyro-auth:${expectedProjectId}`) {
      return {
        uid: '',
        isValid: false,
        error: `Issuer não confiável: '${payload.iss}'.`
      };
    }

    // Validação Criptográfica Estrita da Assinatura com a Chave Pública Fornecida
    const dataToVerify = `${headerB64}.${payloadB64}`;
    const signature = Buffer.from(signatureB64, 'base64url');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(dataToVerify);
    const isSigValid = verifier.verify(publicKeyPem, signature);

    if (!isSigValid) {
      return { uid: '', isValid: false, error: 'Assinatura digital RS256 inválida ou token adulterado.' };
    }

    const uid = payload.user_id || payload.sub || payload.uid;
    if (!uid) {
      return { uid: '', isValid: false, error: 'Claim de UID (sub/user_id) ausente no payload.' };
    }

    return {
      uid,
      email: payload.email,
      isValid: true
    };
  } catch (err: any) {
    return { uid: '', isValid: false, error: `Falha na verificação criptográfica: ${err.message}` };
  }
}

/**
 * Utilitário de Teste: Gera um par de chaves RSA 2048-bit e assina um ID Token canônico.
 */
export function generateTestKeyPair(): { publicKey: string; privateKey: string } {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

/**
 * Utilitário de Teste: Cria um ID Token assinado em RS256 para comprovação matemática de assinatura.
 */
export function createSignedTestToken(params: {
  uid: string;
  projectId?: string;
  expiresInSeconds?: number;
  privateKeyPem: string;
  email?: string;
  adulteratePayload?: boolean;
  adulterateSignature?: boolean;
}): string {
  const proj = params.projectId || DEMO_PROJECT_ID;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (params.expiresInSeconds !== undefined ? params.expiresInSeconds : 3600);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: `https://securetoken.google.com/${proj}`,
    aud: proj,
    sub: params.uid,
    user_id: params.uid,
    auth_time: now,
    iat: now,
    exp,
    email: params.email || `${params.uid}@kyro.test`
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadJson = JSON.stringify(payload);
  const legitimatePayloadB64 = Buffer.from(payloadJson).toString('base64url');
  const dataToSign = `${headerB64}.${legitimatePayloadB64}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(dataToSign);
  let signatureB64 = signer.sign(params.privateKeyPem, 'base64url');

  if (params.adulterateSignature) {
    signatureB64 = signatureB64.slice(0, -4) + 'AAAA';
  }

  let finalPayloadB64 = legitimatePayloadB64;
  if (params.adulteratePayload) {
    // Altera o conteúdo após a assinatura sem ter a chave privada
    const adulteratedJson = JSON.stringify({ ...payload, sub: 'usr_hacker_adulterated' });
    finalPayloadB64 = Buffer.from(adulteratedJson).toString('base64url');
  }

  return `${headerB64}.${finalPayloadB64}.${signatureB64}`;
}

/**
 * Emite um ID Token oficial a partir do Firebase Auth Emulator para testes de rota.
 * Cria o usuário ou faz login via API REST do Auth Emulator oficial.
 */
export async function getOfficialAuthEmulatorToken(
  email: string = 'alice_emulated@kyro.local',
  password: string = 'SenhaSegura123!'
): Promise<{ idToken: string; uid: string }> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
  
  let resp = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });

  if (!resp.ok) {
    resp = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Falha ao emitir token no Auth Emulator: ${resp.status} ${errText}`);
  }

  const data: any = await resp.json();
  return { idToken: data.idToken, uid: data.localId };
}
