import { defineConfig } from 'tsup';

// ESM + CommonJS + tipos: o parque tem apps `type: module` e CommonJS
// (drogamais-chamados, data-loja), em TS e em JS.
export default defineConfig({
  entry: ['src/index.ts', 'src/fastify.ts', 'src/express.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'node18',
  sourcemap: false,
});
