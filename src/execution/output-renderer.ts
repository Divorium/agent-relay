export const RELAY_LINE_PREFIX = "[codex] ";
export const MAX_NORMALIZED_SEGMENT_BYTES = 32 * 1024;

function visibleCharacter(character: string): string {
  const code = character.charCodeAt(0);
  if (code <= 0x1f || code === 0x7f) {
    return `\\u${code.toString(16).padStart(4, "0")}`;
  }
  return character;
}

function visible(value: string): string {
  return Array.from(value, visibleCharacter).join("");
}

/** Render untrusted content so every physical Actions log line is Relay-owned. */
export function renderRelayLines(value: string): string {
  const logicalLines = value.split(/\r\n|\r|\n/u);
  return `${logicalLines.map((logicalLine) => `${RELAY_LINE_PREFIX}${visible(logicalLine)}`).join("\n")}\n`;
}

function utf8PrefixLength(bytes: Uint8Array, limit: number): number {
  let end = Math.min(limit, bytes.length);
  while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return end;
}

export function* splitNormalizedSegments(value: string, maxBytes = MAX_NORMALIZED_SEGMENT_BYTES): Generator<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4) throw new RangeError("maxBytes must be an integer of at least 4");
  const encoded = Buffer.from(value);
  let offset = 0;
  while (offset < encoded.length) {
    const length = utf8PrefixLength(encoded.subarray(offset), maxBytes);
    yield encoded.subarray(offset, offset + length).toString("utf8");
    offset += length;
  }
}
