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

  // Helper function to run real shell commands if CLI tools exist
  const runProcess = (command: string, args: string[], onProgress?: (msg: string) => void): Promise<number> => {
    return new Promise((resolve) => {
      const proc = spawn(command, args, { shell: true });
      proc.stdout.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) {
          addLog(`[${command}] ${msg}`, 'info');
          if (onProgress) onProgress(msg);
        }
      });
      proc.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) addLog(`[${command} ERROR] ${msg}`, 'warn');
      });
      proc.on('close', (code) => resolve(code || 0));
      proc.on('error', (err) => {
        addLog(`[${command} FAILED] ${err.message}`, 'error');
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
    const { backend, filesCount } = req.body;
    
    pipelineState.isRunning = true;
    pipelineState.progress = 0;
    pipelineState.logs = [];
    
    addLog('Starting Gaussian Splat reconstruction pipeline...', 'info');
    
    // Check if NeRF Studio is natively accessible
    const isNsInstalled = fs.existsSync('/usr/local/bin/ns-train') || fs.existsSync('/opt/conda/bin/ns-train') || process.env.LOCAL_RUN === 'true';

    if (!isNsInstalled && !process.env.TEST_LOCAL) {
      addLog(`[System Warning] Native NeRF Studio/COLMAP binaries not detected in environment.`, 'warn');
      addLog(`[System] Initializing simulation mode for visualizer UI workflow tests.`, 'info');
      
      // Simulate progress
      const simulateProcessing = () => {
        if (!pipelineState.isRunning) return; 

        pipelineState.progress += Math.random() * 8;
        
        if (pipelineState.progress < 20) {
          addLog(`[COLMAP] Extracting features... ${pipelineState.progress.toFixed(1)}%`, 'info');
        } else if (pipelineState.progress < 50) {
          addLog(`[COLMAP] Exhaustive feature matching... ${pipelineState.progress.toFixed(1)}%`, 'info');
        } else if (pipelineState.progress < 80) {
          addLog(`[NeRFStudio] Training splatfacto model - Iteration ${Math.floor(pipelineState.progress * 300)}/30000`, 'info');
        }

        if (pipelineState.progress >= 100) {
          pipelineState.progress = 100;
          pipelineState.isRunning = false;
          addLog('[NeRFStudio] Checkpoint saved successfully.', 'success');
          addLog('Processing complete. Assets ready for Export/Visualization.', 'success');
        } else {
          setTimeout(simulateProcessing, 500);
        }
      };
      setTimeout(simulateProcessing, 1000);
      return res.json({ success: true, mode: 'simulation' });
    }

    // REAL PIPELINE EXECUTION FOR LOCAL MACHINES
    addLog(`Spawning native bindings for ${backend}...`, 'info');
    
    (async () => {
      try {
        const inputFiles = fs.readdirSync(UPLOADS_DIR);
        if (inputFiles.length === 0) throw new Error("No files uploaded");

        const targetDataDir = path.join(DATA_DIR, "processed");
        const exportPath = path.join(EXPORTS_DIR, "output.splat");

        // 1. Feature Extraction & Pose matching (ns-process-data)
        addLog(`[Process Data] Running COLMAP extraction via ns-process-data...`, 'info');
        pipelineState.progress = 10;
        
        const isVideo = inputFiles[0].match(/\.(mp4|mov|avi)$/i);
        const dataArg = isVideo 
          ? path.join(UPLOADS_DIR, inputFiles[0]) 
          : UPLOADS_DIR;

        const processType = isVideo ? 'video' : 'images';
        
        let code = await runProcess('ns-process-data', [processType, '--data', dataArg, '--output-dir', targetDataDir]);
        if (code !== 0) throw new Error("ns-process-data failed");
        
        pipelineState.progress = 40;

        // 2. Training (ns-train splatfacto)
        addLog(`[Training] Starting splatfacto training...`, 'info');
        code = await runProcess('ns-train', ['splatfacto', '--data', targetDataDir], (msg) => {
           if (msg.includes('ETA')) pipelineState.progress = Math.min(90, pipelineState.progress + 0.1);
        });
        if (code !== 0) throw new Error("ns-train failed");
        pipelineState.progress = 90;

        // 3. Export (.splat)
        // Note: ns-export commands vary, usually `ns-export gaussian-splat --load-config [config] --output-dir [dir]`
        // This is a placeholder for the final export command mapping.
        addLog(`[Export] Converting point cloud to web splat format...`, 'info');
        code = await runProcess('ns-export', ['gaussian-splat', '--output-dir', EXPORTS_DIR]);
        if (code !== 0) throw new Error("ns-export failed");

        pipelineState.progress = 100;
        pipelineState.isRunning = false;
        addLog('Pipeline completed successfully! Splat exported.', 'success');

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
