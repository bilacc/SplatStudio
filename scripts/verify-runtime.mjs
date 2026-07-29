import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  ['FFmpeg', path.join(projectRoot, 'bin', 'ffmpeg.exe')],
  ['COLMAP', path.join(projectRoot, 'bin', 'colmap.exe')],
  ['embedded Python', path.join(projectRoot, 'bin', 'python', 'python.exe')],
  ['gsplat trainer', path.join(projectRoot, 'bin', 'train_splat.py')],
];

const missing = required.filter(([, target]) => !fs.existsSync(target));

if (missing.length > 0) {
  console.error('SplatStudio cannot build a standalone installer because runtime files are missing:');
  for (const [name, target] of missing) {
    console.error(`- ${name}: ${path.relative(projectRoot, target)}`);
  }
  console.error('Provision the Windows runtime in bin/ or use npm run build:dir for a UI-only development package.');
  process.exit(1);
}

console.log('SplatStudio bundled runtime is complete.');
