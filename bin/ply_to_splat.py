import sys
import struct
import math
import numpy as np
from pathlib import Path

try:
    from plyfile import PlyData
except ImportError:
    print("[ERROR] plyfile not installed. Please run: pip install plyfile", file=sys.stderr)
    sys.exit(1)

def sigmoid(x):
    return 1 / (1 + np.exp(-x))

def convert_ply_to_splat(ply_path, splat_path):
    print(f"Reading PLY from {ply_path}...")
    try:
        plydata = PlyData.read(ply_path)
    except Exception as e:
        print(f"[ERROR] Failed to read PLY: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        vertex = plydata['vertex']
    except KeyError:
        available_elements = list(plydata._entity_map.keys()) if hasattr(plydata, '_entity_map') else [el.name for el in plydata.elements]
        raise KeyError(f"Element 'vertex' not found in PLY file. Available elements: {available_elements}")
    
    # Print available properties to help debugging
    properties = [p.name for p in vertex.properties]
    print(f"[DEBUG] Available vertex properties: {properties}", file=sys.stderr)

    # Extract positions
    try:
        x = np.asarray(vertex['x'])
        y = np.asarray(vertex['y'])
        z = np.asarray(vertex['z'])
    except ValueError as e:
        raise ValueError(f"Failed to find coordinate fields (x, y, z). Available vertex properties: {properties}. Original error: {e}")
        
    num_vertices = len(x)
    print(f"Loaded {num_vertices} vertices.")

    # Extract scales
    try:
        scale_0 = np.asarray(vertex['scale_0'])
        scale_1 = np.asarray(vertex['scale_1'])
        scale_2 = np.asarray(vertex['scale_2'])
        scales = np.stack([scale_0, scale_1, scale_2], axis=-1)
        # Convert log-scale to linear scale
        scales = np.exp(scales)
    except KeyError:
        print("[WARN] Scale properties not found. Using default scale.")
        scales = np.ones((num_vertices, 3), dtype=np.float32) * 0.01

    # Extract rotations
    try:
        rot_0 = np.asarray(vertex['rot_0'])
        rot_1 = np.asarray(vertex['rot_1'])
        rot_2 = np.asarray(vertex['rot_2'])
        rot_3 = np.asarray(vertex['rot_3'])
        quats = np.stack([rot_0, rot_1, rot_2, rot_3], axis=-1)
        # Normalize quaternions
        norm = np.linalg.norm(quats, axis=-1, keepdims=True)
        norm[norm == 0] = 1e-10
        quats = quats / norm
    except KeyError:
        print("[WARN] Rotation properties not found. Using identity rotation.")
        quats = np.zeros((num_vertices, 4), dtype=np.float32)
        quats[:, 0] = 1.0

    # Extract opacities
    try:
        opacity = np.asarray(vertex['opacity'])
        # Apply sigmoid if values look like logits (which is standard for 3DGS PLY)
        # Usually if opacity contains values outside [0, 1], it's logits.
        if np.min(opacity) < 0 or np.max(opacity) > 1:
            opacity = sigmoid(opacity)
    except KeyError:
        print("[WARN] Opacity property not found. Using default 1.0.")
        opacity = np.ones(num_vertices, dtype=np.float32)

    # Extract colors (from SH DC coefficients or direct RGB)
    # 3DGS standard uses f_dc_0, f_dc_1, f_dc_2
    SH_C0 = 0.28209479177387814
    try:
        f_dc_0 = np.asarray(vertex['f_dc_0'])
        f_dc_1 = np.asarray(vertex['f_dc_1'])
        f_dc_2 = np.asarray(vertex['f_dc_2'])
        r = np.clip((f_dc_0 * SH_C0 + 0.5) * 255, 0, 255).astype(np.uint8)
        g = np.clip((f_dc_1 * SH_C0 + 0.5) * 255, 0, 255).astype(np.uint8)
        b = np.clip((f_dc_2 * SH_C0 + 0.5) * 255, 0, 255).astype(np.uint8)
    except KeyError:
        # Try direct red, green, blue if available
        try:
            r = np.asarray(vertex['red']).astype(np.uint8)
            g = np.asarray(vertex['green']).astype(np.uint8)
            b = np.asarray(vertex['blue']).astype(np.uint8)
        except KeyError:
            print("[WARN] Color properties not found. Using default white.")
            r = np.ones(num_vertices, dtype=np.uint8) * 255
            g = np.ones(num_vertices, dtype=np.uint8) * 255
            b = np.ones(num_vertices, dtype=np.uint8) * 255

    a = (opacity * 255).clip(0, 255).astype(np.uint8)

    # Sort gaussians by volume/opacity (standard for .splat files to render correctly)
    try:
        scale_0 = np.asarray(vertex['scale_0'])
        scale_1 = np.asarray(vertex['scale_1'])
        scale_2 = np.asarray(vertex['scale_2'])
        opacity_raw = np.asarray(vertex['opacity'])
        sorted_indices = np.argsort(
            -np.exp(scale_0 + scale_1 + scale_2)
            / (1 + np.exp(-opacity_raw))
        )
    except Exception:
        sorted_indices = np.arange(num_vertices)

    print(f"Writing .splat to {splat_path}...")
    with open(splat_path, 'wb') as f:
        for idx in sorted_indices:
            i = int(idx)
            # Position (3 floats)
            f.write(struct.pack('<3f', float(x[i]), float(y[i]), float(z[i])))
            # Scale (3 floats)
            f.write(struct.pack('<3f', float(scales[i, 0]), float(scales[i, 1]), float(scales[i, 2])))
            # Color (RGBA: 4 bytes)
            f.write(struct.pack('<4B', int(r[i]), int(g[i]), int(b[i]), int(a[i])))
            # Quaternion (4 bytes, normalized to uint8)
            # Map [-1, 1] to [0, 255] using standard (q * 128 + 128)
            qb0 = int(quats[i, 0] * 128 + 128)
            qb1 = int(quats[i, 1] * 128 + 128)
            qb2 = int(quats[i, 2] * 128 + 128)
            qb3 = int(quats[i, 3] * 128 + 128)
            f.write(struct.pack('<4B', 
                max(0, min(255, qb0)), 
                max(0, min(255, qb1)), 
                max(0, min(255, qb2)), 
                max(0, min(255, qb3))
            ))
            
    print("Conversion complete!")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python ply_to_splat.py <input.ply> <output.splat>")
        sys.exit(1)
    
    try:
        convert_ply_to_splat(sys.argv[1], sys.argv[2])
    except Exception as e:
        import traceback
        # Write log next to input PLY file so user can easily find it
        error_log = Path(sys.argv[1]).parent / "ply_conversion_error.log"
        with open(error_log, "w") as f:
            f.write(f"Error during conversion:\n{str(e)}\n\nTraceback:\n")
            traceback.print_exc(file=f)
        # Print full traceback to stderr so Electron backend can capture it and send it to React
        traceback.print_exc(file=sys.stderr)
        print(f"[ERROR] Conversion failed: {e}", file=sys.stderr)
        sys.exit(1)
