/**
 * KYRO FINANCE | ENGINE ARITMÉTICO DE PRECISÃO (MONEY ENGINE)
 * Módulo puro em centavos inteiros (BigInt).
 * Elimina totalmente desvios de arredondamento de ponto flutuante IEEE 754.
 */

export type Cents = bigint;

/**
 * Converte qualquer entrada financeira (string, number, bigint) para centavos BigInt exatos.
 * Aceita padrões brasileiros: "R$ 1.234,56", "1234,56", "1234.56", 1234.56, etc.
 */
export function parseToCents(value: string | number | bigint | null | undefined): Cents {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Number.isNaN(value)) {
      throw new Error(`[MoneyEngine] Valor numérico inválido: ${value}`);
    }
    // Evita imprecisão de multiplicação float fazendo parsing textual do número
    const fixed = value.toFixed(2);
    return parseToCents(fixed);
  }

  const str = String(value).trim();
  if (!str) return 0n;

  // Detecta sinal negativo
  const isNegative = str.startsWith('-') || str.includes('(') && str.endsWith(')');

  // Remove símbolos monetários e caracteres não numéricos exceto vírgula, ponto e traço
  let cleaned = str.replace(/[R$\s()]/g, '');
  if (cleaned.startsWith('-')) cleaned = cleaned.substring(1);

  // Normaliza separadores decimais: se contiver vírgula, assume padrão BR (1.234,56)
  let integerPart = '0';
  let decimalPart = '00';

  if (cleaned.includes(',')) {
    // Ex: "1.234,56" -> remove pontos de milhar e divide na vírgula
    const withoutThousands = cleaned.replace(/\./g, '');
    const parts = withoutThousands.split(',');
    integerPart = parts[0] || '0';
    decimalPart = (parts[1] || '00').padEnd(2, '0').slice(0, 2);
  } else if (cleaned.includes('.')) {
    // Ex: "1234.56" ou "1,234.56"
    const parts = cleaned.split('.');
    if (parts.length === 2 && parts[1].length <= 2) {
      // Padrão US com ponto decimal: "1234.56"
      integerPart = parts[0].replace(/,/g, '') || '0';
      decimalPart = parts[1].padEnd(2, '0').slice(0, 2);
    } else {
      // Múltiplos pontos = pontos de milhar BR sem centavos: "1.234.567"
      integerPart = cleaned.replace(/\./g, '');
      decimalPart = '00';
    }
  } else {
    // Número inteiro puro sem separador decimal: "150"
    integerPart = cleaned;
    decimalPart = '00';
  }

  // Remove zeros à esquerda mantendo pelo menos um dígito
  integerPart = integerPart.replace(/^0+(?=\d)/, '') || '0';

  const centsValue = BigInt(integerPart) * 100n + BigInt(decimalPart);
  return isNegative ? -centsValue : centsValue;
}

/**
 * Converte centavos BigInt para formatação monetária brasileira determinística: "R$ 1.234,56".
 */
export function formatCentsToBRL(cents: Cents): string {
  const isNegative = cents < 0n;
  const abs = isNegative ? -cents : cents;
  const intPart = (abs / 100n).toString();
  const decPart = (abs % 100n).toString().padStart(2, '0');

  // Adiciona separador de milhar com ponto
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const res = `R$ ${formattedInt},${decPart}`;
  return isNegative ? `-${res}` : res;
}

/**
 * Soma duas quantias em centavos BigInt.
 */
export function add(a: Cents, b: Cents): Cents {
  return a + b;
}

/**
 * Subtrai duas quantias em centavos BigInt.
 */
export function sub(a: Cents, b: Cents): Cents {
  return a - b;
}

/**
 * Rateio justo de centavos (split): divide totalCents em `parts` parcelas iguais,
 * distribuindo os centavos de resto deterministicamente nas primeiras parcelas,
 * garantindo: sum(result) === totalCents sem perda de 1 centavo.
 */
export function splitCents(totalCents: Cents, parts: number): Cents[] {
  if (parts <= 0) throw new Error('[MoneyEngine] Divisão por zero ou partes negativas.');
  const bigParts = BigInt(parts);
  const basePart = totalCents / bigParts;
  const remainder = totalCents % bigParts;

  const result: Cents[] = [];
  const absRemainder = remainder < 0n ? -remainder : remainder;
  const remainderSign = remainder < 0n ? -1n : 1n;

  for (let i = 0; i < parts; i++) {
    if (BigInt(i) < absRemainder) {
      result.push(basePart + remainderSign);
    } else {
      result.push(basePart);
    }
  }
  return result;
}

/**
 * Serialização segura para persistência (fio / JSON) preservando tipos BigInt.
 */
export function toWire(data: any): string {
  return JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? `b:${v.toString()}` : v));
}

/**
 * Desserialização segura a partir do fio/JSON recriando tipos BigInt com prefixo `b:`.
 */
export function fromWire(text: string): any {
  return JSON.parse(text, (_, v) => {
    if (typeof v === 'string' && v.startsWith('b:')) {
      return BigInt(v.slice(2));
    }
    return v;
  });
}
