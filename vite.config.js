import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], build: { rollupOptions: { input: { main: resolve('index.html'), offline: resolve('offline.html') } } }, server: { host: '127.0.0.1', port: 5173, proxy: { '/api': 'http://127.0.0.1:4174' } } });
