import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { buildRuntimeEnv, publicRuntimeInfo, resolveRuntime } from "../runtime.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(scriptDir);
const runtime = resolveRuntime({ binDir: path.join(projectDir, "bin") });
const info = publicRuntimeInfo(runtime);

console.log(`SplatStudio runtime doctor (${info.platform}-${info.arch})`);
console.log(`Runtime root: ${info.binDir}`);
for (const [name, tool] of Object.entries(info.tools)) {
  console.log(`${tool.available ? "OK     " : "MISSING"} ${name.padEnd(14)} ${tool.path || ""} ${tool.source === "missing" ? "" : `(${tool.source})`}`);
}

let hardware = null;
if (runtime.python.path && runtime.hardwareProbe) {
  const result = spawnSync(runtime.python.path, [runtime.hardwareProbe], {
    env: buildRuntimeEnv(runtime),
    encoding: "utf8",
    windowsHide: true,
  });
  try {
    hardware = JSON.parse(result.stdout.trim());
    console.log(`PyTorch: ${hardware.torch_version || "not installed"}`);
    console.log(`Detected devices: ${(hardware.devices || []).map((device) => `${device.id}${device.available ? "" : " (unavailable)"}`).join(", ") || "none"}`);
    const missing = Object.entries(hardware.dependencies || {}).filter(([name, available]) => name !== "gsplat" && !available).map(([name]) => name);
    if (missing.length) console.log(`Missing Python packages: ${missing.join(", ")}`);
  } catch {
    console.log(`Hardware probe failed: ${result.stderr || result.stdout || "no output"}`);
  }
}

const requiredDependencies = ["numpy", "torch", "cv2", "plyfile", "tqdm"];
const pythonReady = hardware && requiredDependencies.every((name) => hardware.dependencies?.[name]);
const ready = info.ready && pythonReady;
console.log(ready ? "READY: image-sequence reconstruction is available." : "NOT READY: resolve the missing runtime items above.");
if (ready && !info.tools.ffmpeg.available) console.log("NOTE: FFmpeg is still required for video input.");
process.exitCode = ready ? 0 : 1;
