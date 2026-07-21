# Agent Relay host initialization

This directory prepares a fresh Debian 13 (Trixie) x86-64 systemd host. It is run manually from an operator-controlled checkout. It does not install or register the GitHub Actions runner and never calls `install.sh`.

## Control machine

Use `ansible-core >= 2.18`. The role uses only `ansible.builtin` modules and keeps SSH host-key checking enabled.

## Target bootstrap state

The target needs only network access and root SSH. The playbook bootstraps Python 3, installs sudo and creates the operational administrator.

## Configure inventory

```bash
cd ansible
cp inventory/group_vars/all.yml.example inventory/group_vars/all.yml
$EDITOR inventory/example.ini inventory/group_vars/all.yml
```

`agent_relay_admin_authorized_keys` must contain at least one public SSH key. Do not commit private keys, passwords, GitHub tokens, Codex credentials or Vault secrets.

Additional ordinary APT packages can be declared without modifying the role:

```yaml
agent_relay_extra_apt_packages:
  - ripgrep
  - shellcheck
```

Packages requiring a repository or additional configuration need explicit role tasks.

## Run

```bash
cd ansible
ansible-playbook -i inventory/example.ini playbooks/host.yml
```

The role manages named paths only and does not recursively alter a checkout, runner payload, workspace, home, runtime or Docker data tree.

Runner, toolchain and host constants come from `../config/runner-host.json`. Continue with the runner installation procedure in [`../docs/operations/README.md`](../docs/operations/README.md).
