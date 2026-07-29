/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useEffect } from 'react';
import { MainLayout } from './components/layout/MainLayout';
import { useAppStore } from './store';

import { DataPrepView } from './components/views/DataPrepView';
import { ProcessingView } from './components/views/ProcessingView';
import { ExportView } from './components/views/ExportView';
import { BatchView } from './components/views/BatchView';
import { SettingsView } from './components/views/SettingsView';
import { DocsView } from './components/views/DocsView';

const Viewer3DView = lazy(() => import('./components/views/Viewer3DView').then((module) => ({
  default: module.Viewer3DView,
})));

export default function App() {
  const { currentView, isProcessing, pollStatus, refreshRuntimeInfo } = useAppStore();

  useEffect(() => {
    refreshRuntimeInfo();
    pollStatus();
  }, [pollStatus, refreshRuntimeInfo]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isProcessing) {
      pollStatus(); // Initial poll
      interval = setInterval(pollStatus, 1000);
    }
    return () => clearInterval(interval);
  }, [isProcessing, pollStatus]);

  const renderView = () => {
    switch (currentView) {
      case 'data': return <DataPrepView />;
      case 'processing': return <ProcessingView />;
      case 'viewer': return <Viewer3DView />;
      case 'export': return <ExportView />;
      case 'batch': return <BatchView />;
      case 'settings': return <SettingsView />;
      case 'docs': return <DocsView />;
      default: return <DataPrepView />;
    }
  };

  return (
    <MainLayout>
      <Suspense fallback={(
        <div className="h-full min-h-[320px] flex items-center justify-center text-xs text-gray-500">
          Loading 3D workspace...
        </div>
      )}>
        {renderView()}
      </Suspense>
    </MainLayout>
  );
}
