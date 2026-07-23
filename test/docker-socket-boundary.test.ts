import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CodexEventNormalizer } from "../src/execution/codex-normalizer.js";
import {
  DOCKER_SOCKET_DIRECTORY,
  createCodexArgs,
  validateExecutionOutcome,
} from "../src/execution/codex-executor.js";

async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("host provisioning, launcher, and sandbox share one directory-based Docker socket contract", async () => {
  const hostContract = JSON.parse(await text("config/runner-host.json")) as { docker_socket_path: string };
  assert.equal(hostContract.docker_socket_path, "/srv/github-runner/storage/docker-socket/docker.sock");
  assert.equal(dirname(hostContract.docker_socket_path), DOCKER_SOCKET_DIRECTORY);

  const vars = await text("ansible/roles/agent_relay_host/vars/main.yml");
  const filesystem = await text("ansible/roles/agent_relay_host/tasks/filesystem.yml");
  const containers = await text("ansible/roles/agent_relay_host/tasks/containers.yml");
  const socketUnit = await text("ansible/roles/agent_relay_host/templates/docker-socket.conf.j2");
  const hostConfig = await text("scripts/host-config.sh");
  const launcher = await text("scripts/codex-run");

  assert.match(vars, /agent_relay_docker_socket_root: "\{\{ agent_relay_storage_root \}\}\/docker-socket"/u);
  assert.match(vars, /agent_relay_docker_socket_path: "\{\{ agent_relay_docker_socket_root \}\}\/docker\.sock"/u);
  assert.match(filesystem, /- "\{\{ agent_relay_docker_socket_root \}\}"/u);
  assert.match(filesystem, /owner: "\{\{ agent_relay_runner_user \}\}"[\s\S]*mode: "0700"/u);
  assert.match(containers, /\/etc\/systemd\/system\/docker\.socket\.d/u);
  assert.match(containers, /src: docker-socket\.conf\.j2/u);
  assert.match(containers, /agent_relay_docker_socket_config\.changed/u);
  assert.match(socketUnit, /ListenStream=\nListenStream=\/run\/docker\.sock/u);
  assert.match(socketUnit, /ListenStream=\{\{ agent_relay_docker_socket_path \}\}/u);
  assert.match(socketUnit, /SocketGroup=docker/u);
  assert.match(socketUnit, /RemoveOnStop=true/u);
  assert.match(hostConfig, /"DOCKER_SOCKET_PATH": "docker_socket_path"/u);
  assert.match(launcher, /host_config_load "\$\{host_config_path\}"/u);
  assert.match(launcher, /Docker socket root must be a regular directory/u);
  assert.match(launcher, /Docker socket must be a non-symlink Unix socket/u);
  assert.match(launcher, /toolchain_env\+=\("DOCKER_HOST=unix:\/\/\$\{DOCKER_SOCKET_PATH\}"\)/u);

  const args = createCodexArgs(
    "/runner/_work/repository/repository",
    "task prompt",
    "/home/user",
    "/home/user/.cache/runtime",
    "/srv/github-runner/storage/agent-relay",
  );
  const filesystemArgument = args.find((value) => value.startsWith("permissions.agent.filesystem="));
  assert.ok(filesystemArgument);
  assert.match(filesystemArgument, /"\/srv\/github-runner\/storage\/docker-socket"="write"/u);
  assert.doesNotMatch(filesystemArgument, /docker\.sock"="write"/u);
});

test("normalizer records command and file activity without counting reasoning or replay", () => {
  const normalizer = new CodexEventNormalizer();
  assert.equal(normalizer.executionActivityCount(), 0);

  [...normalizer.normalize({
    type: "item.started",
    item: { id: "reasoning-1", type: "reasoning", text: "Inspecting the repository" },
  })];
  assert.equal(normalizer.executionActivityCount(), 0);

  [...normalizer.normalize({
    type: "item.started",
    item: { id: "command-1", type: "command_execution", command: "pwd", aggregated_output: "" },
  })];
  assert.equal(normalizer.executionActivityCount(), 1);

  [...normalizer.normalize({
    type: "item.updated",
    item: { id: "command-1", type: "command_execution", command: "pwd", aggregated_output: "/repo\n" },
  })];
  [...normalizer.normalize({
    type: "item.completed",
    item: {
      id: "command-1",
      type: "command_execution",
      command: "pwd",
      aggregated_output: "/repo\n",
      status: "completed",
      exit_code: 0,
    },
  })];
  assert.equal(normalizer.executionActivityCount(), 1);

  normalizer.clearLifecycleState();
  assert.equal(normalizer.executionActivityCount(), 1);

  const fileNormalizer = new CodexEventNormalizer();
  [...fileNormalizer.normalize({
    type: "item.completed",
    item: { id: "file-1", type: "file_change", changes: [], status: "completed" },
  })];
  assert.equal(fileNormalizer.executionActivityCount(), 1);
});

test("successful Codex exit requires observable execution activity", () => {
  assert.deepEqual(validateExecutionOutcome(0, 1), { exitCode: 0 });
  assert.throws(
    () => validateExecutionOutcome(1, 1),
    /Codex exited with code 1/u,
  );
  assert.throws(
    () => validateExecutionOutcome(0, 0),
    /Codex completed without executing any command or file change/u,
  );
});
