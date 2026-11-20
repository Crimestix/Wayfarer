import { Agent, type AgentOptions } from 'node:https';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

/*
 * LegendKeeper in der Browser-Vorschau: Anfragen an „/lk-api“ gehen an die LegendKeeper-API.
 * Die Vorschau kennt keinen Key. Antwortet LegendKeeper trotzdem, dann nur, weil die
 * Entwicklungsumgebung auf dem Weg nach draußen selbst einen einsetzt (deshalb folgt die
 * Verbindung dem dort eingestellten HTTPS-Proxy). In der installierten App läuft der Abruf
 * über die Rust-Seite und den Schlüsselbund – nie über diesen Weg.
 */
const legendKeeperAgent = new Agent({ keepAlive: true, proxyEnv: process.env } as AgentOptions);

// Tauri erwartet einen festen Port und ignoriert src-tauri beim Beobachten.
export default defineConfig({
  plugins: [react()],
  // Die Fassung der App – sichtbar in den Einstellungen (beim Bau aus package.json).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
    proxy: {
      '/lk-api': {
        target: 'https://www.legendkeeper.com',
        changeOrigin: true,
        agent: legendKeeperAgent,
        headers: { authorization: 'Bearer dummy', accept: 'application/json' },
        rewrite: (path) => path.replace(/^\/lk-api/, '/api/v3'),
      },
    },
  },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
