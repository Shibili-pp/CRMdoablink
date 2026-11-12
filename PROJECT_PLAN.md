# DoablinkOrbit project plan

The repository was empty. This plan is the architecture that was then implemented.

## Product

DoablinkOrbit is an internal sales operating system for DOABLINK PRIVATE LIMITED. It covers leads, assignment, follow-ups, staff, targets, revenue, reports and a real Android call-log API. The browser does not pretend to read a phone.

## Stack

- React 18 and Vite for the web client
- Express 4 and Mongoose 8 for the API
- MongoDB, configured only through `MONGODB_URI`
- Socket.IO for in-app alerts
- JWT access tokens plus rotating refresh tokens
- ExcelJS and PDFKit for exports
- Kotlin starter under `android/` for call log and contacts

JavaScript is used throughout the web and API. Business rules live in services. Routes validate input and check permissions.

## Access

Roles, from widest to narrowest: OWNER, SUPER_ADMIN, ADMIN, TEAM_LEADER, STAFF.

Owner and super admin see every branch. An admin is limited to their branch. A team leader is limited to their team. Staff see their own leads, calls, follow-ups and targets. The API applies that scope even if the client asks for another id.

Owner permissions cannot be reduced. A user can create only roles below their own. Demo accounts are seeded only outside production and cannot sign in when `NODE_ENV=production`.

## Phases

1. Foundation: app shell, Mongo connection, auth, five roles, layouts, live dashboards.
2. Organization and leads: staff, branches, teams, leave, lead book, import, bucket, assignment, swap, timeline.
3. Follow-ups, reminders, missed follow-ups and inactivity alerts.
4. Android device tokens, call sync, contact sync, matching, recording references and analytics.
5. Hourly reports, targets, pipeline and payments.
6. Leaderboard, 24 reports, PDF, Excel, CSV and audit logs.
7. Tests, backup script, security headers, rate limits and deployment notes.

## Data rules that must stay true

- Expected pipeline, weighted pipeline, confirmed revenue, collected payments and lost value are separate.
- A call belongs to one hour, based on its start time in `Asia/Kolkata`.
- Duplicate Android event ids are ignored.
- If one phone matches several leads, the call stays unmatched and is flagged ambiguous.
- Imported leads land in the bucket. They are not auto-assigned.
- Activity history is append-only.
- Recording files are not stored in MongoDB.

## Verification

`backend/tests` covers the acceptance paths against an in-memory database. A module is treated as working when those paths pass, not when a screen only renders.
