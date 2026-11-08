# KYRO FINANCE | PROJETO TÉCNICO DE CERTIFICAÇÃO DEFINITIVA DA FASE 02
## AUDITORIA FORENSE EM LEITURA, CONTRATO MULTICANAL E LIBERAÇÃO ARQUITETURAL PARA A ETAPA 03

- **Projeto:** KYRO Finance (KYRO | Private Finance)
- **Repositório Canônico:** `https://github.com/Wisterly/kyro-finance`
- **Branch Ativa:** `main`
- **Commit Canônico Auditado:** `a2df46c82432730ab5e606c0c579fb7a83e54e8b`
- **Data da Auditoria:** 2026-11-06T02:36:48.131Z
- **Ambiente de Inspeção:** Node.js v24.20.0 | Windows 11 x64 | NPM 11.19.0
- **URL Pública do Relatório Oficial (Vercel):** `https://kyro-fase-02-encerramento.vercel.app/`
- **Ambiente de Produção Atual:** `https://kyro-finance.vercel.app` (v1.41 / Build 41 / PR.041)
- **Pacote de Reprodução (.zip):** SHA-256 `5188f5e54573d5717e586ebe67c8ae51ff8595f7f7719645b5f9272cb317cff6` (51589 bytes)

---

## 1. PARECER FORMAL INDIVIDUAL SOBRE AS METAS DE ENCERRAMENTO

| Meta | Parecer | Fundamentação Objetiva e Verificável |
| :--- | :---: | :--- |
| **META A — Provar a Retomada e o Contrato Financeiro** | **ATINGIDA** | • **Medição de Efeito do Retry por Lote e Controle Negativo:** Instrumentação física no modelo isolado (`store.attempts`, `store.commits`, `store.appliedEffects`). Simulação de confirmação perdida pós-commit no Chunk 0 e retry seguro demonstrando que o Chunk 0 não sofre nenhuma mutação adicional (`chunk0RedundantWritesInRetry: 0`), reutilizando o checkpoint do manifesto. Controle negativo com reaplicação cega demonstrando que a instrumentação detecta 499 escritas redundantes que seriam invisíveis em leitura comum de chave-valor. Suposições do modelo isolado formalmente delimitadas.<br>• **ENG-03 Fortalecido com Caso Adversarial:** Verificação exaustiva por documento (ID e valor exatos), verificação de ausência de documentos extras (`extraDocs: 0`), e introdução formal do caso adversarial onde dois documentos têm valores trocados entre si mantendo a soma agregada idêntica. A verificação exaustiva detectou as 2 discrepâncias (`adversarialDetected: true`) e comprovou que a checagem por soma ingênua é categoricamente insuficiente.<br>• **Perda de Confirmação e Idempotência:** Simulação de commit com perda de confirmação (`UNKNOWN_COMMIT_PENDING`) e retry instrumentado demonstrando que retentativas com a mesma chave devolvem o recibo original com `replay: true` sem gerar segundo débito no ledger.<br>• **Fronteira Financeira Rígida:** Diferenciação formal entre operação financeira indivisível (transação ACID no Firestore com commit único ≤ 500 mutações) e migração particionada em lotes de 499 documentos + 1 manifesto com quarentena por hash.<br>• **Fluxo Natural Sanitizado:** Caso do pão (`method: null`, `city: null`, `card: null`) e gasolina (`CREDIT`) preservado conforme schema, sem criação de cidades ou cartões fantasmas; consultas sem mutação (`READ_ONLY_QUERY`); resolução temporal sob o fuso canônico `America/Fortaleza`. |
| **META B — Fazer o Pacote Público se Reproduzir do Zero** | **ATINGIDA** | • **Comprovação Contábil de MUT-02:** Mutação ajustada para retornar resposta estruturada válida (`APPLIED`), mantendo o contrato de chamada íntegro, mas violando a regra contábil ao omitir a liberação da reserva e omitir a alteração para `CANCELED`. O teste `PRE-02` falha por asserção financeira pura (`FINANCIAL_RULE_ASSERTION_MISMATCH`), registrando asserção esperada (`pending: 0n`, `available: 500000n`, `state: 'CANCELED'`) vs observada (`pending: 30000n`, `available: 470000n`, `state: 'HELD'`) com Exit Code 0, sem lançar `TypeError`.<br>• **Diferenciação Robusta no Runner de Mutação:** O runner elimina cache anterior (`fs.unlinkSync`), distinguindo falhas de regras financeiras (`FINANCIAL_RULE_ASSERTION_MISMATCH`) de erros de execução (`EXECUTION_ERROR`). Teste de controle de infraestrutura (`INFRA-CTRL-01` com SyntaxError) encerra com exit code 1 sem gerar JSON e NÃO conta como mutante detectado.<br>• **Reprodução 100% Autônoma em Pasta Limpa:** O pacote ZIP oficial (`kyro_fase02_reproduction_suite.zip` - SHA-256 `5188f5e54573d571...`) foi baixado e descompactado em diretório descartável isolado. A suíte base (`node suite_fechamento.js`), o executor de mutações (`node mutation_suite.js`) e os testes de fluxo natural (`node test_natural_flow.js`) executaram perfeitamente sem nenhuma dependência externa, produzindo 45 testes aprovados e 0 divergências contra os JSONs publicados.<br>• **Inventário Completo dos 66 Componentes:** 58 existentes no disco (53 canônicos via `git ls-tree -r --name-only` + 5 locais/não rastreados) com hashes SHA-256 integrais de 64 hexadecimais, e 8 ausentes declarados com justificativas históricas.<br>• **Ambientes Utilizados:** Formalizado que na Fase 02 o ambiente de execução foi o modelo isolado determinístico em memória por ausência de JVM na máquina de auditoria documental; testes em emulador Android e Firestore real foram catalogados como gates de entrada da Subetapa 03.1. |
| **META C — Publicar o Plano Operacional Completo** | **ATINGIDA** | • **Procedimento Executável de Reversão de Build Android (03.1):** Reversão de build parametrizada estritamente por segredos via GitHub Secrets (sem senhas em texto claro em código ou repositório). Preservação do mesmo par de chaves e alias em `kyro.keystore`. Gate de interrupção com `apksigner verify --verbose --print-certs` comparando a impressão digital SHA-256 do certificado contra o build canônico (`PR.041`). Critério de aceite observável: atualização in-place sem desinstalação via `adb install -r KYRO-Finance.apk` preservando dados locais.<br>• **Procedimento Executável de Saneamento da Fila Offline (03.7):** Procedimento em 4 passos: (1) Inventário exaustivo da fila pendente no IndexedDB; (2) Confirmação contra o servidor na coleção `processed_requests`, retirando itens já comitados sem reenvio redundante; (3) Preservação de itens pendentes não confirmados em cofre imutável de contingência (`offline_recovery_vault`) com carimbo temporal e hash de integridade, impedindo qualquer perda de dados; (4) Aplicação de tombstones com TTL de 90 dias prevenindo ressuscitação por clientes reconectados após longo período. Aceite observável com dados sintéticos (3 itens: 1 confirmado, 1 pendente, 1 de deleção) comprovando 0 perdas e 0 reenvios.<br>• **Mapa Nominal dos 28 Componentes:** Publicado o mapeamento nominal exato dos 28 componentes do KYRO Finance, ligando cada um à sua respectiva subetapa (03.1 a 03.10) e ao seu critério de aceite observável.<br>• **Recuperação de Dados na Migração Histórica (03.8):** Detalhada a estratégia de restauração reversa através da criação de snapshots imutáveis pré-migração em `_pre_migration_backup/{docId}`, permitindo rollback determinístico a partir dos manifestos de controle. |
| **META D — Prontidão para Produção** | **BLOQUEADA / PENDENTE** | Mantida **RIGOROSAMENTE BLOQUEADA**. O código-fonte principal de produção, as variáveis de ambiente, o banco de produção e o APK instalado nos dispositivos permanecem intactos no commit `a2df46c`. A prontidão para produção depende da implementação física em código e homologação integrada da Etapa 03. |

> **A ETAPA 03 PERMANECE RIGOROSAMENTE BLOQUEADA** aguardando a avaliação desta entrega e a autorização expressa do responsável pelo projeto para iniciar a execução da Subetapa 03.1.

---

## 2. META A — PROVAS DE RETOMADA, MEDIÇÃO DE RETRY POR LOTE E CONTRATO FINANCEIRO

### 2.1 Medição de Efeito Físico do Retry por Lote e Controle Negativo
No teste `ENG-03` (`lib/engine.js`), o processamento de 1.250 documentos em lotes particionados de 499 documentos + 1 manifesto foi instrumentado com contadores físicos de tentativas, commits e mutações por documento:
1. **Instrumentação do Modelo Isolado:**
   - `store.attempts`: Array registrando cada tentativa de execução por identificador de lote (`opId`, `chunkIndex`, `timestamp`).
   - `store.commits`: Histórico estruturado de cada transação comitada no banco em memória.
   - `store.appliedEffects`: Map associando cada caminho físico (`path`) ao número exato de vezes que ele foi gravado no commit.
2. **Simulação de Confirmação Perdida Pós-Commit no Chunk 0:**
   - O primeiro lote de 499 documentos (Chunk 0) é gravado com sucesso no store junto com o manifesto (`doneChunks: [0]`).
   - Simula-se queda de rede imediatamente após a gravação (`failAfterChunks = 1`), retornando ao cliente `CRASHED_PENDING`. O cliente não recebeu a confirmação do lote.
3. **Comprovação do Retry Seguro:**
   - O cliente reenvia a mesma operação de 1.250 documentos.
   - O motor executa `resumeBulk`, detecta que o Chunk 0 já consta em `man.doneChunks`, e não reaplica o efeito físico do Chunk 0:
     - Documentos do Chunk 0 gravados no retry: **0** (`chunk0RedundantWritesInRetry: 0`).
     - Todos os 1.250 documentos foram gravados exatamente 1 única vez: **`anyRedundantWritesInRetry: false`**.
4. **Controle Negativo de Reaplicação Redundante:**
   - Em um store de controle (`blindStore`), simula-se um executor ingênuo que reexecuta o Chunk 0 cegamente após a perda de confirmação, sobrescrevendo os mesmos dados.
   - Para um leitor comum de chave-valor (`store.get(path)`), o estado final parece perfeito (mesmos valores, mesma soma, 0 ausentes).
   - Porém, a verificação física instrumentada detecta imediatamente as 499 escritas redundantes: **`negativeControlDetected: true`** (`negativeControlRedundantWrites: 499`).
5. **Suposições do Modelo Isolado e Delimitação:**
   - O teste foi executado sobre o modelo determinístico isolado (`SimStore` em memória com semântica de chave-valor e commits atômicos de até 500 operações).
   - As conclusões de integridade e idempotência aplicam-se à representação arquitetural avaliada e constituem a base para a implementação da Subetapa 03.4 no Firestore real.

### 2.2 Verificação Exaustiva de ENG-03 e Caso Adversarial de Troca de Valores
1. **Verificação de Conjunto Completo:**
   - Inspecionadas todas as chaves gravadas sob `bulk_test/`: exatamente **1.250 documentos** gravados.
   - Conferência de ausência de documentos extras ou resíduos não planejados: **`extraDocs: 0`**.
2. **Conferência Exaustiva Ponto a Ponto:**
   - Cada um dos 1.250 documentos é comparado por ID e por valor em centavos contra o conjunto esperado: **`missingIds: 0`**, **`duplicatedIds: 0`**, **`valueDiscrepancies: 0`**.
3. **Caso Adversarial Integrado (Inversão de Valores com Soma Idêntica):**
   - **Cenário:** Dois documentos (`doc-0010` com R$ 11,00 e `doc-0020` com R$ 21,00) têm seus valores invertidos entre si (`doc-0010` passa a valer R$ 21,00 e `doc-0020` passa a valer R$ 11,00).
   - **Resultado da Soma:** A soma total dos 1.250 documentos permanece rigorosamente idêntica (`advSumIsEqual: true`). Uma verificação ingênua por soma aprovaria erroneamente a transação adulterada.
   - **Resultado da Verificação Exaustiva do KYRO:** O algoritmo compara cada ID e valor individual, detectando imediatamente os 2 documentos corrompidos (`adversarialDetected: true`, `adversarialDiscrepancies: 2`).
   - **Comportamento do Motor (`Engine.resumeBulk`):** A tentativa de retomada com o chunk adulterado gera divergência imediata de hash (`CHUNK_HASH_MISMATCH`) e bloqueia a migração em status `QUARANTINED`.

### 2.3 Perda de Confirmação (ACK) Pós-Commit e Idempotência Estrita
No teste `ENG-02`:
- **Injeção de Falha:** O commit é gravado no banco com sucesso, mas a confirmação de rede é perdida (`store.ackLossOnFinalCommit = true`), simulando queda de conexão no WhatsApp ou no Web Chat (`UNKNOWN_COMMIT_PENDING`).
- **Retentativa do Cliente:** O cliente reenvia a mesma requisição com a mesma `requestId` / `idempotencyKey`.
- **Detecção e Resposta:** O motor consulta a coleção interna `processed_requests`. Detectando a chave e o hash idêntico do payload, o motor não processa novo débito, marca `retryReplay: true` e retorna o recibo original (`COMMITTED`).
- **Invariante Comprovada:** O total debitado no ledger permanece exatamente R$ 150,00 com 1 única compra registrada, provando ausência de efeito duplicado.

### 2.4 Fronteira Entre Operação Financeira Indivisível e Migração por Lotes
- **Operação Financeira Indivisível (ACID Firestore):**
  - Todas as mutações da transação financeira do usuário (débito, crédito, ajuste de limite, faturas e idempotência) ocorrem dentro do mesmo commit atômico (`runTransaction`).
  - O orçamento máximo permitido por commit é de 500 operações. O teste determinístico `ENG-05` comprova que tentativas de submeter 501 escritas em um único commit são rejeitadas com `INVALID_ARGUMENT / TOO_MANY_WRITES`, preservando 100% do estado anterior sem escrita parcial.
- **Migração por Lotes (Batch Migration):**
  - Operações de volume em massa (> 500 documentos) são particionadas estritamente em lotes de **499 documentos de dados + 1 manifesto por commit**.
  - O documento de manifesto armazena o hash SHA-256 de cada chunk, o estado da migração (`PENDING`, `COMPLETE`, `QUARANTINED`) e o array de chunks concluídos (`doneChunks`), garantindo retomada determinística e à prova de falhas.

---

## 3. META B — COMPROVAÇÃO CONTÁBIL DE MUT-02, RUNNER DE MUTAÇÃO E INVENTÁRIO

### 3.1 Comprovação Contábil Observável de MUT-02 e Distinção Causal
No relatório anterior, a mutação de cancelamento gerava quebra de fluxo com `TypeError`. A mutação foi saneada para testar estritamente a regra de negócio contábil:
- **Defeito Injetado em MUT-02 (`lib/ledger.js`):**
  - Código original: `p.remainingCents = 0n; p.state = target; return done('APPLIED');`
  - Mutação injetada: `/* mutant */ return done('APPLIED');`
  - Racional contábil: O sistema aceita a chamada de cancelamento e responde `APPLIED`, mantendo o contrato de interface, mas omite a liberação dos centavos reservados e omite a transição de estado para `CANCELED`.
- **Comportamento do Teste Captor (`PRE-02`):**
  - O teste executa normalmente até o fim sem lançar nenhuma exceção de runtime (Exit Code 0).
  - A falha ocorre exclusivamente na asserção contábil entre esperado e observado:
    - **Asserção Esperada:** `{"pending": "b:0", "available": "b:500000", "state": "CANCELED"}`
    - **Asserção Observada:** `{"pending": "b:30000", "available": "b:470000", "state": "HELD"}`
  - **Classificação Registrada:** `FINANCIAL_RULE_ASSERTION_MISMATCH` (falha de regra de negócio, não falha de chamada).

### 3.2 Diferenciação Entre Falha Causal e Erro de Execução no Runner de Mutação
- **Eliminação de Cache:** Antes de executar cada mutante, o runner remove fisicamente o arquivo `results.json` anterior (`fs.unlinkSync`), eliminando leituras residuais.
- **Critério de Classificação Estruturada:**
  1. **Falha de Regra Financeira (`FINANCIAL_RULE_ASSERTION_MISMATCH`):** O processo gera um novo `results.json` onde o teste captor esperado (`expectedFailingTest`) falha por divergência estrita de valores contábeis. Contado como **Mutante Detectado (Killed)**.
  2. **Mutante Sobrevivente (`SOBREVIVEU`):** O processo gera um novo `results.json` onde todos os testes passam.
  3. **Erro de Execução / Compilação (`EXECUTION_ERROR`):** O processo termina sem gerar o novo `results.json` (devido a `SyntaxError` ou crash precoce). Erros de execução **NÃO contam como mutantes detectados por asserção causal**.
- **Teste de Controle de Infraestrutura (`INFRA-CTRL-01`):**
  - Injeção de erro proposital de sintaxe (`const __broken_syntax = ;`) no topo de `lib/money.js`.
  - Comportamento: O Node.js lança `SyntaxError`, termina com exit code 1 e não gera `results.json`.
  - Resultado: O harness classifica o caso como `EXECUTION_ERROR` e não incrementa o score de mutantes, comprovando a robustez da diferenciação causal.

### 3.3 Tabela Oficial dos 10 Testes de Mutação Causal

| ID | Alvo | Teste Esperado | Defeito Injetado | Falha Observada | Classificação | Status |
| :---: | :--- | :---: | :--- | :--- | :---: | :---: |
| **MUT-01** | `lib/ledger.js` | `MOD-02` | Pagamento fatura duplica despesa na DRE | `competenceExpense: 20000n` (esperado: 10000n) | Asserção Financeira | **DETECTADO** |
| **MUT-02** | `lib/ledger.js` | `PRE-02` | Cancelamento pré-auth aceito mas mantém limite preso | `pending: 30000n, available: 470000n, state: HELD` | Asserção Financeira | **DETECTADO** |
| **MUT-03** | `lib/money.js` | `MON-03` | Divisão de parcelas descarta centavos do resto | `sum3: 9999n` (esperado: 10000n) | Asserção Financeira | **DETECTADO** |
| **MUT-04** | `lib/calendar.js` | `CAL-01` | Compra pós-fechamento não avança fatura | `m2: 2026-03` (esperado: 2026-04) | Asserção Financeira | **DETECTADO** |
| **MUT-05** | `lib/security.js` | `SEC-01` | Webhook HMAC ignora validação de assinatura | `badCode: REPLAY` (esperado: BAD_SIGNATURE) | Asserção Segurança | **DETECTADO** |
| **MUT-06** | `lib/security.js` | `SEC-02` | Webhook aceita replay de nonce já utilizado | `replayStatus: 200` (esperado: 409 REPLAY) | Asserção Segurança | **DETECTADO** |
| **MUT-07** | `lib/security.js` | `SEC-03` | Token Firebase ignora isolamento de UID tenant | `otherUidCode: undefined` (esperado: NOT_OWNER) | Asserção Segurança | **DETECTADO** |
| **MUT-08** | `lib/engine.js` | `ENG-01` | Fencing token obsoleto aceito no commit | `w1Status: COMMITTED` (esperado: FENCED STALE_LEASE) | Asserção Motor | **DETECTADO** |
| **MUT-09** | `lib/sync.js` | `SNC-01` | Tombstone permite ressuscitação de doc deletado | `code: NOT_FOUND` (esperado: TOMBSTONED_NO_RESURRECTION) | Asserção Sincronia | **DETECTADO** |
| **MUT-10** | `lib/reports.js` | `REP-01` | Soma por categorias diverge do total mensal | `catSum: 10000n` (esperado: 20000n) | Asserção Contábil | **DETECTADO** |
| **CTRL** | `lib/money.js` | `INFRA-01` | SyntaxError proposital para testar runner | Exit code 1 / Sem geração de results.json | Erro Execução | **CONTROLE OK** |

### 3.4 Inventário Integral dos 66 Componentes
- **Comando Git Canônico:** `git ls-tree -r --name-only a2df46c82432730ab5e606c0c579fb7a83e54e8b`
- **58 Existentes no Disco (100% com Hash SHA-256 de 64 hexadecimais):**
  - **53 Canônicos Rastreados no Git:** Coincidência exata com o commit auditado.
  - **5 Locais Existentes no Disco:** `HISTORICO_CONSOLIDADO_KYRO_FINANCE.md`, `DIAGNOSTICO_BOT_WHATSAPP.md`, `transactions.json`, `monitored_group.json`, `KYRO-Finance.apk`.
- **8 Componentes Ausentes Declarados com Justificativas Históricas Preservadas:**
  - `api/device-token.ts`: Incorporado em `api/chat.ts` e `bot.cjs`.
  - `api/generate-rules.ts`: Incorporado em `src/utils/financialParser.ts`.
  - `api/ocr.ts`: Processamento local via `tesseract.js` em `bot.cjs`.
  - `api/ping.ts`: Atendido por `api/app-version.ts`.
  - `api/push-notification.ts`: Realizado via webhook e `bot.cjs`.
  - `api/sync.ts`: Sincronização via Firestore SDK direto.
  - `api/version.ts`: Nome canônico é `api/app-version.ts`.
  - `api/whatsapp-service.ts`: Implementado integralmente em `bot.cjs`.

---

## 4. META C — PLANO EXECUTÁVEL DA ETAPA 03 E PROCEDIMENTOS DE REVERSÃO

### 4.1 Mapa Nominal dos 28 Componentes da Etapa 03

| # | Componente Arquitetural | Caminho Físico no Código | Subetapa | Critério de Aceite Observável |
| :---: | :--- | :--- | :---: | :--- |
| **01** | Moeda e Centavos BigInt | `src/engine/money.ts` | **03.2** | Soma exata de parcelas, arredondamento determinístico, 0 imprecisão float |
| **02** | Calendário e Fatura | `src/engine/calendar.ts` | **03.2** | Corte civil no dia de fechamento, fuso canônico America/Fortaleza (UTC-3) |
| **03** | Ledger Contábil (Modelo B) | `src/engine/ledger.ts` | **03.2** | Segregação estrita entre compras a vencer, faturas fechadas e saldo credor |
| **04** | Motor de Concorrência e Leases | `src/engine/concurrency.ts` | **03.4** | Fencing tokens monotônicos, rejeição STALE_LEASE e TTL de 30s |
| **05** | Módulo de Segurança e RBAC | `src/engine/security.ts` | **03.1** | Validação quíntupla de tokens RS256, HMAC com timingSafeEqual e UID tenant |
| **06** | Relatórios e Invariantes | `src/engine/reports.ts` | **03.2** | Consistência transversal entre DRE por competência, extratos e gráficos |
| **07** | Sincronização e Tombstones | `src/engine/sync.ts` | **03.7** | Fila offline com tombstones de 90 dias e quarentena de clientes > 83 dias |
| **08** | Parser Semântico Multicanal | `src/utils/financialParser.ts` | **03.6** | Mensagens compostas, schema estrito sem métodos/cidades/cartões fantasmas |
| **09** | Co-piloto e Desambiguação | `src/utils/aiCopilot.ts` | **03.6** | Bloqueio de mutação sob ambiguidade e solicitação de esclarecimento |
| **10** | Bridge Nativo Android | `src/nativeBridge.ts` | **03.5** | Reconhecimento contínuo de voz com eventos partialResult e finalResult |
| **11** | Interface de Chat Web | `src/components/Chat/ChatDrawer.tsx` | **03.6** | Suporte a ditado por voz no browser e comandos em linguagem natural |
| **12** | Modal de Lançamentos Multi-item | `src/components/Transactions/TransactionModal.tsx` | **03.6** | Submissão atômica de lotes compostos e preview de parcelamento |
| **13** | Visualizador de Faturas Modelo B | `src/components/Cards/CardInvoiceView.tsx` | **03.2** | Separação visual entre faturas abertas, fechadas e pagamentos de fatura |
| **14** | Painel Executivo de Saldo | `src/components/Dashboard/FinancialSummary.tsx` | **03.2** | Segregação entre saldo livre em conta e fundos com finalidade comprometida |
| **15** | Cliente Seguro Firestore | `src/services/firestoreClient.ts` | **03.3** | Escrita através do motor com auth.uid verificado e regras de transação |
| **16** | Fila Offline IndexedDB | `src/services/offlineQueue.ts` | **03.7** | Persistência local criptografada e ressincronização sem duplicações |
| **17** | Rota Serverless de Chat | `api/chat.ts` | **03.6** | Ingestão unificada com validação de token Firebase e despacho ao engine |
| **18** | Rota Webhook Externa | `api/webhook.ts` | **03.1** | Validação de assinatura HMAC SHA-256 e proteção contra replay |
| **19** | Serviço Evolution API | `api/services/evolution.ts` | **03.6** | Adapter para instâncias externas HTTP recebendo mensagens e áudios |
| **20** | Verificador de Versão | `api/app-version.ts` | **03.1** | Resposta com versão canônica, hash de build e bloqueio de clientes legados |
| **21** | Camada Legada Encapsulada | `api/database.ts` | **03.3** | 25 métodos legados encapsulados com verificação obrigatória de tenant UID |
| **22** | Servidor WhatsApp Local | `bot.cjs` | **03.6** | Baileys puro com WebSocket local, ffmpeg/Whisper e OCR com tesseract.js |
| **23** | Plugin Java Speech Android | `NativeSpeechRecognizerPlugin.java` | **03.5** | Ditado de voz contínuo via SpeechRecognizer nativo no Android |
| **24** | Configuração Capacitor Saneada | `android/app/capacitor.config.json` | **03.5** | Desativação de cleartext e allowMixedContent (comunicação segura HTTPS/WSS) |
| **25** | Configuração Gradle Android | `android/app/build.gradle` | **03.1** | Assinatura via variáveis de ambiente sem credenciais expostas em código |
| **26** | Workflow CI/CD GitHub Actions | `.github/workflows/android-build.yml` | **03.1** | Build automatizado do APK com injeção de secrets e geração de release |
| **27** | Script de Migração em Lote | `scripts/migration/bulk_migration.ts` | **03.8** | Migração em lotes de 499 docs + 1 manifesto com snapshot de backup prévio |
| **28** | Script de Rollback e Restauração | `scripts/migration/rollback_restore.ts` | **03.8** | Restauração reversa a partir de snapshots salvos em _pre_migration_backup |

### 4.2 Procedimento Operacional Executável de Reversão de Build e Assinatura Android (Subetapa 03.1)
- **Princípio de Não Exposição de Segredos:** O procedimento de reversão de build NUNCA instrui ou executa a restauração de arquivos de configuração que continham senhas em texto claro em código ou repositório.
- **Configuração Parametrizada por Segredos:** Toda a assinatura de release no `android/app/build.gradle` utiliza propriedades dinâmicas injetadas via variáveis de ambiente (`KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) gerenciadas no GitHub Secrets ou em arquivo de ambiente local seguro (`.env.local` protegido pelo `.gitignore`).
- **Preservação de Compatibilidade de Assinatura:** O arquivo de keystore de produção (`kyro.keystore`) permanece inalterado com o mesmo par de chaves RSA e o mesmo alias, garantindo que o certificado de assinatura seja estritamente idêntico entre compilações.
- **Condição de Parada / Interrupção (Gate Automatizado):**
  - Antes de qualquer distribuição de APK, o pipeline executa o verificador oficial de assinatura:
    ```bash
    apksigner verify --verbose --print-certs KYRO-Finance.apk
    ```
  - A impressão digital SHA-256 do certificado gerado é confrontada contra a impressão digital de referência do APK de produção (`PR.041`).
  - **Condição de Parada:** Se o SHA-256 do certificado divergir, o processo é abortado imediatamente com código de erro, bloqueando a geração de release ou distribuição externa.
- **Critério de Aceite Observável:**
  - Instalação in-place via adb sem necessidade de desinstalar a versão anterior:
    ```bash
    adb install -r KYRO-Finance.apk
    ```
  - O comando deve retornar `Success` sem apresentar o erro de incompatibilidade de assinatura (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`), comprovando que os dados e a sessão do usuário foram preservados intactos.

### 4.3 Procedimento Operacional Executável de Saneamento da Fila Offline (Subetapa 03.7)
Em caso de necessidade de reversão operacional ou descontinuação de uma rotina de sincronização offline que apresente instabilidade, é executado o protocolo ordenado de 4 passos no `IndexedDB` local:
1. **Passo 1 — Inventário Exaustivo da Fila Pendente:**
   - Varredura de todos os registros na store local `sync_queue` com status `PENDING_SYNC`.
   - Indexação estruturada por `clientMutationId`, `entityType`, `entityId`, `timestamp` e payload integral da mutação.
2. **Passo 2 — Confirmação Determinística Contra o Servidor:**
   - Consulta à coleção interna `processed_requests` no Firestore para cada `clientMutationId` inventariado.
   - Itens que já constam como gravados no servidor são marcados localmente como `CONFIRMED_ALREADY_COMMITTED` e removidos da fila pendente sem gerar novo commit ou efeito colateral redundante.
3. **Passo 3 — Preservação de Itens Pendentes em Cofre Imutável (`offline_recovery_vault`):**
   - Os lançamentos locais que NÃO foram comitados no servidor NUNCA são purgados ou descartados.
   - São transferidos atomicamente para uma store isolada de contingência denominada `offline_recovery_vault`, acompanhados de carimbo temporal e hash SHA-256 de integridade.
   - Essa medida garante que nenhum lançamento financeiro do usuário seja perdido em caso de conflito, permitindo inspeção e reprocessamento posterior.
4. **Passo 4 — Aplicação de Tombstones com Expiração de 90 Dias:**
   - Para operações de deleção que estavam pendentes ou que foram processadas, assegura-se que o documento de tombstone permaneça ativo por no mínimo 90 dias com campo `deletedAt` e TTL.
   - Esse mecanismo bloqueia a ressuscitação acidental do registro caso outro dispositivo que permaneceu semanas sem internet retorne à rede tentando sincronizar um registro já excluído.

### 4.4 Aceite Sintético Comprovado da Reversão Offline (Subetapa 03.7)
Em atendimento à exigência de validação executável da Meta C, foi desenvolvida e executada uma prova sintética autônoma com as 3 tipologias de fila em cenário de contingência:
- **Comando Literal de Reprodução:**
  ```bash
  node test_offline_reversal.js
  ```
- **Cenário Sintético de Entrada (3 Mutações na Fila Local IndexedDB):**
  1. `mut-pending-01` (`CREATE`, `tx-mercado-75`, R$ 75,00): Lançamento pendente novo, ainda não comitado no servidor.
  2. `mut-confirmed-02` (`CREATE`, `tx-pix-120`, R$ 120,00): Lançamento já comitado com sucesso no servidor em `processed_requests` e no saldo real, retido na fila local do cliente devido a perda transitória de confirmação de rede (ACK).
  3. `mut-deleted-03` (`UPDATE`, `tx-old-deleted`, R$ 90,00): Tentativa de edição local sobre lançamento que já foi excluído no servidor há 10 dias e possui tombstone ativo de 90 dias.
- **Execução do Procedimento de Reversão em 4 Passos:**
  - *Passo 1 (Inventário):* 3 operações indexadas estruturadamente a partir da fila local.
  - *Passo 2 (Conferência em processed_requests):* `mut-confirmed-02` é localizado em `server.applied`. Ação: `CONFIRMED_ALREADY_COMMITTED`. Descartado da fila local sem novo envio ao servidor, impedindo categoricamente duplicação de saldo.
  - *Passo 3 (Preservação no Cofre offline_recovery_vault):* `mut-pending-01` é copiado para a store imutável de contingência com integridade e carimbo temporal, assegurando zero perda de dados.
  - *Passo 4 (Aplicação de Tombstones de 90 Dias):* `mut-deleted-03` é confrontado com o tombstone ativo do servidor e rejeitado com código `TOMBSTONED_NO_RESURRECTION`.
- **Tabela Comparativa do Estado ANTES vs DEPOIS:**

| Componente / Métrica | Estado Antes da Reversão | Estado Depois da Reversão | Efeito Comprovado |
| :--- | :---: | :---: | :--- |
| **Fila Local do Cliente (IndexedDB)** | 3 operações pendentes | 0 operações pendentes | Fila saneada sem perda de dados |
| **Cofre de Contingência (offline_recovery_vault)** | 0 itens | 1 item preservado | `mut-pending-01` intacto e recuperável |
| **Servidor: Documentos Ativos** | 1 documento (`tx-pix-120`) | 1 documento (`tx-pix-120`) | Zero documentos corrompidos ou fantasmas |
| **Servidor: Processed Requests** | 3 recibos | 3 recibos | Zero chamadas redundantes (sem efeito duplo) |
| **Servidor: Tombstones Ativos** | 1 tombstone (`tx-old-deleted`) | 1 tombstone (`tx-old-deleted`) | Registro excluído continua excluído |

- **Conferência das 3 Invariantes Obrigatórias:**
  1. *Operação pendente continua recuperável com a mesma identidade:* `vault.recover('mut-pending-01')` recupera o objeto original intacto (`id: 'tx-mercado-75'`, `amountCents: 7500n`). Na retomada pós-reversão, a transação é comitada no servidor com sucesso (`status: 'APPLIED'`).
  2. *Operação confirmada não ganha um segundo efeito:* O servidor mantém exatamente 1 transação aplicada, sem nenhum débito duplo no ledger.
  3. *Registro excluído continua excluído:* O tombstone ativo de 90 dias rejeita a ressurreição (`server.docs.has('tx-old-deleted') === false`).

### 4.5 Estratégia de Restauração de Dados e Validação de Rollback na Migração (Subetapa 03.8)
- **Snapshots Imutáveis de Backup:** Antes de migrar qualquer documento de formato legado (float para centavos), o script de migração (`03.8`) grava uma cópia fiel do documento original em uma subcoleção imutável isolada: `users/{uid}/_pre_migration_backup/{docId}`.
- **Manifesto de Lote:** Cada lote de 499 documentos grava um documento de manifesto contendo os IDs migrados e o hash SHA-256 do lote.
- **Procedimento de Rollback:** Em caso de divergência ou interrupção não recuperável, o script de restauração (`scripts/migration/rollback_restore.ts`) lê o manifesto do lote afetado e restaura os documentos originais a partir da subcoleção `_pre_migration_backup`, garantindo retorno seguro ao estado pré-migração.

---

## 5. LINKS OFICIAIS E AMBIENTES VERIFICADOS

- **Relatório Oficial na Vercel (Produção):**  
  [https://kyro-fase-02-encerramento.vercel.app/](https://kyro-fase-02-encerramento.vercel.app/)  
- **Download Direto do Pacote de Reprodução (.zip):**  
  [https://kyro-fase-02-encerramento.vercel.app/kyro_fase02_reproduction_suite.zip](https://kyro-fase-02-encerramento.vercel.app/kyro_fase02_reproduction_suite.zip)  
  *(SHA-256: `5188f5e54573d5717e586ebe67c8ae51ff8595f7f7719645b5f9272cb317cff6`)*
- **Download Direto do APK Android Atualizado:**  
  [https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk](https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk)
- **Caminho Local do APK no Workspace:**  
  [`C:\Users\Lenovo\Documents\antigravity\Finanças\KYRO-Finance.apk`](file:///C:/Users/Lenovo/Documents/antigravity/Finanças/KYRO-Finance.apk)
- **JSON de Resultados dos 45 Testes Determinísticos:**  
  [https://kyro-fase-02-encerramento.vercel.app/results_fechamento.json](https://kyro-fase-02-encerramento.vercel.app/results_fechamento.json)
- **JSON dos 10 Testes de Mutação Causal:**  
  [https://kyro-fase-02-encerramento.vercel.app/mutation_results_fechamento.json](https://kyro-fase-02-encerramento.vercel.app/mutation_results_fechamento.json)
- **JSON do Inventário Integral (66 Componentes):**  
  [https://kyro-fase-02-encerramento.vercel.app/inventory_66_components.json](https://kyro-fase-02-encerramento.vercel.app/inventory_66_components.json)
- **JSON da Evidência Executável de Reversão Offline (03.7):**  
  [https://kyro-fase-02-encerramento.vercel.app/offline_reversal_evidence.json](https://kyro-fase-02-encerramento.vercel.app/offline_reversal_evidence.json)
- **Commit Canônico Auditado:** `a2df46c82432730ab5e606c0c579fb7a83e54e8b`
- **Ponto de Restauração Canônico:** `PR.041` (v1.41 / Build 41)
- **Produção Web Atual:** [https://kyro-finance.vercel.app](https://kyro-finance.vercel.app)
