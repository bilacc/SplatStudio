import React, { useCallback, useEffect, useState } from 'react';
import { Box, CheckCircle2, Download, FileBox, FolderOpen, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store';

interface ExportFile {
  name: string;
  size: number;
  modifiedAt: string;
  downloadUrl: string;
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function ExportView() {
  const { currentJobId, outputKind, progress } = useAppStore();
  const [files, setFiles] = useState<ExportFile[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshExports = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/exports');
      const data = await response.json();
      setFiles(Array.isArray(data.files) ? data.files : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshExports();
  }, [currentJobId, progress, refreshExports]);

  const openExportsFolder = async () => {
    await window.splatStudio?.openExportsFolder?.();
  };

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="flex items-end justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Export Assets</h1>
          <p className="text-[13px] text-gray-400">Download the real files produced by the latest reconstruction.</p>
        </div>
        <button
          onClick={refreshExports}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] text-gray-300 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 flex-1">
        <div className="md:col-span-3 bg-[#1A1D23] rounded-2xl p-5 border border-white/5 flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Available Files</h3>
            {outputKind && (
              <span className={`text-[10px] px-2 py-1 rounded font-mono uppercase ${
                outputKind === 'draft' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-green-500/10 text-green-400'
              }`}>
                {outputKind}
              </span>
            )}
          </div>

          {files.length > 0 ? (
            <div className="space-y-3">
              {files.map((file) => (
                <div key={file.name} className="flex items-center gap-4 p-4 rounded-xl bg-black/20 border border-white/5">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                    <FileBox className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-200 truncate">{file.name}</p>
                    <p className="text-[10px] text-gray-500 mt-1">
                      {formatBytes(file.size)} · {new Date(file.modifiedAt).toLocaleString()}
                    </p>
                  </div>
                  <a
                    href={file.downloadUrl}
                    download={file.name}
                    className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-[10px] font-medium text-white"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex-1 min-h-[240px] flex flex-col items-center justify-center text-center border border-dashed border-white/10 rounded-xl bg-black/10">
              <Box className="w-8 h-8 text-gray-600 mb-3" />
              <p className="text-xs text-gray-400">No export files are available yet.</p>
              <p className="text-[10px] text-gray-600 mt-2 max-w-xs">
                Complete a reconstruction, or inspect a previous job from Batch Jobs.
              </p>
            </div>
          )}
        </div>

        <div className="md:col-span-2 bg-[#1A1D23] rounded-2xl p-5 border border-white/5 flex flex-col">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-5">Latest Job</h3>
          <div className="space-y-3">
            <div className="p-4 bg-black/20 rounded-xl border border-white/5">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Job ID</p>
              <p className="text-xs text-gray-300 font-mono mt-2 break-all">{currentJobId || 'No job selected'}</p>
            </div>
            <div className="p-4 bg-black/20 rounded-xl border border-white/5 flex items-center gap-3">
              <CheckCircle2 className={`w-5 h-5 ${files.length > 0 ? 'text-green-400' : 'text-gray-600'}`} />
              <div>
                <p className="text-xs text-gray-300">{files.length > 0 ? 'Ready to export' : 'Awaiting output'}</p>
                <p className="text-[10px] text-gray-500 mt-1">{files.length} generated file{files.length === 1 ? '' : 's'}</p>
              </div>
            </div>
          </div>

          {window.splatStudio?.openExportsFolder && (
            <button
              onClick={openExportsFolder}
              className="mt-auto flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs text-gray-200"
            >
              <FolderOpen className="w-4 h-4" />
              Open exports folder
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
