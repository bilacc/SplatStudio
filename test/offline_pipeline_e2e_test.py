import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np


@unittest.skipUnless(
    os.environ.get('SPLATSTUDIO_E2E') == '1',
    'set SPLATSTUDIO_E2E=1 to run the embedded FFmpeg/COLMAP/PyTorch pipeline',
)
class OfflinePipelineEndToEndTest(unittest.TestCase):
    def test_video_to_trained_splat_uses_only_embedded_runtime(self):
        project = Path(
            os.environ.get('SPLATSTUDIO_E2E_ROOT', Path(__file__).resolve().parents[1])
        ).resolve()
        runtime = project / 'bin' / 'win32-x64'
        ffmpeg = runtime / 'ffmpeg.exe'
        colmap = runtime / 'colmap' / 'bin' / 'colmap.exe'
        python = runtime / 'python' / 'python.exe'
        trainer = project / 'bin' / 'train_splat.py'
        for required in (ffmpeg, colmap, python, trainer):
            self.assertTrue(required.is_file(), f'missing embedded component: {required}')

        def run(args, timeout=180):
            result = subprocess.run(
                [str(value) for value in args],
                capture_output=True,
                text=True,
                timeout=timeout,
                env={**os.environ, 'PYTHONNOUSERSITE': '1'},
            )
            self.assertEqual(
                result.returncode,
                0,
                msg=f'command failed: {args}\n{result.stdout}\n{result.stderr}',
            )
            return result

        with tempfile.TemporaryDirectory(prefix='splatstudio-offline-e2e-') as temp:
            root = Path(temp)
            source_frames = root / 'source-frames'
            images = root / 'images'
            sparse = root / 'sparse'
            output = root / 'output'
            source_frames.mkdir()
            images.mkdir()
            sparse.mkdir()

            self._render_multiview_scene(source_frames)
            video = root / 'scene.mkv'
            run([
                ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
                '-framerate', '3', '-i', source_frames / 'frame_%03d.png',
                '-c:v', 'ffv1', video,
            ])
            run([
                ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
                '-i', video, '-vf', 'fps=3', images / 'frame_%03d.png',
            ])
            self.assertEqual(len(list(images.glob('*.png'))), 12)

            database = root / 'database.db'
            run([
                colmap, 'feature_extractor',
                '--database_path', database,
                '--image_path', images,
                '--ImageReader.single_camera', '1',
                '--ImageReader.camera_model', 'PINHOLE',
                '--FeatureExtraction.use_gpu', '0',
                '--SiftExtraction.peak_threshold', '0.002',
            ])
            run([
                colmap, 'exhaustive_matcher',
                '--database_path', database,
                '--FeatureMatching.use_gpu', '0',
                '--TwoViewGeometry.min_num_inliers', '12',
            ])
            run([
                colmap, 'mapper',
                '--database_path', database,
                '--image_path', images,
                '--output_path', sparse,
                '--Mapper.min_num_matches', '12',
                '--Mapper.init_min_num_inliers', '12',
                '--Mapper.abs_pose_min_num_inliers', '12',
            ], timeout=300)

            model = sparse / '0'
            self.assertTrue(model.is_dir(), 'COLMAP did not produce a sparse model')
            run([
                colmap, 'model_converter',
                '--input_path', model,
                '--output_path', model,
                '--output_type', 'TXT',
            ])
            registered = sum(
                1 for line in (model / 'images.txt').read_text(encoding='utf-8').splitlines()
                if line and not line.startswith('#')
            ) // 2
            self.assertGreaterEqual(registered, 6)

            input_root = root / 'colmap-input'
            (input_root / 'sparse').mkdir(parents=True)
            os.replace(model, input_root / 'sparse' / '0')
            os.replace(images, input_root / 'images')
            run([
                python, '-I', trainer,
                '--input', input_root,
                '--output', output,
                '--iterations', '2',
                '--resolution', '0.2',
                '--device', 'cpu',
                '--fallback-resolution', '16',
                '--point-chunk-size', '128',
                '--max-fallback-points', '500',
            ], timeout=300)

            progress = json.loads((output / 'training_progress.json').read_text(encoding='utf-8'))
            self.assertTrue(progress['complete'])
            self.assertFalse(progress.get('draft', False), progress)
            self.assertEqual(progress['backend'], 'cpu')
            self.assertGreater((output / 'output.splat').stat().st_size, 0)
            self.assertGreater((output / 'splat.ply').stat().st_size, 0)

    @staticmethod
    def _render_multiview_scene(destination):
        width, height = 800, 600
        fx = fy = 680.0
        cx, cy = width / 2.0, height / 2.0
        rng = np.random.default_rng(20260812)
        points = np.column_stack([
            rng.uniform(-2.3, 2.3, 850),
            rng.uniform(-1.6, 1.6, 850),
            rng.uniform(4.0, 9.0, 850),
        ])
        patches = []
        for _ in points:
            patch = rng.integers(0, 256, (15, 15), dtype=np.uint8)
            patch[0, :] = patch[-1, :] = patch[:, 0] = patch[:, -1] = 255
            patch[7, :] = 255 - patch[7, :]
            patch[:, 7] = 255 - patch[:, 7]
            patches.append(patch)

        for frame_index, camera_x in enumerate(np.linspace(-0.65, 0.65, 12), start=1):
            image = np.full((height, width), 20, dtype=np.uint8)
            for point, patch in sorted(zip(points, patches), key=lambda item: item[0][2], reverse=True):
                x, y, z = point
                u = int(round(fx * ((x - camera_x) / z) + cx))
                v = int(round(fy * (y / z) + cy))
                radius = patch.shape[0] // 2
                if u - radius < 0 or v - radius < 0 or u + radius >= width or v + radius >= height:
                    continue
                target = image[v - radius:v + radius + 1, u - radius:u + radius + 1]
                np.maximum(target, patch, out=target)
            image = cv2.GaussianBlur(image, (3, 3), 0.4)
            cv2.imwrite(str(destination / f'frame_{frame_index:03d}.png'), image)


if __name__ == '__main__':
    unittest.main()
