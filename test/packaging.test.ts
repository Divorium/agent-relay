import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("service image keeps the required toolchain and isolation users", async () => {
  const dockerfile = await text("Dockerfile");

  assert.match(dockerfile, /FROM node:22-bookworm/);
  assert.match(dockerfile, /ARG CODEX_VERSION=0\.144\.3/);
  assert.match(dockerfile, /npm install --global[\s\S]*@openai\/codex@\$\{CODEX_VERSION\}/);
  assert.match(dockerfile, /useradd[\s\S]*agent/);
  assert.match(dockerfile, /useradd[\s\S]*relay/);
  assert.match(dockerfile, /apt-get purge -y openssh-client/);
  assert.match(dockerfile, /relay ALL=\(agent\) NOPASSWD: \/usr\/local\/bin\/codex-run/);
  assert.match(dockerfile, /chown -R root:root \/home\/agent\/\.cargo \/home\/agent\/\.rustup/);
  assert.match(dockerfile, /chmod -R a-w \/home\/agent\/\.cargo \/home\/agent\/\.rustup/);
  assert.match(dockerfile, /chmod -R o-rwx \/app/);
  assert.match(dockerfile, /CMD \["node", "dist\/src\/server\.js"\]/);
  assert.doesNotMatch(dockerfile, /dotnet-sdk/);
});

test("runner image contains only runner-owned entrypoints", async () => {
  const dockerfile = await text("Dockerfile.runner");

  assert.match(dockerfile, /FROM debian:bookworm-slim/);
  assert.match(dockerfile, /ARG RUNNER_VERSION=2\.325\.0/);
  assert.match(dockerfile, /useradd[\s\S]*runner/);
  assert.match(dockerfile, /COPY --chown=runner:runner runner\/entrypoint\.sh \/entrypoint\.sh/);
  assert.match(dockerfile, /COPY --chown=runner:runner runner\/client\.mjs \/runner\/client\.mjs/);
  assert.match(dockerfile, /COPY --chown=runner:runner runner\/resolve-pr\.mjs \/runner\/resolve-pr\.mjs/);
  assert.match(dockerfile, /COPY --chown=runner:runner runner\/finalize\.sh \/runner\/finalize\.sh/);
  assert.match(dockerfile, /ENTRYPOINT \["\/entrypoint\.sh"\]/);
  assert.doesNotMatch(dockerfile, /docker\.sock|docker-ce|docker-cli/);
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

test("mandatory CI is daemon-independent and still runs the full repository suite", async () => {
  const workflow = await text(".github/workflows/ci.yml");

  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run check/);
  assert.doesNotMatch(workflow, /\bdocker\b|privileged|self-hosted/i);
});

test("real image validation is retained on a native Docker host runner", async () => {
  const workflow = await text(".github/workflows/host-validation.yml");
  const script = await text("scripts/host-validation.sh");

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /runs-on: \[self-hosted, agent-relay-host\]/);
  assert.match(workflow, /bash scripts\/host-validation\.sh/);
  assert.doesNotMatch(workflow, /pull_request:|--privileged|docker\.sock/);

  assert.match(script, /docker info/);
  assert.match(script, /docker compose config/);
  assert.match(script, /docker build --tag agent-relay:host-validation/);
  assert.match(script, /docker run --rm --entrypoint \/bin\/bash agent-relay:host-validation \/app\/scripts\/toolchain-smoke\.sh/);
  assert.match(script, /docker build --file Dockerfile\.runner/);
  assert.doesNotMatch(script, /--privileged|docker\.sock/);
});
