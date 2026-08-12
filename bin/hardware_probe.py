"""Report available PyTorch compute backends as machine-readable JSON."""

import importlib.util
import json
import os
import platform
import sys


def module_available(name):
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def safe_call(callback, fallback=None):
    try:
        return callback()
    except Exception:
        return fallback


def memory_gb(value):
    try:
        return round(float(value) / 1073741824, 1)
    except (TypeError, ValueError):
        return None


def main():
    architecture = platform.machine() or "unknown"
    cpu_name = (
        platform.processor()
        or os.environ.get("PROCESSOR_IDENTIFIER")
        or f"{architecture} CPU"
    )
    dependency_names = ["numpy", "torch", "cv2", "plyfile", "tqdm", "gsplat"]
    result = {
        "available": False,
        "platform": sys.platform,
        "architecture": architecture,
        "python_version": platform.python_version(),
        "python_executable": sys.executable,
        "dependencies": {name: module_available(name) for name in dependency_names},
        "devices": [],
        "recommended_backend": "cpu",
        "torch_version": None,
        "cuda_version": None,
        "rocm_version": None,
    }

    accelerators = []
    torch = None
    try:
        import torch as imported_torch
        torch = imported_torch
        result["torch_version"] = getattr(torch, "__version__", None)
        result["cuda_version"] = getattr(getattr(torch, "version", None), "cuda", None)
        result["rocm_version"] = getattr(getattr(torch, "version", None), "hip", None)
    except Exception as exc:
        result["torch_error"] = str(exc)

    if torch is not None and safe_call(torch.cuda.is_available, False):
        is_rocm = bool(result["rocm_version"])
        backend = "rocm" if is_rocm else "cuda"
        vendor = "AMD" if is_rocm else "NVIDIA"
        count = safe_call(torch.cuda.device_count, 1) or 1
        for index in range(count):
            props = safe_call(lambda index=index: torch.cuda.get_device_properties(index))
            name = safe_call(lambda index=index: torch.cuda.get_device_name(index), f"{vendor} GPU {index}")
            accelerators.append({
                "id": backend if index == 0 else f"{backend}:{index}",
                "backend": backend,
                "type": backend.upper(),
                "name": name,
                "available": True,
                "index": index,
                "vram_gb": memory_gb(getattr(props, "total_memory", None)),
                "details": f"{vendor} {backend.upper()} via PyTorch",
            })

    xpu = getattr(torch, "xpu", None) if torch is not None else None
    if xpu is not None and safe_call(xpu.is_available, False):
        count = safe_call(xpu.device_count, 1) or 1
        for index in range(count):
            props = safe_call(lambda index=index: xpu.get_device_properties(index))
            name = safe_call(lambda index=index: xpu.get_device_name(index), f"Intel XPU {index}")
            total_memory = getattr(props, "total_memory", None) or getattr(props, "total_memory_size", None)
            accelerators.append({
                "id": "xpu" if index == 0 else f"xpu:{index}",
                "backend": "xpu",
                "type": "XPU",
                "name": name,
                "available": True,
                "index": index,
                "vram_gb": memory_gb(total_memory),
                "details": "Intel GPU via PyTorch XPU",
            })

    mps = getattr(getattr(torch, "backends", None), "mps", None) if torch is not None else None
    if mps is not None and safe_call(mps.is_available, False):
        accelerators.append({
            "id": "mps",
            "backend": "mps",
            "type": "MPS",
            "name": "Apple Metal GPU",
            "available": True,
            "vram_gb": None,
            "details": "Apple GPU via Metal Performance Shaders",
        })

    if module_available("torch_directml") and torch is not None:
        try:
            import torch_directml
            directml_device = torch_directml.device()
            torch.empty(1).to(directml_device)
            accelerators.append({
                "id": "directml",
                "backend": "directml",
                "type": "DirectML",
                "name": safe_call(torch_directml.device_name, "DirectML GPU"),
                "available": os.environ.get("SPLATSTUDIO_EXPERIMENTAL_DIRECTML") == "1",
                "vram_gb": None,
                "details": (
                    "Experimental Windows GPU backend; disabled by default because "
                    "the maintained torch-directml plugin lacks required training kernels"
                ),
            })
        except Exception as exc:
            result["directml_error"] = str(exc)

    cpu_details = f"Universal fallback ({architecture})"
    if torch is None:
        cpu_details += "; PyTorch is not installed"
    cpu = {
        "id": "cpu",
        "backend": "cpu",
        "type": "CPU",
        "name": cpu_name,
        "available": torch is not None,
        "vram_gb": None,
        "details": cpu_details,
    }

    available_accelerators = [device for device in accelerators if device["available"]]
    result["devices"] = [*accelerators, cpu]
    result["available"] = bool(available_accelerators) or cpu["available"]
    if available_accelerators:
        result["recommended_backend"] = available_accelerators[0]["backend"]
        first = available_accelerators[0]
        result["name"] = first["name"]
        result["vram_gb"] = first.get("vram_gb") or 0
    else:
        result["name"] = cpu["name"]
        result["vram_gb"] = 0

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
