import fs from "fs";
import path from "path";

function isFile(candidate) {
  if (!candidate) return false;
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function unique(items) {
  return [...new Set(items.filter(Boolean).map((item) => path.resolve(item)))];
}

function executableExtensions(platform, env) {
  if (platform !== "win32") return [""];
  const configured = String(env.PATHEXT || ".EXE;.COM").split(";").filter(Boolean);
  return [...new Set(["", ...configured].map((extension) => extension.toLowerCase()))];
}

export function findExecutableOnPath(command, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const pathValue = env.PATH || env.Path || env.path || "";
  const extensions = path.extname(command)
    ? [""]
    : executableExtensions(platform, env);

  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const cleanDirectory = directory.replace(/^"|"$/g, "");
    for (const extension of extensions) {
      const candidate = path.join(cleanDirectory, `${command}${extension}`);
      if (isFile(candidate)) return path.resolve(candidate);
    }
  }
  return null;
}

function resolveTool({ envPath, relativeCandidates, commands }, context) {
  const configured = context.env[envPath];
  if (configured && isFile(configured)) {
    return { path: path.resolve(configured), source: "configured" };
  }

  for (const root of context.roots) {
    for (const relativeCandidate of relativeCandidates) {
      const candidate = path.join(root, relativeCandidate);
      if (isFile(candidate)) {
        return { path: path.resolve(candidate), source: "bundled" };
      }
    }
  }

  for (const command of commands) {
    const candidate = findExecutableOnPath(command, context);
    if (candidate) return { path: candidate, source: "system" };
  }

  return { path: null, source: "missing" };
}

export function resolveRuntime(options = {}) {
  const binDir = path.resolve(options.binDir || path.join(process.cwd(), "bin"));
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const roots = unique([
    path.join(binDir, `${platform}-${arch}`),
    path.join(binDir, platform, arch),
    path.join(binDir, arch),
    ...(platform === "win32" && arch === "arm64"
      ? [path.join(binDir, "win32-x64"), path.join(binDir, "win32", "x64"), path.join(binDir, "x64")]
      : []),
    binDir,
  ]);
  const context = { binDir, env, platform, arch, roots };

  const ffmpeg = resolveTool({
    envPath: "FFMPEG_PATH",
    relativeCandidates: platform === "win32"
      ? ["ffmpeg.exe", "ffmpeg/bin/ffmpeg.exe", "bin/ffmpeg.exe"]
      : ["ffmpeg", "ffmpeg/bin/ffmpeg", "bin/ffmpeg"],
    commands: ["ffmpeg"],
  }, context);

  const colmap = resolveTool({
    envPath: "COLMAP_PATH",
    relativeCandidates: platform === "win32"
      ? ["colmap.exe", "colmap/bin/colmap.exe", "COLMAP/bin/colmap.exe", "bin/colmap.exe"]
      : ["colmap", "colmap/bin/colmap", "COLMAP/bin/colmap", "bin/colmap"],
    commands: ["colmap"],
  }, context);

  const python = resolveTool({
    envPath: "PYTHON_PATH",
    relativeCandidates: platform === "win32"
      ? ["python/python.exe", "python.exe", "python3.exe"]
      : ["python/bin/python3", "python/bin/python", "python3", "python"],
    commands: platform === "win32" ? ["python", "python3"] : ["python3", "python"],
  }, context);

  const scriptRoots = unique([binDir, ...roots]);
  const findScript = (name) => scriptRoots.map((root) => path.join(root, name)).find(isFile) || null;

  return {
    platform,
    arch,
    binDir,
    roots,
    ffmpeg,
    colmap,
    python,
    trainer: findScript("train_splat.py"),
    hardwareProbe: findScript("hardware_probe.py"),
  };
}

export function buildRuntimeEnv(runtime, baseEnv = process.env) {
  const directories = [];
  for (const tool of [runtime.ffmpeg, runtime.colmap, runtime.python]) {
    if (tool?.path) directories.push(path.dirname(tool.path));
  }

  for (const root of runtime.roots || []) {
    directories.push(root, path.join(root, "bin"), path.join(root, "lib"));
  }

  if (runtime.python?.path) {
    const pythonRoot = path.dirname(runtime.python.path);
    directories.push(
      pythonRoot,
      path.join(pythonRoot, "Lib", "site-packages", "torch", "lib"),
      path.join(pythonRoot, "lib"),
    );
  }

  const pathPrefix = unique(directories.filter((directory) => {
    try {
      return fs.statSync(directory).isDirectory();
    } catch {
      return false;
    }
  })).join(path.delimiter);

  return {
    ...baseEnv,
    BIN_DIR: runtime.binDir,
    PATH: `${pathPrefix}${pathPrefix ? path.delimiter : ""}${baseEnv.PATH || ""}`,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONNOUSERSITE: "1",
  };
}

export function publicRuntimeInfo(runtime) {
  const toPublicTool = (tool) => ({
    available: Boolean(tool?.path),
    path: tool?.path || null,
    source: tool?.source || "missing",
  });

  const tools = {
    ffmpeg: toPublicTool(runtime.ffmpeg),
    colmap: toPublicTool(runtime.colmap),
    python: toPublicTool(runtime.python),
    trainer: { available: Boolean(runtime.trainer), path: runtime.trainer || null, source: runtime.trainer ? "bundled" : "missing" },
    hardwareProbe: { available: Boolean(runtime.hardwareProbe), path: runtime.hardwareProbe || null, source: runtime.hardwareProbe ? "bundled" : "missing" },
  };

  return {
    platform: runtime.platform,
    arch: runtime.arch,
    binDir: runtime.binDir,
    tools,
    ready: tools.colmap.available && tools.python.available && tools.trainer.available,
  };
}
