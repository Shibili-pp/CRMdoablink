# DoablinkOrbit

Sales CRM and business operating system for **DOABLINK PRIVATE LIMITED**.

The web app is a React client. The API is Node.js, Express and MongoDB. Call logs are not read by the browser. A separate Android starter posts them to the device API.

## Requirements

- Node.js 20
- MongoDB 7 locally, or a MongoDB Atlas database
- Optional: Docker, for the local database in `docker-compose.yml`

## Setup

```bash
npm install
npm run install:all
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env.development
```

Edit `backend/.env` and set `MONGODB_URI`. Do not commit that file. For Atlas, use the cluster connection string and allow your IP. The API never sends the URI to the browser.

Local MongoDB:

```bash
docker compose up -d
```

The example URI is `mongodb://127.0.0.1:27017/doablinkorbit`.

## Run

```bash
npm run dev
```

- API: http://localhost:5000
- Web: http://localhost:5173
- OpenAPI: http://localhost:5000/api/docs

On first development start, `SEED_DEMO=true` creates demo users and sample leads. It refuses to run when `NODE_ENV=production`.

Demo passwords are `1234567`. The login screen shows them only when `VITE_ENABLE_DEMO_LOGIN=true`. A production build must set that flag to `false`.

| Role | Username |
| --- | --- |
| Owner | owner |
| Super admin | superadmin |
| Admin | admin |
| Team leader | teamleader |
| Staff | staff |

Reset demo records:

```bash
npm run seed:reset
```

## Tests

```bash
npm test
```

Backend tests use an in-memory MongoDB. They cover sign-in, permissions, import, assignment conflicts, Android sync, revenue separation, hourly totals and PDF/Excel export.

## Deployment

1. Set `NODE_ENV=production`.
2. Set long random `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.
3. Set `MONGODB_URI` to Atlas. Prefer Atlas backups, or an M10+ cluster with continuous backup.
4. Set `CLIENT_URL` to the web origin and `TRUST_PROXY=true` behind a proxy.
5. Build the web app with `VITE_ENABLE_DEMO_LOGIN=false`.
6. Serve `frontend/dist` from your host, or set `SERVE_FRONTEND=true` so the API serves it.
7. Start with `npm start --prefix backend`.

Backup command, when MongoDB Database Tools are installed:

```bash
npm run backup --prefix backend
```

Dumps go to `backups/`, which is gitignored.

## Android

See `android/README.md`. Register a device from the signed-in staff account, store the one-time device token, and sync with that token. The server will not accept call logs for another staff member.

Push notifications need `FIREBASE_SERVICE_ACCOUNT_PATH`. Until that file exists, alerts are in-app and over Socket.IO only.

## Security notes

- Passwords are bcrypt hashes.
- Access tokens expire. Refresh tokens rotate and are stored hashed.
- Demo users cannot sign in when `NODE_ENV=production`.
- Permissions are checked on the API, not only in the menu.
- Recording audio is not stored. Opening a recording reference writes an audit log.
