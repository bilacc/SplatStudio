import React from 'react';
import { Download, Box, Layers, Settings2 } from 'lucide-react';
import { useAppStore } from '../../store';

export function ExportView() {
  const { progress } = useAppStore();
  const hasFinished = progress === 100;

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="mb-6 shrink-0">
        <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Export Asset</h1>
        <p className="text-[13px] text-gray-400">Save optimized meshes and splats to your local workstation.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
        {/* Export Configuration - Left */}
        <div className="bg-[#1A1D23] rounded-2xl p-5 border border-white/5 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Export Settings</h3>
            <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-mono">High Fidelity</span>
          </div>
          
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500">Format</label>
              <select className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500">
                <option>GLTF Binary (.glb)</option>
                <option>Wavefront (.obj)</option>
                <option>Stanford (.ply)</option>
                <option>Web Splat (.splat)</option>
                <option>Kapture Format (Multi-view)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500">Compression (GSCodec)</label>
              <select className="w-full bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-purple-400 focus:outline-none focus:border-purple-500 font-medium">
                <option>None (Raw Splat)</option>
                <option>Light (2x smaller)</option>
                <option>High (10x+ via GSCodec)</option>
              </select>
            </div>
          </div>

          <div className="space-y-3 mb-8">
             <label className="flex items-center cursor-pointer p-3 bg-black/20 rounded-xl border border-transparent hover:border-white/5 transition-colors">
               <input type="checkbox" defaultChecked className="accent-blue-500 rounded bg-[#222] border-[#333] mr-3" />
               <span className="text-xs text-gray-300">Preserve UV Borders</span>
             </label>
             <label className="flex items-center cursor-pointer p-3 bg-black/20 rounded-xl border border-transparent hover:border-white/5 transition-colors">
               <input type="checkbox" defaultChecked className="accent-blue-500 rounded bg-[#222] border-[#333] mr-3" />
               <span className="text-xs text-gray-300 flex-1">Optimize texture atlases for GLTF</span>
             </label>
             <p className="text-[10px] text-gray-500 italic px-2">Powered by gsbox / 3dgsconverter formats.</p>
          </div>

          <div className="flex gap-3 mt-auto">
            <button disabled={!hasFinished} className="flex-1 bg-white/5 hover:bg-white/10 border border-white/5 py-3 rounded-xl text-xs font-medium transition-all text-gray-300 hover:text-white disabled:opacity-50">Optimize Mesh</button>
            <button disabled={!hasFinished} className="flex-1 bg-blue-600 hover:bg-blue-500 py-3 rounded-xl text-xs font-medium shadow-lg shadow-blue-900/30 text-white disabled:opacity-50 flex items-center justify-center gap-1.5 transition-all">
              <Download className="w-3.5 h-3.5" />
              Export Now
            </button>
          </div>
        </div>

        {/* Adjustments - Right */}
        <div className="bg-[#1A1D23] rounded-2xl p-5 border border-white/5 flex flex-col">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-6">Transforms & Scale</h3>
          <div className="space-y-6 flex-1">
             <div className="space-y-1">
              <label className="text-[10px] text-gray-500 block">Scale Multiplier</label>
              <div className="flex gap-2">
                 <input type="number" defaultValue={1.0} step={0.1} className="flex-1 bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500" />
                 <select className="w-36 bg-black/30 border border-white/5 rounded-lg p-3 text-xs text-gray-300 focus:outline-none focus:border-blue-500">
                    <option>Meters</option>
                    <option>Centimeters</option>
                    <option>Millimeters</option>
                  </select>
              </div>
            </div>
            
            <div className="space-y-2">
               <div className="flex justify-between items-center bg-black/20 p-4 rounded-xl border border-transparent">
                 <span className="text-xs text-gray-300">Vertex Colors (PLY/GLB)</span>
                 <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded font-mono">Enabled</span>
               </div>
               <div className="flex justify-between items-center bg-black/20 p-4 rounded-xl border border-transparent">
                 <span className="text-xs text-gray-300">Normal Maps Generation</span>
                 <span className="text-[10px] bg-gray-500/20 text-gray-400 px-2 py-0.5 rounded font-mono">Disabled</span>
               </div>
            </div>
          </div>
          {!hasFinished && (
            <p className="text-[10px] text-center text-red-400/80 mt-4 bg-red-400/10 py-2 rounded-lg border border-red-400/20">Reconstruction must be complete before exporting.</p>
          )}
        </div>
      </div>
    </div>
  );
}
