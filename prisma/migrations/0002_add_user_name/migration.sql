-- Adding a NEW migration rather than editing 0001_init, unlike earlier
-- passes: your DATABASE_URL/DIRECT_URL are now real and the migrate job may
-- have already applied 0001_init. Prisma tracks applied migrations by
-- filename + checksum in `_prisma_migrations` — editing an already-applied
-- migration file breaks that on the next `migrate deploy` (checksum
-- mismatch). Always add a new migration for schema changes from here on.

-- Backfill-safe pattern for adding a required column to a table that may
-- already have rows: add with a temporary default, then drop the default
-- so the app-level (zod) validation is what enforces "required" for any
-- NEW row going forward, matching schema.prisma's `name String` with no
-- `@default`.
ALTER TABLE "User" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ALTER COLUMN "name" DROP DEFAULT;
