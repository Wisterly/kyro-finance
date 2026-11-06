/**
 * KYRO FINANCE | ENGINE TEMPORAL E DE CALENDÁRIO (CALENDAR ENGINE)
 * Fuso horário canônico inegociável: America/Fortaleza (UTC-3 fixo).
 * Garante que a competência contábil, virada de dia e termos relativos
 * sejam rigorosamente idênticos em Web, APK e WhatsApp.
 */

export const CANONICAL_TIMEZONE = 'America/Fortaleza';
const FORTALEZA_OFFSET_HOURS = -3;
const FORTALEZA_OFFSET_MS = FORTALEZA_OFFSET_HOURS * 60 * 60 * 1000;

export interface DatePartsFortaleza {
  year: number;
  month: number; // 1 a 12
  day: number;   // 1 a 31
  hours: number; // 0 a 23
  minutes: number;
  seconds: number;
  milliseconds: number;
}

/**
 * Converte qualquer timestamp, data ou string para as partes exatas em America/Fortaleza.
 */
export function getFortalezaParts(dateInput?: Date | string | number): DatePartsFortaleza {
  const d = dateInput instanceof Date ? dateInput : (dateInput ? new Date(dateInput) : new Date());
  if (isNaN(d.getTime())) {
    throw new Error(`[CalendarEngine] Data inválida fornecida: ${dateInput}`);
  }

  // Usa Intl.DateTimeFormat para resolução do fuso IANA exato America/Fortaleza
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: CANONICAL_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  });

  const parts = formatter.formatToParts(d);
  const partMap: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      partMap[p.type] = parseInt(p.value, 10);
    }
  }

  return {
    year: partMap.year,
    month: partMap.month,
    day: partMap.day,
    hours: partMap.hour === 24 ? 0 : partMap.hour,
    minutes: partMap.minute,
    seconds: partMap.second,
    milliseconds: d.getMilliseconds()
  };
}

/**
 * Retorna a data no formato ISO YYYY-MM-DD canônica de America/Fortaleza.
 */
export function getISODateFortaleza(dateInput?: Date | string | number): string {
  const p = getFortalezaParts(dateInput);
  const y = p.year.toString().padStart(4, '0');
  const m = p.month.toString().padStart(2, '0');
  const d = p.day.toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Retorna o timestamp de início exato do dia (00:00:00.000) em America/Fortaleza.
 */
export function getStartOfDayFortaleza(dateInput?: Date | string | number): Date {
  const p = getFortalezaParts(dateInput);
  // Constrói timestamp UTC que corresponde a 00:00:00 em UTC-3
  // 00:00 em UTC-3 é 03:00 em UTC
  const utcDate = new Date(Date.UTC(p.year, p.month - 1, p.day, 3, 0, 0, 0));
  return utcDate;
}

/**
 * Retorna o timestamp de fim exato do dia (23:59:59.999) em America/Fortaleza.
 */
export function getEndOfDayFortaleza(dateInput?: Date | string | number): Date {
  const p = getFortalezaParts(dateInput);
  // 23:59:59.999 em UTC-3 é 02:59:59.999 do dia seguinte em UTC
  const utcDate = new Date(Date.UTC(p.year, p.month - 1, p.day + 1, 2, 59, 59, 999));
  return utcDate;
}

/**
 * Retorna se dois instantes pertencem ao mesmo dia contábil em America/Fortaleza.
 */
export function isSameDayFortaleza(d1: Date | string | number, d2: Date | string | number): boolean {
  return getISODateFortaleza(d1) === getISODateFortaleza(d2);
}

/**
 * Converte termos de linguagem natural em data canônica YYYY-MM-DD ancorada em America/Fortaleza.
 * Suporta: "hoje", "ontem", "anteontem", "amanhã", "dia 15", "dia 5 do mês passado", etc.
 */
export function resolveRelativeDate(term: string, referenceDate?: Date): string {
  const ref = referenceDate || new Date();
  const currentParts = getFortalezaParts(ref);
  const normalized = term.toLowerCase().trim();

  // Caso: "hoje"
  if (normalized === 'hoje' || normalized.includes('de hoje')) {
    return getISODateFortaleza(ref);
  }

  // Caso: "ontem"
  if (normalized === 'ontem' || normalized.includes('de ontem')) {
    const yesterday = new Date(ref.getTime() - 24 * 60 * 60 * 1000);
    return getISODateFortaleza(yesterday);
  }

  // Caso: "anteontem"
  if (normalized === 'anteontem') {
    const dayBefore = new Date(ref.getTime() - 48 * 60 * 60 * 1000);
    return getISODateFortaleza(dayBefore);
  }

  // Caso: "amanhã"
  if (normalized === 'amanhã' || normalized === 'amanha') {
    const tomorrow = new Date(ref.getTime() + 24 * 60 * 60 * 1000);
    return getISODateFortaleza(tomorrow);
  }

  // Caso: "dia X" (ex: "dia 15", "dia 05")
  const dayMatch = normalized.match(/(?:dia|no dia)\s+(\d{1,2})/);
  if (dayMatch) {
    const dayNum = parseInt(dayMatch[1], 10);
    if (dayNum >= 1 && dayNum <= 31) {
      let targetMonth = currentParts.month;
      let targetYear = currentParts.year;

      if (normalized.includes('mês passado') || normalized.includes('mes passado')) {
        targetMonth -= 1;
        if (targetMonth === 0) {
          targetMonth = 12;
          targetYear -= 1;
        }
      }

      const mStr = targetMonth.toString().padStart(2, '0');
      const dStr = dayNum.toString().padStart(2, '0');
      return `${targetYear}-${mStr}-${dStr}`;
    }
  }

  // Caso já venha no formato YYYY-MM-DD
  const isoMatch = normalized.match(/^\d{4}-\d{2}-\d{2}$/);
  if (isoMatch) {
    return normalized;
  }

  // Caso venha no formato DD/MM/YYYY
  const brMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) {
    const dStr = brMatch[1].padStart(2, '0');
    const mStr = brMatch[2].padStart(2, '0');
    return `${brMatch[3]}-${mStr}-${dStr}`;
  }

  // Fallback seguro: retorna a data de hoje em Fortaleza
  return getISODateFortaleza(ref);
}
