import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import clerk from "@clerk/astro";
import icon from "astro-icon";

export default defineConfig({
  integrations: [clerk(), icon()],
  adapter: node({ mode: "standalone" }),
  output: "server",
  vite: {
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  },
});