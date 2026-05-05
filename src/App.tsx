/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { MainLayout } from './components/layout/MainLayout';
import { useAppStore } from './store';

import { DataPrepView } from './components/views/DataPrepView';
import { ProcessingView } from './components/views/ProcessingView';
import { Viewer3DView } from './components/views/Viewer3DView';
import { ExportView } from './components/views/ExportView';
import { BatchView } from './components/views/BatchView';
import { SettingsView } from './components/views/SettingsView';
import { DocsView } from './components/views/DocsView';

export default function App() {
  const { currentView } = useAppStore();

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
      {renderView()}
    </MainLayout>
  );
}
