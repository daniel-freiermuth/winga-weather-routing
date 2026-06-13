// Unit conversion helpers: internal units (kn, m, nmi) ↔ SignalK unit preset display units.

export type Category = 'speed' | 'depth' | 'distance';

export interface UnitCategory {
  formula: string;
  inverseFormula: string;
  symbol: string;
  displayFormat?: string;
}

export interface UnitPrefs {
  speed?: UnitCategory;
  depth?: UnitCategory;
  distance?: UnitCategory;
}

// Factors: plugin-internal units → SI (m/s, m, m)
export const toSI: Record<Category, (v: number) => number> = {
  speed:    v => v * 0.514444,
  depth:    v => v,
  distance: v => v * 1852.001,
};

// Factors: SI (m/s, m, m) → plugin-internal units
export const fromSI: Record<Category, (v: number) => number> = {
  speed:    v => v * 1.94384,
  depth:    v => v,
  distance: v => v / 1852.001,
};

const FALLBACK_SYMBOL: Record<Category, string> = { speed: 'kn', depth: 'm', distance: 'nmi' };

// Safe formula evaluator for "value * N" / "value / N" / "value + N" / "value - N"
export function evalFormula(formula: string, value: number): number {
  const m = formula.match(/^value\s*([*/+\-])\s*([\d.]+)$/);
  if (!m) return value;
  const n = parseFloat(m[2]);
  switch (m[1]) {
    case '*': return value * n;
    case '/': return value / n;
    case '+': return value + n;
    case '-': return value - n;
    default:  return value;
  }
}

// Convert internal-unit value to display number (no formatting).
// forceMs=true: override to m/s for speed (used when windSpeedMs config is enabled).
export function toDisplay(value: number, category: Category, prefs: UnitPrefs | null, forceMs = false): number {
  if (forceMs) return toSI[category](value);
  const p = prefs?.[category];
  if (!p?.formula) return value;
  return evalFormula(p.formula, toSI[category](value));
}

// Convert internal-unit value to { num, sym } for display.
export function fmt(value: number, category: Category, prefs: UnitPrefs | null, forceMs = false): { num: string; sym: string } {
  if (forceMs) {
    return { num: toSI[category](value).toFixed(2), sym: 'm/s' };
  }
  const p = prefs?.[category];
  if (!p?.formula) {
    return { num: value.toFixed(1), sym: FALLBACK_SYMBOL[category] };
  }
  const raw = evalFormula(p.formula, toSI[category](value));
  return { num: raw.toFixed(parseInt(p.displayFormat ?? '1')), sym: p.symbol };
}

// Convert display-unit value back to internal units.
export function parseUnit(displayVal: number, category: Category, prefs: UnitPrefs | null, forceMs = false): number {
  if (forceMs) return displayVal * 1.94384; // m/s → kn
  const p = prefs?.[category];
  if (!p?.inverseFormula) return displayVal;
  return fromSI[category](evalFormula(p.inverseFormula, displayVal));
}
