import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5225,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:5222',
      '/data': 'http://localhost:5222'
    }
  },
  build: {
    outDir: 'dist'
  }
});
