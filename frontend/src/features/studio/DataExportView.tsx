import { useState } from 'react';
import { useStudioStore, type Artifact } from '../../stores/studio-store.ts';
import { downloadCollection } from '../../api/endpoints/collections.ts';
import { PostDataTable } from './PostDataTable.tsx';
import { UnderlyingDataDialog } from './UnderlyingDataDialog.tsx';

interface DataExportViewProps {
  artifact: Extract<Artifact, { type: 'data_export' }>;
}

export function DataExportView({ artifact }: DataExportViewProps) {
  const collapseReport = useStudioStore((s) => s.collapseReport);
  const [downloading, setDownloading] = useState(false);
  const [showUnderlyingData, setShowUnderlyingData] = useState(false);

  const handleDownload = async () => {
    const collectionId = artifact.sourceIds[0];
    if (!collectionId) return;
    setDownloading(true);
    try {
      await downloadCollection(collectionId, artifact.title);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PostDataTable
        rows={artifact.rows}
        rowCount={artifact.rowCount}
        onBack={collapseReport}
        onDownload={artifact.sourceIds[0] ? handleDownload : undefined}
        downloadLabel={downloading ? 'Downloading…' : 'Download CSV'}
        downloading={downloading}
        onShowData={artifact.sourceIds.length > 0 ? () => setShowUnderlyingData(true) : undefined}
      />
      <UnderlyingDataDialog
        artifactId={showUnderlyingData ? artifact.id : null}
        onClose={() => setShowUnderlyingData(false)}
      />
    </div>
  );
}
