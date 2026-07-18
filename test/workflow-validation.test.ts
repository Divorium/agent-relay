import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowPaths = [
  ".github/workflows/agent-relay.yml",
  "examples/github-actions/agent-relay.yml",
];

test("Agent Relay validates and rechecks the exact pull request revision before Codex", async () => {
  for (const path of workflowPaths) {
    const workflow = await readFile(path, "utf8");
    assert.match(workflow, /permissions:\n  contents: read\n  pull-requests: read/u);
    assert.match(workflow, /jobs:\n  validate:/u);
    assert.match(workflow, /validate:[\s\S]*ref: \$\{\{ steps\.pr\.outputs\.head_sha \}\}[\s\S]*run: npm ci[\s\S]*run: npm run check/u);
    assert.match(workflow, /outputs:[\s\S]*pr_number: \$\{\{ steps\.request\.outputs\.pr_number \}\}[\s\S]*head_sha: \$\{\{ steps\.pr\.outputs\.head_sha \}\}/u);
    assert.match(workflow, /codex:\n    needs: validate\n    if: \$\{\{ needs\.validate\.result == 'success' \}\}[\s\S]*permissions:\n      contents: write\n      pull-requests: read/u);
    assert.match(workflow, /Re-resolve ready pull request[\s\S]*PR_NUMBER: \$\{\{ needs\.validate\.outputs\.pr_number \}\}[\s\S]*EXPECTED_HEAD_SHA: \$\{\{ needs\.validate\.outputs\.head_sha \}\}/u);
    assert.match(workflow, /ref: \$\{\{ steps\.pr\.outputs\.head_sha \}\}/u);
    assert.match(workflow, /HEAD_SHA: \$\{\{ steps\.pr\.outputs\.head_sha \}\}/u);
    assert.match(workflow, /TARGET_BRANCH: \$\{\{ steps\.pr\.outputs\.head_ref \}\}/u);
  }
});
