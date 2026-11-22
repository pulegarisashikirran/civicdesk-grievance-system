# Performance and Scalability

CivicDesk has two different benchmark paths:

- The existing menu benchmark compares five sorting algorithms and three search methods on fixed datasets.
- The standalone scalability benchmark isolates AVL insertion/search and priority-queue enqueue/dequeue at larger record counts.

## Run the scalability benchmark (Windows PowerShell)

From the repository root:

```powershell
gcc -std=c99 -Wall -Wextra -pedantic -O2 -o scalability_benchmark.exe tools/scalability_benchmark.c util.c status_list.c complaint.c bst.c queues.c undo_stack.c search_sort.c sample_data.c grievance_system.c
.\scalability_benchmark.exe
```

Linux/macOS:

```bash
gcc -std=c99 -Wall -Wextra -pedantic -O2 -o scalability_benchmark tools/scalability_benchmark.c util.c status_list.c complaint.c bst.c queues.c undo_stack.c search_sort.c sample_data.c grievance_system.c
./scalability_benchmark
```

## Workload and measurements

The benchmark runs datasets of **1,000, 10,000 and 50,000 complaints**. Each dataset is measured three times using deterministic generated inputs; the median is reported.

| Measurement | What is timed |
|---|---|
| AVL insert | Insert all generated complaints into the self-balancing AVL index |
| AVL search | Successful ID lookups, five per complaint, capped at 250,000 lookups |
| Queue add | Enqueue all complaints into the three-level priority queue manager |
| Queue drain | Dequeue every complaint using Urgent → High → Normal priority order |
| AVL height | Height after all records have been inserted |
| Estimated bytes | Structural lower-bound estimate for the complaint, initial status node, AVL node, queue node and pointer-array slot per record |

The program validates each insertion, lookup and queue operation. It also checks final data-structure counts. A failed operation terminates the benchmark rather than publishing misleading timings.

## Interpreting results

- AVL insertion and lookup should scale logarithmically per operation because the tree maintains its balance invariant.
- Each linked-queue enqueue is O(1). Dequeue from the priority manager checks at most three fixed priority queues, so it is also O(1) with respect to the number of complaints.
- The estimated byte count is **not** process memory/RSS. It excludes allocator metadata, alignment overhead, temporary benchmark arrays and any additional status-history nodes created after filing.
- Timings use the C `clock()` CPU-time timer. Results vary by CPU, compiler, optimization flags and system load. Compare runs on the same machine and build configuration; do not treat a single machine's values as universal performance guarantees.

## Existing sorting benchmark

The menu's sorting benchmark remains limited to 1,000, 5,000 and 10,000 items because Bubble, Selection and Insertion Sort have O(n²) worst-case time. Use the scalability tool for larger AVL and queue workloads rather than running quadratic sorts on 50,000 records.
