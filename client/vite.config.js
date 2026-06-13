import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// מזהה build ייחודי לכל בנייה — מוטבע גם ב-bundle (__BUILD_ID__) וגם ב-dist/version.json,
// כדי שלקוח שכבר פתוח יזהה שעלתה גרסה חדשה ויטען מחדש אוטומטית (ללא ניקוי מטמון ידני).
const BUILD_ID = String(Date.now());

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'emit-version-json',
      writeBundle(options) {
        try {
          const dir = options.dir || path.resolve('dist');
          fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ build: BUILD_ID }));
        } catch { /* ignore */ }
      }
    }
  ],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID)
  },
  server: {
    host: true,
    port: 5225,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:5222',
      '/data': 'http://localhost:5222',
      '/docs': 'http://localhost:5222',
      '/theme-assets': 'http://localhost:5222'
    }
  },
  build: {
    outDir: 'dist'
  }
});
