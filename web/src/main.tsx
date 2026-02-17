import React from 'react';
import ReactDOM from 'react-dom/client';
import { Authenticator } from '@aws-amplify/ui-react';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const RootErrorFallback = () => (
  <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 max-w-md text-center">
      <div className="w-12 h-12 mx-auto mb-4 text-gray-400 dark:text-gray-500">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Application Error</h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Something went wrong loading the application.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
      >
        Reload Page
      </button>
    </div>
  </div>
);

const rootElement = document.getElementById('root');
if (rootElement === null) {
  document.body.textContent = 'Root element not found';
} else {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary fallback={<RootErrorFallback />}>
        <Authenticator.Provider>
          <App />
        </Authenticator.Provider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
