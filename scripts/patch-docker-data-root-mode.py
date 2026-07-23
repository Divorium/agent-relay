from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text()
    if source.count(old) != 1:
        raise SystemExit(f"expected exactly one match in {path}: {old!r}")
    file_path.write_text(source.replace(old, new, 1))


replace_once(
    "ansible/roles/agent_relay_host/tasks/filesystem.yml",
    '    - { path: "{{ agent_relay_docker_root }}", mode: "0711" }\n',
    '    - { path: "{{ agent_relay_docker_root }}", mode: "0710" }\n',
)

replace_once(
    "install.sh",
    'require_directory "${DOCKER_ROOT}" 0 0 711\n',
    'require_directory "${DOCKER_ROOT}" 0 0 710\n',
)

replace_once(
    "test-system/install-script.integration.sh",
    '  chmod 0711 "${storage_root}/docker" "${docker_root}" "${containerd_root}"\n',
    '  chmod 0711 "${storage_root}/docker" "${containerd_root}"\n'
    '  chmod 0710 "${docker_root}"\n',
)

replace_once(
    "test/installer.test.ts",
    '  assert.match(filesystem, /register: agent_relay_runner_paths/);\n',
    '  assert.match(filesystem, /register: agent_relay_runner_paths/);\n'
    '  assert.match(filesystem, /agent_relay_storage_root \\}\\}", mode: "0711"/u);\n'
    '  assert.match(filesystem, /agent_relay_docker_root \\}\\}", mode: "0710"/u);\n'
    '  assert.match(filesystem, /agent_relay_containerd_root \\}\\}", mode: "0711"/u);\n'
    '  assert.match(install, /require_directory "\\$\\{DOCKER_STORAGE_ROOT\\}" 0 0 711/u);\n'
    '  assert.match(install, /require_directory "\\$\\{DOCKER_ROOT\\}" 0 0 710/u);\n'
    '  assert.match(install, /require_directory "\\$\\{CONTAINERD_ROOT\\}" 0 0 711/u);\n'
    '  assert.match(systemTest, /chmod 0710 "\\$\\{docker_root\\}"/u);\n',
)

replace_once(
    "ansible/README.md",
    'Docker keeps `/run/docker.sock` and also receives `/srv/github-runner/storage/docker-socket/docker.sock`. The dedicated directory is owned by `github-runner`, the socket is `root:docker` mode `0660`, and Codex receives only that directory as a writable sandbox root.\n',
    'Docker keeps `/run/docker.sock` and also receives `/srv/github-runner/storage/docker-socket/docker.sock`. The dedicated directory is owned by `github-runner`, the socket is `root:docker` mode `0660`, and Codex receives only that directory as a writable sandbox root.\n\n'
    'The parent Docker storage directory and the containerd root are `root:root` mode `0711`. The Docker daemon data root at `/srv/github-runner/storage/docker/engine` is `root:root` mode `0710`, matching the final mode enforced by Docker after daemon startup.\n',
)

replace_once(
    "docs/operations/README.md",
    'The Docker role keeps `/run/docker.sock` and adds `/srv/github-runner/storage/docker-socket/docker.sock`. When listener configuration changes, it stops `docker.service`, restarts `docker.socket`, and then starts Docker so `dockerd -H fd://` receives both descriptors.\n',
    'The Docker role keeps `/run/docker.sock` and adds `/srv/github-runner/storage/docker-socket/docker.sock`. When listener configuration changes, it stops `docker.service`, restarts `docker.socket`, and then starts Docker so `dockerd -H fd://` receives both descriptors.\n\n'
    'Ansible declares the final daemon-owned filesystem modes: `/srv/github-runner/storage/docker` and the containerd root are `root:root` mode `0711`, while Docker data root `/srv/github-runner/storage/docker/engine` is `root:root` mode `0710`. This prevents perpetual drift after Docker canonicalizes its data root during startup.\n',
)

replace_once(
    "docs/native-github-runner-specification.md",
    '`/srv/github-runner/storage/runner/_work` is a managed symlink to `../work`. Runtime stages are adjacent to `dist`; `dist.previous` exists only during a successful swap or interrupted recovery.\n',
    '`/srv/github-runner/storage/runner/_work` is a managed symlink to `../work`. Runtime stages are adjacent to `dist`; `dist.previous` exists only during a successful swap or interrupted recovery.\n\n'
    'The Docker storage parent and containerd root are `root:root` mode `0711`. The daemon-owned Docker data root is `root:root` mode `0710`; Ansible declares this post-startup state rather than restoring a conflicting pre-startup mode.\n',
)

replace_once(
    "docs/exec-plans/active/2026-07-23-fix-codex-docker-socket.md",
    '- Observation: reverting Git source does not remove an already deployed systemd drop-in.\n  Evidence: rollback of the dedicated socket requires an explicit cleanup revision or documented emergency removal.\n',
    '- Observation: reverting Git source does not remove an already deployed systemd drop-in.\n  Evidence: rollback of the dedicated socket requires an explicit cleanup revision or documented emergency removal.\n\n'
    '- Observation: the Docker daemon changes its data-root mode after Ansible creates the directory.\n  Evidence: the first real `host.yml` deployment reached `install.sh` after Docker startup and failed because `/srv/github-runner/storage/docker/engine` was mode `0710` while Ansible and the installer still required `0711`. The final declared contract now uses daemon-owned mode `0710` for Docker data and retains `0711` for the parent and containerd root.\n',
)

print("Docker data-root mode contract patched")
