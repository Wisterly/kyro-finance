/**
 * KYRO FINANCE | BATERIA DE TESTES DETERMINÍSTICOS DO NÚCLEO CONTÁBIL (03.2)
 * Validação exaustiva de Money, Calendar, Ledger e Reports.
 */

import { parseToCents, formatCentsToBRL, add, sub, splitCents, toWire, fromWire } from './money';
import {
  CANONICAL_TIMEZONE,
  getFortalezaParts,
  getISODateFortaleza,
  getStartOfDayFortaleza,
  getEndOfDayFortaleza,
  isSameDayFortaleza,
  resolveRelativeDate
} from './calendar';
import { LedgerEngine } from './ledger';
import { ReportsEngine } from './reports';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, desc: string) {
  totalTests++;
  if (!condition) {
    console.error(`✗ FALHA: ${desc}`);
    throw new Error(`Falha na asserção: ${desc}`);
  }
  passedTests++;
  console.log(`  ✓ [TESTE ${totalTests.toString().padStart(2, '0')}] ${desc}`);
}

console.log('=== INICIANDO BATERIA DE TESTES DO ENGINE CONTÁBIL (ETAPA 03.2) ===\n');

// ============================================================================
// 1. TESTES DO MONEY ENGINE
// ============================================================================
console.log('[1/4] Testes do Money Engine (Aritmética em Centavos BigInt)...');

// 1. Parsing de formatos monetários diversos
assert(parseToCents('R$ 1.250,50') === 125050n, 'Parsing correto de padrão brasileiro com símbolo: "R$ 1.250,50" -> 125050n');
assert(parseToCents('10,05') === 1005n, 'Parsing correto de decimal com vírgula: "10,05" -> 1005n');
assert(parseToCents('10.05') === 1005n, 'Parsing correto de decimal com ponto: "10.05" -> 1005n');
assert(parseToCents('150') === 15000n, 'Parsing de valor inteiro sem decimal: "150" -> 15000n');
assert(parseToCents(250.75) === 25075n, 'Parsing de float sem perda de precisão: 250.75 -> 25075n');
assert(parseToCents('-50,20') === -5020n, 'Parsing de valor negativo: "-50,20" -> -5020n');

// 2. Formatação determinística
assert(formatCentsToBRL(125050n) === 'R$ 1.250,50', 'Formatação de centavos para BRL: 125050n -> "R$ 1.250,50"');
assert(formatCentsToBRL(5n) === 'R$ 0,05', 'Formatação com zero à esquerda nos centavos: 5n -> "R$ 0,05"');
assert(formatCentsToBRL(-100000n) === '-R$ 1.000,00', 'Formatação de negativo: -100000n -> "-R$ 1.000,00"');

// 3. Operações aritméticas
assert(add(10050n, 20025n) === 30075n, 'Soma determinística: 100,50 + 200,25 = 300,75');
assert(sub(30075n, 10050n) === 20025n, 'Subtração determinística: 300,75 - 100,50 = 200,25');

// 4. Rateio Justo (Split) com conservação estrita de centavos
const split100 = splitCents(10000n, 3); // R$ 100,00 em 3 parcelas
assert(split100.length === 3, 'Split em 3 partes gera array de 3 elementos');
assert(split100[0] === 3334n && split100[1] === 3333n && split100[2] === 3333n, 'Split distribui centavo residual na primeira parcela: 33,34 + 33,33 + 33,33');
assert(split100.reduce((a, b) => a + b, 0n) === 10000n, 'Soma das partes do split é estritamente igual ao total (sem perda de centavo)');

// 5. Serialização e Desserialização de Fio (Wire)
const wireObj = { id: 'tx-1', amount: 99999n };
const wireText = toWire(wireObj);
const restoredObj = fromWire(wireText);
assert(typeof restoredObj.amount === 'bigint' && restoredObj.amount === 99999n, 'Serialização e desserialização preservam tipo BigInt intacto');

// ============================================================================
// 2. TESTES DO CALENDAR ENGINE
// ============================================================================
console.log('\n[2/4] Testes do Calendar Engine (Fuso Canônico America/Fortaleza UTC-3)...');

assert(CANONICAL_TIMEZONE === 'America/Fortaleza', 'Fuso horário canônico é estritamente America/Fortaleza');

// 6. Virada de dia local e fuso horário
// Instante: 2026-11-06 às 02:59:59.999 UTC -> Em Fortaleza (UTC-3) é 2026-11-05 às 23:59:59.999 (ainda dia 05)
const lateNightDate = new Date(Date.UTC(2026, 10, 6, 2, 59, 59, 999));
assert(getISODateFortaleza(lateNightDate) === '2026-11-05', '02:59:59 UTC do dia 06 pertence ao dia contábil 2026-11-05 em Fortaleza (23:59:59)');

// Instante: 2026-11-06 às 03:00:00.000 UTC -> Em Fortaleza (UTC-3) é exatamente 2026-11-06 às 00:00:00.000 (virada para o dia 06)
const midnightDate = new Date(Date.UTC(2026, 10, 6, 3, 0, 0, 0));
assert(getISODateFortaleza(midnightDate) === '2026-11-06', '03:00:00 UTC corresponde exatamente a 00:00:00 do dia 2026-11-06 em Fortaleza (virada de dia)');

// 7. Comparação de datas no mesmo dia
assert(isSameDayFortaleza(lateNightDate, new Date(Date.UTC(2026, 10, 5, 15, 0, 0))), 'Comparações de data reconhecem mesmo dia contábil sob fuso de Fortaleza');
assert(!isSameDayFortaleza(lateNightDate, midnightDate), 'Instantes com 1ms de diferença na virada são reconhecidos como dias distintos');

// 8. Resolução de termos relativos em linguagem natural
const refTime = new Date('2026-11-06T14:00:00.000Z'); // Sexta-feira dia 06/11
assert(resolveRelativeDate('hoje', refTime) === '2026-11-06', 'Termo "hoje" resolve para a data canônica de Fortaleza');
assert(resolveRelativeDate('ontem', refTime) === '2026-11-05', 'Termo "ontem" resolve para o dia imediatamente anterior');
assert(resolveRelativeDate('amanhã', refTime) === '2026-11-07', 'Termo "amanhã" resolve para o dia posterior');
assert(resolveRelativeDate('dia 20', refTime) === '2026-11-20', 'Termo "dia 20" resolve para 2026-11-20');
assert(resolveRelativeDate('dia 15 do mês passado', refTime) === '2026-10-15', 'Termo "dia 15 do mês passado" resolve para o mês anterior');

// ============================================================================
// 3. TESTES DO LEDGER ENGINE
// ============================================================================
console.log('\n[3/4] Testes do Ledger Engine (Modelo B, Partidas Dobradas, Concorrência e Tombstones)...');

const mockNow = 1793930000000;
const ledger = new LedgerEngine(() => mockNow);
const USER_A = 'usr-patricia-01';
const USER_B = 'usr-carlos-02';

// 9. Criação de contas com isolamento de tenant
const accCorrente = ledger.createAccount(USER_A, 'acc-corrente', 'Conta Corrente Banco', 100000n); // R$ 1.000,00
const accPoupanca = ledger.createAccount(USER_A, 'acc-poupanca', 'Conta Poupança', 50000n); // R$ 500,00
assert(accCorrente.balanceCents === 100000n && accPoupanca.balanceCents === 50000n, 'Contas criadas com saldos iniciais em centavos');
assert(ledger.getAccount(USER_B, 'acc-corrente') === null, 'Isolamento estrito: outro usuário não visualiza contas de terceiro');

// 10. Lançamento de Receita
const recReceipt = ledger.recordTransaction(USER_A, {
  requestId: 'req-rec-01',
  id: 'tx-salario',
  type: 'INCOME',
  amountCents: 350000n, // R$ 3.500,00
  targetAccountId: 'acc-corrente',
  category: 'Salário',
  description: 'Salário Mensal',
  isEstimated: false
});
assert(recReceipt.status === 'APPLIED', 'Receita aplicada com sucesso');
assert(ledger.getAccount(USER_A, 'acc-corrente')!.balanceCents === 450000n, 'Saldo da Conta Corrente aumentado de 1.000 para 4.500');

// 11. Lançamento de Despesa
const desReceipt = ledger.recordTransaction(USER_A, {
  requestId: 'req-des-02',
  id: 'tx-aluguel',
  type: 'EXPENSE',
  amountCents: 120000n, // R$ 1.200,00
  sourceAccountId: 'acc-corrente',
  category: 'Moradia',
  description: 'Aluguel Apartamento',
  isEstimated: false
});
assert(desReceipt.status === 'APPLIED', 'Despesa aplicada com sucesso');
assert(ledger.getAccount(USER_A, 'acc-corrente')!.balanceCents === 330000n, 'Saldo da Conta Corrente reduzido de 4.500 para 3.300');

// 12. Transferência entre contas com conservação estrita da soma total
const totalBefore = ledger.getAccount(USER_A, 'acc-corrente')!.balanceCents + ledger.getAccount(USER_A, 'acc-poupanca')!.balanceCents;
const transReceipt = ledger.recordTransaction(USER_A, {
  requestId: 'req-trans-03',
  id: 'tx-aporte-poup',
  type: 'TRANSFER',
  amountCents: 50000n, // R$ 500,00
  sourceAccountId: 'acc-corrente',
  targetAccountId: 'acc-poupanca',
  category: 'Investimento',
  description: 'Aporte Poupança'
});
assert(transReceipt.status === 'APPLIED', 'Transferência entre contas aplicada');
assert(ledger.getAccount(USER_A, 'acc-corrente')!.balanceCents === 280000n, 'Conta Corrente debitada em 500,00');
assert(ledger.getAccount(USER_A, 'acc-poupanca')!.balanceCents === 100000n, 'Conta Poupança creditada em 500,00');
const totalAfter = ledger.getAccount(USER_A, 'acc-corrente')!.balanceCents + ledger.getAccount(USER_A, 'acc-poupanca')!.balanceCents;
assert(totalBefore === totalAfter, 'Conservação absoluta do patrimônio na transferência: soma antes === soma depois');

// 13. Idempotência estrita (Replay de requestId existente)
const replayReceipt = ledger.recordTransaction(USER_A, {
  requestId: 'req-des-02', // mesmo requestId
  id: 'tx-aluguel-duplicado',
  type: 'EXPENSE',
  amountCents: 120000n,
  sourceAccountId: 'acc-corrente',
  category: 'Moradia',
  description: 'Tentativa duplicada'
});
assert(replayReceipt.replay === true, 'Reenvio de requestId reconhecido como replay');
assert(ledger.getAccount(USER_A, 'acc-corrente')!.balanceCents === 280000n, 'Saldo não sofreu segundo efeito pelo replay de requisição');

// 14. Estorno (Reversão) de Transação e Tombstones
const revReceipt = ledger.reverseTransaction(USER_A, 'req-estorno-04', 'tx-aporte-poup', 'Cancelamento do aporte');
assert(revReceipt.status === 'APPLIED', 'Estorno aplicado com sucesso');
assert(ledger.getAccount(USER_A, 'acc-corrente')!.balanceCents === 330000n, 'Saldo de origem restaurado pelo estorno');
assert(ledger.getAccount(USER_A, 'acc-poupanca')!.balanceCents === 50000n, 'Saldo de destino revertido pelo estorno');
assert(ledger.tombstones.has(`${USER_A}:tx-aporte-poup`), 'Tombstone de 90 dias registrado para o lançamento estornado');

// 15. Bloqueio de ressurreição por Tombstone ativo
const resurrectReceipt = ledger.recordTransaction(USER_A, {
  requestId: 'req-resurrect-05',
  id: 'tx-aporte-poup', // mesmo ID estornado
  type: 'EXPENSE',
  amountCents: 50000n,
  sourceAccountId: 'acc-corrente',
  category: 'Investimento',
  description: 'Tentativa de ressurreição'
});
assert(resurrectReceipt.code === 'TOMBSTONED_NO_RESURRECTION', 'Tombstone ativo bloqueia estritamente a recriação do ID excluído');

// ============================================================================
// 4. TESTES DO REPORTS ENGINE
// ============================================================================
console.log('\n[4/4] Testes do Reports Engine (Segregação Realizado vs Previsto e Balancete)...');

// Adiciona uma despesa prevista futura (ex: fatura de cartão prevista para o dia 20)
ledger.recordTransaction(USER_A, {
  requestId: 'req-prev-06',
  id: 'tx-cartao-previsto',
  type: 'EXPENSE',
  amountCents: 85000n, // R$ 850,00
  sourceAccountId: 'acc-corrente',
  category: 'Cartão de Crédito',
  description: 'Fatura Prevista',
  isEstimated: true // PREVISTO
});

const reports = new ReportsEngine(ledger);
const summary = reports.generateUserSummary(USER_A);

// 16. Patrimônio Líquido e Contas
assert(summary.totalNetWorthCents === 380000n, 'Patrimônio Líquido Realizado totaliza exatamente R$ 3.800,00 (3300 + 500)');
assert(summary.totalNetWorthFormatted === 'R$ 3.800,00', 'Patrimônio formatado corretamente: "R$ 3.800,00"');

// 17. Segregação estrita entre Realizado e Previsto
assert(summary.realized.totalIncomeCents === 350000n, 'Realizado: Receitas = R$ 3.500,00');
assert(summary.realized.totalExpenseCents === 120000n, 'Realizado: Despesas = R$ 1.200,00');
assert(summary.realized.netResultCents === 230000n, 'Realizado: Resultado Líquido = R$ 2.300,00');

assert(summary.forecast.totalEstimatedExpenseCents === 85000n, 'Previsto: Despesa Prevista segregada = R$ 850,00');
assert(summary.forecast.projectedNetResultCents === -85000n, 'Previsto: Projeção futura não afeta saldo realizado presente');

// 18. Agrupamento por Categoria
assert(summary.categoryBreakdown['Salário'].incomeCents === 350000n, 'Categoria Salário totaliza R$ 3.500,00');
assert(summary.categoryBreakdown['Moradia'].expenseCents === 120000n, 'Categoria Moradia totaliza R$ 1.200,00');

console.log(`\n================================================================`);
console.log(`BATERIA CONCLUÍDA: ${passedTests} de ${totalTests} TESTES APROVADOS (100%)`);
console.log(`================================================================`);
