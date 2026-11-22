# CivicDesk Architecture

CivicDesk has three independent parts that demonstrate related complaint-management workflows:

- **C99 console application:** the primary implementation, with manually managed data structures and file persistence.
- **Browser dashboard:** a JavaScript companion for interactive demonstrations. It stores browser data in `localStorage` and is not connected to either backend.
- **Optional Node.js REST API:** a local HTTP service with JSON-file persistence. It exposes endpoints for complaint creation, listing, lookup and sequential status updates; it is not connected to the browser dashboard or C process.

This is an educational, single-user demonstration. It is not connected to a government service and should not be used with real personal data.

## High-level architecture

```mermaid
flowchart TB
    subgraph Console["C99 console application"]
        UI["main.c\nMenu and input/output"]
        SYS["grievance_system.c/.h\nSystem coordinator and ownership"]
        DATA["Complaint records\ncomplaint.c/.h"]
        AVL["AVL ID index\nbst.c/.h"]
        PQ["Priority queues\nqueues.c/.h"]
        HISTORY["Status histories\nstatus_list.c/.h"]
        UNDO["Undo stack\nundo_stack.c/.h"]
        SEARCH["Search and sorting\nsearch_sort.c/.h"]
        UTIL["Utilities and sample data\nutil.c/.h · sample_data.c/.h"]
        FILES[("CIVICDESK 1 text file")]
        UI --> SYS
        SYS --> DATA
        SYS --> AVL
        SYS --> PQ
        DATA --> HISTORY
        SYS --> UNDO
        SYS --> SEARCH
        SYS --> UTIL
        SYS <--> FILES
    end

    subgraph Browser["Browser companion"]
        PAGE["index.html\nHTML, CSS and JavaScript"]
        STATE["In-memory browser state"]
        STORE[("Browser localStorage")]
        PAGE --> STATE
        STATE <--> STORE
    end

    TESTS["Automated verification\nC tests · JavaScript tests · Playwright E2E"]
    TESTS -. verifies .-> SYS
    TESTS -. verifies .-> PAGE
    TESTS -. verifies .-> ROUTES
```

## C application responsibilities

| Module | Responsibility |
|---|---|
| `main.c` | Console menu, input handling and user-facing actions |
| `grievance_system.c/.h` | Coordinates the structures, owns the complaint collection, and handles save/load |
| `complaint.c/.h` | Complaint record, priority and department data |
| `bst.c/.h` | AVL tree index keyed by complaint ID |
| `queues.c/.h` | Three linked FIFO queues for Urgent, High and Normal |
| `status_list.c/.h` | Per-complaint singly linked status history |
| `undo_stack.c/.h` | Linked-list stack for reversing the latest status update |
| `search_sort.c/.h` | Linear and binary search, five sorting algorithms and benchmarks |
| `util.c/.h` | Allocation, string and date helpers |
| `sample_data.c/.h` | Demonstration records and benchmark data |

## How a complaint is represented

The system keeps a master collection of complaint records. The AVL tree indexes those records by ID; the waiting queues reference complaints that are awaiting processing; each complaint owns its own status history. The undo stack stores the information needed to reverse the most recent manual status change.

```mermaid
flowchart LR
    SYS["GrievanceSystem"] --> ALL["All complaints"]
    SYS --> AVL["AVL index\ncomplaint ID → record"]
    SYS --> QUEUES["PriorityQueueManager"]
    SYS --> STACK["UndoStack"]
    ALL --> RECORD["Complaint"]
    RECORD --> HISTORY["StatusHistory\nFiled → Assigned → In Progress → Resolved"]
    QUEUES --> U["Urgent FIFO"]
    QUEUES --> H["High FIFO"]
    QUEUES --> N["Normal FIFO"]
```

## Complaint lifecycle

```mermaid
flowchart TD
    A["File complaint"] --> B["Create complaint record"]
    B --> C["Insert into AVL index"]
    C --> D["Enqueue by priority"]
    D --> E["Process next complaint"]
    E --> F["Dequeue highest non-empty priority"]
    F --> G["Append Assigned status"]
    G --> H["Update status"]
    H --> I["Push previous/new status onto undo stack"]
    I --> J{"Undo requested?"}
    J -- Yes --> K["Pop undo record and remove latest status"]
    J -- No --> L["Continue tracking / resolve"]
    K --> H
    L --> M["Resolved status stops pending-day count"]
```

## Browser companion

The browser dashboard is a separate JavaScript implementation intended for quick demonstrations. It supports filing, processing, status updates, undo, search, sorting, dashboard metrics, import/export and persistence through `localStorage`. It does not call the C executable or the optional REST API, share their in-memory structures, or synchronize data with another user.

## Optional REST API backend

The API is a separate local service implemented with Node.js built-in `http` and filesystem modules; it adds no npm runtime dependencies. Start it from the repository root with `node api/server.cjs` (default address `http://127.0.0.1:4174`). Its JSON store is created at `api/data/complaints.json` on first write. The API enforces the same department, priority and basic name/area limits as the browser demo, limits request bodies to 16 KB, and only permits the next status in the complaint lifecycle. It is intentionally bound to loopback for local development and has no authentication; do not expose it to a public network or use real personal data.

## Persistence and data boundaries

- The C application saves and loads the documented `CIVICDESK 1` text format when the user selects the corresponding menu options.
- The browser companion stores its state in that browser's `localStorage`; browser data is separate from C save files until explicitly exported/imported.
- The optional API stores its own records in `api/data/complaints.json`; this is separate from both the C text file and browser `localStorage`.
- The sample names, areas and complaint details are fictional.
- No remote service, government database, multi-user authentication or synchronization between the three parts is part of this version.

## Verification

The repository includes:
- C unit/integration tests in `test_civicdesk.c`.
- Browser-side JavaScript tests in `tests/civicdesk.test.cjs`.
- REST API tests in `tests/api.test.cjs`.
- Chromium end-to-end tests in `tests/e2e/civicdesk.spec.cjs`.
- GitHub Actions jobs for C/JavaScript/API tests, AddressSanitizer + UndefinedBehaviorSanitizer, and Playwright browser tests.

See [TESTING.md](TESTING.md) for local commands and CI details.
