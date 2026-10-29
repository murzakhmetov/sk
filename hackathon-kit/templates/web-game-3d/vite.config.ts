import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { apiDevPlugin } from './dev/apiDevPlugin.js';

export default defineConfig({
  plugins: [react(), apiDevPlugin()],
  build: {
    // The Rapier physics engine ships its WASM inlined as base64 (~2 MB), so the
    // physics chunk is large by design. Vendor chunks cache across app deploys.
    chunkSizeWarningLimit: 2600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'physics', test: /node_modules[\\/]@dimforge/ },
            { name: 'three', test: /node_modules[\\/](three|three-stdlib|@react-three)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
});
