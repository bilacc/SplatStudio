import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildRuntimeEnv, resolveRuntime } from "../runtime.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binDir = path.join(projectRoot, "bin");
const runtime = resolveRuntime({ binDir, platform: "win32", arch: "x64" });
const failures = [];

for (const name of ["ffmpeg", "colmap", "python"]) {
  if (!runtime[name]?.path) failures.push(`${name} executable is missing`);
}
for (const name of ["trainer", "hardwareProbe"]) {
  if (!runtime[name]) failures.push(`${name} script is missing`);
}

const manifestPath = path.join(binDir, "runtime-manifest.json");
if (!fs.existsSync(manifestPath)) failures.push("runtime-manifest.json is missing");
if (!fs.existsSync(path.join(binDir, "win32-arm64", "ffmpeg.exe"))) {
  failures.push("native Windows ARM64 FFmpeg is missing");
}

function verifyProcess(label, command, args) {
  if (!command) return;
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: buildRuntimeEnv(runtime),
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
  });
  if (result.error || result.status !== 0) {
    failures.push(`${label} failed: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`);
  } else {
    console.log(`[ok] ${label}`);
  }
}

verifyProcess("FFmpeg", runtime.ffmpeg.path, ["-version"]);
verifyProcess("COLMAP", runtime.colmap.path, ["-h"]);
verifyProcess("embedded Python", runtime.python.path, ["--version"]);
verifyProcess("hardware probe", runtime.python.path, [runtime.hardwareProbe]);

if (failures.length) {
  console.error("Embedded runtime verification failed:");
  for (const failure of failures) console.error(`- ${failure.trim()}`);
  process.exit(1);
}

console.log("Self-contained Windows runtime is complete.");
