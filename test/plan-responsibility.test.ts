import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const humanActor = /\b(?:operator|reviewer|user|human|deployment owner)\b/i;
const obligation = /\b(?:must|should|needs? to|required to|has to|will need to|run|verify|record|configure|dispatch|rebuild|check)\b/i;
const rejectedContext = /\b(?:reject(?:ed)?|remove(?:d)?|forbid(?:den)?|not assigned|no .* task|do not)\b/i;
const manualTask = /\b(?:after (?:the )?merge|after merging|run locally|local verification request|manual (?:validation|verification|check|test|step|action|work)|manually (?:run|verify|check|record|configure|dispatch|rebuild))\b/i;

function validatePlan(source: string, completed: boolean): string[] {
  const violations: string[] = [];
  const lines = source.split(/\r?\n/);

  if (completed) {
    if (/^\s*-\s*\[\s\]/m.test(source)) violations.push("contains an unchecked item");
    if (/\[blocked\]/i.test(source)) violations.push("contains a blocked item");
    if (/^#{1,6}\s+.*remaining/i.test(source)) violations.push("contains a remaining-work section");
    if (/\b(?:remains active|remaining external validation|pending validation)\b/i.test(source)) {
      violations.push("contains pending completion language");
    }
  }

  for (const line of lines) {
    if (rejectedContext.test(line)) continue;
    if (manualTask.test(line) || (humanActor.test(line) && obligation.test(line))) {
      violations.push(`delegates work to a human: ${line.trim()}`);
    }
  }

  return violations;
}

async function markdownFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(directory, name));
}

test("repository rules forbid hidden human work delegation", async () => {
  const instructions = await readFile("AGENTS.md", "utf8");
  const rules = await readFile(".agent/PLANS.md", "utf8");

  assert.match(instructions, /Do not assign repository work to an operator, reviewer, user, or other human/);
  assert.match(instructions, /Do not convert the missing capability into a hidden human task/);
  assert.match(rules, /Every required implementation, validation, review, repository, and follow-up action must be executed by the agent or automated CI/);
  assert.match(rules, /Never convert missing access.*into work for an operator, reviewer, user, or other human/s);
  assert.match(rules, /A completed plan must contain no unchecked item, `\[blocked\]` item, pending validation, remaining task, after-merge action, or human-delegated work/);
});

test("completed plans contain no unfinished or human-delegated work", async () => {
  for (const path of await markdownFiles("docs/exec-plans/completed")) {
    const violations = validatePlan(await readFile(path, "utf8"), true);
    assert.deepEqual(violations, [], `${path}:\n${violations.join("\n")}`);
  }
});

test("active plans do not delegate work to humans", async () => {
  for (const path of await markdownFiles("docs/exec-plans/active")) {
    const violations = validatePlan(await readFile(path, "utf8"), false);
    assert.deepEqual(violations, [], `${path}:\n${violations.join("\n")}`);
  }
});

test("plan validation rejects hidden human follow-up patterns", () => {
  const examples = [
    "- [ ] Reviewer must run the final check.",
    "After merge, the operator should verify the deployment.",
    "Run the validation manually on the local host.",
    "## Remaining external validation",
  ];

  for (const source of examples) {
    assert.notDeepEqual(validatePlan(source, true), [], source);
  }
});
