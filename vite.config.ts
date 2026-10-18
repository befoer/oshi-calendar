import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { handleWebTools } from "./scripts/web-tools.mjs";
const buildId = new Date().toISOString();
export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(buildId) },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          lunar: ["lunar-javascript"],
          storage: ["dexie", "dexie-react-hooks"],
          validation: ["zod"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
  plugins: [
    react(),
    {
      name: "local-web-tools",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          handleWebTools(req, res)
            .then((handled) => {
              if (!handled) next();
            })
            .catch(next);
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          handleWebTools(req, res)
            .then((handled) => {
              if (!handled) next();
            })
            .catch(next);
        });
      },
    },
    {
      name: "build-version",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "build.json",
          source: JSON.stringify({ buildId }),
        });
      },
    },
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "推日 · 角色创作日历",
        short_name: "推日",
        description: "关注角色，安排每一次创作",
        lang: "zh-CN",
        theme_color: "#5a55d8",
        background_color: "#f6f5fb",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        // Activate installed caches without forcing an in-progress editor to reload.
        // The next refresh / explicit launcher navigation uses the current build.
        skipWaiting: true,
        importScripts: ["sw-launch.js"],
        navigateFallbackDenylist: [/^\/__/, /\/build\.json$/],
        navigateFallback: "/index.html",
        // Fonts are unicode-range subsets (~196 files); precaching all would bloat
        // install. Cache only the subsets actually rendered, on demand.
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        runtimeCaching: [
          {
            urlPattern: /\/fonts\/.+\.woff2$/,
            handler: "CacheFirst",
            options: {
              cacheName: "webfonts",
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/__huiqi_character\/image\?url=/,
            handler: "CacheFirst",
            options: {
              cacheName: "local-character-portraits",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/lain\.bgm\.tv\//,
            handler: "CacheFirst",
            options: {
              cacheName: "bangumi-portraits",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
