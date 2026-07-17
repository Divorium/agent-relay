#!/usr/bin/env node
import { main } from "../dist/src/run-codex.js";

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
