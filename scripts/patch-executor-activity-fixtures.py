from pathlib import Path


executor = Path("test/executor.integration.test.ts")
lines = executor.read_text().splitlines()


def find_after(marker: str, value: str) -> int:
    start = lines.index(marker)
    return next(index for index in range(start + 1, len(lines)) if lines[index] == value)


if not any('"command":"edit workspace"' in line for line in lines):
    marker = 'test("CodexExecutor streams redacted output and edits the workspace", async () => {'
    index = find_after(marker, '[ "\\${CODEX_RUNTIME_ROOT}" = "${runtimeRoot}" ]')
    lines.insert(
        index + 1,
        'printf \'%s\\n\' \'{"type":"item.completed","item":{"id":"command_0","type":"command_execution","command":"edit workspace","aggregated_output":"","status":"completed","exit_code":0}}\'',
    )

    marker = 'test("CodexExecutor caps output and emits one truncation marker", async () => {'
    index = find_after(
        marker,
        '  await writeFile(executable, "#!/bin/sh\\nprintf \'%s\\\\n\' \'{\\"type\\":\\"item.completed\\",\\"item\\":{\\"id\\":\\"item_0\\",\\"type\\":\\"agent_message\\",\\"text\\":\\"abcdefghijklmnopqrstuvwxyz\\"}}\'\\n", { mode: 0o700 });',
    )
    lines[index] = '  await writeFile(executable, "#!/bin/sh\\nprintf \'%s\\\\n\' \'{\\"type\\":\\"item.completed\\",\\"item\\":{\\"id\\":\\"command_0\\",\\"type\\":\\"command_execution\\",\\"command\\":\\"verbose\\",\\"aggregated_output\\":\\"abcdefghijklmnopqrstuvwxyz\\",\\"status\\":\\"completed\\",\\"exit_code\\":0}}\'\\n", { mode: 0o700 });'

    marker = 'test("CodexExecutor discards chunks received after the output limit", async () => {'
    index = find_after(
        marker,
        'printf \'%s\\\\n\' \'{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"abcdefghijklmnopqrstuvwxyz"}}\'',
    )
    lines[index] = 'printf \'%s\\\\n\' \'{"type":"item.completed","item":{"id":"command_0","type":"command_execution","command":"truncate","aggregated_output":"abcdefghijklmnopqrstuvwxyz","status":"completed","exit_code":0}}\''

    marker = 'test("CodexExecutor bounds a one-write child burst behind a slow live Writable", async () => {'
    index = find_after(marker, 'const records = Array.from({ length: 600 }, (_, index) => JSON.stringify({')
    lines[index:index + 5] = [
        'const activity = JSON.stringify({',
        '  type: "item.completed",',
        '  item: { id: "activity", type: "command_execution", command: "burst", aggregated_output: "", status: "completed", exit_code: 0 },',
        '});',
        'const records = Array.from({ length: 600 }, (_, index) => JSON.stringify({',
        '  type: "item.completed",',
        '  item: { id: "burst-" + index, type: "agent_message", text: index + ":" + "x".repeat(600) },',
        '})).join("\\\\n") + "\\\\n";',
        'process.stdout.write(activity + "\\\\n" + records);',
    ]

    marker = 'test("CodexExecutor accepts a valid final JSONL record without LF", async () => {'
    index = find_after(
        marker,
        '  await writeFile(executable, "#!/bin/sh\\nprintf \'%s\' \'{\\"type\\":\\"turn.started\\"}\'\\n", { mode: 0o700 });',
    )
    lines[index] = '  await writeFile(executable, "#!/bin/sh\\nprintf \'%s\' \'{\\"type\\":\\"item.completed\\",\\"item\\":{\\"id\\":\\"command_0\\",\\"type\\":\\"command_execution\\",\\"command\\":\\"final record\\",\\"aggregated_output\\":\\"\\",\\"status\\":\\"completed\\",\\"exit_code\\":0}}\'\\n", { mode: 0o700 });'
    index = find_after(marker, '    assert.equal(output, "[codex] turn started\\n");')
    lines[index] = '    assert.equal(output, "[codex] command completed: status=completed exit=0\\n");'

    marker = 'test("CodexExecutor bounds and labels multi-megabyte no-newline stderr", async () => {'
    index = find_after(marker, 'process.stderr.write("🧪".repeat(600_000));')
    lines.insert(
        index,
        'process.stdout.write(\'{"type":"item.completed","item":{"id":"command_0","type":"command_execution","command":"diagnostics","aggregated_output":"","status":"completed","exit_code":0}}\\\\n\');',
    )

    executor.write_text("\n".join(lines) + "\n")


trust = Path("test/trust.test.ts")
trust_lines = trust.read_text().splitlines()
if not any('"command":"inspect trust"' in line for line in trust_lines):
    old = '  await writeFile(fakeCodex, `#!/bin/sh\\nset -eu\\nprintf \'%s\\\\n\' "$@" > "${log}"\\n`, { mode: 0o700 });'
    index = trust_lines.index(old)
    trust_lines[index] = '  await writeFile(fakeCodex, `#!/bin/sh\\nset -eu\\nprintf \'%s\\\\n\' "$@" > "${log}"\\nprintf \'%s\\\\n\' \'{"type":"item.completed","item":{"id":"command_0","type":"command_execution","command":"inspect trust","aggregated_output":"","status":"completed","exit_code":0}}\'\\n`, { mode: 0o700 });'
    trust.write_text("\n".join(trust_lines) + "\n")
