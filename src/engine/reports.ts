/**
 * KYRO FINANCE | ENGINE DE RELATÓRIOS E CONSOLIDAÇÃO (REPORTS ENGINE)
 * Agregação determinística em centavos BigInt, segregação estrita entre Realizado e Previsto,
 * e demonstrativos contábeis consolidados por competência temporal em America/Fortaleza.
 */

import { Cents, add, sub, formatCentsToBRL } from './money';
import { LedgerEngine, LedgerTransaction, LedgerAccount } from './ledger';

export interface FinancialSummaryReport {
  userId: string;
  generatedAt: string;
  totalNetWorthCents: Cents;
  totalNetWorthFormatted: string;
  accounts: Array<{
    id: string;
    name: string;
    balanceCents: Cents;
    balanceFormatted: string;
  }>;
  realized: {
    totalIncomeCents: Cents;
    totalIncomeFormatted: string;
    totalExpenseCents: Cents;
    totalExpenseFormatted: string;
    netResultCents: Cents;
    netResultFormatted: string;
    transactionCount: number;
  };
  forecast: {
    totalEstimatedIncomeCents: Cents;
    totalEstimatedIncomeFormatted: string;
    totalEstimatedExpenseCents: Cents;
    totalEstimatedExpenseFormatted: string;
    projectedNetResultCents: Cents;
    projectedNetResultFormatted: string;
    estimatedCount: number;
  };
  categoryBreakdown: Record<string, {
    incomeCents: Cents;
    expenseCents: Cents;
    netCents: Cents;
    formattedNet: string;
  }>;
}

export class ReportsEngine {
  constructor(private ledger: LedgerEngine) {}

  /**
   * Gera o sumário financeiro integral com segregação entre Realizado e Previsto.
   */
  public generateUserSummary(userId: string): FinancialSummaryReport {
    let totalNetWorthCents: Cents = 0n;
    const accountSummaries: FinancialSummaryReport['accounts'] = [];

    // 1. Consolida Contas e Patrimônio Líquido
    for (const [, acc] of this.ledger.accounts) {
      if (acc.userId === userId) {
        totalNetWorthCents = add(totalNetWorthCents, acc.balanceCents);
        accountSummaries.push({
          id: acc.id,
          name: acc.name,
          balanceCents: acc.balanceCents,
          balanceFormatted: formatCentsToBRL(acc.balanceCents)
        });
      }
    }

    // 2. Consolida Transações (Segregando Realizado vs Previsto)
    let totalRealizedIncome: Cents = 0n;
    let totalRealizedExpense: Cents = 0n;
    let realizedCount = 0;

    let totalForecastIncome: Cents = 0n;
    let totalForecastExpense: Cents = 0n;
    let forecastCount = 0;

    const categoryMap: FinancialSummaryReport['categoryBreakdown'] = {};

    for (const [, tx] of this.ledger.transactions) {
      if (tx.userId !== userId) continue;

      if (!categoryMap[tx.category]) {
        categoryMap[tx.category] = {
          incomeCents: 0n,
          expenseCents: 0n,
          netCents: 0n,
          formattedNet: 'R$ 0,00'
        };
      }

      if (tx.isEstimated) {
        // Previsto / Recorrente futuro
        forecastCount++;
        if (tx.type === 'INCOME') {
          totalForecastIncome = add(totalForecastIncome, tx.amountCents);
        } else if (tx.type === 'EXPENSE') {
          totalForecastExpense = add(totalForecastExpense, tx.amountCents);
        }
      } else {
        // Realizado contábil
        realizedCount++;
        if (tx.type === 'INCOME') {
          totalRealizedIncome = add(totalRealizedIncome, tx.amountCents);
          categoryMap[tx.category].incomeCents = add(categoryMap[tx.category].incomeCents, tx.amountCents);
        } else if (tx.type === 'EXPENSE') {
          totalRealizedExpense = add(totalRealizedExpense, tx.amountCents);
          categoryMap[tx.category].expenseCents = add(categoryMap[tx.category].expenseCents, tx.amountCents);
        }
      }
    }

    // Formatar categorias
    for (const catKey of Object.keys(categoryMap)) {
      const cat = categoryMap[catKey];
      cat.netCents = sub(cat.incomeCents, cat.expenseCents);
      cat.formattedNet = formatCentsToBRL(cat.netCents);
    }

    const realizedNetResult = sub(totalRealizedIncome, totalRealizedExpense);
    const forecastNetResult = sub(totalForecastIncome, totalForecastExpense);

    return {
      userId,
      generatedAt: new Date().toISOString(),
      totalNetWorthCents,
      totalNetWorthFormatted: formatCentsToBRL(totalNetWorthCents),
      accounts: accountSummaries,
      realized: {
        totalIncomeCents: totalRealizedIncome,
        totalIncomeFormatted: formatCentsToBRL(totalRealizedIncome),
        totalExpenseCents: totalRealizedExpense,
        totalExpenseFormatted: formatCentsToBRL(totalRealizedExpense),
        netResultCents: realizedNetResult,
        netResultFormatted: formatCentsToBRL(realizedNetResult),
        transactionCount: realizedCount
      },
      forecast: {
        totalEstimatedIncomeCents: totalForecastIncome,
        totalEstimatedIncomeFormatted: formatCentsToBRL(totalForecastIncome),
        totalEstimatedExpenseCents: totalForecastExpense,
        totalEstimatedExpenseFormatted: formatCentsToBRL(totalForecastExpense),
        projectedNetResultCents: forecastNetResult,
        projectedNetResultFormatted: formatCentsToBRL(forecastNetResult),
        estimatedCount: forecastCount
      },
      categoryBreakdown: categoryMap
    };
  }
}
