import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tauri erwartet einen festen Port und ignoriert src-tauri beim Beobachten.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
