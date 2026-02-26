import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const parseEnvText = (raw: string) => {
  const parsed: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
};

const readEnvFile = (filePath: string) => {
  if (!fs.existsSync(filePath)) return {};
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.includes('\u0000')) {
    raw = fs.readFileSync(filePath, 'utf16le');
  }
  return parseEnvText(raw);
};

export default defineConfig(({ mode }) => {
  // Ensure .env is loaded even if Vite's loadEnv misses it.
  dotenv.config({ path: path.resolve(__dirname, '.env') });
    // Load env file based on `mode` in the current working directory.
    // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
    const envRoot = path.resolve(__dirname);
    const fileEnv = { ...readEnvFile(path.resolve(envRoot, '.env')), ...readEnvFile(path.resolve(envRoot, '.env.local')) };
    const env = { ...process.env, ...fileEnv, ...loadEnv(mode, envRoot, '') };
    return {
      envDir: envRoot,
      server: {
        port: 3000,
        host: '0.0.0.0',
        // Proxy Yahoo Finance APIs to bypass CORS restrictions in the browser.
        // When liveTools.ts fetches "/api/yahoo-search/...", Vite forwards it to Yahoo.
        proxy: {
          '/api/yahoo-search': {
            target: 'https://query2.finance.yahoo.com',
            changeOrigin: true,
            rewrite: (path: string) => path.replace(/^\/api\/yahoo-search/, ''),
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          },
          '/api/yahoo-chart': {
            target: 'https://query1.finance.yahoo.com',
            changeOrigin: true,
            rewrite: (path: string) => path.replace(/^\/api\/yahoo-chart/, ''),
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          },
          '/api/ddg': {
            target: 'https://api.duckduckgo.com',
            changeOrigin: true,
            rewrite: (path: string) => path.replace(/^\/api\/ddg/, ''),
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          },
        },
      },
      plugins: [react()],
      define: {
        __VITE_API_KEY__: JSON.stringify(env.VITE_API_KEY),
        __VITE_GEMINI_API_KEY__: JSON.stringify(env.VITE_GEMINI_API_KEY),
        __VITE_GEMINI_API_PRIMARY_KEY__: JSON.stringify(env.VITE_GEMINI_API_PRIMARY_KEY),
        __VITE_GOOGLE_API_KEY__: JSON.stringify(env.VITE_GOOGLE_API_KEY),
        __VITE_INTERNAL_API_KEY__: JSON.stringify(env.VITE_INTERNAL_API_KEY),
        __INTERNAL_API_KEY__: JSON.stringify(env.INTERNAL_API_KEY || env.VITE_INTERNAL_API_KEY),
        __GEMINI_API_KEY__: JSON.stringify(env.GEMINI_API_KEY || env.VITE_API_KEY),
        __GEMINI_API_PRIMARY_KEY__: JSON.stringify(env.GEMINI_API_PRIMARY_KEY),
        'process.env.VITE_API_KEY': JSON.stringify(env.VITE_API_KEY),
        'process.env.VITE_GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY),
        'process.env.VITE_GEMINI_API_PRIMARY_KEY': JSON.stringify(env.VITE_GEMINI_API_PRIMARY_KEY),
        'process.env.VITE_GOOGLE_API_KEY': JSON.stringify(env.VITE_GOOGLE_API_KEY),
        'process.env.INTERNAL_API_KEY': JSON.stringify(env.INTERNAL_API_KEY || env.VITE_INTERNAL_API_KEY),
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.VITE_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.VITE_API_KEY),
        'process.env.GEMINI_API_PRIMARY_KEY': JSON.stringify(env.GEMINI_API_PRIMARY_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
