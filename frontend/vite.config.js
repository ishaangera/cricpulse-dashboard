import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_BASE = process.env.VITE_API_BASE || "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: API_BASE,
        changeOrigin: true,
        secure: API_BASE.startsWith("https://"),
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
