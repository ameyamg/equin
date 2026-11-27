import type { DateFormatter } from "@plugins/fields/plugins/date/plugins/format/core";

export function formatAbsoluteTime(fmt: DateFormatter, d: Date): string {
  return fmt.time(d, { seconds: true });
}

export function formatTime(fmt: DateFormatter, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatAbsoluteTime(fmt, d);
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}