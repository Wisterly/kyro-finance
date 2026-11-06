# KYRO FINANCE | RELATÓRIO DE HOMOLOGAÇÃO TÉCNICA E ACEITE — SUBETAPA 03.4

**Ponto de Restauração:** `PR.045`  
**Versão Canônica:** `v1.45` | **Build:** `45`  
**Data da Execução:** `06/11/2026`  
**Commit de Referência Anterior (03.3):** `1fe397de12de565002e0bec6976634c9c166bedb`  
**Deploy Dedicado Vercel:** [https://kyro-fase-03-4.vercel.app/](https://kyro-fase-03-4.vercel.app/)  
**Ambiente de Homologação:** Emuladores Oficiais do Firebase (Firestore porta 8080, Auth porta 9099), Servidor Multi-Processo Standalone (`src/server/httpServer.ts`).

---

## 1. Resumo Executivo da Entrega

A Subetapa 03.4 do KYRO Finance foi projetada, implementada e homologada com sucesso absoluto, cumprindo **100% dos critérios do checklist de aceite**:

1. **Componente 04 — Motor de Concorrência e Leases (`src/engine/concurrency.ts`):**
   - Implementação de gerenciador de leases distribuídos com particionamento explícito por usuário e recurso (`users/{uid}/leases/{resourceId}`).
   - Geração de **Fencing Tokens monotônicos estritamente crescentes** em cada nova concessão ou assunção pós-expiração.
   - Integração atômica no `commitTransaction` do `FirestoreLedgerAdapter`: o fencing token e o titular do lease são conferidos na **mesma transação do Firestore** que grava saldos, lançamentos e recibos de idempotência.
   - Processos com lease vencido (`LEASE_EXPIRED`) ou substituído (`FENCING_TOKEN_OBSOLETE`) são rejeitados com status HTTP 412 (Precondition Failed) sem alterar absolutamente nada no armazenamento persistente.

2. **Disputa Concorrente Real Multi-Processo pela Rede:**
   - Execução de dois processos independentes com PIDs distintos no Sistema Operacional (Processo A na porta 4101 e Processo B na porta 4102) conectados ao mesmo Firestore Emulator (`127.0.0.1:8080`).
   - Processo A obteve lease inicial com fencing token 1 e TTL de 1200ms.
   - Após a expiração temporal (1400ms), o Processo B assumiu o lease recebendo fencing token 2.
   - Processo A tentou gravar transação com token 1 obsoleto: a rota rejeitou sumariamente com **HTTP 412 (`FENCING_TOKEN_OBSOLETE`)**.
   - Leitura direta no Firestore Emulator comprovou: **saldo R$ 0,00 intacto, transação do Processo A não existe e nenhum recibo foi comitado**.
   - Processo B comitou com token 2: confirmada gravação autorizada (**HTTP 200 OK**, saldo R$ 250,00 e recibo persistido com `fencingToken: 2`).
   - Processo A tentou renovar e liberar o lease com token 1 obsoleto: ambas as chamadas foram bloqueadas com HTTP 412.

3. **Sobrevivência Pós-Crash/Restart e Retry Seguro:**
   - Após aplicação inicial de transação no Processo B, os dois processos do servidor HTTP foram sumariamente encerrados (`taskkill /f /t`).
   - Subida de um novo Processo C em nova porta (4103, com novo PID), conectado ao mesmo Firestore Emulator mantido ativo.
   - Reenvio do mesmo `requestId` e payload idêntico via HTTP: o Processo C recuperou o recibo com **HTTP 200 OK (`replay: true`)**.
   - Leitura direta no Firestore confirmou que o saldo não foi duplicado (**Zero Duplo Crédito/Débito**).
   - Reenvio do mesmo `requestId` com payload divergente (valor alterado): o Processo C rejeitou com **HTTP 409 (`IDEMPOTENCY_PAYLOAD_MISMATCH`)**, mantendo o saldo rigorosamente intacto.
   - Validação pré-commit de integridade financeira: valores não positivos abortam a transação sem gravar recibos ou mutações parciais.

4. **Fronteira Criptográfica Avançada do Webhook (`api/webhook.ts`):**
   - Validação de assinatura **HMAC SHA-256** sobre os bytes originais da requisição (`rawBody`) utilizando comparação em tempo constante (`crypto.timingSafeEqual`).
   - Rejeição de corpo adulterado (1 byte modificado): **HTTP 401 (`WEBHOOK_HMAC_INVALID`)**.
   - Validação de carimbo temporal com tolerância máxima estrita de 5 minutos ($\pm 300$s): timestamps fora da janela são rejeitados com **HTTP 401 (`WEBHOOK_TIMESTAMP_EXPIRED`)**.
   - Proteção contra Replay Attack via `nonce` único: repetição do mesmo identificador de evento é bloqueada com **HTTP 409 (`WEBHOOK_NONCE_REPLAY`)**.
   - Webhook sem credenciais válidas rejeitado com **HTTP 401 (`WEBHOOK_ORIGIN_UNAUTHORIZED`)**.
   - Preservação da resolução de identidade do provedor (WhatsApp): eventos sem vínculo rejeitados com **HTTP 403 (`UNBOUND_PROVIDER_IDENTITY`)** e eventos com mapeamento ambíguo rejeitados com **HTTP 409 (`AMBIGUOUS_PROVIDER_IDENTITY`)**.

5. **Suíte Consolidada e Zero Regressão:**
   - 51 testes do núcleo contábil (`engine.test.ts`): **51 APROVADOS (100%)**
   - 53 testes de autorização e rota 03.3 (`subetapa_03_3.test.ts`): **53 APROVADOS (100%)**
   - 64 testes de concorrência, fencing e webhook 03.4 (`subetapa_03_4.test.ts`): **64 APROVADOS (100%)**
   - **Total Consolidado:** **168 de 168 testes aprovados (100% de sucesso)**.
   - Verificação TypeScript Estrita (`npx tsc --noEmit`): **0 erros**.

---

## 2. Mapa dos 28 Componentes da Etapa 03 (Atualização 03.4)

| # | Componente Arquitetural | Caminho Físico no Código | Subetapa | Critério de Aceite Observável | Status |
| :---: | :--- | :--- | :---: | :--- | :---: |
| **01** | Moeda e Centavos BigInt | `src/engine/money.ts` | **03.2** | Soma exata de parcelas, arredondamento determinístico, 0 imprecisão float | **HOMOLOGADO** |
| **02** | Calendário e Fatura | `src/engine/calendar.ts` | **03.2** | Corte civil no dia de fechamento, fuso canônico America/Fortaleza (UTC-3) | **HOMOLOGADO** |
| **03** | Ledger Contábil (Modelo B) | `src/engine/ledger.ts` | **03.2** | Segregação estrita entre compras a vencer, faturas fechadas e saldo credor | **HOMOLOGADO** |
| **04** | Motor de Concorrência e Leases | `src/engine/concurrency.ts` | **03.4** | Fencing tokens monotônicos, rejeição FENCING_TOKEN_OBSOLETE e TTL de 30s | **HOMOLOGADO (PR.045)** |
| **05** | Módulo de Segurança e RBAC | `src/services/authBoundary.ts` | **03.1/03.3** | Validação quíntupla de tokens RS256, HMAC com timingSafeEqual e UID tenant | **HOMOLOGADO** |
| **06** | Relatórios e Invariantes | `src/engine/reports.ts` | **03.2** | Consistência transversal entre DRE por competência, extratos e gráficos | **HOMOLOGADO** |
| **07** | Sincronização e Tombstones | `src/engine/sync.ts` | **03.7** | Fila offline com tombstones de 90 dias e quarentena de clientes > 83 dias | Previsto 03.7 |
| **08** | Parser Semântico Multicanal | `src/utils/financialParser.ts` | **03.6** | Mensagens compostas, schema estrito sem métodos/cidades/cartões fantasmas | Previsto 03.6 |
| **09** | Co-piloto e Desambiguação | `src/utils/aiCopilot.ts` | **03.6** | Bloqueio de mutação sob ambiguidade e solicitação de esclarecimento | Previsto 03.6 |
| **10** | Bridge Nativo Android | `src/nativeBridge.ts` | **03.5** | Reconhecimento contínuo de voz com eventos partialResult e finalResult | Previsto 03.5 |
| **11** | Interface de Chat Web | `src/components/Chat/ChatDrawer.tsx` | **03.6** | Suporte a ditado por voz no browser e comandos em linguagem natural | Previsto 03.6 |
| **12** | Modal de Lançamentos Multi-item | `src/components/Transactions/TransactionModal.tsx` | **03.6** | Submissão atômica de lotes compostos e preview de parcelamento | Previsto 03.6 |
| **13** | Visualizador de Faturas Modelo B | `src/components/Cards/CardInvoiceView.tsx` | **03.2** | Separação visual entre faturas abertas, fechadas e pagamentos de fatura | Previsto 03.6 |
| **14** | Painel Executivo de Saldo | `src/components/Dashboard/FinancialSummary.tsx` | **03.2** | Segregação entre saldo livre em conta e fundos com finalidade comprometida | Previsto 03.6 |
| **15** | Adaptador de Persistência Firestore | `src/services/firestoreAdapter.ts` | **03.3/03.4** | Escrita atômica saldo + recibo + fencing token com auth.uid verificado | **HOMOLOGADO (PR.045)** |
| **16** | Fila Offline IndexedDB | `src/services/offlineQueue.ts` | **03.7** | Persistência local criptografada e ressincronização sem duplicações | Previsto 03.7 |
| **17** | Rota Serverless de Chat | `api/chat.ts` | **03.6** | Ingestão unificada com validação de token Firebase e despacho ao engine | Previsto 03.6 |
| **18** | Rota Webhook Externa | `api/webhook.ts` | **03.1/03.4** | Validação de assinatura HMAC SHA-256 sobre rawBody, timestamp e replay nonce | **HOMOLOGADO (PR.045)** |
| **19** | Serviço Evolution API | `api/services/evolution.ts` | **03.6** | Adapter para instâncias externas HTTP recebendo mensagens e áudios | Previsto 03.6 |
| **20** | Verificador de Versão | `api/app-version.ts` | **03.1** | Resposta com versão canônica, hash de build e bloqueio de clientes legados | **HOMOLOGADO** |
| **21** | Camada Transacional do Banco | `api/database.ts` | **03.3/03.4** | Métodos encapsulados com verificação de tenant, lease e idempotência | **HOMOLOGADO (PR.045)** |
| **22** | Servidor WhatsApp Local | `bot.cjs` | **03.6** | Baileys puro com WebSocket local, ffmpeg/Whisper e OCR com tesseract.js | Previsto 03.6 |
| **23** | Plugin Java Speech Android | `NativeSpeechRecognizerPlugin.java` | **03.5** | Ditado de voz contínuo via SpeechRecognizer nativo no Android | Previsto 03.5 |
| **24** | Configuração Capacitor Saneada | `android/app/capacitor.config.json` | **03.5** | Desativação de cleartext e allowMixedContent (comunicação segura HTTPS/WSS) | Previsto 03.5 |
| **25** | Configuração Gradle Android | `android/app/build.gradle` | **03.1** | Assinatura via variáveis de ambiente sem credenciais expostas em código | **HOMOLOGADO** |
| **26** | Workflow CI/CD GitHub Actions | `.github/workflows/android-build.yml` | **03.1** | Build automatizado do APK com injeção de secrets e geração de release | **HOMOLOGADO** |
| **27** | Script de Migração em Lote | `scripts/migration/bulk_migration.ts` | **03.8** | Migração em lotes de 499 docs + 1 manifesto com snapshot de backup prévio | Previsto 03.8 |
| **28** | Script de Rollback e Restauração | `scripts/migration/rollback_restore.ts` | **03.8** | Restauração reversa a partir de snapshots salvos em _pre_migration_backup | Previsto 03.8 |

> **Nota Arquitetural sobre o Webhook (03.4 vs 03.6):**  
> A Subetapa 03.4 antecipou e homologou integralmente a **fronteira criptográfica e de integridade** do webhook HTTP (HMAC SHA-256 com `timingSafeEqual`, janela de 5 min para Timestamp e barreira anti-replay com Nonce). A ingestão física de mídia binária, download de áudio OGG/Opus do WhatsApp, despacho para Whisper/OpenAI e transcrição semântica permanecem estritamente delimitados para a **Subetapa 03.6**.

---

## 3. Matriz de Evidências dos Testes da Subetapa 03.4

### 3.1 Bloco 1: Unidade e Contrato do Motor de Concorrência (LeaseManager)
| # | Teste | Resultado | Comportamento Observado |
| :---: | :--- | :---: | :--- |
| 01 | Aquisição inicial de lease | **APROVADO** | Cria doc `users/{uid}/leases/{resourceId}` com `fencingToken: 1` e `isReacquired: false` |
| 02 | Fencing token monotônico = 1 | **APROVADO** | Primeiro titular recebe token exatamente 1 |
| 03 | Gravação de holderId legítimo | **APROVADO** | Identificador do processo gravado com exatidão |
| 04 | Reaquisição pelo mesmo titular | **APROVADO** | Renova o prazo mantendo o mesmo fencing token |
| 05 | Bloqueio de titular concorrente | **APROVADO** | Outro processo tentando adquirir lease ativo é rejeitado com `LeaseAlreadyHeldError` (409) |
| 06 | Renovação com token vigente | **APROVADO** | Titular legítimo estende TTL preservando fencing token |
| 07 | Renovação com token obsoleto | **APROVADO** | Rejeitada com `FencingTokenMismatchError` (412) |
| 08 | Renovação por titular incorreto | **APROVADO** | Rejeitada com `LeaseHolderMismatchError` (412) |
| 09 | Renovação após expiração temporal | **APROVADO** | Rejeitada com `LeaseExpiredError` (412), exigindo reaquisição formal |
| 10 | Assunção após expiração | **APROVADO** | Novo processo assume o lease expirado e recebe `fencingToken: 2` (estritamente monotônico) |
| 11 | Liberação com token obsoleto | **APROVADO** | Rejeitada com `FencingTokenMismatchError` (412) |
| 12 | Liberação voluntária legítima | **APROVADO** | Documento de lease removido do armazenamento |

### 3.2 Bloco 2: Disputa Multi-Processo Real no Firestore Emulator
| # | Teste | Resultado | Comportamento Observado |
| :---: | :--- | :---: | :--- |
| 13 | Emissão de ID Token oficial | **APROVADO** | Token emitido via API REST do Auth Emulator oficial (porta 9099) |
| 14 | Subida de 2 servidores HTTP | **APROVADO** | Processos independentes iniciados nas portas 4101 e 4102 |
| 15 | PIDs distintos no SO | **APROVADO** | Processo A e Processo B rodam com PIDs diferentes no Windows |
| 16 | Processo A adquire lease (TTL 1200ms) | **APROVADO** | Recebe HTTP 200 e `fencingToken: 1` via rede |
| 17 | Processo B assume após expiração (1400ms) | **APROVADO** | Recebe HTTP 200 e `fencingToken: 2` via rede |
| 18 | Processo A tenta comitar com token 1 | **APROVADO** | Rota retorna **HTTP 412 (`FENCING_TOKEN_OBSOLETE`)** |
| 19 | Verificação de isolamento no Firestore | **APROVADO** | Saldo permanece R$ 0,00 e nenhum recibo foi comitado para Processo A |
| 20 | Processo B comita com token 2 | **APROVADO** | Rota retorna **HTTP 200 OK (`status: APPLIED`, `fencingToken: 2`)** |
| 21 | Verificação de persistência no Firestore | **APROVADO** | Saldo atualizado para R$ 250,00 e recibo gravado atomicamente |
| 22 | Renovação obsoleto Processo A | **APROVADO** | Retorna HTTP 412 na rota pública |
| 23 | Liberação obsoleto Processo A | **APROVADO** | Retorna HTTP 412 na rota pública |

### 3.3 Bloco 3: Sobrevivência Pós-Crash/Restart e Retry
| # | Teste | Resultado | Comportamento Observado |
| :---: | :--- | :---: | :--- |
| 24 | Gravação inicial pré-crash | **APROVADO** | Transação de R$ 150,00 gravada com sucesso (`replay: false`) |
| 25 | Crash total (Kill nos PIDs) | **APROVADO** | Processos A e B encerrados forçadamente; Firestore Emulator mantido |
| 26 | Subida de Processo C pós-crash | **APROVADO** | Processo C ativo na porta 4103 com novo PID |
| 27 | Retry de requisição idêntica | **APROVADO** | Processo C recupera recibo com HTTP 200 (`replay: true`) |
| 28 | Conservação de saldo pós-retry | **APROVADO** | Saldo no Firestore verificado em R$ 400,00 (sem duplicação) |
| 29 | Reenvio com payload divergente | **APROVADO** | Retorna **HTTP 409 (`IDEMPOTENCY_PAYLOAD_MISMATCH`)** |
| 30 | Preservação de saldo sob conflito | **APROVADO** | Saldo permanece exatamente em R$ 400,00 |
| 31 | Falha pré-commit (valor negativo) | **APROVADO** | Retorna HTTP 500 com rollback completo e 0 documentos corrompidos |

### 3.4 Bloco 4: Fronteira Criptográfica do Webhook
| # | Teste | Resultado | Comportamento Observado |
| :---: | :--- | :---: | :--- |
| 32 | Webhook HMAC válido | **APROVADO** | Assinatura válida sobre rawBody aceita com HTTP 200 (`status: synced`) |
| 33 | Webhook com corpo adulterado | **APROVADO** | 1 byte modificado no payload rejeitado com **HTTP 401 (`WEBHOOK_HMAC_INVALID`)** |
| 34 | Timestamp expirado (> 5 min) | **APROVADO** | Rejeitado com **HTTP 401 (`WEBHOOK_TIMESTAMP_EXPIRED`)** |
| 35 | Primeiro envio com nonce novo | **APROVADO** | Processado com HTTP 200 OK |
| 36 | Reenvio com mesmo nonce (Replay) | **APROVADO** | Rejeitado com **HTTP 409 (`WEBHOOK_NONCE_REPLAY`)** |
| 37 | Origem sem autorização | **APROVADO** | Rejeitada com **HTTP 401 (`WEBHOOK_ORIGIN_UNAUTHORIZED`)** |
| 38 | Telefone sem vínculo cadastrado | **APROVADO** | Rejeitado com **HTTP 403 (`UNBOUND_PROVIDER_IDENTITY`)** |
| 39 | Telefone com vínculo ambíguo | **APROVADO** | Rejeitado com **HTTP 409 (`AMBIGUOUS_PROVIDER_IDENTITY`)** |

---

## 4. Plano Operacional de Reversão (Rollback)

Em consonância com as diretrizes de engenharia de software do KYRO Finance, caso qualquer regressão seja observada no ambiente integrado:

1. **Garantia de Não Exposição de Segredos:** Nenhuma credencial ou chave privada foi ou será commitada em texto claro.
2. **Ponto de Restauração Anterior Canônico:** `PR.044` (commit `1fe397de12de565002e0bec6976634c9c166bedb`), que contém a Subetapa 03.3 integralmente validada.
3. **Procedimento de Reversão de Código:**
   ```bash
   git revert --no-edit <commit-da-03.4>
   git push origin main
   ```
4. **Preservação de Dados:** As coleções `leases` e os campos `fencingToken` nas contas e transações foram projetados para coexistência não invasiva. A reversão para a 03.3 continuará lendo normalmente os registros contábeis através do `SafeMoneySerializer`.
