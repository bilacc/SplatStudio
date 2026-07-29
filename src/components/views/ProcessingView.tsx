import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cpu, HardDrive, Play, RefreshCw, Square } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store';

const isVideoName = (name: string) => /\.(mp4|mov|avi|mkv|m4v|webm)$/i.test(name);

export function ProcessingView() {
  const {
    isProcessing,
    progress,
    startProcessing,
    stopProcessing,
    files,
    localInputs,
    extractFps,
    setExtractFps,
    maxIterations,
    setMaxIterations,
    resolution,
    setResolution,
    featureQuality,
    setFeatureQuality,
    scenePreset,
    setScenePreset,
    runtimeInfo,
    runtimeLoading,
    refreshRuntimeInfo,
  } = useAppStore();

  const [gpuInfo, setGpuInfo] = useState<{
    available?: boolean;
    name?: string;
    vram_gb?: number;
    cuda_version?: string;
    error?: string;
  } | null>(null);

  const inputCount = files.length + localInputs.length;
  const needsFfmpeg = files.some((file) => file.type.startsWith('video/') || isVideoName(file.name))
    || localInputs.some((input) => input.kind === 'file' && isVideoName(input.name));
  const runtimeReady = Boolean(runtimeInfo && (needsFfmpeg ? runtimeInfo.readyForVideo : runtimeInfo.readyForImages));
  const missingKeys = runtimeInfo
    ? (needsFfmpeg ? runtimeInfo.missingForVideo : runtimeInfo.missingForImages)
    : [];
  const missingLabels = missingKeys.map((key) => runtimeInfo?.tools[key as keyof typeof runtimeInfo.tools]?.label || key);

  useEffect(() => {
    if (runtimeInfo && !runtimeInfo.tools.pythonPackages.available) {
      const missing = runtimeInfo.tools.pythonPackages.missingModules?.join(', ');
      setGpuInfo({ available: false, error: missing ? `Python packages missing: ${missing}` : 'Python ML packages are not ready.' });
      return;
    }
    fetch('/api/gpu-info').then((response) => response.json()).then(setGpuInfo).catch(() => {
      setGpuInfo({ available: false, error: 'GPU status is unavailable.' });
    });
  }, [runtimeInfo]);

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="flex items-end justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Reconstruction Pipeline</h1>
          <p className="text-[13px] text-gray-400">Configure COLMAP and Gaussian Splat training parameters.</p>
        </div>
        <button
          onClick={() => refreshRuntimeInfo()}
          disabled={runtimeLoading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] text-gray-300 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', runtimeLoading && 'animate-spin')} />
          Check runtime
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 overflow-y-auto pr-2 pb-8">
        <div className="lg:col-span-12 xl:col-span-6 bg-[#1A1D23] rounded-2xl p-5 border border-white/5 flex flex-col">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Hardware & Runtime</h3>

          <div className={cn(
            'p-4 rounded-xl border mb-4',
            runtimeReady ? 'bg-green-500/5 border-green-500/20' : 'bg-yellow-500/5 border-yellow-500/20',
          )}>
            <div className="flex items-center gap-3">
              {runtimeReady
                ? <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                : <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0" />}
              <div className="min-w-0">
                <p className={cn('text-xs font-semibold', runtimeReady ? 'text-green-300' : 'text-yellow-400')}>
                  {runtimeReady ? 'Reconstruction runtime ready' : 'Runtime setup required'}
                </p>
                <p className="text-[10px] text-gray-500 mt-1">
                  {runtimeReady
                    ? `${needsFfmpeg ? 'Video' : 'Image'} input is supported by the detected tools.`
                    : runtimeInfo
                      ? `Missing: ${missingLabels.join(', ') || 'required tools'}`
                      : 'Checking FFmpeg, COLMAP, Python, and the trainer...'}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {runtimeInfo && Object.entries(runtimeInfo.tools).map(([key, tool]) => (
              <div key={key} className="flex items-center justify-between px-3 py-2.5 bg-black/20 rounded-lg border border-white/5">
                <span className="text-xs text-gray-300">{tool.label}</span>
                <span className={cn(
                  'text-[10px] font-mono uppercase',
                  tool.available ? 'text-green-400' : 'text-yellow-500',
                )}>
                  {tool.available ? tool.source : 'missing'}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 px-3 py-3 rounded-xl bg-blue-500/5 border border-blue-500/10 flex items-start gap-3">
            <Cpu className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-300">{gpuInfo?.name || 'CUDA GPU detection'}</p>
              <p className="text-[10px] text-gray-500 mt-1">
                {gpuInfo?.available
                  ? `CUDA ${gpuInfo.cuda_version} · ${gpuInfo.vram_gb} GB VRAM`
                  : gpuInfo?.error || 'A CUDA-capable NVIDIA GPU is required for trained output.'}
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-12 xl:col-span-6 bg-[#1A1D23] rounded-2xl p-5 border border-white/5 flex flex-col">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Pipeline Configuration</h3>
          <div className="space-y-4 flex-1">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] text-gray-500">Feature Quality</span>
                <select
                  disabled={isProcessing}
                  value={featureQuality}
                  onChange={(event) => setFeatureQuality(event.target.value as typeof featureQuality)}
                  className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="low">Low · fastest</option>
                  <option value="medium">Medium</option>
                  <option value="high">High · recommended</option>
                  <option value="ultra">Ultra · most features</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-gray-500">Scene Preset</span>
                <select
                  disabled={isProcessing}
                  value={scenePreset}
                  onChange={(event) => setScenePreset(event.target.value as typeof scenePreset)}
                  className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="object">Object / turntable</option>
                  <option value="indoor">Indoor / room</option>
                  <option value="city">Sequential / city</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] text-gray-500">Video Extraction</span>
                <div className="flex bg-black/30 border border-white/5 rounded-lg overflow-hidden">
                  <input
                    type="number"
                    min={0.1}
                    max={60}
                    step={0.5}
                    disabled={isProcessing}
                    value={extractFps}
                    onChange={(event) => setExtractFps(Number(event.target.value))}
                    className="w-full bg-transparent p-3 text-xs text-gray-300 focus:outline-none disabled:opacity-50"
                  />
                  <span className="flex items-center px-3 text-xs text-gray-600 bg-black/50">fps</span>
                </div>
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-gray-500">Resolution</span>
                <select
                  disabled={isProcessing}
                  value={resolution}
                  onChange={(event) => setResolution(Number(event.target.value))}
                  className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value={1}>Full</option>
                  <option value={0.5}>Half · recommended</option>
                  <option value={0.25}>Quarter</option>
                </select>
              </label>
            </div>

            <label className="space-y-1 block">
              <span className="text-[10px] text-gray-500">Training Iterations</span>
              <input
                type="number"
                min={1}
                max={100000}
                disabled={isProcessing}
                value={maxIterations}
                onChange={(event) => setMaxIterations(Number(event.target.value))}
                className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
            </label>
          </div>
        </div>

        <div className="lg:col-span-12 bg-[#1A1D23] rounded-2xl p-8 border border-white/5 flex flex-col items-center justify-center text-center relative overflow-hidden">
          {isProcessing && (
            <motion.div
              className="absolute inset-0 bg-blue-500/5"
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          )}

          <div className="z-10 w-full mb-6 flex items-center justify-center gap-2 text-xs text-gray-500 font-mono">
            <HardDrive className="w-4 h-4" />
            <span>{inputCount} input item{inputCount === 1 ? '' : 's'} ready</span>
          </div>

          {isProcessing ? (
            <div className="w-full z-10 flex flex-col items-center max-w-md">
              <div className="w-full h-1.5 bg-black/50 rounded-full mb-2 overflow-hidden">
                <motion.div
                  className="bg-blue-500 h-1.5 rounded-full"
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
              <span className="text-[11px] font-mono text-blue-400 mb-8">{Math.round(progress)}% complete</span>
              <button
                onClick={stopProcessing}
                className="flex items-center justify-center px-6 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl border border-white/5 text-xs font-medium w-full max-w-xs"
              >
                <Square className="w-3.5 h-3.5 mr-2" />
                Abort Processing
              </button>
            </div>
          ) : (
            <div className="w-full max-w-sm z-10">
              <button
                onClick={startProcessing}
                disabled={inputCount === 0 || !runtimeReady || runtimeLoading}
                className={cn(
                  'flex items-center justify-center w-full py-4 rounded-xl transition-all text-xs font-medium shadow-lg',
                  inputCount > 0 && runtimeReady
                    ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-blue-900/30'
                    : 'bg-white/5 text-gray-600 cursor-not-allowed border border-white/5',
                )}
              >
                <Play className="w-4 h-4 mr-2 fill-current" />
                Start Reconstruction
              </button>
              {inputCount === 0 && <p className="text-[10px] text-gray-500 mt-3">Add images, a frame folder, or one video in Workspace.</p>}
              {inputCount > 0 && !runtimeReady && <p className="text-[10px] text-yellow-500 mt-3">Complete the runtime setup shown above before starting.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
