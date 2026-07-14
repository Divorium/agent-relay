import { loadConfig } from "./config/config.js";
import { JobStore } from "./persistence/job-store.js";
import { CodexExecutor } from "./execution/codex-executor.js";
import { JobService } from "./application/job-service.js";
import { createRelayServer } from "./api/server.js";

const config = loadConfig();
const store = new JobStore(config.stateDir);
const executor = new CodexExecutor(config.codexCommand, config.codexTimeoutMs, config.maxOutputBytes, config.codexRunAsUser);
const jobs = new JobService(config.workspaceRoot, config.stateDir, store, executor);
await jobs.init();
const server = createRelayServer(config, jobs);
server.listen(config.port, config.host, () => {
  process.stdout.write(`Agent Relay listening on ${config.host}:${config.port}\n`);
});
