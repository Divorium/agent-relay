interface SecretPattern {
  pattern: RegExp;
  replacement: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/g, replacement: "[REDACTED]" },
  { pattern: /github_pat_[A-Za-z0-9_]{20,}/g, replacement: "[REDACTED]" },
  { pattern: /sk-[A-Za-z0-9_-]{20,}/g, replacement: "[REDACTED]" },
  {
    pattern: /(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi,
    replacement: "$1[REDACTED]",
  },
  {
    pattern: /("?(?:token|password|secret|apiKey|api_key)"?\s*[:=]\s*(?:["']?))[^\s,"']+((?:["']?))/gi,
    replacement: "$1[REDACTED]$2",
  },
];

export function redactSensitiveText(value: string): string {
  let redacted = value;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export class StreamingRedactor {
  private readonly decoder = new TextDecoder("utf-8");
  private pending = "";

  write(chunk: Uint8Array): string {
    this.pending += this.decoder.decode(chunk, { stream: true });
    const lineBreak = Math.max(this.pending.lastIndexOf("\n"), this.pending.lastIndexOf("\r"));
    if (lineBreak < 0) return "";
    const complete = this.pending.slice(0, lineBreak + 1);
    this.pending = this.pending.slice(lineBreak + 1);
    return redactSensitiveText(complete);
  }

  end(): string {
    this.pending += this.decoder.decode();
    const complete = redactSensitiveText(this.pending);
    this.pending = "";
    return complete;
  }

  discard(): void {
    this.pending = "";
    this.decoder.decode();
  }
}
