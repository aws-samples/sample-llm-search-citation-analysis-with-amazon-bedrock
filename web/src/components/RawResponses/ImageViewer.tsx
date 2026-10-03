import { useState } from 'react';
import type { S3Item } from '../../types';
import { formatDate } from '../../formatting/dateFormatter';
import { Spinner } from '../ui/Spinner';
import { DownloadButton } from './DownloadButton';
import { ViewerHeader } from './ViewerHeader';
import { formatSize } from './fileSizeFormatter';
import { StrokeIcon } from '../ui/StrokeIcon';
import { PHOTO_PATHS } from '../ui/iconPaths';

interface ImageViewerProps {
  file: S3Item;
  imageUrl: string | null;
  onDownload: () => void;
  loading: boolean;
}

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
              className={`max-w-full max-h-[600px] rounded-lg shadow-lg transition-opacity dark:brightness-90 dark:contrast-95 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          </div>
        ) : (
          <div className="text-center text-gray-500">
            <StrokeIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" paths={PHOTO_PATHS} />
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
  <ViewerHeader
    name={file.name}
    details={
      <>
        {file.size && formatSize(file.size)}
        {file.last_modified && ` • ${formatDate(file.last_modified)}`}
      </>
    }
  >
    <DownloadButton onClick={onDownload} />
  </ViewerHeader>
);
