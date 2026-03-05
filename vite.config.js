import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Cloudflare Pages (static) 向け：特別な設定は基本不要
export default defineConfig({
  plugins: [react()],
});
