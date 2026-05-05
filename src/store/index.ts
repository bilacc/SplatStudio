import { create } from 'zustand';

export type ViewType = 'data' | 'processing' | 'viewer' | 'export' | 'batch' | 'settings' | 'docs';

interface LogEntry {
  id: string;
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
  
  // Processing
  hardwareBackend: 'CUDA' | 'AMD' | 'CPU';
  setHardwareBackend: (backend: 'CUDA' | 'AMD' | 'CPU') => void;
  isProcessing: boolean;
  progress: number;
  startProcessing: () => void;
  stopProcessing: () => void;
  
  // Terminal Logs
  logs: LogEntry[];
  addLog: (message: string, type?: LogEntry['type']) => void;
  clearLogs: () => void;
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
  
  isProcessing: false,
  progress: 0,
  
  startProcessing: () => {
    set({ isProcessing: true, progress: 0 });
    get().addLog('Starting Gaussian Splat reconstruction pipeline...', 'info');
    get().addLog(`Initialized using ${get().hardwareBackend} backend runner.`, 'info');
    
    // Simulate processing
    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress += Math.random() * 5;
      if (currentProgress < 20) {
        get().addLog(`Extracting features (COLMAP) - ${currentProgress.toFixed(1)}%`, 'info');
      } else if (currentProgress < 50) {
        get().addLog(`Matching features - ${currentProgress.toFixed(1)}%`, 'info');
      } else if (currentProgress < 80) {
        get().addLog(`Training NeRF / Gaussian Splatter - Step ${Math.floor(currentProgress * 300)}/30000`, 'info');
      } else if (currentProgress >= 100) {
        clearInterval(interval);
        set({ isProcessing: false, progress: 100 });
        get().addLog('Processing complete. View the result in the 3D Viewer.', 'success');
        get().setCurrentView('viewer');
      } else {
        set({ progress: Math.min(currentProgress, 100) });
      }
    }, 800);
  },
  stopProcessing: () => {
    set({ isProcessing: false, progress: 0 });
    get().addLog('Processing aborted by user.', 'warn');
  },
  
  logs: [
    { id: 'start', timestamp: Date.now(), message: 'SplatStudio initializing...', type: 'info' }
  ],
  addLog: (message, type = 'info') => set((state) => ({
    logs: [...state.logs, { id: Math.random().toString(36).substr(2, 9), timestamp: Date.now(), message, type }]
  })),
  clearLogs: () => set({ logs: [] }),
}));
