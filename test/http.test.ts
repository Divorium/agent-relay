import test from "node:test";
import assert from "node:assert/strict";
import { readJson } from "../src/api/http.js";
import { RelayError } from "../src/contracts/errors.js";

function requestWithBody(body: string): any {
  return {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body, "utf8");
    },
  };
}

test("readJson enforces its limit in bytes for multibyte input", async () => {
  const body = JSON.stringify("😀".repeat(20));
  assert.ok(Buffer.byteLength(body, "utf8") > body.length);
  await assert.rejects(
    () => readJson(requestWithBody(body), body.length),
    (error: unknown) => error instanceof RelayError && error.statusCode === 413,
  );
});

test("readJson accepts valid JSON below the byte limit", async () => {
  const body = JSON.stringify({ value: "żółć" });
  assert.deepEqual(await readJson(requestWithBody(body), Buffer.byteLength(body, "utf8")), { value: "żółć" });
});
