# SplatStudio

SplatStudio is a self-contained, offline Electron workspace that turns a video or overlapping image sequence into Gaussian Splat (`.splat` and 3DGS `.ply`) output. Production builds include FFmpeg, COLMAP, Python, PyTorch, OpenCV, and every trainer dependency; users do not install or download anything separately.

## Supported compute backends

- CPU: included, verified default on Windows x64 and Windows ARM64. Large COLMAP point sets are reduced to a configurable 10,000 points to keep memory use bounded.
- Windows ARM64: the app and FFmpeg run natively; the embedded x64 COLMAP/PyTorch worker runs through Windows' built-in x64 emulation.
- CUDA, ROCm, XPU, and MPS remain supported by the trainer when a complete compatible runtime is deliberately bundled by a distributor.
- DirectML is included for compatibility research but disabled by default because its maintained PyTorch plugin lacks backward kernels required by the Gaussian trainer.

COLMAP SIFT uses CUDA only when the selected device is a verified NVIDIA CUDA backend. All other configurations use COLMAP CPU feature extraction and matching.

## Development

Build requirements are Node.js 20 or newer, npm, PowerShell, and an x64 Python 3.12 interpreter used only to assemble the embedded runtime. End users need only a supported Windows computer.

```powershell
npm install
npm run runtime:build
npm run runtime:verify
npm run doctor
npm run dev
```

Desktop development:

```powershell
npm run electron:dev
```

Run verification:

```powershell
npm run lint
npm test
bin\win32-x64\python\python.exe -I -m unittest discover -s test -p "*_test.py"
npm run build
```

## Runtime discovery

SplatStudio resolves each executable in this order:

1. `FFMPEG_PATH`, `COLMAP_PATH`, or `PYTHON_PATH`
2. `bin/<platform>-<arch>`, `bin/<platform>/<arch>`, `bin/<arch>`, then `bin`
3. the system `PATH`

Example Windows x64 bundle:

```text
bin/
  win32-x64/
    ffmpeg.exe
    colmap.exe
    python/
      python.exe
      Lib/site-packages/...
  train_splat.py
  hardware_probe.py
```

`npm run runtime:build` downloads pinned archives at build time, verifies their SHA-256 values, and assembles the complete offline runtime. `npm run runtime:verify` executes every embedded component. Runtime provenance and checksums are recorded in `bin/runtime-manifest.json`; third-party notices are in `THIRD_PARTY_NOTICES.md`.

Optional environment settings are documented in `.env.example`. Set `SPLATSTUDIO_DISABLE_GPU=1` to use Chromium software rendering on an unstable, virtual, or blocked display GPU.

## Windows builds

```powershell
npm run build:exe:x64
npm run build:exe:arm64
```

These commands produce the recommended one-click, per-user installers. They do not require administrator rights, prerequisites, or first-run downloads. Installation performs the large runtime extraction once, so normal launches are much faster than the single-file portable format.

No-install portable executables are also available when needed:

```powershell
npm run build:portable:x64
npm run build:portable:arm64
```

Artifacts are written to `release/` and include the architecture and package type in the filename. Every format contains all required runtime components and performs no first-run downloads.

Runtime projects, uploads, jobs, and exports are stored in the Electron user-data workspace, not beside the installed executable.
