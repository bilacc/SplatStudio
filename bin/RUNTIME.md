# Windows runtime layout

The standalone SplatStudio installer copies this directory into Electron resources.

Expected files:

```text
bin/
  ffmpeg.exe
  colmap.exe
  train_splat.py
  ply_to_splat.py
  lib/                    # COLMAP/runtime DLLs when required
  python/
    python.exe
    Lib/site-packages/    # torch, gsplat, numpy, opencv-python, plyfile, tqdm
```

Development mode can use FFmpeg, COLMAP, and Python from the system `PATH`. Installer builds intentionally run `npm run verify:runtime` first so an incomplete standalone package is never published accidentally.

After provisioning Python, verify its packages with:

```powershell
bin\python\python.exe -c "import torch, gsplat, cv2, numpy, plyfile, tqdm; print(torch.cuda.is_available())"
```
