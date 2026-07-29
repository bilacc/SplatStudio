import React from 'react';
import { useAppStore } from '../../store';
import { cn } from '../../lib/utils';
import { Database, Zap, Box, Download, Settings, FileText, Layers } from 'lucide-react';
import { APP_VERSION } from '../../version';

const navItems = [
  { id: 'data', label: 'Workspace', icon: Database },
  { id: 'processing', label: 'Reconstruction', icon: Zap },
  { id: 'viewer', label: '3D Viewer', icon: Box },
  { id: 'export', label: 'Export', icon: Download },
  { id: 'batch', label: 'Batch Jobs', icon: Layers },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'docs', label: 'Docs', icon: FileText },
] as const;

export function Sidebar() {
  const { currentView, setCurrentView, hardwareBackend } = useAppStore();

  return (
    <div className="w-[240px] bg-[#1A1D23] rounded-2xl border border-white/5 flex flex-col h-full select-none shadow-lg transition-all overflow-hidden shrink-0">
      <div className="flex items-center px-5 h-[68px] border-b border-white/5 bg-white/5 shrink-0">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-blue-900/20 mr-3 text-xs shrink-0">GS</div>
        <span className="text-[17px] font-semibold tracking-tight text-white whitespace-nowrap overflow-hidden text-ellipsis">SplatStudio <span className="text-blue-500 font-normal">v{APP_VERSION}</span></span>
      </div>
      <div className="flex-1 py-4 overflow-y-auto px-3">
        <div className="px-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 mt-1">Pipeline</div>
        <nav className="space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id as any)}
              className={cn(
                "w-full flex items-center px-3 py-2.5 text-[13px] transition-all rounded-xl font-medium",
                currentView === item.id 
                  ? "bg-blue-600/10 text-blue-400 border border-blue-500/20 shadow-sm" 
                  : "text-gray-400 hover:bg-white/5 hover:text-gray-200 border border-transparent"
              )}
            >
              <item.icon className="w-4 h-4 mr-3" />
              {item.label}
            </button>
          ))}
        </nav>
      </div>
      
      <div className="p-4 border-t border-white/5 shrink-0">
         <div className={cn("flex items-center justify-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wider mx-auto w-fit mb-3 max-w-full truncate bg-green-500/10 text-green-400 border-green-500/20")}>
          <div className="w-2 h-2 rounded-full min-w-[8px] bg-green-400 animate-pulse"></div>
          <span className="truncate">{hardwareBackend} Active</span>
        </div>
        <div className="text-[10px] text-center text-gray-600">
          Powered by COLMAP & gsplat
        </div>
      </div>
    </div>
  );
}
