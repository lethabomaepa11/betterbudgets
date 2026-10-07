# Migration Guide for BetterBudgets

## Overview

This document describes how to handle database migrations properly in the BetterBudgets project, especially when there are existing users on deployment.

## Architecture

- **Database**: PostgreSQL (Neon) managed via Prisma ORM
- **Auth**: Better Auth with Prisma adapter
- **Backend**: Next.js API routes (formerly Hono server)
- **Package**: `@betterbudgets/db` contains Prisma schema and client

## Migration Commands

### Development

```bash
# Create and apply a new migration
pnpm run db:migrate

# Push schema changes without creating migration (dev only)
pnpm run db:push

# Generate Prisma client after schema changes
pnpm run db:generate

# Open Prisma Studio
pnpm run db:studio
```

### Production (with existing users)

**NEVER use `db:push` or `db:migrate` in production.** These commands can cause data loss.

```bash
# Apply pending migrations in production (safe for existing data)
pnpm run db:migrate:deploy
```

## Migration Workflow

### 1. Making Schema Changes

1. Edit the Prisma schema in `packages/db/prisma/schema/schema.prisma`
2. For auth-related changes, edit `packages/db/prisma/schema/auth.prisma`
3. Run `pnpm run auth:generate` to update auth schema from Better Auth config
4. Create migration: `pnpm run db:migrate`
5. Review the generated migration file in `packages/db/prisma/migrations/`
6. Commit the migration file to version control

### 2. Deploying to Production

1. Ensure all migration files are committed
2. Run `pnpm run db:migrate:deploy` on the production database
3. This applies only pending migrations, never modifies existing ones

### 3. Handling Failed Migrations

If a migration fails in production:

1. Check the error in the deployment logs
2. Fix the issue (SQL, database state, etc.)
3. Mark as resolved: `pnpm exec prisma migrate resolve --applied <migration_name>`
4. Re-run: `pnpm run db:migrate:deploy`

## Environment Variables

### Required for Migrations

- `DATABASE_URL` - Pooled connection for application queries
- `DATABASE_URL_DIRECT` - Direct connection for migrations (required by Prisma Migrate)

### Server-only (not exposed to client)

- `BETTER_AUTH_SECRET` - Auth secret key
- `BETTER_AUTH_URL` - Auth base URL
- `CORS_ORIGIN` - CORS origin for web app
- `GROQ_API_KEY` - AI planning API key
- `GROQ_MODEL` - AI model override

## Better Auth Schema Changes

When changing auth plugins or schema options:

1. Update `packages/auth/src/index.ts`
2. Run `pnpm run auth:generate` from project root
3. Review schema changes in `packages/db/prisma/schema/auth.prisma`
4. Create migration: `pnpm run db:migrate`
5. Apply in production: `pnpm run db:migrate:deploy`

## Important Notes

### Do NOT:
- Use `prisma db push` in production
- Use `prisma migrate dev` in production
- Manually edit migration files after they're committed
- Run migrations on a database with active connections (use maintenance window)

### DO:
- Always use `prisma migrate deploy` in production
- Test migrations in staging first
- Have a rollback plan (database backup before migrations)
- Run `prisma migrate status` before deploying
- Keep migration files in version control

## CI/CD Integration

Add to your deployment pipeline:

```yaml
- name: Check migration status
  run: pnpm exec prisma migrate status
  
- name: Deploy migrations
  run: pnpm run db:migrate:deploy
```

## Troubleshooting

### "Database schema is not in sync"
Run `pnpm run db:migrate` to create a new migration, or `pnpm run db:push` for development only.

### "Migration failed"
Check the error, fix the issue, then run `pnpm exec prisma migrate resolve --applied <name>` followed by `pnpm run db:migrate:deploy`.

### "Drift detected"
Someone modified the database directly. Run `pnpm run db:migrate` to create a migration that brings schema in sync, or manually reconcile.

## References

- [Prisma Migrate Deploy](https://www.prisma.io/docs/orm/prisma-migrate/workflows/migrations-deployment)
- [Better Auth Migrations](https://www.better-auth.com/docs/concepts/database#migrations)
- [Neon Direct Connections](https://neon.com/docs/connect/connection-pooling)