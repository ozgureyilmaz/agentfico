const SENSITIVE_FIELD =
  /^(?:authorization|proxy-authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie|set-cookie)$/i;

export function redactText(
  text: string,
  secrets: readonly string[] = [],
): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length > 0) result = result.replaceAll(secret, "[REDACTED]");
  }
  return result
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
      "[REDACTED]",
    )
    .replace(
      /(["']?(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*)(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\r\n,}]+)/gi,
      '$1"[REDACTED]"',
    );
}

export function redactValue(
  value: unknown,
  secrets: readonly string[] = [],
): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value))
    return value.map((item) => redactValue(item, secrets));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_FIELD.test(key) ? "[REDACTED]" : redactValue(item, secrets),
      ]),
    );
  }
  return value;
}
