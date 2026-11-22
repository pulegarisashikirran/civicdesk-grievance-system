# CivicDesk REST API

The optional API is a local development service built with Node.js built-in modules, including the built-in `node:sqlite` module. It requires Node.js 22.5 or newer and does not require Express or any other runtime package.

## Start the server

From the repository root:

~~~powershell
$env:CIVICDESK_ADMIN_EMAIL = "admin@example.test"
$env:CIVICDESK_ADMIN_PASSWORD = "Use-A-Unique-Password-123"
node api/server.cjs
~~~

The server listens on http://127.0.0.1:4174 by default. Set PORT to use another available port. It also serves the browser dashboard at `http://127.0.0.1:4174/`, so the page and API share the same origin.

The API creates `api/data/civicdesk.sqlite`; the local data directory is ignored by Git. On first startup, if the new database does not exist but the previous `api/data/complaints.json` file does, CivicDesk validates and imports its records and full status histories into SQLite. The original JSON file is left unchanged. To use a different SQLite database file, set `CIVICDESK_API_DATA` before starting the server.

## Connect the browser dashboard

1. Start the API with `node api/server.cjs`.
2. Open `http://127.0.0.1:4174/` (do not open `index.html` directly or use the GitHub Pages URL for this local connection).
3. Register a citizen account or sign in using the **API account** panel. The dashboard restores an active session after refresh.
4. Select **Connect API** in the top navigation. The dashboard loads only the complaints visible to that account and enables controls allowed by its role.
5. Select **Use browser storage** to return to the localStorage demo.

When connected, the dashboard refreshes its data from the API after each supported mutation. The API currently has no undo endpoint, so Undo is disabled in API mode. Browser-storage mode retains its existing undo, import/export and sample-data behavior. The GitHub Pages demo remains browser-storage based; the local API is not deployed publicly.

## Reset a local administrator password

If the initial administrator password is lost, stop the API server and run this local maintenance utility from the repository root:

~~~powershell
node api/reset-admin-password.cjs
~~~

Enter the existing administrator email, then enter and confirm a new password when prompted. Password input is hidden. The utility only updates the matching active administrator's salted password hash, revokes that administrator's existing sessions, and leaves all complaints and other accounts unchanged. It uses `CIVICDESK_API_DATA` when set, otherwise `api/data/civicdesk.sqlite`. Run it only on a trusted local machine; do not commit database files or share the new password.

## Authentication and roles

The API requires a signed-in session for complaint and account-management routes. Public registration creates **citizen** accounts only. Passwords are salted and hashed with Node.js `crypto.scrypt`; plaintext passwords are never stored. Login creates a random session token whose SHA-256 hash is stored in SQLite. The browser receives the token in an `HttpOnly`, `SameSite=Strict` cookie with an eight-hour lifetime. Logout revokes the server-side session. Deactivating a user revokes all of that user's sessions.

On first startup, configure the initial administrator using `CIVICDESK_ADMIN_EMAIL` and `CIVICDESK_ADMIN_PASSWORD` as shown above. The bootstrap creates an administrator only when no administrator account exists. Keep these credentials private and use a strong unique password. Administrators can create officer/admin accounts and deactivate accounts through the user-management routes. Public registration cannot select a role.

| Role | Permissions |
|---|---|
| Citizen | File complaints and list/view only complaints they submitted. Cannot advance status. |
| Officer | View and advance only complaints assigned to their account. Cannot manage users or other officers' complaints. |
| Admin | View all complaints, file complaints, manage users and create staff accounts. |

The schema adds `users`, `user_sessions`, `complaint_owners` and a nullable `complaints.assigned_to` officer reference. Existing complaints remain unassigned after migration; citizens cannot view them, officers see only their assigned complaints, and admins can view all complaints and assign/unassign officers. When opened from the local API server (`http://127.0.0.1:4174/`), the dashboard shows an account panel for citizen registration, sign-in and sign-out. A valid session is restored after refresh. The GitHub Pages demo continues to use browser storage and does not expose the local API account panel.

## Authentication endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Register a citizen (`email`, `password`) and start a session |
| POST | `/api/auth/login` | Start a session |
| POST | `/api/auth/logout` | Revoke current session |
| GET | `/api/auth/me` | Return current account |
| GET | `/api/users` | Admin: list accounts |
| POST | `/api/users` | Admin: create officer/admin account |
| PATCH | `/api/users/:id/active` | Admin: activate/deactivate account |
| PATCH | `/api/complaints/:id/assignment` | Admin: assign an active officer or pass `null` to unassign |

Passwords must be 12–128 characters and include lowercase, uppercase and a number. Registration accepts no role field. The server uses generic login errors to avoid revealing whether an email exists.

## Endpoints

All request and response bodies use JSON.

| Method | Endpoint | Purpose | Success |
|---|---|---|---|
| GET | /api/health | Check service availability | 200 |
| GET | /api/complaints | List complaints, ordered by ID | 200 |
| POST | /api/complaints | Create a complaint | 201 |
| GET | /api/complaints/:id | Retrieve one complaint | 200 |
| PATCH | /api/complaints/:id/status | Officer (assigned only) or admin: advance one status step | 200 |
| PATCH | /api/complaints/:id/assignment | Admin: assign/unassign an officer | 200 |

### Create a complaint

PowerShell example (sign in as the bootstrapped administrator first):

~~~powershell
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = @{ email = $env:CIVICDESK_ADMIN_EMAIL; password = $env:CIVICDESK_ADMIN_PASSWORD } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4174/api/auth/login -ContentType "application/json" -Body $login -WebSession $session

$body = @{ name = "Asha"; area = "Madhapur"; department = "Roads"; priority = "Urgent" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4174/api/complaints -ContentType "application/json" -Body $body -WebSession $session
~~~

Allowed departments: Water Supply, Electricity, Roads, Sanitation, Street Lights.

Allowed priorities: Urgent, High, Normal.

The server assigns an increasing numeric complaint ID and starts each record at Filed.

### Advance a complaint status

Status transitions are sequential and cannot be skipped:

**Filed → Assigned → In Progress → Resolved**

Example:

~~~powershell
$body = @{ status = "Assigned"; remarks = "Assigned to Roads team" } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri http://127.0.0.1:4174/api/complaints/1000/status -ContentType "application/json" -Body $body -WebSession $session
~~~

Each successful transition appends a timestamped history entry.

## Validation and error responses

- Citizen name and area are required and limited to 31 characters.
- Department and priority must match the allowed values.
- Remarks are optional and limited to 63 characters.
- JSON request bodies are limited to 16 KB.
- Invalid JSON returns 400; unsupported content type returns 415; oversized requests return 413.
- Missing complaints return 404; invalid status transitions return 409.
- The service returns JSON error objects, for example: { "error": "Complaint not found." }. Cross-origin requests are rejected with 403, untrusted Host headers with 421, and excess write requests with 429 and a `Retry-After` header.

## API security and request protections

The local server binds to `127.0.0.1` and validates the request Host against the loopback host and listening port to reduce DNS-rebinding exposure. Browser requests carrying an Origin header must match the request host, and requests marked `Sec-Fetch-Site: cross-site` are rejected. The server does not enable CORS. Write operations are rate-limited per remote address (60 requests per 60 seconds by default); read-only requests are not counted. Responses include content-sniffing, framing, referrer, permissions, cross-origin and cache-control protections. Request headers are capped at 8 KB, request URLs at 2 KB, and JSON bodies at 16 KB. JSON must be valid UTF-8 and use the application/json content type. Unknown request fields and control characters in text fields are rejected.

These measures are defense-in-depth for a local educational service, not a substitute for authentication, authorization, TLS, or production deployment hardening. Do not expose this service to an untrusted network or treat it as a production citizen-data system.

## Database maintenance: migrations, backup and restore

CivicDesk tracks its SQLite schema with `PRAGMA user_version`. New databases are created at schema version 1 and migrated transactionally through version 4: version 2 adds complaint indexes, version 3 adds users/sessions/citizen ownership, and version 4 adds officer assignment. Databases with a newer unsupported schema version are rejected rather than silently downgraded.

Run maintenance commands from the repository root. Stop the API server before restoring:

~~~powershell
# Create a timestamped backup under api/data/backups
node api/maintenance.cjs backup

# Or choose an explicit backup filename
node api/maintenance.cjs backup .\\my-civicdesk-backup.sqlite

# Restore a validated backup (stop the API server first)
node api/maintenance.cjs restore .\\my-civicdesk-backup.sqlite
~~~

Backups use SQLite `VACUUM INTO` to create a consistent standalone database. Restore validates SQLite integrity, schema version, required tables and foreign-key consistency before replacing the live file. If a live database exists, CivicDesk first creates a timestamped `.pre-restore-...sqlite` safety backup. Invalid backups are rejected without replacing the live database. Keep backup files private and store copies outside the project folder for disaster recovery.

## Persistence and scope

The API stores complaints and assignments in SQLite tables: `complaints`, `complaint_history`, `app_metadata`, `users`, `user_sessions` and `complaint_owners`. Primary keys, check constraints and a foreign key protect the record structure. Complaint creation and status changes use database transactions, so the complaint row and its history entry are committed together. Existing JSON data is migrated once when the SQLite database is first created. Its records remain independent from the C CIVICDESK 1 file and browser localStorage. The locally served dashboard restores authenticated sessions, limits visible controls by role and can read/mutate records within the signed-in user's permissions; the hosted GitHub Pages dashboard continues to use browser localStorage.

This is a local educational API, bound to 127.0.0.1. Authentication and role authorization are implemented, but the service is not a production-grade citizen-data system and has no TLS/network deployment configuration. Do not expose it publicly or submit real personal information. The API is integrated with the locally served browser dashboard; the C executable remains independent.
