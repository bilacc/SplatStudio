import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

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

function findExecutableOnPath(fileNames) {
  const searchDirectories = (process.env.PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.replace(/^"|"$/g, '').trim())
    .filter(Boolean);

  for (const directory of searchDirectories) {
    for (const fileName of fileNames) {
      const candidate = path.join(directory, fileName);
      if (pathExists(candidate)) return candidate;
    }
  }

  return null;
}

function resolveRuntimeTool(label, bundledCandidates, pathNames) {
  const bundled = bundledCandidates.find(pathExists);
  if (bundled) {
    return { label, available: true, path: bundled, source: 'bundled' };
  }

  const system = findExecutableOnPath(pathNames);
  if (system) {
    return { label, available: true, path: system, source: 'system' };
  }

  return { label, available: false, path: null, source: null };
}

function resolveRuntimeTools(binDir) {
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';
  return {
    ffmpeg: resolveRuntimeTool(
      'FFmpeg',
      [path.join(binDir, `ffmpeg${executableSuffix}`), path.join(binDir, 'ffmpeg.exe')],
      [`ffmpeg${executableSuffix}`, 'ffmpeg'],
    ),
    colmap: resolveRuntimeTool(
      'COLMAP',
      [
        path.join(binDir, `colmap${executableSuffix}`),
        path.join(binDir, 'colmap.exe'),
        path.join(binDir, 'colmap', 'colmap.exe'),
      ],
      [`colmap${executableSuffix}`, 'colmap'],
    ),
    python: resolveRuntimeTool(
      'Python',
      [
        path.join(binDir, 'python', 'python.exe'),
        path.join(binDir, `python${executableSuffix}`),
      ],
      process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python'],
    ),
    trainer: resolveRuntimeTool(
      'gsplat trainer',
      [path.join(binDir, 'train_splat.py'), path.join(__dirname, 'bin', 'train_splat.py')],
      [],
    ),
    pythonPackages: {
      label: 'Python ML packages',
      available: false,
      path: null,
      source: null,
      missingModules: [],
    },
  };
}

function summarizeRuntime(tools, binDir, workspaceRoot) {
  const imageTools = ['colmap', 'python', 'pythonPackages', 'trainer'];
  const missingForImages = imageTools.filter((key) => !tools[key].available);
  const missingForVideo = [
    ...missingForImages,
    ...(!tools.ffmpeg.available ? ['ffmpeg'] : []),
  ];

  return {
    workspaceRoot,
    binDir,
    tools,
    readyForImages: missingForImages.length === 0,
    readyForVideo: missingForVideo.length === 0,
    missingForImages,
    missingForVideo,
  };
}

function probePythonPackages(pythonTool, binDir) {
  if (!pythonTool.available) {
    return Promise.resolve({
      label: 'Python ML packages',
      available: false,
      path: null,
      source: null,
      missingModules: ['torch', 'gsplat', 'cv2', 'numpy', 'plyfile', 'tqdm'],
    });
  }

  const script = [
    "import importlib.util,json",
    "mods=['torch','gsplat','cv2','numpy','plyfile','tqdm']",
    "missing=[m for m in mods if importlib.util.find_spec(m) is None]",
    "print(json.dumps({'missing':missing}))",
  ].join(';');

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(pythonTool.path, ['-c', script], {
        env: buildToolEnv(binDir),
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        label: 'Python ML packages',
        available: false,
        path: null,
        source: pythonTool.source,
        missingModules: [error.message],
      });
      return;
    }
    let stdout = '';
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      finish({
        label: 'Python ML packages',
        available: false,
        path: null,
        source: pythonTool.source,
        missingModules: ['probe timed out'],
      });
    }, 10000);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.on('error', (error) => {
      clearTimeout(timer);
      finish({
        label: 'Python ML packages',
        available: false,
        path: null,
        source: pythonTool.source,
        missingModules: [error.message],
      });
    });
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(stdout.trim() || '{}');
        const missingModules = Array.isArray(data.missing) ? data.missing : ['unknown'];
        finish({
          label: 'Python ML packages',
          available: missingModules.length === 0,
          path: pythonTool.path,
          source: pythonTool.source,
          missingModules,
        });
      } catch {
        finish({
          label: 'Python ML packages',
          available: false,
          path: null,
          source: pythonTool.source,
          missingModules: ['probe failed'],
        });
      }
    });
  });
}

async function runtimeSnapshot(binDir, workspaceRoot) {
  const tools = resolveRuntimeTools(binDir);
  tools.pythonPackages = await probePythonPackages(tools.python, binDir);
  return summarizeRuntime(tools, binDir, workspaceRoot);
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

function getBinPaths(binDir) {
  const libDir = path.join(binDir, "lib");
  const pythonDir = path.join(binDir, "python");
  const torchLibDir = path.join(pythonDir, "Lib", "site-packages", "torch", "lib");

  return [binDir, libDir, pythonDir, torchLibDir].filter(pathExists);
}

function buildToolEnv(binDir) {
  const pathPrefix = getBinPaths(binDir).join(path.delimiter);
  return {
    ...process.env,
    BIN_DIR: binDir,
    PATH: `${pathPrefix}${pathPrefix ? path.delimiter : ""}${process.env.PATH || ""}`,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  };
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
  const existingOutputSplat = path.join(exportsRoot, "output.splat");

  const pipelineState = {
    isRunning: false,
    abortRequested: false,
    progress: pathExists(existingOutputSplat) ? 100 : 0,
    logs: [],
    activeProcesses: new Map(),
    currentJobId: null,
    currentOutputDir: exportsRoot,
    outputKind: pathExists(existingOutputSplat) ? "trained" : null,
  };

  const addLog = (message, type = "info") => {
    pipelineState.logs.push({ timestamp: Date.now(), message, type });
    if (pipelineState.logs.length > MAX_LOGS) {
      pipelineState.logs.splice(0, pipelineState.logs.length - MAX_LOGS);
    }
  };

  const describeFile = (baseDir, fileName, downloadPrefix = '/api/export') => {
    const candidate = path.join(baseDir, fileName);
    if (!pathExists(candidate)) return null;
    const stats = fs.statSync(candidate);
    return {
      name: fileName,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      downloadUrl: `${downloadPrefix}/${encodeURIComponent(fileName)}`,
    };
  };

  const listJobEntries = () => {
    let entries = [];
    try {
      entries = fs.readdirSync(exportsRoot, { withFileTypes: true });
    } catch {
      return [];
    }

    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('job-'))
      .map((entry) => {
        const jobDir = path.join(exportsRoot, entry.name);
        const stats = fs.statSync(jobDir);
        const progressPath = path.join(jobDir, 'training_progress.json');
        let progressData = null;
        try {
          progressData = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
        } catch {}

        const files = [
          describeFile(jobDir, 'output.splat', `/api/jobs/${encodeURIComponent(entry.name)}/export`),
          describeFile(jobDir, 'splat.ply', `/api/jobs/${encodeURIComponent(entry.name)}/export`),
        ].filter(Boolean);

        return {
          id: entry.name,
          createdAt: stats.birthtime.toISOString(),
          modifiedAt: stats.mtime.toISOString(),
          status: pipelineState.isRunning && pipelineState.currentJobId === entry.name
            ? 'running'
            : progressData?.draft
              ? 'draft'
              : progressData?.complete && files.length > 0
                ? 'complete'
                : 'failed',
          progress: pipelineState.currentJobId === entry.name
            ? pipelineState.progress
            : Number(progressData?.progress_pct || (files.length > 0 ? 100 : 0)),
          files,
        };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  };

  const killActiveProcesses = () => {
    for (const proc of pipelineState.activeProcesses.values()) {
      if (!proc.killed && proc.pid) {
        try {
          if (process.platform === "win32") {
            spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { windowsHide: true });
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
    const label = processOptions.label || path.basename(command).replace(/\.(exe|py)$/i, "");
    const proc = spawn(command, args, {
      cwd: processOptions.cwd || workspaceRoot,
      env: buildToolEnv(binDir),
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
    res.json({
      ...(await runtimeSnapshot(binDir, workspaceRoot)),
      currentJobId: pipelineState.currentJobId,
      outputKind: pipelineState.outputKind,
    });
  });

  app.get("/api/gpu-info", async (_req, res) => {
    try {
      const pythonTool = resolveRuntimeTools(binDir).python;
      if (!pythonTool.available) {
        return res.json({ available: false, error: "Python was not found in the bundled runtime or PATH." });
      }

      const script = [
        "import json, torch",
        "available=torch.cuda.is_available()",
        "g=torch.cuda.get_device_properties(0) if available else None",
        "print(json.dumps({",
        "  'available': available,",
        "  'name': g.name if g else None,",
        "  'vram_gb': round(g.total_memory/1073741824,1) if g else 0,",
        "  'cuda_version': torch.version.cuda or 'N/A'",
        "}))",
      ].join(";");

      const output = await new Promise((resolve) => {
        const proc = spawn(pythonTool.path, ["-c", script], {
          env: buildToolEnv(binDir),
          shell: false,
          windowsHide: true,
        });
        let stdout = "";
        proc.stdout.on("data", (data) => {
          stdout += data.toString();
        });
        proc.on("close", () => resolve(stdout.trim()));
        proc.on("error", () => resolve("{}"));
      });

      res.json(JSON.parse(output || "{}"));
    } catch (error) {
      res.json({ available: false, error: error.message });
    }
  });

  app.post("/api/pipeline/start", async (req, res) => {
    if (pipelineState.isRunning) {
      return res.status(409).json({ error: "Pipeline already running" });
    }

    const runtime = await runtimeSnapshot(binDir, workspaceRoot);
    if (!runtime.readyForImages) {
      const missing = runtime.missingForImages.map((key) => runtime.tools[key].label).join(', ');
      return res.status(503).json({
        error: `Runtime is incomplete. Install or bundle: ${missing}.`,
        runtime,
      });
    }

    const jobId = `job-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    pipelineState.isRunning = true;
    pipelineState.abortRequested = false;
    pipelineState.progress = 0;
    pipelineState.logs = [];
    pipelineState.outputKind = null;
    pipelineState.currentJobId = jobId;

    addLog("Starting local Gaussian Splat reconstruction pipeline...", "info");

    (async () => {
      try {
        const jobRoot = path.join(jobsRoot, jobId);
        const targetDataDir = path.join(jobRoot, "colmap");
        const imagesDir = path.join(targetDataDir, "images");
        const sparseDir = path.join(targetDataDir, "sparse");
        const outputDir = path.join(exportsRoot, jobId);
        const uploadId = typeof req.body.uploadId === "string" ? req.body.uploadId : null;

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
        if (videos.length === 1 && !runtime.tools.ffmpeg.available) {
          throw new Error("FFmpeg is required for video input. Add it to bin/ or install it on PATH.");
        }

        const extractFps = clampNumber(req.body.extractFps, 2, 0.1, 60);
        const maxIterations = Math.round(clampNumber(req.body.maxIterations, 7000, 1, 100000));
        const resolution = clampNumber(req.body.resolution, 0.5, 0.05, 1);
        const featureQuality = ['low', 'medium', 'high', 'ultra'].includes(req.body.featureQuality)
          ? req.body.featureQuality
          : 'high';
        const scenePreset = ['object', 'indoor', 'city'].includes(req.body.scenePreset)
          ? req.body.scenePreset
          : 'object';
        const qualitySettings = {
          low: { maxFeatures: 4096, peakThreshold: 0.02 },
          medium: { maxFeatures: 8192, peakThreshold: 0.01 },
          high: { maxFeatures: 16384, peakThreshold: 0.0067 },
          ultra: { maxFeatures: 32768, peakThreshold: 0.004 },
        }[featureQuality];
        addLog(`[Pipeline] Quality: ${featureQuality} | Scene: ${scenePreset}`, "info");

        if (req.body.engine && req.body.engine !== "gsplat") {
          addLog(`[Pipeline] Engine "${req.body.engine}" is not bundled. Using local gsplat pipeline.`, "warn");
        }

        if (videos.length === 1) {
          pipelineState.progress = 5;
          addLog(`[FFmpeg] Extracting frames at ${extractFps} FPS from ${path.basename(videos[0])}...`, "info");
          const code = await runProcess(
            runtime.tools.ffmpeg.path,
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
        let code = await runProcess(
          runtime.tools.colmap.path,
          [
            "feature_extractor",
            "--database_path",
            dbPath,
            "--image_path",
            imagesDir,
            "--ImageReader.single_camera",
            "1",
            "--SiftExtraction.use_gpu",
            "1",
            "--SiftExtraction.max_num_features",
            String(qualitySettings.maxFeatures),
            "--SiftExtraction.peak_threshold",
            String(qualitySettings.peakThreshold),
          ],
          { label: "COLMAP" },
        );
        requireCodeZero(code, "COLMAP feature extraction failed.");
        pipelineState.progress = 24;

        const useSequentialMatching = scenePreset === 'city'
          || videos.length === 1
          || preparedImages.length >= (scenePreset === 'indoor' ? 50 : 80);
        const sequentialOverlap = scenePreset === 'city' ? 20 : scenePreset === 'indoor' ? 15 : 10;
        addLog(
          `[COLMAP] Running ${useSequentialMatching ? "sequential" : "exhaustive"} matching...`,
          "info",
        );

        const matcherArgs = useSequentialMatching
          ? [
              "sequential_matcher",
              "--database_path",
              dbPath,
              "--SiftMatching.use_gpu",
              "1",
              "--SequentialMatching.overlap",
              String(sequentialOverlap),
            ]
          : [
              "exhaustive_matcher",
              "--database_path",
              dbPath,
              "--SiftMatching.use_gpu",
              "1",
            ];

        code = await runProcess(runtime.tools.colmap.path, matcherArgs, { label: "COLMAP" });
        requireCodeZero(code, "COLMAP matching failed.");
        pipelineState.progress = 35;

        addLog("[COLMAP] Running sparse reconstruction...", "info");
        code = await runProcess(
          runtime.tools.colmap.path,
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
          runtime.tools.python.path,
          [
            runtime.tools.trainer.path,
            "--input",
            targetDataDir,
            "--output",
            outputDir,
            "--iterations",
            String(maxIterations),
            "--resolution",
            String(resolution),
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
            ? "Pipeline completed with a COLMAP-initialized draft splat because the CUDA rasterizer was unavailable."
            : "Pipeline completed successfully. Trained splat model exported.",
          pipelineState.outputKind === "draft" ? "warn" : "success",
        );
      } catch (error) {
        if (error.message === "Pipeline aborted") {
          addLog("[Pipeline] Processing aborted.", "warn");
        } else {
          addLog(`[Pipeline Error] ${error.message}`, "error");
        }
      } finally {
        pipelineState.isRunning = false;
        pipelineState.abortRequested = false;
        pipelineState.activeProcesses.clear();
      }
    })();

    return res.json({ success: true, mode: "native", jobId });
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
    res.json({
      isRunning: pipelineState.isRunning,
      progress: pipelineState.progress,
      logs: pipelineState.logs,
      currentJobId: pipelineState.currentJobId,
      outputKind: pipelineState.outputKind,
    });
  });

  app.get("/api/jobs", (_req, res) => {
    res.json({ jobs: listJobEntries() });
  });

  app.get("/api/exports", (_req, res) => {
    const outputDir = pipelineState.currentOutputDir || exportsRoot;
    const files = [
      describeFile(outputDir, 'output.splat'),
      describeFile(outputDir, 'splat.ply'),
    ].filter(Boolean);

    res.json({
      jobId: pipelineState.currentJobId,
      outputKind: pipelineState.outputKind,
      files,
    });
  });

  app.get("/api/jobs/:jobId/export/:fileName", (req, res) => {
    const allowedFiles = new Set(["output.splat", "splat.ply"]);
    const jobId = String(req.params.jobId || '');
    const fileName = safeBaseName(req.params.fileName || "");
    if (!/^job-[A-Za-z0-9-]+$/.test(jobId) || !allowedFiles.has(fileName)) {
      return res.status(404).json({ error: "Unknown job export." });
    }

    const candidate = path.join(exportsRoot, jobId, fileName);
    if (!pathExists(candidate)) {
      return res.status(404).json({ error: "Job export file not found." });
    }

    return res.download(candidate, fileName);
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
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
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
