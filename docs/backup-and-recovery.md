# Backup and Recovery Guide

This application stores its core data in PostgreSQL (managed Neon in staging and production environments). Robust backup and disaster recovery encompasses not only goals and key results, but also identity, staff roles, and managerial reporting hierarchies.

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

## 2. Backup Procedures

### A. Full Database Backup (Primary Strategy)
A physical or logical database dump is the only mechanism that captures complete referential integrity across authentication tokens, users, memberships, OKR trees, check-ins, and audit logs.

```bash
DATABASE_URL="postgresql://..." pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --file=okr-backup.dump \
  "$DATABASE_URL"
```

* **Neon Point-In-Time Restore (PITR)**: Neon provides continuous write-ahead logging (WAL). In the Neon console, navigate to your Project → **Branches** → **Recovery**, and create a new branch at any target timestamp prior to data loss or accidental changes.

### B. Portable Admin JSON Export (`/api/exports/backup`)
Admins can download a portable JSON export snapshot containing `company`, `cycles`, `teams`, `memberships`, `objectives`, `keyResults`, `checkIns`, `goalComments`, and `auditLogs`. This acts as an auxiliary verification and compliance snapshot.

### C. Staff Roster CSV Export (`docs/templates/employees-import-template.csv`)
Human-readable organizational snapshots can be maintained using the standard CSV roster format:
```csv
email,name,role,manager_email,team_name,job_title,status
ceo@company.test,Eleanor Vance,admin,,Executive,Chief Executive Officer,active
vp.eng@company.test,Marcus Brody,manager,ceo@company.test,Engineering,VP of Engineering,active
lead.dev@company.test,Sophia Chen,member,vp.eng@company.test,Engineering,Staff Software Engineer,active
```
Using `manager_email` instead of internal database UUIDs ensures the hierarchy is human-auditable and completely portable across environments.

---

## 3. Restoring Hierarchy Without Breaking Reporting Lines

When restoring an organizational hierarchy, improper restoration order can trigger **Foreign Key constraint violations** (e.g. attempting to link an employee to a manager whose record has not yet been inserted) or create **circular dependency deadlocks**. The system employs specific architectural safeguards to guarantee integrity:

### Strategy 1: Full Database Restoration (`pg_restore` & Neon PITR)
When loading a custom format dump with `pg_restore`:
```bash
DATABASE_URL="postgresql://target..." pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname="$DATABASE_URL" \
  okr-backup.dump
```
* **Deferred Constraint Enforcement**: PostgreSQL loads table records first and recreates foreign key constraints (`company_memberships_manager_id_fkey`) and unique indexes *after* all data rows are populated.
* Because all `user` and `company_memberships` rows exist by the time constraints are enabled, the self-referencing `manager_id -> user.id` pointers rebind seamlessly without ordering issues.

---

### Strategy 2: Application-Level / CSV Roster Restoration (`/api/imports/employees`)
When migrating workspaces or recovering rosters via the Employee Import engine, the system prevents broken hierarchies through a **Two-Pass Ingestion Algorithm** and **Topological Validation**:

#### Step 1: Topological Top-Down Restoration Order
When restoring from CSV, records should be ordered from top of the hierarchy downwards:
1. Executive leadership with `manager_email: ""` (e.g. CEO).
2. Department Heads / VPs reporting to Executive Leadership.
3. Frontline Managers / Leads reporting to VPs.
4. Individual Contributors reporting to Frontline Managers.

#### Step 2: The Two-Pass Ingestion Protocol (Cycle & Forward-Reference Proof)
To eliminate forward-reference failures (where an employee row appears before their manager in an import batch), the import engine (`app/api/imports/employees/route.ts`) applies two-pass semantics:
* **Pass 1 — Identity & Role Enrollment**:
  - Inserts or updates all `user` and `company_memberships` rows with their declared `role` (`admin`, `manager`, `member`), `jobTitle`, and `isActive` status.
  - Temporarily sets `managerId: null` for newly invited accounts so foreign keys are never violated.
* **Pass 2 — Hierarchy Pointer Resolution**:
  - Once all users are guaranteed to exist in the workspace directory, the engine maps `manager_email` to the corresponding `manager.user_id` and commits `company_memberships.manager_id`.

#### Step 3: Cycle & Self-Reporting Loop Detection
During restoration, the platform actively guards against corrupted hierarchies via `createsReportingLoop` in `server/people.ts`:
* Before applying any `manager_id`, the system performs a depth-first traversal up the reporting chain:
  ```typescript
  export function createsReportingLoop(managers: Map<string, string | null>, userId: string, managerId: string): boolean {
    const seen = new Set<string>();
    let current: string | null | undefined = managerId;
    while (current) {
      if (current === userId) return true; // Direct or indirect cycle detected!
      if (seen.has(current)) return false;
      seen.add(current);
      current = managers.get(current);
    }
    return false;
  }
  ```
* **Guard Rules**:
  - **Self-Reporting Guard**: `manager_id === user_id` is strictly rejected.
  - **Acyclic Enforcement**: Mutual reporting (e.g., Alice reports to Bob, Bob reports to Alice) or multi-hop loops (A → B → C → A) are detected.
  - **Safety Fallback**: If an invalid loop is detected, the invalid link is rejected or safely defaulted to `manager_id: null`, ensuring the rest of the workspace hierarchy remains intact.

#### Step 4: Deactivated or Missing Manager Fallback (`ON DELETE SET NULL`)
* If a former manager has departed or their record is excluded from restoration, foreign key cascades do **not** delete subordinate staff.
* The relational schema enforces `ON DELETE SET NULL`: subordinate employees remain active, and their `manager_id` safely resets to `NULL` (unassigned manager), awaiting reassignment.

#### Step 5: Last Active Admin Safeguard
* Enforced by `countActiveAdmins` with pessimistic row locking (`for update`).
* A restoration or roster update cannot demote or deactivate the last remaining active workspace administrator, preventing accidental workspace lockouts.

---

## 4. Post-Restore Verification Checklist

After restoring a database or importing a roster, execute the following technical verifications:

### 1. Database Integrity Verification (SQL)
Run these queries against your restored database to verify hierarchy integrity:

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
JOIN "user" u ON u.id = cm.userId
JOIN company_memberships sub ON sub.manager_id = cm.userId
WHERE cm.role = 'member'
GROUP BY u.email, u.name, cm.role;
-- Warning: If direct reports exist, promote member to 'manager' or 'admin'.

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
   - Sign in as an **Admin**: verify full access to `/dashboard/team` (User Management) and `/dashboard/reports`.
   - Sign in as a **Manager**: verify ability to view direct reports' restricted goals and issue check-in requests.
   - Sign in as a **Member**: verify restricted visibility boundaries and that `/api/exports/backup` returns **HTTP 403 Forbidden**.
3. **Manager Check-In Request Engine**:
   - Test `POST /api/reminders/request` for a subordinate KR. Verify that the system correctly looks up the manager chain and dispatches the in-app notification.
4. **Data Rollups**:
   - Verify `/api/reports`: Confirm owner and team rollups compute correctly across all restored levels.
