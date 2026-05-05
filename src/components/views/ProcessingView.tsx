import React from 'react';
import { useAppStore } from '../../store';
import { HardDrive, Play, Square } from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion } from 'framer-motion';

export function ProcessingView() {
  const { hardwareBackend, setHardwareBackend, isProcessing, progress, startProcessing, stopProcessing, files } = useAppStore();

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="mb-6 shrink-0">
        <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Reconstruction Pipeline</h1>
        <p className="text-[13px] text-gray-400">Configure Structure from Motion (COLMAP) and Gaussian Splat parameters.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
        
        {/* Hardware Control */}
        <div className="lg:col-span-12 xl:col-span-6 bg-[#1A1D23] rounded-2xl p-5 border border-white/5">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Hardware Engine</h3>
          <div className="space-y-3">
            {(['CUDA', 'AMD', 'CPU'] as const).map((backend) => {
              const isActive = hardwareBackend === backend;
              const details = backend === 'CUDA' ? 'CUDA Arch 8.9 | VRAM: 24GB' : backend === 'AMD' ? 'ROCm Fallback | VRAM: 16GB' : 'Fallback Mode';
              const name = backend === 'CUDA' ? 'NVIDIA RTX 4090' : backend === 'AMD' ? 'AMD Radeon VII' : 'CPU Processing';
              
              return (
                <div
                  key={backend}
                  onClick={() => !isProcessing && setHardwareBackend(backend)}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-xl transition-all cursor-pointer",
                    isActive 
                      ? "bg-white/5 border border-blue-500/50 shadow-sm" 
                      : "bg-black/30 border border-transparent hover:border-white/10",
                    isProcessing && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div>
                    <div className={cn("text-sm font-semibold", isActive ? "text-white" : "text-gray-400")}>{name}</div>
                    <div className="text-[10px] text-gray-500">{details}</div>
                  </div>
                  <div className={cn("w-4 h-4 rounded-full flex items-center justify-center transition-all", isActive ? "border-2 border-blue-500" : "border border-white/10")}>
                    {isActive && <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>}
                  </div>
                </div>
              );
            })}
          </div>
          {hardwareBackend === 'CPU' && (
            <p className="mt-4 text-[10px] text-yellow-500/80 bg-yellow-500/10 p-2 text-center rounded-lg border border-yellow-500/20">
              Warning: CPU processing is extremely slow.
            </p>
          )}
        </div>

        {/* Advanced Parameters */}
        <div className="lg:col-span-12 xl:col-span-6 bg-[#1A1D23] rounded-2xl p-5 border border-white/5">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Advanced Parameters</h3>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500">Feature Extraction Quality</label>
              <select disabled={isProcessing} className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500 disabled:opacity-50">
                <option>High (Default)</option>
                <option>Medium</option>
                <option>Low (Faster)</option>
                <option>Ultra (Highest Precision)</option>
              </select>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <label className="text-[10px] text-gray-500">Max Iterations</label>
                <input type="number" disabled={isProcessing} defaultValue={30000} className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500 disabled:opacity-50" />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-[10px] text-gray-500">Resolution Spec</label>
                <select disabled={isProcessing} className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500 disabled:opacity-50">
                  <option>1.0 (Full)</option>
                  <option>0.5 (Half)</option>
                  <option>0.25 (Quarter)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="lg:col-span-12 bg-[#1A1D23] rounded-2xl p-8 border border-white/5 flex flex-col items-center justify-center text-center relative overflow-hidden group">
          {isProcessing && (
            <motion.div 
              className="absolute inset-0 bg-blue-500/5 z-0"
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          )}

          <div className="z-10 w-full mb-6 opacity-60 flex items-center justify-center gap-2 text-xs text-gray-500 font-mono">
            <HardDrive className="w-4 h-4" />
            <span>...SplatStudio/Projects/Untitled</span>
          </div>

          {isProcessing ? (
            <div className="w-full z-10 flex flex-col items-center max-w-md mx-auto">
              <div className="w-full h-1.5 bg-black/50 rounded-full mb-2 overflow-hidden shadow-inner">
                <motion.div 
                  className="bg-blue-500 h-1.5 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]" 
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
              <span className="text-[11px] font-mono text-blue-400 mb-8">{Math.round(progress)}% Complete</span>
              <button 
                onClick={stopProcessing}
                className="flex items-center justify-center px-6 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl transition-colors border border-white/5 text-xs font-medium w-full max-w-xs"
              >
                <Square className="w-3.5 h-3.5 mr-2" />
                Abort Processing
              </button>
            </div>
          ) : (
            <div className="w-full max-w-sm mx-auto z-10">
              <button 
                onClick={startProcessing}
                disabled={files.length === 0}
                className={cn(
                  "flex items-center justify-center w-full py-4 rounded-xl transition-all text-xs font-medium shadow-lg",
                  files.length > 0 
                    ? "bg-blue-600 text-white hover:bg-blue-500 shadow-blue-900/30 hover:scale-[1.02]" 
                    : "bg-white/5 text-gray-600 cursor-not-allowed border border-white/5"
                )}
              >
                <Play className="w-4 h-4 mr-2 fill-current" />
                Start Reconstruction Workflow
              </button>
              {files.length === 0 && (
                <p className="text-[10px] text-red-400/80 mt-4 bg-red-400/10 py-1.5 rounded-lg border border-red-400/20">Requires input data in Workspace.</p>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
