import { create } from 'zustand';

export type ViewType = 'data' | 'processing' | 'viewer' | 'export' | 'batch' | 'settings' | 'docs';
export type FeatureQuality = 'low' | 'medium' | 'high' | 'ultra';
export type ScenePreset = 'object' | 'indoor' | 'city';

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

export interface RuntimeTool {
  label: string;
  available: boolean;
  path: string | null;
  source: 'bundled' | 'system' | null;
  missingModules?: string[];
}

export interface RuntimeInfo {
  workspaceRoot: string;
  binDir: string;
  tools: Record<'ffmpeg' | 'colmap' | 'python' | 'pythonPackages' | 'trainer', RuntimeTool>;
  readyForImages: boolean;
  readyForVideo: boolean;
  missingForImages: string[];
  missingForVideo: string[];
  currentJobId?: string | null;
  outputKind?: string | null;
}

interface AppState {
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;

  files: File[];
  localInputs: LocalInput[];
  addFiles: (newFiles: File[]) => void;
  addLocalInputs: (newInputs: LocalInput[]) => void;
  removeFile: (index: number) => void;
  removeLocalInput: (index: number) => void;
  clearFiles: () => void;

  engine: string;
  extractFps: number;
  setExtractFps: (fps: number) => void;
  maxIterations: number;
  setMaxIterations: (iterations: number) => void;
  resolution: number;
  setResolution: (resolution: number) => void;
  featureQuality: FeatureQuality;
  setFeatureQuality: (quality: FeatureQuality) => void;
  scenePreset: ScenePreset;
  setScenePreset: (preset: ScenePreset) => void;

  hardwareBackend: string;
  runtimeInfo: RuntimeInfo | null;
  runtimeLoading: boolean;
  refreshRuntimeInfo: () => Promise<RuntimeInfo | null>;

  isProcessing: boolean;
  progress: number;
  currentJobId: string | null;
  outputKind: string | null;
  startProcessing: () => Promise<void>;
  stopProcessing: () => Promise<void>;

  logs: LogEntry[];
  clearLogs: () => void;
  pollStatus: () => Promise<void>;
}

const makeLocalLog = (message: string, type: LogEntry['type'] = 'error'): LogEntry => ({
  id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  timestamp: Date.now(),
  message,
  type,
});

const isVideoName = (name: string) => /\.(mp4|mov|avi|mkv|m4v|webm)$/i.test(name);

export const useAppStore = create<AppState>((set, get) => ({
  currentView: 'data',
  setCurrentView: (view) => set({ currentView: view }),

  files: [],
  localInputs: [],
  addFiles: (newFiles) => set((state) => ({ files: [...state.files, ...newFiles] })),
  addLocalInputs: (newInputs) => set((state) => {
    const existing = new Set(state.localInputs.map((input) => input.path));
    const unique = newInputs.filter((input) => input.path && !existing.has(input.path));
    return { localInputs: [...state.localInputs, ...unique] };
  }),
  removeFile: (index) => set((state) => ({ files: state.files.filter((_, i) => i !== index) })),
  removeLocalInput: (index) => set((state) => ({ localInputs: state.localInputs.filter((_, i) => i !== index) })),
  clearFiles: () => set({ files: [], localInputs: [] }),

  hardwareBackend: 'CUDA',
  engine: 'gsplat',
  extractFps: 2,
  setExtractFps: (extractFps) => set({ extractFps: Math.max(0.1, Math.min(60, extractFps || 0.1)) }),
  maxIterations: 7000,
  setMaxIterations: (maxIterations) => set({
    maxIterations: Math.max(1, Math.min(100000, Math.round(maxIterations || 1))),
  }),
  resolution: 0.5,
  setResolution: (resolution) => set({ resolution }),
  featureQuality: 'high',
  setFeatureQuality: (featureQuality) => set({ featureQuality }),
  scenePreset: 'object',
  setScenePreset: (scenePreset) => set({ scenePreset }),

  runtimeInfo: null,
  runtimeLoading: false,
  refreshRuntimeInfo: async () => {
    set({ runtimeLoading: true });
    try {
      const response = await fetch('/api/runtime-info');
      if (!response.ok) throw new Error('Runtime status could not be loaded.');
      const runtimeInfo = await response.json() as RuntimeInfo;
      set({
        runtimeInfo,
        runtimeLoading: false,
        currentJobId: runtimeInfo.currentJobId || get().currentJobId,
        outputKind: runtimeInfo.outputKind || get().outputKind,
      });
      return runtimeInfo;
    } catch {
      set({ runtimeLoading: false });
      return null;
    }
  },

  isProcessing: false,
  progress: 0,
  currentJobId: null,
  outputKind: null,
  logs: [
    { id: 'start', timestamp: Date.now(), message: 'SplatStudio initializing...', type: 'info' },
  ],

  startProcessing: async () => {
    try {
      const state = get();
      const runtime = await state.refreshRuntimeInfo();
      if (!runtime) throw new Error('Runtime status is unavailable. Restart SplatStudio and try again.');

      const needsFfmpeg = state.files.some((file) => file.type.startsWith('video/') || isVideoName(file.name))
        || state.localInputs.some((input) => input.kind === 'file' && isVideoName(input.name));
      const ready = needsFfmpeg ? runtime.readyForVideo : runtime.readyForImages;
      if (!ready) {
        const missingKeys = needsFfmpeg ? runtime.missingForVideo : runtime.missingForImages;
        const missing = missingKeys.map((key) => runtime.tools[key as keyof RuntimeInfo['tools']]?.label || key);
        throw new Error(`Runtime is incomplete. Install or bundle: ${missing.join(', ')}.`);
      }

      let uploadId: string | undefined;
      if (state.files.length > 0) {
        const formData = new FormData();
        state.files.forEach((file) => formData.append('files', file));
        const uploadResponse = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!uploadResponse.ok) throw new Error('Input upload failed.');
        const uploadData = await uploadResponse.json();
        uploadId = uploadData.uploadId;
      }

      const startResponse = await fetch('/api/pipeline/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          inputs: state.localInputs,
          backend: state.hardwareBackend,
          filesCount: state.files.length + state.localInputs.length,
          engine: state.engine,
          extractFps: state.extractFps,
          maxIterations: state.maxIterations,
          resolution: state.resolution,
          featureQuality: state.featureQuality,
          scenePreset: state.scenePreset,
        }),
      });

      if (!startResponse.ok) {
        const errorData = await startResponse.json().catch(() => ({}));
        throw new Error(errorData.error || 'Pipeline failed to start.');
      }

      const startData = await startResponse.json();
      set({
        isProcessing: true,
        progress: 0,
        currentJobId: startData.jobId || null,
        outputKind: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pipeline failed to start.';
      set((state) => ({ logs: [...state.logs, makeLocalLog(message)] }));
    }
  },

  stopProcessing: async () => {
    try {
      await fetch('/api/pipeline/abort', { method: 'POST' });
      set({ isProcessing: false });
    } catch {
      set((state) => ({ logs: [...state.logs, makeLocalLog('Could not stop the active job.')] }));
    }
  },

  clearLogs: () => set({ logs: [] }),

  pollStatus: async () => {
    try {
      const response = await fetch('/api/pipeline/status');
      if (!response.ok) return;
      const data = await response.json();
      const newLogs: LogEntry[] = (data.logs || []).map((log: LogEntry, index: number) => ({
        ...log,
        id: `${log.timestamp}-${index}`,
      }));

      set((state) => {
        const wasProcessing = state.isProcessing;
        if (wasProcessing && data.progress >= 100 && !data.isRunning) {
          setTimeout(() => get().setCurrentView('viewer'), 800);
        }

        return {
          isProcessing: Boolean(data.isRunning),
          progress: Number(data.progress || 0),
          currentJobId: data.currentJobId || null,
          outputKind: data.outputKind || null,
          logs: [...state.logs.filter((log) => log.id === 'start'), ...newLogs],
        };
      });
    } catch {
      // The next polling interval will retry.
    }
  },
}));
