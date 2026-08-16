# Run host provisioning as runneradmin with sudo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow `ansible/playbooks/host.yml` to run from the `runneradmin` account with `-k` by escalating host tasks through sudo.

**Architecture:** Enable play-level privilege escalation for the host provisioning play. Existing task-local `become_user` settings continue to select the administrator, builder, and GitHub runner identities. Keep the GitHub connection playbook's controller-side API tasks explicitly unprivileged.

**Tech Stack:** Ansible YAML, TypeScript contract tests, ansible-core syntax validation.

---

### Task 1: Add the privilege contract regression

**Files:**
- Modify: `test/host-deployment.test.ts`

Add a focused assertion that the host playbook enables `become` and the GitHub connection playbook keeps controller-side API calls unprivileged.

### Task 2: Enable host play escalation

**Files:**
- Modify: `ansible/playbooks/host.yml`

Change the host play's default from `become: false` to `become: true`. Do not add broad escalation to delegated GitHub API tasks, which already explicitly opt out.

### Task 3: Validate the Ansible contract

Run the focused contract test and syntax-check both permanent playbooks with the repository Ansible configuration. Report any unavailable full-repository or live-host validation honestly.
