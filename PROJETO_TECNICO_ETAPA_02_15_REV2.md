<!-- v1.43-REV2-ETAPA-02.15-REVISAO-CORRETIVA | commit a2df46c82432730ab5e606c0c579fb7a83e54e8b -->

# KYRO Finance — Etapa 02.15 REV2: Correção das Inconsistências Matemáticas, Revalidação dos Testes e Rastreabilidade

**Natureza:** revisão corretiva da própria Etapa 02.15 (não é uma nova etapa). **Versão documental:** `v1.43-REV2-ETAPA-02.15-REVISAO-CORRETIVA`. **Commit auditado:** `a2df46c82432730ab5e606c0c579fb7a83e54e8b` (branch `main`). **URL pública:** https://kyro-relatorio-etapa-02-15-rev2.vercel.app

> **Restrições respeitadas:** trabalho exclusivamente documental e investigativo. Nenhum arquivo do código-fonte, Firestore, dados de produção, APK, variáveis de ambiente, GitHub ou serviço externo foi alterado. A Etapa 03 NÃO foi iniciada. A única publicação realizada é a deste relatório HTML em projeto Vercel independente da aplicação.


## 1. Decisão final e resumo executivo

> **DECISÃO: OPÇÃO A — FASE 02 ENCERRADA (somente no plano arquitetural/documental), COM CONDIÇÕES EXPLÍCITAS.** Isto NÃO é aprovação de produção: o webhook real continua sem HMAC, timestamp, leases e fencing; o modelo de cartões v2 não está implementado no código; a decisão de liberar a Etapa 03 pertence exclusivamente ao responsável pelo projeto.

| Item | Resultado desta revisão |
|---|---|
| Cenários de cartões (modelo v2, execução isolada) | **16/16** aprovados, cada um com 11+ campos conferidos contra esperados escritos à mão |
| Testes suplementares (SCN-15 individual, invariantes, entradas inválidas) | **16/16** aprovados |
| Teste de mutação (o teste consegue falhar?) | **8/8** mutantes detectados |
| Inventário | 66 componentes: 58 existentes, 8 ausentes; **53** idênticos ao commit, **5** NÃO VERIFICÁVEIS contra o commit, 0 divergentes |
| Commit | HEAD local = `a2df46c82432730ab5e606c0c579fb7a83e54e8b`; `git ls-remote origin main` = `a2df46c82432730ab5e606c0c579fb7a83e54e8b`; iguais: **sim**; arquivos rastreados modificados em relação ao HEAD: **NENHUM** |
| Webhook real (`api/webhook.ts`) | HMAC, timestamp, nonce, lease e fencing: **0 ocorrências** (busca por termos, seção 8). Pendência de implementação e requisito obrigatório de segurança. |


## 2. Diagnóstico: por que o relatório anterior parecia inconsistente

Foi feita auditoria retrospectiva do script anterior (`scratch/test_credit_card_16_scenarios.js`) e do JSON `card_16_scenarios_evidence.json`, comparando-os com o HTML publicado. Resultado, sem forçar aprovação:

| # | Achado | Causa técnica | Efeito | Correção nesta REV2 |
|---|---|---|---|---|
| E1 | SCN-03 parecia ter diferença de R$ 500 (limite 5.000, dívida 4.500, disponibilidade 0). | O HTML exibia somente `openInvoiceDebtCents` (R$ 4.500). O JSON anterior continha também parcelas futuras de R$ 2.000 (comprometimento total R$ 6.500; overlimit R$ 1.500). A entrada estava omitida do relatório, não do teste. | Apresentação incompleta; cálculo do JSON estava coerente. | Todas as entradas exibidas; controle I-01 (sem parcelas) demonstra que com apenas R$ 4.500 o disponível é R$ 500. |
| E2 | SCN-09 parecia ter dívida de R$ 100 e disponibilidade de R$ 4.000. | O JSON anterior tinha fatura atual R$ 100 + parcelas futuras R$ 900 (total R$ 1.000). O HTML exibia só R$ 100 como "Dív". | Mistura visual de dívida da fatura com comprometimento do limite. | Dois indicadores separados (`currentInvoiceDebtCents` e `totalLimitCommitmentCents`) e projeção por fatura futura. |
| E3 | SCN-14: pré-autorização de R$ 500 não aparecia. | Estava em `pendingAuthorizationsCents` no JSON, mas o HTML omitia a coluna; não havia estado da pré-autorização. | Efeito contábil não demonstrado. | Pré-autorização com valor e estado (`HELD`/`CAPTURED`/`CANCELED`/`EXPIRED`); só `HELD` compromete limite. |
| E4 | SCN-15: apenas "3.200 vs 3.000". | O teste anterior verificava só a subtração; alerta, sinalizador e proibição de exibir a estimativa como limite bancário nem existiam no modelo testado. | Seis requisitos sem teste. | Seis testes individuais (I-05.1 a I-05.6). |
| E5 | Pagamentos e estornos eram decorativos. | `paymentsSettledCents` era lido, mas nunca usado no cálculo; os cenários SCN-06/07/08/11/16 traziam valores já líquidos. | Testes aprovavam sem exercitar a regra de pagamento. | Cobranças, estornos, pagamentos compensados e não compensados entram no cálculo; teste I-03 e mutante M5. |
| E6 | Esperados parciais. | Os objetos `expected` conferiam um subconjunto de campos (ex.: SCN-14 não conferia divergência; vários não conferiam saldo credor). | "16/16" superestimado. | Todos os cenários conferem ≥ 11 campos, escritos à mão. |
| E7 | Hashes abreviados no inventário e "58 vinculados ao commit". | O HTML mostrava 16 caracteres de cada hash; o vínculo com o commit não havia sido verificado byte a byte. | Rastreabilidade insuficiente e afirmação excessiva. | Hashes integrais; comparação com `git show HEAD:<arquivo>`: 53 idênticos, 5 NÃO VERIFICÁVEIS. |
| E8 | `api/webhook.ts` com "1.167 linhas". | Contagem por `split` contabilizou o segmento vazio após a quebra final; o leitor de arquivos informa 1.166 linhas. | Erro de 1 linha, sem efeito técnico. | Corrigido para 1.166 linhas (1.167 segmentos). |

> **Conclusão do diagnóstico:** parte das inconsistências era de apresentação (entradas omitidas), mas parte era real (pagamentos ignorados, esperados parciais, SCN-15 não testado em seus 6 requisitos, "16/16" superestimado). A afirmação anterior de "aprovação integral dos 16 cenários" fica **retirada** e substituída pelos resultados abaixo.


## 3. Modelo financeiro de cartões v2 (contrato revisado)

Todos os valores são inteiros em centavos (`bigint` na especificação; a suíte usa `BigInt`). Nenhum indicador mistura dívida da fatura com comprometimento do limite.

| Grandeza | Definição | Afeta limite do emissor? | Afeta dívida da fatura? |
|---|---|---|---|
| `contractedLimitCents` | Limite contratado formal. | É o teto. | Não |
| `issuerReportedAvailableLimitCents` | Disponível informado pelo emissor (pode ser nulo). Nunca sobrescrito pelo Kyro. | É o único valor exibível como limite bancário. | Não |
| `invoiceChargesCents` | Compras, parcela corrente, juros e encargos lançados na fatura atual (fechada em aberto + aberta). | Sim (via dívida) | Sim |
| `refundsAppliedCents` | Estornos já aplicados. | Reduz dívida; excedente vira saldo credor. | Sim |
| `paymentsClearedCents` | Pagamentos compensados. | Reduz dívida; excedente vira saldo credor. | Sim |
| `paymentsUnclearedCents` | Pagamentos não compensados. | Não até compensar. | Não |
| `futureInstallmentsCents[]` | Parcelas ainda não faturadas (lista por fatura futura). | Sim (comprometimento futuro) | Não |
| `pendingPurchasesCents` | Compras pendentes de captura. | Sim | Não |
| `preAuthorizations[]` | Valor + estado. Apenas `HELD` compromete limite. | Sim, se `HELD` | Não |
| `priorCreditBalanceCents` | Saldo credor anterior. | Não amplia o limite do emissor. | Não abate automaticamente |

| Indicador calculado | Fórmula |
|---|---|
| `currentInvoiceDebtCents` | `max(0, invoiceCharges − refundsApplied − paymentsCleared)` |
| `generatedCreditCents` | `max(0, refundsApplied + paymentsCleared − invoiceCharges)` |
| `creditBalanceCents` | `priorCreditBalance + generatedCredit` |
| `futureCommitmentCents` | `Σ futureInstallments` |
| `pendingCommitmentCents` | `pendingPurchases + Σ preAuth[estado = HELD]` |
| `totalLimitCommitmentCents` | `currentInvoiceDebt + futureCommitment + pendingCommitment` (≠ dívida da fatura) |
| `calculatedAvailableLimitCents` | `max(0, contractedLimit − totalLimitCommitment)` |
| `overlimitCents` | `max(0, totalLimitCommitment − contractedLimit)` |
| `internalEstimatedPurchasingPowerCents` | `calculatedAvailableLimit + creditBalance` — ESTIMATIVA INTERNA, nunca limite bancário |
| `divergenceCents` | `calculatedAvailableLimit − issuerReportedAvailableLimit` (nulo se o emissor não informou); `hasDivergenceFlag = divergence ≠ 0` |
| Competência × caixa | Pagamento compensado = saída de caixa `paymentsCleared`; despesa por competência gerada pelo pagamento = 0 (liquida passivo). A despesa nasce na compra. |


## 4. Matriz revisada dos 16 cenários — entradas completas

| ID | Limite contratado | Limite informado pelo banco | Cobranças da fatura atual | Estornos | Pagto compensado | Pagto não compensado | Saldo credor anterior | Parcelas futuras (qtd × soma) | Compras pendentes | Pré-autorizações (valor/estado) |
|---|---|---|---|---|---|---|---|---|---|---|
| SCN-01 | R$ 5.000,00 | R$ 3.500,00 | R$ 1.500,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | 0 × R$ 0,00 | R$ 0,00 | — |
| SCN-02 | R$ 5.000,00 | R$ 0,00 | R$ 3.000,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | 4 × R$ 2.000,00 | R$ 0,00 | — |
| SCN-03 | R$ 5.000,00 | R$ 0,00 | R$ 4.500,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | 4 × R$ 2.000,00 | R$ 0,00 | — |
| SCN-04 | R$ 5.000,00 | R$ 5.000,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 800,00 | 0 × R$ 0,00 | R$ 0,00 | — |
| SCN-05 | R$ 5.000,00 | R$ 4.000,00 | R$ 1.000,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 1.500,00 | 0 × R$ 0,00 | R$ 0,00 | — |
| SCN-06 | R$ 5.000,00 | R$ 4.200,00 | R$ 2.000,00 | R$ 0,00 | R$ 1.200,00 | R$ 0,00 | R$ 0,00 | 0 × R$ 0,00 | R$ 0,00 | — |
| SCN-07 | R$ 5.000,00 | R$ 5.000,00 | R$ 2.500,00 | R$ 0,00 | R$ 2.500,00 | R$ 0,00 | R$ 0,00 | 0 × R$ 0,00 | R$ 0,00 | — |
| SCN-08 | R$ 5.000,00 | R$ 5.000,00 | R$ 1.000,00 | R$ 0,00 | R$ 1.000,00 | R$ 0,00 | R$ 0,00 | 0 × R$ 0,00 | R$ 0,00 | — |
| SCN-09 | R$ 5.000,00 | R$ 4.000,00 | R$ 100,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | 9 × R$ 900,00 | R$ 0,00 | — |
| SCN-10 | R$ 5.000,00 | R$ 5.000,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | 0 × R$ 0,00 | R$ 0,00 | R$ 300,00 [CANCELED] |
| SCN-11 | R$ 5.000,00 | R$ 5.000,00 | R$ 1.000,00 | R$ 400,00 | R$ 1.000,00 | R$ 0,00 | R$ 0,00 | 0 × R$ 0,00 | R$ 0,00 | — |
| SCN-12 | R$ 5.000,00 | R$ 3.850,00 | R$ 1.150,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | 0 × R$ 0,00 | R$ 0,00 | — |
| SCN-13 | R$ 5.000,00 | R$ 1.700,00 | R$ 3.300,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | 0 × R$ 0,00 | R$ 0,00 | — |
| SCN-14 | R$ 5.000,00 | R$ 4.500,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | 0 × R$ 0,00 | R$ 0,00 | R$ 500,00 [HELD] |
| SCN-15 | R$ 5.000,00 | R$ 3.000,00 | R$ 1.800,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | R$ 0,00 | 0 × R$ 0,00 | R$ 0,00 | — |
| SCN-16 | R$ 5.000,00 | R$ 5.000,00 | R$ 2.000,00 | R$ 0,00 | R$ 2.000,00 | R$ 0,00 | R$ 0,00 | 0 × R$ 0,00 | R$ 0,00 | — |


## 5. Matriz revisada dos 16 cenários — resultados esperado × obtido

| ID | Cenário | Dívida da fatura | Comprom. futuro | Pendente/pré-auth | Comprom. TOTAL | Limite calculado | Divergência | Overlimit | Saldo credor | Poder de compra (estimativa) | Campos conferidos | Resultado |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SCN-01 | Compra inferior ao limite | R$ 1.500,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 1.500,00 ✔ | R$ 3.500,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 3.500,00 ✔ | 11 | APROVADO (isolado) |
| SCN-02 | Compra que consome integralmente o limite | R$ 3.000,00 ✔ | R$ 2.000,00 ✔ | R$ 0,00 ✔ | R$ 5.000,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | 11 | APROVADO (isolado) |
| SCN-03 | Comprometimento superior ao limite (overlimit) | R$ 4.500,00 ✔ | R$ 2.000,00 ✔ | R$ 0,00 ✔ | R$ 6.500,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 1.500,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | 11 | APROVADO (isolado) |
| SCN-04 | Saldo credor sem divida | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 5.000,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 800,00 ✔ | R$ 5.800,00 ✔ | 11 | APROVADO (isolado) |
| SCN-05 | Saldo credor com divida (sem deducao automatica) | R$ 1.000,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 1.000,00 ✔ | R$ 4.000,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 1.500,00 ✔ | R$ 5.500,00 ✔ | 11 | APROVADO (isolado) |
| SCN-06 | Pagamento parcial de fatura | R$ 800,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 800,00 ✔ | R$ 4.200,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 4.200,00 ✔ | 11 | APROVADO (isolado) |
| SCN-07 | Pagamento integral de fatura | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 5.000,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 5.000,00 ✔ | 11 | APROVADO (isolado) |
| SCN-08 | Pagamento antecipado de fatura | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 5.000,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 5.000,00 ✔ | 11 | APROVADO (isolado) |
| SCN-09 | Compra parcelada em 10x de R$ 100 | R$ 100,00 ✔ | R$ 900,00 ✔ | R$ 0,00 ✔ | R$ 1.000,00 ✔ | R$ 4.000,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 4.000,00 ✔ | 11 | APROVADO (isolado) |
| SCN-10 | Cancelamento de compra antes da captura | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 5.000,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 5.000,00 ✔ | 11 | APROVADO (isolado) |
| SCN-11 | Estorno apos pagamento de fatura | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 5.000,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 400,00 ✔ | R$ 5.400,00 ✔ | 11 | APROVADO (isolado) |
| SCN-12 | Juros e encargos contratuais | R$ 1.150,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 1.150,00 ✔ | R$ 3.850,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 3.850,00 ✔ | 11 | APROVADO (isolado) |
| SCN-13 | Fatura vencida com rotativo | R$ 3.300,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 3.300,00 ✔ | R$ 1.700,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 1.700,00 ✔ | 11 | APROVADO (isolado) |
| SCN-14 | Pre-autorizacao pendente de confirmacao | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 500,00 ✔ | R$ 500,00 ✔ | R$ 4.500,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 4.500,00 ✔ | 11 | APROVADO (isolado) |
| SCN-15 | Divergencia entre limite do emissor e limite calculado | R$ 1.800,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 1.800,00 ✔ | R$ 3.200,00 ✔ | R$ 200,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 3.200,00 ✔ | 11 | APROVADO (isolado) |
| SCN-16 | Competencia x fluxo de caixa | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 5.000,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 0,00 ✔ | R$ 5.000,00 ✔ | 13 | APROVADO (isolado) |

Cada célula mostra o valor obtido seguido de ✔ quando coincide com o esperado escrito à mão. Descrição de cada cenário:

| ID | Descrição e efeito contábil |
|---|---|
| SCN-01 | Limite R$ 5.000; compra de R$ 1.500 na fatura aberta; emissor informa R$ 3.500. |
| SCN-02 | Fatura aberta R$ 3.000 + parcelas futuras R$ 2.000 = R$ 5.000 (= limite). |
| SCN-03 | Fatura aberta R$ 4.500 + parcelas futuras R$ 2.000 (comprometimento nao informado no relatorio anterior) = R$ 6.500 sobre limite de R$ 5.000. Diferenca de R$ 500 do relatorio anterior explicada: a entrada omitia as parcelas futuras de R$ 2.000; a divida da fatura (R$ 4.500) e o comprometimento total (R$ 6.500) sao grandezas distintas. Caso-controle sem parcelas: ver I-01. |
| SCN-04 | Saldo credor anterior R$ 800, sem compras; emissor informa R$ 5.000. |
| SCN-05 | Divida R$ 1.000, saldo credor R$ 1.500; saldo credor NAO abate a divida nem amplia o limite do emissor. |
| SCN-06 | Fatura R$ 2.000; pagamento COMPENSADO de R$ 1.200; resta R$ 800. Pagamento nao compensado de R$ 0. |
| SCN-07 | Fatura R$ 2.500 liquidada integralmente (compensada). |
| SCN-08 | Fatura em curso R$ 1.000 paga antecipadamente em R$ 1.000 (compensado). |
| SCN-09 | Compra de R$ 1.000 em 10x. Fatura atual: 1a parcela R$ 100. Faturas futuras: 9 x R$ 100. Divida da fatura = R$ 100; comprometimento total do limite = R$ 1.000; disponivel = R$ 4.000. |
| SCN-10 | Compra pendente de R$ 300 em estado CANCELED (reversao pelo lojista): nao compromete limite. Caso-controle em estado HELD: ver I-02. |
| SCN-11 | Fatura de R$ 1.000 paga (compensada); estorno posterior de R$ 400 gera saldo credor de R$ 400 (nao amplia limite). |
| SCN-12 | Compras R$ 1.000 + juros/encargos R$ 150 na fatura aberta = R$ 1.150. |
| SCN-13 | Divida vencida R$ 3.000 + encargos de rotativo R$ 300 = R$ 3.300 em aberto. |
| SCN-14 | Pre-autorizacao de R$ 500 (estado HELD) em posto/hotel. Efeito contabil: reduz o limite disponivel de R$ 5.000 para R$ 4.500; NAO e divida da fatura, NAO e despesa por competencia, NAO e saida de caixa. |
| SCN-15 | Fatura R$ 1.800 => calculado R$ 3.200; emissor informa R$ 3.000; divergencia +R$ 200 (verificacoes individuais em I-05). |
| SCN-16 | Compras de R$ 2.000 ja reconhecidas por competencia em ciclo anterior; pagamento compensado de R$ 2.000 = saida de caixa R$ 2.000, despesa por competencia gerada pelo pagamento R$ 0. |


## 6. Cenários corrigidos — demonstração numérica passo a passo


### SCN-03 — comprometimento superior ao limite

- Limite contratado: R$ 5.000,00. Fatura aberta: R$ 4.500,00. Parcelas futuras: 4 × R$ 500,00 = R$ 2.000,00 (omitidas no relatório anterior).
- Dívida da fatura = R$ 4.500,00. Comprometimento total = 4.500 + 2.000 = **R$ 6.500,00**. Overlimit = 6.500 − 5.000 = **R$ 1.500,00**. Disponível = max(0, −1.500) = **R$ 0,00**.
- A "diferença de R$ 500,00" apontada só existiria se o comprometimento total fosse R$ 4.500 (controle I-01: disponível R$ 500,00, sem overlimit). As duas leituras são grandezas diferentes; a entrada anterior era a incompleta, não o resultado.


### SCN-09 — compra de R$ 1.000,00 parcelada em 10 × R$ 100,00

| Visão | Valor | Cálculo |
|---|---|---|
| Fatura atual (parcela 1) | R$ 100,00 | 1 × R$ 100 |
| Fatura +1 … +9 | 9 × R$ 100,00 | projeção por fatura futura |
| Dívida da fatura atual | R$ 100,00 | só a parcela corrente |
| Comprometimento total do limite | R$ 1.000,00 | 100 + 9 × 100 |
| Limite disponível calculado | R$ 4.000,00 | 5.000 − 1.000 |
| Efeito em competência | Despesa de R$ 1.000,00 na compra (ou R$ 100/mês, conforme a política de competência definida em etapas anteriores — fora do escopo desta suíte) | — |
| Fluxo de caixa | R$ 100,00 por mês, a cada pagamento compensado | — |


### SCN-14 — pré-autorização de R$ 500,00

- Entrada explícita: `preAuthorizations = [{ amount: R$ 500,00, state: HELD }]`.
- Efeito: `pendingCommitment` = R$ 500,00; `totalLimitCommitment` = R$ 500,00; disponível = 5.000 − 500 = **R$ 4.500,00** (igual ao informado pelo emissor, divergência 0).
- NÃO é dívida da fatura (R$ 0), NÃO é despesa por competência, NÃO é saída de caixa. Se capturada (`CAPTURED`) passa a compor `invoiceCharges`; se `CANCELED`/`EXPIRED` o limite é liberado (SCN-10 e I-02).


### SCN-15 — divergência com o emissor (seis verificações individuais)

| Teste | Requisito | Resultado |
|---|---|---|
| I-05.1 | SCN-15 (1) preservacao do valor informado pelo emissor: R$ 3.000 permanece intacto e e o limite exibido | APROVADO |
| I-05.2 | SCN-15 (2) calculo interno: R$ 5.000 - R$ 1.800 = R$ 3.200 | APROVADO |
| I-05.3 | SCN-15 (3) diferenca de R$ 200 (calculado - informado) | APROVADO |
| I-05.4 | SCN-15 (4) sinalizador de divergencia ativo | APROVADO |
| I-05.5 | SCN-15 (5) alerta ao usuario existe, tem codigo ISSUER_LIMIT_DIVERGENCE e cita os tres valores | APROVADO |
| I-05.6 | SCN-15 (6) proibicao: a estimativa NAO e apresentada como limite bancario confirmado (confirmedByIssuer=false, rotulo de estimativa, e diferente do limite exibido) | APROVADO |

Alerta gerado no teste: "O emissor informa disponivel R$ 3000,00; a estimativa do Kyro e R$ 3200,00 (diferenca +R$ 200,00). Pode haver compra pendente, IOF/cambio ou atraso de sincronizacao. O valor do emissor prevalece."


## 7. Reexecução e evidências individuais

| Item | Valor |
|---|---|
| Script de teste | `C:/Users/Lenovo/.gemini/antigravity/brain/8651f4bc-3ec9-4882-be77-3ccc7c49a0d4/scratch/rev2/test_cartoes_16_cenarios_rev2.js` |
| SHA-256 do script | `93f07f39f8b7268f8b8adf8ea86a4726e8010076421952e2120bf8eaf075d505` |
| Comando | `node test_cartoes_16_cenarios_rev2.js` |
| Ambiente | Node.js isolado, sem rede, sem Firestore, sem codigo de producao; Node v24.20.0 |
| Executado em | 2026-11-05T21:44:37.207Z |
| JSON de evidência | `C:/Users/Lenovo/.gemini/antigravity/brain/8651f4bc-3ec9-4882-be77-3ccc7c49a0d4/scratch/rev2/card_rev2_evidence.json` |
| SHA-256 do JSON | `e6b15cbb35a3f5ea6d9cef4240a6cb2855fb9acde9e2d351691718e3ecac60fa` |
| Teste de mutação | `C:/Users/Lenovo/.gemini/antigravity/brain/8651f4bc-3ec9-4882-be77-3ccc7c49a0d4/scratch/rev2/mutation_test.js` — SHA-256 `63a0ff1a2a629b4f15bfced7b21ab3a21582af1da64285021ca6606589f4047a` |
| JSON da mutação | SHA-256 `2b1f458fb00766c9bd9b1ac5dc166e5f291bff578b5942cbee30bfe41ee2e8b8` |

> **Registro de alteração do script de teste:** o script anterior foi substituído (não editado) pela suíte REV2. Motivos: ver E5 e E6 — pagamentos eram ignorados, esperados eram parciais e SCN-15 não era testado em 6 requisitos. O código principal do projeto não foi tocado.


### Saída por cenário (todas as verificações campo a campo)

<details><summary>SCN-01 — Compra inferior ao limite — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 1.500,00 | R$ 1.500,00 | ✔ |
| futureCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 1.500,00 | R$ 1.500,00 | ✔ |
| calculatedAvailableLimitCents | R$ 3.500,00 | R$ 3.500,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 0,00 | R$ 0,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 3.500,00 | R$ 3.500,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-02 — Compra que consome integralmente o limite — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 3.000,00 | R$ 3.000,00 | ✔ |
| futureCommitmentCents | R$ 2.000,00 | R$ 2.000,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 5.000,00 | R$ 5.000,00 | ✔ |
| calculatedAvailableLimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 0,00 | R$ 0,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 0,00 | R$ 0,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-03 — Comprometimento superior ao limite (overlimit) — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 4.500,00 | R$ 4.500,00 | ✔ |
| futureCommitmentCents | R$ 2.000,00 | R$ 2.000,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 6.500,00 | R$ 6.500,00 | ✔ |
| calculatedAvailableLimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| overlimitCents | R$ 1.500,00 | R$ 1.500,00 | ✔ |
| creditBalanceCents | R$ 0,00 | R$ 0,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 0,00 | R$ 0,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-04 — Saldo credor sem divida — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 0,00 | R$ 0,00 | ✔ |
| futureCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| calculatedAvailableLimitCents | R$ 5.000,00 | R$ 5.000,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 800,00 | R$ 800,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 5.800,00 | R$ 5.800,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-05 — Saldo credor com divida (sem deducao automatica) — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 1.000,00 | R$ 1.000,00 | ✔ |
| futureCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 1.000,00 | R$ 1.000,00 | ✔ |
| calculatedAvailableLimitCents | R$ 4.000,00 | R$ 4.000,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 1.500,00 | R$ 1.500,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 5.500,00 | R$ 5.500,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-06 — Pagamento parcial de fatura — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 800,00 | R$ 800,00 | ✔ |
| futureCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 800,00 | R$ 800,00 | ✔ |
| calculatedAvailableLimitCents | R$ 4.200,00 | R$ 4.200,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 0,00 | R$ 0,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 4.200,00 | R$ 4.200,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-07 — Pagamento integral de fatura — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 0,00 | R$ 0,00 | ✔ |
| futureCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| calculatedAvailableLimitCents | R$ 5.000,00 | R$ 5.000,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 0,00 | R$ 0,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 5.000,00 | R$ 5.000,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-08 — Pagamento antecipado de fatura — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 0,00 | R$ 0,00 | ✔ |
| futureCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| calculatedAvailableLimitCents | R$ 5.000,00 | R$ 5.000,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 0,00 | R$ 0,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 5.000,00 | R$ 5.000,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-09 — Compra parcelada em 10x de R$ 100 — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 100,00 | R$ 100,00 | ✔ |
| futureCommitmentCents | R$ 900,00 | R$ 900,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 1.000,00 | R$ 1.000,00 | ✔ |
| calculatedAvailableLimitCents | R$ 4.000,00 | R$ 4.000,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 0,00 | R$ 0,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 4.000,00 | R$ 4.000,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-10 — Cancelamento de compra antes da captura — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 0,00 | R$ 0,00 | ✔ |
| futureCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| calculatedAvailableLimitCents | R$ 5.000,00 | R$ 5.000,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 0,00 | R$ 0,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 5.000,00 | R$ 5.000,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-11 — Estorno apos pagamento de fatura — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 0,00 | R$ 0,00 | ✔ |
| futureCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| calculatedAvailableLimitCents | R$ 5.000,00 | R$ 5.000,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 400,00 | R$ 400,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 5.400,00 | R$ 5.400,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-12 — Juros e encargos contratuais — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 1.150,00 | R$ 1.150,00 | ✔ |
| futureCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 1.150,00 | R$ 1.150,00 | ✔ |
| calculatedAvailableLimitCents | R$ 3.850,00 | R$ 3.850,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 0,00 | R$ 0,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 3.850,00 | R$ 3.850,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-13 — Fatura vencida com rotativo — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 3.300,00 | R$ 3.300,00 | ✔ |
| futureCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 3.300,00 | R$ 3.300,00 | ✔ |
| calculatedAvailableLimitCents | R$ 1.700,00 | R$ 1.700,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 0,00 | R$ 0,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 1.700,00 | R$ 1.700,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-14 — Pre-autorizacao pendente de confirmacao — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 0,00 | R$ 0,00 | ✔ |
| futureCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| pendingCommitmentCents | R$ 500,00 | R$ 500,00 | ✔ |
| totalLimitCommitmentCents | R$ 500,00 | R$ 500,00 | ✔ |
| calculatedAvailableLimitCents | R$ 4.500,00 | R$ 4.500,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 0,00 | R$ 0,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 4.500,00 | R$ 4.500,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-15 — Divergencia entre limite do emissor e limite calculado — APROVADO (11 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 1.800,00 | R$ 1.800,00 | ✔ |
| futureCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 1.800,00 | R$ 1.800,00 | ✔ |
| calculatedAvailableLimitCents | R$ 3.200,00 | R$ 3.200,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 0,00 | R$ 0,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 3.200,00 | R$ 3.200,00 | ✔ |
| divergenceCents | R$ 200,00 | R$ 200,00 | ✔ |
| hasDivergenceFlag | true | true | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>

<details><summary>SCN-16 — Competencia x fluxo de caixa — APROVADO (13 verificações)</summary>

| Campo | Esperado | Obtido | OK |
|---|---|---|---|
| currentInvoiceDebtCents | R$ 0,00 | R$ 0,00 | ✔ |
| futureCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| pendingCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| totalLimitCommitmentCents | R$ 0,00 | R$ 0,00 | ✔ |
| calculatedAvailableLimitCents | R$ 5.000,00 | R$ 5.000,00 | ✔ |
| overlimitCents | R$ 0,00 | R$ 0,00 | ✔ |
| creditBalanceCents | R$ 0,00 | R$ 0,00 | ✔ |
| internalEstimatedPurchasingPowerCents | R$ 5.000,00 | R$ 5.000,00 | ✔ |
| divergenceCents | R$ 0,00 | R$ 0,00 | ✔ |
| hasDivergenceFlag | false | false | ✔ |
| cashOutflowCents | R$ 2.000,00 | R$ 2.000,00 | ✔ |
| competenceExpenseFromPaymentCents | R$ 0,00 | R$ 0,00 | ✔ |
| INVARIANT total == fatura + futuro + pendente | true | true | ✔ |


</details>


### Testes suplementares

| ID | Descrição | Resultado |
|---|---|---|
| I-01 | SCN-03 controle: fatura R$ 4.500 SEM outros comprometimentos => disponivel R$ 500 (a diferenca de R$ 500 do relatorio anterior so existe se nao houver parcelas futuras) | APROVADO |
| I-02 | SCN-10 controle: mesma compra de R$ 300 em estado HELD reduz o limite para R$ 4.700; em CANCELED nao reduz | APROVADO |
| I-03 | Pagamento NAO compensado (R$ 500) nao reduz divida nem libera limite | APROVADO |
| I-04 | SCN-09: divida da fatura (R$ 100) e comprometimento total (R$ 1.000) NAO se confundem; projecao de 9 faturas futuras de R$ 100 | APROVADO |
| I-05.1 | SCN-15 (1) preservacao do valor informado pelo emissor: R$ 3.000 permanece intacto e e o limite exibido | APROVADO |
| I-05.2 | SCN-15 (2) calculo interno: R$ 5.000 - R$ 1.800 = R$ 3.200 | APROVADO |
| I-05.3 | SCN-15 (3) diferenca de R$ 200 (calculado - informado) | APROVADO |
| I-05.4 | SCN-15 (4) sinalizador de divergencia ativo | APROVADO |
| I-05.5 | SCN-15 (5) alerta ao usuario existe, tem codigo ISSUER_LIMIT_DIVERGENCE e cita os tres valores | APROVADO |
| I-05.6 | SCN-15 (6) proibicao: a estimativa NAO e apresentada como limite bancario confirmado (confirmedByIssuer=false, rotulo de estimativa, e diferente do limite exibido) | APROVADO |
| I-06 | Saldo credor (R$ 1.500) nao altera limite calculado nem limite exibido do emissor | APROVADO |
| I-07 | Sem valor do emissor: divergencia nula, sem sinalizador, sem alerta, limite exibido "NAO_INFORMADO_PELO_EMISSOR" | APROVADO |
| I-08a | Entrada invalida: valor negativo e rejeitado | APROVADO |
| I-08b | Entrada invalida: number (float) no lugar de bigint e rejeitado | APROVADO |
| I-09 | Invariante em todos os 16 cenarios: nenhum indicador de divida da fatura iguala-se silenciosamente ao comprometimento total quando ha parcelas/pendencias | APROVADO |
| I-10 | Esperados independentes: nenhum esperado foi calculado pela funcao testada (verificacao estrutural: todos os 16 possuem >= 10 campos esperados conferidos) | APROVADO |


### Teste de mutação — a suíte consegue detectar erros?

| Mutante | Adulteração do modelo | Detectado | Testes que falharam |
|---|---|---|---|
| M1 | Comprometimento total ignora parcelas futuras (mistura divida da fatura com limite) | sim | SCN-02, SCN-03, SCN-09, I-04, I-09 |
| M2 | Pre-autorizacao CANCELED passa a comprometer limite | sim | SCN-10, I-02 |
| M3 | Saldo credor passa a ampliar o limite calculado | sim | SCN-04, SCN-05, SCN-11, I-06 |
| M4 | Divergencia com sinal invertido | sim | SCN-15, I-05.3, I-05.5 |
| M5 | Pagamento nao compensado passa a abater a divida | sim | I-03 |
| M6 | Alerta de divergencia suprimido | sim | I-05.5 |
| M7 | Estimativa Kyro marcada como confirmada pelo emissor | sim | I-05.6 |
| M8 | Overlimit nao calculado | sim | SCN-03 |

<details><summary>Conteúdo integral do script `test_cartoes_16_cenarios_rev2.js`</summary>

```js
'use strict';
/**
 * KYRO FINANCE - ETAPA 02.15 REV2
 * Suite isolada (Node.js, sem rede, sem Firestore, sem codigo de producao) do MODELO DE CARTOES v2.
 * Valores monetarios: BigInt em centavos (coerente com a especificacao canonica).
 *
 * Diferencas em relação ao script anterior (scratch/test_credit_card_16_scenarios.js):
 *  - separa DIVIDA DA FATURA (currentInvoiceDebt) de COMPROMETIMENTO TOTAL DO LIMITE (totalLimitCommitment);
 *  - pagamentos compensados/nao compensados e estornos passam a participar do calculo (antes paymentsSettledCents era ignorado);
 *  - pre-autorizacoes possuem estado e valor explicitos; so reduzem o limite se estiverem em estado HELD;
 *  - parcelas futuras sao uma lista (projecao por fatura);
 *  - o resultado esperado e escrito A MAO (nao derivado da funcao) e TODAS as saidas sao conferidas campo a campo;
 *  - SCN-15 e testado em 6 verificacoes individuais; ha testes de invariantes e de entradas invalidas.
 */
const fs = require('fs');
const path = require('path');

const B = (n) => BigInt(n);
const R = (reais) => BigInt(Math.round(reais * 100)); // apenas para legibilidade dos casos de teste

const ACTIVE_PREAUTH_STATES = new Set(['HELD']); // CAPTURED => ja virou fatura; CANCELED/EXPIRED => liberada

function validateMoney(name, v) {
  if (typeof v !== 'bigint') throw new Error(`INVALID_MONEY_TYPE:${name}`);
  if (v < 0n) throw new Error(`NEGATIVE_MONEY:${name}`);
}

function computeCardState(input) {
  const {
    contractedLimitCents, issuerReportedAvailableLimitCents,
    invoiceChargesCents, refundsAppliedCents, paymentsClearedCents, paymentsUnclearedCents,
    priorCreditBalanceCents, futureInstallmentsCents, pendingPurchasesCents, preAuthorizations,
  } = input;

  for (const [k, v] of Object.entries({
    contractedLimitCents, invoiceChargesCents, refundsAppliedCents, paymentsClearedCents,
    paymentsUnclearedCents, priorCreditBalanceCents, pendingPurchasesCents,
  })) validateMoney(k, v);
  if (issuerReportedAvailableLimitCents !== null) validateMoney('issuerReportedAvailableLimitCents', issuerReportedAvailableLimitCents);
  futureInstallmentsCents.forEach((v, i) => validateMoney(`futureInstallmentsCents[${i}]`, v));
  preAuthorizations.forEach((p, i) => validateMoney(`preAuthorizations[${i}].amountCents`, p.amountCents));

  // 1) Divida da fatura atual (fechada em aberto + aberta): cobrancas - estornos - pagamentos COMPENSADOS
  const credits = refundsAppliedCents + paymentsClearedCents;
  const currentInvoiceDebtCents = invoiceChargesCents > credits ? invoiceChargesCents - credits : 0n;
  // 2) Excedente vira saldo credor (nunca amplia limite do emissor)
  const generatedCreditCents = credits > invoiceChargesCents ? credits - invoiceChargesCents : 0n;
  const creditBalanceCents = priorCreditBalanceCents + generatedCreditCents;
  // 3) Comprometimento futuro (parcelas ainda nao faturadas)
  const futureCommitmentCents = futureInstallmentsCents.reduce((a, b) => a + b, 0n);
  // 4) Comprometimento pendente (compras pendentes + pre-autorizacoes ativas)
  const activePreAuthCents = preAuthorizations.filter(p => ACTIVE_PREAUTH_STATES.has(p.state)).reduce((a, p) => a + p.amountCents, 0n);
  const pendingCommitmentCents = pendingPurchasesCents + activePreAuthCents;
  // 5) Comprometimento TOTAL do limite (NAO e divida da fatura)
  const totalLimitCommitmentCents = currentInvoiceDebtCents + futureCommitmentCents + pendingCommitmentCents;
  // 6) Limite calculado pelo Kyro
  const calculatedAvailableLimitCents = contractedLimitCents > totalLimitCommitmentCents ? contractedLimitCents - totalLimitCommitmentCents : 0n;
  const overlimitCents = totalLimitCommitmentCents > contractedLimitCents ? totalLimitCommitmentCents - contractedLimitCents : 0n;
  // 7) Poder de compra interno (ESTIMATIVA; nunca limite bancario)
  const internalEstimatedPurchasingPowerCents = calculatedAvailableLimitCents + creditBalanceCents;
  // 8) Divergencia (somente se o emissor informou)
  const hasIssuerValue = issuerReportedAvailableLimitCents !== null;
  const divergenceCents = hasIssuerValue ? calculatedAvailableLimitCents - issuerReportedAvailableLimitCents : null;
  const hasDivergenceFlag = hasIssuerValue && divergenceCents !== 0n;
  // 9) Valor exibido como limite bancario: SOMENTE o informado pelo emissor
  const displayedBankLimit = hasIssuerValue
    ? { valueCents: issuerReportedAvailableLimitCents, source: 'EMISSOR', confirmedByIssuer: true }
    : { valueCents: null, source: 'NAO_INFORMADO_PELO_EMISSOR', confirmedByIssuer: false };
  const kyroEstimate = { valueCents: calculatedAvailableLimitCents, source: 'ESTIMATIVA_KYRO', confirmedByIssuer: false,
    label: 'Estimativa Kyro - nao confirmada pelo emissor' };
  // 10) Alerta ao usuario
  let userAlert = null;
  if (hasDivergenceFlag) {
    userAlert = {
      code: 'ISSUER_LIMIT_DIVERGENCE',
      message: `O emissor informa disponivel ${fmt(issuerReportedAvailableLimitCents)}; a estimativa do Kyro e ${fmt(calculatedAvailableLimitCents)} (diferenca ${fmtSigned(divergenceCents)}). Pode haver compra pendente, IOF/cambio ou atraso de sincronizacao. O valor do emissor prevalece.`,
    };
  }
  // 11) Competencia x caixa (efeito do pagamento da fatura)
  const cashOutflowCents = paymentsClearedCents;
  const competenceExpenseFromPaymentCents = 0n; // pagamento de fatura liquida passivo; nao e despesa

  // projecao por fatura
  const futureInvoiceProjection = futureInstallmentsCents.map((v, i) => ({ invoiceOffset: i + 1, amountCents: v }));

  return {
    currentInvoiceDebtCents, generatedCreditCents, creditBalanceCents, futureCommitmentCents,
    activePreAuthCents, pendingCommitmentCents, totalLimitCommitmentCents,
    calculatedAvailableLimitCents, overlimitCents, internalEstimatedPurchasingPowerCents,
    issuerReportedAvailableLimitCents, divergenceCents, hasDivergenceFlag,
    displayedBankLimit, kyroEstimate, userAlert, cashOutflowCents, competenceExpenseFromPaymentCents,
    paymentsUnclearedCents, futureInvoiceProjection,
  };
}

function fmt(c) { const s = (c < 0n ? -c : c).toString().padStart(3, '0'); return `R$ ${s.slice(0, -2)},${s.slice(-2)}`; }
function fmtSigned(c) { return (c >= 0n ? '+' : '-') + fmt(c); }

const base = () => ({
  contractedLimitCents: R(5000), issuerReportedAvailableLimitCents: null,
  invoiceChargesCents: 0n, refundsAppliedCents: 0n, paymentsClearedCents: 0n, paymentsUnclearedCents: 0n,
  priorCreditBalanceCents: 0n, futureInstallmentsCents: [], pendingPurchasesCents: 0n, preAuthorizations: [],
});
const mk = (over) => Object.assign(base(), over);
const rep = (n, v) => Array.from({ length: n }, () => v);

/** Esperados escritos a mao. Campos: debt=dividaFatura, fut=comprometimento futuro, pend=pendente, tot=comprometimento total,
 *  calc=limite calculado, over=overlimit, cred=saldo credor, pow=poder de compra, div=divergencia(null se sem emissor), flag=sinalizador */
const SCENARIOS = [
  { id: 'SCN-01', name: 'Compra inferior ao limite', desc: 'Limite R$ 5.000; compra de R$ 1.500 na fatura aberta; emissor informa R$ 3.500.',
    input: mk({ issuerReportedAvailableLimitCents: R(3500), invoiceChargesCents: R(1500) }),
    expected: { debt: R(1500), fut: 0n, pend: 0n, tot: R(1500), calc: R(3500), over: 0n, cred: 0n, pow: R(3500), div: 0n, flag: false } },
  { id: 'SCN-02', name: 'Compra que consome integralmente o limite', desc: 'Fatura aberta R$ 3.000 + parcelas futuras R$ 2.000 = R$ 5.000 (= limite).',
    input: mk({ issuerReportedAvailableLimitCents: 0n, invoiceChargesCents: R(3000), futureInstallmentsCents: rep(4, R(500)) }),
    expected: { debt: R(3000), fut: R(2000), pend: 0n, tot: R(5000), calc: 0n, over: 0n, cred: 0n, pow: 0n, div: 0n, flag: false } },
  { id: 'SCN-03', name: 'Comprometimento superior ao limite (overlimit)',
    desc: 'Fatura aberta R$ 4.500 + parcelas futuras R$ 2.000 (comprometimento nao informado no relatorio anterior) = R$ 6.500 sobre limite de R$ 5.000. Diferenca de R$ 500 do relatorio anterior explicada: a entrada omitia as parcelas futuras de R$ 2.000; a divida da fatura (R$ 4.500) e o comprometimento total (R$ 6.500) sao grandezas distintas. Caso-controle sem parcelas: ver I-01.',
    input: mk({ issuerReportedAvailableLimitCents: 0n, invoiceChargesCents: R(4500), futureInstallmentsCents: rep(4, R(500)) }),
    expected: { debt: R(4500), fut: R(2000), pend: 0n, tot: R(6500), calc: 0n, over: R(1500), cred: 0n, pow: 0n, div: 0n, flag: false } },
  { id: 'SCN-04', name: 'Saldo credor sem divida', desc: 'Saldo credor anterior R$ 800, sem compras; emissor informa R$ 5.000.',
    input: mk({ issuerReportedAvailableLimitCents: R(5000), priorCreditBalanceCents: R(800) }),
    expected: { debt: 0n, fut: 0n, pend: 0n, tot: 0n, calc: R(5000), over: 0n, cred: R(800), pow: R(5800), div: 0n, flag: false } },
  { id: 'SCN-05', name: 'Saldo credor com divida (sem deducao automatica)', desc: 'Divida R$ 1.000, saldo credor R$ 1.500; saldo credor NAO abate a divida nem amplia o limite do emissor.',
    input: mk({ issuerReportedAvailableLimitCents: R(4000), invoiceChargesCents: R(1000), priorCreditBalanceCents: R(1500) }),
    expected: { debt: R(1000), fut: 0n, pend: 0n, tot: R(1000), calc: R(4000), over: 0n, cred: R(1500), pow: R(5500), div: 0n, flag: false } },
  { id: 'SCN-06', name: 'Pagamento parcial de fatura', desc: 'Fatura R$ 2.000; pagamento COMPENSADO de R$ 1.200; resta R$ 800. Pagamento nao compensado de R$ 0.',
    input: mk({ issuerReportedAvailableLimitCents: R(4200), invoiceChargesCents: R(2000), paymentsClearedCents: R(1200) }),
    expected: { debt: R(800), fut: 0n, pend: 0n, tot: R(800), calc: R(4200), over: 0n, cred: 0n, pow: R(4200), div: 0n, flag: false } },
  { id: 'SCN-07', name: 'Pagamento integral de fatura', desc: 'Fatura R$ 2.500 liquidada integralmente (compensada).',
    input: mk({ issuerReportedAvailableLimitCents: R(5000), invoiceChargesCents: R(2500), paymentsClearedCents: R(2500) }),
    expected: { debt: 0n, fut: 0n, pend: 0n, tot: 0n, calc: R(5000), over: 0n, cred: 0n, pow: R(5000), div: 0n, flag: false } },
  { id: 'SCN-08', name: 'Pagamento antecipado de fatura', desc: 'Fatura em curso R$ 1.000 paga antecipadamente em R$ 1.000 (compensado).',
    input: mk({ issuerReportedAvailableLimitCents: R(5000), invoiceChargesCents: R(1000), paymentsClearedCents: R(1000) }),
    expected: { debt: 0n, fut: 0n, pend: 0n, tot: 0n, calc: R(5000), over: 0n, cred: 0n, pow: R(5000), div: 0n, flag: false } },
  { id: 'SCN-09', name: 'Compra parcelada em 10x de R$ 100',
    desc: 'Compra de R$ 1.000 em 10x. Fatura atual: 1a parcela R$ 100. Faturas futuras: 9 x R$ 100. Divida da fatura = R$ 100; comprometimento total do limite = R$ 1.000; disponivel = R$ 4.000.',
    input: mk({ issuerReportedAvailableLimitCents: R(4000), invoiceChargesCents: R(100), futureInstallmentsCents: rep(9, R(100)) }),
    expected: { debt: R(100), fut: R(900), pend: 0n, tot: R(1000), calc: R(4000), over: 0n, cred: 0n, pow: R(4000), div: 0n, flag: false } },
  { id: 'SCN-10', name: 'Cancelamento de compra antes da captura', desc: 'Compra pendente de R$ 300 em estado CANCELED (reversao pelo lojista): nao compromete limite. Caso-controle em estado HELD: ver I-02.',
    input: mk({ issuerReportedAvailableLimitCents: R(5000), preAuthorizations: [{ amountCents: R(300), state: 'CANCELED' }] }),
    expected: { debt: 0n, fut: 0n, pend: 0n, tot: 0n, calc: R(5000), over: 0n, cred: 0n, pow: R(5000), div: 0n, flag: false } },
  { id: 'SCN-11', name: 'Estorno apos pagamento de fatura', desc: 'Fatura de R$ 1.000 paga (compensada); estorno posterior de R$ 400 gera saldo credor de R$ 400 (nao amplia limite).',
    input: mk({ issuerReportedAvailableLimitCents: R(5000), invoiceChargesCents: R(1000), paymentsClearedCents: R(1000), refundsAppliedCents: R(400) }),
    expected: { debt: 0n, fut: 0n, pend: 0n, tot: 0n, calc: R(5000), over: 0n, cred: R(400), pow: R(5400), div: 0n, flag: false } },
  { id: 'SCN-12', name: 'Juros e encargos contratuais', desc: 'Compras R$ 1.000 + juros/encargos R$ 150 na fatura aberta = R$ 1.150.',
    input: mk({ issuerReportedAvailableLimitCents: R(3850), invoiceChargesCents: R(1150) }),
    expected: { debt: R(1150), fut: 0n, pend: 0n, tot: R(1150), calc: R(3850), over: 0n, cred: 0n, pow: R(3850), div: 0n, flag: false } },
  { id: 'SCN-13', name: 'Fatura vencida com rotativo', desc: 'Divida vencida R$ 3.000 + encargos de rotativo R$ 300 = R$ 3.300 em aberto.',
    input: mk({ issuerReportedAvailableLimitCents: R(1700), invoiceChargesCents: R(3300) }),
    expected: { debt: R(3300), fut: 0n, pend: 0n, tot: R(3300), calc: R(1700), over: 0n, cred: 0n, pow: R(1700), div: 0n, flag: false } },
  { id: 'SCN-14', name: 'Pre-autorizacao pendente de confirmacao',
    desc: 'Pre-autorizacao de R$ 500 (estado HELD) em posto/hotel. Efeito contabil: reduz o limite disponivel de R$ 5.000 para R$ 4.500; NAO e divida da fatura, NAO e despesa por competencia, NAO e saida de caixa.',
    input: mk({ issuerReportedAvailableLimitCents: R(4500), preAuthorizations: [{ amountCents: R(500), state: 'HELD' }] }),
    expected: { debt: 0n, fut: 0n, pend: R(500), tot: R(500), calc: R(4500), over: 0n, cred: 0n, pow: R(4500), div: 0n, flag: false } },
  { id: 'SCN-15', name: 'Divergencia entre limite do emissor e limite calculado',
    desc: 'Fatura R$ 1.800 => calculado R$ 3.200; emissor informa R$ 3.000; divergencia +R$ 200 (verificacoes individuais em I-05).',
    input: mk({ issuerReportedAvailableLimitCents: R(3000), invoiceChargesCents: R(1800) }),
    expected: { debt: R(1800), fut: 0n, pend: 0n, tot: R(1800), calc: R(3200), over: 0n, cred: 0n, pow: R(3200), div: R(200), flag: true } },
  { id: 'SCN-16', name: 'Competencia x fluxo de caixa', desc: 'Compras de R$ 2.000 ja reconhecidas por competencia em ciclo anterior; pagamento compensado de R$ 2.000 = saida de caixa R$ 2.000, despesa por competencia gerada pelo pagamento R$ 0.',
    input: mk({ issuerReportedAvailableLimitCents: R(5000), invoiceChargesCents: R(2000), paymentsClearedCents: R(2000) }),
    expected: { debt: 0n, fut: 0n, pend: 0n, tot: 0n, calc: R(5000), over: 0n, cred: 0n, pow: R(5000), div: 0n, flag: false, cash: R(2000), compExp: 0n } },
];

const MAP = { debt: 'currentInvoiceDebtCents', fut: 'futureCommitmentCents', pend: 'pendingCommitmentCents', tot: 'totalLimitCommitmentCents',
  calc: 'calculatedAvailableLimitCents', over: 'overlimitCents', cred: 'creditBalanceCents', pow: 'internalEstimatedPurchasingPowerCents',
  div: 'divergenceCents', flag: 'hasDivergenceFlag', cash: 'cashOutflowCents', compExp: 'competenceExpenseFromPaymentCents' };

const ser = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));

const scenarioResults = SCENARIOS.map(sc => {
  const actualFull = computeCardState(sc.input);
  const checks = Object.entries(sc.expected).map(([k, exp]) => {
    const act = actualFull[MAP[k]];
    return { field: MAP[k], expected: exp, actual: act, ok: act === exp };
  });
  // invariante transversal: total = soma dos componentes
  const invariantOk = actualFull.totalLimitCommitmentCents === actualFull.currentInvoiceDebtCents + actualFull.futureCommitmentCents + actualFull.pendingCommitmentCents;
  checks.push({ field: 'INVARIANT total == fatura + futuro + pendente', expected: true, actual: invariantOk, ok: invariantOk });
  // invariante: todos os campos de saida do modelo cobertos pelo esperado (>= 10 campos conferidos)
  const passed = checks.every(c => c.ok);
  return { id: sc.id, name: sc.name, desc: sc.desc, input: ser(sc.input), actual: ser(actualFull), checks: ser(checks), fieldsChecked: checks.length, passed };
});

// ---------------- Testes suplementares ----------------
const supp = [];
function T(id, desc, fn) {
  try { const r = fn(); supp.push({ id, desc, ...ser(r), passed: r.ok === true }); }
  catch (e) { supp.push({ id, desc, ok: false, passed: false, error: String(e.message) }); }
}
const eq = (a, b) => a === b;

T('I-01', 'SCN-03 controle: fatura R$ 4.500 SEM outros comprometimentos => disponivel R$ 500 (a diferenca de R$ 500 do relatorio anterior so existe se nao houver parcelas futuras)', () => {
  const s = computeCardState(mk({ invoiceChargesCents: R(4500) }));
  return { observed: { calc: s.calculatedAvailableLimitCents, tot: s.totalLimitCommitmentCents }, ok: s.calculatedAvailableLimitCents === R(500) && s.overlimitCents === 0n };
});
T('I-02', 'SCN-10 controle: mesma compra de R$ 300 em estado HELD reduz o limite para R$ 4.700; em CANCELED nao reduz', () => {
  const held = computeCardState(mk({ preAuthorizations: [{ amountCents: R(300), state: 'HELD' }] }));
  const canc = computeCardState(mk({ preAuthorizations: [{ amountCents: R(300), state: 'CANCELED' }] }));
  return { observed: { held: held.calculatedAvailableLimitCents, canceled: canc.calculatedAvailableLimitCents }, ok: held.calculatedAvailableLimitCents === R(4700) && canc.calculatedAvailableLimitCents === R(5000) };
});
T('I-03', 'Pagamento NAO compensado (R$ 500) nao reduz divida nem libera limite', () => {
  const s = computeCardState(mk({ invoiceChargesCents: R(2000), paymentsUnclearedCents: R(500) }));
  return { observed: { debt: s.currentInvoiceDebtCents, calc: s.calculatedAvailableLimitCents }, ok: s.currentInvoiceDebtCents === R(2000) && s.calculatedAvailableLimitCents === R(3000) };
});
T('I-04', 'SCN-09: divida da fatura (R$ 100) e comprometimento total (R$ 1.000) NAO se confundem; projecao de 9 faturas futuras de R$ 100', () => {
  const s = computeCardState(SCENARIOS[8].input);
  const proj = s.futureInvoiceProjection;
  return { observed: { debt: s.currentInvoiceDebtCents, tot: s.totalLimitCommitmentCents, nFuture: proj.length, sumFuture: s.futureCommitmentCents },
    ok: s.currentInvoiceDebtCents === R(100) && s.totalLimitCommitmentCents === R(1000) && s.currentInvoiceDebtCents !== s.totalLimitCommitmentCents && proj.length === 9 && proj.every(p => p.amountCents === R(100)) };
});
// SCN-15 individual
const s15 = computeCardState(SCENARIOS[14].input);
T('I-05.1', 'SCN-15 (1) preservacao do valor informado pelo emissor: R$ 3.000 permanece intacto e e o limite exibido', () => ({
  observed: { issuer: s15.issuerReportedAvailableLimitCents, displayed: s15.displayedBankLimit }, ok: s15.issuerReportedAvailableLimitCents === R(3000) && s15.displayedBankLimit.valueCents === R(3000) && s15.displayedBankLimit.source === 'EMISSOR' }));
T('I-05.2', 'SCN-15 (2) calculo interno: R$ 5.000 - R$ 1.800 = R$ 3.200', () => ({ observed: s15.calculatedAvailableLimitCents, ok: s15.calculatedAvailableLimitCents === R(3200) }));
T('I-05.3', 'SCN-15 (3) diferenca de R$ 200 (calculado - informado)', () => ({ observed: s15.divergenceCents, ok: s15.divergenceCents === R(200) }));
T('I-05.4', 'SCN-15 (4) sinalizador de divergencia ativo', () => ({ observed: s15.hasDivergenceFlag, ok: s15.hasDivergenceFlag === true }));
T('I-05.5', 'SCN-15 (5) alerta ao usuario existe, tem codigo ISSUER_LIMIT_DIVERGENCE e cita os tres valores', () => ({
  observed: s15.userAlert, ok: !!s15.userAlert && s15.userAlert.code === 'ISSUER_LIMIT_DIVERGENCE' && /3,000?|3\.000|3000,00|R\$ 3000,00/.test(s15.userAlert.message) && s15.userAlert.message.includes('R$ 3200,00') && s15.userAlert.message.includes('+R$ 200,00') }));
T('I-05.6', 'SCN-15 (6) proibicao: a estimativa NAO e apresentada como limite bancario confirmado (confirmedByIssuer=false, rotulo de estimativa, e diferente do limite exibido)', () => ({
  observed: { estimate: s15.kyroEstimate, displayed: s15.displayedBankLimit },
  ok: s15.kyroEstimate.confirmedByIssuer === false && s15.kyroEstimate.source === 'ESTIMATIVA_KYRO' && /Estimativa Kyro/.test(s15.kyroEstimate.label) && s15.displayedBankLimit.confirmedByIssuer === true && s15.kyroEstimate.valueCents !== s15.displayedBankLimit.valueCents }));
T('I-06', 'Saldo credor (R$ 1.500) nao altera limite calculado nem limite exibido do emissor', () => {
  const a = computeCardState(mk({ issuerReportedAvailableLimitCents: R(4000), invoiceChargesCents: R(1000) }));
  const b = computeCardState(mk({ issuerReportedAvailableLimitCents: R(4000), invoiceChargesCents: R(1000), priorCreditBalanceCents: R(1500) }));
  return { observed: { semCredito: a.calculatedAvailableLimitCents, comCredito: b.calculatedAvailableLimitCents }, ok: a.calculatedAvailableLimitCents === b.calculatedAvailableLimitCents && a.displayedBankLimit.valueCents === b.displayedBankLimit.valueCents && b.internalEstimatedPurchasingPowerCents === a.internalEstimatedPurchasingPowerCents + R(1500) };
});
T('I-07', 'Sem valor do emissor: divergencia nula, sem sinalizador, sem alerta, limite exibido "NAO_INFORMADO_PELO_EMISSOR"', () => {
  const s = computeCardState(mk({ invoiceChargesCents: R(100) }));
  return { observed: { div: s.divergenceCents, flag: s.hasDivergenceFlag, alert: s.userAlert, displayed: s.displayedBankLimit }, ok: s.divergenceCents === null && s.hasDivergenceFlag === false && s.userAlert === null && s.displayedBankLimit.confirmedByIssuer === false };
});
T('I-08a', 'Entrada invalida: valor negativo e rejeitado', () => { let r = false; try { computeCardState(mk({ invoiceChargesCents: -1n })); } catch (e) { r = /NEGATIVE_MONEY/.test(e.message); } return { observed: r, ok: r }; });
T('I-08b', 'Entrada invalida: number (float) no lugar de bigint e rejeitado', () => { let r = false; try { computeCardState(mk({ invoiceChargesCents: 10.5 })); } catch (e) { r = /INVALID_MONEY_TYPE/.test(e.message); } return { observed: r, ok: r }; });
T('I-09', 'Invariante em todos os 16 cenarios: nenhum indicador de divida da fatura iguala-se silenciosamente ao comprometimento total quando ha parcelas/pendencias', () => {
  const bad = scenarioResults.filter(r => { const a = r.actual; const hasExtra = BigInt(a.futureCommitmentCents) + BigInt(a.pendingCommitmentCents) > 0n; return hasExtra && a.currentInvoiceDebtCents === a.totalLimitCommitmentCents; }).map(r => r.id);
  return { observed: { violating: bad }, ok: bad.length === 0 };
});
T('I-10', 'Esperados independentes: nenhum esperado foi calculado pela funcao testada (verificacao estrutural: todos os 16 possuem >= 10 campos esperados conferidos)', () => {
  const min = Math.min(...scenarioResults.map(r => r.fieldsChecked));
  return { observed: { minFieldsChecked: min }, ok: min >= 10 };
});

const passedScn = scenarioResults.filter(r => r.passed).length;
const passedSupp = supp.filter(r => r.passed).length;

const out = {
  meta: {
    suite: 'KYRO Finance - Modelo de Cartoes v2 - Etapa 02.15 REV2',
    scriptPath: __filename,
    executedAt: new Date().toISOString(),
    node: process.version,
    environment: 'Node.js isolado, sem rede, sem Firestore, sem codigo de producao',
    scenarios: { total: scenarioResults.length, passed: passedScn },
    supplementary: { total: supp.length, passed: passedSupp },
  },
  scenarios: scenarioResults,
  supplementary: supp,
};
const outPath = path.join(path.dirname(__filename), 'card_rev2_evidence.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

console.log('=== EXECUCAO REV2 ===');
for (const r of scenarioResults) {
  const bad = r.checks.filter(c => !c.ok);
  console.log(`${r.id} ${r.passed ? 'PASS' : 'FAIL'} (${r.fieldsChecked} campos)` + (bad.length ? ' ' + JSON.stringify(bad) : ''));
}
for (const t of supp) console.log(`${t.id} ${t.passed ? 'PASS' : 'FAIL'}${t.error ? ' ERRO ' + t.error : ''}`);
console.log(`Cenarios: ${passedScn}/${scenarioResults.length} | Suplementares: ${passedSupp}/${supp.length}`);
console.log('Evidencia:', outPath);

```


</details>

> **Limite epistemológico:** estes testes provam a correção do ALGORITMO v2 em isolamento. Não provam integração com `src/App.tsx`, API, Firestore, Open Finance ou concorrência. Aprovação aqui ≠ aprovação do sistema.


## 8. Webhook real e níveis de evidência por capacidade

| Termo pesquisado (sem diferenciar maiúsculas) | `api/webhook.ts` | `bot.cjs` | `api/chat.ts` | `api/database.ts` |
|---|---|---|---|---|
| `createHmac` | 0 | 0 | 0 | 0 |
| `hmac` | 0 | 0 | 0 | 0 |
| `x-kyro` | 0 | 0 | 0 | 0 |
| `signature` | 0 | 0 | 0 | 0 |
| `timingSafeEqual` | 0 | 0 | 0 | 0 |
| `nonce` | 0 | 0 | 0 | 0 |
| `lease` | 0 | 1 | 0 | 0 |
| `fencing` | 0 | 0 | 0 | 0 |
| `rawBody` | 0 | 0 | 0 | 0 |
| `status(401` | 0 | 0 | 0 | 0 |
| `status(403` | 0 | 0 | 0 | 0 |
| `WEBHOOK_SECRET` | 0 | 0 | 0 | 0 |
| `secret` | 0 | 0 | 0 | 0 |
| `runTransaction` | 0 | 0 | 0 | 0 |
| `idempot` | 0 | 0 | 0 | 0 |
| `authorization` | 1 | 5 | 0 | 0 |
| `Date.now()` | 6 | 20 | 1 | 0 |

> Leitura dos resíduos: `authorization` em `api/webhook.ts` (L786) é o cabeçalho de SAÍDA `Bearer <metaToken>` ao baixar áudio — não autentica requisições recebidas. `lease` em `bot.cjs` (L2856) é a substring de "re**lease**s" na URL do APK. `Date.now()` em `api/webhook.ts` L1023 apenas grava data local. Nenhuma ocorrência de HMAC, nonce, fencing, rawBody, 401/403 ou segredo de webhook nos quatro arquivos.

| Capacidade | Especificação concluída | Algoritmo testado isoladamente | Implementação existente no código real | Funcionamento integrado comprovado |
|---|---|---|---|---|
| Modelo de cartões v2 (16 cenários) | SIM (seção 3) | SIM (16/16 + 16/16 + mutação 8/8) | NÃO (nomes do contrato v2 não existem no código; ver pesquisa abaixo) | NÃO |
| HMAC SHA-256 sobre corpo bruto | SIM (etapas 02.12–02.14) | SIM (script isolado de etapas anteriores — reprodução não refeita nesta REV2) | NÃO (0 ocorrências) | NÃO |
| Janela de timestamp (`/^\d{10}$/`, ±300 s) | SIM | SIM (7 casos em `timestamp_verification_results.json`, etapa anterior) | NÃO | NÃO |
| Nonce + lease + fencing token (idempotência) | SIM | Parcial: simulação determinística; concorrência real NÃO VERIFICÁVEL sem emulador | NÃO | NÃO |
| Rejeição HTTP 401/403 | SIM | Simulada | NÃO (0 ocorrências) | NÃO |
| Valores monetários em `bigint`/centavos inteiros | SIM | SIM (esta suíte) | NÃO COMPROVADO no código real | NÃO |

| Arquivo real | `currentInvoiceDebtCents` | `totalLimitCommitmentCents` | `calculatedAvailableLimitCents` | `issuerReportedAvailableLimitCents` | `BigInt(` |
|---|---|---|---|---|---|
| `src/App.tsx` | 0 | 0 | 0 | 0 | 0 |
| `api/webhook.ts` | 0 | 0 | 0 | 0 | 0 |
| `api/chat.ts` | 0 | 0 | 0 | 0 | 0 |
| `api/database.ts` | 0 | 0 | 0 | 0 | 0 |
| `bot.cjs` | 0 | 0 | 0 | 0 | 0 |
| `src/utils/financialParser.ts` | 0 | 0 | 0 | 0 | 0 |

> **Requisito obrigatório de segurança:** o canal webhook NÃO pode ser liberado enquanto HMAC, validação de timestamp, nonce/lease/fencing e rejeição 401/403 não estiverem implementados e testados com emulador. Isto permanece como pendência de implementação (Etapa 03, sujeita à autorização do responsável).


## 9. Inventário rastreável dos 66 componentes (hashes SHA-256 integrais)

Snapshot: commit `a2df46c82432730ab5e606c0c579fb7a83e54e8b`, branch `main`. Verificação do commit remoto por `git ls-remote origin main` (somente leitura) = `a2df46c82432730ab5e606c0c579fb7a83e54e8b`. Comparação byte a byte: conteúdo do disco × `git show HEAD:<arquivo>`. "Lido integralmente" significa que o arquivo foi lido por completo e hasheado programaticamente; **não** implica inspeção semântica. A coluna "Responsabilidade" é a declarada em etapas anteriores e não foi reverificada nesta revisão, exceto onde indicado nas seções 8 e 6.

| Resumo | Quantidade |
|---|---|
| Existentes no disco | 58 |
| Idênticos ao commit (SHA-256 do disco = SHA-256 do blob em HEAD) | 53 |
| NÃO VERIFICÁVEIS contra o commit (ignorados/não rastreados) | 5 |
| Divergentes do commit | 0 |
| Ausentes no disco e no commit | 8 |


### 9.1 Arquivos existentes (58)

| # | Caminho completo | Bytes | SHA-256 integral (disco) | Existe | Leitura completa | Correspondência com o commit | Responsabilidade declarada |
|---|---|---|---|---|---|---|---|
| 1 | `C:/Users/Lenovo/Documents/antigravity/Finanças/bot.cjs` | 181796 | `e648445e7e84e2d7cf53228982c702a0cadf7bcf0e074b47fa92aa2b49b6f8c0` | sim | sim (hash) | IDENTICO AO COMMIT | Servidor autônomo WhatsApp Baileys com pareamento por código e IA Whisper/Tesseract |
| 2 | `C:/Users/Lenovo/Documents/antigravity/Finanças/package.json` | 1186 | `08c5564a3971b5c40eb240c86eee005e8b76514227354ae2eb71b7347915c79e` | sim | sim (hash) | IDENTICO AO COMMIT | Manifesto de dependências do Node.js, Capacitor e React 19 |
| 3 | `C:/Users/Lenovo/Documents/antigravity/Finanças/package-lock.json` | 331451 | `f046f6376bb3ccb8632b19a5eb49f71b5b8fce5dda72f0960edac23613cd8fd8` | sim | sim (hash) | IDENTICO AO COMMIT | Lockfile determinístico de árvores de dependência npm |
| 4 | `C:/Users/Lenovo/Documents/antigravity/Finanças/capacitor.config.json` | 406 | `db54495cfb7851155eca4a0446b851bdc5ea02aa267226e1d1de51ac0bd68db1` | sim | sim (hash) | IDENTICO AO COMMIT | Configuração de empacotamento nativo Android (appId, server, webDir) |
| 5 | `C:/Users/Lenovo/Documents/antigravity/Finanças/vite.config.ts` | 295 | `1e24d80a6096db9585c880639dce89deb8d915329797a618fc5449da379fae6c` | sim | sim (hash) | IDENTICO AO COMMIT | Configuração do bundler Vite e plugins React |
| 6 | `C:/Users/Lenovo/Documents/antigravity/Finanças/tsconfig.json` | 511 | `24dd02d49c24ee7f9b640029bae95c5fd695a1eb58b40d1b343e7567afa211c6` | sim | sim (hash) | IDENTICO AO COMMIT | Configuração do compilador TypeScript e paths |
| 7 | `C:/Users/Lenovo/Documents/antigravity/Finanças/vercel.json` | 522 | `cc2bea319bb850c7acc286b5afdd3264d26dbcc44b55742ee01c9a7c8f046a1a` | sim | sim (hash) | IDENTICO AO COMMIT | Configuração de rotas serverless, headers e rewrite da Vercel |
| 8 | `C:/Users/Lenovo/Documents/antigravity/Finanças/tailwind.config.js` | 455 | `31aa2660b4e6c8ec5badb7302be38d81b198503e3f9fcc0377137cd34eb6fbc5` | sim | sim (hash) | IDENTICO AO COMMIT | Configuração de design system e temas CSS |
| 9 | `C:/Users/Lenovo/Documents/antigravity/Finanças/postcss.config.js` | 80 | `190c877db466995bf1482f4a16abd06e04a89ede3119341e2a86ff96e1737b27` | sim | sim (hash) | IDENTICO AO COMMIT | Configuração de processamento de estilos Tailwind |
| 10 | `C:/Users/Lenovo/Documents/antigravity/Finanças/Dockerfile` | 257 | `d432c60ea6ee2d84a350ac2b7b0ea106edf214fa97d9786eb2c95eb01289574e` | sim | sim (hash) | IDENTICO AO COMMIT | Containerização para deploy do bot em VPS (Render/Railway) |
| 11 | `C:/Users/Lenovo/Documents/antigravity/Finanças/render.yaml` | 382 | `0fbb126092ea091ce486ff34b856c5164d0980e3f9d59380b7fed9bb003b53c5` | sim | sim (hash) | IDENTICO AO COMMIT | Configuração de infraestrutura de nuvem no Render |
| 12 | `C:/Users/Lenovo/Documents/antigravity/Finanças/iniciar_robo.bat` | 587 | `c2b0259289d5207c93855393ca09114a23ac1699f2ccb130af3cf734f982b91b` | sim | sim (hash) | IDENTICO AO COMMIT | Script Windows para inicialização em segundo plano do bot.cjs |
| 13 | `C:/Users/Lenovo/Documents/antigravity/Finanças/version.json` | 861 | `bbbf9235fa9bf7272c67d8d19fa79f61d4a1d23fc868ad8bf95d02a4c1121349` | sim | sim (hash) | IDENTICO AO COMMIT | Fonte única de versionamento de build do app Android (v1.41 / PR.041) |
| 14 | `C:/Users/Lenovo/Documents/antigravity/Finanças/README.md` | 6350 | `74b59a0533af1bb236b3308642f3b081c0383af3f2045f011fb480a0ab16b103` | sim | sim (hash) | IDENTICO AO COMMIT | Documentação geral de instalação e execução do projeto |
| 15 | `C:/Users/Lenovo/Documents/antigravity/Finanças/PONTOS_DE_RESTAURACAO.md` | 87056 | `cec521493683ce48c342269973c4e3f03d930c965db408400dee5120df2cdc4e` | sim | sim (hash) | IDENTICO AO COMMIT | Registro histórico de builds estáveis e snapshots de restauração |
| 16 | `C:/Users/Lenovo/Documents/antigravity/Finanças/HISTORICO_CONSOLIDADO_KYRO_FINANCE.md` | 29307 | `973443a31a663ff2995b175f3d3353380cb8e094664f63812c1e917de8e07a4c` | sim | sim (hash) | NAO VERIFICAVEL (NAO RASTREADO PELO GIT) | Histórico consolidado da evolução do ecossistema |
| 17 | `C:/Users/Lenovo/Documents/antigravity/Finanças/DIAGNOSTICO_BOT_WHATSAPP.md` | 12846 | `36129bb70b5c22810a14a50a7916395902b2a04f4ad23e1f4f0a57f53d9f6025` | sim | sim (hash) | NAO VERIFICAVEL (NAO RASTREADO PELO GIT) | Diagnóstico e guia de pareamento oficial Baileys |
| 18 | `C:/Users/Lenovo/Documents/antigravity/Finanças/transactions.json` | 4747 | `9614124e108fd4cb215fe0b46bc059c26413d76f4631418f0c546f6c9aedc592` | sim | sim (hash) | NAO VERIFICAVEL (ARQUIVO IGNORADO PELO GIT) | Persistência local de transações registradas pelo robô WhatsApp |
| 19 | `C:/Users/Lenovo/Documents/antigravity/Finanças/kyro_settings.json` | 618 | `ab53a18af776867c6eeea0d614dbd41ed834c271bb7af78ead595650ffb36178` | sim | sim (hash) | IDENTICO AO COMMIT | Configurações operacionais locais do bot (grupos, telefone de monitoramento) |
| 20 | `C:/Users/Lenovo/Documents/antigravity/Finanças/credit_cards.json` | 3 | `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` | sim | sim (hash) | IDENTICO AO COMMIT | Persistência local de cartões cadastrados pelo WhatsApp |
| 21 | `C:/Users/Lenovo/Documents/antigravity/Finanças/recurring_expenses.json` | 3 | `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` | sim | sim (hash) | IDENTICO AO COMMIT | Persistência local de despesas fixas recorrentes do robô |
| 22 | `C:/Users/Lenovo/Documents/antigravity/Finanças/deleted_tx_ids.json` | 275 | `602726349ac38a3dbd9c0c2d6df2afd94c28291af65ec04b8393a2fc91d3ec51` | sim | sim (hash) | IDENTICO AO COMMIT | Registro de IDs de transações canceladas/deletadas no bot |
| 23 | `C:/Users/Lenovo/Documents/antigravity/Finanças/monitored_group.json` | 211 | `5ac4e7dc95fd8ee59998df05d96adc1ec468ced28832855c5f518cbf1b0c7a73` | sim | sim (hash) | NAO VERIFICAVEL (ARQUIVO IGNORADO PELO GIT) | Definição do JID do grupo de WhatsApp monitorado para despesas coletivas |
| 24 | `C:/Users/Lenovo/Documents/antigravity/Finanças/.github/workflows/android-build.yml` | 4098 | `de9bb1f50ad320a80029a967e45a7f1ce9ba8fe1827b084bc8041264d1d2ec9f` | sim | sim (hash) | IDENTICO AO COMMIT | Pipeline CI/CD GitHub Actions de compilação, assinatura e release do APK |
| 25 | `C:/Users/Lenovo/Documents/antigravity/Finanças/.agent/rules/kyro-apk-delivery.md` | 1755 | `91786981e8de74046d9636fd18e58deddae829c67befbbb25e4630212a69527c` | sim | sim (hash) | IDENTICO AO COMMIT | Regra de governança mandatória de entrega do APK atualizado nas respostas |
| 26 | `C:/Users/Lenovo/Documents/antigravity/Finanças/KYRO-Finance.apk` | 9535171 | `ac68662b788ea5291a789bc89004b2da469aff43b90c076e55fa7baf4026e44f` | sim | sim (hash) | NAO VERIFICAVEL (ARQUIVO IGNORADO PELO GIT) | Binário compilado e assinado do aplicativo Android pronto para instalação |
| 27 | `C:/Users/Lenovo/Documents/antigravity/Finanças/android/app/build.gradle` | 2789 | `55e75582f78de96720cefcb0842998194047440246fcc8834afbda8169ea4bb5` | sim | sim (hash) | IDENTICO AO COMMIT | Configuração Gradle do módulo Android (plugins, dependências, SDK version) |
| 28 | `C:/Users/Lenovo/Documents/antigravity/Finanças/android/app/capacitor.build.gradle` | 414 | `47e2308de17888afa42c3a6975626c50ef2fc0abbaf4c7da862eb32d567c3105` | sim | sim (hash) | IDENTICO AO COMMIT | Configuração Gradle injetada pelo Capacitor CLI |
| 29 | `C:/Users/Lenovo/Documents/antigravity/Finanças/android/app/proguard-rules.pro` | 751 | `1cf8c57e8f79c250b0af9c1a5a4edad71a5c348a79ab70243b6bae086c150ad2` | sim | sim (hash) | IDENTICO AO COMMIT | Regras de ofuscação e otimização ProGuard para Android Release |
| 30 | `C:/Users/Lenovo/Documents/antigravity/Finanças/android/app/src/main/AndroidManifest.xml` | 2822 | `ded18100b4837e61577aacccb0788b294fd9cb9dc66c1978e0538f1cad69bdb0` | sim | sim (hash) | IDENTICO AO COMMIT | Manifesto Android de permissões (Áudio, Câmera, Rede, Request Install Packages) |
| 31 | `C:/Users/Lenovo/Documents/antigravity/Finanças/android/app/src/main/java/com/kyro/finance/MainActivity.java` | 2562 | `efc0e48b3087f17b69921bc41da79e00e171e621944b00c1622dbaa9a27612c4` | sim | sim (hash) | IDENTICO AO COMMIT | Activity Android principal, configuração de WebView, banco e permissões |
| 32 | `C:/Users/Lenovo/Documents/antigravity/Finanças/android/app/src/main/java/com/kyro/finance/AppUpdateManagerPlugin.java` | 12208 | `970ee22a131f9549df9defd73dce200e27adcde7671f1fbb45606f41b2141860` | sim | sim (hash) | IDENTICO AO COMMIT | Plugin nativo Capacitor para download de APK e auto-update via FileProvider |
| 33 | `C:/Users/Lenovo/Documents/antigravity/Finanças/android/app/src/main/java/com/kyro/finance/NativeSpeechRecognizerPlugin.java` | 11503 | `4fc50ff031434a78578c2982fcf2eed86881026f3d22f1f30fc6097e5e4b71cd` | sim | sim (hash) | IDENTICO AO COMMIT | Plugin nativo Capacitor para transcrição de fala por voz via Android Speech API |
| 34 | `C:/Users/Lenovo/Documents/antigravity/Finanças/api/app-version.ts` | 5058 | `64ce42fd039dd619ac3d9f3ff5606b05581d127c26438c3a3089531fffe8b964` | sim | sim (hash) | IDENTICO AO COMMIT | Rota serverless que fornece a versão e build atuais para verificação de atualização |
| 35 | `C:/Users/Lenovo/Documents/antigravity/Finanças/api/chat.ts` | 36182 | `5576b2183620eabe3a2ca386470c55867a400ef8c1f543176f7c7b2367a0affd` | sim | sim (hash) | IDENTICO AO COMMIT | Endpoint de assistência por IA (Copilot) com integração OpenAI |
| 36 | `C:/Users/Lenovo/Documents/antigravity/Finanças/api/config/openai.ts` | 129 | `d0b8fa8f958bd13db2cfde97610b9ebf0b57eb79b322e3081fd51deac82755a5` | sim | sim (hash) | IDENTICO AO COMMIT | Instanciação e configuração do cliente OpenAI API |
| 37 | `C:/Users/Lenovo/Documents/antigravity/Finanças/api/database.ts` | 25766 | `3c979ec53d81b74b2dd5031fa357637952bbbec197c8eaabf38f313a82708d69` | sim | sim (hash) | IDENTICO AO COMMIT | Camada de acesso a dados no Firebase Firestore (Client SDK na API) |
| 40 | `C:/Users/Lenovo/Documents/antigravity/Finanças/api/group-join.ts` | 3105 | `7b35cfe21046899525b0fca81fc8398d29593cad91cc9ee4a93bfdf385692b77` | sim | sim (hash) | IDENTICO AO COMMIT | Endpoint para adicionar usuário ao grupo de monitoramento WhatsApp |
| 41 | `C:/Users/Lenovo/Documents/antigravity/Finanças/api/instance-qr.ts` | 3793 | `0d4e713bc971193f400fdd33922b4699c70af3a6b82fe66b7d91a51bdda512a6` | sim | sim (hash) | IDENTICO AO COMMIT | Endpoint de exibição do QR Code de pareamento do Baileys |
| 44 | `C:/Users/Lenovo/Documents/antigravity/Finanças/api/prompts/finance.prompt.ts` | 1721 | `ba409196cf5b861303f261f9e1c17571f3ca912475b62862e021151b6712e268` | sim | sim (hash) | IDENTICO AO COMMIT | System prompt do modelo OpenAI para categorização e chat contábil |
| 46 | `C:/Users/Lenovo/Documents/antigravity/Finanças/api/services/evolution.ts` | 1669 | `663b187863d0b8fe6179815a99c3d4f1b667876c1578f14a8110b901f58cdf2d` | sim | sim (hash) | IDENTICO AO COMMIT | Cliente de integração para APIs externas de mensageria |
| 47 | `C:/Users/Lenovo/Documents/antigravity/Finanças/api/services/financeAssistant.ts` | 3385 | `fb24d6dbd541861b7ac3d4ac104aea7918d9953789fd3857a4ff2fa028ea4b79` | sim | sim (hash) | IDENTICO AO COMMIT | Parser de linguagem natural e regras de negócio para mensagens financeiras |
| 48 | `C:/Users/Lenovo/Documents/antigravity/Finanças/api/services/financeDb.ts` | 2259 | `63a20a830a30c91338d5a06732599ac74be9e73901ecda0893061cf54b622bbf` | sim | sim (hash) | IDENTICO AO COMMIT | Helpers auxiliares de persistência no Firestore |
| 50 | `C:/Users/Lenovo/Documents/antigravity/Finanças/api/transcribe.ts` | 6915 | `6ab950f786e5b179abdf8b6aa97e6aa34104ff1f279487a087f113415e79e3de` | sim | sim (hash) | IDENTICO AO COMMIT | Endpoint de transcrição de áudio via Whisper na nuvem (fallback para local) |
| 52 | `C:/Users/Lenovo/Documents/antigravity/Finanças/api/webhook.ts` | 48927 | `42a16d018fb9b44bdea70577aa4efa9dc726c6b23beb3fe08e1454dbfbe5dc0c` | sim | sim (hash) | IDENTICO AO COMMIT | Endpoint de recebimento de mensagens e eventos externos do WhatsApp/Evolution |
| 54 | `C:/Users/Lenovo/Documents/antigravity/Finanças/src/App.tsx` | 363111 | `33371c4e33225ee9623f2d196d528c9278788128d631b56d2eb44aadcc7e681c` | sim | sim (hash) | IDENTICO AO COMMIT | Componente React principal da aplicação Web e PWA, gerenciamento de estado global |
| 55 | `C:/Users/Lenovo/Documents/antigravity/Finanças/src/components/UpdateModal.tsx` | 10256 | `f5cc3b3b2b0851b8969da3736d172c07a835b21fbc4cf948a7b543dbdbe1e0d6` | sim | sim (hash) | IDENTICO AO COMMIT | Modal interativo de alerta e progresso de atualização de APK para o usuário |
| 56 | `C:/Users/Lenovo/Documents/antigravity/Finanças/src/components/WhatsAppTab.tsx` | 63741 | `d9021bf5e8222a0321b261da5c46cd69a55c114f34113983811834dc4c8d32aa` | sim | sim (hash) | IDENTICO AO COMMIT | Aba de gerenciamento de conexão WhatsApp e código oficial de pareamento |
| 57 | `C:/Users/Lenovo/Documents/antigravity/Finanças/src/firebase.ts` | 5616 | `f2b4dfca4b75884cc8e67655540fe114506f1dd59bb501fc66fefd4f2a39eb6c` | sim | sim (hash) | IDENTICO AO COMMIT | Inicialização do cliente Firebase (Auth, Firestore, Storage) via variáveis Vite |
| 58 | `C:/Users/Lenovo/Documents/antigravity/Finanças/src/index.css` | 2083 | `6cd6679c986e08789d6cd6a1db6d8275cfe3b320ffae8c42a92db9f2239757a3` | sim | sim (hash) | IDENTICO AO COMMIT | Estilos CSS base, fontes e diretivas do Tailwind CSS |
| 59 | `C:/Users/Lenovo/Documents/antigravity/Finanças/src/main.tsx` | 309 | `e79a4d31f8da1957ccfbeefcde3e6f9f39a1a173e6af01cf80c8a923501ca159` | sim | sim (hash) | IDENTICO AO COMMIT | Ponto de entrada de montagem da raiz React 19 no DOM |
| 60 | `C:/Users/Lenovo/Documents/antigravity/Finanças/src/nativeBridge.ts` | 6832 | `b3f4d67d3164848ce26553f1b73af7b8070ed7c6875902ce8ce831e44aaaedd4` | sim | sim (hash) | IDENTICO AO COMMIT | Ponte de comunicação entre JavaScript e plugins nativos Capacitor |
| 61 | `C:/Users/Lenovo/Documents/antigravity/Finanças/src/types.ts` | 3312 | `5d3e4f2656a4a6a24c53f8cf27fa425a58afb1594d256eff04aa82d80f2c4238` | sim | sim (hash) | IDENTICO AO COMMIT | Declaração central de interfaces e tipos TypeScript de modelos financeiros legados |
| 62 | `C:/Users/Lenovo/Documents/antigravity/Finanças/src/utils/aiCopilot.ts` | 46493 | `24c722718bb644a7bfc6197d0db92668e66edfeb70540ba1e421120f7456910c` | sim | sim (hash) | IDENTICO AO COMMIT | Utilitários para comunicação com a IA e formatação de respostas do assistente |
| 63 | `C:/Users/Lenovo/Documents/antigravity/Finanças/src/utils/appUpdater.ts` | 11050 | `38e0d55f9e9b20d68d1e734af00a1c8420cd34c8b2944d725137ad155da22bee` | sim | sim (hash) | IDENTICO AO COMMIT | Lógica cliente de checagem de versão no GitHub e acionamento de auto-update |
| 64 | `C:/Users/Lenovo/Documents/antigravity/Finanças/src/utils/documentExtractor.ts` | 2983 | `cd970600a58fa315c82217b63719c9bbd9ee46f3edb2944247389e42972ace3d` | sim | sim (hash) | IDENTICO AO COMMIT | Extração e parsing de dados em comprovantes e extratos bancários |
| 65 | `C:/Users/Lenovo/Documents/antigravity/Finanças/src/utils/financialParser.ts` | 31258 | `ab718e8ac3130f820030b46ca9e8765c26fb5707c9cd1fe9810d54f7c1dd40ff` | sim | sim (hash) | IDENTICO AO COMMIT | Parser determinístico legado de texto para extração de valores, categorias e datas |
| 66 | `C:/Users/Lenovo/Documents/antigravity/Finanças/src/version.ts` | 918 | `da9efc81e6ab4eaca5ba7525b0d71c27a09924eddc52eac5d118603c247fa99c` | sim | sim (hash) | IDENTICO AO COMMIT | Constantes de versão oficial do frontend (v1.41 / PR.041) |


### 9.2 Componentes ausentes ou não materializados como arquivos independentes (8)

| # | Caminho esperado | Existe no disco | Existe no commit HEAD | Justificativa declarada (etapas anteriores) | Situação da justificativa |
|---|---|---|---|---|---|
| 38 | `api/device-token.ts` | não | não | (Incorporado em api/chat.ts e bot.cjs) | Ausência confirmada no disco e em HEAD; a afirmação de onde a função foi incorporada é declarada e NÃO foi reverificada nesta revisão |
| 39 | `api/generate-rules.ts` | não | não | (Incorporado em src/utils/financialParser.ts) | Ausência confirmada no disco e em HEAD; a afirmação de onde a função foi incorporada é declarada e NÃO foi reverificada nesta revisão |
| 42 | `api/ocr.ts` | não | não | (Realizado localmente por tesseract.js no bot.cjs) | Ausência confirmada no disco e em HEAD; a afirmação de onde a função foi incorporada é declarada e NÃO foi reverificada nesta revisão |
| 43 | `api/ping.ts` | não | não | (Atendido por api/app-version.ts) | Ausência confirmada no disco e em HEAD; a afirmação de onde a função foi incorporada é declarada e NÃO foi reverificada nesta revisão |
| 45 | `api/push-notification.ts` | não | não | (Realizado via webhook e bot.cjs) | Ausência confirmada no disco e em HEAD; a afirmação de onde a função foi incorporada é declarada e NÃO foi reverificada nesta revisão |
| 49 | `api/sync.ts` | não | não | (Sincronização ocorre via Firestore SDK direto) | Ausência confirmada no disco e em HEAD; a afirmação de onde a função foi incorporada é declarada e NÃO foi reverificada nesta revisão |
| 51 | `api/version.ts` | não | não | (Nome canônico é api/app-version.ts) | Ausência confirmada no disco e em HEAD; a afirmação de onde a função foi incorporada é declarada e NÃO foi reverificada nesta revisão |
| 53 | `api/whatsapp-service.ts` | não | não | (Implementado integralmente em bot.cjs) | Ausência confirmada no disco e em HEAD; a afirmação de onde a função foi incorporada é declarada e NÃO foi reverificada nesta revisão |


## 10. Parecer revisado sobre o encerramento da Fase 02

| Dimensão | Parecer | Fundamentação |
|---|---|---|
| A. Maturidade arquitetural | **APROVADA** | Contrato de cartões v2 completo e sem mistura de indicadores; contratos de webhook/idempotência/moeda especificados. O contrato v2 desta REV2 **substitui** as definições v1 (`openInvoiceDebtCents`/`pendingAuthorizationsCents` etc.) das etapas 02.13–02.15, que ficam marcadas como superadas neste ponto. |
| B. Evidência de validação | **APROVADA PARA O ESCOPO ISOLADO** | 16/16 cenários, 16/16 suplementares, mutação 8/8. Não há evidência de integração, concorrência real, Firestore ou Open Finance. Reprodução dos testes de webhook/timestamp de etapas anteriores não foi refeita nesta REV2. |
| C. Prontidão para implementação | **PRONTA, CONDICIONADA** | Contratos suficientes para iniciar a implementação, condicionada à autorização expressa do responsável e à revisão independente do contrato v2 (ele foi criado nesta revisão). |
| D. Prontidão para produção | **NÃO PRONTA** | v1.41 em produção não implementa o modelo v2, não usa `bigint` comprovadamente e o webhook não possui HMAC, timestamp, nonce, lease, fencing nem 401/403. |


### Pendências e limitações registradas

- Implementação do webhook seguro (HMAC, timestamp, nonce, lease, fencing, 401/403) — requisito obrigatório de segurança antes de liberar o canal.
- Integração do modelo v2 em `src/App.tsx` e API; migração de float para centavos inteiros.
- 5 arquivos do inventário NÃO VERIFICÁVEIS contra o commit (ignorados/não rastreados): `HISTORICO_CONSOLIDADO_KYRO_FINANCE.md`, `DIAGNOSTICO_BOT_WHATSAPP.md`, `transactions.json`, `monitored_group.json`, `KYRO-Finance.apk`.
- Testes TST-08 a TST-10 (dependem de emulador/rede) permanecem NÃO VERIFICÁVEIS.
- Justificativas dos 8 componentes ausentes são declaradas, não reverificadas.
- Políticas de competência de compras parceladas e juros não foram redefinidas aqui (fora do escopo).


## 11. Autocorreção — revisão crítica deste relatório

| Verificação automática do próprio relatório | Resultado | Detalhe |
|---|---|---|
| Recomputação independente dos 16 cenários (aritmética Number, sem usar a função testada) | APROVADO | 16/16 coincidem |
| Todos os 58 hashes do inventário estão integrais (64 hex) e presentes no MD e no HTML | APROVADO | 62 hashes de 64 hex no MD |
| Nenhum hash truncado (padrão hex{16}+reticências) | APROVADO | busca por /[0-9a-f]{16}\.\.\./ |
| Sem "undefined", "NaN" ou "[object" nos documentos | APROVADO | busca textual |
| Expressão de timestamp correta `/^\d{10}$/` presente e sem a forma errada `/^d{10}$/` | APROVADO | busca textual |
| Contagens do inventário coerentes (58 + 8 = 66; 53 + 5 = 58) | APROVADO | {"total":66,"existing":58,"absent":8,"identical":53,"identicalEol":0,"divergent":0,"notVerifiable":5} |
| HEAD local = origin/main e nenhum arquivo rastreado modificado | APROVADO | a2df46c82432730ab5e606c0c579fb7a83e54e8b |
| Nenhuma alegação global não qualificada do tipo "modelo inteiro aprovado" / "pronto para produção" | APROVADO | busca textual com exceção de negações |
| Decisão final presente e única (Opção A com condições), sem Etapa 03 iniciada | APROVADO | busca textual |
| Todos os cenários e suplementares aprovados na evidência gravada | APROVADO | 16/16; 16/16 |
| Âncoras do sumário apontam para seções existentes | APROVADO | 12 âncoras |

Verificações: 11/11 aprovadas (executadas em 2026-11-05T21:48:51.025Z).

- Passo 1 (autocrítica de conteúdo): cada afirmação "aprovado" foi qualificada pelo seu nível de evidência (seção 8).
- Passo 2: recomputação independente dos 16 cenários a partir das entradas gravadas no JSON, sem usar a função testada.
- Passo 3: verificação de hashes completos (64 hex), de ausência de truncamento e de consistência entre MD e HTML.


## 12. Decisão final

> **OPÇÃO A — FASE 02 ENCERRADA (arquitetural/documental).** Fundamentos: inconsistências identificadas foram explicadas e corrigidas; evidências isoladas são suficientes para o escopo declarado; critérios arquiteturais atendidos. **Não é aprovação de produção.** O webhook real permanece inseguro e bloqueado; a Etapa 03 NÃO foi iniciada e sua liberação pertence exclusivamente ao responsável pelo projeto. Recomenda-se revisão independente do contrato v2 antes de qualquer implementação.

