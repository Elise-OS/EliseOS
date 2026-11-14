import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default defineConfig((env) =>
  mergeConfig(viteConfig(env), { test: { setupFiles: ['./src/test-setup.ts'] } }),
);
