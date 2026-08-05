export function formatCurrency(raw: string): string {
  const num = Number(raw.replace(/[^0-9.-]/g, ''));
  if (!raw.trim() || Number.isNaN(num)) return raw;
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
