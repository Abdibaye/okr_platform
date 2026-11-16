# Backup and recovery

This app stores its data in PostgreSQL (Neon in the managed environments). Back up the whole database, not only export files. The admin-only JSON export at `/api/exports/backup` is a portable recovery aid, but it is not a substitute for a database backup.

## Create a backup

```bash
DATABASE_URL="postgresql://..." pg_dump --format=custom --file=okr-backup.dump "$DATABASE_URL"
```

Neon also supports continuous protection with point-in-time restores. In the Neon console, choose the branch, open **Recovery**, and restore to a new branch when you need a moment before a bad change.

## Restore

1. Create a new PostgreSQL database (or a new Neon branch).
2. Load the dump:

```bash
DATABASE_URL="postgresql://target..." pg_restore --clean --if-exists --dbname "$DATABASE_URL" okr-backup.dump
```

3. Point `DATABASE_URL` at the restored database and sign in as an admin.
4. Visit `/api/health`; it must return `{"status":"ok"}`.
5. Visit `/api/exports/backup` as an admin and confirm every collection is present: `cycles`, `teams`, `memberships`, `objectives`, `keyResults`, `checkIns`, `comments`, and `auditLogs`.

## Restore verification

- Spot-check one archived and one restored record to confirm historical rows are retained.
- Confirm `/api/reports`, `/api/workspace`, and `/api/exports/okrs` return data for an admin and at least one regular member.
- Confirm a member cannot download `/api/exports/backup` (HTTP 403).
