# Live Codex logs

Agent Relay writes redacted Codex stdout and stderr incrementally while the job is running. Operators do not need to wait for process completion.

## Follow the newest job from the Docker host

```bash
bash scripts/follow-codex-logs.sh
```

The command waits until a job log exists, prints the selected path, shows the last 100 lines, and continues following appended output with `tail -F`.

## Stream a specific job through the API

```bash
curl --no-buffer \
  -H "Authorization: Bearer ${AGENT_RELAY_TOKEN}" \
  "http://agent-relay:8080/v1/jobs/${JOB_ID}/logs"
```

The endpoint uses chunked `text/plain` output. It sends existing content immediately, forwards new output as it is written, and closes after the job reaches a terminal state. It requires the same bearer token as other job APIs.

From the Docker host, where the relay port is not published, execute curl inside the runner network:

```bash
docker compose exec -T runner sh -lc \
  'curl --no-buffer -H "Authorization: Bearer ${AGENT_RELAY_TOKEN}" "http://agent-relay:8080/v1/jobs/'"${JOB_ID}"'/logs"'
```

Logs remain stored in the `relay-state` volume under `/var/lib/agent-relay/logs`. Output is subject to `MAX_OUTPUT_BYTES` and the existing Agent Relay redaction rules.
