#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { main } from "../dist/src/run-codex.js";

try {
  await main(fileURLToPath(new URL("../scripts/codex-run", import.meta.url)));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
