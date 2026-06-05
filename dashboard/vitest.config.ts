import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setupTests.ts"],
    include: ["src/**/*.test.{js,jsx,ts,tsx}"],
    exclude: [
      "node_modules/**",
      "dist/**",
      "src/components/entire/**/*.test.{js,jsx,ts,tsx}",
      "src/pages/EntirePage*.test.{js,jsx,ts,tsx}",
    ],
    globals: true,
  },
});
