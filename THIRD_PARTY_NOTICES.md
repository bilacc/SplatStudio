# Third-party runtime notices

SplatStudio's self-contained Windows distribution includes these pinned runtime components:

- Python 3.12.10 embedded runtime — Python Software Foundation License. The complete license is shipped at `bin/win32-x64/python/LICENSE.txt`.
- PyTorch 2.4.1 CPU — BSD-style license. Its `LICENSE`, `NOTICE`, and package metadata are shipped in the embedded Python `site-packages` directory.
- torch-directml 0.2.5.dev240914 — MIT license. It is retained only as an opt-in experimental backend; SplatStudio defaults to the verified CPU trainer.
- NumPy 1.26.4, OpenCV Headless 4.10.0.84, plyfile 1.1.3, tqdm 4.67.1, and their Python dependencies — their license metadata and license files are shipped alongside each package.
- COLMAP 4.1.1 CPU for Windows — new BSD license; see `licenses/COLMAP-COPYING.txt`. The official binary distribution also contains separately licensed dependencies.
- FFmpeg 8.1 LGPL builds from BtbN — LGPL; the build license is shipped beside each architecture-specific executable.
- Electron and JavaScript production dependencies — their package license metadata is included in the application archive.

Source and version URLs, archive SHA-256 values, and the generated runtime description are recorded in `bin/runtime-manifest.json`. No runtime component is downloaded when the application starts.
