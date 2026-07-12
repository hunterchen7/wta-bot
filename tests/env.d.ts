import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { Env as AppEnv } from '../src/env';

declare global {
  namespace Cloudflare {
    // Typed view of test bindings for `import { env } from 'cloudflare:workers'`
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
