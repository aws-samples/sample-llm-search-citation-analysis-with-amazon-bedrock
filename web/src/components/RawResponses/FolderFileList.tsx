import type { S3Item } from '../../types';
import { formatDate } from '../../formatting/dateFormatter';
import { formatSize } from './fileSizeFormatter';

interface FolderFileListProps {
  browseData: {
    folders: S3Item[];
    files: S3Item[];
    total_folders: number;
    total_files: number;
  };
  onFolderClick: (folder: S3Item) => void;
  onFileClick: (file: S3Item) => void;
}

export const FolderFileList = ({
  browseData, onFolderClick, onFileClick 
}: FolderFileListProps) => {
  const isEmpty = browseData.folders.length === 0 && browseData.files.length === 0;

  if (isEmpty) {
    return <EmptyState />;
  }

  return (
    <div>
      <div className="space-y-2">
        {browseData.folders.map((folder) => (
          <FolderItem key={folder.path} folder={folder} onClick={() => onFolderClick(folder)} />
        ))}

        {browseData.files.map((file) => (
          <FileItem key={file.path} file={file} onClick={() => onFileClick(file)} />
        ))}
      </div>

      {(browseData.total_folders > 0 || browseData.total_files > 0) && (
        <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-400">
          {browseData.total_folders} folder{browseData.total_folders === 1 ? '' : 's'},{' '}
          {browseData.total_files} file{browseData.total_files === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
};

const EmptyState = () => (
  <div className="text-center py-12 text-gray-400">
    <svg
      className="w-12 h-12 mx-auto mb-4 text-gray-300"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
      />
    </svg>
    <p className="text-sm">No data found</p>
    <p className="text-xs mt-1">Run an analysis to generate data</p>
  </div>
);

interface FolderItemProps {
  folder: S3Item;
  onClick: () => void;
}

const FolderItem = ({
  folder, onClick 
}: FolderItemProps) => (
  <div
    onClick={onClick}
    className="flex items-center p-3 rounded-lg border border-gray-200 hover:bg-gray-50 hover:border-gray-300 cursor-pointer transition-colors"
  >
    <svg
      className="w-5 h-5 text-gray-400 mr-3"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
      />
    </svg>
    <div className="flex-1">
      <p className="font-medium text-sm text-gray-900">{folder.name}</p>
      <p className="text-xs text-gray-400">Folder</p>
    </div>
    <svg
      className="w-4 h-4 text-gray-400"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
    </svg>
  </div>
);

interface FileItemProps {
  file: S3Item;
  onClick: () => void;
}

const FileItem = ({
  file, onClick 
}: FileItemProps) => {
  const isImage = file.type === 'image';

  return (
    <div
      onClick={onClick}
      className="flex items-center p-3 rounded-lg border border-gray-200 hover:bg-gray-50 hover:border-gray-300 cursor-pointer transition-colors"
    >
      {isImage ? (
        <svg
          className="w-5 h-5 text-blue-400 mr-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      ) : (
        <svg
          className="w-5 h-5 text-gray-400 mr-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      )}
      <div className="flex-1">
        <p className="font-medium text-sm text-gray-900">{file.name}</p>
        <p className="text-xs text-gray-400">
          {file.size && formatSize(file.size)}
          {file.last_modified && ` • ${formatDate(file.last_modified)}`}
        </p>
      </div>
      <svg
        className="w-4 h-4 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
      </svg>
    </div>
  );
};
