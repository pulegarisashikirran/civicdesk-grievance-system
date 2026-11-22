# Testing and Continuous Integration

CivicDesk uses four automated test suites. Run the C, JavaScript and REST API suites for fast feedback, then use Playwright to exercise the browser interface in Chromium.

## Test layers

| Layer | Test file / command | What it checks |
|---|---|---|
| C | `test_civicdesk.c` | Data structures, priority behavior, AVL rotations and randomized AVL and sorting stress checks, a 10,000-complaint system integration stress test, queue reuse after draining and oversized-file rejection, search/sort logic, undo, validation and file persistence |
| Browser JavaScript | `tests/civicdesk.test.cjs` | Browser-side structures and algorithms, dashboard metrics, validation and accessibility helpers |
| REST API | `tests/api.test.cjs` | HTTP routes, input validation, status lifecycle, SQLite schema and persistence, legacy JSON migration, schema-version upgrades, SQLite backup/restore, origin/Host protections, write rate limiting, strict field validation, registration/login/logout, password hashing, session revocation, citizen ownership, officer assignment boundaries, admin assignment controls, concurrent ID allocation, malformed and oversized requests |
| Browser end-to-end | `tests/e2e/civicdesk.spec.cjs` | Real dashboard workflows, metric changes, refresh persistence, import/export, and authenticated citizen registration, role-aware dashboard controls and dashboard-to-REST-API persistence |

The current repository documents **39 C tests, 19 browser JavaScript tests, 24 REST API tests and 3 Playwright end-to-end scenarios (85 total)**. CI runs the suites on pushes and pull requests.

## C tests (Windows PowerShell)

From the repository root:

```powershell
gcc -std=c99 -Wall -Wextra -pedantic -O2 -o test_civicdesk.exe test_civicdesk.c util.c status_list.c complaint.c bst.c queues.c undo_stack.c search_sort.c sample_data.c grievance_system.c
.\test_civicdesk.exe
```

## JavaScript unit tests

Node.js 22.5 or newer is required for the built-in `node:sqlite` module:

```powershell
node --test tests/civicdesk.test.cjs tests/api.test.cjs
```

## Start the optional REST API

From the repository root, run this in a separate PowerShell window:

```powershell
node api/server.cjs
```

The local service listens at `http://127.0.0.1:4174`. Quick health check:

```powershell
Invoke-RestMethod http://127.0.0.1:4174/api/health
```

The API stores its data in the ignored SQLite database `api/data/civicdesk.sqlite`. If the earlier `api/data/complaints.json` file exists and the database does not, it is migrated on first startup. See [API.md](API.md) for details, example requests and database backup/restore commands. The API also serves the browser dashboard from the same origin. Selecting **Connect API** switches dashboard complaint operations to the REST backend; the C console remains independent.

## Playwright browser tests (Windows PowerShell)

Install the test dependency and Chromium once:

```powershell
npm.cmd install --no-save @playwright/test
npx.cmd playwright install chromium
```

Run the browser suite:

```powershell
npx.cmd playwright test
```

The `.cmd` launchers work around PowerShell environments that block the `.ps1` wrappers. They do not require changing the machine's execution policy.

On macOS/Linux or in a shell where the standard npm launchers are available, use `npm` and `npx` instead.

## GitHub Actions

Workflow: [`.github/workflows/c-ci.yml`](../.github/workflows/c-ci.yml)

The workflow has three independent jobs:

1. **Build and test:** compiles the C test suite and application, then runs C, browser JavaScript and REST API tests.
2. **Memory safety:** builds and runs the full C test suite—including the 10,000-complaint stress case—with AddressSanitizer and UndefinedBehaviorSanitizer.
3. **Browser end-to-end:** installs Playwright and Chromium, then runs the browser workflows.

A passing CI run verifies the checked-in revision on the GitHub runner. Local test results should still be run after pulling changes to verify the developer's own environment.
