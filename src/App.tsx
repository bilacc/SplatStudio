/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useEffect } from 'react';
import { MainLayout } from './components/layout/MainLayout';
import { useAppStore } from './store';

const DataPrepView = lazy(() => import('./components/views/DataPrepView').then((module) => ({ default: module.DataPrepView })));
const ProcessingView = lazy(() => import('./components/views/ProcessingView').then((module) => ({ default: module.ProcessingView })));
const Viewer3DView = lazy(() => import('./components/views/Viewer3DView').then((module) => ({ default: module.Viewer3DView })));
const ExportView = lazy(() => import('./components/views/ExportView').then((module) => ({ default: module.ExportView })));
const BatchView = lazy(() => import('./components/views/BatchView').then((module) => ({ default: module.BatchView })));
const SettingsView = lazy(() => import('./components/views/SettingsView').then((module) => ({ default: module.SettingsView })));
const DocsView = lazy(() => import('./components/views/DocsView').then((module) => ({ default: module.DocsView })));

export default function App() {
  const { currentView, isProcessing, pollStatus } = useAppStore();

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    pollStatus();
    if (isProcessing) {
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
      <Suspense fallback={<div className="h-full flex items-center justify-center text-xs text-gray-500">Loading view…</div>}>
        {renderView()}
      </Suspense>
    </MainLayout>
  );
}
