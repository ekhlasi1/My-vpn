import { defineConfig } from 'rolldown'
import swc from 'unplugin-swc'

export default defineConfig({
  input: 'src/worker.ts',
  output: {
    file: 'dist/worker.js',
    minify: true,
    format: 'esm',
    inlineDynamicImports: true,
  },
  external: ['cloudflare:sockets'],
  plugins: [
    swc.rolldown({
      // Remove the invalid tsconfig option
      minify: true,
    }),
  ],
})