#!/usr/bin/env node
import { appendFile, mkdir, open, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { once } from "node:events";

const baseUrl = process.env.AGENT_RELAY_URL ?? "http://agent-relay:8080";
const token = process.env.AGENT_RELAY_TOKEN;
if (!token) throw new Error("AGENT_RELAY_TOKEN is required");
const workspace = process.env.GITHUB_WORKSPACE;
const workspaceRoot = process.env.AGENT_RELAY_WORKSPACE_ROOT ?? "/runner/_work";
const planPath = process.env.AGENT_RELAY_PLAN_PATH;
const mode = process.env.AGENT_RELAY_MODE ?? "implement";
const requestId = process.env.AGENT_RELAY_REQUEST_ID ?? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
if (!workspace || !planPath) throw new Error("GITHUB_WORKSPACE and AGENT_RELAY_PLAN_PATH are required");

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi,
  /("?(?:token|password|secret|apiKey|api_key)"?\s*[:=]\s*(?:["']?))[^\s,"']+((?:["']?))/gi,
];

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

const requestTimeoutMs = positiveInteger("AGENT_RELAY_REQUEST_TIMEOUT_MS", 30_000);
const pollIntervalMs = positiveInteger("AGENT_RELAY_POLL_INTERVAL_MS", 5_000);
const pollTimeoutMs = positiveInteger("AGENT_RELAY_POLL_TIMEOUT_MS", 21_900_000);
const outputIdleMs = positiveInteger("AGENT_RELAY_OUTPUT_IDLE_MS", 60_000);
const githubLogBytes = positiveInteger("AGENT_RELAY_GITHUB_LOG_BYTES", 10_000_000);
const githubTailBytes = positiveInteger("AGENT_RELAY_GITHUB_TAIL_BYTES", 1_000_000);
const outputArchivePath = process.env.AGENT_RELAY_OUTPUT_ARCHIVE_PATH;
const normalizedWorkspaceRoot = workspaceRoot.replace(/\/$/, "");
const workspacePrefix = `${normalizedWorkspaceRoot}/`;
if (!workspace.startsWith(workspacePrefix)) throw new Error(`GITHUB_WORKSPACE must be below ${workspacePrefix}`);
const relativeWorkspace = workspace.slice(workspacePrefix.length);
if (!relativeWorkspace) throw new Error("GITHUB_WORKSPACE does not identify a repository workspace");

function asObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

function strictKeys(value, allowed, name) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown ${name} field: ${key}`);
}

function requiredString(value, name, maxLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || CONTROL_CHARACTERS.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function stringArray(value, name, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`Invalid ${name}`);
  return value.map((item, index) => requiredString(item, `${name}[${index}]`, maxLength));
}

function validateValidation(value, index) {
  const record = asObject(value, `validation[${index}]`);
  strictKeys(record, new Set(["command", "status", "exitCode", "details"]), `validation[${index}]`);
  const command = requiredString(record.command, `validation[${index}].command`, 500);
  if (!["passed", "failed", "skipped"].includes(record.status)) throw new Error(`Invalid validation[${index}].status`);
  const details = requiredString(record.details, `validation[${index}].details`, 2000);
  if (record.exitCode !== undefined && (!Number.isInteger(record.exitCode) || record.exitCode < 0 || record.exitCode > 255)) {
    throw new Error(`Invalid validation[${index}].exitCode`);
  }
  return { command, status: record.status, ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }), details };
}

function assertNoSensitiveData(value) {
  const serialized = JSON.stringify(value);
  if (/auth\.json|\.ssh\/|BEGIN [A-Z ]*PRIVATE KEY/i.test(serialized)) throw new Error("Result contains sensitive data");
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(serialized)) throw new Error("Result contains sensitive data");
  }
}

function validateResult(value) {
  assertNoSensitiveData(value);
  const result = asObject(value, "result");
  strictKeys(result, new Set(["schemaVersion", "requestId", "status", "commitMessage", "summary", "validation", "blockers", "limitations"]), "result");
  if (result.schemaVersion !== 1 || result.requestId !== requestId) throw new Error("Result contract mismatch");
  if (result.status !== "completed" && result.status !== "blocked") throw new Error("Invalid result status");

  const summary = requiredString(result.summary, "summary", 4000);
  if (!Array.isArray(result.validation) || result.validation.length > 100) throw new Error("Invalid validation");
  const validation = result.validation.map(validateValidation);
  const blockers = stringArray(result.blockers, "blockers", 50, 2000);
  const limitations = stringArray(result.limitations, "limitations", 50, 2000);

  let commitMessage;
  if (result.status === "completed") {
    commitMessage = requiredString(result.commitMessage, "commitMessage", 120);
    if (commitMessage.includes("\n") || commitMessage.includes("\r")) throw new Error("Invalid commitMessage");
  } else if (result.commitMessage !== undefined) {
    throw new Error("Unexpected commitMessage");
  }

  return {
    schemaVersion: 1,
    requestId,
    status: result.status,
    ...(commitMessage === undefined ? {} : { commitMessage }),
    summary,
    validation,
    blockers,
    limitations,
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(requestTimeoutMs) });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Agent Relay request failed: ${response.status} ${text}`);
    error.status = response.status;
    error.body = text;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Agent Relay returned invalid JSON");
  }
}

async function writeBuffer(stream, buffer) {
  if (buffer.length === 0) return;
  if (!stream.write(buffer)) await once(stream, "drain");
}

async function writeText(stream, text) {
  if (text.length === 0) return;
  if (!stream.write(text)) await once(stream, "drain");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalStatus(status) {
  return status === "completed" || status === "blocked" || status === "failed" || status === "timed_out" || status === "interrupted";
}

function logJobStatus(job) {
  console.log(`Agent Relay job ${String(job.id ?? "unknown")}: ${String(job.status ?? "unknown")}`);
}

async function runGitStatus(workspaceDir) {
  const diff = spawnSync("git", ["status", "--porcelain"], { cwd: workspaceDir, encoding: "utf8" });
  if (diff.status !== 0) throw new Error(diff.stderr || "git status failed");
  return diff.stdout.trim().length > 0;
}

async function openArchiveIfConfigured() {
  if (!outputArchivePath) return undefined;
  try {
    await mkdir(dirname(outputArchivePath), { recursive: true });
    return await open(outputArchivePath, "w", 0o600);
  } catch (error) {
    await writeText(process.stderr, `[Agent Relay] raw archive unavailable, switching to tail-only mode: ${error.message ?? error}\n`);
    return undefined;
  }
}

function appendToTail(state, chunk) {
  state.tailChunks.push(chunk);
  state.tailBytes += chunk.length;
  while (state.tailBytes > githubTailBytes && state.tailChunks.length > 0) {
    const first = state.tailChunks[0];
    const overflow = state.tailBytes - githubTailBytes;
    if (first.length <= overflow) {
      state.tailChunks.shift();
      state.tailBytes -= first.length;
      continue;
    }
    state.tailChunks[0] = first.subarray(overflow);
    state.tailBytes -= overflow;
  }
}

function buildTailBuffer(state) {
  if (state.tailBytes === 0) return Buffer.alloc(0);
  return Buffer.concat(state.tailChunks, state.tailBytes);
}

async function writeFully(handle, buffer) {
  let written = 0;
  while (written < buffer.length) {
    const result = await handle.write(buffer.subarray(written));
    if (result.bytesWritten <= 0) throw new Error("archive write returned no progress");
    written += result.bytesWritten;
  }
}

async function appendArchive(handle, buffer) {
  await writeFully(handle, buffer);
}

async function fetchOutputResponse(jobId, offset, signal) {
  return await fetch(`${baseUrl}/v1/jobs/${jobId}/output?offset=${offset}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/octet-stream",
    },
    signal,
  });
}

async function streamOnce(state, jobId, deadlineAt) {
  if (Date.now() >= deadlineAt) throw new Error(`Agent Relay output drain timed out after ${pollTimeoutMs}ms`);
  const controller = new AbortController();
  let idleTimer;
  let deadlineTimer;
  let idleExpired = false;
  let deadlineExpired = false;

  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleExpired = true;
      controller.abort();
    }, outputIdleMs);
  };

  try {
    deadlineTimer = setTimeout(() => {
      deadlineExpired = true;
      controller.abort();
    }, Math.max(1, deadlineAt - Date.now()));
    armIdleTimer();

    let response;
    try {
      response = await fetchOutputResponse(jobId, state.confirmedOffset, controller.signal);
    } catch (error) {
      if (idleExpired) return { kind: "idle" };
      if (deadlineExpired || controller.signal.aborted) throw new Error(`Agent Relay output drain timed out after ${pollTimeoutMs}ms`);
      return { kind: "request-failed", error };
    }

    if (response.status === 416) {
      const text = await response.text();
      return { kind: "offset-too-high", error: new Error(`Agent Relay output request rejected: ${response.status} ${text}`) };
    }
    if (!response.ok) {
      const text = await response.text();
      return { kind: "request-failed", error: new Error(`Agent Relay output request failed: ${response.status} ${text}`) };
    }

    const reader = response.body?.getReader();
    if (!reader) return { kind: "request-failed", error: new Error("Agent Relay returned a response without a body") };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return { kind: "eof" };
        armIdleTimer();
        const chunk = Buffer.from(value);
        await handleRawChunk(state, chunk);
      }
    } catch (error) {
      if (idleExpired) return { kind: "idle" };
      if (deadlineExpired || controller.signal.aborted) throw new Error(`Agent Relay output drain timed out after ${pollTimeoutMs}ms`);
      return { kind: "disconnect", error };
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(deadlineTimer);
  }
}

async function handleRawChunk(state, chunk) {
  if (state.archiveHandle) {
    try {
      await appendArchive(state.archiveHandle, chunk);
    } catch (error) {
      await closeAndRemoveArchive(state);
      state.archiveFallback = true;
      await writeText(process.stderr, `[Agent Relay] raw archive write failed, switching to tail-only mode: ${error.message ?? error}\n`);
      appendToTail(state, chunk);
      state.confirmedOffset += chunk.length;
      state.totalReceived += chunk.length;
      return;
    }
  }

  appendToTail(state, chunk);
  if (state.archiveHandle && state.livePrinted < githubLogBytes) {
    const liveBytes = Math.min(chunk.length, githubLogBytes - state.livePrinted);
    if (liveBytes > 0) {
      await ensureRawDisplayStarted(state);
      const slice = chunk.subarray(0, liveBytes);
      await writeBuffer(process.stdout, slice);
      state.livePrinted += slice.length;
      state.lastRawByte = slice[slice.length - 1];
    }
  }

  state.confirmedOffset += chunk.length;
  state.totalReceived += chunk.length;
  if (chunk.length > 0) state.lastRawByte = chunk[chunk.length - 1];
}

async function ensureRawDisplayStarted(state) {
  if (state.rawDisplayStarted) return;
  await writeText(process.stdout, `::stop-commands::${state.stopCommandsToken}\n`);
  state.rawDisplayStarted = true;
}

async function closeAndRemoveArchive(state) {
  if (!state.archiveHandle) return;
  const handle = state.archiveHandle;
  state.archiveHandle = undefined;
  await handle.close().catch(() => undefined);
  if (state.archivePath) await rm(state.archivePath, { force: true }).catch(() => undefined);
}

async function finalizeOutput(state) {
  let finalMarkerNeeded = false;
  let finalMarkerText = "";
  let finalTail = Buffer.alloc(0);
  if (state.archiveHandle) {
    try {
      await state.archiveHandle.sync().catch(() => undefined);
      await state.archiveHandle.close();
      state.archiveComplete = true;
    } catch (error) {
      state.archiveComplete = false;
      await rm(state.archivePath, { force: true }).catch(() => undefined);
      await writeText(process.stderr, `[Agent Relay] complete archive could not be finalized and was removed: ${error.message ?? error}\n`);
    } finally {
      state.archiveHandle = undefined;
    }
  }

  const suppressionExists = state.totalReceived > state.livePrinted;
  if (!state.archiveComplete || suppressionExists) {
    finalMarkerNeeded = true;
    finalMarkerText = state.archiveComplete
      ? "[Agent Relay] live raw output was truncated; the final tail follows.\n"
      : "[Agent Relay] complete archive is unavailable; the final tail follows.\n";
    finalTail = buildTailBuffer(state);
    const tailStart = state.totalReceived - finalTail.length;
    const finalTailStart = Math.max(state.livePrinted, tailStart);
    finalTail = finalTail.subarray(finalTailStart - tailStart);
  }

  if (finalMarkerNeeded || finalTail.length > 0 || state.rawDisplayStarted) {
    await ensureRawDisplayStarted(state);
  }

  if (finalMarkerNeeded) {
    if (state.lastRawByte !== undefined && state.lastRawByte !== 10) {
      await writeText(process.stdout, "\n");
    }
    await writeText(process.stdout, finalMarkerText);
  }

  if (finalTail.length > 0) {
    if (state.lastRawByte !== undefined && state.lastRawByte !== 10) {
      await writeText(process.stdout, "\n");
    }
    await writeBuffer(process.stdout, finalTail);
    state.lastRawByte = finalTail[finalTail.length - 1];
  }

  if (state.rawDisplayStarted) {
    if (state.lastRawByte !== undefined && state.lastRawByte !== 10) {
      await writeText(process.stdout, "\n");
    }
    await writeText(process.stdout, `::${state.stopCommandsToken}::\n`);
  }

  state.archiveComplete = state.archiveComplete && !state.archiveFallback;
}

function createOutputState() {
  return {
    confirmedOffset: 0,
    totalReceived: 0,
    livePrinted: 0,
    tailChunks: [],
    tailBytes: 0,
    archiveHandle: undefined,
    archivePath: outputArchivePath,
    archiveComplete: !outputArchivePath,
    archiveFallback: false,
    rawDisplayStarted: false,
    stopCommandsToken: randomBytes(32).toString("hex"),
    lastRawByte: undefined,
  };
}

async function runOutputPipeline(state, job) {
  const deadlineAt = Date.now() + pollTimeoutMs;
  let status = job;

  while (Date.now() < deadlineAt) {
    const outcome = await streamOnce(state, job.id, deadlineAt);
    if (outcome.kind === "request-failed") {
      const statusAfterFailure = await fetchJson(`${baseUrl}/v1/jobs/${job.id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (statusAfterFailure.status !== status.status) {
        logJobStatus(statusAfterFailure);
      }
      status = statusAfterFailure;
      if (Date.now() >= deadlineAt) break;
      await sleep(Math.min(pollIntervalMs, 1000));
      continue;
    }
    if (outcome.kind === "offset-too-high" || outcome.kind === "disconnect" || outcome.kind === "idle" || outcome.kind === "eof") {
      const nextStatus = await fetchJson(`${baseUrl}/v1/jobs/${job.id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (nextStatus.status !== status.status) logJobStatus(nextStatus);
      status = nextStatus;
      if (isTerminalStatus(status.status) && outcome.kind === "eof") {
        return status;
      }
      if (Date.now() >= deadlineAt) break;
      await sleep(Math.min(pollIntervalMs, 1000));
      continue;
    }
    throw outcome.error;
  }

  throw new Error(`Agent Relay output drain timed out after ${pollTimeoutMs}ms`);
}

async function main() {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const job = await fetchJson(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ requestId, workspace: relativeWorkspace, planPath, mode }),
  });
  logJobStatus(job);

  const outputState = createOutputState();
  outputState.archiveHandle = await openArchiveIfConfigured();
  if (!outputState.archiveHandle && outputArchivePath) outputState.archiveFallback = true;

  let failure;
  try {
    await runOutputPipeline(outputState, job);

    const finalJob = await fetchJson(`${baseUrl}/v1/jobs/${job.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (finalJob.status !== "completed" && finalJob.status !== "blocked") {
      throw new Error(`Agent Relay job failed: ${finalJob.status} ${finalJob.errorCode ?? ""} ${finalJob.errorMessage ?? ""}`);
    }

    const result = validateResult(JSON.parse(await readFile(`${workspace}/.agent-relay/result.json`, "utf8")));
    if (result.status === "blocked") throw new Error(`Codex blocked: ${result.blockers.join("; ")}`);

    const hasChanges = await runGitStatus(workspace);
    await rm(`${workspace}/.agent-relay`, { recursive: true, force: true });

    console.log(`Codex summary: ${result.summary}`);
    for (const validation of result.validation) {
      console.log(`Validation ${validation.status}: ${validation.command} - ${validation.details}`);
    }

    if (!hasChanges) return;
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (!githubOutput) throw new Error("GITHUB_OUTPUT is required when the worktree changed");
    await appendFile(githubOutput, `commit_message=${result.commitMessage}\n`, "utf8");
  } catch (error) {
    failure = error;
  } finally {
    try {
      await finalizeOutput(outputState);
    } catch (error) {
      if (!failure) failure = error;
    }
  }
  if (failure) throw failure;
}

await main();
