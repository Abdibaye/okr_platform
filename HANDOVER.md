# Plain-English Handover Guide: How the OKR Platform Works

This guide explains how the OKR (Objectives and Key Results) platform works in simple, everyday terms. It is written for anyone managing, using, or maintaining the platform—whether you are a product manager, team lead, or administrator.

---

## 1. What Is This App?

This platform is a shared company goal tracker (similar to Betterworks). It helps teams:
- Set big quarterly company and team goals (**Objectives**).
- Measure them with concrete numbers or milestones (**Key Results**).
- Share regular progress updates with notes and blockers (**Check-ins**).
- Keep all history safe and unalterable (**Audit Trail & Immutable History**).

### Workspaces & Self-Serve Creation
- **What is a Workspace?**: An isolated digital home for an organization (e.g., *Acme Corp* or *Demo Company*). Goals, teams, cycles, and check-ins belong strictly to their workspace.
- **Creating a Workspace**: Users can enter a company name during sign-up or click **"+ Create New Workspace"** from the workspace switcher inside the app. The creator becomes the primary **Admin** and a starter open cycle (e.g. *Q4 2026*) is automatically created.
- **Switching Workspaces**: If a user belongs to multiple organizations, they can click their company name in the sidebar or mobile menu to toggle between workspaces with one click.

---

## 2. Who Can See and Edit What? (Permissions Explained Simply)

Every goal has one of three privacy settings:
- **Company**: Public to everyone in the company.
- **Team**: Visible only to people who belong to that team (e.g. Engineering or Sales).
- **Restricted (Private)**: Confidential. Only visible to the owner, their boss, company admins, and anyone specifically invited.

### Quick Permission Table

| Role / Person | Company Goals | Team Goals | Restricted (Private) Goals |
| :--- | :--- | :--- | :--- |
| **Company Admin** | Can view & edit everything | Can view & edit everything | Can view & edit everything |
| **Manager** | Can view all; can edit goals owned by their team members | Can view all in their team; can edit goals owned by their direct/indirect reports | Can view & edit if someone they manage owns it (or if invited) |
| **Goal Owner / Named Editor** | Can view all; can edit their own goal | Can view all in their team; can edit their own goal | Can view & edit their own goal |
| **Teammate (Not an editor)** | Can view all; cannot edit others' goals | Can view all goals in their team; cannot edit others' goals | Cannot see or know the goal exists |
| **Colleague in another team** | Can view all; cannot edit | Cannot see or find the goal | Cannot see or know the goal exists |

### What happens when someone searches or downloads a CSV?
- The system automatically filters out any private or other-team goals the user is not allowed to see.
- If someone tries to guess the direct web link or ID of a private goal they don't have access to, the server replies **"Not Found" (404)**—it won't even confirm whether the secret goal exists.

---

## 3. How the Goal Math Works (With Everyday Examples)

All math is automatic, consistent, and strictly follows these rules:

### A. Number Clamping (Always 0% to 100%)
- Progress can never drop below **0%** and can never exceed **100%**.
- *Example*: If your target is to sign 10 new clients and you sign 12, your progress shows as **100%** (not 120%). If you lose clients and end up below your starting point, it stays at **0%**.

### B. Numbers That Go Down (Decreasing Goals)
- Sometimes success means reducing something bad, such as customer wait times, churn rate, or server errors.
- *Example*: Lower average support response time from 10 minutes down to 2 minutes.
  - If response time drops to 6 minutes, you are halfway to your goal $\to$ **50% completed**.

### C. Yes / No Milestones (Binary Goals)
- For projects that are either finished or not (like *"Launch the mobile app"* or *"Pass security audit"*).
- There is no partial percentage: it is strictly **0%** (not done) or **100%** (done).

### D. Goals With No Metrics Yet (Empty Goals)
- If you write an Objective title (e.g. *"Improve Customer Happiness"*) but have not added any Key Results under it yet:
  - The system displays **"—" (No percentage)** instead of 0%.
  - *Why?* Because showing 0% implies you worked on it and failed. Having no metrics simply means it is not measurable yet.
  - These empty goals are excluded from overall company averages so they do not artificially drag down team scores.

### E. Why Parent Goals Never Double-Count Child Goals
- You can align a Team Goal to support a big Company Goal.
- The company goal calculates its progress **only from its own direct Key Results**. It never adds the percentages of child goals on top of its own. This prevents accidental double-counting and inflated scores.

### F. No Endless Loops
- You cannot make Goal A point to Goal B if Goal B already points back to Goal A. The system automatically detects and blocks circular dependencies.

---

## 4. How Check-In History and Typo Corrections Work

Instead of just typing over old numbers, every progress update is logged into an **append-only history** (like a bank statement).

### The 3-Step Rule for Determining Current Progress
Whenever you look at a Key Result, the system picks the current number using this simple order:
1. **Ignore Crossed-Out Mistakes**: Any update that was replaced by a later correction is excluded.
2. **Sort by Date**: Of the remaining updates, the one with the newest **Effective Date** wins.
3. **Tie-Breaker**: If two updates have the exact same effective date, the one entered most recently (by timestamp) wins.

### What if someone logs an update late? (Backdating)
- Imagine today is May 10th, and someone already logged an update for May 8th showing 50 sales.
- You realize you forgot to log last week's numbers for May 1st (30 sales), so you enter it today with the May 1st date.
- The system keeps your May 1st entry safely in the history timeline, but keeps the May 8th entry (50 sales) as the active current progress.

### What if someone made a typo? (Linked Corrections)
- You do not delete the old record. You click "Correct an entry" and enter the right number.
- The system keeps both rows: the original typo is visually struck through, and your new correction becomes the active record.

---

## 5. Emails and Reminder Nudges

### What happens if an email service is not set up?
- The app has built-in **In-App Only fallback**.
- If an email provider (like Resend) is not connected, the app does not crash or give errors. Instead, notifications appear inside the app's bell icon on the screen.
- If an email service is connected and a delivery fails (e.g., bad email address or network timeout), the failure is visibly marked with a **"Retry"** button.

### How do nudges and reminders work?
- Managers can click **"Request Check-in"** on any direct report's goal to gently remind them to update their numbers.
- The platform also runs automated sweeps for goals that are overdue or haven't been updated in a while (e.g., after 7, 14, or 30 days depending on the cycle).
- The system remembers what it sent so it never sends duplicate reminder spam for the same goal.

---

## 6. Backups, Archiving & Restoring (Never Losing Data)

### A. One-Click Backup for Admins
- Company Admins can visit the Operations page or call `/api/exports/backup` to download a single **JSON backup file**.
- This file contains your entire company history: teams, staff, cycles, goals, key results, check-in history, comments, and audit logs.
- Regular staff members are blocked from downloading this file.

### B. Archiving vs. Deleting (Soft-Archive)
- In this platform, **no goal is ever deleted permanently by accident**.
- When you click "Archive" on a goal, key result, or cycle:
  - It simply gets hidden from your active daily list.
  - All historical check-ins and notes remain safely preserved in the database.
  - You can click **"Restore"** at any time to un-hide it and bring it right back.
  - If you archive a Key Result, the parent goal immediately recalculates its average so the archived item does not affect your current score.

---

## 7. Quick Technical Health Checks

If you or a developer ever want to confirm everything is running properly:
- **Check code health**: Run `pnpm check` (confirms 0 TypeScript errors).
- **Run the math checks**: Run `node --experimental-strip-types scripts/okr-math.check.mts` (confirms 15/15 math rules pass).
- **Verify server status**: Visit `/api/health` in your browser (should return `{"status":"ok"}`).
