export {};

declare global {
  interface SplatStudioInputItem {
    path: string;
    name: string;
    kind: 'file' | 'folder';
    size?: number;
  }

  interface Window {
    splatStudio?: {
      selectInputs: (mode: 'files' | 'folder') => Promise<SplatStudioInputItem[]>;
      selectSplatFile: () => Promise<string | null>;
    };
  }
}
