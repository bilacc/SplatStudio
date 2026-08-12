import React from 'react';
import { AlertCircle, CheckCircle2, Clock, Layers, Play, Square } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store';

export function BatchView() {
  const { currentJobId, isProcessing, progress, outputKind, hasOutput, logs, stopProcessing, setCurrentView } = useAppStore();
  const hasJob = Boolean(currentJobId);
  const hasFailed = hasJob && !isProcessing && !hasOutput && logs.some((log) => log.type === 'error');

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="flex justify-between items-end mb-6 shrink-0">
        <div>
          <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Batch Operations</h1>
          <p className="text-[13px] text-gray-400">Track local reconstruction jobs from the current workspace.</p>
        </div>
        <button
          onClick={() => setCurrentView('data')}
          className="flex items-center px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg border border-white/10 transition-colors text-xs font-medium shadow-sm"
        >
          <Play className="w-3.5 h-3.5 mr-2" />
          New Job
        </button>
      </div>

      <div className="bg-[#1A1D23] rounded-2xl p-5 border border-white/5 flex flex-col space-y-3 flex-1 overflow-y-auto">
        {hasJob ? (
          <div className={cn(
            "flex items-center gap-4 p-3 rounded-xl border transition-all",
            isProcessing ? "bg-black/20 border-white/5" : "bg-white/5 border-transparent"
          )}>
            <div className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center shadow-inner",
              isProcessing ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : hasFailed ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-green-500/10 text-green-400 border border-green-500/20"
            )}>
              {isProcessing ? <Clock className="w-4 h-4" /> : hasFailed ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between text-xs mb-1 gap-3">
                <span className="font-medium text-gray-200 truncate">{currentJobId}</span>
                <span className={cn(
                  "font-mono text-[10px] tracking-wider uppercase shrink-0",
                  isProcessing ? "text-blue-400" : hasFailed ? "text-red-400" : outputKind === 'draft' ? "text-yellow-500" : "text-green-400"
                )}>
                  {isProcessing ? `${Math.round(progress)}%` : hasFailed ? 'Failed' : outputKind === 'draft' ? 'Draft' : 'Done'}
                </span>
              </div>
              <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full", outputKind === 'draft' && !isProcessing ? "bg-yellow-500" : "bg-blue-500")}
                  style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                />
              </div>
            </div>

            {isProcessing && (
              <button
                onClick={stopProcessing}
                className="text-gray-500 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors"
              >
                <Square className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center border border-dashed border-white/10 rounded-xl bg-black/10">
            <Layers className="w-8 h-8 text-gray-600 mb-3" />
            <p className="text-xs text-gray-400">No reconstruction jobs in this session.</p>
          </div>
        )}
      </div>
    </div>
  );
}
