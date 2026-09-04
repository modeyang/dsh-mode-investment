import { defineConfig } from 'tsdown'
import { hanaiClientBundle } from './tooling/dsh-client-bundle/index.ts'

export default defineConfig([
  {
    name: 'dsh-mode-investment/host',
    entry: { index: 'packages/host/src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    dts: true,
    clean: true,
    sourcemap: true,
    outputOptions: {
      entryFileNames: '[name].js',
    },
  },
  {
    name: 'dsh-mode-investment/profile-tools',
    entry: {
      'install-profile': 'scripts/install-profile.ts',
      'verify-profile': 'scripts/verify-profile.ts',
      service: 'scripts/service.ts',
    },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    sourcemap: true,
    outputOptions: {
      entryFileNames: '[name].js',
    },
  },
  hanaiClientBundle('dsh-mode-investment', 'packages/client-workbench/src/index.tsx'),
])
