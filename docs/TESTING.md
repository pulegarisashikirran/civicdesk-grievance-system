# Testing and Continuous Integration

CivicDesk uses three layers of automated checks. Run the C and JavaScript suites for fast feedback, then use Playwright to exercise the browser interface in Chromium.

## Test layers

| Layer | Test file / command | What it checks |
|---|---|---|
| C | `test_civicdesk.c` | Data structures, priority behavior, AVL rotations and randomized invariant stress checks, search/sort logic, undo, validation and file persistence |
| JavaScript | `tests/civicdesk.test.cjs` | Browser-side structures and algorithms, dashboard metrics, validation and accessibility helpers |
| Browser end-to-end | `tests/e2e/civicdesk.spec.cjs` | Real dashboard workflows, metric changes, refresh persistence, import and export |

The current repository documents **35 C tests, 19 JavaScript tests and 2 Playwright end-to-end scenarios**. CI runs the suites on pushes and pull requests.

## C tests (Windows PowerShell)

From the repository root:

```powershell
gcc -std=c99 -Wall -Wextra -pedantic -O2 -o test_civicdesk.exe test_civicdesk.c util.c status_list.c complaint.c bst.c queues.c undo_stack.c search_sort.c sample_data.c grievance_system.c
.\test_civicdesk.exe
```

## JavaScript unit tests

Node.js 22 or a compatible recent Node.js release is recommended:

```powershell
node --test tests/civicdesk.test.cjs
```

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

1. **Build and test:** compiles the C test suite and application, runs C tests and JavaScript tests.
2. **Memory safety:** builds and runs the C test suite with AddressSanitizer and UndefinedBehaviorSanitizer.
3. **Browser end-to-end:** installs Playwright and Chromium, then runs the browser workflows.

A passing CI run verifies the checked-in revision on the GitHub runner. Local test results should still be run after pulling changes to verify the developer's own environment.
