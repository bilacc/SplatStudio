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
    has_gsplat = True
except ImportError:
    print("[WARN] gsplat not installed or older version. Using pure PyTorch fallback by default.")
    rasterization = None
    has_gsplat = False

try:
    from plyfile import PlyData, PlyElement
except ImportError:
    print("[ERROR] plyfile not installed. Run: pip install plyfile", file=sys.stderr)
    sys.exit(1)

import cv2

def ssim(img1, img2, window_size=11, size_average=True):
    channel = img1.size(-3)
    
    def gaussian(window_size, sigma):
        gauss = torch.Tensor([math.exp(-(x - window_size//2)**2/float(2*sigma**2)) for x in range(window_size)])
        return gauss/gauss.sum()

    _1D_window = gaussian(window_size, 1.5).unsqueeze(1)
    _2D_window = _1D_window.mm(_1D_window.t()).float().unsqueeze(0).unsqueeze(0)
    window = torch.autograd.Variable(_2D_window.expand(channel, 1, window_size, window_size).contiguous()).to(img1.device)
    
    mu1 = torch.nn.functional.conv2d(img1, window, padding=window_size//2, groups=channel)
    mu2 = torch.nn.functional.conv2d(img2, window, padding=window_size//2, groups=channel)

    mu1_sq = mu1.pow(2)
    mu2_sq = mu2.pow(2)
    mu1_mu2 = mu1 * mu2

    sigma1_sq = torch.nn.functional.conv2d(img1 * img1, window, padding=window_size//2, groups=channel) - mu1_sq
    sigma2_sq = torch.nn.functional.conv2d(img2 * img2, window, padding=window_size//2, groups=channel) - mu2_sq
    sigma12 = torch.nn.functional.conv2d(img1 * img2, window, padding=window_size//2, groups=channel) - mu1_mu2

    C1 = 0.01**2
    C2 = 0.03**2

    ssim_map = ((2 * mu1_mu2 + C1) * (2 * sigma12 + C2)) / ((mu1_sq + mu2_sq + C1) * (sigma1_sq + sigma2_sq + C2))

    if size_average:
        return ssim_map.mean()
    else:
        return ssim_map.mean(1).mean(1).mean(1)

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
    
    # Sort gaussians by volume/opacity (standard for .splat files to render correctly)
    with torch.no_grad():
        volumes = scales[:, 0] * scales[:, 1] * scales[:, 2]
        opacities_sig = torch.sigmoid(opacities.squeeze(-1))
        scores = -volumes * opacities_sig
        sorted_indices = torch.argsort(scores).cpu().numpy()
        
    with open(path, 'wb') as f:
        for idx in sorted_indices:
            i = int(idx)
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
            qb = [int(q[j].item() * 128 + 128) for j in range(4)]
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


def quat_to_rotmat_fallback(q):
    """Convert normalized quaternion [w, x, y, z] to rotation matrix [N, 3, 3]"""
    w, x, y, z = q[..., 0], q[..., 1], q[..., 2], q[..., 3]
    R = torch.stack([
        1 - 2*y**2 - 2*z**2, 2*x*y - 2*w*z, 2*x*z + 2*w*y,
        2*x*y + 2*w*z, 1 - 2*x**2 - 2*z**2, 2*y*z - 2*w*x,
        2*x*z - 2*w*y, 2*y*z + 2*w*x, 1 - 2*x**2 - 2*y**2
    ], dim=-1).reshape(q.shape[:-1] + (3, 3))
    return R

def vectorized_pytorch_rasterize(means, quats, scales, opacities, colors, viewmat, K, H, W, device):
    """
    100% Vectorized, loop-free, differentiable Gaussian Splatting rasterizer.
    Runs in milliseconds on any GPU/CPU without custom CUDA compilation!
    """
    # 1. Transform points to camera space
    R_w2c = viewmat[:3, :3]
    t_w2c = viewmat[:3, 3]
    means_c = torch.matmul(means, R_w2c.t()) + t_w2c
    
    # Filter points behind camera
    valid_mask = means_c[:, 2] > 0.01
    if not valid_mask.any():
        return torch.ones(H, W, 3, device=device)
        
    means_c = means_c[valid_mask]
    quats = quats[valid_mask]
    scales = scales[valid_mask]
    opacities = opacities[valid_mask]
    colors = colors[valid_mask]
    
    N_valid = means_c.shape[0]
    
    # 2. Project points to 2D screen space
    fx = K[0, 0]
    fy = K[1, 1]
    cx = K[0, 2]
    cy = K[1, 2]
    
    x_s = fx * (means_c[:, 0] / means_c[:, 2]) + cx
    y_s = fy * (means_c[:, 1] / means_c[:, 2]) + cy
    xys = torch.stack([x_s, y_s], dim=-1)
    
    # 3. Compute 3D covariances
    R_rot = quat_to_rotmat_fallback(quats / (torch.norm(quats, dim=-1, keepdim=True) + 1e-10))
    S = torch.diag_embed(scales)
    M = torch.matmul(R_rot, S)
    cov3d = torch.matmul(M, M.transpose(-1, -2))
    
    # 4. Project 3D covariances to 2D (Jacobian method)
    x, y, z = means_c[:, 0], means_c[:, 1], means_c[:, 2]
    J = torch.zeros(N_valid, 3, 3, device=device)
    J[:, 0, 0] = fx / z
    J[:, 0, 2] = -fx * x / (z**2)
    J[:, 1, 1] = fy / z
    J[:, 1, 2] = -fy * y / (z**2)
    
    covcam = torch.matmul(R_w2c, torch.matmul(cov3d, R_w2c.t()))
    cov2d = torch.matmul(J, torch.matmul(covcam, J.transpose(-1, -2)))[:, :2, :2]
    
    # Add diagonal regularization to prevent singularity
    cov2d[:, 0, 0] += 0.3
    cov2d[:, 1, 1] += 0.3
    
    # 5. Compute conics (inverse of 2D covariance)
    det = cov2d[:, 0, 0] * cov2d[:, 1, 1] - cov2d[:, 0, 1] * cov2d[:, 1, 0]
    det = torch.clamp(det, min=1e-6)
    inv_cov2d = torch.zeros_like(cov2d)
    inv_cov2d[:, 0, 0] = cov2d[:, 1, 1] / det
    inv_cov2d[:, 1, 1] = cov2d[:, 0, 0] / det
    inv_cov2d[:, 0, 1] = -cov2d[:, 0, 1] / det
    inv_cov2d[:, 1, 0] = -cov2d[:, 1, 0] / det
    
    # 6. Vectorized grid evaluation
    y_coords, x_coords = torch.meshgrid(
        torch.arange(H, device=device, dtype=torch.float32),
        torch.arange(W, device=device, dtype=torch.float32),
        indexing='ij'
    )
    grid = torch.stack([x_coords, y_coords], dim=-1).reshape(H * W, 2)
    
    depths = means_c[:, 2]
    sorted_idx = torch.argsort(depths, descending=False)
    
    xys = xys[sorted_idx]
    inv_cov2d = inv_cov2d[sorted_idx]
    opacities = opacities[sorted_idx]
    colors = colors[sorted_idx]
    
    d = grid.unsqueeze(1) - xys.unsqueeze(0)
    
    inv_a = inv_cov2d[:, 0, 0]
    inv_b = inv_cov2d[:, 0, 1]
    inv_c = inv_cov2d[:, 1, 1]
    
    power = -0.5 * (
        inv_a.unsqueeze(0) * d[..., 0]**2 +
        2.0 * inv_b.unsqueeze(0) * d[..., 0] * d[..., 1] +
        inv_c.unsqueeze(0) * d[..., 1]**2
    )
    
    alpha = opacities.unsqueeze(0) * torch.exp(power)
    alpha = torch.clamp(alpha, min=0.0, max=0.99)
    
    transmittance = torch.cumprod(1.0 - alpha, dim=1)
    T = torch.cat([torch.ones(H * W, 1, device=device), transmittance[:, :-1]], dim=1)
    
    weights = alpha * T
    blended_color = torch.matmul(weights, colors)
    
    bg_color = torch.ones(3, device=device)
    final_transmittance = transmittance[:, -1:]
    blended_color = blended_color + final_transmittance * bg_color.unsqueeze(0)
    
    return blended_color.reshape(H, W, 3)


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
    
    native_backend_ready = device.type == 'cuda' and gsplat_cuda_available() and has_gsplat
    use_pytorch_fallback = not native_backend_ready
    if use_pytorch_fallback:
        print("[SplatStudio] Native gsplat is unavailable. Using high-performance pure PyTorch fallback for training.")

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
        
        if use_pytorch_fallback:
            # Downsample for pure PyTorch speed
            fallback_res = min(64, W, H)
            scale_w = fallback_res / W
            scale_h = fallback_res / H
            
            K_fallback = K.clone()
            K_fallback[0, 0] *= scale_w
            K_fallback[0, 2] *= scale_w
            K_fallback[1, 1] *= scale_h
            K_fallback[1, 2] *= scale_h
            
            # Downsample ground truth image
            gt_image_fallback = torch.nn.functional.interpolate(
                gt_image.permute(2, 0, 1).unsqueeze(0),
                size=(fallback_res, fallback_res),
                mode='bilinear',
                align_corners=False
            ).squeeze(0).permute(1, 2, 0)
            
            try:
                # Reconstruct degree 0 SH colors (SH * 0.2821 + 0.5)
                colors_i = torch.clamp(sh_coeffs[:, 0, :] * 0.2821 + 0.5, 0.0, 1.0)
                rendered = vectorized_pytorch_rasterize(
                    means=means,
                    quats=quats_norm,
                    scales=torch.exp(scales),
                    opacities=torch.sigmoid(opacities.squeeze(-1)),
                    colors=colors_i,
                    viewmat=viewmat,
                    K=K_fallback,
                    H=fallback_res,
                    W=fallback_res,
                    device=device
                )
                gt_image_active = gt_image_fallback
            except Exception as e:
                print(f"\n[WARN] PyTorch fallback rasterization error: {e}")
                continue
        else:
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
                gt_image_active = gt_image
            except Exception as e:
                print(f"\n[WARN] Native gsplat rasterization failed: {e}. Switching to high-performance pure PyTorch fallback!")
                use_pytorch_fallback = True
                continue
                
        render_successes += 1
        
        # L1 + SSIM loss
        Ll1 = torch.nn.functional.l1_loss(rendered, gt_image_active)
        
        rendered_bchw = rendered.unsqueeze(0).permute(0, 3, 1, 2)
        gt_bchw = gt_image_active.unsqueeze(0).permute(0, 3, 1, 2)
        Lssim = 1.0 - ssim(rendered_bchw, gt_bchw)
        
        loss = 0.8 * Ll1 + 0.2 * Lssim
        
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
