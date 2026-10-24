import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development, /api requests are forwarded to the FastAPI server (port 8000, or API_PORT),
// so the frontend always calls its own origin (same as in Docker and on Vercel).
const apiPort = process.env.API_PORT ?? "8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Recharts makes the single bundle ~650 kB (~190 kB gzipped): fine for a small internal app.
  build: { chunkSizeWarningLimit: 800 },
  server: {
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
});
