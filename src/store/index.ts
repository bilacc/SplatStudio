import { create } from 'zustand';

export type ViewType = 'data' | 'processing' | 'viewer' | 'export' | 'batch' | 'settings' | 'docs';

export interface LogEntry {
  id?: string;
  timestamp: number;
  message: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

interface AppState {
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  
  // Data Prep
  files: File[];
  addFiles: (newFiles: File[]) => void;
  removeFile: (index: number) => void;
  clearFiles: () => void;
  
  // Pipeline settings
  engine: string;
  setEngine: (engine: string) => void;
  extractFps: number;
  setExtractFps: (fps: number) => void;

  // Processing
  hardwareBackend: string;
  setHardwareBackend: (backend: string) => void;
  customGPUs: { id: string; name: string; details: string; type: string }[];
  addCustomGPU: (gpu: { id: string; name: string; details: string; type: string }) => void;
  
  isProcessing: boolean;
  progress: number;
  startProcessing: () => Promise<void>;
  stopProcessing: () => Promise<void>;
  
  // Terminal Logs
  logs: LogEntry[];
  clearLogs: () => void;

  pollStatus: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  currentView: 'data',
  setCurrentView: (view) => set({ currentView: view }),
  
  files: [],
  addFiles: (newFiles) => set((state) => ({ files: [...state.files, ...newFiles] })),
  removeFile: (index) => set((state) => ({ files: state.files.filter((_, i) => i !== index) })),
  clearFiles: () => set({ files: [] }),
  
  hardwareBackend: 'CUDA',
  setHardwareBackend: (hardwareBackend) => set({ hardwareBackend }),
  
  engine: 'nerfstudio',
  setEngine: (engine) => set({ engine }),
  
  extractFps: 2,
  setExtractFps: (extractFps) => set({ extractFps }),

  customGPUs: [],
  addCustomGPU: (gpu) => set((state) => ({ customGPUs: [...state.customGPUs, gpu] })),

  isProcessing: false,
  progress: 0,
  logs: [
    { id: 'start', timestamp: Date.now(), message: 'SplatStudio initializing...', type: 'info' }
  ],
  
  startProcessing: async () => {
    try {
      const formData = new FormData();
      get().files.forEach(file => {
        formData.append('files', file);
      });
      
      // Upload files first if not empty
      if (get().files.length > 0) {
        await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
      }

      await fetch('/api/pipeline/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backend: get().hardwareBackend,
          filesCount: get().files.length,
          engine: get().engine,
          extractFps: get().extractFps
        })
      });
      set({ isProcessing: true, progress: 0 });
    } catch (err) {
      console.error(err);
    }
  },

  stopProcessing: async () => {
    try {
      await fetch('/api/pipeline/abort', { method: 'POST' });
      set({ isProcessing: false });
    } catch (err) {
      console.error(err);
    }
  },

  clearLogs: () => set({ logs: [] }),

  pollStatus: async () => {
    // We poll the backend to get current state and logs.
    try {
      const res = await fetch('/api/pipeline/status');
      const data = await res.json();
      
      const newLogs = data.logs.map((l: any, i: number) => ({ ...l, id: `${l.timestamp}-${i}` }));
      
      set((state) => {
        // Only update logs if length differs to keep it simple, or merge if needed. 
        // For simulation, we'll just concat the new logs that haven't been added if we tracked index, 
        // but simpler: replace logs completely from the server to maintain exact state, except initial boot messages.
        // Actually it's easier to just append new logs based on length:
        const mergedLogs = [...state.logs.filter(l => l.id === 'start')]; // Keep start log
        mergedLogs.push(...newLogs);
        
        // Auto-navigate to viewer on completion
        if (state.isProcessing && data.progress >= 100 && !data.isRunning) {
          setTimeout(() => get().setCurrentView('viewer'), 1500);
        }

        return {
          isProcessing: data.isRunning,
          progress: data.progress,
          logs: mergedLogs
        };
      });
    } catch (err) {
      // Failed to poll
    }
  }
}));
