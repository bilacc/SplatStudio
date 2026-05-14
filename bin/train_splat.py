"""
SplatStudio - Lightweight 3D Gaussian Splatting Trainer
Uses gsplat library for GPU-accelerated training.
Designed to work with COLMAP output directories.
"""
import sys
import os
import json
import struct
import math
import argparse
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch import optim
from tqdm import tqdm

try:
    from gsplat import rasterization
except ImportError:
    print("[ERROR] gsplat not installed. Run: pip install gsplat", file=sys.stderr)
    sys.exit(1)

try:
    from plyfile import PlyData, PlyElement
except ImportError:
    print("[ERROR] plyfile not installed. Run: pip install plyfile", file=sys.stderr)
    sys.exit(1)

import cv2


def gsplat_cuda_available():
    """Return True only when gsplat's native CUDA extension is loaded."""
    try:
        from gsplat.cuda._backend import _C
        return _C is not None
    except Exception as exc:
        print(f"[WARN] Could not inspect gsplat CUDA backend: {exc}")
        return False


def read_colmap_cameras(cameras_path):
    """Read COLMAP cameras.bin or cameras.txt"""
    cameras = {}
    if cameras_path.suffix == '.txt':
        with open(cameras_path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                parts = line.split()
                cam_id = int(parts[0])
                model = parts[1]
                w, h = int(parts[2]), int(parts[3])
                params = [float(p) for p in parts[4:]]
                cameras[cam_id] = {'model': model, 'width': w, 'height': h, 'params': params}
    else:
        with open(cameras_path, 'rb') as f:
            num_cameras = struct.unpack('<Q', f.read(8))[0]
            for _ in range(num_cameras):
                cam_id = struct.unpack('<I', f.read(4))[0]
                model_id = struct.unpack('<i', f.read(4))[0]
                w = struct.unpack('<Q', f.read(8))[0]
                h = struct.unpack('<Q', f.read(8))[0]
                model_names = {0: 'SIMPLE_PINHOLE', 1: 'PINHOLE', 2: 'SIMPLE_RADIAL', 3: 'RADIAL'}
                model = model_names.get(model_id, 'UNKNOWN')
                num_params = {0: 3, 1: 4, 2: 4, 3: 5}.get(model_id, 4)
                params = list(struct.unpack(f'<{num_params}d', f.read(8 * num_params)))
                cameras[cam_id] = {'model': model, 'width': w, 'height': h, 'params': params}
    return cameras


def read_colmap_images(images_path):
    """Read COLMAP images.bin or images.txt"""
    images = []
    if images_path.suffix == '.txt':
        with open(images_path, 'r') as f:
            lines = [l.strip() for l in f if l.strip() and not l.startswith('#')]
        i = 0
        while i < len(lines):
            parts = lines[i].split()
            img_id = int(parts[0])
            qw, qx, qy, qz = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            tx, ty, tz = float(parts[5]), float(parts[6]), float(parts[7])
            cam_id = int(parts[8])
            name = parts[9]
            images.append({
                'id': img_id, 'qvec': [qw, qx, qy, qz],
                'tvec': [tx, ty, tz], 'camera_id': cam_id, 'name': name
            })
            i += 2  # Skip points2D line
    else:
        with open(images_path, 'rb') as f:
            num_images = struct.unpack('<Q', f.read(8))[0]
            for _ in range(num_images):
                img_id = struct.unpack('<I', f.read(4))[0]
                qw, qx, qy, qz = struct.unpack('<4d', f.read(32))
                tx, ty, tz = struct.unpack('<3d', f.read(24))
                cam_id = struct.unpack('<I', f.read(4))[0]
                name = b''
                while True:
                    c = f.read(1)
                    if c == b'\x00':
                        break
                    name += c
                name = name.decode('utf-8')
                num_points2d = struct.unpack('<Q', f.read(8))[0]
                f.read(num_points2d * 24)  # Skip 2D points
                images.append({
                    'id': img_id, 'qvec': [qw, qx, qy, qz],
                    'tvec': [tx, ty, tz], 'camera_id': cam_id, 'name': name
                })
    return images


def read_colmap_points3d(points3d_path):
    """Read COLMAP points3D.bin or points3D.txt"""
    points = []
    if points3d_path.suffix == '.txt':
        with open(points3d_path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                parts = line.split()
                x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
                r, g, b = int(parts[4]), int(parts[5]), int(parts[6])
                points.append({'xyz': [x, y, z], 'rgb': [r, g, b]})
    else:
        with open(points3d_path, 'rb') as f:
            num_points = struct.unpack('<Q', f.read(8))[0]
            for _ in range(num_points):
                point_id = struct.unpack('<Q', f.read(8))[0]
                x, y, z = struct.unpack('<3d', f.read(24))
                r, g, b = struct.unpack('<3B', f.read(3))
                error = struct.unpack('<d', f.read(8))[0]
                track_length = struct.unpack('<Q', f.read(8))[0]
                f.read(track_length * 8)  # Skip track data
                points.append({'xyz': [x, y, z], 'rgb': [r, g, b]})
    return points


def find_colmap_model(input_root):
    """Find the most complete COLMAP sparse model under an input workspace."""
    input_root = Path(input_root)
    sparse_root = input_root / 'sparse'
    candidates = []

    if sparse_root.exists():
        candidates.append(sparse_root)
        for child in sparse_root.iterdir():
            if child.is_dir():
                candidates.append(child)
    else:
        candidates.append(input_root)

    valid = []
    for candidate in candidates:
        for ext in ['.bin', '.txt']:
            cameras_path = candidate / f'cameras{ext}'
            images_path = candidate / f'images{ext}'
            points3d_path = candidate / f'points3D{ext}'
            if cameras_path.exists() and images_path.exists() and points3d_path.exists():
                valid.append((points3d_path.stat().st_size, candidate, cameras_path, images_path, points3d_path))
                break

    if not valid:
        return None

    valid.sort(key=lambda item: item[0], reverse=True)
    return valid[0][1:]


def qvec_to_rotmat(qvec):
    """Convert quaternion to rotation matrix"""
    w, x, y, z = qvec
    R = np.array([
        [1 - 2*y*y - 2*z*z, 2*x*y - 2*w*z, 2*x*z + 2*w*y],
        [2*x*y + 2*w*z, 1 - 2*x*x - 2*z*z, 2*y*z - 2*w*x],
        [2*x*z - 2*w*y, 2*y*z + 2*w*x, 1 - 2*x*x - 2*y*y]
    ])
    return R


def save_splat_binary(path, means, scales, quats, opacities, sh_coeffs):
    """Save to .splat binary format for web viewers"""
    n = means.shape[0]
    with open(path, 'wb') as f:
        for i in range(n):
            # Position (3 floats)
            f.write(struct.pack('<3f', *means[i].tolist()))
            # Scale (3 floats)
            f.write(struct.pack('<3f', *scales[i].tolist()))
            # Color (4 bytes: RGBA)
            r = int(max(0, min(255, (sh_coeffs[i, 0, 0].item() * 0.2821 + 0.5) * 255)))
            g = int(max(0, min(255, (sh_coeffs[i, 0, 1].item() * 0.2821 + 0.5) * 255)))
            b = int(max(0, min(255, (sh_coeffs[i, 0, 2].item() * 0.2821 + 0.5) * 255)))
            a = int(max(0, min(255, torch.sigmoid(opacities[i]).item() * 255)))
            f.write(struct.pack('<4B', r, g, b, a))
            # Quaternion (4 bytes, normalized to uint8)
            q = quats[i] / (torch.norm(quats[i]) + 1e-10)
            qb = [(int((q[j].item() * 0.5 + 0.5) * 255)) for j in range(4)]
            f.write(struct.pack('<4B', *[max(0, min(255, v)) for v in qb]))


def save_ply(path, means, scales, quats, opacities, sh_coeffs):
    """Save to PLY format"""
    n = means.shape[0]
    
    dtype = [
        ('x', 'f4'), ('y', 'f4'), ('z', 'f4'),
        ('f_dc_0', 'f4'), ('f_dc_1', 'f4'), ('f_dc_2', 'f4'),
        ('opacity', 'f4'),
        ('scale_0', 'f4'), ('scale_1', 'f4'), ('scale_2', 'f4'),
        ('rot_0', 'f4'), ('rot_1', 'f4'), ('rot_2', 'f4'), ('rot_3', 'f4'),
    ]
    
    arr = np.zeros(n, dtype=dtype)
    m = means.detach().cpu().numpy()
    s = scales.detach().cpu().numpy()
    q = quats.detach().cpu().numpy()
    o = opacities.detach().cpu().numpy()
    sh = sh_coeffs.detach().cpu().numpy()
    
    arr['x'] = m[:, 0]
    arr['y'] = m[:, 1]
    arr['z'] = m[:, 2]
    arr['f_dc_0'] = sh[:, 0, 0]
    arr['f_dc_1'] = sh[:, 0, 1]
    arr['f_dc_2'] = sh[:, 0, 2]
    arr['opacity'] = o.squeeze()
    arr['scale_0'] = s[:, 0]
    arr['scale_1'] = s[:, 1]
    arr['scale_2'] = s[:, 2]
    arr['rot_0'] = q[:, 0]
    arr['rot_1'] = q[:, 1]
    arr['rot_2'] = q[:, 2]
    arr['rot_3'] = q[:, 3]
    
    el = PlyElement.describe(arr, 'vertex')
    PlyData([el]).write(path)


def save_outputs(output_dir, means, scales, quats, opacities, sh_coeffs):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    with torch.no_grad():
        quats_norm = quats / (torch.norm(quats, dim=-1, keepdim=True) + 1e-10)

        ply_path = output_dir / 'splat.ply'
        save_ply(str(ply_path), means, scales, quats_norm, opacities, sh_coeffs)
        print(f"[SplatStudio] Saved PLY to {ply_path}")

        splat_path = output_dir / 'output.splat'
        save_splat_binary(
            str(splat_path),
            means.detach().cpu(),
            scales.detach().cpu(),
            quats_norm.detach().cpu(),
            opacities.detach().cpu(),
            sh_coeffs.detach().cpu(),
        )
        print(f"[SplatStudio] Saved .splat to {splat_path}")


def write_progress(output_dir, payload):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    with open(output_dir / 'training_progress.json', 'w') as f:
        json.dump(payload, f)


def finish_with_draft(args, reason, means, scales, quats, opacities, sh_coeffs):
    print(f"[WARN] {reason}")
    if not args.allow_draft_output:
        print("[ERROR] Native gsplat training is unavailable and draft output is disabled.")
        sys.exit(2)

    print("[SplatStudio] Exporting COLMAP-initialized draft splat.")
    save_outputs(args.output, means, scales, quats, opacities, sh_coeffs)
    write_progress(args.output, {
        'iteration': 0,
        'total': args.iterations,
        'loss': None,
        'num_gaussians': means.shape[0],
        'progress_pct': 100.0,
        'complete': True,
        'draft': True,
        'reason': reason
    })
    print("[SplatStudio] Draft export complete.")


def train(args):
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"[SplatStudio] Using device: {device}")
    if device.type == 'cuda':
        print(f"[SplatStudio] GPU: {torch.cuda.get_device_name(0)}")
        print(f"[SplatStudio] VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")

    model = find_colmap_model(args.input)
    if model is None:
        print(f"[ERROR] COLMAP data not found in {Path(args.input) / 'sparse'}")
        sys.exit(1)

    sparse_dir, cameras_path, images_path, points3d_path = model
    
    print(f"[SplatStudio] Reading COLMAP data from {sparse_dir}...")
    cameras = read_colmap_cameras(cameras_path)
    colmap_images = read_colmap_images(images_path)
    points3d = read_colmap_points3d(points3d_path)
    
    print(f"[SplatStudio] Found {len(cameras)} cameras, {len(colmap_images)} images, {len(points3d)} points")
    
    if len(points3d) == 0:
        print("[ERROR] No 3D points found in COLMAP reconstruction.")
        sys.exit(1)
    
    # Load images
    image_dir = Path(args.input) / 'images'
    if not image_dir.exists():
        image_dir = Path(args.input)
    
    # Initialize Gaussians from COLMAP points
    pts = np.array([p['xyz'] for p in points3d], dtype=np.float32)
    colors = np.array([p['rgb'] for p in points3d], dtype=np.float32) / 255.0
    
    n_points = len(pts)
    print(f"[SplatStudio] Initializing {n_points} Gaussians...")
    
    # Trainable parameters
    means = torch.tensor(pts, device=device, requires_grad=True)
    
    # Initialize scales based on nearest neighbor distances (memory-efficient)
    print(f"[SplatStudio] Computing initial scales (memory-efficient)...")
    with torch.no_grad():
        if n_points > 20000:
            # For large point clouds, sample to estimate average spacing
            sample_size = min(5000, n_points)
            indices = torch.randperm(n_points, device=device)[:sample_size]
            sample_pts = means.detach()[indices]
            
            # Compute distances in batches
            batch_size = 512
            nn_dists_list = []
            for i in range(0, sample_size, batch_size):
                batch = sample_pts[i:i+batch_size]
                dists = torch.cdist(batch.unsqueeze(0), sample_pts.unsqueeze(0)).squeeze(0)
                dists[dists == 0] = 1e10
                nn_dists_list.append(dists.min(dim=1).values)
            nn_dists_sample = torch.cat(nn_dists_list)
            avg_dist = nn_dists_sample.mean().item()
            nn_dists = torch.full((n_points,), avg_dist, device=device)
        else:
            # Small enough for full distance matrix
            batch_size = 2048
            nn_dists = torch.full((n_points,), 1e10, device=device)
            for i in range(0, n_points, batch_size):
                end = min(i + batch_size, n_points)
                dists = torch.cdist(means.detach()[i:end].unsqueeze(0), means.detach().unsqueeze(0)).squeeze(0)
                dists[:, i:end][torch.arange(end-i, device=device), torch.arange(end-i, device=device)] = 1e10
                nn_dists[i:end] = dists.min(dim=1).values
    
    scales = torch.log(nn_dists.unsqueeze(-1).repeat(1, 3) * 0.5).requires_grad_(True)
    quats = torch.zeros(n_points, 4, device=device)
    quats[:, 0] = 1.0
    quats = quats.requires_grad_(True)
    
    # SH coefficients (degree 0 only for simplicity)
    sh_coeffs = torch.zeros(n_points, 1, 3, device=device)
    sh_coeffs[:, 0, :] = torch.tensor(colors, device=device) / 0.2821 - 0.5 / 0.2821
    sh_coeffs = sh_coeffs.requires_grad_(True)
    
    opacities = torch.full((n_points, 1), -2.0, device=device, requires_grad=True)
    
    native_backend_ready = device.type == 'cuda' and gsplat_cuda_available()
    if not native_backend_ready:
        reason = "gsplat CUDA rasterizer is unavailable in the bundled Python runtime."
        finish_with_draft(args, reason, means, torch.exp(scales), quats, opacities, sh_coeffs)
        return

    # Optimizer
    optimizer = optim.Adam([
        {'params': [means], 'lr': args.lr_position},
        {'params': [scales], 'lr': args.lr_scale},
        {'params': [quats], 'lr': args.lr_rotation},
        {'params': [sh_coeffs], 'lr': args.lr_color},
        {'params': [opacities], 'lr': args.lr_opacity},
    ])
    
    # Prepare training views
    train_views = []
    for img_info in colmap_images:
        cam = cameras[img_info['camera_id']]
        
        # Find image file
        img_path = image_dir / img_info['name']
        if not img_path.exists():
            continue
        
        img = cv2.imread(str(img_path))
        if img is None:
            continue
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        
        # Resize if needed for VRAM savings
        h, w = img.shape[:2]
        scale_factor = args.resolution
        if scale_factor < 1.0:
            new_w, new_h = int(w * scale_factor), int(h * scale_factor)
            img = cv2.resize(img, (new_w, new_h))
            h, w = new_h, new_w
        
        img_tensor = torch.tensor(img, dtype=torch.float32, device=device) / 255.0
        
        # Camera matrices
        R = qvec_to_rotmat(img_info['qvec'])
        t = np.array(img_info['tvec'])
        
        # Get intrinsics
        params = cam['params']
        if cam['model'] in ['SIMPLE_PINHOLE', 'SIMPLE_RADIAL']:
            fx = fy = params[0] * scale_factor
            cx, cy = params[1] * scale_factor, params[2] * scale_factor
        else:  # PINHOLE
            fx, fy = params[0] * scale_factor, params[1] * scale_factor
            cx, cy = params[2] * scale_factor, params[3] * scale_factor
        
        K = torch.tensor([
            [fx, 0, cx],
            [0, fy, cy],
            [0, 0, 1]
        ], dtype=torch.float32, device=device)
        
        # World to camera transform
        w2c = np.eye(4)
        w2c[:3, :3] = R
        w2c[:3, 3] = t
        viewmat = torch.tensor(w2c, dtype=torch.float32, device=device)
        
        train_views.append({
            'image': img_tensor,
            'viewmat': viewmat,
            'K': K,
            'width': w,
            'height': h,
        })
    
    print(f"[SplatStudio] Loaded {len(train_views)} training views")
    if len(train_views) == 0:
        print("[ERROR] No valid training views found.")
        sys.exit(1)
    
    # Training loop
    print(f"[SplatStudio] Starting training for {args.iterations} iterations...")
    loss = None
    render_successes = 0
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    for iteration in tqdm(range(args.iterations), desc="Training"):
        optimizer.zero_grad()
        
        # Pick random view
        view = train_views[iteration % len(train_views)]
        gt_image = view['image']
        viewmat = view['viewmat']
        K = view['K']
        W, H = view['width'], view['height']
        
        # Normalize quaternions
        quats_norm = quats / (torch.norm(quats, dim=-1, keepdim=True) + 1e-10)
        
        try:
            # Render using gsplat
            renders, alphas, meta = rasterization(
                means=means,
                quats=quats_norm,
                scales=torch.exp(scales),
                opacities=torch.sigmoid(opacities.squeeze(-1)),
                colors=sh_coeffs,  # [N, 1, 3] SH coefficients
                viewmats=viewmat.unsqueeze(0),
                Ks=K.unsqueeze(0),
                width=W,
                height=H,
                sh_degree=0,
            )
            
            rendered = renders[0]  # [H, W, C]
            
        except Exception as e:
            print(f"\n[WARN] Render error at iter {iteration}: {e}")
            continue
        render_successes += 1
        
        # L1 + SSIM loss
        loss = torch.nn.functional.l1_loss(rendered, gt_image)
        
        loss.backward()
        optimizer.step()
        
        # Progress reporting
        if iteration % 100 == 0:
            print(f"\n[SplatStudio] Iter {iteration}/{args.iterations} | Loss: {loss.item():.5f} | Gaussians: {means.shape[0]}")
            # Write progress to a JSON file for the Node.js server to read
            progress = {
                'iteration': iteration,
                'total': args.iterations,
                'loss': loss.item(),
                'num_gaussians': means.shape[0],
                'progress_pct': (iteration / args.iterations) * 100
            }
            write_progress(args.output, progress)
    
    if loss is None or render_successes == 0:
        reason = "gsplat rasterization failed for every training iteration."
        finish_with_draft(args, reason, means, torch.exp(scales), quats, opacities, sh_coeffs)
        return

    # Save outputs
    print(f"[SplatStudio] Training finished. Saving model...")
    save_outputs(output_dir, means, torch.exp(scales), quats, opacities, sh_coeffs)
    
    # Final progress
    progress = {
        'iteration': args.iterations,
        'total': args.iterations,
        'loss': loss.item() if loss is not None else 0.0,
        'num_gaussians': means.shape[0],
        'progress_pct': 100.0,
        'complete': True
    }
    write_progress(output_dir, progress)
    
    print("[SplatStudio] Training complete!")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='SplatStudio 3D Gaussian Splatting Trainer')
    parser.add_argument('--input', required=True, help='Path to COLMAP workspace directory')
    parser.add_argument('--output', required=True, help='Path to output directory')
    parser.add_argument('--iterations', type=int, default=7000, help='Number of training iterations')
    parser.add_argument('--resolution', type=float, default=0.5, help='Resolution scale factor (0.25, 0.5, 1.0)')
    parser.add_argument('--lr-position', type=float, default=0.00016, help='Learning rate for positions')
    parser.add_argument('--lr-scale', type=float, default=0.005, help='Learning rate for scales')
    parser.add_argument('--lr-rotation', type=float, default=0.001, help='Learning rate for rotations')
    parser.add_argument('--lr-color', type=float, default=0.0025, help='Learning rate for colors')
    parser.add_argument('--lr-opacity', type=float, default=0.05, help='Learning rate for opacity')
    parser.add_argument('--allow-draft-output', action='store_true', help='Export COLMAP-initialized splats when native training is unavailable')
    args = parser.parse_args()
    
    train(args)
