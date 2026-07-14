/// <reference types="vitest" />
import {
  defineConfig, loadEnv
} from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vendor chunk assignment for Rollup/Rolldown `manualChunks`.
 *
 * Function form instead of object form because vite 8 bundles with rolldown,
 * which only supports the function signature (the object form fails with
 * "TypeError: manualChunks is not a function"). The function form is also
 * first-class Rollup API, so it behaves identically on vite 6.
 *
 * `scheduler` is grouped with react/react-dom explicitly: the old object
 * form pulled it into vendor-react implicitly as a react-dom dependency.
 * The `[\\/]` boundary after each package name keeps lookalike packages
 * (react-chartjs-2, react-router, react-markdown) out of vendor-react.
 */
function vendorChunk(id: string): string | undefined {
  if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
    return 'vendor-react';
  }
  if (/[\\/]node_modules[\\/](chart\.js|react-chartjs-2)[\\/]/.test(id)) {
    return 'vendor-charts';
  }
  if (/[\\/]node_modules[\\/]xlsx-js-style[\\/]/.test(id)) {
    return 'vendor-xlsx';
  }
  return undefined;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // Optional dev-only API proxy: when VITE_API_PROXY_TARGET is set we forward
  // `/api/*` from the local dev server to the deployed API. The deployed
  // backend's CORS policy only allows the production CloudFront origin, so
  // direct browser calls from `localhost:5173` would fail. Routing through
  // the dev server makes the browser see same-origin responses. Only kicks
  // in for `npm run dev`; production builds resolve VITE_API_URL directly.
  const proxyTarget = env.VITE_API_PROXY_TARGET ?? '';
  const enableDevProxy = mode === 'development' && proxyTarget.length > 0;

  return {
    plugins: [react()],
    server: enableDevProxy
      ? {
        proxy: {
          '/api': {
            target: proxyTarget,
            changeOrigin: true,
            secure: true,
          },
        },
      }
      : undefined,
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      minify: 'terser',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {output: {manualChunks: vendorChunk,},},
    },
  };
});
