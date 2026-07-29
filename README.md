# SplatStudio

Local desktop Gaussian Splatting workspace for Windows.

SplatStudio turns a video, image sequence, or folder of frames into local `.splat` and `.ply` assets. The desktop app runs an entirely local FFmpeg → COLMAP → gsplat pipeline, reports runtime readiness before a job starts, persists job outputs, and includes a real-time viewer.

## Development

Prerequisites for development only:

- Node.js
- npm

```powershell
npm install
npm run dev
```

Desktop development:

```powershell
npm run electron:dev
```

Run the full project check:

```powershell
npm run check
```

## Reconstruction Runtime

During development, SplatStudio looks for tools in `bin` first and then on the system `PATH`:

- FFmpeg (video inputs only)
- COLMAP
- Python with PyTorch, OpenCV, `plyfile`, and `gsplat`
- `bin/train_splat.py`

The Reconstruction and Settings screens show which tools were detected and whether image or video processing is ready.

## Windows Packaging

The standalone NSIS installer must contain the complete runtime:

- `bin/ffmpeg.exe`
- `bin/colmap.exe` and its DLLs
- `bin/python/python.exe` and required Python packages
- `bin/train_splat.py`

Verify and build the installer:

```powershell
npm run verify:runtime
npm run build:exe
```

Runtime projects, uploads, jobs, and exports are stored in the app workspace directory, not beside the installed executable.
