import React from 'react';
import { Box, Download, Layers } from 'lucide-react';
import { useAppStore } from '../../store';

export function ExportView() {
  const { hasOutput, outputKind } = useAppStore();

  const download = (fileName: 'output.splat' | 'splat.ply') => {
    window.location.href = `/api/export/${fileName}`;
  };

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="mb-6 shrink-0">
        <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Export Asset</h1>
        <p className="text-[13px] text-gray-400">Download the exact artifacts produced by the latest reconstruction.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#1A1D23] rounded-2xl p-6 border border-white/5 flex flex-col">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-5">
            <Layers className="w-5 h-5 text-blue-400" />
          </div>
          <h2 className="text-sm font-semibold text-white">Web Splat</h2>
          <p className="text-xs text-gray-500 mt-2 mb-6">32-byte-per-Gaussian binary compatible with the built-in viewer and common web splat viewers.</p>
          <button disabled={!hasOutput} onClick={() => download('output.splat')} className="mt-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-white/5 disabled:text-gray-600 py-3 rounded-xl text-xs font-medium text-white transition-colors">
            <Download className="w-3.5 h-3.5" /> Download output.splat
          </button>
        </div>

        <div className="bg-[#1A1D23] rounded-2xl p-6 border border-white/5 flex flex-col">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-5">
            <Box className="w-5 h-5 text-purple-400" />
          </div>
          <h2 className="text-sm font-semibold text-white">Gaussian PLY</h2>
          <p className="text-xs text-gray-500 mt-2 mb-6">Standard 3D Gaussian PLY containing position, SH color, opacity, logarithmic scale, and rotation fields.</p>
          <button disabled={!hasOutput} onClick={() => download('splat.ply')} className="mt-auto flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:bg-white/5 disabled:text-gray-600 py-3 rounded-xl text-xs font-medium text-white transition-colors">
            <Download className="w-3.5 h-3.5" /> Download splat.ply
          </button>
        </div>
      </div>

      <div className="mt-4 bg-[#1A1D23] rounded-2xl p-5 border border-white/5 text-xs text-gray-400">
        {hasOutput
          ? `Output available${outputKind ? ` · ${outputKind === 'draft' ? 'COLMAP-initialized draft' : 'trained model'}` : ''}.`
          : 'No export is available yet. Complete a reconstruction first.'}
      </div>
    </div>
  );
}
