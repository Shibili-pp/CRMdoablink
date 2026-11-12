# API documentation

Base path: `/api/v1`

Interactive reference: `/api/docs`

## Response shape

```json
{ "success": true, "message": "OK", "data": {}, "meta": { "page": 1, "limit": 20, "total": 0, "pages": 1 } }
```

Failures use `success: false`, an HTTP status and an optional `errors` array. Validation errors are 422.

List endpoints accept `page`, `limit` (max 100), `sort`, `order`, `q` and the filters named on that screen. Filtering runs in MongoDB.

Send `Authorization: Bearer <accessToken>` except for login, refresh and the device sync routes. Device sync uses `Authorization: Bearer dev_...`.

## Auth

- `POST /auth/login` `{ username, password }`
- `POST /auth/refresh` uses the httpOnly cookie or `{ refreshToken }`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/change-password`

Refresh tokens rotate. The previous token is revoked.

## Organization

- `GET/POST /users`, `PATCH /users/:id`, activate and deactivate
- `PUT /users/:id/permissions` and `PUT /roles/:role/permissions`
- `GET/POST/PATCH /branches`, `GET/POST/PATCH /teams`, `POST /teams/:id/transfer`
- `GET/POST /leaves`, `POST /leaves/:id/review`

## Leads

- `GET /leads` with search and filters. `view=bucket` is the unassigned queue.
- `POST /leads`, `PATCH /leads/:id`, `DELETE /leads/:id` (soft delete)
- `POST /leads/:id/notes`
- `GET /leads/:id/timeline` and `/involvement`
- `POST /leads/bulk/status`
- `GET /leads/export?format=xlsx|csv|pdf`

Import:

- `POST /lead-imports` multipart field `file` (`.xlsx`, `.xls`, `.csv`, 5 MB, 2000 rows)
- `POST /lead-imports/:id/mapping`
- `POST /lead-imports/:id/commit` with `skipDuplicates` and `updateExisting`
- `GET /lead-imports/:id/failures`

Assignment:

- `GET /lead-assignments` and `/workload`
- `POST /lead-assignments` `{ leadIds, staffId, reason, expectedStaffId }`
- `POST /lead-assignments/distribute` mode `round_robin`, `equal_workload`, `capacity` or `team`

`expectedStaffId: null` means the caller still believes the lead is in the bucket. If another user assigned it first, the response lists a conflict.

Swaps:

- `POST /lead-swaps` `{ leadId, toStaff, reason }`
- `POST /lead-swaps/:id/approve` and `/reject`

Staff can request a swap only for their own lead. Approval requires assign permission.

## Follow-ups

- `GET /followups?bucket=today|upcoming|overdue|missed`
- `GET /followups/summary` and `/calendar?month=YYYY-MM`
- `POST /followups` with `date` and `time` in the company timezone, or `dueAt`
- `POST /followups/:id/complete`
- `POST /followups/reassign` `{ fromStaffId, toStaffId }`

A job every five minutes sends due reminders and marks overdue pending items as missed.

## Calls and Android

Staff JWT:

- `POST /android/devices/register` requires `consentAccepted: true` and returns `deviceToken` once
- `POST /android/devices/:id/revoke`
- `POST /android/devices/:id/contacts-sync` `{ enabled }`
- `GET /android/sync-status` and `/sync-history`
- `GET /calls` and `/calls/analytics`
- `POST /calls/manual` stores `dataSource: manual`
- `GET /call-recordings?recordingId=`
- `GET /call-recordings/:id` returns the private reference and writes `recording.access`
- `GET /contacts`
- `POST /contacts/:id/create-lead`

Device token only:

- `POST /android/calls/sync` `{ events: [{ androidEventId, phone, callType, startedAt, durationSeconds, status }] }`
- `POST /android/contacts/sync`
- `POST /android/recordings/sync` `{ recordingId, provider, accessReference, status }`

The sync response counts inserted, duplicates, matched, unmatched and ambiguous. Ambiguous calls are not attached to a guessed lead.

Analytics include `bySource.android_sync`, `manual` and `demo_seed`. Only `android_sync` is device-verified.

## Performance and money

- `GET /hourly-reports?date=YYYY-MM-DD&ensure=1`
- `GET /hourly-reports/whatsapp`
- `POST /hourly-reports/generate`
- `GET/POST /targets`, `PATCH /targets/:id` returns live `progress`
- `GET /revenue/summary` returns expected pipeline, weighted pipeline, confirmed, collected, pending collection and lost
- `POST /payments` adds a partial or full payment and does not change expected revenue into collected revenue
- `GET /leaderboard?period=daily|weekly|monthly&view=team`

## Reports, alerts, settings

- `GET /reports` lists the 24 report keys
- `GET /reports/:type`
- `GET /reports/:type/export?format=pdf|xlsx|csv`
- `GET /notifications`, mark read, `POST /notifications/announce`
- `GET /audit-logs`
- `GET/PATCH /alert-rules/:id`
- `GET /settings`, `PUT /settings/:key` for `general`, `leadSources`, `leaderboardWeights`
- `POST /lead-statuses` and `/pipeline-stages`

`GET /meta` returns roles, sources, statuses, stages and permissions for the screens.

`GET /health` reports whether MongoDB is connected, without revealing the URI.
