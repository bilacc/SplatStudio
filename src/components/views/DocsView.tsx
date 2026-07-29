import React from 'react';
import { Book, CheckCircle2, Command, ExternalLink, Wrench } from 'lucide-react';

export function DocsView() {
  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col text-gray-300">
      <div className="mb-6 shrink-0">
        <h1 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Documentation</h1>
        <p className="text-[13px] text-gray-400">A practical guide to the local SplatStudio workflow.</p>
      </div>

      <div className="space-y-4 overflow-y-auto pr-2 pb-8">
        <section className="bg-[#1A1D23] rounded-2xl p-6 border border-white/5">
          <h3 className="text-white text-sm font-semibold flex items-center mb-4">
            <Book className="w-4 h-4 mr-2 text-blue-400" /> First reconstruction
          </h3>
          <ol className="space-y-3 text-xs text-gray-400">
            {[
              'Open Workspace and add one video, at least two images, or a folder of frames.',
              'Open Reconstruction and confirm that the runtime status is ready.',
              'Choose feature quality, scene preset, frame rate, resolution, and training iterations.',
              'Start reconstruction and follow FFmpeg, COLMAP, and gsplat progress in Console Logs.',
              'Inspect output in 3D Viewer, then download .splat or .ply from Export.',
            ].map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0 font-mono text-[10px]">{index + 1}</span>
                <span className="leading-5">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="bg-[#1A1D23] rounded-2xl p-6 border border-white/5">
          <h3 className="text-white text-sm font-semibold flex items-center mb-4">
            <Wrench className="w-4 h-4 mr-2 text-emerald-400" /> Runtime requirements
          </h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              ['FFmpeg', 'Required when the input is a video.'],
              ['COLMAP', 'Required for feature matching and camera reconstruction.'],
              ['Python + PyTorch', 'Runs the trainer and detects the CUDA GPU.'],
              ['gsplat trainer', 'Creates trained or COLMAP-initialized draft splats.'],
            ].map(([name, description]) => (
              <div key={name} className="p-4 bg-black/20 rounded-xl border border-white/5">
                <p className="text-xs text-gray-200 flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />{name}</p>
                <p className="text-[10px] text-gray-500 mt-2 leading-4">{description}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-4">
            Tools bundled in <span className="font-mono text-gray-400">bin/</span> take priority. Development builds also discover compatible tools on the system PATH.
          </p>
        </section>

        <section className="bg-[#1A1D23] rounded-2xl p-6 border border-white/5">
          <h3 className="text-white text-sm font-semibold flex items-center mb-4">
            <Command className="w-4 h-4 mr-2 text-yellow-500" /> Capture guidance
          </h3>
          <ul className="space-y-2 text-xs text-gray-400">
            <li>• Move steadily around the subject with strong overlap between neighboring frames.</li>
            <li>• Avoid motion blur, changing exposure, reflective surfaces, and independently moving objects.</li>
            <li>• Use the Object preset for turntables, Indoor for rooms, and Sequential for forward-moving captures.</li>
            <li>• Start at half resolution and 7,000 iterations, then increase quality once the capture reconstructs reliably.</li>
          </ul>
        </section>

        <section className="bg-[#1A1D23] rounded-2xl p-6 border border-white/5">
          <h3 className="text-white text-sm font-semibold mb-4">Authoritative references</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { name: 'COLMAP documentation', url: 'https://colmap.github.io/' },
              { name: 'gsplat documentation', url: 'https://docs.gsplat.studio/' },
              { name: 'GaussianSplats3D viewer', url: 'https://github.com/mkkellogg/GaussianSplats3D' },
              { name: 'SplatStudio repository', url: 'https://github.com/bilacc/SplatStudio' },
            ].map((link) => (
              <a key={link.name} href={link.url} target="_blank" rel="noreferrer" className="flex items-center justify-between p-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-transparent hover:border-blue-500/20">
                <span className="text-xs font-medium text-gray-300">{link.name}</span>
                <ExternalLink className="w-3.5 h-3.5 text-gray-500" />
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
