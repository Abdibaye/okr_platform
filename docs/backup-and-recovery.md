# Backup and Recovery Guide

This application stores its core data in PostgreSQL. Robust backup and disaster recovery encompasses not only goals and key results, but also identity, staff roles, managerial reporting hierarchies, granular goal permissions, and secure credential provisioning.

This guide provides complete, production-tested instructions and reference files for disaster recovery, including the official recovery dataset (`docs/recovery/workspace-recovery.json`) and the turnkey restore tool (`scripts/restore-backup.mjs`).

---

## 1. Staff Roles & Hierarchy Data Architecture

To understand how staff roles and reporting lines are protected, it is essential to review how identity and hierarchy are decoupled in the relational schema (`server/schema.ts`):

1. **Global Identity (`user` & `account`)**:
   - Stores authentication credentials, canonical email addresses, and verified identity (`id`, `name`, `email`, `emailVerified`).
2. **Tenant Membership & Roles (`company_memberships`)**:
   - Links a user to a company workspace (`company_id`, `user_id`).
   - **Staff Roles**: `role` is an `enum('admin', 'manager', 'member')`:
     - `admin`: Full platform control, user management, workspace settings, imports, exports, and backup downloads.
     - `manager`: Can create company/team goals, approve submitted OKRs, and request check-ins from direct/indirect reports.
     - `member`: Can draft and edit assigned individual OKRs and submit check-ins.
3. **Manager Reporting Hierarchy (`manager_id`)**:
   - In `company_memberships`, reporting lines are modeled via a self-referencing foreign key:
     ```sql
     manager_id TEXT REFERENCES "user"(id) ON DELETE SET NULL
     ```
   - This forms an acyclic Directed Tree representing the corporate organizational chart.
4. **Team Allocations (`team_memberships` & `teams`)**:
   - Maps staff to functional departments or squads, independent of direct managerial reporting lines.
5. **Granular Goal Access & Delegation (`objective_access` & `key_result_editors`)**:
   - `objective_access`: Explicit per-user permissions (`viewer`, `editor`) on specific objectives.
   - `key_result_editors`: Explicit delegation of key result update rights to designated team members.

---

## 2. Backup Assets & Procedures

### A. Turnkey Workspace Recovery File (`docs/recovery/workspace-recovery.json`)
The repository includes an updated, verified recovery snapshot located at:
- `docs/recovery/workspace-recovery.json`

This recovery snapshot contains the full, verified dataset from the published application (**ASTU Corp**):
* **Company Profile**: Complete tenant metadata (`id`: `d868c22c-84fe-4afb-be8c-95d21f8c56eb`, `name`: `ASTU Corp`).
* **Staff Directory & Identities (`staff` & `users`)**: 6 employee profiles matching the live ASTU Corp User Management directory:
* **Workspace Roles**: Exact permission assignments (`admin`, `manager`, `member`).
* **Manager Reporting Lines**: Intact multi-tier organizational hierarchy (5 linked reporting lines):
  - James Thomas (`workspace.admin@gmail.com`, Administrator / `admin`, top of hierarchy)
    - Daniel Matthew (`workspace.manager@gmail.com`, Workspace Manager / `manager`) → reports to James Thomas
      - Mark Steven (`workspace.member@gmail.com`, Team Member, `member`) → reports to Daniel Matthew
      - Abdi Test (`abdibaye0902@gmail.com`, Engineer, `member`) → reports to Daniel Matthew
      - QA scope invitee (`qa-okr-20261119@example.invalid`, QA Tester, `member`) → reports to Daniel Matthew
      - Client QA controlled inbox (`sourabh+alineo-qa-20261121@neander.ai`, Client Reviewer, `member`) → reports to Daniel Matthew
* **Teams & Rosters**: 3 teams (`team 01` with lead James Thomas, `QA remaining scope — Team A`, `QA forbidden team`).
* **Cycles & OKR Trees**: 6 planning cycles (`Q4 2026`, `QA review 2026-11-19`, `QA carry-forward 2026-11-19`, `QA remaining scope 2026-11-19`, `Client QA 21Nov acceptance 8dcf`, `Client QA 22Nov KR restore 93b24`), 35 objectives (including 22 objectives with exact `progress: null` fidelity and copied objective references), 22 key results, 38 check-in records, 6 goal comments, and 167 immutable audit logs.
* **Access Control & Lifecycle Tables**: Schema arrays for `objectiveAccess`, `keyResultEditors`, `invitations`, and `notifications`.

### B. Portable Admin JSON Export (`/api/exports/backup`)
Admins can download an on-demand JSON export snapshot directly from the platform (`GET /api/exports/backup`). The export engine executes relational joins across `companyMemberships` and `user` to export:
* `company`: Workspace configuration.
* `staff`: Full staff directory with joined manager names and emails (`name`, `email`, `role`, `managerId`, `managerName`, `managerEmail`).
* `users`: Canonical identity accounts.
* `companyMemberships`: Tenant role records.
* `teamMemberships` & `teams`: Team rosters and team leads.
* `cycles`, `objectives`, `objectiveAccess`, `keyResults`, `keyResultEditors`, `checkIns`, `comments`, `invitations`, `notifications`, and `auditLogs`.

### C. Standard Database Dump (`pg_dump`)
For infrastructure-level disaster recovery:
```bash
DATABASE_URL="postgresql://user:pass@host:5432/dbname?sslmode=require" pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --file=docs/recovery/database-backup.dump \
  "$DATABASE_URL"
```

---

## 3. Step-by-Step Usable Restore Procedures

### Method 1: Automated JSON Restore Script (`scripts/restore-backup.mjs`)
The repository provides an executable, transaction-safe CLI restore tool: `scripts/restore-backup.mjs`.

#### Runnable Command:
```bash
node --env-file=.env.local scripts/restore-backup.mjs docs/recovery/workspace-recovery.json
```

To supply a custom administrative recovery password during automated headless tests, specify `RECOVERY_PASSWORD`:
```bash
RECOVERY_PASSWORD="YourSecurePassword123!" node --env-file=.env.local scripts/restore-backup.mjs docs/recovery/workspace-recovery.json
```

#### How the Script Guarantees Zero Foreign Key Violations and Preserves Exact Business Values:
When restoring from a JSON backup, entity order discrepancies can trigger PostgreSQL constraint errors (such as copying a goal from a template that appears later in the JSON array, or linking an employee to a manager who is ingested later). The restore script executes a strict **Multi-Pass Ingestion Protocol** inside an atomic PostgreSQL transaction:

1. **Transaction Encapsulation (`BEGIN ... COMMIT`)**:
   - The entire recovery process runs inside a single database transaction. If any entity fails validation, `ROLLBACK` executes automatically, leaving the database completely clean.
2. **Company & Identity Provisioning with Secure Credentials**:
   - Restores the company workspace record (`companies`).
   - Inserts all users (`user`) with conflict handling (`ON CONFLICT (id) DO UPDATE`).
   - **Secure Credentials Process**:
     - Eliminates shared static passwords.
     - For each restored user, generates a unique, cryptographically random high-entropy temporary password (or adopts `RECOVERY_PASSWORD` if provided).
     - Inserts the scrypt-hashed password into the `account` table.
     - Provisions a secure one-time password reset token (24-hour expiration) into the `verification` table (`identifier = 'password-reset:<email>'`).
     - Outputs the credentials manifest securely to `docs/recovery/recovery-credentials.json` with restricted OS file permissions (`0600`, read/write only by the process owner).
3. **Pass 1 — Roles & Membership Enrollment (Hierarchy-Safe)**:
   - Restores `company_memberships` with the user's exact `role` (`admin`, `manager`, `member`), `jobTitle`, active status, and original `createdAt`/`updatedAt` timestamps.
   - **Sets `manager_id: null` in Pass 1**. This guarantees no foreign key errors can occur, regardless of user ingestion sequence.
4. **Pass 2 — Managerial Reporting Line Binding**:
   - Iterates through all memberships and resolves `manager_id`.
   - Validates that the manager exists in `user` and enforces `manager_id !== user_id`.
   - Commits `manager_id` foreign key pointers while preserving original timestamps.
5. **Departmental & Team Rosters**:
   - Upserts `teams` and designates `lead_user_id`.
   - Upserts `team_memberships` linking users to functional squads.
6. **Pass 1 — Objectives Base Ingestion & Exact Progress Preservation**:
   - Restores base `objectives`.
   - **Parent & Copied Foreign Key Protection**: Sets both `parent_objective_id: null` and `copied_from_objective_id: null` in Pass 1. This prevents PostgreSQL error `23503` when copied goals precede referenced goals in the payload.
   - **Strict Progress Value Preservation**: Preserves `progress: null` as SQL `NULL` for objectives without progress. Does not coerce `null` to `0.00` or `"0"`.
   - Preserves original `createdAt` and `updatedAt` timestamps.
7. **Pass 2 — Objectives Parent Alignment & Copied Goal References**:
   - Resolves `parent_objective_id` and `copied_from_objective_id` after all objectives are present in the table.
   - Updates references without modifying existing business values or clobbering timestamps.
8. **Goal Permissions & Delegated Editors**:
   - Restores explicit `objective_access` rows (`viewer`, `editor`).
   - Restores explicit `key_result_editors` delegated user IDs.
9. **Key Results, Historical Check-ins, Comments, Invitations & Audit Trail**:
   - Restores `key_results` preserving baseline, target, current values, and progress.
   - Restores historical check-in chronologies (`kr_check_ins`).
   - Restores goal comments and mentions (`goal_comments`).
   - Restores pending and accepted invitations (`invitations`).
   - Restores user notifications (`notifications`).
   - Restores immutable audit records (`audit_logs`).
   - **No Destructive Progress Recalculation**: Omits automated KR averaging updates during restore, guaranteeing exact fidelity to the exported business state.

---

### Method 2: Logical Dump Restoration (`pg_restore`)
When loading a custom format dump with `pg_restore`:
```bash
DATABASE_URL="postgresql://user:pass@target:5432/dbname?sslmode=require" pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname="$DATABASE_URL" \
  docs/recovery/database-backup.dump
```
* **Deferred Constraint Enforcement**: PostgreSQL loads table records first and recreates foreign key constraints and unique indexes *after* all data rows are populated.

---

## 4. Post-Restore Verification Checklist

After restoring a database or running `scripts/restore-backup.mjs`, execute the following technical verifications:

### 1. Database Integrity Verification (SQL)
Run these queries against your restored database to verify hierarchy and relational integrity:

```sql
-- A. Verify that all manager_id references resolve to valid users
SELECT cm.id, cm.user_id, cm.manager_id
FROM company_memberships cm
WHERE cm.manager_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = cm.manager_id);
-- Expected result: 0 rows (no broken foreign keys).

-- B. Verify that copied goals correctly reference target goals
SELECT id, title, copied_from_objective_id
FROM objectives
WHERE copied_from_objective_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM objectives o WHERE o.id = objectives.copied_from_objective_id);
-- Expected result: 0 rows.

-- C. Verify progress fidelity (null progress objectives preserved)
SELECT COUNT(*) AS null_progress_goals
FROM objectives
WHERE progress IS NULL;
-- Expected result: 22 for the ASTU Corp published dataset.

-- D. Verify active admin safeguard
SELECT COUNT(*) AS active_admins
FROM company_memberships
WHERE role = 'admin' AND is_active = true;
-- Expected result: >= 1.
```

### 2. Operational Health & Access Verification
1. **Health Check**:
   - `GET /api/health` must return `{"status":"ok"}`.
2. **Access & Credentials Manifest**:
   - Read temporary passwords from `docs/recovery/recovery-credentials.json` (or use `RECOVERY_PASSWORD` if set).
   - Sign in as an **Admin** (`workspace.admin@gmail.com`): verify full access to `/dashboard/team` (User Management) and `/dashboard/reports`.
   - Sign in as a **Manager** (`workspace.manager@gmail.com`): verify ability to view direct reports' restricted goals and issue check-in requests.
   - Sign in as a **Member** (`workspace.member@gmail.com`): verify restricted visibility boundaries and that `/api/exports/backup` returns **HTTP 403 Forbidden**.
