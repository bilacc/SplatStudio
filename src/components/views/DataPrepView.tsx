import React, { useRef } from 'react';
import { UploadCloud, Image as ImageIcon, Video as VideoIcon, X } from 'lucide-react';
import { useAppStore } from '../../store';

export function DataPrepView() {
  const { files, addFiles, removeFile, clearFiles } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(Array.from(e.target.files));
    }
  };

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="mb-6 shrink-0">
        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Data Preparation</h3>
        <p className="text-[13px] text-gray-400">Import images or videos to extract frames for Gaussian Splatting.</p>
      </div>

      <div 
        className="flex-1 min-h-[250px] border border-dashed border-white/10 rounded-2xl bg-white/5 hover:border-blue-500/50 hover:bg-white/10 transition-all flex flex-col items-center justify-center p-12 cursor-pointer group"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="w-16 h-16 bg-blue-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform border border-blue-500/20">
          <UploadCloud className="w-8 h-8 text-blue-500" />
        </div>
        <h3 className="text-sm font-semibold text-white mb-2">Drag & Drop files here</h3>
        <p className="text-[11px] text-gray-500 max-w-sm text-center">
          Support for MP4, MOV, JPG, PNG. Extracted frames will be cached in the project directory.
        </p>
        <input 
          type="file" 
          multiple 
          accept="video/*,image/*" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          className="hidden" 
        />
      </div>

      {files.length > 0 && (
        <div className="mt-6 shrink-0 bg-[#1A1D23] rounded-2xl p-5 border border-white/5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Imported Files ({files.length})</h3>
            <button 
              onClick={clearFiles}
              className="text-[10px] text-blue-400 hover:underline"
            >
              Clear All
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[30vh] overflow-y-auto pr-2">
            {files.map((file, idx) => (
              <div key={idx} className="bg-white/5 border border-white/5 rounded-xl p-3 flex items-center shadow-sm">
                <div className="bg-black/30 p-2 rounded-lg mr-3">
                  {file.type.startsWith('video/') ? (
                    <VideoIcon className="w-4 h-4 text-purple-400" />
                  ) : (
                    <ImageIcon className="w-4 h-4 text-blue-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-200 truncate">{file.name}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                  className="p-1.5 text-gray-500 hover:bg-white/10 hover:text-white rounded-lg transition-colors ml-2"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
