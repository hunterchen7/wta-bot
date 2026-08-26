import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.resolve('migrations'));
  return {
    plugins: [
      cloudflareTest({
        // Keep remote-only bindings (notably Workers AI) out of unit tests so
        // CI never needs production Cloudflare credentials.
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            FORM_SIGNING_SECRET: 'test-signing-secret',
            ANALYSIS_WORKER_SECRET: 'test-analysis-worker-secret',
            DASHBOARD_ADMINS: 'admin@example.com,org@example.com,ivy@example.com,practice@example.com,api-admin@example.com',
          },
        },
      }),
    ],
    test: {
      include: ['tests/**/*.test.ts'],
      setupFiles: ['./tests/apply-migrations.ts'],
    },
  };
});
