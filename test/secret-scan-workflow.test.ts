import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("PR secret scan fails closed on the checked-out working tree", async () => {
  const workflow = await readFile(".github/workflows/secret-scan.yml", "utf8");
  assert.match(workflow, /name: Secret scan/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /runs-on: \[self-hosted\]/);
  assert.match(workflow, /uses: actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /GITLEAKS_SHA256: "[a-f0-9]{64}"/);
  assert.match(workflow, /sha256sum --check -/);
  assert.ok(workflow.indexOf("sha256sum --check -") < workflow.indexOf("tar --extract"));
  assert.match(workflow, /\.\/gitleaks dir \. --redact --no-banner --exit-code 1/);
  assert.match(workflow, /if: always\(\)/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  assert.doesNotMatch(workflow, /secrets\.|CODEX_TOKEN|docker\.sock|DOCKER_HOST/);
});
