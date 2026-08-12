import React, { useEffect, useMemo, useState } from 'react';
import { HardDrive, Play, RefreshCw, Square } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store';

interface HardwareDevice {
  id: string;
  backend: string;
  type: string;
  name: string;
  available: boolean;
  details?: string;
  vram_gb?: number | null;
}

interface HardwareInfo {
  recommended_backend?: string;
  architecture?: string;
  torch_version?: string | null;
  devices?: HardwareDevice[];
  error?: string;
}

interface RuntimeTool {
  available: boolean;
  path: string | null;
  source: string;
}

interface RuntimeInfo {
  ready: boolean;
  videoReady: boolean;
  offlineReady: boolean;
  platform: string;
  arch: string;
  tools: Record<string, RuntimeTool>;
  missingPythonDependencies: string[];
}

export function ProcessingView() {
  const {
    hardwareBackend,
    setHardwareBackend,
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
  } = useAppStore();

  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inputCount = files.length + localInputs.length;

  const refreshStatus = async () => {
    setIsRefreshing(true);
    setStatusError(null);
    try {
      const [hardwareResponse, runtimeResponse] = await Promise.all([
        fetch('/api/gpu-info'),
        fetch('/api/runtime-info'),
      ]);
      if (!hardwareResponse.ok || !runtimeResponse.ok) {
        throw new Error('Runtime status request failed.');
      }
      setHardware(await hardwareResponse.json());
      setRuntime(await runtimeResponse.json());
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Runtime status request failed.');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const backends = useMemo(() => {
    const devices = hardware?.devices || [];
    const recommended = devices.find((device) => device.backend === hardware?.recommended_backend && device.available);
    return [
      {
        id: 'auto',
        name: `Automatic${recommended ? ` — ${recommended.name}` : ''}`,
        details: 'Select the fastest backend verified by the active PyTorch runtime.',
        available: devices.some((device) => device.available),
        type: 'AUTO',
      },
      ...devices,
    ];
  }, [hardware]);

  const selectedBackend = backends.find((backend) => backend.id === hardwareBackend);
  const showPortableWarning = Boolean(
    selectedBackend && selectedBackend.id !== 'auto' && selectedBackend.type !== 'CUDA',
  );
  const canStart = inputCount > 0 && runtime?.ready === true && selectedBackend?.available !== false;
  const missingTools = runtime
    ? Object.entries<RuntimeTool>(runtime.tools).filter(([, tool]) => !tool.available).map(([name]) => name)
    : [];

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="mb-6 shrink-0 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Reconstruction Pipeline</h1>
          <p className="text-[13px] text-gray-400">Configure COLMAP and Gaussian Splat training using detected hardware.</p>
        </div>
        <button
          onClick={refreshStatus}
          disabled={isRefreshing || isProcessing}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 rounded-lg text-[10px] text-gray-300 border border-white/10"
        >
          <RefreshCw className={cn('w-3 h-3', isRefreshing && 'animate-spin')} />
          Refresh runtime
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 overflow-y-auto pr-2 pb-8">
        <div className="lg:col-span-7 bg-[#1A1D23] rounded-2xl p-5 border border-white/5 flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Verified Compute Backends</h3>
            <span className="text-[10px] text-gray-500 font-mono">
              {hardware?.architecture || runtime?.arch || 'detecting…'}
            </span>
          </div>

          <div className="space-y-2">
            {backends.map((backend) => {
              const isActive = hardwareBackend === backend.id;
              return (
                <button
                  type="button"
                  key={backend.id}
                  disabled={isProcessing || !backend.available}
                  onClick={() => setHardwareBackend(backend.id)}
                  className={cn(
                    'w-full flex items-center justify-between p-3 rounded-xl transition-all text-left',
                    isActive ? 'bg-white/5 border border-blue-500/50' : 'bg-black/30 border border-transparent hover:border-white/10',
                    (!backend.available || isProcessing) && 'opacity-45 cursor-not-allowed',
                  )}
                >
                  <div className="min-w-0 pr-3">
                    <div className={cn('text-sm font-semibold truncate', isActive ? 'text-white' : 'text-gray-400')}>{backend.name}</div>
                    <div className="text-[10px] text-gray-500">
                      {backend.details || backend.type}
                      {'vram_gb' in backend && backend.vram_gb ? ` · ${backend.vram_gb} GB` : ''}
                    </div>
                  </div>
                  <div className={cn('w-4 h-4 rounded-full flex items-center justify-center shrink-0', isActive ? 'border-2 border-blue-500' : 'border border-white/10')}>
                    {isActive && <div className="w-2 h-2 bg-blue-500 rounded-full" />}
                  </div>
                </button>
              );
            })}
          </div>

          {showPortableWarning && (
            <div className="mt-4 text-[10px] text-yellow-500/90 bg-yellow-500/10 p-3 rounded-lg border border-yellow-500/20">
              This backend uses the portable, memory-bounded PyTorch renderer. It is slower and trains a reduced point set on large scenes; output remains viewable and exportable.
            </div>
          )}
          {hardware?.error && <p className="mt-3 text-[10px] text-red-400">{hardware.error}</p>}
          {runtime?.offlineReady && (
            <p className="mt-3 text-[10px] text-green-400">Complete offline runtime verified. No downloads or external installations are needed.</p>
          )}
        </div>

        <div className="lg:col-span-5 bg-[#1A1D23] rounded-2xl p-5 border border-white/5 flex flex-col">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Pipeline Configuration</h3>
          <div className="space-y-4 flex-1">
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500">Trainer</label>
              <div className="bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-blue-400">Adaptive gsplat / PyTorch</div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500">Video Extraction (FPS)</label>
              <input type="number" min={0.1} max={60} step={0.1} disabled={isProcessing} value={extractFps} onChange={(event) => setExtractFps(Number(event.target.value))} className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500">Training Iterations</label>
              <input type="number" min={1} max={100000} disabled={isProcessing} value={maxIterations} onChange={(event) => setMaxIterations(Number(event.target.value))} className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500">Training Resolution</label>
              <select disabled={isProcessing} value={resolution} onChange={(event) => setResolution(Number(event.target.value))} className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500">
                <option value={1}>1.0 (Full)</option>
                <option value={0.5}>0.5 (Half)</option>
                <option value={0.25}>0.25 (Quarter)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="lg:col-span-12 bg-[#1A1D23] rounded-2xl p-7 border border-white/5 flex flex-col items-center justify-center text-center relative overflow-hidden">
          {isProcessing && <motion.div className="absolute inset-0 bg-blue-500/5" animate={{ opacity: [0.3, 0.6, 0.3] }} transition={{ duration: 2, repeat: Infinity }} />}
          <div className="z-10 w-full mb-5 flex items-center justify-center gap-2 text-xs text-gray-500 font-mono">
            <HardDrive className="w-4 h-4" />
            <span>{runtime ? `${runtime.platform}-${runtime.arch}` : 'Detecting runtime…'}</span>
          </div>

          {isProcessing ? (
            <div className="w-full z-10 flex flex-col items-center max-w-md">
              <div className="w-full h-1.5 bg-black/50 rounded-full mb-2 overflow-hidden">
                <motion.div className="bg-blue-500 h-1.5 rounded-full" animate={{ width: `${Math.max(0, Math.min(100, progress))}%` }} transition={{ duration: 0.5 }} />
              </div>
              <span className="text-[11px] font-mono text-blue-400 mb-7">{Math.round(progress)}% Complete</span>
              <button onClick={stopProcessing} className="flex items-center justify-center px-6 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl border border-white/5 text-xs w-full max-w-xs">
                <Square className="w-3.5 h-3.5 mr-2" /> Abort Processing
              </button>
            </div>
          ) : (
            <div className="w-full max-w-md z-10">
              <button onClick={startProcessing} disabled={!canStart} className={cn('flex items-center justify-center w-full py-4 rounded-xl text-xs font-medium shadow-lg transition-all', canStart ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-blue-900/30' : 'bg-white/5 text-gray-600 cursor-not-allowed border border-white/5')}>
                <Play className="w-4 h-4 mr-2 fill-current" /> Start Reconstruction Workflow
              </button>
              {inputCount === 0 && <p className="text-[10px] text-red-400/80 mt-3">Add a video or at least two overlapping images first.</p>}
              {runtime && !runtime.ready && (
                <p className="text-[10px] text-red-400/90 mt-3 bg-red-400/10 p-2 rounded-lg border border-red-400/20">
                  Runtime incomplete. Missing tools: {missingTools.join(', ') || 'none'}{runtime.missingPythonDependencies.length ? `; Python packages: ${runtime.missingPythonDependencies.join(', ')}` : ''}.
                </p>
              )}
              {statusError && <p className="text-[10px] text-red-400 mt-3">{statusError}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
