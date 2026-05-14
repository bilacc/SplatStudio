import React, { useRef } from 'react';
import { FolderOpen, UploadCloud, Image as ImageIcon, Video as VideoIcon, X } from 'lucide-react';
import { useAppStore } from '../../store';

export function DataPrepView() {
  const { files, localInputs, addFiles, addLocalInputs, removeFile, removeLocalInput, clearFiles } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputCount = files.length + localInputs.length;

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

  const handleNativeSelect = async (mode: 'files' | 'folder') => {
    if (!window.splatStudio) {
      fileInputRef.current?.click();
      return;
    }

    const selected = await window.splatStudio.selectInputs(mode);
    if (selected.length > 0) {
      addLocalInputs(selected);
    }
  };

  const localTypeIcon = (input: { kind: 'file' | 'folder'; name: string }) => {
    if (input.kind === 'folder') return <FolderOpen className="w-4 h-4 text-emerald-400" />;
    return input.name.match(/\.(mp4|mov|avi|mkv|m4v|webm)$/i)
      ? <VideoIcon className="w-4 h-4 text-purple-400" />
      : <ImageIcon className="w-4 h-4 text-blue-400" />;
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
        onClick={() => handleNativeSelect('files')}
      >
        <div className="w-16 h-16 bg-blue-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform border border-blue-500/20">
          <UploadCloud className="w-8 h-8 text-blue-500" />
        </div>
        <h3 className="text-sm font-semibold text-white mb-2">Drag & Drop files here</h3>
        <p className="text-[11px] text-gray-500 max-w-sm text-center">
          Support for MP4, MOV, JPG, PNG. Extracted frames will be cached in the project directory.
        </p>
        <div className="flex flex-wrap justify-center gap-3 mt-6">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleNativeSelect('files'); }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-medium text-white transition-colors"
          >
            Add Files
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleNativeSelect('folder'); }}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium text-gray-200 transition-colors flex items-center gap-2"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Add Folder
          </button>
        </div>
        <input 
          type="file" 
          multiple 
          accept="video/*,image/*" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          className="hidden" 
        />
      </div>

      {inputCount > 0 && (
        <div className="mt-6 shrink-0 bg-[#1A1D23] rounded-2xl p-5 border border-white/5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Imported Inputs ({inputCount})</h3>
            <button 
              onClick={clearFiles}
              className="text-[10px] text-blue-400 hover:underline"
            >
              Clear All
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[30vh] overflow-y-auto pr-2">
            {files.map((file, idx) => (
              <div key={`file-${idx}`} className="bg-white/5 border border-white/5 rounded-xl p-3 flex items-center shadow-sm">
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
            {localInputs.map((input, idx) => (
              <div key={`local-${input.path}`} className="bg-white/5 border border-white/5 rounded-xl p-3 flex items-center shadow-sm">
                <div className="bg-black/30 p-2 rounded-lg mr-3">
                  {localTypeIcon(input)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-200 truncate">{input.name}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5 truncate">
                    {input.kind === 'folder'
                      ? 'Folder'
                      : input.size
                        ? `${(input.size / (1024 * 1024)).toFixed(2)} MB`
                        : 'Local file'}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeLocalInput(idx); }}
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
