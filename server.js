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

  const pipelineState = {
    isRunning: false,
    abortRequested: false,
    progress: 0,
    logs: [],
    activeProcesses: new Map(),
    currentJobId: null,
    currentOutputDir: exportsRoot,
    outputKind: null,
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

  const getBin = (...segments) => path.join(binDir, ...segments);

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

  app.get("/api/runtime-info", (_req, res) => {
    res.json({
      workspaceRoot,
      binDir,
      hasColmap: pathExists(getBin("colmap.exe")),
      hasFfmpeg: pathExists(getBin("ffmpeg.exe")),
      hasPython: pathExists(getBin("python", "python.exe")),
      currentJobId: pipelineState.currentJobId,
      outputKind: pipelineState.outputKind,
    });
  });

  app.get("/api/gpu-info", async (_req, res) => {
    try {
      const pythonExe = getBin("python", "python.exe");
      if (!pathExists(pythonExe)) {
        return res.json({ available: false, error: "Bundled Python was not found." });
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
        const proc = spawn(pythonExe, ["-c", script], {
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

  app.post("/api/pipeline/start", (req, res) => {
    if (pipelineState.isRunning) {
      return res.status(409).json({ error: "Pipeline already running" });
    }

    pipelineState.isRunning = true;
    pipelineState.abortRequested = false;
    pipelineState.progress = 0;
    pipelineState.logs = [];
    pipelineState.outputKind = null;

    addLog("Starting local Gaussian Splat reconstruction pipeline...", "info");

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
        const maxIterations = Math.round(clampNumber(req.body.maxIterations, 7000, 1, 100000));
        const resolution = clampNumber(req.body.resolution, 0.5, 0.05, 1);

        if (req.body.engine && req.body.engine !== "gsplat") {
          addLog(`[Pipeline] Engine "${req.body.engine}" is not bundled. Using local gsplat pipeline.`, "warn");
        }

        if (videos.length === 1) {
          pipelineState.progress = 5;
          addLog(`[FFmpeg] Extracting frames at ${extractFps} FPS from ${path.basename(videos[0])}...`, "info");
          const code = await runProcess(
            getBin("ffmpeg.exe"),
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
          getBin("colmap.exe"),
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

        const matcherArgs = useSequentialMatching
          ? [
              "sequential_matcher",
              "--database_path",
              dbPath,
              "--SiftMatching.use_gpu",
              "1",
              "--SequentialMatching.overlap",
              "10",
            ]
          : [
              "exhaustive_matcher",
              "--database_path",
              dbPath,
              "--SiftMatching.use_gpu",
              "1",
            ];

        code = await runProcess(getBin("colmap.exe"), matcherArgs, { label: "COLMAP" });
        requireCodeZero(code, "COLMAP matching failed.");
        pipelineState.progress = 35;

        addLog("[COLMAP] Running sparse reconstruction...", "info");
        code = await runProcess(
          getBin("colmap.exe"),
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
          getBin("python", "python.exe"),
          [
            getBin("train_splat.py"),
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

    return res.json({ success: true, mode: "native" });
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

  app.head("/api/output.splat", (_req, res) => {
    const candidate = latestExisting([
      path.join(pipelineState.currentOutputDir || "", "output.splat"),
      path.join(exportsRoot, "output.splat"),
    ]);
    return candidate ? res.status(200).end() : res.status(404).end();
  });

  app.get("/api/output.splat", (_req, res) => {
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
