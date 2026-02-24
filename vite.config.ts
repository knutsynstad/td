import { devvit } from '@devvit/start/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [devvit()],
  build: {
    // Devvit iframe CSP blocks fetch/connect to data: URLs.
    // Force file URLs for all assets (including .glb imports).
    assetsInlineLimit: 0,
  },
});
