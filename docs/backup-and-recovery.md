# Backup and Recovery Guide

This application stores its core data in PostgreSQL. Robust backup and disaster recovery encompasses not only goals and key results, but also identity, staff roles, and managerial reporting hierarchies.

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

---

## 2. Backup Assets & Procedures

### A. Turnkey Workspace Recovery File (`docs/recovery/workspace-recovery.json`)
The repository includes a ready-to-use, complete recovery file located at:
- `docs/recovery/workspace-recovery.json`

This recovery snapshot contains the full, verified production dataset from the published application (**ASTU Corp**):
* **Company Profile**: Complete tenant metadata (`id`: `d868c22c-84fe-4afb-be8c-95d21f8c56eb`, `name`: `ASTU Corp`).
* **Staff Directory & Identities (`staff` & `users`)**: 6 employee profiles matching the live ASTU Corp User Management directory:
* **Workspace Roles**: Exact permission assignments (`admin`, `manager`, `member`).
* **Manager Reporting Lines**: Intact multi-tier organizational hierarchy:
  - James Thomas (`workspace.admin@gmail.com`, Administrator / `admin`, top of hierarchy)
    - Daniel Matthew (`workspace.manager@gmail.com`, Workspace Manager / `manager`) → reports to James Thomas
      - Mark Steven (`workspace.member@gmail.com`, Team Member, `member`) → reports to Daniel Matthew
      - Abdi Test (`abdibaye0902@gmail.com`, Engineer, `member`) → reports to Daniel Matthew
      - QA scope invitee (`qa-okr-20261119@example.invalid`, QA Tester, `member`) → reports to Daniel Matthew
      - Client QA controlled inbox (`sourabh+alineo-qa-20261121@neander.ai`, Client Reviewer, `member`) → reports to Daniel Matthew
* **Teams & Rosters**: 3 teams (`team 01` with lead James Thomas, `QA remaining scope — Team A`, `QA forbidden team`).
* **Cycles & OKR Trees**: 6 planning cycles (`Q4 2026`, `QA review 2026-11-19`, `QA carry-forward 2026-11-19`, `QA remaining scope 2026-11-19`, `Client QA 21Nov acceptance 8dcf`, `Client QA 22Nov KR restore 93b24`), 35 objectives, 22 key results with numeric/percentage metrics, 38 check-in records, 6 goal comments, and 167 immutable audit logs.

### B. Portable Admin JSON Export (`/api/exports/backup`)
Admins can download an on-demand JSON export snapshot directly from the platform (`GET /api/exports/backup`). The export engine executes relational joins across `companyMemberships` and `user` to export:
* `company`: Workspace configuration.
* `staff`: Full staff directory with joined manager names and emails (`name`, `email`, `role`, `managerId`, `managerName`, `managerEmail`).
* `users`: Canonical identity accounts.
* `companyMemberships`: Tenant role records.
* `teamMemberships` & `teams`: Team rosters and team leads.
* `cycles`, `objectives`, `keyResults`, `checkIns`, `comments`, and `auditLogs`.

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

* **Point-In-Time Restore (PITR) & WAL Archiving**: For production environments configured with continuous Write-Ahead Logging (WAL) or managed storage snapshots, point-in-time recovery allows rolling back to any specific transaction timestamp prior to an accidental change or incident.

### D. Staff Roster CSV Export (`docs/templates/employees-import-template.csv`)
Human-readable organizational snapshots can be maintained using the standard CSV roster format:
```csv
email,name,role,manager_email,team_name,job_title,status
workspace.admin@gmail.com,James Thomas,admin,,team 01,Administrator,active
workspace.manager@gmail.com,Daniel Matthew,manager,workspace.admin@gmail.com,team 01,Workspace Manager,active
workspace.member@gmail.com,Mark Steven,member,workspace.manager@gmail.com,team 01,Team Member,active
abdibaye0902@gmail.com,Abdi Test,member,workspace.manager@gmail.com,team 01,Engineer,active
```
Using `manager_email` instead of internal database UUIDs ensures the hierarchy is human-auditable and completely portable across environments.

---

## 3. Step-by-Step Usable Restore Procedures

### Method 1: Automated JSON Restore Script (`scripts/restore-backup.mjs`)
The repository provides an executable, transaction-safe CLI restore tool: `scripts/restore-backup.mjs`.

#### Runnable Command:
```bash
node --env-file=.env.local scripts/restore-backup.mjs docs/recovery/workspace-recovery.json
```

#### How the Script Restores Staff Roles & Reporting Lines Without Breaking:
When restoring from a JSON backup, improper insertion order can trigger foreign key constraint violations (e.g. attempting to assign an employee to a manager who has not yet been inserted) or cycle deadlocks. The restore script executes a strict **Two-Pass Ingestion Protocol** inside an atomic PostgreSQL transaction:

1. **Transaction Encapsulation (`BEGIN ... COMMIT`)**:
   - The entire recovery process runs inside a single database transaction. If any entity fails validation, `ROLLBACK` executes automatically, preserving data integrity.
2. **Company & Identity Provisioning**:
   - Restores the company workspace record (`companies`).
   - Inserts all users (`user`) with conflict handling (`ON CONFLICT (id) DO UPDATE`).
   - Provisions initial credential accounts (`account`) with default credentials (`RecoveryPass123!`) so restored staff can immediately sign in.
3. **Pass 1 — Roles & Membership Enrollment (Hierarchy-Safe)**:
   - Restores `company_memberships` with the user's exact `role` (`admin`, `manager`, `member`), `jobTitle`, and active status.
   - **Crucially, sets `manager_id: null` in Pass 1**. This guarantees that no foreign key constraint errors can occur, regardless of the order users appear in the backup file.
4. **Pass 2 — Managerial Reporting Line Binding**:
   - Iterates through all memberships and resolves `manager_id`.
   - Validates that the manager exists in the `user` table.
   - Enforces the self-reporting safeguard (`manager_id !== user_id`).
   - Commits the `manager_id` foreign key pointers, reconstructing the hierarchical tree.
5. **Departmental & Team Rosters**:
   - Upserts `teams` and designates `lead_user_id`.
   - Upserts `team_memberships` linking users to functional squads.
6. **OKR Cycles, Objectives & Alignment**:
   - Restores `okr_cycles`.
   - Restores `objectives` using a two-pass mechanism for `parent_objective_id` so company-to-individual alignment trees are reconstructed cleanly.
7. **Key Results, Historical Check-ins & Comments**:
   - Restores `key_results` with baseline, target, current values, and confidence ratings.
   - Restores historical check-in chronologies (`kr_check_ins`).
   - Restores goal comments and mentions (`goal_comments`).
   - Restores immutable audit records (`audit_logs`).
8. **Automated Parent Progress Recalculation**:
   - Recalculates objective progress (`ROUND(AVG(progress), 2)`) from active key results, ensuring all parent rollups match the restored metrics.

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
* **Deferred Constraint Enforcement**: PostgreSQL loads table records first and recreates foreign key constraints (`company_memberships_manager_id_fkey`) and unique indexes *after* all data rows are populated.
* Because all `user` and `company_memberships` rows exist by the time constraints are enabled, the self-referencing `manager_id -> user.id` pointers rebind seamlessly without ordering issues.

---

### Method 3: CSV Roster Ingestion (`/api/imports/employees`)
When migrating workspaces or recovering staff rosters via the Employee Import engine (`POST /api/imports/employees` or the UI at `/dashboard/team`):

1. **Topological Order**:
   - Executive leadership with empty `manager_email` (e.g. CEO).
   - Department Heads / VPs reporting to Executive Leadership.
   - Frontline Managers / Leads reporting to VPs.
   - Individual Contributors reporting to Frontline Managers.
2. **Cycle & Self-Reporting Loop Detection**:
   - The platform runs `createsReportingLoop` (`server/people.ts`) via depth-first graph traversal to prevent circular reporting chains (e.g. A → B → C → A).
   - If an invalid loop is detected, the link is rejected or safely defaulted to `manager_id: null`.
3. **Deactivated or Missing Manager Safeguard (`ON DELETE SET NULL`)**:
   - If a manager departs, `ON DELETE SET NULL` ensures subordinate employees are never deleted; their manager link cleanly resets to `NULL` awaiting reassignment.
4. **Last Active Admin Protection**:
   - Enforced by `countActiveAdmins` with pessimistic row locking (`FOR UPDATE`). No restore or roster update can demote or deactivate the last remaining active administrator.

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

-- B. Verify that no employee reports to themselves
SELECT id, user_id, manager_id
FROM company_memberships
WHERE user_id = manager_id;
-- Expected result: 0 rows (no self-loops).

-- C. Verify management role consistency
-- Check if any staff member with direct reports has role = 'member'
SELECT u.email, u.name, cm.role, COUNT(sub.id) AS direct_reports
FROM company_memberships cm
JOIN "user" u ON u.id = cm.user_id
JOIN company_memberships sub ON sub.manager_id = cm.user_id
WHERE cm.role = 'member'
GROUP BY u.email, u.name, cm.role;
-- Warning: If direct reports exist, consider promoting member to 'manager' or 'admin'.

-- D. Verify active admin safeguard
SELECT COUNT(*) AS active_admins
FROM company_memberships
WHERE role = 'admin' AND is_active = true;
-- Expected result: >= 1.
```

### 2. Operational Health & API Verification
1. **Health Check**:
   - `GET /api/health` must return `{"status":"ok"}`.
2. **Access & Permissions**:
   - Sign in as an **Admin** (`workspace.admin@gmail.com` / `RecoveryPass123!`): verify full access to `/dashboard/team` (User Management) and `/dashboard/reports`.
   - Sign in as a **Manager** (`workspace.manager@gmail.com` / `RecoveryPass123!`): verify ability to view direct reports' restricted goals and issue check-in requests.
   - Sign in as a **Member** (`workspace.member@gmail.com` / `RecoveryPass123!`): verify restricted visibility boundaries and that `/api/exports/backup` returns **HTTP 403 Forbidden**.
3. **Manager Check-In Request Engine**:
   - Test `POST /api/reminders/request` for a subordinate KR. Verify that the system correctly looks up the manager chain and dispatches the in-app notification.
4. **Data Rollups**:
   - Verify `/api/reports`: Confirm owner and team rollups compute correctly across all restored levels.
