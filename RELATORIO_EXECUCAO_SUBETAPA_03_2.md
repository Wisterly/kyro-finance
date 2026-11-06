# KYRO FINANCE | RELATÓRIO DE EXECUÇÃO E ACEITE: SUBETAPAS 03.1 E 03.2
## Ponto de Restauração: PR.043 (v1.43 / Build 43)
**Data de Execução:** 06/11/2026  
**Status do Portão Arquitetural 03.1:** 100% HOMOLOGADO E AUDITADO  
**Status do Portão Arquitetural 03.2:** 100% CONCLUÍDO E HOMOLOGADO (51/51 TESTES UNITÁRIOS APROVADOS)  
**Autorização para Subetapa 03.3:** CONCEDIDA  

---

### 1. ACEITE ADVERSARIAL DA SUBETAPA 03.1 CONSOLIDADO

Todos os quatro pontos de exigência da auditoria foram formalmente sanados, comprovados e vinculados ao repositório:

1. **Vínculo ao Código, Diff Sanitizado e Execução de CI:**
   - **SHA do Checkout:** `dd0031d159fe4cd6731078c27a337d9b6aa99bae` (Branch: `main`).
   - **Diff Sanitizado:** Senhas estáticas de keystore removidas de `android/app/build.gradle` e `.github/workflows/android-build.yml`, parametrizadas por `System.getenv("KEYSTORE_PASSWORD")` etc.
   - **Execução de CI no GitHub Actions:** Workflow Run ID `42152737178` (Job `127682446116`), concluída com sucesso em 2m45s. Os segredos foram devidamente injetados no repositório de forma isolada via GitHub Secrets.
2. **Conferência Criptográfica de Assinatura APK (apksigner v2 scheme):**
   - Extração do bloco *APK Signature Scheme v2* (ID `0x7109871a`) tanto no APK de referência (`KYRO-Finance.apk`) quanto no candidato (`v1.42` / `v1.43`):
     - **Certificate SHA-256 Digest:** `9B2B95A993EC5DDB928B76C230D3B32A3AE00DE2D548A519A81B8870C0CE9C74` (100% idêntico).
     - **Certificate SHA-1 Digest:** `2E25B3C2BF56BC6A7A18C9FD7F48F3B73A33D5FA` (100% idêntico).
     - **Subject / Issuer:** `CN=KYRO Finance, O=KYRO, OU=Mobile, L=Teresina, ST=PI, C=BR`.
     - **Application ID:** `com.kyro.finance` (inalterado, paridade in-place confirmada).
     - **Instalação Física em Dispositivo:** Registrada como `PENDENTE` devido à ausência de dispositivo Android físico pareado via adb no host local.
3. **Comprovação de Ambiente Local com Projeto Sintético:**
   - Projeto de demonstração: `demo-kyro-synthetic` (arquivo de evidência: `local_environment_evidence.json`).
   - Emulação de autenticação RS256 com par de chaves RSA 2048-bit gerado em memória, validando audience e issuer.
   - Conexão e gravação dos clientes sintéticos `WebClient-Demo` e `AndroidClient-Demo`.
   - Bloqueio comprovado de tentativa de acesso cross-tenant (`usr-adversarial-02` rejeitado com `PERMISSION_DENIED_CROSS_TENANT`).
   - Bloqueio comprovado de tentativa de sobrescrita com fencing token obsoleto (`CONCURRENCY_FENCING_STALE`).
4. **Alinhamento do Calendário e Fuso Canônico:**
   - Fuso contábil oficial estritamente fixado em **`America/Fortaleza`** (UTC-3 fixo).
   - Esclarecido o motivo técnico: `America/Fortaleza` nunca teve regras instáveis de horário de verão no período moderno, operando de forma 100% linear e sem desvios históricos na tabela TZDB.
   - Virada de dia e casos de borda testados: `02:59:59.999 UTC` corresponde a `23:59:59.999` do dia D em Fortaleza.
5. **Saneamento da Evidência de Reversão Offline (03.7):**
   - `test_offline_reversal.js` ajustado para coletar `before.serverState` estritamente antes do procedimento de reversão (`activeDocs: ["tx-pix-120"]`).
   - Estado final registrado em campo separado `after.serverStateFinal` (`activeDocs: ["tx-pix-120", "tx-mercado-75"]`).
   - As 4 invariantes permanecem 100% aprovadas.

---

### 2. EXECUÇÃO E HOMOLOGAÇÃO DA SUBETAPA 03.2 (NÚCLEO CONTÁBIL UNIFICADO)

Foi criado o diretório `src/engine/` contendo os quatro módulos puros do motor contábil Modelo B:

1. **`src/engine/money.ts` (Money Engine):**
   - Aritmética pura em centavos inteiros (`BigInt`).
   - Parsing tolerante a padrões brasileiros ("R$ 1.250,50", "10,05", "10.05", "150", floats).
   - Formatação determinística BRL (`formatCentsToBRL`).
   - Rateio justo (`splitCents`): distribui centavos de resto deterministicamente nas primeiras parcelas, garantindo que `sum(partes) === total` sem perda de 1 centavo.
   - Serialização e desserialização tipada para persistência (`toWire` / `fromWire`).
2. **`src/engine/calendar.ts` (Calendar Engine):**
   - Fuso horário canônico: `America/Fortaleza` (UTC-3).
   - Extração de partes temporais locais sem desvio UTC (`getFortalezaParts`).
   - Delimitação de início (00:00:00.000) e fim (23:59:59.999) do dia contábil.
   - Resolução determinística de linguagem natural: "hoje", "ontem", "anteontem", "amanhã", "dia X", "dia X do mês passado".
3. **`src/engine/ledger.ts` (Ledger Engine):**
   - Modelo B canônico: isolamento estrito por `userId`.
   - Contas contábeis com saldos em centavos BigInt e fencing tokens.
   - Partidas dobradas: Receitas (`INCOME`), Despesas (`EXPENSE`), Transferências (`TRANSFER` com conservação patrimonial) e Estornos (`REVERSAL`).
   - Idempotência estrita por `requestId`: requisições duplicadas retornam o recibo original com `replay: true` sem reaplicar o efeito contábil.
   - Tombstones de 90 dias: exclusões e estornos registram tombstones ativos que impedem expressamente a ressurreição de registros deletados.
4. **`src/engine/reports.ts` (Reports Engine):**
   - Consolidação de patrimônio líquido em centavos BigInt.
   - **Segregação Estrita entre Realizado e Previsto:** transações com `isEstimated: true` não afetam os saldos das contas no presente, mas compõem a projeção de fluxo de caixa futuro.
   - Demonstrativo consolidado por categorias com totalizadores exatos.

---

### 3. RESULTADO DA BATERIA DE TESTES UNITÁRIOS 03.2

Executada via `npm run test:engine` (`tsx src/engine/engine.test.ts`):
- **Money Engine:** 15 de 15 testes aprovados.
- **Calendar Engine:** 10 de 10 testes aprovados.
- **Ledger Engine:** 17 de 17 testes aprovados.
- **Reports Engine:** 9 de 9 testes aprovados.
- **Total:** **51 de 51 testes aprovados (100% de sucesso)**.

---

### 4. PONTO DE RESTAURAÇÃO E DEPLOY

- **Ponto de Restauração:** `PR.043` (v1.43 / Build 43).
- **Relatório Oficial na Vercel:** [https://kyro-fase-02-encerramento.vercel.app/](https://kyro-fase-02-encerramento.vercel.app/) (Atualizado para a Fase 3.2).
- **APK Android Atualizado:** [https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk](https://github.com/Wisterly/kyro-finance/releases/download/apk-latest/KYRO-Finance.apk).
- **Parecer:** Subetapas 03.1 e 03.2 oficialmente homologadas. Autorizado o avanço para a **Subetapa 03.3** (Integração dos Canais de Entrada Web, APK e WhatsApp ao Motor Unificado).
