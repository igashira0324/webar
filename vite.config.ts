import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    process.env.HTTPS === 'true' ? basicSsl() : []
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  worker: {
    format: 'es',
    plugins: () => []
  },
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        exhibition: resolve(__dirname, 'exhibition-vol5/index.html'),
        'exhibition-vol5/tech-book-acestep': resolve(__dirname, 'exhibition-vol5/tech-book-acestep.html'),
        'exhibition-vol5/tech-book-mmd': resolve(__dirname, 'exhibition-vol5/tech-book-mmd.html'),
        'shutter-chance': resolve(__dirname, 'shutter-chance/index.html')
      },
      output: {
        manualChunks: undefined
      }
    }
  }
});
