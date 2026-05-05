import React from 'react';
import { Sidebar } from './Sidebar';
import { Console } from './Console';
import { useAppStore } from '../../store';

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { currentView } = useAppStore();
  return (
    <div className="flex h-screen bg-[#0F1115] text-gray-200 overflow-hidden font-sans p-4 gap-4">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 gap-4 relative">
        <main className={`flex-1 overflow-y-auto bg-[#16181D] rounded-2xl border border-white/5 relative group shadow-lg ${currentView === 'viewer' ? '' : 'p-6'}`}>
          {children}
        </main>
        <Console />
      </div>
    </div>
  );
}
