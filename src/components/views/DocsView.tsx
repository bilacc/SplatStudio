import React from 'react';
import { Book, Code, Command, ExternalLink } from 'lucide-react';

export function DocsView() {
  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col text-gray-300">
      <div className="mb-6 shrink-0">
        <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Documentation</h1>
        <p className="text-[13px] text-gray-400">Everything you need to know about using SplatStudio.</p>
      </div>

      <div className="space-y-4 overflow-y-auto pr-2 pb-8">
        <div className="bg-[#1A1D23] rounded-2xl p-6 border border-white/5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-bl-full -mr-16 -mt-16 transition-transform group-hover:scale-110"></div>
          <h3 className="text-white text-sm font-semibold flex items-center mb-4 relative z-10">
            <Book className="w-4 h-4 mr-2 text-blue-400" /> Getting Started
          </h3>
          <p className="mb-4 text-xs leading-relaxed text-gray-400 relative z-10">
            SplatStudio works by extracting frames from your video sequence (or using individual images), computing structure from motion (SfM) via COLMAP to determine camera poses, and finally training a Gaussian splat model.
          </p>
          <ol className="list-decimal pl-4 space-y-2 text-xs text-gray-400 relative z-10">
            <li>Go to the <strong className="text-gray-200 font-medium tracking-wide">Workspace</strong> tab and drop your footage.</li>
            <li>Switch to the <strong className="text-gray-200 font-medium tracking-wide">Reconstruction</strong> tab and select your GPU backend.</li>
            <li>Click "Start Reconstruction". Wait for processing to complete.</li>
            <li>Use the <strong className="text-gray-200 font-medium tracking-wide">3D Viewer</strong> to inspect the result in real-time.</li>
            <li>Export via the <strong className="text-gray-200 font-medium tracking-wide">Export</strong> tab (.PLY, .OBJ, .GLTF).</li>
          </ol>
        </div>

        <div className="bg-[#1A1D23] rounded-2xl p-6 border border-white/5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-bl-full -mr-16 -mt-16 transition-transform group-hover:scale-110"></div>
          <h3 className="text-white text-sm font-semibold flex items-center mb-4 relative z-10">
            <Command className="w-4 h-4 mr-2 text-emerald-400" /> Hardware Guidelines
          </h3>
          <ul className="list-disc pl-4 space-y-3 text-xs text-gray-400 relative z-10">
            <li><span className="text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded">CUDA (Nvidia)</span> Utilizes native PyTorch bounds. Fastest, most stable.</li>
            <li><span className="text-blue-400 font-mono bg-blue-500/10 px-1.5 py-0.5 rounded">AMD (ROCm)</span> Requires HIP implementation wrappers. Compatible with RDNA2.</li>
            <li><span className="text-yellow-500 font-mono bg-yellow-500/10 px-1.5 py-0.5 rounded">CPU Processing</span> Universal fallback. Intended strictly for debugging.</li>
          </ul>
        </div>

        <div className="bg-[#1A1D23] rounded-2xl p-6 border border-white/5 relative overflow-hidden group">
           <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-bl-full -mr-16 -mt-16 transition-transform group-hover:scale-110"></div>
          <h3 className="text-white text-sm font-semibold flex items-center mb-4 relative z-10">
            <Code className="w-4 h-4 mr-2 text-purple-400" /> External References
          </h3>
          <div className="grid sm:grid-cols-2 gap-3 relative z-10">
            {[
              { name: "NeRF Studio Docs", url: "https://docs.nerf.studio/" },
              { name: "COLMAP Guidelines", url: "https://colmap.github.io/" },
              { name: "PlayCanvas SuperSplat", url: "https://github.com/playcanvas/supersplat" },
              { name: "OpenSplat (C++)", url: "https://github.com/pierotofy/OpenSplat" },
              { name: "MrNeRF LichtFeld Studio", url: "https://github.com/MrNeRF/LichtFeld-Studio" },
              { name: "GauStudio Framework", url: "https://github.com/GAP-LAB-CUHK-SZ/gaustudio" },
            ].map(link => (
              <a key={link.name} href={link.url} target="_blank" rel="noreferrer" className="flex items-center justify-between p-3.5 rounded-xl bg-white/5 border border-transparent hover:border-purple-500/30 transition-all group/link hover:bg-white/10">
                <span className="text-xs font-medium text-gray-300">{link.name}</span>
                <ExternalLink className="w-3.5 h-3.5 text-gray-500 group-hover/link:text-purple-400 transition-colors" />
              </a>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
