# CivicDesk REST API

The optional API is a local development service built with Node.js built-in modules. It does not require Express or any other runtime package.

## Start the server

From the repository root:

~~~powershell
node api/server.cjs
~~~

The server listens on http://127.0.0.1:4174 by default. Set PORT to use another available port. It also serves the browser dashboard at `http://127.0.0.1:4174/`, so the page and API share the same origin.

The first write creates api/data/complaints.json. That local data directory is ignored by Git. To use a different data file, set CIVICDESK_API_DATA before starting the server.

## Connect the browser dashboard

1. Start the API with `node api/server.cjs`.
2. Open `http://127.0.0.1:4174/` (do not open `index.html` directly or use the GitHub Pages URL for this local connection).
3. Select **Connect API** in the top navigation. The dashboard loads API complaints and switches its filing, processing, status updates, tracking and metrics to the server-backed data.
4. Select **Use browser storage** to return to the localStorage demo.

When connected, the dashboard refreshes its data from the API after each supported mutation. The API currently has no undo endpoint, so Undo is disabled in API mode. Browser-storage mode retains its existing undo, import/export and sample-data behavior. The GitHub Pages demo remains browser-storage based; the local API is not deployed publicly.

## Endpoints

All request and response bodies use JSON.

| Method | Endpoint | Purpose | Success |
|---|---|---|---|
| GET | /api/health | Check service availability | 200 |
| GET | /api/complaints | List complaints, ordered by ID | 200 |
| POST | /api/complaints | Create a complaint | 201 |
| GET | /api/complaints/:id | Retrieve one complaint | 200 |
| PATCH | /api/complaints/:id/status | Advance one status step | 200 |

### Create a complaint

PowerShell example:

~~~powershell
$body = @{ name = "Asha"; area = "Madhapur"; department = "Roads"; priority = "Urgent" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4174/api/complaints -ContentType "application/json" -Body $body
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
Invoke-RestMethod -Method Patch -Uri http://127.0.0.1:4174/api/complaints/1000/status -ContentType "application/json" -Body $body
~~~

Each successful transition appends a timestamped history entry.

## Validation and error responses

- Citizen name and area are required and limited to 31 characters.
- Department and priority must match the allowed values.
- Remarks are optional and limited to 63 characters.
- JSON request bodies are limited to 16 KB.
- Invalid JSON returns 400; unsupported content type returns 415; oversized requests return 413.
- Missing complaints return 404; invalid status transitions return 409.
- The service returns JSON error objects, for example: { "error": "Complaint not found." }.

## Persistence and scope

The API writes a versioned JSON document through a temporary file and rename, and serializes mutations within the running process. Its records are independent from the C CIVICDESK 1 file and browser localStorage. The locally served dashboard can read and mutate API records while API mode is enabled; the hosted GitHub Pages dashboard continues to use browser localStorage.

This is a local educational API, bound to 127.0.0.1. It has no authentication, authorization, production-grade multi-process locking, or network deployment configuration. Do not expose it publicly or submit real personal information. The API is integrated with the locally served browser dashboard; the C executable remains independent.
