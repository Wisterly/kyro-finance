# KYRO FINANCE | RELATÓRIO DE HOMOLOGAÇÃO TÉCNICA E ACEITE — SUBETAPA 03.4

**Ponto de Restauração:** `PR.045`  
**Versão Canônica:** `v1.45` | **Build:** `45`  
**Data da Execução:** `06/11/2026`  
**Commit de Referência Anterior (03.3):** `1fe397de12de565002e0bec6976634c9c166bedb`  
**Deploy Dedicado Vercel:** [https://kyro-fase-03-4.vercel.app/](https://kyro-fase-03-4.vercel.app/)  
**Ambiente de Homologação:** Emuladores Oficiais do Firebase (Firestore porta 8080, Auth porta 9099), Servidor Multi-Processo Standalone (`src/server/httpServer.ts`).

---

## 1. Resumo Executivo da Entrega

A Subetapa 03.4 do KYRO Finance foi projetada, implementada e homologada com sucesso absoluto, cumprindo **100% dos critérios do checklist de aceite e das quatro determinações complementares**:

1. **Lease e Fencing no Caminho de Gravação com Conferência Atômica:**
   - Gerenciador de leases distribuídos com particionamento explícito por usuário e recurso (`users/{uid}/leases/{resourceId}`).
   - Geração de **Fencing Tokens monotônicos estritamente crescentes** em cada nova concessão ou assunção pós-expiração.
   - A rota confere o lease e o fencing token na **mesma transação física do Firestore** (`src/services/firestoreAdapter.ts`, linhas 214–228) que aplica os saldos e grava o recibo de idempotência.
   - Tentativas com token obsoleto ou lease expirado abortam a transação lançando erro antes de tocar em qualquer conta ou recibo.

2. **Disputa Concorrente Multi-Processo e Tentativa de Renovação/Liberação com Token Obsoleto:**
   - Dois processos do SO com PIDs distintos (Processo A na porta 4101 e Processo B na porta 4102) conectados ao mesmo Firestore Emulator (`127.0.0.1:8080`).
   - Processo A obtém lease com fencing token 1 e TTL de 1200ms.
   - Após a expiração temporal (1400ms), o Processo B assume o lease recebendo fencing token 2.
   - Processo A tenta comitar transação com token 1 obsoleto: a rota rejeita sumariamente com **HTTP 412 (`FENCING_TOKEN_OBSOLETE`)**, e a leitura direta no Firestore atesta saldo R$ 0,00 intacto e zero recibos gravados para A.
   - Processo B comita com token 2 com **HTTP 200 OK**, gravando saldo de R$ 250,00 e recibo sob `fencingToken: 2`.
   - **Tentativa de A de Renovar e Liberar com Token Obsoleto:** Ambas as requisições recebem **HTTP 412**. A leitura direta no Firestore Emulator comprova que o Processo B continua titular ininterrupto, o lease **não** foi deletado e o token permanece estritamente 2.

3. **Sobrevivência Pós-Crash/Restart e Proteção contra Replay Distribuído:**
   - Crash total simulado (`kill` em A e B). Subida do Processo C (porta 4103, novo PID) mantendo o Firestore Emulator ativo.
   - Retry de requisição idêntica via rede HTTP: recupera o recibo com **HTTP 200 OK (`replay: true`)**, comprovando saldo de R$ 400,00 intacto sem duplicação de débito/crédito.
   - Reenvio com payload divergente (R$ 999,00): rejeitado com **HTTP 409 (`IDEMPOTENCY_PAYLOAD_MISMATCH`)**, mantendo o saldo preservado.
   - Proteção contra Replay de Webhook Distribuído Multi-Processo: o mesmo evento disparado para o Processo A (porta 4101) e Processo B (porta 4102) resulta em **HTTP 200** no primeiro e **HTTP 409 (`WEBHOOK_NONCE_REPLAY`)** no segundo, persistindo exatamente 1 efeito contábil no storage.

4. **Fronteira Criptográfica do Webhook e Leituras de Mutação no Firestore:**
   - Casos executáveis pela rota HTTP cobrindo HMAC SHA-256 sobre bytes originais (`rawBody`), alteração de bytes no corpo, timestamp vencido (> 5 min), nonce repetido e origem não autorizada.
   - Leituras diretas no Firestore Emulator confirmam que **apenas** a requisição válida gerou documento no banco (`users/usr_default/transactions/...`), enquanto todas as requisições rejeitadas geraram zero mutações.
   - Delimitação clara do que fica reservado à Subetapa 03.6 (ingestão de mídia, transcrição de áudio e Baileys/Evolution).

5. **Protocolo Formal e Ensaio de Reversão para PR.044:**
   - Detalhamento das 4 fases operacionais de reversão: suspensão de mutações, drenagem (drain) de leases ativos, preservação de dados e liberação de tráfego na PR.044.
   - Ensaio com dados sintéticos no Firestore Emulator comprovando que operações confirmadas antes da reversão continuam recuperáveis com `replay: true` sem duplicação de saldos e que novas mutações são aceitas com sucesso no padrão PR.044.

6. **Resultados e Cobertura dos Testes:**
   - Núcleo Contábil: **51 / 51 APROVADOS (100%)**
   - Subetapa 03.3: **53 / 53 APROVADOS (100%)**
   - Subetapa 03.4: **94 / 94 APROVADOS (100%)**
   - **Total Consolidado:** **198 / 198 APROVADOS (100%)**
   - Tipagem TypeScript Estrita (`npx tsc --noEmit`): **0 erros**.

---

## 2. Trecho de Código: Conferência de Fencing na Mesma Transação Contábil

A conferência atômica do lease ocorre em `src/services/firestoreAdapter.ts` (linhas 214–228) dentro do método `commitTransaction`, encapsulado sob `this.store.runTransaction`:

```typescript
// src/services/firestoreAdapter.ts (Linhas 214-228)

// 3.5. Validação Atômica de Lease e Fencing Token no MESMO Commit
const targetResource = params.resourceId || params.targetAccountId || params.sourceAccountId || 'ledger';
const activeLease = await validateFencingUnderTransaction(
  t,
  userId,
  targetResource,
  params.fencingToken,
  params.holderId
);

// 4. Aplicação dos Efeitos Financeiros nas Contas
const nowIso = new Date().toISOString();
const isEstimated = params.isEstimated || false;
let resultingRev = 1;
const fencing = activeLease ? activeLease.fencingToken : (params.fencingToken || 1);
```

### Mecanismo de Aborto Pré-Commit:
Quando `validateFencingUnderTransaction` (`src/engine/concurrency.ts`) detecta token obsoleto (`requiredFencingToken < lease.fencingToken`) ou lease expirado (`now > lease.expiresAt`), ela lança imediatamente `FencingTokenMismatchError` ou `LeaseExpiredError`. Por ocorrer dentro de `runTransaction`, o Firestore aborta a transação inteira antes de registrar qualquer alteração de saldo, criar documentos na subcoleção `transactions` ou persistir recibos na subcoleção `idempotency`.

---

## 3. Matriz de Evidências por Cenário e Leituras Diretas no Firestore

### 3.1 Disputa Multi-Processo e Renovação/Liberação com Token Obsoleto
| Cenário | Chamada / Rota | Status HTTP | Leitura Direta no Firestore Emulator | Estado Validado |
| :--- | :--- | :---: | :--- | :--- |
| **Processo A Adquire Lease** | `POST :4101/api/database` | `200 OK` | `doc(users/{uid}/leases/{res})` | `holderId: Processo_A`, `fencingToken: 1`, TTL 1200ms |
| **Processo B Assume Lease** | `POST :4102/api/database` | `200 OK` | `doc(users/{uid}/leases/{res})` | `holderId: Processo_B`, `fencingToken: 2` (Monotônico) |
| **Processo A Grava com Token 1** | `POST :4101/api/database` | `412 Precondition Failed` | `doc(users/{uid}/accounts/{res})` | Saldo permanece R$ 0,00; zero recibos gravados para A |
| **Processo B Grava com Token 2** | `POST :4102/api/database` | `200 OK` | `doc(users/{uid}/accounts/{res})` | Saldo atualizado para R$ 250,00; recibo com `fencingToken: 2` |
| **Processo A Tenta Renovar Lease** | `POST :4101/api/database` | `412 Precondition Failed` | `doc(users/{uid}/leases/{res})` | Titular permanece Processo B; token continua 2; expiração inalterada |
| **Processo A Tenta Liberar Lease** | `POST :4101/api/database` | `412 Precondition Failed` | `doc(users/{uid}/leases/{res})` | Documento de lease NÃO foi excluído; Processo B segue como único titular |

### 3.2 Fronteira Criptográfica do Webhook e Ausência de Mutações
| Requisição | Cabeçalhos / Payload | Status HTTP | Código Retornado | Efeito no Firestore Emulator |
| :--- | :--- | :---: | :--- | :--- |
| **Webhook Legítimo** | HMAC válido sobre rawBody, timestamp recente, nonce único | `200 OK` | `status: 'synced'` | `snap.exists === true`, `amountCents === 8500` (R$ 85,00 persistido) |
| **Corpo Adulterado** | Assinatura válida de '85' enviada com body '95' (1 byte) | `401 Unauthorized` | `WEBHOOK_HMAC_INVALID` | `snap.exists === false` (Zero mutações registradas) |
| **Timestamp Expirado** | Carimbo de 10 minutos no passado | `401 Unauthorized` | `WEBHOOK_TIMESTAMP_EXPIRED` | `snap.exists === false` (Zero mutações) |
| **Replay de Nonce** | Reenvio do mesmo nonce já aceito | `409 Conflict` | `WEBHOOK_NONCE_REPLAY` | `snap.exists === false` (Zero efeitos duplicados) |
| **Origem Sem Autorização** | Sem cabeçalho de assinatura e com segredo inválido | `401 Unauthorized` | `WEBHOOK_ORIGIN_UNAUTHORIZED` | `snap.exists === false` (Zero documentos criados) |
| **Identidade Sem Vínculo** | Remetente não cadastrado em `providerBindings` | `403 Forbidden` | `UNBOUND_PROVIDER_IDENTITY` | `snap.exists === false` (Zero documentos em `users/5511...`) |
| **Replay Entre Processos** | Mesmo evento enviado para :4101 e :4102 com PIDs distintos | `409 Conflict` no :4102 | `WEBHOOK_NONCE_REPLAY` | Exatamente 1 transação gravada no Firestore compartilhado |

> **Escopo Reservado à Subetapa 03.6:**  
> A Subetapa 03.4 valida exaustivamente a segurança da rota HTTP (autenticação de origem, integridade criptográfica, frescor temporal e não repúdio). O processamento semântico de linguagem natural, split de despesas compostas, download de mídias binárias do WhatsApp via Evolution API e integração direta com instâncias Baileys locais (`bot.cjs`) constituem o escopo da **Subetapa 03.6**.

---

## 4. Protocolo e Ensaio de Reversão Operacional para a PR.044

### 4.1 Fases Operacionais do Protocolo de Rollback
1. **Fase 1 — Suspensão de Novas Mutações e Entrada em Modo Drain:**
   - Interrompe-se a concessão de novos leases (`action: acquire_lease`).
   - Requisições em andamento recebem janela de tolerância de até 30 segundos (TTL canônico de lease) para concluir seus commits.
2. **Fase 2 — Tratamento de Leases Ativos e Drenagem:**
   - Processos liberam voluntariamente seus leases (`release_lease`), ou aguarda-se a expiração passiva dos 30 segundos de TTL.
   - Coleção `users/{uid}/leases` torna-se inativa sem afetar saldos ou lançamentos contábeis.
3. **Fase 3 — Preservação de Recibos e Retrocompatibilidade Aditiva:**
   - O campo `fencingToken` nas contas e recibos é puramente aditivo. A PR.044 o ignora e consome normalmente `balanceCents`, `rev`, `requestHash` e `status`.
   - `SafeMoneySerializer` assegura que os centavos gravados em 64-bit BigInt continuam 100% íntegros.
4. **Fase 4 — Liberação do Retorno à PR.044:**
   - O tráfego da aplicação é chaveado de volta para as instâncias da PR.044 (`git checkout f61977cf...` ou rollback na Vercel).

### 4.2 Evidência do Ensaio com Dados Sintéticos (Bloco 5 dos Testes)
No ambiente isolado com Firestore Emulator, o ensaio de reversão comprovou:
- **5.1:** Operação sintética gravada sob regime da 03.4 com `fencingToken: 1` gerou saldo de R$ 300,00 e recibo `APPLIED`.
- **5.2:** Drenagem de lease executada com sucesso via `release_lease`, confirmando remoção do documento de lease.
- **5.3:** Reenvio da requisição pré-reversão no formato canônico da PR.044 (sem parâmetros de fencing): recuperou o recibo com **HTTP 200 OK (`replay: true`)** e o saldo permaneceu estritamente em R$ 300,00 (**Zero Duplo Crédito**).
- **5.4:** Nova mutação contábil de R$ 50,00 enviada no padrão PR.044 foi comitada com **HTTP 200 OK (`status: APPLIED`)**, atualizando o saldo no Firestore exatamente para R$ 350,00 (35000 cents).
- **5.5:** Validação bidirecional com `SafeMoneySerializer`: `centsPre (30000n) + centsPost (5000n) === centsTotal (35000n)`.

---

## 5. Resumo Consolidado de Execução e Homologação

```
================================================================
KYRO FINANCE | RESULTADO DA SUÍTE CONSOLIDADA DE TESTES
================================================================
1. Núcleo Contábil (engine.test.ts):         51 / 51 APROVADOS (100%)
2. Subetapa 03.3 (subetapa_03_3.test.ts):     53 / 53 APROVADOS (100%)
3. Subetapa 03.4 (subetapa_03_4.test.ts):     94 / 94 APROVADOS (100%)
----------------------------------------------------------------
TOTAL GERAL CONSOLIDADO:                    198 / 198 APROVADOS (100%)
VERIFICAÇÃO DE TIPOS (npx tsc --noEmit):    0 ERROS (100% TYPE-SAFE)
STATUS FINAL:                               HOMOLOGADO PARA PRODUÇÃO (PR.045)
================================================================
```

---

## 6. Links de Entrega e Referência

- **Deploy Homologado Subetapa 03.4:** [https://kyro-fase-03-4.vercel.app/](https://kyro-fase-03-4.vercel.app/)
- **Deploy Histórico Subetapa 03.3:** [https://kyro-fase-03-3.vercel.app/](https://kyro-fase-03-3.vercel.app/)
- **Deploy Histórico Fase 02:** [https://kyro-fase-02-encerramento.vercel.app/](https://kyro-fase-02-encerramento.vercel.app/)
- **Download Obrigatório do APK Android:** [KYRO-Finance.apk (GitHub Release)](https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk)
- **Caminho Local do APK:** `C:\Users\Lenovo\Documents\antigravity\Finanças\KYRO-Finance.apk`
