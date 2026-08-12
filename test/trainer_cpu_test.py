import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REQUIRED_MODULES = ('cv2', 'numpy', 'plyfile', 'torch', 'tqdm')


@unittest.skipUnless(
    all(importlib.util.find_spec(name) is not None for name in REQUIRED_MODULES),
    'CPU trainer dependencies are not installed',
)
class CpuTrainerIntegrationTest(unittest.TestCase):
    def test_tiny_colmap_scene_trains_and_exports(self):
        import cv2
        import numpy as np
        from plyfile import PlyData

        project_root = Path(__file__).resolve().parents[1]
        trainer = project_root / 'bin' / 'train_splat.py'
        converter = project_root / 'bin' / 'ply_to_splat.py'

        with tempfile.TemporaryDirectory(prefix='splatstudio-trainer-') as temp:
            root = Path(temp)
            input_dir = root / 'input'
            sparse_dir = input_dir / 'sparse' / '0'
            images_dir = input_dir / 'images'
            output_dir = root / 'output'
            sparse_dir.mkdir(parents=True)
            images_dir.mkdir(parents=True)

            (sparse_dir / 'cameras.txt').write_text(
                '# Camera list\n1 PINHOLE 16 16 12 12 8 8\n',
                encoding='utf-8',
            )
            (sparse_dir / 'images.txt').write_text(
                '# Image list\n'
                '1 1 0 0 0 0 0 0 1 frame one.png\n'
                '\n'
                '2 1 0 0 0 -0.1 0 0 1 frame two.png\n'
                '\n',
                encoding='utf-8',
            )
            (sparse_dir / 'points3D.txt').write_text(
                '# Point list\n'
                '1 -0.2 -0.2 2.0 255 32 32 0.1\n'
                '2 0.2 -0.2 2.0 32 255 32 0.1\n'
                '3 0.0 0.2 2.0 32 32 255 0.1\n',
                encoding='utf-8',
            )

            first = np.zeros((16, 16, 3), dtype=np.uint8)
            first[:, :, 2] = np.arange(16, dtype=np.uint8)[None, :] * 16
            second = np.flip(first, axis=1).copy()
            self.assertTrue(cv2.imwrite(str(images_dir / 'frame one.png'), first))
            self.assertTrue(cv2.imwrite(str(images_dir / 'frame two.png'), second))

            requested_backend = os.environ.get('SPLATSTUDIO_TEST_DEVICE', 'cpu')
            result = subprocess.run(
                [
                    sys.executable,
                    str(trainer),
                    '--input', str(input_dir),
                    '--output', str(output_dir),
                    '--iterations', '2',
                    '--resolution', '1',
                    '--device', requested_backend,
                    '--fallback-resolution', '16',
                    '--point-chunk-size', '2',
                    '--max-fallback-points', '100',
                    '--allow-draft-output',
                ],
                capture_output=True,
                text=True,
                timeout=120,
            )
            self.assertEqual(result.returncode, 0, msg=f'{result.stdout}\n{result.stderr}')
            self.assertIn('Loaded 2 training views', result.stdout)

            splat_path = output_dir / 'output.splat'
            ply_path = output_dir / 'splat.ply'
            progress_path = output_dir / 'training_progress.json'
            self.assertEqual(splat_path.stat().st_size, 3 * 32)
            self.assertTrue(ply_path.is_file())
            progress = json.loads(progress_path.read_text(encoding='utf-8'))
            self.assertTrue(progress['complete'])
            self.assertEqual(progress['backend'], requested_backend.split(':', 1)[0])
            self.assertFalse(
                progress.get('draft', False),
                msg=f'{result.stdout}\n{result.stderr}\n{progress}',
            )

            vertices = PlyData.read(str(ply_path), mmap=False)['vertex']
            self.assertEqual(len(vertices), 3)
            self.assertTrue(np.all(np.asarray(vertices['scale_0']) < 0))

            converted_path = output_dir / 'converted.splat'
            conversion = subprocess.run(
                [sys.executable, str(converter), str(ply_path), str(converted_path)],
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(conversion.returncode, 0, msg=f'{conversion.stdout}\n{conversion.stderr}')
            self.assertEqual(converted_path.stat().st_size, splat_path.stat().st_size)


if __name__ == '__main__':
    unittest.main()
