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
      assert.match(step, /LD_PRELOAD: ""/);
      assert.match(step, /LD_AUDIT: ""/);
      assert.match(step, /export PATH=\/usr\/local\/bin:\/usr\/bin:\/bin/);
      assert.match(step, /\/bin\/bash "\$RELAY_RUNTIME_ROOT\//);
      assert.ok(step.indexOf("export PATH=") < step.lastIndexOf('/bin/bash "$RELAY_RUNTIME_ROOT/'));
    }
  });
}

const pinnedRuntimeSha = "1eab0015b834fe3e03d28503dc51b4c717a95aec";

for (const path of [".github/workflows/codex.yml", "examples/github-actions/codex.yml"]) {
  test(`${path} isolates untrusted setup from the credentialed job`, async () => {
    const workflow = await readFile(path, "utf8");
    const validate = workflow.split("\n  validate:\n")[1]?.split("\n  codex:\n")[0] ?? "";
    const codex = workflow.split("\n  codex:\n")[1] ?? "";
    assert.ok(validate);
    assert.ok(codex);
    assert.match(validate, /- name: Install dependencies\n        run: npm ci/);
    assert.match(validate, /- name: Validate repository\n        run: npm run check/);
    assert.doesNotMatch(codex, /- name: (?:Install pull-request runtime dependencies|Build pull-request runtime)/);
    assert.doesNotMatch(codex, /\n        run: npm (?:ci|run build)\n/);

    const beforeTrustedCheckout = codex.split("- name: Checkout reviewed execution runtime")[0] ?? "";
    assert.doesNotMatch(beforeTrustedCheckout, /npm (?:ci|install|run build)/);
    assert.match(codex, new RegExp(`repository: Divorium/agent-relay\\n          ref: ${pinnedRuntimeSha}`));

    const trustedBuild = codex.split("- name: Preserve trusted execution runtime")[1]?.split("- name: Run Codex directly")[0] ?? "";
    assert.match(trustedBuild, /cp -a \.trusted-codex-runtime\/\. "\$runtime\/"/);
    assert.match(trustedBuild, /cd "\$runtime"\n          npm ci\n          npm run build/);
  });
}

test("the example and active credentialed workflows remain identical", async () => {
  const [active, example] = await Promise.all([
    readFile(".github/workflows/codex.yml", "utf8"),
    readFile("examples/github-actions/codex.yml", "utf8"),
  ]);
  assert.equal(example, active);
});
