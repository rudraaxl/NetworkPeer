export function normalizePhoneNumber(rawValue: string): string {
  return (rawValue || "").replace(/\D/g, "");
}

export function toE164Phone(countryCode: string, rawValue: string): string | null {
  const normalizedCountryCode = String(countryCode || "").replace(/\D/g, "");
  const raw = String(rawValue || "").trim();
  let nationalNumber = normalizePhoneNumber(raw);

  if (!normalizedCountryCode || !/^[1-9]\d{0,2}$/.test(normalizedCountryCode)) {
    return null;
  }
  if (raw.startsWith("+")) {
    if (!nationalNumber.startsWith(normalizedCountryCode)) return null;
    nationalNumber = nationalNumber.slice(normalizedCountryCode.length);
  }

  const value = `+${normalizedCountryCode}${nationalNumber}`;
  return /^\+[1-9]\d{1,14}$/.test(value) && nationalNumber.length >= 7 ? value : null;
}

export function isPhoneNumberValid(rawValue: string): boolean {
  return normalizePhoneNumber(rawValue).length >= 7;
}

export function formatPhoneNumber(rawValue: string, countryCode: string): string {
  const digits = normalizePhoneNumber(rawValue);

  if (!digits) {
    return countryCode;
  }

  if (countryCode === "+1") {
    const compact = digits.slice(0, 10);
    if (compact.length <= 3) {
      return `${countryCode} ${compact}`.trim();
    }

    if (compact.length <= 6) {
      return `${countryCode} ${compact.slice(0, 3)} ${compact.slice(3)}`.trim();
    }

    return `${countryCode} ${compact.slice(0, 3)} ${compact.slice(3, 6)} ${compact.slice(6)}`.trim();
  }

  return `${countryCode} ${digits}`.trim();
}

export function isOtpCodeValid(value: string, length = 6): boolean {
  return new RegExp(`^\\d{${length}}$`).test(value || "");
}

export function getDemoOtp(): string {
  return "123456";
}
