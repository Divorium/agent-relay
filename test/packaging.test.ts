import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function instructions(source: string): Array<{ name: string; args: string }> {
  const logical: string[] = [];
  let current = "";
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    current += current ? ` ${line}` : line;
    if (current.endsWith("\\")) {
      current = current.slice(0, -1).trimEnd();
      continue;
    }
    logical.push(current);
    current = "";
  }
  if (current) logical.push(current);
  return logical.map((line) => {
    const separator = line.search(/\s/);
    if (separator < 0) return { name: line.toUpperCase(), args: "" };
    return { name: line.slice(0, separator).toUpperCase(), args: line.slice(separator).trim() };
  });
}

function yamlBlock(source: string, name: string, indent: number): string {
  const prefix = `${" ".repeat(indent)}${name}:\n`;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `Missing YAML block ${name}`);
  const bodyStart = start + prefix.length;
  const remainder = source.slice(bodyStart);
  const boundary = new RegExp(`\\n(?:${" ".repeat(indent)}[A-Za-z0-9_-]+:|[A-Za-z0-9_-]+:)\\n`).exec(remainder);
  return boundary ? remainder.slice(0, boundary.index) : remainder;
}

async function assertCopySourcesExist(path: string): Promise<void> {
  for (const instruction of instructions(await text(path))) {
    if (instruction.name !== "COPY" || /(?:^|\s)--from=/.test(instruction.args)) continue;
    const tokens = instruction.args.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    const positional = tokens.filter((token) => !token.startsWith("--"));
    for (const source of positional.slice(0, -1)) {
      const normalized = source.replace(/^"|"$/g, "").replace(/\/$/, "");
      assert.ok(normalized && !/[?*\[]/.test(normalized), `${path} COPY source must be explicit: ${source}`);
      await stat(normalized);
    }
  }
}

test("service image definition contains the required toolchain and one non-root runtime user", async () => {
  const dockerfile = await text("Dockerfile");
  const parsed = instructions(dockerfile);

  assert.ok(parsed.some(({ name, args }) => name === "FROM" && args === "node:22-bookworm"));
  assert.ok(parsed.some(({ name, args }) => name === "ARG" && args === "CODEX_VERSION=0.144.3"));
  assert.ok(parsed.some(({ name, args }) => name === "RUN" && args.includes("useradd") && args.includes("agent")));
  assert.ok(parsed.some(({ name, args }) => name === "RUN" && args.includes("apt-get purge -y openssh-client")));
  assert.doesNotMatch(dockerfile, /groupadd --system relay|useradd --system[^\n]* relay|sudoers/);
  assert.doesNotMatch(dockerfile, /\s+sudo\s*\\/);
  assert.equal(parsed.filter(({ name }) => name === "USER").at(-1)?.args, "agent");
  assert.deepEqual(parsed.filter(({ name }) => name === "CMD").at(-1)?.args, '["node", "dist/src/server.js"]');
  assert.ok(!dockerfile.includes("/home/relay"));
  assert.ok(!dockerfile.includes("dotnet-sdk"));
  await assertCopySourcesExist("Dockerfile");
});

test("runner image definition contains the expected runner-owned entrypoints", async () => {
  const dockerfile = await text("Dockerfile.runner");
  const parsed = instructions(dockerfile);

  assert.ok(parsed.some(({ name, args }) => name === "FROM" && args === "debian:bookworm-slim"));
  assert.ok(parsed.some(({ name, args }) => name === "ARG" && args === "RUNNER_VERSION=2.325.0"));
  assert.equal(parsed.filter(({ name }) => name === "USER").at(-1)?.args, "runner");
  assert.deepEqual(parsed.filter(({ name }) => name === "ENTRYPOINT").at(-1)?.args, '["/entrypoint.sh"]');
  assert.ok(!/docker\.sock|docker-ce|docker-cli/.test(dockerfile));
  await assertCopySourcesExist("Dockerfile.runner");
});

test("Compose definition separates runner, state initialization, Relay state and credentials", async () => {
  const compose = await text("compose.yml");
  const runner = yamlBlock(compose, "runner", 2);
  const stateInit = yamlBlock(compose, "agent-relay-state-init", 2);
  const relay = yamlBlock(compose, "agent-relay", 2);

  assert.match(runner, /workspace:\/runner\/_work/);
  assert.doesNotMatch(runner, /AGENT_RELAY_TOKEN|HOST_CODEX_AUTH_FILE|relay-state/);

  assert.match(stateInit, /user: "0:0"/);
  assert.match(stateInit, /network_mode: none/);
  assert.match(stateInit, /read_only: true/);
  assert.match(stateInit, /no-new-privileges:true/);
  assert.match(stateInit, /relay-state:\/var\/lib\/agent-relay/);
  assert.doesNotMatch(stateInit, /AGENT_RELAY_TOKEN|HOST_CODEX_AUTH_FILE|workspace:\/runner\/_work/);

  assert.match(relay, /AGENT_RELAY_TOKEN/);
  assert.match(relay, /workspace:\/runner\/_work/);
  assert.match(relay, /relay-state:\/var\/lib\/agent-relay/);
  assert.match(relay, /HOST_CODEX_AUTH_FILE.*:\/home\/agent\/\.codex\/auth\.json:ro/);
  assert.match(relay, /agent-relay-state-init:[\s\S]*condition: service_completed_successfully/);
  assert.doesNotMatch(compose, /docker\.sock|privileged:\s*true/);
});

test("mandatory repository checks stay self-hosted and Docker integration stays isolated", async () => {
  const workflow = await text(".github/workflows/ci.yml");
  const repositoryChecks = yamlBlock(workflow, "test", 2);
  const stateVolumeIntegration = yamlBlock(workflow, "state-volume-integration", 2);

  assert.match(repositoryChecks, /runs-on: \[self-hosted, agent-relay\]/);
  assert.match(repositoryChecks, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(repositoryChecks, /persist-credentials: false/);
  assert.match(repositoryChecks, /npm ci/);
  assert.match(repositoryChecks, /npm run check/);
  assert.match(repositoryChecks, /GITHUB_STEP_SUMMARY/);
  assert.match(repositoryChecks, /# start of coverage report/);
  assert.doesNotMatch(repositoryChecks, /ubuntu-latest|\bdocker\b|privileged|agent-relay-host/i);

  assert.match(stateVolumeIntegration, /runs-on: ubuntu-latest/);
  assert.match(stateVolumeIntegration, /compose-state-permissions\.test\.sh/);
  assert.doesNotMatch(workflow, /docker\.sock|privileged|agent-relay-host/i);
});

test("repository validation does not invoke Docker or GitHub APIs", async () => {
  const packageJson = await text("package.json");
  assert.match(packageJson, /--experimental-test-coverage/);
  assert.doesNotMatch(packageJson, /host-validation|docker compose|docker build|gh api|api\.github\.com/i);
  await assert.rejects(readFile("scripts/host-validation.sh", "utf8"), /ENOENT/);
  await assert.rejects(readFile(".github/workflows/host-validation.yml", "utf8"), /ENOENT/);
});
