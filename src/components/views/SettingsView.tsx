import React, { useEffect, useState } from 'react';
import { Database, RefreshCw, Shield } from 'lucide-react';

interface RuntimeInfo {
  platform: string;
  arch: string;
  workspaceRoot: string;
  binDir: string;
  ready: boolean;
  videoReady: boolean;
  offlineReady: boolean;
  missingPythonDependencies: string[];
  tools: Record<string, { available: boolean; path: string | null; source: string }>;
}

export function SettingsView() {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRuntime = async () => {
    setError(null);
    try {
      const response = await fetch('/api/runtime-info');
      if (!response.ok) throw new Error(`Runtime request failed (${response.status}).`);
      setRuntime(await response.json());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Runtime request failed.');
    }
  };

  useEffect(() => {
    loadRuntime();
  }, []);

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="mb-6 shrink-0 flex justify-between items-end gap-4">
        <div>
          <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Application Settings</h1>
          <p className="text-[13px] text-gray-400">Inspect the effective workspace and runtime configuration.</p>
        </div>
        <button onClick={loadRuntime} className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 text-[10px] text-gray-300">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-2">
        <div className="bg-[#1A1D23] rounded-2xl p-5 border border-white/5">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center">
            <Database className="w-3.5 h-3.5 mr-2" /> Workspace
          </h3>
          <dl className="space-y-4 text-xs">
            <div><dt className="text-gray-500 mb-1">Project data</dt><dd className="text-gray-300 font-mono break-all">{runtime?.workspaceRoot || 'Detecting…'}</dd></div>
            <div><dt className="text-gray-500 mb-1">Bundled runtime root</dt><dd className="text-gray-300 font-mono break-all">{runtime?.binDir || 'Detecting…'}</dd></div>
            <div><dt className="text-gray-500 mb-1">Application architecture</dt><dd className="text-gray-300 font-mono">{runtime ? `${runtime.platform}-${runtime.arch}` : 'Detecting…'}</dd></div>
          </dl>
        </div>

        <div className="bg-[#1A1D23] rounded-2xl p-5 border border-white/5">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center">
            <Shield className="w-3.5 h-3.5 mr-2" /> Runtime Health
          </h3>
          <div className="space-y-2">
            {runtime && Object.entries<RuntimeInfo['tools'][string]>(runtime.tools).map(([name, tool]) => (
              <div key={name} className="bg-black/20 rounded-lg p-3 flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-xs text-gray-300 capitalize">{name}</p><p className="text-[9px] text-gray-600 font-mono truncate" title={tool.path || ''}>{tool.path || 'Not found'}</p></div>
                <span className={`text-[9px] uppercase font-mono ${tool.available ? 'text-green-400' : 'text-red-400'}`}>{tool.available ? tool.source : 'missing'}</span>
              </div>
            ))}
          </div>
          {runtime?.missingPythonDependencies.length ? <p className="mt-3 text-[10px] text-red-400">Missing Python packages: {runtime.missingPythonDependencies.join(', ')}</p> : null}
          {runtime && <p className={`mt-3 text-[10px] ${runtime.ready ? 'text-green-400' : 'text-yellow-500'}`}>{runtime.offlineReady ? 'Complete offline reconstruction runtime is ready; no separate installation is required.' : runtime.ready ? 'Image-sequence reconstruction is ready.' : 'Runtime setup is incomplete.'}{runtime.ready && !runtime.videoReady ? ' Video input is unavailable.' : ''}</p>}
          {error && <p className="mt-3 text-[10px] text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
