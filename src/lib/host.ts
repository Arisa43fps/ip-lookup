const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i;

/**
 * Accepts DNS names that are safe to hand to a resolver. Deliberately strict:
 * ASCII labels only, at least one dot, and an alphabetic or punycode TLD, so
 * malformed IPs such as `999.1.1.1` are rejected instead of being resolved.
 */
export function isHostname(value: string): boolean {
  const host = value.endsWith(".") ? value.slice(0, -1) : value;

  if (host.length === 0 || host.length > 253) return false;

  const labels = host.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => LABEL.test(label))) return false;

  return TLD.test(labels[labels.length - 1] ?? "");
}
