#!/usr/bin/env node
import { appendFile } from "node:fs/promises";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value || CONTROL_CHARACTERS.test(value)) throw new Error(`${name} is required and must not contain control characters`);
  return value;
}

function positivePullRequestNumber(value) {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error("Pull request number must be a positive integer");
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("Pull request number is outside the supported range");
  return String(number);
}

export async function main() {
  const eventName = requiredEnvironment("EVENT_NAME");
  const outputPath = requiredEnvironment("GITHUB_OUTPUT");
  let value;
  if (eventName === "pull_request") value = requiredEnvironment("EVENT_PR_NUMBER");
  else if (eventName === "workflow_dispatch") value = requiredEnvironment("INPUT_PR_NUMBER");
  else throw new Error(`Unsupported event: ${eventName}`);
  const pullRequestNumber = positivePullRequestNumber(value);
  await appendFile(outputPath, `pr_number=${pullRequestNumber}\n`, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
