#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePullRequestNumber(value) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("PR_NUMBER must be a positive integer");
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("PR_NUMBER is outside the supported range");
  return number;
}

function requiredString(value, name, maxLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || CONTROL_CHARACTERS.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

async function main() {
  const token = requiredEnvironment("GITHUB_TOKEN");
  const repository = requiredEnvironment("GITHUB_REPOSITORY");
  const outputPath = requiredEnvironment("GITHUB_OUTPUT");
  const pullRequestNumber = parsePullRequestNumber(requiredEnvironment("PR_NUMBER"));
  const apiUrl = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "");

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid GITHUB_REPOSITORY");

  const response = await fetch(`${apiUrl}/repos/${repository}/pulls/${pullRequestNumber}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 404) throw new Error(`Pull request #${pullRequestNumber} was not found`);
  if (!response.ok) throw new Error(`GitHub pull request lookup failed with status ${response.status}`);

  const pullRequest = await response.json();
  if (pullRequest.number !== pullRequestNumber) throw new Error("GitHub returned a different pull request");
  if (pullRequest.state !== "open") throw new Error(`Pull request #${pullRequestNumber} is not open`);
  if (pullRequest.draft !== false) throw new Error(`Pull request #${pullRequestNumber} is not ready for review`);
  if (pullRequest.head?.repo?.full_name !== repository) throw new Error("Pull request head must belong to the target repository");

  const headRef = requiredString(pullRequest.head?.ref, "pull request head ref", 255);
  const headSha = requiredString(pullRequest.head?.sha, "pull request head SHA", 40);
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error("Invalid pull request head SHA");

  const refCheck = spawnSync("git", ["check-ref-format", "--branch", headRef], { encoding: "utf8" });
  if (refCheck.status !== 0) throw new Error("Invalid pull request head ref");

  await appendFile(outputPath, `head_ref=${headRef}\nhead_sha=${headSha}\n`, "utf8");
  console.log(`Resolved ready pull request #${pullRequestNumber} at ${headRef} (${headSha})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
