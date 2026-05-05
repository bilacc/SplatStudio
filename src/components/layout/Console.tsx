import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../store';
import { Terminal } from 'lucide-react';
import { cn } from '../../lib/utils';

export function Console() {
  const { logs, clearLogs } = useAppStore();
  const consoleEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="h-44 bg-[#1A1D23] rounded-2xl p-5 border border-white/5 font-mono text-xs flex flex-col shadow-lg shrink-0">
      <div className="flex justify-between items-center mb-3 shrink-0">
        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center">
          <Terminal className="w-3 h-3 mr-2" />
          Console Logs
        </h3>
        <button 
          onClick={clearLogs}
          className="text-[10px] text-blue-400 hover:underline"
          title="Clear console"
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-1.5 text-[11px] text-gray-400 pr-2">
        {logs.map((log) => (
          <div key={log.id} className="flex">
            <span className="text-gray-600 mr-3 shrink-0">
              [{new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}]
            </span>
            <span className={cn(
              "break-words",
              log.type === 'error' ? "text-red-400" :
              log.type === 'warn' ? "text-yellow-500" :
              log.type === 'success' ? "text-green-500" :
              "text-blue-400"
            )}>
              {log.message}
            </span>
          </div>
        ))}
        <div ref={consoleEndRef} />
      </div>
    </div>
  );
}
