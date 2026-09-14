import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  base: process.env.VITE_BASE ?? '/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/health': { target: 'http://localhost:3000', changeOrigin: true },
      '/auth': { target: 'http://localhost:3000', changeOrigin: true },
      '/workflows': { target: 'http://localhost:3000', changeOrigin: true },
      '/runs': { target: 'http://localhost:3000', changeOrigin: true },
      '/workspace': { target: 'http://localhost:3000', changeOrigin: true },
      '/self-development': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
