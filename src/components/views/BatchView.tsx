import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Download, Layers, Play, RefreshCw, Square } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store';

interface JobFile {
  name: string;
  size: number;
  downloadUrl: string;
}

interface JobEntry {
  id: string;
  createdAt: string;
  modifiedAt: string;
  status: 'running' | 'draft' | 'complete' | 'failed';
  progress: number;
  files: JobFile[];
}

const statusStyles: Record<JobEntry['status'], string> = {
  running: 'text-blue-400',
  complete: 'text-green-400',
  draft: 'text-yellow-500',
  failed: 'text-red-400',
};

export function BatchView() {
  const { isProcessing, stopProcessing, setCurrentView } = useAppStore();
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/jobs');
      const data = await response.json();
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshJobs();
    if (!isProcessing) return;
    const interval = setInterval(refreshJobs, 2000);
    return () => clearInterval(interval);
  }, [isProcessing, refreshJobs]);

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="flex justify-between items-end mb-6 shrink-0">
        <div>
          <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Reconstruction Jobs</h1>
          <p className="text-[13px] text-gray-400">Review persisted jobs and download their generated files.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refreshJobs}
            disabled={loading}
            className="p-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg border border-white/10 disabled:opacity-50"
            title="Refresh jobs"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
          <button
            onClick={() => setCurrentView('data')}
            className="flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium"
          >
            <Play className="w-3.5 h-3.5 mr-2" />
            New Job
          </button>
        </div>
      </div>

      <div className="bg-[#1A1D23] rounded-2xl p-5 border border-white/5 flex flex-col space-y-3 flex-1 overflow-y-auto">
        {jobs.length > 0 ? jobs.map((job) => (
          <div key={job.id} className="p-4 rounded-xl border bg-black/20 border-white/5">
            <div className="flex items-center gap-4">
              <div className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center border',
                job.status === 'running' && 'bg-blue-500/10 text-blue-400 border-blue-500/20',
                job.status === 'complete' && 'bg-green-500/10 text-green-400 border-green-500/20',
                job.status === 'draft' && 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
                job.status === 'failed' && 'bg-red-500/10 text-red-400 border-red-500/20',
              )}>
                {job.status === 'running' && <Clock className="w-4 h-4" />}
                {job.status === 'complete' && <CheckCircle2 className="w-4 h-4" />}
                {(job.status === 'draft' || job.status === 'failed') && <AlertTriangle className="w-4 h-4" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center gap-3">
                  <span className="font-medium text-xs text-gray-200 truncate">{job.id}</span>
                  <span className={cn('font-mono text-[10px] uppercase', statusStyles[job.status])}>{job.status}</span>
                </div>
                <p className="text-[10px] text-gray-600 mt-1">{new Date(job.modifiedAt).toLocaleString()}</p>
                <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden mt-3">
                  <div
                    className={cn('h-full rounded-full', job.status === 'failed' ? 'bg-red-500' : job.status === 'draft' ? 'bg-yellow-500' : 'bg-blue-500')}
                    style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
                  />
                </div>
              </div>

              {job.status === 'running' && isProcessing && (
                <button
                  onClick={stopProcessing}
                  className="text-gray-500 hover:text-white p-2 rounded-lg hover:bg-white/5"
                  title="Stop active job"
                >
                  <Square className="w-4 h-4" />
                </button>
              )}
            </div>

            {job.files.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4 ml-14">
                {job.files.map((file) => (
                  <a
                    key={file.name}
                    href={file.downloadUrl}
                    download={file.name}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-[10px] text-gray-300"
                  >
                    <Download className="w-3 h-3" />
                    {file.name}
                  </a>
                ))}
              </div>
            )}
          </div>
        )) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center border border-dashed border-white/10 rounded-xl bg-black/10">
            <Layers className="w-8 h-8 text-gray-600 mb-3" />
            <p className="text-xs text-gray-400">No reconstruction jobs have been created.</p>
            <button onClick={() => setCurrentView('data')} className="mt-4 text-[10px] text-blue-400 hover:text-blue-300">Add source images</button>
          </div>
        )}
      </div>
    </div>
  );
}
