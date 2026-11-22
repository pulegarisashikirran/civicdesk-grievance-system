# CivicDesk — Portfolio and Interview Guide

Use this page as a source for your resume, GitHub profile, project demonstrations and technical interviews. Keep claims aligned with the code in this repository.

## 30-second project explanation

CivicDesk is a data-structures-based public grievance management demonstration. The C99 console application registers complaints, places them into priority-based FIFO queues, tracks status history, indexes complaint IDs with an AVL tree, supports searching and sorting, and saves/loads records. A JavaScript browser dashboard supports browser-local storage or an optional connection to a Node.js REST API. The API exposes complaint creation, listing, lookup and status transitions with SQLite persistence.

It is an educational project: the browser dashboard can use the local API when explicitly connected, while the C console remains independent. It does not connect to a government system.

## Resume-ready entry

**CivicDesk — Public Grievance Redressal System** | C99, Data Structures & Algorithms, JavaScript, HTML, CSS, Node.js REST API, Playwright, GitHub Actions

- Built a C99 complaint-management application using linked-list priority queues, an AVL-tree ID index, status-history lists and a linked-list undo stack.
- Implemented complaint processing, validation, save/load persistence, linear and binary search, and five sorting algorithms (bubble, selection, insertion, merge and quick sort).
- Created a JavaScript dashboard with complaint filing, status updates, search/sort, summary metrics and import/export, supporting browser localStorage or optional REST API mode.
- Added an optional Node.js REST API with validated complaint endpoints, sequential status transitions and transactional SQLite storage, versioned schema migrations, validated backup/restore and one-time migration from the previous JSON data file; the browser can connect to it while the C console remains independent.
- Added 76 automated checks: 39 C tests, 19 browser JavaScript tests, 15 API tests and 3 Playwright end-to-end scenarios; configured GitHub Actions for build, tests, browser/API integration and sanitizer checks.

**Tip:** Keep only the bullets that fit your resume and that you can confidently explain. Add the repository and live demo links beside the project title.

## Short GitHub / portfolio description

A C99 and JavaScript grievance-management demo with an optional Node.js REST API, featuring AVL indexing, priority queues, status history, undo, search/sort algorithms, persistence and automated testing.

## Technical highlights to explain

| Feature | Design choice | Interview point |
|---|---|---|
| Priority processing | Three linked FIFO queues | Priority is served first; FIFO order is preserved within each priority |
| Complaint ID lookup | AVL tree | Self-balancing keeps search/insert O(log n) in the worst case |
| Status tracking | Per-complaint linked list | Preserves the sequence of status changes |
| Undo | Linked-list stack | LIFO behavior reverses the latest supported update |
| Search | Linear, binary and AVL lookup | Binary search requires sorted data; AVL lookup uses the ID index |
| Sorting | Bubble, selection, insertion, merge and quick sort | Compare time complexity and stability |
| C persistence | CIVICDESK 1 text format | Validate input and avoid replacing a valid save with a partial write |
| Browser persistence | localStorage | Data belongs to that browser and is separate from C save files |
| REST API | Node.js built-in HTTP server and SQLite store | Exposes local complaint endpoints; versioned schema migrations and backup/recovery protect stored data |
| Verification | C, Node test runner, Playwright and CI | Tests cover logic, API behavior, browser behavior and memory-safety checks |

## Complexity reference

These are algorithmic expectations for the implemented approaches, not performance guarantees for every input.

| Operation / algorithm | Typical or worst-case time |
|---|---:|
| AVL search / insertion | O(log n) worst case |
| Linked queue enqueue / dequeue | O(1), with front and rear pointers |
| Linked stack push / pop | O(1) |
| Linear search | O(n) |
| Binary search | O(log n), on sorted data |
| Bubble / selection sort | O(n²) |
| Insertion sort | O(n²) worst case; O(n) best case |
| Merge sort | O(n log n) |
| Quick sort | O(n log n) average; O(n²) worst case |

## Demo flow for an interviewer

1. Open the browser demo and point out the dashboard summary.
2. File a sample complaint and show the total/waiting metrics update.
3. Process the next complaint to demonstrate priority handling.
4. Change a complaint status and demonstrate undo.
5. Refresh the page to show browser-local persistence.
6. Briefly show import/export and explain that this browser data is separate from the C application's save file.
7. Open the C source and point to the AVL implementation, priority queues and test suite.

Use fictional/sample data only during demonstrations.

## Interview questions to practise

**Why use an AVL tree?**  
Complaint IDs need efficient lookup. An AVL tree self-balances after insertion, so search and insertion remain O(log n) in the worst case, unlike an ordinary unbalanced BST.

**Why use three queues instead of one?**  
Each priority has its own FIFO queue. The processor checks the highest-priority non-empty queue first, preserving arrival order among complaints of equal priority.

**Why is the undo structure a stack?**  
Undo applies to the most recent supported update first, which matches last-in, first-out behavior.

**When is binary search valid?**  
Only when the searched data is ordered by the same key used by the search. Otherwise, use linear search or the AVL index.

**How did you test memory safety?**  
The GitHub Actions workflow builds the C test suite with AddressSanitizer and UndefinedBehaviorSanitizer and runs it on a Linux runner. The Windows local test run verifies the normal C suite; do not claim that the Windows sanitizer build passed.

**Does the browser dashboard use the C backend?**  
No. It is a separate JavaScript companion with its own browser state and localStorage. The two interfaces demonstrate similar concepts but do not synchronize or share a running backend.

## Honest limitations and possible future work

- No authentication, roles, or multi-user access.
- No remote database, API, or government-system integration.
- Browser data is local to the browser; it is not synchronized with the C application.
- The project uses sample data and is not intended for real citizens' personal information.
- A future full-stack version could add a documented API, authentication, role-based access, deployment and integration tests.

## Before an interview

- Pull the latest development branch and run all three local test commands from [Testing and CI](TESTING.md).
- Be ready to explain one data structure from its C implementation, not just its definition.
- Practise the 30-second explanation and the demo flow.
- Know the difference between the C save file and browser localStorage.
- Never claim the app is deployed as a government service or supports real users.
