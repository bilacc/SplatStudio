import { create } from 'zustand';

export type ViewType = 'data' | 'processing' | 'viewer' | 'export' | 'batch' | 'settings' | 'docs';

export interface LogEntry {
  id?: string;
  timestamp: number;
  message: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

export interface LocalInput {
  path: string;
  name: string;
  kind: 'file' | 'folder';
  size?: number;
}

interface AppState {
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  
  // Data Prep
  files: File[];
  localInputs: LocalInput[];
  addFiles: (newFiles: File[]) => void;
  addLocalInputs: (newInputs: LocalInput[]) => void;
  removeFile: (index: number) => void;
  removeLocalInput: (index: number) => void;
  clearFiles: () => void;
  
  // Pipeline settings
  engine: string;
  setEngine: (engine: string) => void;
  extractFps: number;
  setExtractFps: (fps: number) => void;
  maxIterations: number;
  setMaxIterations: (iterations: number) => void;
  resolution: number;
  setResolution: (resolution: number) => void;

  // Processing
  hardwareBackend: string;
  setHardwareBackend: (backend: string) => void;
  customGPUs: { id: string; name: string; details: string; type: string }[];
  addCustomGPU: (gpu: { id: string; name: string; details: string; type: string }) => void;
  
  isProcessing: boolean;
  progress: number;
  currentJobId: string | null;
  outputKind: string | null;
  startProcessing: () => Promise<void>;
  stopProcessing: () => Promise<void>;
  
  // Terminal Logs
  logs: LogEntry[];
  clearLogs: () => void;

  pollStatus: () => Promise<void>;
}

const makeLocalLog = (message: string, type: LogEntry['type'] = 'error'): LogEntry => ({
  id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  timestamp: Date.now(),
  message,
  type
});

export const useAppStore = create<AppState>((set, get) => ({
  currentView: 'data',
  setCurrentView: (view) => set({ currentView: view }),
  
  files: [],
  localInputs: [],
  addFiles: (newFiles) => set((state) => ({ files: [...state.files, ...newFiles] })),
  addLocalInputs: (newInputs) => set((state) => {
    const existing = new Set(state.localInputs.map(input => input.path));
    const unique = newInputs.filter(input => input.path && !existing.has(input.path));
    return { localInputs: [...state.localInputs, ...unique] };
  }),
  removeFile: (index) => set((state) => ({ files: state.files.filter((_, i) => i !== index) })),
  removeLocalInput: (index) => set((state) => ({ localInputs: state.localInputs.filter((_, i) => i !== index) })),
  clearFiles: () => set({ files: [], localInputs: [] }),
  
  hardwareBackend: 'CUDA',
  setHardwareBackend: (hardwareBackend) => set({ hardwareBackend }),
  
  engine: 'gsplat',
  setEngine: (engine) => set({ engine }),
  
  extractFps: 2,
  setExtractFps: (extractFps) => set({ extractFps }),

  maxIterations: 7000,
  setMaxIterations: (maxIterations) => set({ maxIterations: Math.max(1, Math.round(maxIterations || 1)) }),

  resolution: 0.5,
  setResolution: (resolution) => set({ resolution }),

  customGPUs: [],
  addCustomGPU: (gpu) => set((state) => ({ customGPUs: [...state.customGPUs, gpu] })),

  isProcessing: false,
  progress: 0,
  currentJobId: null,
  outputKind: null,
  logs: [
    { id: 'start', timestamp: Date.now(), message: 'SplatStudio initializing...', type: 'info' }
  ],
  
  startProcessing: async () => {
    try {
      let uploadId: string | undefined;

      const formData = new FormData();
      get().files.forEach(file => {
        formData.append('files', file);
      });
      
      // Upload files first if not empty
      if (get().files.length > 0) {
        const uploadResponse = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        if (!uploadResponse.ok) {
          throw new Error('Input upload failed.');
        }
        const uploadData = await uploadResponse.json();
        uploadId = uploadData.uploadId;
      }

      const startResponse = await fetch('/api/pipeline/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          inputs: get().localInputs,
          backend: get().hardwareBackend,
          filesCount: get().files.length + get().localInputs.length,
          engine: get().engine,
          extractFps: get().extractFps,
          maxIterations: get().maxIterations,
          resolution: get().resolution
        })
      });

      if (!startResponse.ok) {
        const errorData = await startResponse.json().catch(() => ({}));
        throw new Error(errorData.error || 'Pipeline failed to start.');
      }

      set({ isProcessing: true, progress: 0 });
    } catch (err) {
      console.error(err);
      set((state) => ({
        logs: [
          ...state.logs,
          makeLocalLog(err instanceof Error ? err.message : 'Pipeline failed to start.')
        ]
      }));
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
          currentJobId: data.currentJobId || null,
          outputKind: data.outputKind || null,
          logs: mergedLogs
        };
      });
    } catch (err) {
      // Failed to poll
    }
  }
}));
