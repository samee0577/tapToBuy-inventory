// A Prisma config file disables Prisma's implicit .env loading, so this is
// imported explicitly to make DATABASE_URL / DIRECT_DATABASE_URL visible to
// `prisma migrate` and `prisma generate`.
import './prisma-dotenv.js';

import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
