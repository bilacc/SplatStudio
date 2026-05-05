import React, { Suspense, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Box as BoxMesh, Environment, Grid, Splat } from '@react-three/drei';
import { useAppStore } from '../../store';
import { Box as BoxIcon, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';

export function Viewer3DView() {
  const { progress, logs } = useAppStore();
  const [wireframe, setWireframe] = useState(false);
  const [lighting, setLighting] = useState(true);
  const [splatUrl, setSplatUrl] = useState<string | null>(null);

  const hasFinished = progress === 100 && !logs.some(l => l.message.includes('Pipeline Error') && l.timestamp > Date.now() - 30000);

  useEffect(() => {
    if (hasFinished) {
      // Check if real splat exists
      fetch('/api/output.splat', { method: 'HEAD' })
        .then(r => {
          if (r.ok) {
            setSplatUrl('/api/output.splat');
          } else {
            setSplatUrl('SIMULATION');
          }
        })
        .catch(() => setSplatUrl('SIMULATION'));
    }
  }, [hasFinished]);

  return (
    <div className="flex flex-col h-full relative">
      {/* Viewport Toolbar */}
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-[11px] flex gap-4 shadow-lg shadow-black/20">
          <span><strong className="text-blue-400 font-medium">SPLAT:</strong> {hasFinished ? (splatUrl === 'SIMULATION' ? 'Simulated' : 'Native') : '0'}</span>
          <span><strong className="text-blue-400 font-medium">FPS:</strong> 60.0</span>
        </div>
        <div className="bg-black/60 backdrop-blur-md px-1.5 py-1.5 rounded-lg border border-white/10 flex gap-1 items-center shadow-lg shadow-black/20">
          <button 
            onClick={() => setWireframe(!wireframe)}
            className={cn("px-2 py-0.5 rounded transition-colors text-[11px] font-medium hover:bg-white/10", wireframe ? "text-blue-400 bg-white/5" : "text-gray-400 hover:text-white")}
            title="Wireframe Mode"
          >
            Wireframe
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

      {splatUrl === 'SIMULATION' && hasFinished && (
        <div className="absolute top-4 right-4 z-10 bg-yellow-500/10 backdrop-blur-md px-3 py-2 rounded-lg border border-yellow-500/20 text-[11px] flex items-center text-yellow-500 shadow-lg shadow-black/20 max-w-xs">
          <AlertTriangle className="w-4 h-4 mr-2 shrink-0" />
          Native NeRF Studio unavailable. Displaying simulation visualizer. Run locally to process actual meshes.
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
            {hasFinished && splatUrl && splatUrl !== 'SIMULATION' ? (
              <Splat src={splatUrl} position={[0, 0, 0]} rotation={[0, 0, 0]} alphaTest={0.1} />
            ) : hasFinished ? (
              <mesh>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color="#3b82f6" wireframe={wireframe} />
              </mesh>
            ) : (
              <BoxMesh args={[1, 1, 1]}>
                <meshStandardMaterial color="#333" wireframe={true} opacity={0.2} transparent />
              </BoxMesh>
            )}
            <OrbitControls makeDefault />
          </Suspense>
        </Canvas>

        {!hasFinished && (
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

        {hasFinished && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex bg-black/40 backdrop-blur-xl p-1 rounded-full border border-white/10 z-20 shadow-lg shadow-black/20">
            <button className="px-5 py-2 hover:bg-white/10 rounded-full text-xs text-gray-300 transition-colors">Translate</button>
            <button className="px-5 py-2 bg-blue-600 rounded-full text-xs text-white font-medium shadow-md shadow-blue-900/30 transition-colors">Rotate</button>
            <button className="px-5 py-2 hover:bg-white/10 rounded-full text-xs text-gray-300 transition-colors">Scale</button>
          </div>
        )}
      </div>
    </div>
  );
}
