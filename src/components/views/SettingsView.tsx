import React from 'react';
import { CheckCircle2, Database, FolderOpen, RefreshCw, Settings2, TriangleAlert, Wrench } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store';
import { APP_VERSION } from '../../version';

export function SettingsView() {
  const { runtimeInfo, runtimeLoading, refreshRuntimeInfo } = useAppStore();

  const openExportsFolder = async () => {
    await window.splatStudio?.openExportsFolder?.();
  };

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="flex items-end justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Application Settings</h1>
          <p className="text-[13px] text-gray-400">Inspect the active workspace and reconstruction runtime.</p>
        </div>
        <button
          onClick={() => refreshRuntimeInfo()}
          disabled={runtimeLoading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] text-gray-300 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', runtimeLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-2">
        <div className="bg-[#1A1D23] rounded-2xl p-5 border border-white/5">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center">
            <Database className="w-3.5 h-3.5 mr-2" /> Workspace
          </h3>
          <div className="space-y-4">
            <div>
              <p className="text-[10px] text-gray-500 mb-1">Runtime data directory</p>
              <div className="p-3 rounded-lg bg-black/30 border border-white/5 text-[10px] text-gray-300 font-mono break-all min-h-10">
                {runtimeInfo?.workspaceRoot || 'Loading workspace path...'}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 mb-1">Bundled tools directory</p>
              <div className="p-3 rounded-lg bg-black/30 border border-white/5 text-[10px] text-gray-300 font-mono break-all min-h-10">
                {runtimeInfo?.binDir || 'Loading tools path...'}
              </div>
            </div>
            {window.splatStudio?.openExportsFolder && (
              <button
                onClick={openExportsFolder}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-medium text-white"
              >
                <FolderOpen className="w-4 h-4" />
                Open exports folder
              </button>
            )}
          </div>
        </div>

        <div className="bg-[#1A1D23] rounded-2xl p-5 border border-white/5">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center">
            <Wrench className="w-3.5 h-3.5 mr-2" /> Runtime Components
          </h3>
          <div className="space-y-2">
            {runtimeInfo ? Object.entries(runtimeInfo.tools).map(([key, tool]) => (
              <div key={key} className="flex items-center gap-3 p-3 rounded-xl bg-black/20 border border-white/5">
                {tool.available
                  ? <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                  : <TriangleAlert className="w-4 h-4 text-yellow-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-300">{tool.label}</p>
                  <p className="text-[9px] text-gray-600 font-mono mt-1 truncate" title={tool.path || undefined}>
                    {tool.available
                      ? `${tool.source}: ${tool.path}`
                      : tool.missingModules?.length
                        ? `Missing: ${tool.missingModules.join(', ')}`
                        : 'Not found in bin/ or system PATH'}
                  </p>
                </div>
              </div>
            )) : (
              <p className="text-xs text-gray-500">Checking runtime components...</p>
            )}
          </div>
        </div>

        <div className="md:col-span-2 bg-[#1A1D23] rounded-2xl p-5 border border-white/5">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center">
            <Settings2 className="w-3.5 h-3.5 mr-2" /> Application
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 bg-black/20 rounded-xl border border-white/5">
              <p className="text-[10px] text-gray-500 uppercase">Version</p>
              <p className="text-sm text-gray-200 mt-2">v{APP_VERSION}</p>
            </div>
            <div className="p-4 bg-black/20 rounded-xl border border-white/5">
              <p className="text-[10px] text-gray-500 uppercase">Image pipeline</p>
              <p className={cn('text-sm mt-2', runtimeInfo?.readyForImages ? 'text-green-400' : 'text-yellow-500')}>
                {runtimeInfo?.readyForImages ? 'Ready' : 'Setup required'}
              </p>
            </div>
            <div className="p-4 bg-black/20 rounded-xl border border-white/5">
              <p className="text-[10px] text-gray-500 uppercase">Video pipeline</p>
              <p className={cn('text-sm mt-2', runtimeInfo?.readyForVideo ? 'text-green-400' : 'text-yellow-500')}>
                {runtimeInfo?.readyForVideo ? 'Ready' : 'Setup required'}
              </p>
            </div>
          </div>
          <p className="text-[10px] text-gray-600 mt-4 leading-relaxed">
            SplatStudio first uses tools bundled in <span className="font-mono">bin/</span>, then falls back to compatible tools installed on the system PATH.
            Standalone installers require all bundled runtime files to pass <span className="font-mono">npm run verify:runtime</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
