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
