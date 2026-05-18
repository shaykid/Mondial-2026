import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5225,
    proxy: {
      '/api': 'http://localhost:5222'
    }
  },
  build: {
    outDir: 'dist'
  }
});
