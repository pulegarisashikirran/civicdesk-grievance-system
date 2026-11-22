/*
 * tools/scalability_benchmark.c
 *
 * Repeatable AVL + priority-queue scalability benchmark.
 * Measures insertion, lookup, enqueue and dequeue independently.
 * Timings are medians of three runs; no machine-specific thresholds are asserted.
 */
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

#include "../bst.h"
#include "../queues.h"
#include "../sample_data.h"
#include "../status_list.h"

#define RUNS 3
#define LOOKUPS_PER_ITEM 5
#define MAX_LOOKUPS 250000

typedef struct {
    double avl_insert_ms;
    double avl_search_ms;
    double queue_enqueue_ms;
    double queue_dequeue_ms;
    int height;
} Measurements;

static double elapsed_ms(clock_t start)
{
    return (double)(clock() - start) * 1000.0 / CLOCKS_PER_SEC;
}

static double median(double values[RUNS])
{
    int i, j;
    for (i = 1; i < RUNS; i++) {
        double value = values[i];
        j = i - 1;
        while (j >= 0 && values[j] > value) {
            values[j + 1] = values[j];
            j--;
        }
        values[j + 1] = value;
    }
    return values[RUNS / 2];
}

static Measurements run_once(int n, int seed)
{
    Measurements result;
    Complaint **items = generate_random_complaints(n, seed);
    ComplaintBST tree;
    PriorityQueueManager queues;
    clock_t start;
    int i, lookups = n * LOOKUPS_PER_ITEM;

    if (lookups > MAX_LOOKUPS)
        lookups = MAX_LOOKUPS;

    bst_init(&tree);
    pqm_init(&queues);

    start = clock();
    for (i = 0; i < n; i++)
        if (!bst_insert(&tree, items[i])) {
            fprintf(stderr, "AVL insertion failed at item %d\n", i);
            exit(EXIT_FAILURE);
        }
    result.avl_insert_ms = elapsed_ms(start);

    start = clock();
    for (i = 0; i < lookups; i++) {
        int index = (i * 37) % n;
        if (bst_search(&tree, items[index]->cid) != items[index]) {
            fprintf(stderr, "AVL lookup failed at item %d\n", index);
            exit(EXIT_FAILURE);
        }
    }
    result.avl_search_ms = elapsed_ms(start);
    result.height = bst_height(&tree);

    start = clock();
    for (i = 0; i < n; i++)
        if (!pqm_enqueue(&queues, items[i])) {
            fprintf(stderr, "Queue enqueue failed at item %d\n", i);
            exit(EXIT_FAILURE);
        }
    result.queue_enqueue_ms = elapsed_ms(start);

    start = clock();
    for (i = 0; i < n; i++)
        if (pqm_dequeue_next(&queues) == NULL) {
            fprintf(stderr, "Queue became empty before item %d\n", i);
            exit(EXIT_FAILURE);
        }
    result.queue_dequeue_ms = elapsed_ms(start);

    if (pqm_total(&queues) != 0 || tree.size != n) {
        fprintf(stderr, "Data structure count mismatch\n");
        exit(EXIT_FAILURE);
    }

    pqm_free(&queues);
    bst_free(&tree);
    free_complaints(items, n);
    return result;
}

int main(void)
{
    static const int sizes[] = {1000, 10000, 50000};
    int s, run;

    puts("CivicDesk scalability benchmark");
    puts("Median of 3 runs; CPU time in milliseconds; generated deterministic data.");
    puts("Lookups: 5 per complaint, capped at 250000.");
    puts("");
    printf("%-10s %-12s %-12s %-12s %-12s %-10s %-14s\n",
           "Complaints", "AVL insert", "AVL search", "Queue add",
           "Queue drain", "AVL height", "Est. bytes");
    printf("--------------------------------------------------------------------------------\n");

    for (s = 0; s < 3; s++) {
        int n = sizes[s];
        double insert[RUNS], search[RUNS], enqueue[RUNS], dequeue[RUNS];
        int height = 0;
        size_t estimate = (size_t)n *
            (sizeof(Complaint) + sizeof(StatusNode) + sizeof(BSTNode) +
             sizeof(QueueNode) + sizeof(Complaint *));

        for (run = 0; run < RUNS; run++) {
            Measurements m = run_once(n, 2026 + run);
            insert[run] = m.avl_insert_ms;
            search[run] = m.avl_search_ms;
            enqueue[run] = m.queue_enqueue_ms;
            dequeue[run] = m.queue_dequeue_ms;
            height = m.height;
        }

        printf("%-10d %-12.2f %-12.2f %-12.2f %-12.2f %-10d %zu\n",
               n, median(insert), median(search), median(enqueue),
               median(dequeue), height, estimate);
    }

    puts("");
    puts("Estimated bytes are a structural lower-bound estimate, not measured RSS.");
    puts("They include Complaint, one initial StatusNode, AVL node, queue node,");
    puts("and one pointer-array slot per record; allocator overhead is excluded.");
    puts("Search timing excludes tree construction; queue timings exclude complaint creation.");
    return EXIT_SUCCESS;
}
