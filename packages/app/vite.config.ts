import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the built app can be served from any folder.
  base: './',
  plugins: [svelte()],
});
