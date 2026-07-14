# Live Codex logs

Agent Relay writes redacted Codex stdout and stderr incrementally while the job is running. Operators do not need to wait for process completion.

## Follow through Docker logs

```bash
docker compose logs -f agent-relay
```

Codex output is written to the Agent Relay container stdout as soon as it is received, so it appears in the normal Docker log stream.

## Follow the persisted job log

```bash
bash scripts/follow-codex-logs.sh
```

The command waits until a job log exists, prints the selected path, shows the last 100 lines, and continues following appended output with `tail -F`.

Logs remain stored in the `relay-state` volume under `/var/lib/agent-relay/logs`. Output is subject to `MAX_OUTPUT_BYTES` and the existing Agent Relay redaction rules.
