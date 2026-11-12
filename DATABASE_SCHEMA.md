# Database schema

Database name comes from `MONGODB_URI`. Documents use ObjectId references. Activity is not embedded on the lead.

## users

Username, email, bcrypt `passwordHash`, role, permission list, branch, team, manager, employment status, `isDemo`, `maxLeadAllocation`, lockout fields, `deletedAt`.

Indexes: unique username, unique email, sparse unique `employeeId`, role, branch, team.

## branches and teams

Branch has a unique code. Team belongs to one branch and may have a leader.

## leads

`leadCode` (`ORB-10001` style) is unique. Phones are stored as entered and as `phoneNormalized` (country code plus national number, default 91). Status is a string so custom statuses work. `assignedTo` null means the bucket. `bucketStatus` mirrors that.

Indexes: phone, alternate phone, status, assigned staff, team, branch plus created date, district, source.

Ownership changes go to `leadassignments`, not into an array on the lead.

## leadassignments

`fromStaff`, `toStaff`, `assignedBy`, reason, mode (`manual`, `round_robin`, `equal_workload`, `capacity`, `team`, `swap`, `import`, `create`). Rows are not deleted when the owner changes.

## leadactivities

Append-only timeline: type, actor, description, old value, new value, timestamp. Indexed by lead and time. There is no update or delete route.

## leadswaprequests

Pending, approved or rejected, with the reason and reviewer.

## leadimports

Uploader, file name, mapping, row preview, progress and summary. Rows stay under the 2000 row cap so a preview document stays a safe size.

## followups

Lead, assignee, due time, priority, status (`pending`, `completed`, `missed`, `cancelled`), `completedOnTime`.

## calllogs

`uniqueKey` is unique. A second unique sparse index is `device + androidEventId`. Fields include staff, phone, lead, `matchStatus` (`matched`, `unmatched`, `ambiguous`, `manual`), type, start, duration, status and `dataSource` (`android_sync`, `manual`, `demo_seed`).

## callrecordings

Recording id, provider, call, lead, staff and status. `accessReference` is excluded from normal queries. The audio file is not stored.

## androiddevices

One row per device identifier. `tokenHash` stores the SHA-256 of the device token. Status is `active` or `revoked`. Contact sync stays off until consent is recorded.

## syncedcontacts

Unique on device plus device contact id. A match to a lead is recorded. Contacts are not turned into leads automatically.

## syncbatches

Counts for each call, contact or recording sync.

## hourlyreports

Unique on staff plus period start. Stores call metrics, activity metrics, source breakdown and WhatsApp text for one local hour.

## targets

Type, assignee (staff, team, branch or user), value, period, dates and an edit history.

## revenueopportunities, payments, invoices

Opportunity holds expected revenue, deal value, probability, stage and status. `collectedAmount` is recomputed from payments. Payments store amount, date, method, transaction reference and who recorded them. Partial payments are additional payment rows. Invoices use `INV-` numbers.

## notifications

Recipient, type, title, body, optional `dedupeKey` (unique and sparse) and `readAt`.

## auditlogs

User, action, module, record id, old values, new values, IP, user agent, time. Passwords and device tokens are not written here.

## leaverequests, systemsettings, customleadstatuses, pipelinestages, alertrules, counters

Leave has a date range and review state. Settings hold company timezone, lead sources, leaderboard weights and role templates. Statuses and stages are editable. Alert rules hold the thresholds. Counters allocate lead and invoice numbers.

## Relationships

- User → branch, team, manager
- Lead → assignee, team, branch, creator, import batch
- Call and recording → staff, device, lead when the match is unique
- Opportunity → lead; payment → opportunity and optional invoice
- Follow-up, target, hourly report → staff and their team or branch
