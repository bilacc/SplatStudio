# SplatStudio

Local desktop Gaussian Splatting workspace for Windows.

SplatStudio is designed as a one-click `.exe` app: users should be able to add a video, image sequence, or folder of extracted frames and produce local `.splat` / `.ply` assets without installing Node, Python, FFmpeg, COLMAP, or Python packages separately.

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

Build the Windows installer:

```powershell
npm run build:exe
```

## Bundled Runtime

The packaged app includes the `bin` directory as Electron extra resources:

- `ffmpeg.exe`
- `colmap.exe` and required DLLs
- embedded Python
- PyTorch CUDA runtime
- OpenCV, `plyfile`, `gsplat`, and trainer scripts

Runtime projects, uploads, jobs, and exports are stored in the app workspace directory, not beside the installed executable.
