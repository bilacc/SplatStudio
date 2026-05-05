import React from 'react';
import { Shield, Keyboard, Database, Plug } from 'lucide-react';

export function SettingsView() {
  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="mb-6 shrink-0">
        <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Application Settings</h1>
        <p className="text-[13px] text-gray-400">Configure globals, hotkeys, and plugins.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-2">
        {/* Generics */}
        <div className="bg-[#1A1D23] rounded-2xl p-5 border border-white/5">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center">
             <Database className="w-3.5 h-3.5 mr-2" /> Project & Cache
          </h3>
          <div className="space-y-5">
            <div className="space-y-1">
              <label className="text-[10px] text-gray-400">Default Project Directory</label>
              <div className="flex gap-2">
                <input type="text" readOnly defaultValue=".../Documents/SplatStudio" className="flex-1 bg-black/30 border border-white/5 rounded-lg p-2 text-xs text-gray-400 focus:outline-none focus:border-white/20" />
                <button className="px-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs transition-colors text-white">Browse</button>
              </div>
            </div>
            <div className="space-y-3 pt-2">
              <label className="flex items-center cursor-pointer text-xs text-gray-300 bg-white/5 p-3 rounded-xl hover:bg-white/10 transition-colors border border-transparent hover:border-white/5">
                <input type="checkbox" defaultChecked className="accent-blue-500 rounded bg-[#222] border-[#333] mr-3" />
                Enable project version control (Git LFS)
              </label>
              <label className="flex items-center cursor-pointer text-xs text-gray-300 bg-white/5 p-3 rounded-xl hover:bg-white/10 transition-colors border border-transparent hover:border-white/5">
                <input type="checkbox" defaultChecked className="accent-blue-500 rounded bg-[#222] border-[#333] mr-3" />
                Auto-clear frame cache on export
              </label>
            </div>
          </div>
        </div>

        {/* Hotkeys */}
        <div className="bg-[#1A1D23] rounded-2xl p-5 border border-white/5">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center">
             <Keyboard className="w-3.5 h-3.5 mr-2" /> Hotkeys
          </h3>
          <div className="space-y-2">
             {[
               { action: 'Start Reconstruction', key: 'Ctrl + R' },
               { action: 'Abort Processing', key: 'Ctrl + C' },
               { action: 'Toggle Wireframe', key: 'Alt + W' },
               { action: 'Export Scene', key: 'Ctrl + E' },
             ].map((hk, i) => (
                <div key={i} className="flex justify-between items-center py-2 px-3 bg-white/5 rounded-xl border border-transparent">
                  <span className="text-xs text-gray-300 font-medium">{hk.action}</span>
                  <button className="px-2 py-1 text-[10px] font-mono bg-black/30 border border-white/10 rounded text-gray-400 hover:text-white hover:border-white/20 transition-colors">
                    {hk.key}
                  </button>
                </div>
             ))}
          </div>
        </div>

        {/* Plugins */}
        <div className="md:col-span-2 bg-[#1A1D23] rounded-2xl p-5 border border-white/5 opacity-70 mt-2">
          <div className="flex justify-between items-center mb-6">
             <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center">
               <Plug className="w-3.5 h-3.5 mr-2" /> Plugin Ecosystem
             </h3>
             <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2.5 py-0.5 rounded-full border border-purple-500/20 font-bold tracking-wider uppercase">Coming Soon</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex justify-between items-center bg-black/20 p-4 rounded-xl border border-white/5">
               <div>
                 <p className="text-xs font-semibold text-gray-300">Blender Live Link</p>
                 <p className="text-[10px] text-gray-500 mt-1">Stream geometry directly via sockets.</p>
               </div>
               <button disabled className="px-4 py-2 text-[10px] font-medium bg-white/5 border border-white/5 text-gray-500 rounded-lg">Install</button>
            </div>
             <div className="flex justify-between items-center bg-black/20 p-4 rounded-xl border border-white/5">
               <div>
                 <p className="text-xs font-semibold text-gray-300">Unreal Engine 5</p>
                 <p className="text-[10px] text-gray-500 mt-1">Native .uasset generation for Nanite.</p>
               </div>
               <button disabled className="px-4 py-2 text-[10px] font-medium bg-white/5 border border-white/5 text-gray-500 rounded-lg">Install</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
