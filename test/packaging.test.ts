import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

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

async function assertCopySourcesExist(path: string): Promise<void> {
  for (const instruction of instructions(await text(path))) {
    if (instruction.name !== "COPY" || /(?:^|\s)--from=/.test(instruction.args)) continue;
    const tokens = instruction.args.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    const positional = tokens.filter((token) => !token.startsWith("--"));
    for (const source of positional.slice(0, -1)) {
      const normalized = source.replace(/^"|"$/g, "").replace(/\/$/, "");
      assert.ok(normalized && !/[?*\[]/.test(normalized), `${path} COPY source must be explicit: ${source}`);
      await access(normalized);
    }
  }
}

test("service image defines the required toolchain and isolation users", async () => {
  const dockerfile = await text("Dockerfile");
  const parsed = instructions(dockerfile);

  assert.ok(parsed.some(({ name, args }) => name === "FROM" && args === "node:22-bookworm"));
  assert.ok(parsed.some(({ name, args }) => name === "ARG" && args === "CODEX_VERSION=0.144.3"));
  assert.ok(parsed.some(({ name, args }) => name === "RUN" && args.includes("useradd") && args.includes("agent")));
  assert.ok(parsed.some(({ name, args }) => name === "RUN" && args.includes("useradd") && args.includes("relay")));
  assert.ok(parsed.some(({ name, args }) => name === "RUN" && args.includes("apt-get purge -y openssh-client")));
  assert.ok(parsed.some(({ name, args }) => name === "RUN" && args.includes("relay ALL=(agent) NOPASSWD: /usr/local/bin/codex-run")));
  assert.equal(parsed.filter(({ name }) => name === "USER").at(-1)?.args, "relay");
  assert.deepEqual(parsed.filter(({ name }) => name === "CMD").at(-1)?.args, '["node", "dist/src/server.js"]');
  assert.ok(!dockerfile.includes("dotnet-sdk"));
  await assertCopySourcesExist("Dockerfile");
});

test("runner image contains the expected runner-owned entrypoints", async () => {
  const dockerfile = await text("Dockerfile.runner");
  const parsed = instructions(dockerfile);

  assert.ok(parsed.some(({ name, args }) => name === "FROM" && args === "debian:bookworm-slim"));
  assert.ok(parsed.some(({ name, args }) => name === "ARG" && args === "RUNNER_VERSION=2.325.0"));
  assert.equal(parsed.filter(({ name }) => name === "USER").at(-1)?.args, "runner");
  assert.deepEqual(parsed.filter(({ name }) => name === "ENTRYPOINT").at(-1)?.args, '["/entrypoint.sh"]');
  assert.ok(!/docker\.sock|docker-ce|docker-cli/.test(dockerfile));
  await assertCopySourcesExist("Dockerfile.runner");
});

test("Compose separates runner, Relay state and credentials", async () => {
  const compose = await text("compose.yml");
  const runner = compose.match(/\n  runner:\n([\s\S]*?)\n  agent-relay:/)?.[1] ?? "";
  const relay = compose.match(/\n  agent-relay:\n([\s\S]*?)\nvolumes:/)?.[1] ?? "";

  assert.match(runner, /workspace:\/runner\/_work/);
  assert.doesNotMatch(runner, /AGENT_RELAY_TOKEN|HOST_CODEX_AUTH_FILE|relay-state/);
  assert.match(relay, /AGENT_RELAY_TOKEN/);
  assert.match(relay, /workspace:\/runner\/_work/);
  assert.match(relay, /relay-state:\/var\/lib\/agent-relay/);
  assert.match(relay, /HOST_CODEX_AUTH_FILE.*:\/home\/agent\/\.codex\/auth\.json:ro/);
  assert.doesNotMatch(compose, /docker\.sock|privileged:\s*true/);
});

test("mandatory CI uses only the existing same-repository self-hosted runner", async () => {
  const workflow = await text(".github/workflows/ci.yml");

  assert.match(workflow, /runs-on: \[self-hosted, agent-relay\]/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run check/);
  assert.doesNotMatch(workflow, /ubuntu-latest|\bdocker\b|privileged|agent-relay-host/i);
});

test("Docker integration remains an explicit operator script, not a dead workflow", async () => {
  const script = await text("scripts/host-validation.sh");

  assert.match(script, /docker info/);
  assert.match(script, /docker compose config/);
  assert.match(script, /docker build --tag agent-relay:host-validation/);
  assert.match(script, /docker run --rm --entrypoint \/bin\/bash agent-relay:host-validation \/app\/scripts\/toolchain-smoke\.sh/);
  assert.match(script, /docker build --file Dockerfile\.runner/);
  assert.doesNotMatch(script, /--privileged|docker\.sock/);
  await assert.rejects(readFile(".github/workflows/host-validation.yml", "utf8"), /ENOENT/);
});
