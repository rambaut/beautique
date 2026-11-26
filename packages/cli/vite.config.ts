import { defineConfig } from 'vite';

// Bundles the CLI and the workspace packages it uses into one file for node.
export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'beautique.js', banner: '#!/usr/bin/env node' },
    },
  },
  ssr: { noExternal: true },
});
