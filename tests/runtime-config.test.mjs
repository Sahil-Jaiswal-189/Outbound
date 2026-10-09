import test from "node:test";
import assert from "node:assert/strict";
import { requestTimeout } from "../backend/runtime-config.mjs";

test("CPU inference deadlines are configurable and bounded without changing local defaults", () => {
  assert.equal(requestTimeout({}, "TABPFN_TIMEOUT_MS", 12000), 12000);
  assert.equal(requestTimeout({ TABPFN_TIMEOUT_MS: "90000" }, "TABPFN_TIMEOUT_MS", 12000), 90000);
  for (const value of ["", "invalid", "-1", "Infinity", "999", "120001"]) {
    assert.equal(requestTimeout({ OLLAMA_TIMEOUT_MS: value }, "OLLAMA_TIMEOUT_MS", 12000), 12000);
  }
});
