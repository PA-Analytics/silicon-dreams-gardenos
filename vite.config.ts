import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/** Serves GardenOS directly at / in dev and preview. */
function gardenosRootPlugin(): Plugin {
  const rewriteRoot = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (req.url === '/' || req.url?.startsWith('/?')) {
      req.url = '/gardenos.html' + req.url.slice(1);
    }
    next();
  };
  return {
    name: 'gardenos-root-rewrite',
    configureServer(server) { server.middlewares.use(rewriteRoot); },
    configurePreviewServer(server) { server.middlewares.use(rewriteRoot); },
  };
}

export default defineConfig({
  plugins: [gardenosRootPlugin()],
  server: {
    port: 5186,
    strictPort: false,
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        gardenos: resolve(rootDir, 'gardenos.html'),
      },
      output: {
        manualChunks: {
          three: ['three', 'three/webgpu', 'three/tsl'],
        },
      },
    },
  },
});
