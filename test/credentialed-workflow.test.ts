import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

for (const path of [".github/workflows/codex.yml", "examples/github-actions/codex.yml"]) {
  test(`${path} does not resolve credentialed interpreters through inherited PATH`, async () => {
    const workflow = await readFile(path, "utf8");
    for (const name of ["Run Codex directly", "Commit and push"]) {
      const step = workflow.split(`- name: ${name}\n`)[1]?.split("\n      - name:")[0] ?? "";
      assert.ok(step);
      assert.match(step, /shell: \/bin\/bash --noprofile --norc -euo pipefail \{0\}/);
      assert.match(step, /BASH_ENV: ""/);
      assert.match(step, /ENV: ""/);
      assert.match(step, /NODE_OPTIONS: ""/);
      assert.match(step, /export PATH=\/usr\/local\/bin:\/usr\/bin:\/bin/);
      assert.match(step, /\/bin\/bash "\$RELAY_RUNTIME_ROOT\//);
      assert.ok(step.indexOf("export PATH=") < step.lastIndexOf('/bin/bash "$RELAY_RUNTIME_ROOT/'));
    }
  });
}
