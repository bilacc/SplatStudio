import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startServer } from "../server.js";

test("server exposes diagnostics and rejects a pipeline with a missing runtime", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "splatstudio-server-"));
  const staticDir = path.join(root, "dist");
  const binDir = path.join(root, "bin");
  fs.mkdirSync(staticDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>test</title>");

  const instance = await startServer({
    host: "127.0.0.1",
    port: 0,
    isPackaged: true,
    staticDir,
    binDir,
    workspaceRoot: path.join(root, "workspace"),
  });

  try {
    const runtimeResponse = await fetch(`${instance.url}/api/runtime-info`);
    assert.equal(runtimeResponse.status, 200);
    const runtime = await runtimeResponse.json();
    assert.equal(runtime.ready, false);
    assert.equal(runtime.platform, process.platform);
    assert.equal(runtime.arch, process.arch);

    const startResponse = await fetch(`${instance.url}/api/pipeline/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "auto", inputs: [] }),
    });
    assert.equal(startResponse.status, 503);
    const body = await startResponse.json();
    assert.ok(Array.isArray(body.missingTools));
    assert.ok(body.missingTools.includes("colmap"));
  } finally {
    await instance.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("server imports and serves a custom splat without conversion", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "splatstudio-import-"));
  const staticDir = path.join(root, "dist");
  const binDir = path.join(root, "bin");
  const source = path.join(root, "sample.splat");
  const bytes = Buffer.from([1, 2, 3, 4]);
  fs.mkdirSync(staticDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>test</title>");
  fs.writeFileSync(source, bytes);

  const instance = await startServer({
    host: "127.0.0.1",
    port: 0,
    isPackaged: true,
    staticDir,
    binDir,
    workspaceRoot: path.join(root, "workspace"),
  });

  try {
    const importResponse = await fetch(`${instance.url}/api/custom/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filePath: source }),
    });
    assert.equal(importResponse.status, 200);
    const imported = await importResponse.json();
    const modelResponse = await fetch(`${instance.url}${imported.url}`);
    assert.equal(modelResponse.status, 200);
    assert.deepEqual(Buffer.from(await modelResponse.arrayBuffer()), bytes);
  } finally {
    await instance.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
