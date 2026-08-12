import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { buildRuntimeEnv, publicRuntimeInfo, resolveRuntime } from "./runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".bmp",
  ".tif",
  ".tiff",
  ".webp",
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".m4v",
  ".webm",
]);

const MAX_LOGS = 2000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pathExists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function safeBaseName(name) {
  return path
    .basename(name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    || "input";
}

function uniqueDestination(dir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = path.join(dir, `${base}${ext}`);
  let index = 1;

  while (pathExists(candidate)) {
    candidate = path.join(dir, `${base}-${index}${ext}`);
    index += 1;
  }

  return candidate;
}

function isImageFile(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isVideoFile(filePath) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function listFilesRecursive(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];

    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function hardlinkOrCopy(source, destination) {
  ensureDir(path.dirname(destination));

  try {
    fs.linkSync(source, destination);
  } catch {
    fs.copyFileSync(source, destination);
  }
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createUploadMiddleware(uploadRoot) {
  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      if (!req.splatUploadId) {
        req.splatUploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        req.splatUploadDir = path.join(uploadRoot, req.splatUploadId);
        ensureDir(req.splatUploadDir);
      }
      cb(null, req.splatUploadDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = safeBaseName(path.basename(file.originalname, ext));
      cb(null, `${base}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  });

  return multer({
    storage,
    limits: {
      files: 100000,
      fileSize: 1024 * 1024 * 1024 * 50,
    },
  });
}

function collectInputPaths(rawInputs) {
  if (!Array.isArray(rawInputs)) return [];

  return rawInputs
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item.path === "string") return item.path;
      return null;
    })
    .filter(Boolean);
}

function collectMediaFiles(inputPaths, addLog) {
  const images = [];
  const videos = [];
  let skipped = 0;

  for (const inputPath of inputPaths) {
    if (!inputPath || !pathExists(inputPath)) {
      skipped += 1;
      continue;
    }

    const stat = fs.statSync(inputPath);
    const candidateFiles = stat.isDirectory() ? listFilesRecursive(inputPath) : [inputPath];

    for (const filePath of candidateFiles) {
      if (isImageFile(filePath)) images.push(filePath);
      else if (isVideoFile(filePath)) videos.push(filePath);
      else skipped += 1;
    }
  }

  images.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  videos.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  if (skipped > 0) {
    addLog(`[Data] Skipped ${skipped} unsupported input item${skipped === 1 ? "" : "s"}.`, "warn");
  }

  return { images, videos };
}

async function copyImagesToWorkspace(imagePaths, imagesDir, addLog) {
  ensureDir(imagesDir);
  let copied = 0;

  for (const imagePath of imagePaths) {
    const destination = uniqueDestination(imagesDir, safeBaseName(imagePath));
    try {
      await fs.promises.link(imagePath, destination);
    } catch {
      await fs.promises.copyFile(imagePath, destination);
    }
    copied += 1;

    if (copied % 500 === 0) {
      addLog(`[Data] Prepared ${copied}/${imagePaths.length} frames...`, "info");
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return copied;
}

function latestExisting(paths) {
  return paths.find((candidate) => candidate && pathExists(candidate));
}

function isDirectRun() {
  return process.argv[1] && path.resolve(process.argv[1]) === __filename;
}

async function listen(app, host, preferredPort) {
  const requestedPorts = preferredPort === 0
    ? [0]
    : [preferredPort, 3001, 3002, 3003, 3004, 0];

  let lastError = null;

  for (const port of requestedPorts) {
    try {
      return await new Promise((resolve, reject) => {
        const server = app.listen(port, host);

        server.once("listening", () => {
          const address = server.address();
          resolve({
            server,
            port: typeof address === "object" && address ? address.port : port,
          });
        });

        server.once("error", (error) => {
          server.close();
          reject(error);
        });
      });
    } catch (error) {
      lastError = error;
      if (error.code !== "EADDRINUSE") break;
    }
  }

  throw lastError;
}

function captureProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    if (!command) {
      resolve({ code: -1, stdout: "", stderr: "Executable not found." });
      return;
    }

    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          if (!proc.killed) proc.kill();
        }, options.timeoutMs)
      : null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });
    proc.on("close", (code) => finish({ code: code ?? 0, stdout, stderr }));
    proc.on("error", (error) => finish({ code: -1, stdout, stderr: `${stderr}${error.message}` }));
  });
}

function fallbackHardwareInfo(runtime, error) {
  return {
    available: false,
    platform: runtime.platform,
    architecture: runtime.arch,
    recommended_backend: "cpu",
    dependencies: {
      numpy: false,
      torch: false,
      cv2: false,
      plyfile: false,
      tqdm: false,
      gsplat: false,
    },
    devices: [{
      id: "cpu",
      backend: "cpu",
      type: "CPU",
      name: `${runtime.arch} CPU`,
      available: false,
      details: "Python/PyTorch runtime unavailable",
    }],
    error,
  };
}

export async function startServer(options = {}) {
  const app = express();
  const host = options.host || "127.0.0.1";
  const port = options.port ?? Number(process.env.PORT || 3000);
  const isProduction = options.isPackaged ?? process.env.NODE_ENV === "production";
  const binDir = options.binDir || process.env.BIN_DIR || path.join(process.cwd(), "bin");
  const workspaceRoot = options.workspaceRoot
    || process.env.SPLATSTUDIO_WORKSPACE
    || (options.appDataDir ? path.join(options.appDataDir, "workspace") : process.cwd());

  const uploadRoot = path.join(workspaceRoot, "uploads");
  const dataRoot = path.join(workspaceRoot, "data");
  const jobsRoot = path.join(dataRoot, "jobs");
  const exportsRoot = path.join(workspaceRoot, "exports");

  [uploadRoot, dataRoot, jobsRoot, exportsRoot].forEach(ensureDir);

  const upload = createUploadMiddleware(uploadRoot);
  const getRuntime = () => resolveRuntime({ binDir });
  let hardwareCache = null;

  const getHardwareInfo = async (force = false) => {
    const runtime = getRuntime();
    const cacheKey = `${runtime.python.path || "missing"}|${runtime.hardwareProbe || "missing"}`;
    if (!force && hardwareCache && hardwareCache.key === cacheKey && Date.now() - hardwareCache.at < 10000) {
      return hardwareCache.value;
    }

    if (!runtime.python.path) {
      const value = fallbackHardwareInfo(runtime, "Python was not found. Configure PYTHON_PATH or add a bundled runtime.");
      hardwareCache = { key: cacheKey, at: Date.now(), value };
      return value;
    }
    if (!runtime.hardwareProbe) {
      const value = fallbackHardwareInfo(runtime, "hardware_probe.py was not found in the bin directory.");
      hardwareCache = { key: cacheKey, at: Date.now(), value };
      return value;
    }

    const result = await captureProcess(runtime.python.path, [runtime.hardwareProbe], {
      env: buildRuntimeEnv(runtime),
      timeoutMs: 30000,
    });

    let value;
    try {
      value = JSON.parse(result.stdout.trim());
      if (!value || !Array.isArray(value.devices)) throw new Error("Invalid hardware probe response.");
    } catch (error) {
      const detail = result.stderr.trim() || result.stdout.trim() || error.message;
      value = fallbackHardwareInfo(runtime, `Hardware detection failed: ${detail}`);
    }

    hardwareCache = { key: cacheKey, at: Date.now(), value };
    return value;
  };

  const pipelineState = {
    isStarting: false,
    isRunning: false,
    abortRequested: false,
    progress: 0,
    logs: [],
    activeProcesses: new Map(),
    currentJobId: null,
    currentOutputDir: exportsRoot,
    outputKind: null,
    hardwareBackend: null,
    lastError: null,
  };

  const addLog = (message, type = "info") => {
    pipelineState.logs.push({ timestamp: Date.now(), message, type });
    if (pipelineState.logs.length > MAX_LOGS) {
      pipelineState.logs.splice(0, pipelineState.logs.length - MAX_LOGS);
    }
  };

  const killActiveProcesses = () => {
    for (const proc of pipelineState.activeProcesses.values()) {
      if (!proc.killed && proc.pid) {
        try {
          if (process.platform === "win32") {
            const killer = spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], {
              windowsHide: true,
              stdio: "ignore",
            });
            killer.on("error", () => {});
            killer.unref();
          } else {
            proc.kill("SIGTERM");
          }
        } catch {
          try {
            proc.kill();
          } catch {}
        }
      }
    }
  };

  const runProcess = (command, args, processOptions = {}) => new Promise((resolve) => {
    if (!command) {
      addLog(`[${processOptions.label || "Process"} failed] Executable was not found.`, "error");
      resolve(-1);
      return;
    }
    const label = processOptions.label || path.basename(command).replace(/\.(exe|py)$/i, "");
    const runtime = getRuntime();
    const proc = spawn(command, args, {
      cwd: processOptions.cwd || workspaceRoot,
      env: buildRuntimeEnv(runtime),
      shell: false,
      windowsHide: true,
    });

    const processKey = proc.pid || Math.random();
    pipelineState.activeProcesses.set(processKey, proc);

    const handleData = (data, type) => {
      const text = data.toString();
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        addLog(`[${label}] ${line}`, type);
        if (processOptions.onProgress) processOptions.onProgress(line);
      }
    };

    proc.stdout.on("data", (data) => handleData(data, "info"));
    proc.stderr.on("data", (data) => handleData(data, "warn"));

    proc.on("close", (code) => {
      pipelineState.activeProcesses.delete(processKey);
      resolve(pipelineState.abortRequested ? -2 : (code ?? 0));
    });

    proc.on("error", (error) => {
      pipelineState.activeProcesses.delete(processKey);
      addLog(`[${label} failed] ${error.message}`, "error");
      resolve(-1);
    });
  });

  const requireCodeZero = (code, message) => {
    if (pipelineState.abortRequested || code === -2) {
      throw new Error("Pipeline aborted");
    }
    if (code !== 0) {
      throw new Error(message);
    }
  };

  const colmapHelpCache = new Map();
  const getColmapGpuOption = async (runtime, command, modernOption, legacyOption) => {
    if (!colmapHelpCache.has(command)) {
      const result = await captureProcess(runtime.colmap.path, [command, "-h"], {
        env: buildRuntimeEnv(runtime),
        timeoutMs: 30000,
      });
      colmapHelpCache.set(command, `${result.stdout}\n${result.stderr}`);
    }
    const help = colmapHelpCache.get(command);
    if (help.includes(modernOption)) return modernOption;
    if (help.includes(legacyOption)) return legacyOption;
    return legacyOption;
  };

  app.use(express.json({ limit: "25mb" }));

  app.post("/api/upload", upload.array("files"), (req, res) => {
    res.json({
      success: true,
      uploadId: req.splatUploadId,
      files: (req.files || []).map((file) => ({
        name: file.originalname,
        path: file.path,
        size: file.size,
      })),
    });
  });

  app.get("/api/runtime-info", async (_req, res) => {
    const runtime = getRuntime();
    const hardware = await getHardwareInfo();
    const info = publicRuntimeInfo(runtime);
    const requiredPythonDependencies = ["numpy", "torch", "cv2", "plyfile", "tqdm"];
    const missingPythonDependencies = requiredPythonDependencies.filter(
      (name) => !hardware.dependencies?.[name],
    );
    res.json({
      ...info,
      ready: info.ready && missingPythonDependencies.length === 0,
      videoReady: info.tools.ffmpeg.available,
      offlineReady: info.ready
        && info.tools.ffmpeg.available
        && ["ffmpeg", "colmap", "python", "trainer", "hardwareProbe"].every(
          (name) => info.tools[name]?.source === "bundled",
        )
        && missingPythonDependencies.length === 0,
      missingPythonDependencies,
      workspaceRoot,
      currentJobId: pipelineState.currentJobId,
      outputKind: pipelineState.outputKind,
    });
  });

  app.get("/api/gpu-info", async (_req, res) => {
    res.json(await getHardwareInfo());
  });

  app.post("/api/pipeline/start", async (req, res) => {
    if (pipelineState.isStarting || pipelineState.isRunning) {
      return res.status(409).json({ error: "Pipeline already running" });
    }
    pipelineState.isStarting = true;

    const runtime = getRuntime();
    const runtimeInfo = publicRuntimeInfo(runtime);
    const missingTools = ["colmap", "python", "trainer"].filter(
      (name) => !runtimeInfo.tools[name]?.available,
    );
    if (missingTools.length > 0) {
      pipelineState.isStarting = false;
      return res.status(503).json({
        error: `Required runtime components are missing: ${missingTools.join(", ")}. Open Runtime Status for detected paths.`,
        missingTools,
      });
    }

    const hardware = await getHardwareInfo(true);
    const requiredPythonDependencies = ["numpy", "torch", "cv2", "plyfile", "tqdm"];
    const missingPythonDependencies = requiredPythonDependencies.filter(
      (name) => !hardware.dependencies?.[name],
    );
    if (missingPythonDependencies.length > 0) {
      pipelineState.isStarting = false;
      return res.status(503).json({
        error: `Python runtime is missing required packages: ${missingPythonDependencies.join(", ")}.`,
        missingPythonDependencies,
      });
    }

    const requestedBackend = typeof req.body.backend === "string"
      ? req.body.backend.toLowerCase()
      : "auto";
    const availableDevices = (hardware.devices || []).filter((device) => device.available);
    const selectedDevice = requestedBackend === "auto"
      ? availableDevices.find((device) => device.backend === hardware.recommended_backend)
        || availableDevices[0]
      : availableDevices.find(
          (device) => device.id.toLowerCase() === requestedBackend
            || device.backend.toLowerCase() === requestedBackend,
        );

    if (!selectedDevice) {
      pipelineState.isStarting = false;
      return res.status(400).json({
        error: `Compute backend "${requestedBackend}" is not available in the active Python runtime.`,
        availableBackends: availableDevices.map((device) => device.id),
      });
    }

    pipelineState.isStarting = false;
    pipelineState.isRunning = true;
    pipelineState.abortRequested = false;
    pipelineState.progress = 0;
    pipelineState.logs = [];
    pipelineState.outputKind = null;
    pipelineState.hardwareBackend = selectedDevice.id;
    pipelineState.lastError = null;

    addLog(`Starting local Gaussian Splat reconstruction pipeline on ${selectedDevice.name} (${selectedDevice.id})...`, "info");

    (async () => {
      try {
        const jobId = `job-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        const jobRoot = path.join(jobsRoot, jobId);
        const targetDataDir = path.join(jobRoot, "colmap");
        const imagesDir = path.join(targetDataDir, "images");
        const sparseDir = path.join(targetDataDir, "sparse");
        const outputDir = path.join(exportsRoot, jobId);
        const uploadId = typeof req.body.uploadId === "string" ? req.body.uploadId : null;

        pipelineState.currentJobId = jobId;
        pipelineState.currentOutputDir = outputDir;

        [targetDataDir, imagesDir, sparseDir, outputDir].forEach(ensureDir);

        const inputPaths = collectInputPaths(req.body.inputs);
        if (uploadId) {
          const uploadDir = path.join(uploadRoot, safeBaseName(uploadId));
          if (pathExists(uploadDir)) {
            inputPaths.push(uploadDir);
          } else {
            addLog(`[Data] Upload session ${uploadId} was not found.`, "warn");
          }
        }

        const { images, videos } = collectMediaFiles(inputPaths, addLog);
        if (videos.length > 1) {
          throw new Error("Please process one video per reconstruction job.");
        }
        if (videos.length === 1 && images.length > 0) {
          throw new Error("Use either one video or an image sequence, not both in the same job.");
        }
        if (videos.length === 0 && images.length < 2) {
          throw new Error("Add at least two input images, a folder of frames, or one video.");
        }

        const extractFps = clampNumber(req.body.extractFps, 2, 0.1, 60);
        const maxIterations = Math.round(clampNumber(req.body.maxIterations, 1000, 1, 100000));
        const resolution = clampNumber(req.body.resolution, 0.5, 0.05, 1);

        if (req.body.engine && req.body.engine !== "gsplat") {
          addLog(`[Pipeline] Engine "${req.body.engine}" is not bundled. Using local gsplat pipeline.`, "warn");
        }

        if (videos.length === 1) {
          if (!runtime.ffmpeg.path) {
            throw new Error("FFmpeg is required for video input but was not found. Configure FFMPEG_PATH or use an image sequence.");
          }
          pipelineState.progress = 5;
          addLog(`[FFmpeg] Extracting frames at ${extractFps} FPS from ${path.basename(videos[0])}...`, "info");
          const code = await runProcess(
            runtime.ffmpeg.path,
            [
              "-y",
              "-i",
              videos[0],
              "-vf",
              `fps=${extractFps}`,
              path.join(imagesDir, "frame_%06d.png"),
            ],
            { label: "FFmpeg" },
          );
          requireCodeZero(code, "FFmpeg frame extraction failed.");
          pipelineState.progress = 15;
          addLog("[FFmpeg] Frame extraction complete.", "success");
        } else {
          pipelineState.progress = 5;
          addLog(`[Data] Preparing ${images.length} image frame${images.length === 1 ? "" : "s"}...`, "info");
          const copied = await copyImagesToWorkspace(images, imagesDir, addLog);
          pipelineState.progress = 15;
          addLog(`[Data] Prepared ${copied} image frame${copied === 1 ? "" : "s"}.`, "success");
        }

        const preparedImages = fs.readdirSync(imagesDir).filter((fileName) => isImageFile(fileName));
        if (preparedImages.length < 2) {
          throw new Error("Frame preparation produced fewer than two usable images.");
        }

        addLog("[COLMAP] Starting feature extraction...", "info");
        const dbPath = path.join(targetDataDir, "database.db");
        const useColmapGpu = selectedDevice.backend === "cuda";
        const extractionGpuOption = await getColmapGpuOption(
          runtime,
          "feature_extractor",
          "--FeatureExtraction.use_gpu",
          "--SiftExtraction.use_gpu",
        );
        let code = await runProcess(
          runtime.colmap.path,
          [
            "feature_extractor",
            "--database_path",
            dbPath,
            "--image_path",
            imagesDir,
            "--ImageReader.single_camera",
            "1",
            extractionGpuOption,
            useColmapGpu ? "1" : "0",
          ],
          { label: "COLMAP" },
        );
        requireCodeZero(code, "COLMAP feature extraction failed.");
        pipelineState.progress = 24;

        const useSequentialMatching = videos.length === 1 || preparedImages.length >= 80;
        addLog(
          `[COLMAP] Running ${useSequentialMatching ? "sequential" : "exhaustive"} matching...`,
          "info",
        );

        const matcherCommand = useSequentialMatching ? "sequential_matcher" : "exhaustive_matcher";
        const matchingGpuOption = await getColmapGpuOption(
          runtime,
          matcherCommand,
          "--FeatureMatching.use_gpu",
          "--SiftMatching.use_gpu",
        );
        const matcherArgs = useSequentialMatching
          ? [
              "sequential_matcher",
              "--database_path",
              dbPath,
              matchingGpuOption,
              useColmapGpu ? "1" : "0",
              "--SequentialMatching.overlap",
              "10",
            ]
          : [
              "exhaustive_matcher",
              "--database_path",
              dbPath,
              matchingGpuOption,
              useColmapGpu ? "1" : "0",
            ];

        code = await runProcess(runtime.colmap.path, matcherArgs, { label: "COLMAP" });
        requireCodeZero(code, "COLMAP matching failed.");
        pipelineState.progress = 35;

        addLog("[COLMAP] Running sparse reconstruction...", "info");
        code = await runProcess(
          runtime.colmap.path,
          [
            "mapper",
            "--database_path",
            dbPath,
            "--image_path",
            imagesDir,
            "--output_path",
            sparseDir,
          ],
          { label: "COLMAP" },
        );
        requireCodeZero(code, "COLMAP mapper failed. Check image overlap, blur, and exposure consistency.");
        pipelineState.progress = 48;
        addLog("[COLMAP] Sparse reconstruction complete.", "success");

        addLog("[GS Training] Starting bundled gsplat trainer...", "info");
        const progressFile = path.join(outputDir, "training_progress.json");
        const progressInterval = setInterval(() => {
          try {
            if (!pathExists(progressFile)) return;
            const data = JSON.parse(fs.readFileSync(progressFile, "utf-8"));
            const trainPct = Number(data.progress_pct || 0);
            pipelineState.progress = 48 + trainPct * 0.48;
            if (data.draft) {
              pipelineState.outputKind = "draft";
            }
            if (data.loss !== undefined && data.iteration !== undefined) {
              addLog(
                `[GS Training] Iter ${data.iteration}/${data.total} | Loss: ${Number(data.loss).toFixed(5)} | Gaussians: ${data.num_gaussians}`,
                "info",
              );
            }
          } catch {}
        }, 3000);

        code = await runProcess(
          runtime.python.path,
          [
            runtime.trainer,
            "--input",
            targetDataDir,
            "--output",
            outputDir,
            "--iterations",
            String(maxIterations),
            "--resolution",
            String(resolution),
            "--device",
            selectedDevice.id,
            "--allow-draft-output",
          ],
          { label: "GS Training" },
        );

        clearInterval(progressInterval);
        requireCodeZero(code, "Gaussian Splat training failed.");

        const outputSplat = path.join(outputDir, "output.splat");
        const outputPly = path.join(outputDir, "splat.ply");
        if (!pathExists(outputSplat)) {
          throw new Error("Training finished without producing output.splat.");
        }

        fs.copyFileSync(outputSplat, path.join(exportsRoot, "output.splat"));
        if (pathExists(outputPly)) {
          fs.copyFileSync(outputPly, path.join(exportsRoot, "splat.ply"));
        }

        try {
          const progressData = JSON.parse(fs.readFileSync(progressFile, "utf-8"));
          pipelineState.outputKind = progressData.draft ? "draft" : "trained";
        } catch {
          pipelineState.outputKind = "trained";
        }

        pipelineState.progress = 100;
        addLog(
          pipelineState.outputKind === "draft"
            ? `Pipeline completed with a COLMAP-initialized draft splat because training was unavailable on ${selectedDevice.id}.`
            : "Pipeline completed successfully. Trained splat model exported.",
          pipelineState.outputKind === "draft" ? "warn" : "success",
        );
      } catch (error) {
        if (error.message === "Pipeline aborted") {
          addLog("[Pipeline] Processing aborted.", "warn");
        } else {
          pipelineState.lastError = error.message;
          addLog(`[Pipeline Error] ${error.message}`, "error");
        }
      } finally {
        pipelineState.isRunning = false;
        pipelineState.abortRequested = false;
        pipelineState.activeProcesses.clear();
      }
    })();

    return res.json({ success: true, mode: "native", backend: selectedDevice.id });
  });

  app.post("/api/pipeline/abort", (_req, res) => {
    if (pipelineState.isRunning) {
      pipelineState.abortRequested = true;
      killActiveProcesses();
      addLog("Abort requested. Stopping active reconstruction processes...", "warn");
    }
    return res.json({ success: true });
  });

  app.get("/api/pipeline/status", (_req, res) => {
    const hasOutput = Boolean(latestExisting([
      path.join(pipelineState.currentOutputDir || "", "output.splat"),
      path.join(exportsRoot, "output.splat"),
    ]));
    res.json({
      isStarting: pipelineState.isStarting,
      isRunning: pipelineState.isRunning,
      progress: pipelineState.progress,
      logs: pipelineState.logs,
      currentJobId: pipelineState.currentJobId,
      outputKind: pipelineState.outputKind,
      hardwareBackend: pipelineState.hardwareBackend,
      lastError: pipelineState.lastError,
      hasOutput,
    });
  });

  app.head("/api/output.splat", (_req, res) => {
    const candidate = latestExisting([
      path.join(pipelineState.currentOutputDir || "", "output.splat"),
      path.join(exportsRoot, "output.splat"),
    ]);
    return candidate ? res.status(200).end() : res.status(404).end();
  });

  app.get("/api/output.splat", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const candidate = latestExisting([
      path.join(pipelineState.currentOutputDir || "", "output.splat"),
      path.join(exportsRoot, "output.splat"),
    ]);
    if (candidate) return res.sendFile(candidate);
    return res.status(404).json({ error: "Splat model not generated yet." });
  });

  app.get("/api/output.ply", (_req, res) => {
    const candidate = latestExisting([
      path.join(pipelineState.currentOutputDir || "", "splat.ply"),
      path.join(exportsRoot, "splat.ply"),
    ]);
    if (candidate) return res.sendFile(candidate);
    return res.status(404).json({ error: "PLY model not generated yet." });
  });

  app.post("/api/custom/import", async (req, res) => {
    const { filePath } = req.body;
    if (!filePath || !pathExists(filePath)) {
      return res.status(400).json({ error: "Invalid file path." });
    }

    const ext = path.extname(filePath).toLowerCase();
    const destSplat = path.join(exportsRoot, "custom.splat");

    try {
      if (ext === ".splat") {
        fs.copyFileSync(filePath, destSplat);
        addLog(`[Custom Import] Loaded splat file: ${path.basename(filePath)}`, "success");
        return res.json({ success: true, url: "/api/custom.splat" });
      } else if (ext === ".ply") {
        const destPly = path.join(exportsRoot, "custom.ply");
        fs.copyFileSync(filePath, destPly);
        addLog(`[Custom Import] Loaded PLY file: ${path.basename(filePath)}`, "success");
        return res.json({ success: true, url: "/api/custom.ply" });
      } else {
        return res.status(400).json({ error: "Unsupported file extension." });
      }
    } catch (err) {
      addLog(`[Conversion Error] ${err.message}`, "error");
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/custom.ply", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const candidate = path.join(exportsRoot, "custom.ply");
    if (pathExists(candidate)) return res.sendFile(candidate);
    return res.status(404).json({ error: "Custom ply model not found." });
  });

  app.get("/api/custom.spz", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const candidate = path.join(exportsRoot, "custom.spz");
    if (pathExists(candidate)) return res.sendFile(candidate);
    return res.status(404).json({ error: "Custom spz model not found." });
  });

  app.get("/api/custom.splat", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const candidate = path.join(exportsRoot, "custom.splat");
    if (pathExists(candidate)) return res.sendFile(candidate);
    return res.status(404).json({ error: "Custom splat model not found." });
  });

  app.get("/api/export/:fileName", (req, res) => {
    const allowed = new Set(["output.splat", "splat.ply", "training_progress.json"]);
    const fileName = safeBaseName(req.params.fileName || "");
    if (!allowed.has(fileName)) {
      return res.status(404).json({ error: "Unknown export file." });
    }

    const candidate = latestExisting([
      path.join(pipelineState.currentOutputDir || "", fileName),
      path.join(exportsRoot, fileName),
    ]);
    if (!candidate) {
      return res.status(404).json({ error: "Export file not generated yet." });
    }

    return res.download(candidate, fileName);
  });

  let viteDevServer = null;

  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    viteDevServer = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(viteDevServer.middlewares);
  } else {
    const distPath = options.staticDir || path.join(__dirname, "dist");
    const indexPath = path.join(distPath, "index.html");
    if (!pathExists(indexPath)) {
      throw new Error(`Built renderer not found at ${indexPath}. Run the frontend build before starting production mode.`);
    }
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(indexPath);
    });
  }

  const { server, port: actualPort } = await listen(app, host, port);
  const url = `http://${host}:${actualPort}`;
  console.log(`SplatStudio server running on ${url}`);

  return {
    app,
    server,
    port: actualPort,
    url,
    close: async () => {
      pipelineState.abortRequested = true;
      killActiveProcesses();
      await new Promise((resolve) => {
        server.close(resolve);
      });
      if (viteDevServer) {
        await viteDevServer.close();
      }
    },
  };
}

if (isDirectRun()) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
