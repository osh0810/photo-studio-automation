import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
const migrations = await readD1Migrations('./src/webapp/db/migrations');
export default defineWorkersConfig({ test: {
  include: ['test/booking-confirmation.spec.ts'],
  poolOptions: { workers: {
    isolatedStorage: false, // Windows sqlite-shm workaround; this suite clears its own rows.
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
  } },
} });
