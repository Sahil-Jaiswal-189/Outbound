import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser", timeout: 30000, fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:5189", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 960 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ],
  webServer: { command: "node server.mjs", url: "http://127.0.0.1:5189", reuseExistingServer: false,
    env: { PORT: "5189", DB_PATH: "data/browser-test.db", TABPFN_URL: "", ORS_API_KEY: "", OLLAMA_URL: "http://127.0.0.1:1" } }
});
