// ============ FORMATTING UTILITIES ============

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const formatLongDate = (iso) => {
  if (!iso) return '_______';
  const [y, m, d] = iso.split('-');
  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
};

export const fmtLakhs = (n) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return `Rs ${Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} lakhs`;
};

export const fmtCrores = (lakhs) => {
  if (lakhs === null || lakhs === undefined || isNaN(lakhs)) return '—';
  return `Rs ${(Number(lakhs) / 100).toFixed(2)} cr`;
};

// Must cover all 21 CARO 2020 paragraphs — Annexure A numbers its clauses from
// this list, and a short list silently falls back to arabic numerals part-way.
export const ROMAN_LOWER = [
  'i','ii','iii','iv','v','vi','vii','viii','ix','x',
  'xi','xii','xiii','xiv','xv','xvi','xvii','xviii','xix','xx','xxi',
];

// ---- Token cost estimate (DeepSeek approximate rates, USD → INR) ----
// deepseek-v4-pro rates assumed similar to V3: $0.27/M input, $1.10/M output
// USD/INR ≈ 84 (approximation — update as needed)
const USD_TO_INR = 84;
const INPUT_COST_PER_M  = 0.27;  // USD
const OUTPUT_COST_PER_M = 1.10;  // USD

export const estimateCost = ({ input_tokens = 0, output_tokens = 0 } = {}) => {
  const usd = (input_tokens / 1_000_000) * INPUT_COST_PER_M
            + (output_tokens / 1_000_000) * OUTPUT_COST_PER_M;
  const inr = usd * USD_TO_INR;
  return {
    usd: usd.toFixed(4),
    inr: inr.toFixed(2),
    display: `₹${inr.toFixed(2)} (~$${usd.toFixed(4)})`,
  };
};

export const fmtTokens = ({ input_tokens = 0, output_tokens = 0 } = {}) =>
  `${input_tokens.toLocaleString()} in + ${output_tokens.toLocaleString()} out`;
