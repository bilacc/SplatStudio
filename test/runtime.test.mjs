import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findExecutableOnPath, publicRuntimeInfo, resolveRuntime } from "../runtime.js";

function withTempDir(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "splatstudio-runtime-"));
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("findExecutableOnPath honors Windows PATHEXT", () => withTempDir((root) => {
  const executable = path.join(root, "sample.EXE");
  fs.writeFileSync(executable, "");
  const found = findExecutableOnPath("sample", {
    platform: "win32",
    env: { PATH: root, PATHEXT: ".EXE;.COM" },
  });
  assert.equal(found?.toLowerCase(), executable.toLowerCase());
}));

test("resolveRuntime prefers platform and architecture-specific bundled tools", () => withTempDir((root) => {
  const architectureRoot = path.join(root, "win32-arm64");
  fs.mkdirSync(path.join(architectureRoot, "python"), { recursive: true });
  fs.writeFileSync(path.join(architectureRoot, "ffmpeg.exe"), "");
  fs.writeFileSync(path.join(architectureRoot, "colmap.exe"), "");
  fs.writeFileSync(path.join(architectureRoot, "python", "python.exe"), "");
  fs.writeFileSync(path.join(root, "train_splat.py"), "");
  fs.writeFileSync(path.join(root, "hardware_probe.py"), "");

  const runtime = resolveRuntime({
    binDir: root,
    platform: "win32",
    arch: "arm64",
    env: { PATH: "", PATHEXT: ".EXE" },
  });
  const info = publicRuntimeInfo(runtime);
  assert.equal(runtime.ffmpeg.source, "bundled");
  assert.equal(runtime.colmap.source, "bundled");
  assert.equal(runtime.python.source, "bundled");
  assert.equal(info.ready, true);
}));

test("configured paths take precedence over bundled and system tools", () => withTempDir((root) => {
  const configured = path.join(root, "configured-python.exe");
  fs.writeFileSync(configured, "");
  const runtime = resolveRuntime({
    binDir: root,
    platform: "win32",
    arch: "x64",
    env: { PATH: "", PATHEXT: ".EXE", PYTHON_PATH: configured },
  });
  assert.equal(runtime.python.path, path.resolve(configured));
  assert.equal(runtime.python.source, "configured");
}));

test("Windows ARM64 uses native media tools and the bundled x64 compute worker", () => withTempDir((root) => {
  const armRoot = path.join(root, "win32-arm64");
  const x64Root = path.join(root, "win32-x64");
  fs.mkdirSync(path.join(x64Root, "python"), { recursive: true });
  fs.mkdirSync(path.join(x64Root, "colmap", "bin"), { recursive: true });
  fs.mkdirSync(armRoot, { recursive: true });
  fs.writeFileSync(path.join(armRoot, "ffmpeg.exe"), "");
  fs.writeFileSync(path.join(x64Root, "python", "python.exe"), "");
  fs.writeFileSync(path.join(x64Root, "colmap", "bin", "colmap.exe"), "");

  const runtime = resolveRuntime({
    binDir: root,
    platform: "win32",
    arch: "arm64",
    env: { PATH: "", PATHEXT: ".EXE" },
  });
  assert.equal(runtime.ffmpeg.path, path.resolve(armRoot, "ffmpeg.exe"));
  assert.equal(runtime.python.path, path.resolve(x64Root, "python", "python.exe"));
  assert.equal(runtime.colmap.path, path.resolve(x64Root, "colmap", "bin", "colmap.exe"));
}));
