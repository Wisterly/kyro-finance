/**
 * KYRO FINANCE | SERIALIZADOR MONETÁRIO SEGURO (SAFE MONEY SERIALIZER)
 * Converte centavos BigInt em inteiros seguros (IEEE 754 Safe Integer) para o Firestore JS SDK.
 * Garante que nenhum cálculo ou persistência sofra perda de precisão ou rejeição de tipo.
 */

export class SafeMoneyError extends Error {
  constructor(message: string) {
    super(`[SafeMoneyError] ${message}`);
    this.name = 'SafeMoneyError';
  }
}

export class SafeMoneySerializer {
  // Limite exato seguro do JavaScript de 53 bits: 9.007.199.254.740.991 centavos (~R$ 90 Trilhões)
  public static readonly MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
  public static readonly MIN_SAFE_CENTS = -BigInt(Number.MAX_SAFE_INTEGER);

  /**
   * Converte centavos em BigInt para número inteiro seguro aceito nativamente pelo Firestore.
   */
  public static toFirestoreCents(value: bigint): number {
    if (value > this.MAX_SAFE_CENTS || value < this.MIN_SAFE_CENTS) {
      throw new SafeMoneyError(
        `Valor monetário excede o limite seguro de 53 bits IEEE 754: ${value.toString()} centavos.`
      );
    }
    const num = Number(value);
    if (!Number.isSafeInteger(num)) {
      throw new SafeMoneyError(
        `Perda de precisão inteira detectada ao converter BigInt para Number: ${value.toString()}`
      );
    }
    return num;
  }

  /**
   * Desserializa o inteiro vindo do Firestore de volta para BigInt estrito.
   * Suporta números inteiros, strings inteiras e dados legados com valores float.
   */
  public static fromFirestoreCents(value: unknown): bigint {
    if (typeof value === 'bigint') {
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) {
        // Se for um float legado (ex: 150.50 salvo no modelo antigo)
        const fixed = value.toFixed(2);
        const parts = fixed.split('.');
        const isNegative = value < 0;
        const intPart = BigInt(parts[0].replace('-', ''));
        const decPart = BigInt(parts[1] || '00');
        const cents = intPart * 100n + decPart;
        return isNegative ? -cents : cents;
      }
      return BigInt(value);
    }
    if (typeof value === 'string') {
      const sanitized = value.trim();
      if (/^-?\d+$/.test(sanitized)) {
        return BigInt(sanitized);
      }
      // Se for string decimal legada (ex: "150.50" ou "150,50")
      const normalized = sanitized.replace('R$', '').replace(/\s/g, '');
      const hasComma = normalized.includes(',');
      const cleanNum = hasComma ? normalized.replace(/\./g, '').replace(',', '.') : normalized;
      const parsedFloat = parseFloat(cleanNum);
      if (!isNaN(parsedFloat) && isFinite(parsedFloat)) {
        return this.fromFirestoreCents(parsedFloat);
      }
      throw new SafeMoneyError(`Formato inválido de centavos para desserialização: "${value}"`);
    }
    if (value === null || value === undefined) {
      return 0n;
    }
    throw new SafeMoneyError(`Tipo incompatível para valor monetário: ${typeof value}`);
  }

  /**
   * Serializa centavos para string JSON / API.
   */
  public static toWire(value: bigint): string {
    return value.toString();
  }

  /**
   * Lê centavos da string de transporte da API.
   */
  public static fromWire(value: string | number): bigint {
    return this.fromFirestoreCents(value);
  }
}
