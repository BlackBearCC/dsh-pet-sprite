// Standalone build for the dsh-pet bundle plugin.
//
// Two artifacts, mirroring what the DSH monorepo emits for client UI plugins:
//  1. Node half (lib/index.js + lib/invariant.js, ESM): a no-op `apply` that
//     exists so the plugin has a row in the host Loader config.
//  2. Browser half (lib/client.js, CJS): wrapped in the
//     `window.__ModuleLoader__.load({ id, factory })` handoff so the web
//     shell can register it; platform modules stay external and resolve
//     through the shell's frozen module table via require().
//
// Self-contained on purpose: no monorepo checkout, no project references,
// no type-check (tsdown transpiles only) — safe to run from `prepare` on a
// plain git install.

import type { UserConfig } from 'tsdown'

/** The module specifiers the DSH web shell seeds into the frozen module table (must match platform.ts). */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/** Documented runtime exemption (snapshot-store engine lives in runtime). */
const RUNTIME_STORE_EXEMPTION = '@deepseek-ai/dsh-client-runtime/client'

const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, RUNTIME_STORE_EXEMPTION]

const nodeHalf: UserConfig = {
  name: 'dsh-pet',
  entry: {
    index: 'src/index.ts',
    invariant: 'src/invariant.ts',
  },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  dts: true,
  clean: false,
}

const clientHalf: UserConfig = {
  name: 'dsh-pet/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  // Everything not in the module table must inline: a require() the table
  // cannot answer is a guaranteed runtime throw.
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    // Purity gate: cross-plugin value imports are forbidden — collaborate
    // through cordis services instead. Type-only imports are erased and
    // never reach this gate.
    name: 'dsh-pet-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module — cross-plugin value imports are forbidden`,
      )
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: "dsh-pet", factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [nodeHalf, clientHalf]
