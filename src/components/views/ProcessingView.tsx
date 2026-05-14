import React, { useState } from 'react';
import { useAppStore } from '../../store';
import { HardDrive, Play, Square, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion } from 'framer-motion';

export function ProcessingView() {
  const { hardwareBackend, setHardwareBackend, isProcessing, progress, startProcessing, stopProcessing, files, customGPUs, addCustomGPU } = useAppStore();

  const [showAddGPU, setShowAddGPU] = useState(false);
  const [newGPUName, setNewGPUName] = useState('');
  const [newGPUDevice, setNewGPUDevice] = useState('CUDA');

  const defaultBackends = [
    { id: 'CUDA', name: 'NVIDIA RTX 4090', details: 'CUDA Arch 8.9 | VRAM: 24GB', type: 'CUDA' },
    { id: 'AMD', name: 'AMD Radeon VII', details: 'ROCm Fallback | VRAM: 16GB', type: 'AMD' }
  ];

  const allBackends = [...defaultBackends, ...customGPUs];

  const handleAddGPU = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGPUName.trim()) return;
    const isOld = newGPUName.toLowerCase().includes('1070') || newGPUName.toLowerCase().includes('1060') || newGPUName.toLowerCase().includes('1080');
    let details = `${newGPUDevice} Compatible`;
    if (isOld) details += ' | Legacy Arch (Slower)';
    
    addCustomGPU({
      id: newGPUName.replace(/\s+/g, '-').toUpperCase() + '-' + Date.now(),
      name: newGPUName,
      details,
      type: newGPUDevice
    });
    setNewGPUName('');
    setShowAddGPU(false);
  };

  const isLegacyWarning = () => {
    const selected = allBackends.find(b => b.id === hardwareBackend);
    if (!selected) return false;
    return selected.details.includes('Legacy Arch') || selected.type !== 'CUDA';
  }

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="mb-6 shrink-0">
        <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Reconstruction Pipeline</h1>
        <p className="text-[13px] text-gray-400">Configure Structure from Motion (COLMAP) and Gaussian Splat parameters.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 overflow-y-auto pr-2 pb-8">
        
        {/* Hardware Control */}
        <div className="lg:col-span-12 xl:col-span-6 bg-[#1A1D23] rounded-2xl p-5 border border-white/5 flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Hardware Engine</h3>
            <button 
              onClick={() => setShowAddGPU(!showAddGPU)}
              className="px-2 py-1 bg-white/5 hover:bg-white/10 text-gray-400 rounded transition-colors text-[10px] flex items-center"
            >
              <Plus className="w-3 h-3 mr-1" /> Add Custom
            </button>
          </div>

          {showAddGPU && (
            <form onSubmit={handleAddGPU} className="mb-4 bg-black/30 p-3 rounded-xl border border-white/5 flex flex-col gap-2">
              <label className="text-[10px] text-gray-500 uppercase tracking-widest">Register GPU Node</label>
              <input 
                type="text" 
                placeholder="e.g. GTX 1070, RTX 3080" 
                value={newGPUName}
                onChange={(e) => setNewGPUName(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500 placeholder:text-gray-600"
              />
              <div className="flex gap-2">
                <select 
                  value={newGPUDevice}
                  onChange={(e) => setNewGPUDevice(e.target.value)}
                  className="flex-1 bg-black/50 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none"
                >
                  <option value="CUDA">CUDA</option>
                  <option value="AMD">AMD ROCm</option>
                </select>
                <button type="submit" className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-white text-xs whitespace-nowrap">Add</button>
              </div>
            </form>
          )}

          <div className="space-y-3 flex-1 overflow-y-auto">
            {allBackends.map((backend) => {
              const isActive = hardwareBackend === backend.id;
              
              return (
                <div
                  key={backend.id}
                  onClick={() => !isProcessing && setHardwareBackend(backend.id)}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-xl transition-all cursor-pointer",
                    isActive 
                      ? "bg-white/5 border border-blue-500/50 shadow-sm" 
                      : "bg-black/30 border border-transparent hover:border-white/10",
                    isProcessing && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div>
                    <div className={cn("text-sm font-semibold", isActive ? "text-white" : "text-gray-400")}>{backend.name}</div>
                    <div className="text-[10px] text-gray-500">{backend.details}</div>
                  </div>
                  <div className={cn("w-4 h-4 rounded-full flex items-center justify-center transition-all", isActive ? "border-2 border-blue-500" : "border border-white/10")}>
                    {isActive && <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>}
                  </div>
                </div>
              );
            })}
          </div>
          {isLegacyWarning() && (
            <div className="mt-4 text-[10px] text-yellow-500/80 bg-yellow-500/10 p-2 text-left rounded-lg border border-yellow-500/20">
              <strong className="block mb-1 text-yellow-500">Hardware Limitations Detected</strong>
              Non-Tensor Core / Legacy or CPU GPUs lack hardware-accelerated precision optimizations. Training time will substantially increase, and full-resolution PyTorch bounds may exceed VRAM limitations causing out-of-memory errors on models like GTX 1070 or integrated graphics.
            </div>
          )}
        </div>

        {/* Advanced Parameters */}
        <div className="lg:col-span-12 xl:col-span-6 bg-[#1A1D23] rounded-2xl p-5 border border-white/5 flex flex-col">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Pipeline Configuration</h3>
          <div className="space-y-4 flex-1">
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <label className="text-[10px] text-gray-500">Training Engine</label>
                <select 
                  disabled={isProcessing} 
                  value={useAppStore(s => s.engine)}
                  onChange={(e) => useAppStore.getState().setEngine(e.target.value)}
                  className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-blue-400 font-medium focus:outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="nerfstudio">NeRF Studio (Default)</option>
                  <option value="opensplat">OpenSplat (C++)</option>
                  <option value="gaustudio">GauStudio</option>
                  <option value="pointrix">Pointrix</option>
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-[10px] text-gray-500">Video Extraction (FPS)</label>
                <div className="flex bg-black/30 border border-white/5 rounded-lg overflow-hidden">
                  <input 
                    type="number" 
                    min={1} max={30}
                    disabled={isProcessing} 
                    value={useAppStore(s => s.extractFps)}
                    onChange={(e) => useAppStore.getState().setExtractFps(Number(e.target.value))}
                    className="w-full bg-transparent p-3 text-xs text-gray-300 focus:outline-none focus:bg-black/50 disabled:opacity-50" 
                  />
                  <span className="flex items-center px-3 text-xs text-gray-600 bg-black/50 border-l border-white/5">fps</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <label className="text-[10px] text-gray-500">Feature Extraction Quality</label>
                <select disabled={isProcessing} className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500 disabled:opacity-50">
                  <option>High (Default)</option>
                  <option>Medium</option>
                  <option>Low (Faster)</option>
                  <option>Ultra (Highest Precision)</option>
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-[10px] text-gray-500">Scene Optimization</label>
                <select disabled={isProcessing} className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-blue-400 font-medium focus:outline-none focus:border-blue-500 disabled:opacity-50">
                  <option>Standard / Object</option>
                  <option>Indoor / Room</option>
                  <option>Driving / City (DriveStudio)</option>
                </select>
              </div>
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
