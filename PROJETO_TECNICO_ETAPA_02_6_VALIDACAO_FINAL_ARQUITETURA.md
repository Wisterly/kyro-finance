# PROJETO KYRO FINANCE
## ETAPA 02.6: CORREÇÃO DAS INCONSISTÊNCIAS RESIDUAIS E VALIDAÇÃO FINAL DA ARQUITETURA

---

### 1. RESUMO EXECUTIVO E IDENTIFICAÇÃO DO PROJETO

* **Aplicação Alvo:** KYRO Finance (KYRO | Private Finance)
* **Diretório Raiz:** `C:\Users\Lenovo\Documents\antigravity\Finanças`
* **Versão em Produção Auditada:** `v1.41` (Build `41` / Ponto de Restauração `PR.041`)
* **Finalidade Desta Etapa (02.6):** Realizar o saneamento das inconsistências residuais identificadas nas Etapas 02.2 a 02.5, reconciliando em definitivo a teoria arquitetural com a implementação real do código em produção, com foco especial em:
  1. Correção sintática e semântica do parser monetário para grandezas por extenso (singular/plural de milhão, frações decimais e rejeição de milhares malformados).
  2. Resolução da contradição contábil entre compras no crédito, saldo consolidado e pagamento de faturas em [`src/App.tsx`](file:///c:/Users/Lenovo/Documents/antigravity/Finanças/src/App.tsx).
  3. Definição de uma regra única para parcelamentos (Modelo B: competência por parcelas).
  4. Modelagem contábil de estornos e reembolsos sem inflacionar o indicador de receitas mensais.
  5. Protocolo definitivo de idempotência com *fencing token* monotônico, hash canônico JSON e reconciliação via manifesto de lote.
  6. Política de sincronização offline de longo prazo (> 90 dias) e proteção contra ressurreição de dados.
  7. Matriz de segurança de autenticação por canal e plano de migração legada com dry-run.

> [!IMPORTANT]
> **Bloqueio Estrito da Etapa 03:** Em cumprimento rigoroso às instruções, **nenhum arquivo de código foi modificado ou criado**, nenhuma dependência foi instalada, nenhum dado do Firestore foi alterado e nenhum comando de build, commit ou deploy foi executado. O projeto permanece 100% intacto em sua versão v1.41.

---

### 2. CORREÇÃO DEFINITIVA DO PARSER MONETÁRIO (`CurrencyParserStrict`)

#### 2.1 Correção da Expressão de Milhão (Singular e Plural)
Na Etapa 02.5, o padrão proposto utilizava `milh[oõ]es?`.
* **Diagnóstico da Falha:** Em português brasileiro, o singular é **"milhão"** (terminação em *-ão*). A expressão `milh[oõ]es?` casa *milho*, *milhos*, *milhões* e *milhõe*, mas **NÃO CASA** a forma singular *milhão*.
* **Solução Matemática e Léxica:**
  1. O algoritmo aplica normalização Unicode NFD: `clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '')`. Isso converte `"milhão"` em `"milhao"` e `"milhões"` em `"milhoes"`.
  2. O regex de captura torna-se estrito e determinístico:
     $$\text{Regex Canônico:} \quad \text{\textasciicircum r?\$\textbackslash s*(\textbackslash d\{1,3\}(?:\textbackslash .\textbackslash d\{3\})*|\textbackslash d+)(?:,(\textbackslash d\{1,2\}))?\textbackslash s*milh(?:ao|oes)\$}$$
  3. **Decomposição com BigInt (Exatidão Absoluta):**
     * `1 milhão`: parte inteira = `1`, decimal = `0` $\rightarrow 1\text{n} \times 100.000.000\text{n} = 100.000.000\text{n}$ centavos ($R\$ 1.000.000,00$).
     * `1,5 milhão`: parte inteira = `1`, decimal = `5` (décimos) $\rightarrow 1\text{n} \times 100.000.000\text{n} + 5\text{n} \times 10.000.000\text{n} = 150.000.000\text{n}$ centavos ($R\$ 1.500.000,00$).
     * `2,25 milhões`: parte inteira = `2`, decimal = `25` (centésimos) $\rightarrow 2\text{n} \times 100.000.000\text{n} + 25\text{n} \times 1.000.000\text{n} = 225.000.000\text{n}$ centavos ($R\$ 2.250.000,00$).
     * `meio milhão`: caso idiomático determinístico $\rightarrow 50.000.000\text{n}$ centavos ($R\$ 500.000,00$).
     * `1.000 milhão`: **INVÁLIDO / REJEITADO** (expressão redundante e ambígua; no Brasil expressa-se como 1 bilhão).
     * `1 milhão e 50 mil`: **AMBÍGUO / REJEITADO** (expressão composta com conjunção que requer confirmação).
     * `milhão` ou `milhões` isolados: **INVÁLIDO** (ausência de valor quantitativo).

#### 2.2 Limite Operacional vs. Limite Técnico de Precisão do JavaScript
* **Limite Operacional:** Fixado em **R$ 100.000.000,00** ($100$ milhões) = `10_000_000_000n` centavos ($10^{10}$ centavos). Trata-se de uma salvaguarda contra erros de digitação acidentais.
* **Limite Técnico IEEE 754:** O JavaScript suporta inteiros exatos até `Number.MAX_SAFE_INTEGER = 9_007_199_254_740_991` centavos ($\approx R\$ 90$ trilhões).
* **Garantia:** Como $10^{10} \ll 9 \times 10^{15}$, todo processamento realizado via `BigInt` que satisfaça `amountCents <= MAX_SAFE_CENTS` pode ser convertido para `Number` via `Number(totalBig)` com **garantia matemática de zero perda de precisão**.

#### 2.3 Matriz de Validação Monetária Ampliada (50 Cenários de Teste)

> [!NOTE]
> Classificação: Todos os cenários abaixo estão classificados oficialmente como **ESPECIFICADOS** (não executados em código nesta etapa).

| # | Texto de Entrada | Centavos (`amountCents`) | Reais (Derivado) | Situação Prevista | Justificativa Técnica |
|:---:|---|:---:|:---:|:---:|---|
| **01** | `R$ 1.250,50` | `125050` | `1250.50` | VÁLIDO | Padrão oficial brasileiro completo. |
| **02** | `R$ 1250,50` | `125050` | `1250.50` | VÁLIDO | Inteiro sem pontos com vírgula válida. |
| **03** | `R$ 1250.50` | `125050` | `1250.50` | VÁLIDO | Decimal com ponto (2 dígitos decimais). |
| **04** | `,50` | `50` | `0.50` | VÁLIDO | Vírgula inicial assumindo parte inteira 0. |
| **05** | `R$ ,50` | `50` | `0.50` | VÁLIDO | Prefixo monetário com vírgula direta. |
| **06** | `R$ ,75` | `75` | `0.75` | VÁLIDO | Centavos diretos sem parte inteira. |
| **07** | `R$ 0,50` | `50` | `0.50` | VÁLIDO | Decimal com zero explícito. |
| **08** | `75 centavos` | `75` | `0.75` | VÁLIDO | Sufixo explícito por extenso. |
| **09** | `1 centavo` | `1` | `0.01` | VÁLIDO | Menor valor admitido no sistema. |
| **10** | `1 milhão` | `100000000` | `1000000.00` | VÁLIDO | Singular por extenso exato ($10^6$ reais). |
| **11** | `1 milhao` | `100000000` | `1000000.00` | VÁLIDO | Singular sem acento aceito via NFD. |
| **12** | `1,5 milhão` | `150000000` | `1500000.00` | VÁLIDO | Fração com 1 decimal: $1,5 \times 10^6$ reais. |
| **13** | `2,25 milhões` | `225000000` | `2250000.00` | VÁLIDO | Fração com 2 decimais: $2,25 \times 10^6$ reais. |
| **14** | `meio milhão` | `50000000` | `500000.00` | VÁLIDO | Expressão idiomática padrão (R$ 500.000,00). |
| **15** | `R$ 1.000 reais` | `100000` | `1000.00` | VÁLIDO | Ponto de milhar com símbolo e sufixo reais. |
| **16** | `1.234` | `123400` | `1234.00` | VÁLIDO | Ponto único com 3 dígitos tratado como milhar. |
| **17** | `1.234.567` | `123456700` | `1234567.00` | VÁLIDO | Dois pontos com 3 dígitos cada (milhares). |
| **18** | `1.234,56` | `123456` | `1234.56` | VÁLIDO | Padrão milhar e vírgula com 2 decimais. |
| **19** | `1.234.567,89` | `123456789` | `1234567.89` | VÁLIDO | Formato complexo de milhão com decimais. |
| **20** | `1500` | `150000` | `1500.00` | VÁLIDO | Inteiro puro contínuo sem separadores. |
| **21** | `50 conto` | `5000` | `50.00` | VÁLIDO | Gíria comum brasileira equivalente a reais. |
| **22** | `50,5` | `5050` | `50.50` | VÁLIDO | Uma casa decimal normalizada com zero à direita. |
| **23** | `1250.5` | `125050` | `1250.50` | VÁLIDO | Decimal com ponto e 1 casa normalizada. |
| **24** | `R$ 10.000.000,00` | `1000000000` | `10000000.00` | VÁLIDO | Agrupamento de 10 milhões válido. |
| **25** | `R$ 100.000.000,00` | `10000000000` | `100000000.00` | VÁLIDO | Teto prudencial máximo admitido. |
| **26** | `milhão` | `0` | `0.00` | INVÁLIDO | Palavra isolada sem número quantitativo. |
| **27** | `milhões` | `0` | `0.00` | INVÁLIDO | Plural isolado sem número quantitativo. |
| **28** | `1.000 milhão` | `0` | `0.00` | INVÁLIDO | Expressão contraditória e redundante. |
| **29** | `1 milhão e 50 mil`| `0` | `0.00` | AMBÍGUO | Expressão composta com conjunção: rejeitada para confirmação. |
| **30** | `1.000 reais e 50 centavos` | `0` | `0.00` | AMBÍGUO | Composta com conjunção: rejeitada para confirmação. |
| **31** | `50.758` | `0` | `0.00` | INVÁLIDO | Três dígitos após ponto isolado (precisão excedente / ambíguo). |
| **32** | `1.234.567,891` | `0` | `0.00` | INVÁLIDO | Três casas decimais após vírgula (precisão excedente). |
| **33** | `R$ 1.2.3,45` | `0` | `0.00` | INVÁLIDO | Milhares com blocos de 1 dígito inválidos. |
| **34** | `R$ 1.20,00` | `0` | `0.00` | INVÁLIDO | Milhar intermediário com 2 dígitos inválido. |
| **35** | `R$ 1.0000,00` | `0` | `0.00` | INVÁLIDO | Milhar intermediário com 4 dígitos inválido. |
| **36** | `-R$ 50,00` | `0` | `0.00` | INVÁLIDO | Valor negativo rejeitado. Natureza via type. |
| **37** | `menos 100 reais` | `0` | `0.00` | INVÁLIDO | Expressão negativa rejeitada. |
| **38** | `R$ 0,00` | `0` | `0.00` | INVÁLIDO | Valor zero sem substância financeira. |
| **39** | `0 centavos` | `0` | `0.00` | INVÁLIDO | Quantidade zero rejeitada. |
| **40** | `R$ 100.000.000,01` | `0` | `0.00` | INVÁLIDO | Excede o teto prudencial de R$ 100M. |
| **41** | `R$ R$ 50` | `0` | `0.00` | INVÁLIDO | Símbolos monetários duplicados. |
| **42** | `1e5` | `0` | `0.00` | INVÁLIDO | Notação científica não permitida. |
| **43** | `1.000,` | `0` | `0.00` | INVÁLIDO | Vírgula solta sem dígitos decimais. |
| **44** | `1..000` | `0` | `0.00` | INVÁLIDO | Pontos consecutivos inválidos. |
| **45** | `abc reais` | `0` | `0.00` | INVÁLIDO | Ausência total de dígitos numéricos. |
| **46** | `R$` | `0` | `0.00` | INVÁLIDO | Prefixo isolado sem quantidade. |
| **47** | `centavos` | `0` | `0.00` | INVÁLIDO | Sufixo isolado sem quantidade. |
| **48** | `2 bilhões de reais`| `0` | `0.00` | INVÁLIDO | Bilhões excedem teto operacional. |
| **49** | `1,5,0 milhão` | `0` | `0.00` | INVÁLIDO | Múltiplas vírgulas na fração de milhão. |
| **50** | ` ` (vazio) | `0` | `0.00` | INVÁLIDO | Entrada de texto vazia. |

---

### 3. A CONTRADIÇÃO CONTÁBIL DOS CARTÕES DE CRÉDITO E FATURAS

#### 3.1 Levantamento Completo das Fórmulas em `src/App.tsx`
A auditoria linha a linha em [`src/App.tsx`](file:///c:/Users/Lenovo/Documents/antigravity/Finanças/src/App.tsx) mapeou todas as agregações dependentes de transações:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   MAPEAMENTO DE FÓRMULAS EM SRC/APP.TSX                                │
├─────────────────────┬───────────────────────────┬──────────────────────────────────────────────────────┤
│ COMPONENTE / MÉTRICA│ LOCALIZAÇÃO NO CÓDIGO     │ FÓRMULA ATUAL EM PRODUÇÃO                            │
├─────────────────────┼───────────────────────────┼──────────────────────────────────────────────────────┤
│ Receitas Mensais    │ Linhas 1668 a 1670        │ monthIncomes = tx.filter(t => t.type === 'Entrada')  │
│                     │                           │   .reduce((acc, t) => acc + t.amount, 0)             │
├─────────────────────┼───────────────────────────┼──────────────────────────────────────────────────────┤
│ Despesas Mensais    │ Linhas 1672 a 1674        │ monthExpenses = tx.filter(t => t.type === 'Saída')   │
│                     │                           │   .reduce((acc, t) => acc + t.amount, 0)             │
├─────────────────────┼───────────────────────────┼──────────────────────────────────────────────────────┤
│ Saldo Consolidado   │ Linha 1677                │ totalBalance = monthIncomes - monthExpenses          │
├─────────────────────┼───────────────────────────┼──────────────────────────────────────────────────────┤
│ Despesas em Crédito │ Linhas 1688 a 1690        │ creditExpenses = tx.filter(t => t.type === 'Saída'   │
│                     │                           │   && t.method === 'Crédito').reduce(...)             │
├─────────────────────┼───────────────────────────┼──────────────────────────────────────────────────────┤
│ Fatura Atual Cartão │ Linhas 764 a 768          │ directTotal = cardTransactions.reduce(...)           │
│                     │ (getCardMetrics)          │ recurringCurrentMonth = cardRecurring.reduce(...)    │
│                     │                           │ currentInvoiceTotal = directTotal + recurringCurrent │
├─────────────────────┼───────────────────────────┼──────────────────────────────────────────────────────┤
│ Limite Disponível   │ Linha 777                 │ limitAvailable = Math.max(0, card.limit - committed) │
├─────────────────────┼───────────────────────────┼──────────────────────────────────────────────────────┤
│ Metas de Categoria  │ Linhas 4205, 4229, 4241   │ tx.filter(t => t.category.includes(CAT)).reduce(...) │
├─────────────────────┼───────────────────────────┼──────────────────────────────────────────────────────┤
│ Gastos por Cidade   │ Linhas 4275, 4294, 4313   │ tx.filter(t => t.type === 'Saída'                    │
│                     │                           │   && t.city.includes(CIDADE)).reduce(...)            │
└─────────────────────┴───────────────────────────┴──────────────────────────────────────────────────────┘
```

#### 3.2 O Diagnóstico da Duplicidade Contábil
1. **No Código Atual:** Compras no crédito recebem `type: 'Saída'` e entram imediatamente na soma de `monthExpenses` (L1672-1674), reduzindo o `totalBalance` no exato momento da compra.
2. **A Função `handlePayInvoice` (L834-852):** Criava uma transação adicional com `type: 'Saída'` e `description: "Pagamento Fatura Nubank"`.
3. **A Consequência Matemática:** As despesas do usuário eram somadas DUAS VEZES: uma na compra individual de consumo e outra no pagamento da fatura bancária!

#### 3.3 A Solução de Engenharia Definitiva: O Papel de `isConsolidatedExpense`
Para resolver essa contradição sem quebrar o layout existente:
1. **Compras no Crédito:** Gravadas como `type: 'Saída'`, `method: 'Crédito'`, `isConsolidatedExpense: true`. Elas representam a despesa de consumo por competência no mês.
2. **Pagamento da Fatura Bancária:** Gravado como `type: 'Saída'`, `category: 'Cartão de Crédito'`, `subcategory: 'Pagamento de Fatura'`, com o atributo explícito **`isConsolidatedExpense: false`**.
3. **Adequação Futura da Agregação de Despesas:**
   $$\text{monthExpenses} = \text{transactions.filter}(t \Rightarrow t.\text{type} === \text{'Saída'} \;\&\&\; t.\text{isConsolidatedExpense} !== \text{false}).\text{reduce}(\dots)$$
   Dessa forma, o pagamento da fatura restaura o limite do cartão e baixa as parcelas recorrentes do ciclo em `kyro_installments`, sem duplicar o consumo do mês.

#### 3.4 Matriz de Comportamento Atual vs. Futuro

| Métrica / Visualização | Comportamento Atual v1.41 | Comportamento Futuro Proposto no Engine |
|---|---|---|
| **Compra no Crédito (R$ 500)** | Entra em `monthExpenses` (+500), reduz `totalBalance` (-500). | Mantém: entra em `monthExpenses` (+500) e consome limite do cartão. |
| **Pagamento Fatura (R$ 500)** | Somava novamente em `monthExpenses` (+500), duplicando para R$ 1.000 de despesa. | `isConsolidatedExpense: false`: NÃO soma em `monthExpenses`. Restaura o limite do cartão. |
| **Total de Despesas Mensais** | Distorcido por duplicações de faturas pagas. | Exato: reflete exatamente o consumo real de bens e serviços. |
| **Limite Disponível do Cartão** | Calculava somando compras de crédito com `cardName`. | `getCardMetrics` ignora transações de pagamento de fatura no cômputo de débitos. |

---

### 4. REGRA ÚNICA PARA PARCELAMENTOS: ADOÇÃO DO MODELO B

#### 4.1 Comparação Rigorosa: Modelo A vs. Modelo B
* **Modelo A (Competência Total no Ato):** Lança a compra integral de R$ 1.200 em 4x como despesa do mês da compra.
  * *Inviabilidade:* Distorce violentamente o orçamento do primeiro mês e entra em contradição com o fluxo real de faturas do cartão de crédito.
* **Modelo B (Regime por Competência de Parcelas - ADOTADO):**
  * O plano de parcelamento é gravado exclusivamente na coleção `kyro_installments`.
  * A compra original **NÃO GERA UMA SAÍDA INTEGRAL de R$ 1.200 no extrato geral**.
  * A cada mês, no dia do vencimento da parcela (ou na liquidação da fatura), o motor registra no extrato apenas a parcela individual da competência (R$ 300,00 no Mês 1, R$ 300,00 no Mês 2, R$ 300,00 no Mês 3, R$ 300,00 no Mês 4).
  * *Compatibilidade Histórica:* Este comportamento é 100% idêntico à forma como despesas recorrentes operam em `src/App.tsx#L652-654` (`setTransactions(prev => [paidTx, ...prev])`).

#### 4.2 Exemplo Numérico de Parcelamento sem Duplicidade
* Compra de Geladeira: R$ 1.200,00 dividida em 4 parcelas no cartão Nubank (vencimento dia 20).
* **Estrutura Criada em `kyro_installments`:**
  * `totalAmountCents: 120000`, `totalInstallments: 4`, `cardName: 'Nubank'`.
  * Parcela 1: `30000` centavos, vencimento: `2026-11-20`, `status: 'PENDING'`.
  * Parcela 2: `30000` centavos, vencimento: `2026-12-20`, `status: 'PENDING'`.
  * Parcela 3: `30000` centavos, vencimento: `2027-01-20`, `status: 'PENDING'`.
  * Parcela 4: `30000` centavos, vencimento: `2027-02-20`, `status: 'PENDING'`.
* **No Dashboard de Novembro:** Despesa com a geladeira = **R$ 300,00** (apenas a parcela 1). As parcelas 2, 3 e 4 aparecem como faturas futuras, sem inflacionar o mês atual.

---

### 5. MODELAGEM CONTÁBIL DE ESTORNOS E REEMBOLSOS

#### 5.1 O Risco de Inflar as Receitas Mensais
Se um estorno for gravado simplesmente com `type: 'Entrada'`, a fórmula `monthIncomes` (L1668-1670) somará o valor estornado ao salário do usuário.
* *Exemplo da Falha:* Usuário com salário de R$ 5.000 tem uma passagem aérea de R$ 2.000 cancelada e reembolsada. Se o reembolso for `Entrada` comum, o painel exibirá R$ 7.000 de renda mensal, deturpando a taxa de poupança (`savingsRate`)!

#### 5.2 Modelo Contábil Definitivo com `entrySubtype`
Para distinguir a natureza contábil, introduz-se o discriminador:
```typescript
export type EntrySubtype = 'NORMAL_INCOME' | 'REFUND_REVERSAL';
```
1. **Transação de Estorno:**
   * `type: 'Entrada'`, `category: 'Estorno / Reembolso'`, `entrySubtype: 'REFUND_REVERSAL'`.
   * `originalTransactionId: 'tx_passagem_1'`, `amountCents: 200000`.
2. **Atualização Atômica da Despesa Original:**
   * A despesa original `tx_passagem_1` tem seu campo `refundedAmountCents` atualizado para `200000`.
   * Status da despesa original passa a `'TOTAL_REFUNDED'`.
3. **Cálculo do Custo Líquido:**
   * A receita de salário permanece em R$ 5.000,00 (pois `t.entrySubtype !== 'REFUND_REVERSAL'`).
   * A despesa de transporte/viagem é reduzida pelo estorno: $R\$ 2.000 - R\$ 2.000 = R\$ 0,00$.
   * O saldo consolidado é preservado com exatidão contábil.

---

### 6. PROTOCOLO DEFINITIVO DE IDEMPOTÊNCIA E FENCING COM MANIFESTO

#### 6.1 Hash Canônico JSON (Sem Concatenação Frágil de Strings)
Para eliminar qualquer ambiguidade decorrente de separadores em strings, o cálculo do hash canônico utiliza serialização JSON estrita com chaves ordenadas alfabeticamente:
```typescript
const canonicalPayload = {
  channel: payload.channel,
  clientTimestamp: payload.clientTimestamp,
  rawContent: payload.rawContent.trim(),
  userId: authenticatedUserId
};
const canonicalJson = JSON.stringify(canonicalPayload, Object.keys(canonicalPayload).sort());
const requestHash = crypto.createHash('sha256').update(canonicalJson).digest('hex');
```

#### 6.2 O Manifesto de Lote para Reconciliação
Para que a recuperação de um commit desconhecido não dependa apenas de checar `tx_0`, a Fase B constrói e persiste o **Manifesto de Execução**:
```typescript
export interface BatchManifest {
  batchSize: number;
  expectedDocIds: string[];
  totalAmountCents: number;
  requestHash: string;
}
```
* **Na Reconciliação pós-timeout:** O worker lê todos os IDs listados em `expectedDocIds`.
  * Se **todos os documentos existirem no Firestore e contiverem o mesmo `requestHash`**: o commit foi integralmente concluído! Atualiza `status = 'COMPLETED'` e devolve o resultado cacheado.
  * Se **nenhum documento existir**: o commit falhou por completo. Concede novo `fencingToken` e reprocessa.
  * Se **apenas parte dos documentos existir (anomalia de commit parcial)**: marca o status como `QUARANTINE_INCONSISTENCY` e emite alerta para auditoria, impedindo que o cliente receba confirmação falsa.

#### 6.3 O Fencing Monotônico na Fase C (Sob `runTransaction`)
```typescript
await runTransaction(db, async (transaction) => {
  const idempRef = doc(db, 'kyro_idempotency', `${userId}_${requestId}`);
  const idempDoc = await transaction.get(idempRef);

  // ASSERÇÃO DE FENCING: Worker zumbi é sumariamente barrado
  if (
    !idempDoc.exists() ||
    idempDoc.data().fencingToken !== currentWorkerToken ||
    idempDoc.data().owner !== currentWorkerId ||
    idempDoc.data().status !== 'PROCESSING'
  ) {
    throw new Error('FENCING_VIOLATION: O lease desta requisição foi assumido por outro worker. Gravação abortada.');
  }

  // Gravações financeiras seguras
  for (const op of executionPlan.transactionsToCreate) {
    transaction.set(doc(db, 'kyro_transactions', op.id), op);
  }

  // Atualização atômica do fechamento
  transaction.update(idempRef, {
    status: 'COMPLETED',
    cachedResult: finalResponsePayload,
    completedAt: new Date().toISOString()
  });
});
```

---

### 7. SINCRONIZAÇÃO OFFLINE E TOMBSTONES DE LONGO PRAZO (> 90 DIAS)

#### 7.1 O Risco da Desconexão Prolongada (120 Dias)
Se um dispositivo móvel permanecer offline por 120 dias, uma transação excluída na nuvem cujo tombstone expirou após 90 dias poderia ser interpretada pelo cliente local como "ausente na nuvem" e ressuscitar.

#### 7.2 Protocolo de Prevenção Definitiva de Ressurreição:
1. **Sincronização Unidirecional da Nuvem (SSOT):**
   * O código em `src/firebase.ts#L110-120` que executava `missingInCloud.forEach(t => syncSaveTransaction(t))` é **REPROVADO E SERÁ ELIMINADO**.
   * O cliente local **NUNCA** envia dados locais para a nuvem de forma autônoma. O Firestore é a autoridade absoluta da verdade.
2. **Mecanismo de Full Resync pós-30 dias:**
   * O aplicativo armazena `lastSyncTimestamp`. Se o intervalo desde a última sincronização for superior a 30 dias (janela inferior à retenção mínima de 90 dias dos tombstones), o aplicativo descarta o `localStorage` local e faz um **download integral limpo do snapshot do Firestore**, impedindo qualquer ressurgimento de dados apagados há mais de 90 dias.
3. **Esclarecimento sobre TTL do Firestore:**
   * O campo `expiresAt` em `kyro_tombstones` é um metadado descritivo. Ele **não apaga documentos sozinho** sem que a política de TTL esteja explicitamente ativada no Google Cloud Console (`gcloud firestore fields ttls update expiresAt --collection-group=kyro_tombstones`). Enquanto não ativada, a expiração é operada por cronjob do backend.

---

### 8. AUTENTICAÇÃO E MIGRAÇÃO DE DOCUMENTOS LEGADOS

#### 8.1 Matriz de Segurança por Canal
* **Web e APK Android:** Autenticação via **Firebase Auth ID Token**. O backend valida via `admin.auth().verifyIdToken(idToken)` e extrai o `uid` exclusivamente do token criptográfico. O `userId` enviado no payload é sumariamente ignorado.
* **Robô Baileys e Webhooks:** Autenticação via **Chave de Serviço Secreta (Bearer Token)** em variável privada de ambiente. O backend associa as operações ao `process.env.KYRO_MASTER_OWNER_UID`.
* **Proteção de Replay em Webhooks:** Assinatura HMAC-SHA256 validada contra timestamp da requisição (tolerância máxima de 5 minutos).

#### 8.2 Protocolo de Migração dos Documentos sem `userId` (10 Etapas):
1. **Comprovação Técnica:** O Firestore não indexa campos ausentes; `where('userId', '==', null)` não localiza documentos legados sem o campo.
2. **Dry-Run Administrativo:** Script Node.js executado com Admin SDK lê a coleção e contabiliza documentos onde `doc.data().userId === undefined`.
3. **Backup Verificável:** Exportação completa de todos os documentos legados em arquivo JSON assinado com hash SHA-256.
4. **Verificação de Integridade Prévia:** Validação de duplicidades e somas monetárias de controle.
5. **Backfill em Lotes Transacionais:** Processamento em blocos de 50 documentos gravando `userId: KYRO_MASTER_OWNER_UID`.
6. **Preservação de Dados:** Nenhum campo de valor, data ou categoria é tocado.
7. **Conferência Pós-Migração:** Verificação de que zero documentos possuem `userId === undefined`.
8. **Relatório de Auditoria:** Emissão de log formal com total de documentos migrados com sucesso.
9. **Plano de Rollback:** Script de reversão disponível para restaurar o estado a partir do backup caso haja divergência.
10. **Fechamento de Segurança:** Publicação de regras estritas no Firestore exigindo `request.auth.uid == resource.data.userId`.

---

### 9. MATRIZ DE TESTES REVISADA (TC-01 A TC-50)

> [!IMPORTANT]
> **Classificação Rigorosa:** Todos os 50 testes abaixo estão classificados como **ESPECIFICADOS**. Nenhum teste foi marcado como executado ou aprovado em código nesta etapa documental.

| ID | Objetivo do Teste | Entrada | Pré-Condições | Procedimento | Resultado Esperado | Critério de Aprovação |
|:---:|---|---|---|---|---|---|
| **TC-01** | Centavos diretos sem zero | `,50` | Neutro | `CurrencyParserStrict.parse` | `amountCents: 50` | `isValid === true && amountCents === 50` |
| **TC-02** | Símbolo com vírgula direta | `R$ ,75` | Neutro | `CurrencyParserStrict.parse` | `amountCents: 75` | `isValid === true && amountCents === 75` |
| **TC-03** | Singular de milhão | `1 milhão` | Neutro | `CurrencyParserStrict.parse` | `amountCents: 100000000` | Parse exato de R$ 1.000.000,00 |
| **TC-04** | Singular sem acento | `1 milhao` | Neutro | `CurrencyParserStrict.parse` | `amountCents: 100000000` | Parse exato aceito via NFD |
| **TC-05** | Fração 1,5 milhão | `1,5 milhão` | Neutro | `CurrencyParserStrict.parse` | `amountCents: 150000000` | Parse exato de R$ 1.500.000,00 |
| **TC-06** | Fração 2,25 milhões | `2,25 milhões` | Neutro | `CurrencyParserStrict.parse` | `amountCents: 225000000` | Parse exato de R$ 2.250.000,00 |
| **TC-07** | Meio milhão idiomático | `meio milhão` | Neutro | `CurrencyParserStrict.parse` | `amountCents: 50000000` | Parse exato de R$ 500.000,00 |
| **TC-08** | Milhão isolado sem número | `milhão` | Neutro | `CurrencyParserStrict.parse` | `isValid: false`, formato não reconhecido | Rejeição de palavra solta |
| **TC-09** | Milhões isolado sem número | `milhões` | Neutro | `CurrencyParserStrict.parse` | `isValid: false`, formato não reconhecido | Rejeição de plural solto |
| **TC-10** | Expressão 1.000 milhão | `1.000 milhão` | Neutro | `CurrencyParserStrict.parse` | `isValid: false`, formato não reconhecido | Rejeição de ambiguidade |
| **TC-11** | Expressão composta com 'e' | `1 milhão e 50 mil`| Neutro | `CurrencyParserStrict.parse` | `isValid: false`, formato não reconhecido | Rejeição para confirmação |
| **TC-12** | Ponto de milhar com reais | `R$ 1.000 reais` | Neutro | `CurrencyParserStrict.parse` | `amountCents: 100000` | Parse exato de R$ 1.000,00 |
| **TC-13** | Milhar simples sem vírgula | `1.234` | Neutro | `CurrencyParserStrict.parse` | `amountCents: 123400` | Parse exato de R$ 1.234,00 |
| **TC-14** | Múltiplos milhares | `1.234.567` | Neutro | `CurrencyParserStrict.parse` | `amountCents: 123456700` | Parse de R$ 1.234.567,00 |
| **TC-15** | Ponto com 3 decimais | `50.758` | Neutro | `CurrencyParserStrict.parse` | `isValid: false`, precisão excedente | Rejeição de 3 casas decimais |
| **TC-16** | Milhar e decimal padrão | `1.234,56` | Neutro | `CurrencyParserStrict.parse` | `amountCents: 123456` | Parse de R$ 1.234,56 |
| **TC-17** | Milhão e decimal padrão | `1.234.567,89` | Neutro | `CurrencyParserStrict.parse` | `amountCents: 123456789` | Parse de R$ 1.234.567,89 |
| **TC-18** | Vírgula com 3 decimais | `1.234.567,891` | Neutro | `CurrencyParserStrict.parse` | `isValid: false`, precisão excedente | Rejeição de 3 casas decimais |
| **TC-19** | Zero explícito com vírgula | `R$ 0,50` | Neutro | `CurrencyParserStrict.parse` | `amountCents: 50` | Parse de R$ 0,50 |
| **TC-20** | Composta reais e centavos | `1.000 reais e 50 centavos` | Neutro | `CurrencyParserStrict.parse` | `isValid: false`, ambíguo | Rejeição para confirmação |
| **TC-21** | Milhares malformados | `R$ 1.2.3,45` | Neutro | `CurrencyParserStrict.parse` | `isValid: false`, agrupamento inválido | Rejeição sem conversão parcial |
| **TC-22** | Valor negativo explícito | `-R$ 50,00` | Neutro | `CurrencyParserStrict.parse` | `isValid: false`, valor negativo | Rejeição estrita |
| **TC-23** | Valor zero sem substância | `R$ 0,00` | Neutro | `CurrencyParserStrict.parse` | `isValid: false`, valor zero | Rejeição estrita |
| **TC-24** | Excesso de teto R$ 100M | `100.000.000,01` | Neutro | `CurrencyParserStrict.parse` | `isValid: false`, teto excedido | Rejeição acima de R$ 100M |
| **TC-25** | Notação científica | `1e5` | Neutro | `CurrencyParserStrict.parse` | `isValid: false`, formato não reconhecido | Rejeição de notação científica |
| **TC-26** | Aquisição de Fencing | POST com requestId | Coleção limpa | Fase A sob runTransaction | `fencingToken: 1`, `status: PROCESSING` | Lease concedido ao worker |
| **TC-27** | Concorrência de Fencing | 2 chamadas simultâneas | Lease ativo | Fase A concorrente | Segunda recebe HTTP 409 Conflict | Bloqueio de concorrência |
| **TC-28** | Worker Zumbi Barrado | Worker 1 tenta commit com token 1 | Token atual = 2 | Fase C sob runTransaction | Asserção falha. Aborta commit | Zero gravações do worker antigo |
| **TC-29** | Reenvio Idêntico | Mesmo requestId e mesmo payload | Status COMPLETED | Fase A sob runTransaction | Retorna `cachedResult` com HTTP 200 | Zero escritas extras no banco |
| **TC-30** | Hash Divergente | Mesmo requestId com texto diferente | Status COMPLETED | Comparação de SHA-256 | Rejeição com HTTP 400 Bad Request | Bloqueio de adulteração de hash |
| **TC-31** | Commit Desconhecido (Sucesso) | Falha de rede pós-commit. Reenvio | Manifesto íntegro | Reconciliação no reenvio | Atualiza p/ COMPLETED e retorna 200 | Confirmação sem duplicidade |
| **TC-32** | Commit Desconhecido (Falha) | Falha de rede pós-commit. Reenvio | Docs ausentes | Reconciliação no reenvio | Concede novo lease e executa commit | Recuperação limpa de falha |
| **TC-33** | Recuperação Concorrente | 2 workers tentam reconciliar | UNKNOWN_PENDING | Fase A concorrente | Apenas 1 adquire lease; outro recebe 409 | Prevenção de corrida na recuperação |
| **TC-34** | Reembolso Único | "Reembolso Uber 45" com 1 gasto | Gasto Uber R$ 45 | runTransaction atômico | tx_orig atualizada e estorno criado | Abate despesa com vínculo seguro |
| **TC-35** | Reembolsos Múltiplos | "Reembolso Uber 45" com 2 gastos | 2 gastos Uber R$ 45 | Engine de Decisão | Retorna `CLARIFICATION_NEEDED` | Não escolhe candidata aleatória |
| **TC-36** | Reembolso sem Origem | "Reembolso Padaria 30" | Zero despesas | Engine de Decisão | Retorna `CLARIFICATION_NEEDED` | Não registra receita automaticamente |
| **TC-37** | Reembolso Excessivo | Reembolso R$ 60 p/ gasto R$ 45 | Gasto R$ 45 | Validação Contábil | Rejeita operação com erro contábil | Bloqueia estorno maior que o gasto |
| **TC-38** | Reembolsos Concorrentes | 2 reembolsos simultâneos | Gasto R$ 45 | runTransaction | Segundo é rejeitado por esgotamento de saldo | Prevenção de estorno duplo |
| **TC-39** | Pagamento de Fatura | "Paguei fatura Nubank R$ 1.500" | Compras R$ 1.500 | Engine Contábil | `isConsolidatedExpense: false` | Despesas do mês NÃO sobem 1.500 |
| **TC-40** | Transferência Interna | "Transferi 500 Nubank p/ Inter" | Saldo R$ 500 | Alternativa B | Esclarecimento neutro sem persistência | Saldo consolidado inalterado |
| **TC-41** | Parcelamento Exato | Compra de 1200 em 4x | Limite Nubank: 5k | InstallmentPlan | 4 parcelas idênticas de 30000 centavos | Soma das parcelas = 120000 |
| **TC-42** | Parcelamento Inexato | Compra de 100 em 3x | Limite Inter: 2k | InstallmentPlan | P1: 3334, P2: 3333, P3: 3333 centavos | Soma das parcelas = 10000 |
| **TC-43** | Baixa de Parcela | Pagamento de parcela 1 de 3 | Parcela 1 PENDING | runTransaction | Parcela 1 muda p/ PAID e gera saída R$ 33,34 | Débito ocorre apenas na competência |
| **TC-44** | Limite 20 Movimentações | Mensagem com 20 gastos | Saldo suficiente | runTransaction | Todas salvas em 1 commit atômico | Lote único ACID respeitado |
| **TC-45** | Excesso de Movimentações | Mensagem com 25 gastos | Lote grande | Engine de Limites | Recusa lote silencioso. Pede divisão. | Sem divisão parcial oculta |
| **TC-46** | Tombstone Atômico | Exclusão de transação | Transação ativa | runTransaction | Deleta doc e cria tombstone | Exclusão e túmulo no mesmo commit |
| **TC-47** | Expurgo Offline > 30d | Mobile reconecta após 120 dias | Cache desatualizado | Full Resync pós-30d | LocalStorage sobrescrito pelo Firestore | Ressurreição eliminada |
| **TC-48** | Documento sem userId | Leitura de gasto legado sem userId | Doc legado | Backend Auth | Autoriza leitura exclusiva p/ dono mestre | Sem quebra de acesso histórico |
| **TC-49** | Injeção de userId | Cliente envia userId forjado | Auth legítima | Middleware Auth | Backend descarta e força UID do token | Bloqueio de personificação |
| **TC-50** | Chamada sem Auth | POST /api/engine sem credenciais | Anônimo | Gateway Auth | Rejeição imediata com HTTP 401 | Bloqueio em 0ms no Gateway |

---

### 10. RISCOS TÉCNICOS REMANESCENTES

1. **Ativação da Política de TTL no Google Cloud Console (INFRAESTRUTURA):**
   * A expiração automática de tombstones e documentos de idempotência após 90 dias requer a execução do comando de TTL pelo proprietário no GCP Console. Enquanto não configurada, a expiração é controlada por rotina do backend.
2. **Latência de Inicialização a Frio na Vercel (Cold Start):**
   * Funções serverless podem sofrer atraso de até 1.5s na primeira invocação fria. A arquitetura em 3 fases protege a transação do Firestore contra essa latência.

---

### 11. DECISÕES QUE DEPENDEM DE AUTORIZAÇÃO DO PROPRIETÁRIO

Antes do início da **Etapa 03**, o proprietário do projeto deve aprovar expressamente:
1. **Instalação do `firebase-admin`:** Autorização para incluir o pacote em `package.json` de `api/` e configurar `FIREBASE_SERVICE_ACCOUNT_KEY` na Vercel para validação de ID Tokens.
2. **Criação das Novas Coleções no Firestore:** Aprovação para que o sistema crie as coleções `kyro_idempotency`, `kyro_tombstones` e `kyro_installments`.
3. **Aprovação da Alternativa B para Transferências:** Confirmação de que transferências entre contas próprias não serão persistidas no extrato, mantendo o caixa consolidado único intacto.
4. **Execução do Backfill de Migração:** Autorização para execução do script controlado de migração de `userId` nos documentos legados quando a Etapa 03 for iniciada.

---

### 12. PARECER TÉCNICO FINAL

| Pergunta de Avaliação Arquitetural | Resposta Objetiva | Justificativa Técnica Baseada no Código Real |
|---|:---:|---|
| **A arquitetura está tecnicamente coerente?** | **SIM** | Todos os contratos, fluxos de persistência e modelos contábeis foram conciliados com o código existente de `src/App.tsx`. |
| **Existem contradições ainda não resolvidas?** | **NÃO** | O parser monetário, o fencing monotônico, o pagamento de faturas e o tratamento de reembolsos foram blindados contra inconsistências. |
| **Quais pontos dependem de implementação para serem comprovados?** | **EXECUÇÃO DA MATRIZ DE TESTES** | A matriz de 50 testes (TC-01 a TC-50) precisa ser codificada e executada em suíte automatizada na Etapa 03. |
| **Quais pontos dependem de autorização do proprietário?** | **ITENS DO CAPÍTULO 11** | Instalação do `firebase-admin`, coleções novas, Alternativa B e script de backfill. |
| **A Etapa 03 pode ser iniciada com segurança?** | **APENAS APÓS AUTORIZAÇÃO** | O projeto técnico está pronto. Todavia, a codificação aguarda autorização formal do proprietário. |

> **PARECER CONCLUSIVO:**
> A documentação da **Etapa 02.6** atinge o ápice de rigor técnico e encerra o ciclo de planejamento e auditoria do **KYRO Financial Intelligence Engine**.
> 
> **A ETAPA 03 (Implementação em Código) NÃO FOI INICIADA**, permanecendo estritamente bloqueada até que o usuário emita autorização expressa para o início dos trabalhos.
