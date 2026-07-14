# Live Codex logs

Agent Relay writes Codex stdout and stderr incrementally as raw bytes while the job is running. Operators do not need to wait for process completion. The output is not redacted and can contain repository content, tool output, or secrets printed by child processes, so treat every live log and persisted file as sensitive execution data.

## Follow through Docker logs

```bash
docker compose logs -f agent-relay
```

Codex output is mirrored to the Agent Relay container stdout as soon as it is received, so it appears in the normal Docker log stream.

## Follow the persisted job log

```bash
bash scripts/follow-codex-logs.sh
```

The command waits until a job log exists, prints the selected path, shows the last 100 lines, and continues following appended output with `tail -F`.

Logs remain stored in the `relay-state` volume under `/var/lib/agent-relay/logs`. Agent Relay does not apply the former total-output cap or process-output redaction. The persisted file is the authoritative byte stream; Docker output is a live observability mirror.
