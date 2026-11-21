import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Codex and application CI do not require the host Rust diagnostic", async () => {
  const scripts = JSON.parse(await readFile("package.json", "utf8")).scripts;
  assert.equal(scripts["check:toolchain"], "bash scripts/ci-toolchain-smoke.sh");
  assert.doesNotMatch(scripts.check, /check:toolchain/u);

  const ci = await readFile(".github/workflows/ci.yml", "utf8");
  const codex = await readFile(".github/workflows/codex.yml", "utf8");
  assert.doesNotMatch(ci, /run:\s+npm run check:toolchain/u);
  assert.match(ci, /run:\s+npm run check:runtime/u);
  assert.match(ci, /run:\s+npm run check:shell/u);
  assert.match(codex, /name: Validate repository\s+run: npm run check/u);
});

test("Host toolchain diagnostics remain independently executable", async () => {
  const workflow = await readFile(".github/workflows/host-toolchain.yml", "utf8");
  assert.match(workflow, /^  workflow_dispatch:\s*$/mu);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule|workflow_call):/mu);
  assert.match(workflow, /runs-on: \[self-hosted\]/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /run: npm run check:toolchain/u);
});
