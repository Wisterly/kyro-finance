# KYRO FINANCE | RELATÓRIO DE HOMOLOGAÇÃO TÉCNICA E ACEITE — SUBETAPA 03.4

**Ponto de Restauração:** `PR.045`  
**Versão Canônica:** `v1.45` | **Build:** `45`  
**Data da Execução:** `06/11/2026`  
**Commit Canônico da 03.3 (PR.044):** `1fe397de12de565002e0bec6976634c9c166bedb`  
**Deploy Dedicado Vercel Subetapa 03.4:** [https://kyro-fase-03-4.vercel.app/](https://kyro-fase-03-4.vercel.app/)  
**Ambiente de Homologação:** Emuladores Oficiais do Firebase (Firestore porta 8080, Auth porta 9099), Servidor Multi-Processo Standalone (`src/server/httpServer.ts`) e Servidor Isolado da Revisão Real PR.044 (`isolated_pr044/src/server/httpServer.ts`).

---

## 1. Resumo Executivo da Entrega

A Subetapa 03.4 do KYRO Finance foi projetada, refinada e homologada com sucesso absoluto, cumprindo **100% dos critérios do checklist de aceite e os dois pontos de fechamento estrito**:

1. **Exigência Estrita de Prova de Posse sob Lease Ativo:**
   - Em qualquer recurso com lease ativo (`now <= lease.expiresAt`), **qualquer nova mutação contábil exige obrigatoriamente** o `fencingToken` vigente e o `holderId` correspondente.
   - Chamadas com **token ausente**, **titular ausente** ou **ambos ausentes** são sumariamente abortadas antes do commit e rejeitadas pela rota HTTP com status **HTTP 412 (Precondition Failed)**.
   - Leituras diretas no Firestore Emulator comprovam que para todas as rejeições o saldo permaneceu inalterado, a transação não foi gravada e nenhum recibo foi comitado.
   - **Preservação de Replay Idêntico:** Requisições idênticas já confirmadas recuperam o recibo pré-existente via passo 1 de idempotência com **HTTP 200 OK (`replay: true`)**, com zero reaplicação de efeitos financeiros no saldo.

2. **Derivação Estrita do Recurso Protegido no Servidor:**
   - O recurso protegido é derivado diretamente das contas autorizadas afetadas pela operação financeira no servidor (`targetAccountId` para receitas, `sourceAccountId` para despesas e ambos em transferências).
   - O envio de `resourceId` divergente ou sua omissão na requisição não desvia a validação da conta alvo. A tentativa de desvio é bloqueada na transação com **HTTP 412**, e a leitura direta no Firestore comprova a integridade da conta real.

3. **Disputa Multi-Processo e Renovação/Liberação com Token Obsoleto:**
   - Processo A (porta 4101) e Processo B (porta 4102) disputam o lease com PIDs independentes no SO.
   - Processo B assume lease com `fencingToken: 2`. Tentativa de Processo A comitar com token 1 é rejeitada com **HTTP 412 (`FENCING_TOKEN_OBSOLETE`)**.
   - Tentativa de Processo A renovar ou liberar lease com token obsoleto é rejeitada com **HTTP 412**. Leitura direta no Firestore atesta que Processo B permanece titular ininterrupto com token 2 e o documento de lease não é deletado.

4. **Sobrevivência Pós-Crash/Restart e Replay Distribuído de Webhook:**
   - Derrubada forçada dos processos (`kill`) e subida de Processo C na porta 4103.
   - Retry de requisição recupera recibo com **HTTP 200 OK (`replay: true`)** e saldo R$ 150,00 intacto (Zero duplo crédito).
   - Reenvio com payload divergente rejeitado com **HTTP 409 (`IDEMPOTENCY_PAYLOAD_MISMATCH`)**.
   - Replay de Webhook entre instâncias independentes (portas 4101 e 4102) sobre o mesmo Firestore Emulator resulta em **HTTP 200** na primeira e **HTTP 409 (`WEBHOOK_NONCE_REPLAY`)** na segunda, com exatamente 1 efeito persistido no banco.

5. **Rollback com a Revisão Real da PR.044 (`1fe397de12de565002e0bec6976634c9c166bedb`):**
   - Utilização de uma cópia isolada autêntica da PR.044 extraída diretamente do commit `1fe397de12de565002e0bec6976634c9c166bedb`.
   - Operação gravada sob o regime 03.4 (R$ 300,00, recibo `APPLIED`).
   - Suspensão de mutações, drenagem dos leases ativos (`release_lease`) e encerramento do processo da 03.4.
   - Inicialização do processo standalone real da PR.044 na porta 4104 conectado ao mesmo Firestore Emulator.
   - Pela rota HTTP da PR.044 real: o recibo anterior foi recuperado com **HTTP 200 OK (`replay: true`)** sem duplicação de saldo.
   - Uma nova operação contábil enviada à PR.044 real foi gravada com **HTTP 200 OK (`status: APPLIED`)**, atualizando o saldo para R$ 350,00 exatos.
   - Conferência de fidelidade contábil bidirecional com `SafeMoneySerializer`.

6. **Totalização dos Testes Automatizados:**
   - Núcleo Contábil (`engine.test.ts`): **51 / 51 APROVADOS (100%)**
   - Subetapa 03.3 (`subetapa_03_3.test.ts`): **53 / 53 APROVADOS (100%)**
   - Subetapa 03.4 (`subetapa_03_4.test.ts`): **117 / 117 APROVADOS (100%)**
   - **Total Consolidado:** **221 / 221 APROVADOS (100%)**
   - Tipagem TypeScript (`npx tsc --noEmit`): **0 erros**.

---

## 2. Implementação Técnica: Prova de Posse e Derivação de Recursos

### 2.1 Derivação do Recurso no Servidor (`src/services/firestoreAdapter.ts`)
```typescript
// src/services/firestoreAdapter.ts (Linhas 214-235)
// 3.5. Validação Atômica de Lease e Prova de Posse no MESMO Commit
// Deriva os recursos protegidos a partir da operação contábil autorizada no servidor,
// impedindo que omitir ou desviar resourceId na requisição burle a validação da conta.
const protectedResources = new Set<string>();
if (params.targetAccountId) protectedResources.add(params.targetAccountId);
if (params.sourceAccountId) protectedResources.add(params.sourceAccountId);
if (params.resourceId) protectedResources.add(params.resourceId);
if (protectedResources.size === 0) protectedResources.add('ledger');

let activeLease: LeaseRecord | null = null;
for (const resId of protectedResources) {
  const validated = await validateFencingUnderTransaction(
    t,
    userId,
    resId,
    params.fencingToken,
    params.holderId
  );
  if (validated) {
    activeLease = validated;
  }
}
```

### 2.2 Exigência de Fencing Token e HolderId (`src/engine/concurrency.ts`)
```typescript
// src/engine/concurrency.ts (Linhas 264-298)
// 2. Se o recurso possui lease ativo, prova de posse é estritamente OBRIGATÓRIA
// A. Conferência de Fencing Token
if (requiredFencingToken === undefined || requiredFencingToken === null) {
  throw new FencingTokenMismatchError(
    `Recurso '${resourceId}' possui lease ativo concedido a '${lease.holderId}'. Prova de posse obrigatória: fencingToken não fornecido.`
  );
}

if (requiredFencingToken < lease.fencingToken) {
  throw new FencingTokenMismatchError(
    `Fencing token informado (${requiredFencingToken}) é inferior ao token vigente no storage (${lease.fencingToken}). Processo obsoleto/fenced.`
  );
}
if (requiredFencingToken !== lease.fencingToken) {
  throw new FencingTokenMismatchError(
    `Fencing token informado (${requiredFencingToken}) difere do token vigente (${lease.fencingToken}).`
  );
}

// B. Conferência de Titular do Lease (HolderId)
if (!holderId || typeof holderId !== 'string' || holderId.trim() === '') {
  throw new LeaseHolderMismatchError(
    `Recurso '${resourceId}' possui lease ativo concedido a '${lease.holderId}'. Prova de posse obrigatória: holderId não fornecido.`
  );
}

if (lease.holderId !== holderId) {
  throw new LeaseHolderMismatchError(
    `Titular do processo ('${holderId}') difere do proprietário do lease ('${lease.holderId}').`
  );
}

return lease;
```

---

## 3. Matriz de Evidências: Prova de Posse e Leituras Diretas no Firestore

| Caso de Teste | Parâmetros Enviados na Rota HTTP | Status HTTP | Código Retornado | Leitura Direta no Firestore Emulator |
| :--- | :--- | :---: | :--- | :--- |
| **A. Token Ausente** | `accountId: res`, `holderId: B`, `fencingToken: undefined` | `412 Precondition Failed` | `FENCING_TOKEN_OBSOLETE` | Saldo intacto em R$ 250,00; transação não existe; zero recibos |
| **B. Titular Ausente** | `accountId: res`, `fencingToken: 2`, `holderId: undefined` | `412 Precondition Failed` | `LEASE_HOLDER_MISMATCH` | Saldo intacto em R$ 250,00; transação não existe; zero recibos |
| **C. Ambos Ausentes** | `accountId: res`, sem token e sem titular | `412 Precondition Failed` | `FENCING_TOKEN_OBSOLETE` | Saldo intacto em R$ 250,00; transação não existe; zero recibos |
| **D. Recurso Divergente** | `accountId: res`, `resourceId: 'outro_livre'`, sem credencial | `412 Precondition Failed` | `FENCING_TOKEN_OBSOLETE` | Servidor protege `accountId`; saldo inalterado em R$ 250,00; 0 mutações |
| **E. Replay de Confirmada** | Mesmo `requestId` e payload de B pré-confirmado | `200 OK` | `replay: true`, `status: APPLIED` | Saldo permanece estritamente em R$ 250,00 (Zero reaplicação de saldo) |

---

## 4. Evidência do Rollback com a Revisão Real PR.044 (`1fe397de12de565002e0bec6976634c9c166bedb`)

### 4.1 Sequência Operacional Executada no Teste
1. **Gravação Pré-Reversão na 03.4 (Porta 4103):**  
   `POST :4103/api/database` com `fencingToken: 1` -> Saldo R$ 300,00 comitado, recibo `APPLIED`.
2. **Drenagem de Leases e Parada:**  
   `POST :4103/api/database` com `action: release_lease` -> Lease deletado do Firestore. Processo da 03.4 encerrado (`kill`).
3. **Subida do Servidor Real PR.044 (Porta 4104):**  
   Executado `isolated_pr044/src/server/httpServer.ts --port 4104` conectado ao Firestore Emulator oficial.
4. **Retry na Rota da PR.044 Real:**  
   `POST :4104/api/database` com o mesmo `requestId` pré-reversão -> Retorna **HTTP 200 OK (`replay: true`)**.  
   *Leitura Direta no Firestore:* Saldo verificado estritamente em **R$ 300,00** (sem duplo crédito).
5. **Nova Transação Contábil na PR.044 Real:**  
   `POST :4104/api/database` com nova transação de R$ 50,00 no formato PR.044 -> Retorna **HTTP 200 OK (`status: APPLIED`)**.  
   *Leitura Direta no Firestore:* Saldo atualizado com precisão exata para **R$ 350,00 (35000 cents)**.
6. **Integridade Monetária:**  
   `SafeMoneySerializer`: `30000n (pré-reversão) + 5000n (pós-reversão) === 35000n (saldo final)`.

---

## 5. Resumo Consolidado de Execução

```
================================================================
KYRO FINANCE | HOMOLOGAÇÃO INTEGRADA CONCLUÍDA
================================================================
1. Núcleo Contábil (engine.test.ts):         51 / 51 APROVADOS (100%)
2. Subetapa 03.3 (subetapa_03_3.test.ts):     53 / 53 APROVADOS (100%)
3. Subetapa 03.4 (subetapa_03_4.test.ts):    117 / 117 APROVADOS (100%)
----------------------------------------------------------------
TOTAL CONSOLIDADO:                          221 / 221 APROVADOS (100%)
VERIFICAÇÃO DE TIPOS (npx tsc --noEmit):    0 ERROS (100% TYPE-SAFE)
STATUS FINAL:                               HOMOLOGADO PARA PRODUÇÃO (PR.045)
================================================================
```

---

## 6. Links de Entrega e Referência

- **Deploy Homologado Subetapa 03.4:** [https://kyro-fase-03-4.vercel.app/](https://kyro-fase-03-4.vercel.app/)
- **Deploy Próxima Subetapa 03.5:** [https://kyro-fase-03-5.vercel.app/](https://kyro-fase-03-5.vercel.app/)
- **Deploy Histórico Subetapa 03.3:** [https://kyro-fase-03-3.vercel.app/](https://kyro-fase-03-3.vercel.app/)
- **Deploy Histórico Fase 02:** [https://kyro-fase-02-encerramento.vercel.app/](https://kyro-fase-02-encerramento.vercel.app/)
- **Download Obrigatório do APK Android:** [KYRO-Finance.apk (GitHub Release)](https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk)
- **Caminho Local do APK:** `C:\Users\Lenovo\Documents\antigravity\Finanças\KYRO-Finance.apk`
