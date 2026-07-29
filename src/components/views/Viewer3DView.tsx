import React, { Suspense, useState, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Box as BoxMesh, Environment, Grid, TransformControls, Bounds } from '@react-three/drei';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { useAppStore } from '../../store';
import { Box as BoxIcon, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import * as THREE from 'three';

function MKKSplat({ url }: { url: string }) {
  const [viewer, setViewer] = useState<GaussianSplats3D.DropInViewer | null>(null);

  useEffect(() => {
    if (!url) return;
    
    const v = new GaussianSplats3D.DropInViewer({
      sharedMemoryForWorkers: false,
      ignoreDevicePixelRatio: false,
      gpuArchitecturePreference: 'high-performance'
    });
    
    let isMounted = true;
    
    v.addSplatScene(url, {
      showLoadingUI: false
    }).then(() => {
      if (isMounted) setViewer(v);
    }).catch(console.error);

    return () => {
      isMounted = false;
      try {
         v.dispose();
      } catch (e) {}
      setViewer(null);
    };
  }, [url]);

  useFrame(({ gl, camera }) => {
    if (viewer && viewer.viewer) {
      try {
        viewer.viewer.update(gl, camera);
      } catch(e) {}
    }
  });

  return viewer ? <primitive object={viewer} /> : null;
}

export function Viewer3DView() {
  const { progress, logs } = useAppStore();
  const [lighting, setLighting] = useState(true);
  const [splatUrl, setSplatUrl] = useState<string | null>(null);
  const [modelType, setModelType] = useState<'none' | 'native' | 'custom'>('none');
  const [modelName, setModelName] = useState<string>('');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [target, setTarget] = useState<THREE.Group | null>(null);

  const hasFinished = progress === 100 && !logs.some(l => l.message.includes('Pipeline Error') && l.timestamp > Date.now() - 30000);

  useEffect(() => {
    if (hasFinished) {
      // Check if real splat exists
      fetch('/api/output.splat', { method: 'HEAD' })
        .then(r => {
          if (r.ok) {
            setSplatUrl('/api/output.splat');
            setModelType('native');
            setModelName('output.splat');
          } else {
            setSplatUrl(null);
            setModelType('none');
          }
        })
        .catch(() => {
          setSplatUrl(null);
          setModelType('none');
        });
    }
  }, [hasFinished]);

  const handleImportCustom = async () => {
    if (!window.splatStudio?.selectSplatFile) return;
    
    try {
      const filePath = await window.splatStudio.selectSplatFile();
      if (!filePath) return; // Cancelled
      
      setIsImporting(true);
      setImportError(null);
      
      const response = await fetch('/api/custom/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath })
      });
      
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to import custom model.');
      }
      
      // Successfully imported/converted!
      setSplatUrl(null);
      setTimeout(() => {
        setSplatUrl(result.url);
      }, 50);
      setModelType('custom');
      // Get the file name
      const fileName = filePath.split(/[/\\]/).pop() || 'custom.splat';
      setModelName(fileName);
    } catch (err: any) {
      console.error(err);
      setImportError(err.message || 'Import failed.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Viewport Toolbar */}
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-[11px] flex gap-4 shadow-lg shadow-black/20">
          <span><strong className="text-blue-400 font-medium">SPLAT:</strong> {splatUrl ? (modelType === 'custom' ? 'Custom' : 'Native') : 'None'}</span>
          {modelType === 'custom' && (
            <span className="text-gray-400 max-w-[150px] truncate" title={modelName}>
              <strong className="text-blue-400 font-medium">FILE:</strong> {modelName}
            </span>
          )}
        </div>
        <div className="bg-black/60 backdrop-blur-md px-1.5 py-1.5 rounded-lg border border-white/10 flex gap-1 items-center shadow-lg shadow-black/20">
          <button 
            onClick={handleImportCustom}
            disabled={isImporting || !window.splatStudio?.selectSplatFile}
            className="px-2 py-0.5 rounded transition-colors text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-gray-400 hover:text-white"
            title="Import custom .splat or .ply model"
          >
            {isImporting ? 'Importing...' : 'Import Splat/PLY'}
          </button>
          <div className="w-px h-3 bg-white/10 mx-1"></div>
          <button 
            onClick={() => setLighting(!lighting)}
            className={cn("px-2 py-0.5 rounded transition-colors text-[11px] font-medium hover:bg-white/10", lighting ? "text-yellow-400 bg-white/5" : "text-gray-400 hover:text-white")}
            title="Toggle Lighting"
          >
            Lighting
          </button>
        </div>
      </div>

      {!splatUrl && hasFinished && (
        <div className="absolute top-4 right-4 z-10 bg-yellow-500/10 backdrop-blur-md px-3 py-2 rounded-lg border border-yellow-500/20 text-[11px] flex items-center text-yellow-500 shadow-lg shadow-black/20 max-w-xs">
          <AlertTriangle className="w-4 h-4 mr-2 shrink-0" />
          No splat file is available for the latest reconstruction.
        </div>
      )}

      {importError && (
        <div className="absolute top-16 left-4 z-20 bg-red-500/10 backdrop-blur-md p-3 rounded-lg border border-red-500/20 text-[11px] flex flex-col text-red-400 shadow-lg shadow-black/20 max-w-md pointer-events-auto">
          <div className="flex items-center justify-between mb-1.5 font-semibold">
            <div className="flex items-center">
              <AlertTriangle className="w-4 h-4 mr-2 shrink-0 text-red-400" />
              <span>Import Conversion Failed</span>
            </div>
            <button onClick={() => setImportError(null)} className="hover:text-white text-base leading-none font-bold">×</button>
          </div>
          <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono text-[9px] bg-red-950/20 p-2 rounded border border-red-500/10 custom-scrollbar select-text text-left">
            {importError}
          </pre>
        </div>
      )}

      {/* 3D Canvas */}
      <div className="flex-1 w-full relative">
        <Canvas camera={{ position: [2, 2, 2], fov: 45 }}>
          {lighting && <ambientLight intensity={0.5} />}
          {lighting && <directionalLight position={[10, 10, 5]} intensity={1.5} />}
          {lighting && <Environment preset="city" />}
          
          <Grid infiniteGrid fadeDistance={20} sectionColor="#666" cellColor="#222" />

          <Suspense fallback={null}>
            {splatUrl ? (
              <>
                {target && <TransformControls object={target} mode={transformMode} size={0.5} />}
                <group ref={setTarget}>
                  <MKKSplat url={splatUrl} />
                </group>
              </>
            ) : (
              <BoxMesh args={[1, 1, 1]}>
                <meshStandardMaterial color="#333" wireframe={true} opacity={0.2} transparent />
              </BoxMesh>
            )}
            <OrbitControls makeDefault />
          </Suspense>
        </Canvas>

        {isImporting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-30 pointer-events-auto">
            <div className="bg-zinc-900 border border-white/10 px-6 py-4 rounded-xl shadow-2xl flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-medium text-gray-300">Importing and processing custom model...</p>
              <p className="text-[10px] text-gray-500 font-mono">PLY conversion might take a few seconds for large models</p>
            </div>
          </div>
        )}

        {!splatUrl && (
           <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
             <div className="w-full flex justify-center flex-col items-center opacity-40">
                <div className="w-48 h-48 border border-dashed border-blue-500/30 rounded-full flex items-center justify-center">
                   <div className="w-32 h-32 border border-dashed border-blue-500/20 rounded-full flex items-center justify-center">
                       <BoxIcon className="w-8 h-8 text-blue-500/50" />
                   </div>
                </div>
                <p className="mt-4 text-[10px] font-mono tracking-widest text-blue-500/50">NO MODEL LOADED</p>
             </div>
           </div>
        )}

        {splatUrl && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex bg-black/40 backdrop-blur-xl p-1 rounded-full border border-white/10 z-20 shadow-lg shadow-black/20">
            <button 
              onClick={() => setTransformMode('translate')}
              className={cn("px-5 py-2 rounded-full text-xs transition-colors", transformMode === 'translate' ? "bg-blue-600 text-white font-medium shadow-md shadow-blue-900/30" : "hover:bg-white/10 text-gray-300")}
            >
              Translate
            </button>
            <button 
               onClick={() => setTransformMode('rotate')}
               className={cn("px-5 py-2 rounded-full text-xs transition-colors", transformMode === 'rotate' ? "bg-blue-600 text-white font-medium shadow-md shadow-blue-900/30" : "hover:bg-white/10 text-gray-300")}
            >
              Rotate
            </button>
            <button 
               onClick={() => setTransformMode('scale')}
               className={cn("px-5 py-2 rounded-full text-xs transition-colors", transformMode === 'scale' ? "bg-blue-600 text-white font-medium shadow-md shadow-blue-900/30" : "hover:bg-white/10 text-gray-300")}
            >
              Scale
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
