import { defineConfig } from 'vite'
import { VitePluginNode } from 'vite-plugin-node'

export default defineConfig({
  server: {
    port: 1660,
    host: '0.0.0.0',
  },
  plugins: [
    ...VitePluginNode({
      adapter: 'fastify',
      appPath: './src/main.ts',
      exportName: 'fastify',
      tsCompiler: 'esbuild',
    })
  ],
})
