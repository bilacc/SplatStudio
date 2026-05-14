import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure directories exist
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const DATA_DIR = path.join(process.cwd(), "data");
const EXPORTS_DIR = path.join(process.cwd(), "exports");

[UPLOADS_DIR, DATA_DIR, EXPORTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Configure Multer to preserve file extensions
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Math.random().toString(36).substring(2, 10)}${ext}`);
  }
});
const upload = multer({ storage });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // In-memory state mimicking a job queue Processing
  let pipelineState = {
    isRunning: false,
    progress: 0,
    logs: [] as { timestamp: number, message: string, type: 'info' | 'warn' | 'error' | 'success'}[]
  };

  const addLog = (message: string, type: 'info' | 'warn' | 'error' | 'success' = 'info') => {
    pipelineState.logs.push({ timestamp: Date.now(), message, type });
  };

  // Helper function to run real shell commands with bundled DLL paths
  const runProcess = (command: string, args: string[], onProgress?: (msg: string) => void): Promise<number> => {
    return new Promise((resolve) => {
      const binDir = process.env.BIN_DIR || path.join(process.cwd(), 'bin');
      const libDir = path.join(binDir, 'lib');
      const envPath = `${binDir};${libDir};${process.env.PATH || ''}`;
      
      const proc = spawn(command, args, { 
        shell: true,
        env: { ...process.env, PATH: envPath }
      });
      proc.stdout.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) {
          const label = path.basename(command).replace('.exe','').replace('.py','');
          addLog(`[${label}] ${msg}`, 'info');
          if (onProgress) onProgress(msg);
        }
      });
      proc.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) {
          const label = path.basename(command).replace('.exe','').replace('.py','');
          addLog(`[${label}] ${msg}`, 'warn');
          if (onProgress) onProgress(msg);
        }
      });
      proc.on('close', (code) => resolve(code || 0));
      proc.on('error', (err) => {
        addLog(`[${path.basename(command)} FAILED] ${err.message}`, 'error');
        resolve(-1);
      });
    });
  };

  // API Routes
  app.post("/api/upload", upload.array("files"), (req, res) => {
    res.json({ success: true, files: req.files?.length || 0 });
  });

  app.post("/api/pipeline/start", (req, res) => {
    if (pipelineState.isRunning) {
      return res.status(400).json({ error: "Pipeline already running" });
    }
    
    pipelineState.isRunning = true;
    pipelineState.progress = 0;
    pipelineState.logs = [];
    
    addLog('Starting Gaussian Splat reconstruction pipeline...', 'info');

    // REAL PIPELINE EXECUTION USING BUNDLED BINARIES
    (async () => {
      try {
        const inputFiles = fs.readdirSync(UPLOADS_DIR).filter(f => !f.startsWith('.'));
        if (inputFiles.length === 0) throw new Error("No files uploaded");

        const targetDataDir = path.join(DATA_DIR, "processed");
        const imagesDir = path.join(targetDataDir, "images");
        const sparseDir = path.join(targetDataDir, "sparse");
        
        // Create working directories
        [targetDataDir, imagesDir, sparseDir].forEach(d => {
          if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        });
        
        const { extractFps = 2 } = req.body;

        const isVideo = inputFiles[0].match(/\.(mp4|mov|avi|mkv)$/i);
        const dataArg = isVideo 
          ? path.join(UPLOADS_DIR, inputFiles[0]) 
          : UPLOADS_DIR;

        // Use BIN_DIR from env, fallback to current dir/bin
        const binDir = process.env.BIN_DIR || path.join(process.cwd(), 'bin');
        const getBin = (name: string) => path.join(binDir, name);

        let code;

        // ── Step 1: Extract frames from video ──
        if (isVideo) {
          pipelineState.progress = 5;
          addLog(`[FFmpeg] Extracting video frames at ${extractFps} FPS...`, 'info');
          code = await runProcess(getBin('ffmpeg.exe'), [
            '-y', '-i', dataArg, 
            '-vf', `fps=${extractFps}`, 
            '-q:v', '2',
            path.join(imagesDir, 'img%04d.jpg')
          ]);
          if (code !== 0) addLog('[FFmpeg] Warning: non-zero exit code', 'warn');
          pipelineState.progress = 15;
          addLog(`[FFmpeg] Frame extraction complete.`, 'success');
        } else {
          // Copy images directly
          pipelineState.progress = 5;
          addLog('[Data] Copying input images...', 'info');
          for (const f of inputFiles) {
            fs.copyFileSync(path.join(UPLOADS_DIR, f), path.join(imagesDir, f));
          }
          pipelineState.progress = 15;
        }

        // ── Step 2: COLMAP reconstruction ──
        addLog('[COLMAP] Starting feature extraction...', 'info');
        const dbPath = path.join(targetDataDir, 'database.db');
        
        code = await runProcess(getBin('colmap.exe'), [
          'feature_extractor',
          '--database_path', dbPath,
          '--image_path', imagesDir,
          '--ImageReader.single_camera', '1',
          '--SiftExtraction.use_gpu', '1'
        ]);
        pipelineState.progress = 22;
        
        addLog('[COLMAP] Running exhaustive matching...', 'info');
        code = await runProcess(getBin('colmap.exe'), [
          'exhaustive_matcher',
          '--database_path', dbPath,
          '--SiftMatching.use_gpu', '1'
        ]);
        pipelineState.progress = 32;
        
        const sparse0 = path.join(sparseDir, '0');
        if (!fs.existsSync(sparse0)) fs.mkdirSync(sparse0, { recursive: true });
        
        addLog('[COLMAP] Running sparse reconstruction (mapper)...', 'info');
        code = await runProcess(getBin('colmap.exe'), [
          'mapper',
          '--database_path', dbPath,
          '--image_path', imagesDir,
          '--output_path', sparseDir
        ]);
        if (code !== 0) throw new Error("COLMAP mapper failed - check input images quality");
        pipelineState.progress = 45;
        addLog('[COLMAP] Sparse reconstruction complete!', 'success');

        // ── Step 3: Gaussian Splatting Training ──
        addLog('[GS Training] Starting 3D Gaussian Splatting training on GPU...', 'info');
        const pythonExe = getBin(path.join('python', 'python.exe'));
        const trainScript = getBin('train_splat.py');
        
        // Monitor training progress via JSON file
        const progressFile = path.join(EXPORTS_DIR, 'training_progress.json');
        const progressInterval = setInterval(() => {
          try {
            if (fs.existsSync(progressFile)) {
              const data = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
              const trainPct = data.progress_pct || 0;
              // Map training progress (0-100%) to pipeline progress (45-95%)
              pipelineState.progress = 45 + (trainPct * 0.5);
              if (data.loss !== undefined) {
                addLog(`[GS Training] Iter ${data.iteration}/${data.total} | Loss: ${data.loss.toFixed(5)} | Gaussians: ${data.num_gaussians}`, 'info');
              }
            }
          } catch {}
        }, 3000);
        
        code = await runProcess(pythonExe, [
          trainScript,
          '--input', targetDataDir,
          '--output', EXPORTS_DIR,
          '--iterations', '7000',
          '--resolution', '0.5'
        ]);
        
        clearInterval(progressInterval);
        
        if (code !== 0) throw new Error("Gaussian Splatting training failed");

        pipelineState.progress = 100;
        pipelineState.isRunning = false;
        addLog('Pipeline completed successfully! Splat model exported.', 'success');

      } catch (err: any) {
        pipelineState.isRunning = false;
        addLog(`[Pipeline Error] ${err.message}`, 'error');
      }
    })();

    res.json({ success: true, mode: 'native' });
  });

  app.post("/api/pipeline/abort", (req, res) => {
    pipelineState.isRunning = false;
    pipelineState.progress = 0;
    addLog('Pipeline processing aborted by user.', 'warn');
    res.json({ success: true });
  });

  app.get("/api/pipeline/status", (req, res) => {
    res.json({
      isRunning: pipelineState.isRunning,
      progress: pipelineState.progress,
      logs: pipelineState.logs
    });
  });

  app.head("/api/output.splat", (req, res) => {
    const splatPaths = [
      path.join(EXPORTS_DIR, "output.splat"),
      path.join(EXPORTS_DIR, "splat.ply") // Fallback if exported natively as ply
    ];
    for (const p of splatPaths) {
      if (fs.existsSync(p)) {
        return res.status(200).end();
      }
    }
    res.status(404).end();
  });

  app.get("/api/output.splat", (req, res) => {
    const splatPaths = [
      path.join(EXPORTS_DIR, "output.splat"),
      path.join(EXPORTS_DIR, "splat.ply")
    ];
    for (const p of splatPaths) {
      if (fs.existsSync(p)) return res.sendFile(p);
    }
    res.status(404).json({ error: "Splat model not generated yet" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Since express v5 requires *all
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
