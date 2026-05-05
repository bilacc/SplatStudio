import React from 'react';
import { Layers, Plus, Play, Pause, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export function BatchView() {
  const mockJobs = [
    { id: 1, name: 'garden_vortex.mp4', status: 'processing', progress: 68 },
    { id: 2, name: 'museum_interior_4k', status: 'queued', progress: 0 },
    { id: 3, name: 'statue_scan_01', status: 'completed', progress: 100 },
  ];

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="flex justify-between items-end mb-6 shrink-0">
        <div>
          <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Batch Operations</h1>
          <p className="text-[13px] text-gray-400">Process multiple reconstructions sequentially overnight.</p>
        </div>
        <button className="flex items-center px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg border border-white/10 transition-colors text-xs font-medium shadow-sm">
          <Plus className="w-3.5 h-3.5 mr-2" />
          Add Job
        </button>
      </div>

      <div className="bg-[#1A1D23] rounded-2xl p-5 border border-white/5 flex flex-col space-y-3 flex-1 overflow-y-auto">
         {mockJobs.map((job, idx) => (
           <div key={job.id} className={cn(
             "flex items-center gap-4 p-3 rounded-xl border transition-all",
             job.status === 'processing' ? "bg-black/20 border-white/5" :
             job.status === 'completed' ? "bg-white/5 border-transparent" :
             "bg-black/10 border-dashed border-white/5 opacity-70"
           )}>
             <div className={cn(
               "w-10 h-10 rounded-lg flex items-center justify-center font-mono text-xs shadow-inner",
               job.status === 'processing' ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" :
               job.status === 'completed' ? "bg-green-500/10 text-green-400 border border-green-500/20" :
               "bg-white/5 text-gray-500 border border-transparent"
             )}>
                {String(idx + 1).padStart(2, '0')}
             </div>
             <div className="flex-1">
               <div className="flex justify-between text-xs mb-1">
                 <span className={cn("font-medium", job.status === 'queued' ? "text-gray-500 italic" : "text-gray-200")}>
                   {job.status === 'queued' ? `Pending: ${job.name}...` : job.name}
                 </span>
                 {job.status === 'processing' && <span className="text-blue-400 font-mono">{job.progress}%</span>}
                 {job.status === 'completed' && <span className="text-green-400 font-mono text-[10px] tracking-wider uppercase">Done</span>}
               </div>
               {job.status === 'processing' && (
                 <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden">
                   <div className="h-full bg-blue-500 rounded-full" style={{ width: `${job.progress}%` }}></div>
                 </div>
               )}
             </div>
             
             {job.status !== 'completed' && (
               <button className="text-gray-500 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors">
                 <Trash2 className="w-4 h-4" />
               </button>
             )}
           </div>
         ))}
      </div>
    </div>
  );
}
