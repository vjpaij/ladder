import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
  server: {
    port: 3000,
    watch: {
      ignored: [
        '**/data/**',
        '**/server/**',
        '**/scripts/**',
        '**/Indian Stocks/**',
        '**/scratch/**',
        '**/.agents/**',
        '**/*.json',
        '**/*.csv',
        '**/*.xlsx',
        '**/*.xls',
        '**/*.log',
        (file) => /[\\/](data|server|scripts|scratch|\.agents)[\\/]|\.(json|csv|xlsx|xls|log)$/i.test(file)
      ],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-recharts': ['recharts'],
          'vendor-motion': ['framer-motion'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
