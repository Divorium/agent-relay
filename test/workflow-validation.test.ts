import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowPaths = [
  ".github/workflows/agent-relay.yml",
  "examples/github-actions/agent-relay.yml",
];

test("Agent Relay validates the exact pull request revision before Codex", async () => {
  for (const path of workflowPaths) {
    const workflow = await readFile(path, "utf8");
    assert.match(workflow, /jobs:\n  validate:/u);
    assert.match(workflow, /validate:[\s\S]*ref: \$\{\{ steps\.pr\.outputs\.head_sha \}\}[\s\S]*run: npm ci[\s\S]*run: npm run check/u);
    assert.match(workflow, /outputs:[\s\S]*head_ref: \$\{\{ steps\.pr\.outputs\.head_ref \}\}[\s\S]*head_sha: \$\{\{ steps\.pr\.outputs\.head_sha \}\}/u);
    assert.match(workflow, /codex:\n    needs: validate\n    if: \$\{\{ needs\.validate\.result == 'success' \}\}/u);
    assert.match(workflow, /ref: \$\{\{ needs\.validate\.outputs\.head_sha \}\}/u);
    assert.match(workflow, /HEAD_SHA: \$\{\{ needs\.validate\.outputs\.head_sha \}\}/u);
    assert.match(workflow, /TARGET_BRANCH: \$\{\{ needs\.validate\.outputs\.head_ref \}\}/u);
    assert.doesNotMatch(workflow, /Verify resolved revision|git rev-parse HEAD|EXPECTED_HEAD_SHA/u);
  }
});
