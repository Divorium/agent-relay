const SECRET_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi,
  /("?(?:token|password|secret|apiKey|api_key)"?\s*[:=]\s*(?:["']?))[^\s,"']+((?:["']?))/gi,
];

export function redactSensitiveText(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (...args: string[]) => {
      const match = args[0] ?? "";
      if (/authorization/i.test(match)) return `${args[1] ?? ""}[REDACTED]`;
      if (args[1] && args[2]) return `${args[1]}[REDACTED]${args[2]}`;
      return "[REDACTED]";
    });
  }
  return redacted;
}

export function assertNoSensitiveResult(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (redactSensitiveText(serialized) !== serialized || /auth\.json|\.ssh\/|BEGIN [A-Z ]*PRIVATE KEY/i.test(serialized)) {
    throw new Error("Result contains sensitive data");
  }
}
