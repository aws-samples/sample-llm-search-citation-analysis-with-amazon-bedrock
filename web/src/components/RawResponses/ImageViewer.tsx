import { useState } from 'react';
import type { S3Item } from '../../types';
import { formatDate } from '../../formatting/dateFormatter';
import { Spinner } from '../ui/Spinner';

interface ImageViewerProps {
  file: S3Item;
  imageUrl: string | null;
  onDownload: () => void;
  loading: boolean;
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const ImageViewer = ({
  file, imageUrl, onDownload, loading 
}: ImageViewerProps) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" className="text-blue-600" />
        <span className="ml-3 text-gray-600">Loading image...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ImageHeader file={file} onDownload={onDownload} />

      <div className="bg-gray-100 rounded-lg p-4 flex items-center justify-center min-h-[400px]">
        {imageUrl && !imageError ? (
          <div className="relative">
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner size="lg" className="text-gray-400" />
              </div>
            )}
            <img
              src={imageUrl}
              alt={file.name}
              className={`max-w-full max-h-[600px] rounded-lg shadow-lg transition-opacity ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          </div>
        ) : (
          <div className="text-center text-gray-500">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-300"
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
            <p>{imageError ? 'Failed to load image' : 'No image available'}</p>
          </div>
        )}
      </div>
    </div>
  );
};

interface ImageHeaderProps {
  file: S3Item;
  onDownload: () => void;
}

const ImageHeader = ({
  file, onDownload 
}: ImageHeaderProps) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-gray-50 rounded-lg p-4 gap-3">
    <div className="min-w-0">
      <h3 className="font-medium text-gray-900 truncate">{file.name}</h3>
      <p className="text-xs sm:text-sm text-gray-500">
        {file.size && formatSize(file.size)}
        {file.last_modified && ` • ${formatDate(file.last_modified)}`}
      </p>
    </div>
    <div className="flex items-center gap-2 shrink-0">
      <button
        onClick={onDownload}
        className="px-3 py-1.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        <span className="hidden sm:inline">Download</span>
      </button>
    </div>
  </div>
);
