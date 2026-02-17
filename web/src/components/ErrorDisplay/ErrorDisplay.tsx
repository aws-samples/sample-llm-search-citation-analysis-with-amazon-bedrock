import {
  parseApiError, type ApiError, type ErrorCategory
} from '../../infrastructure/errors';

interface ErrorDisplayProps {
  readonly error: string | Error | null;
  readonly context?: string;
  readonly onRetry?: () => void;
  readonly onDismiss?: () => void;
  readonly variant?: 'inline' | 'banner' | 'card';
  readonly className?: string;
}

type ContextType = Parameters<typeof parseApiError>[1];

class ErrorDisplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErrorDisplayError';
  }
}

const ErrorIcons: Record<ErrorCategory, JSX.Element> = {
  network: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
    </svg>
  ),
  auth: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  ),
  not_found: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  validation: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  rate_limit: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  server: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
    </svg>
  ),
  timeout: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  config: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  unknown: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

function isValidContext(context: string | undefined): context is ContextType {
  return context === undefined || typeof context === 'string';
}

function createApiError(error: string | Error, context: string | undefined): ApiError {
  const validContext = isValidContext(context) ? context : undefined;
  const errorObj = typeof error === 'string' ? new ErrorDisplayError(error) : error;
  return parseApiError(errorObj, validContext);
}

interface ErrorComponentProps {
  apiError: ApiError;
  icon: JSX.Element;
  onRetry?: () => void;
  onDismiss?: () => void;
}

const InlineError = ({
  apiError, icon, onRetry 
}: Omit<ErrorComponentProps, 'onDismiss'>) => (
  <div className="flex items-center gap-2 text-sm text-red-600">
    <span className="flex-shrink-0 text-red-500">{icon}</span>
    <span>{apiError.message}</span>
    {onRetry && apiError.recoverable && (
      <button onClick={onRetry} className="text-red-700 hover:text-red-800 underline ml-1">Retry</button>
    )}
  </div>
);

const BannerError = ({
  apiError, icon, onRetry, onDismiss 
}: ErrorComponentProps) => (
  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
      <span className="flex-shrink-0 text-red-500">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-red-800">{apiError.message}</p>
        {apiError.suggestion && <p className="text-sm text-red-600 mt-1">{apiError.suggestion}</p>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {onRetry && apiError.recoverable && (
          <button onClick={onRetry} className="px-3 py-1.5 text-sm font-medium text-red-700 bg-red-100 rounded-lg hover:bg-red-200 transition-colors">Retry</button>
        )}
        {onDismiss && (
          <button onClick={onDismiss} className="p-1.5 text-red-500 hover:text-red-700 rounded-lg hover:bg-red-100 transition-colors" aria-label="Dismiss">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  </div>
);

const CardError = ({
  apiError, icon, onRetry, onDismiss 
}: ErrorComponentProps) => (
  <div className="bg-white rounded-lg border border-gray-200 p-6">
    <div className="flex flex-col items-center text-center">
      <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-500 mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{apiError.message}</h3>
      {apiError.suggestion && <p className="text-sm text-gray-600 mb-4">{apiError.suggestion}</p>}
      <div className="flex items-center gap-3">
        {onRetry && apiError.recoverable && (
          <button onClick={onRetry} className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">Try Again</button>
        )}
        {onDismiss && (
          <button onClick={onDismiss} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">Dismiss</button>
        )}
      </div>
    </div>
  </div>
);

export function ErrorDisplay({
  error,
  context,
  onRetry,
  onDismiss,
  variant = 'inline',
  className = '',
}: ErrorDisplayProps): JSX.Element | null {
  if (!error) return null;

  const apiError = createApiError(error, context);
  const icon = ErrorIcons[apiError.category];

  if (variant === 'inline') {
    return <div className={className}><InlineError apiError={apiError} icon={icon} onRetry={onRetry} /></div>;
  }

  if (variant === 'banner') {
    return <div className={className}><BannerError apiError={apiError} icon={icon} onRetry={onRetry} onDismiss={onDismiss} /></div>;
  }

  return <div className={className}><CardError apiError={apiError} icon={icon} onRetry={onRetry} onDismiss={onDismiss} /></div>;
}

export default ErrorDisplay;
