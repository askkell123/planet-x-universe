import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'custom-sw.js',
      registerType: 'autoUpdate',
      injectRegister: 'script',
      manifest: {
        name: 'Planet-X Universe',
        short_name: 'Planet-X',
        start_url: '.',
        display: 'fullscreen',
        background_color: '#0c0c0c',
        theme_color: '#0c0c0c',
        icons: []
      }
    })
  ],
  server: {
    open: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    minify: true,
  }
}); 