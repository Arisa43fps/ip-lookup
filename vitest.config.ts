import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// `wrangler.jsonc` declares IPINFO_TOKEN as a required secret. Provide a test
// value so the test run is self-contained and does not depend on `.dev.vars`.
process.env.IPINFO_TOKEN ??= "test-token";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          IPINFO_TOKEN: "test-token",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.spec.ts"],
  },
});
