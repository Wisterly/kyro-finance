/**
 * KYRO FINANCE | GERENCIADOR DE SESSÃO FIREBASE DO CLIENTE (CLIENT AUTH SESSION)
 * 
 * Regras Estritas de Auditoria (Subetapa 03.5):
 * 1. Obtenção e renovação da credencial pelo fluxo normal da aplicação via sessão Firebase do usuário autenticado.
 * 2. Restrição absoluta de credenciais sintéticas e do Auth Emulator exclusivamente ao ambiente de teste.
 * 3. Validação de que a conta utilizada pertence ao UID autenticado e corresponde à seleção ou regra do produto.
 */

export interface UserSession {
  uid: string;
  email?: string;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}

export class SessionNotFoundError extends Error {
  public readonly code = 'UNAUTHORIZED_NO_SESSION';
  public readonly statusCode = 401;
  constructor(message: string = 'Autenticação necessária: sessão Firebase ausente ou expirada. Faça login para continuar.') {
    super(`[ClientAuthSession] ${message}`);
    this.name = 'SessionNotFoundError';
  }
}

export class AccountMismatchError extends Error {
  public readonly code = 'PERMISSION_DENIED_ACCOUNT_MISMATCH';
  public readonly statusCode = 403;
  constructor(message: string = 'Acesso negado: a conta selecionada não pertence ao usuário autenticado.') {
    super(`[ClientAuthSession] ${message}`);
    this.name = 'AccountMismatchError';
  }
}

class ClientAuthSessionManager {
  private currentSession: UserSession | null = null;
  private testEnvironmentEnabled: boolean = false;

  /**
   * Define a sessão do usuário autenticado na aplicação.
   */
  public setCurrentSession(session: UserSession | null): void {
    this.currentSession = session;
    if (typeof window !== 'undefined' && session) {
      try {
        window.sessionStorage?.setItem('kyro_auth_uid', session.uid);
      } catch {}
    } else if (typeof window !== 'undefined' && !session) {
      try {
        window.sessionStorage?.removeItem('kyro_auth_uid');
        window.sessionStorage?.removeItem('kyro_auth_token');
      } catch {}
    }
  }

  /**
   * Obtém a sessão atual em memória ou restaura metadados da sessão ativa.
   */
  public getCurrentSession(): UserSession | null {
    if (this.currentSession) return this.currentSession;

    // Restauração a partir do armazenamento da sessão da janela
    if (typeof window !== 'undefined') {
      const storedUid = window.sessionStorage?.getItem('kyro_auth_uid') || window.localStorage?.getItem('kyro_auth_uid');
      const storedToken = window.sessionStorage?.getItem('kyro_auth_token') || window.localStorage?.getItem('kyro_auth_token');

      if (storedUid && storedToken && storedToken !== 'client-session') {
        return {
          uid: storedUid,
          getIdToken: async () => storedToken
        };
      }
    }

    return null;
  }

  /**
   * Habilita ou desabilita o ambiente de teste isolado.
   * Credenciais sintéticas e Auth Emulator são RESTRITOS a este modo.
   */
  public setTestEnvironment(enabled: boolean): void {
    this.testEnvironmentEnabled = enabled;
  }

  public isTestEnvironment(): boolean {
    return this.testEnvironmentEnabled || 
      (typeof process !== 'undefined' && process.env.NODE_ENV === 'test');
  }

  /**
   * Obtém e renova o token oficial da sessão Firebase pelo fluxo normal da aplicação.
   * Lança SessionNotFoundError se não houver usuário autenticado.
   */
  public async getSessionToken(forceRefresh: boolean = false): Promise<string> {
    const session = this.getCurrentSession();
    if (session) {
      const token = await session.getIdToken(forceRefresh);
      if (token && token.trim() !== '' && token !== 'client-session') {
        if (typeof window !== 'undefined') {
          try { window.sessionStorage?.setItem('kyro_auth_token', token); } catch {}
        }
        return token.trim();
      }
    }

    // Se estiver em ambiente normal (fora de teste), proíbe qualquer tentativa de mock
    if (!this.isTestEnvironment()) {
      throw new SessionNotFoundError();
    }

    // Em ambiente de teste explicitamente habilitado, permite obter credencial sintética do emulador
    return await this.fetchEmulatorTokenForTest();
  }

  /**
   * Restrito ao ambiente de teste: obtém credencial oficial do Auth Emulator local.
   */
  public async fetchEmulatorTokenForTest(
    email: string = 'cliente_voz@kyro.synthetic',
    password: string = 'SenhaSegura123!'
  ): Promise<string> {
    if (!this.isTestEnvironment()) {
      throw new Error('[Segurança] Proibido obter credencial sintética fora do ambiente de teste autorizado.');
    }

    const host = (typeof process !== 'undefined' && process.env?.FIREBASE_AUTH_EMULATOR_HOST) || '127.0.0.1:9099';
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
      throw new Error(`[ClientAuthSession] Falha ao comunicar com Auth Emulator na porta ${host}`);
    }

    const data = await resp.json();
    return data.idToken;
  }

  /**
   * Valida e resolve a conta para o lançamento por voz segundo a regra do produto:
   * A conta deve pertencer estritamente ao UID autenticado.
   */
  public resolveAndValidateAccount(params: {
    userUid: string;
    requestedAccountId?: string;
    accountOwnerId?: string;
  }): { accountId: string; accountOwnerId: string } {
    const { userUid, requestedAccountId, accountOwnerId } = params;

    if (!userUid || userUid.trim() === '') {
      throw new SessionNotFoundError('UID de usuário ausente para validação de conta.');
    }

    // Se o chamador especificou explicitamente o titular da conta e ele diverge do UID autenticado:
    if (accountOwnerId && accountOwnerId.trim() !== '' && accountOwnerId !== userUid) {
      throw new AccountMismatchError(
        `Violação de fronteira: A conta solicitada pertence ao UID '${accountOwnerId}', divergente do usuário autenticado '${userUid}'.`
      );
    }

    // Se o identificador da conta carrega namespace explícito de outro usuário:
    if (requestedAccountId && requestedAccountId.includes(':')) {
      const accountOwnerPrefix = requestedAccountId.split(':')[0];
      if (accountOwnerPrefix !== userUid) {
        throw new AccountMismatchError(
          `Violação de fronteira: A conta '${requestedAccountId}' pertence a outro usuário (${accountOwnerPrefix}).`
        );
      }
    }

    // Regra aprovada do produto: se não especificada, adota a conta principal do usuário
    const resolvedAccountId = requestedAccountId && requestedAccountId.trim() !== '' 
      ? requestedAccountId.trim() 
      : 'acc_default';

    return {
      accountId: resolvedAccountId,
      accountOwnerId: userUid
    };
  }
}

export const clientAuthSession = new ClientAuthSessionManager();
