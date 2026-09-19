import {
  useState, useEffect 
} from 'react';
import {
  useRawResponses, type BucketType 
} from '../../hooks/useRawResponses';
import { FileViewer } from './FileViewer';
import { ImageViewer } from './ImageViewer';
import { Breadcrumb } from './Breadcrumb';
import { FolderFileList } from './FolderFileList';
import type {
  S3Item, S3BrowseResponse, RawResponseContent
} from '../../types';
import { Spinner } from '../ui/Spinner';

interface RawResponsesExplorerProps {initialPath?: string;}

export const RawResponsesExplorer = ({ initialPath }: RawResponsesExplorerProps) => {
  const {
    loading, error, browseData, fileContent, browse, getFile, getDownloadUrl, clearFile 
  } =
    useRawResponses();
  const [activeTab, setActiveTab] = useState<BucketType>('responses');
  const [currentPath, setCurrentPath] = useState<string[]>(
    initialPath ? initialPath.split('/').filter(Boolean) : []
  );
  const [selectedFile, setSelectedFile] = useState<S3Item | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (initialPath) {
      const parts = initialPath.split('/').filter(Boolean);
      setCurrentPath(parts);
    }
  }, [initialPath]);

  useEffect(() => {
    browse(currentPath.join('/'), activeTab);
  }, [currentPath, activeTab, browse]);

  const handleTabChange = (tab: BucketType) => {
    setActiveTab(tab);
    setCurrentPath([]);
    setSelectedFile(null);
    setImageUrl(null);
    clearFile();
  };

  const handleFolderClick = (folder: S3Item) => {
    const rootPrefix = activeTab === 'responses' ? 'raw-responses/' : 'screenshots/';
    const parts = folder.path.replace(rootPrefix, '').split('/').filter(Boolean);
    setCurrentPath(parts);
    setSelectedFile(null);
    setImageUrl(null);
    clearFile();
  };

  const handleFileClick = async (file: S3Item) => {
    setSelectedFile(file);
    if (file.type === 'image') {
      // For images, get a presigned URL
      const url = await getDownloadUrl(file.path, activeTab);
      setImageUrl(url);
    } else {
      await getFile(file.path, activeTab);
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      setCurrentPath([]);
    } else {
      setCurrentPath(currentPath.slice(0, index + 1));
    }
    setSelectedFile(null);
    setImageUrl(null);
    clearFile();
  };

  const handleDownload = async () => {
    if (!selectedFile) return;
    const url = await getDownloadUrl(selectedFile.path, activeTab);
    if (url) {
      window.open(url, '_blank');
    }
  };

  const handleBack = () => {
    setSelectedFile(null);
    setImageUrl(null);
    clearFile();
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <ExplorerHeader
        activeTab={activeTab}
        onTabChange={handleTabChange}
        selectedFile={selectedFile}
        onBack={handleBack}
      />

      <div className="px-4 sm:px-6 py-3 bg-gray-50 border-b border-gray-200 overflow-x-auto">
        <Breadcrumb
          path={currentPath}
          onNavigate={handleBreadcrumbClick}
          rootLabel={activeTab === 'responses' ? 'raw-responses' : 'screenshots'}
        />
      </div>

      <div className="p-4 sm:p-6">
        <ExplorerBody
          loading={loading}
          error={error}
          fileContent={fileContent}
          imageUrl={imageUrl}
          selectedFile={selectedFile}
          browseData={browseData}
          onDownload={handleDownload}
          onFolderClick={handleFolderClick}
          onFileClick={handleFileClick}
        />
      </div>
    </div>
  );
};

interface ExplorerBodyProps {
  loading: boolean;
  error: string | null;
  fileContent: RawResponseContent | null;
  imageUrl: string | null;
  selectedFile: S3Item | null;
  browseData: S3BrowseResponse | null;
  onDownload: () => Promise<void>;
  onFolderClick: (folder: S3Item) => void;
  onFileClick: (file: S3Item) => Promise<void>;
}

const ExplorerBody = ({
  loading, error, fileContent, imageUrl, selectedFile, browseData, onDownload, onFolderClick, onFileClick
}: ExplorerBodyProps) => (
  <>
    {error && (
      <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    )}

    {loading && !fileContent && !imageUrl && <LoadingState />}

    <SelectedFileView
      selectedFile={selectedFile}
      imageUrl={imageUrl}
      fileContent={fileContent}
      loading={loading}
      onDownload={onDownload}
    />

    {!selectedFile && browseData && !loading && (
      <FolderFileList
        browseData={browseData}
        onFolderClick={onFolderClick}
        onFileClick={onFileClick}
      />
    )}
  </>
);

type SelectedFileViewProps = Pick<ExplorerBodyProps, 'selectedFile' | 'imageUrl' | 'fileContent' | 'loading' | 'onDownload'>;

const SelectedFileView = ({
  selectedFile, imageUrl, fileContent, loading, onDownload
}: SelectedFileViewProps) => (
  <>
    {selectedFile?.type === 'image' && (
      <ImageViewer
        file={selectedFile}
        imageUrl={imageUrl}
        onDownload={onDownload}
        loading={loading}
      />
    )}

    {selectedFile && selectedFile.type !== 'image' && fileContent && (
      <FileViewer
        file={selectedFile}
        content={fileContent}
        onDownload={onDownload}
        loading={loading}
      />
    )}
  </>
);

interface ExplorerHeaderProps {
  activeTab: BucketType;
  onTabChange: (tab: BucketType) => void;
  selectedFile: S3Item | null;
  onBack: () => void;
}

const ExplorerHeader = ({
  activeTab, onTabChange, selectedFile, onBack 
}: ExplorerHeaderProps) => (
  <div className="border-b border-gray-200 px-4 sm:px-6 py-4">
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-4">
          <TabButton
            active={activeTab === 'responses'}
            onClick={() => onTabChange('responses')}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            }
          >
            Raw Responses
          </TabButton>
          <TabButton
            active={activeTab === 'screenshots'}
            onClick={() => onTabChange('screenshots')}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            }
          >
            Screenshots
          </TabButton>
        </div>
        <p className="text-xs sm:text-sm text-gray-500 mt-2">
          {activeTab === 'responses'
            ? 'Browse and inspect raw responses from AI providers'
            : 'Browse screenshots captured during page crawling'}
        </p>
      </div>
      {selectedFile && (
        <button
          onClick={onBack}
          className="px-3 sm:px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2 self-start sm:self-auto"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          Back
        </button>
      )}
    </div>
  </div>
);

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}

const TabButton = ({
  active, onClick, icon, children 
}: TabButtonProps) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
      active
        ? 'bg-gray-900 text-white'
        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
    }`}
  >
    {icon}
    {children}
  </button>
);

const LoadingState = () => (
  <div className="flex items-center justify-center py-12">
    <Spinner className="text-gray-400" />
    <span className="ml-3 text-sm text-gray-500">Loading...</span>
  </div>
);
