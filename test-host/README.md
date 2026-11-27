# Debian real-host acceptance

Host acceptance on a designated or disposable Debian 13 x86-64 systemd host is separate from ordinary repository CI. See the [current validation contract](../docs/native-github-runner-specification.md#validation-contract) and [host operations](../docs/operations/README.md) for the required behavior. Docker Engine is provisioned for independent container-oriented CI; native Codex no longer has a dedicated Docker socket prerequisite (see [workflow-owned native Codex](../docs/job-managed-codex.md#existing-trust-boundary)).

This directory contains no executable acceptance harness. Repository tests and historical acceptance records do not establish successful deployment on a particular host. Real-host acceptance must run automatically on a designated or disposable host; do not assign command execution or result interpretation to a human operator.
