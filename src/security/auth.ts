import { timingSafeEqual } from "node:crypto";
import { RelayError } from "../contracts/errors.js";

export function requireBearerToken(header: string | undefined, expected: string): void {
  if (!header?.startsWith("Bearer ")) throw new RelayError("UNAUTHORIZED", "Missing bearer token", 401);
  const actual = header.slice(7);
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new RelayError("UNAUTHORIZED", "Invalid bearer token", 401);
  }
}
