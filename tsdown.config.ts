/**
 * tsdown config for dsh-cost-monitor: a Node-half library build plus a
 * browser client bundle. The client bundle is emitted as a closure-factory
 * artifact that registers through `window.__ModuleLoader__.load({id,
 * factory})` and resolves externals through the injected require (the loader
 * module table) — the same wire format the DSH web client consumes.
 */

import { defineConfig } from 'tsdown'

/** The module specifiers the web shell shares into the frozen module table. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

const ID = 'dsh-cost-monitor'

export default defineConfig([
  {
    name: ID,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.tsx' },
    // Browser bundle lands next to the node half; the entryFileNames pin
    // keeps it exactly lib/client.js. clean stays off so the node-half
    // output above survives.
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...PLATFORM_MODULES],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    // Anything not in the loader module table must inline: a require() the
    // table cannot answer is a guaranteed runtime throw.
    noExternal: (id: string) => (PLATFORM_MODULES.includes(id as (typeof PLATFORM_MODULES)[number]) ? undefined : true),
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
