import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3005,
    proxy: {
      '/call': {
        target: 'http://localhost:3004',
        changeOrigin: true,
      },
    },
  },
});
