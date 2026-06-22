export function parseNumber(value: string | undefined | null): number | null {
  if (value == null || value.trim() === "" || value === "-") {
    return null;
  }

  const normalized = value
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/\+/g, "")
    .replace(/\$/g, "")
    .trim();

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parsePercent(value: string | undefined | null): number | null {
  const parsed = parseNumber(value);
  return parsed;
}

export function parseVolume(value: string | undefined | null): number | null {
  if (value == null || value.trim() === "") {
    return null;
  }

  const trimmed = value.trim().toUpperCase();
  const suffix = trimmed.slice(-1);
  const numericPart = trimmed.replace(/[KMB]/i, "");
  const base = parseNumber(numericPart);
  if (base == null) {
    return null;
  }

  switch (suffix) {
    case "K":
      return base * 1_000;
    case "M":
      return base * 1_000_000;
    case "B":
      return base * 1_000_000_000;
    default:
      return base;
  }
}

export function signedChange(value: string | undefined | null): number | null {
  if (value == null) {
    return null;
  }
  const parsed = parseNumber(value);
  if (parsed == null) {
    return null;
  }
  if (value.includes("-")) {
    return -Math.abs(parsed);
  }
  if (value.includes("+")) {
    return Math.abs(parsed);
  }
  return parsed;
}
