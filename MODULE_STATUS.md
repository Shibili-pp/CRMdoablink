# Module status

Status reflects the automated backend acceptance run and the implemented screens. Re-run `npm test` after changes before treating a module as done.

| Module | Status | Notes |
| --- | --- | --- |
| Project foundation and docs | Done | Express app, Vite client, env samples, OpenAPI |
| Authentication and demo accounts | Done | Five roles, bcrypt, refresh rotation, production block covered by tests |
| Role permissions | Done | API returns 403 for staff audit access and for an admin creating an owner |
| Dashboards | Done | `/dashboards/me` is role-specific and read from MongoDB |
| Staff, leave, branches, teams | Done | Create, deactivate, leave review, branch scope |
| Lead management | Done | Search, filters, notes, status, archive |
| Excel and CSV import | Done | Preview, duplicate and invalid rows, bucket commit covered by tests |
| Lead bucket and distribution | Done | Manual assign, round robin, workload, capacity, conflict on a stale owner |
| Lead swap and timeline | Done | Approval keeps previous owner and writes timeline events |
| Follow-ups | Done | Today, upcoming, overdue, missed, calendar, compliance summary |
| Notifications | Done | In-app list, announcements, Socket.IO emit. FCM waits for credentials |
| Inactivity alerts | Done | Scheduled scanner with configurable thresholds |
| Android call sync | Done | Device token, match, duplicate, ambiguous and unmatched covered by tests |
| Contact sync | Done | Consent flag required. Creating a lead is explicit |
| Recording references | Done | Search by id. Reveal writes an audit event. Audio is not stored |
| Calling analytics | Done | Source split for Android, manual and demo seed |
| Hourly reports | Done | Hour totals match the call log for that staff member and day |
| Targets | Done | Live progress from calls and activity |
| Revenue and payments | Done | Collected 30000, confirmed 80000 and expected pipeline stay separate in tests |
| Leaderboard | Done | Weights are configurable. Connected calls, not raw volume, drive the calling score |
| Reports and exports | Done | Catalog of 24 reports. PDF and Excel bytes verified |
| Audit logs | Done | Login, recording access and other writes |
| Android app | Starter | Kotlin client, permissions, WorkManager. Studio build, Play policy and recording OEM work remain |
| Frontend screens | Done | Owner, admin and staff signed in through the browser. Search, notes, follow-ups, bucket scope, reports and denied routes were checked |
