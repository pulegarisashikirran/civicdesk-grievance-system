/*
 * test_civicdesk.c
 * Automated checks for the data structures, algorithms and system rules.
 * Build and run:  make test     (or see the README for the gcc command)
 */

#include <stdio.h>
#include <stdlib.h>
#include <limits.h>
#include <string.h>

#include "grievance_system.h"
#include "sample_data.h"
#include "search_sort.h"
#include "util.h"

static int tests_run = 0;
static int tests_failed = 0;

#define CHECK(cond)                                                              \
    do {                                                                         \
        if (!(cond)) {                                                           \
            printf("    FAILED: %s (line %d)\n", #cond, __LINE__);               \
            failed_here = 1;                                                     \
        }                                                                        \
    } while (0)

#define RUN(test)                                                                \
    do {                                                                         \
        int failed_here = 0;                                                     \
        int *flag = &failed_here;                                                \
        (void)flag;                                                              \
        printf("  %-58s", #test);                                                \
        failed_here = test();                                                    \
        tests_run++;                                                             \
        if (failed_here) { tests_failed++; printf("FAIL\n"); }                   \
        else printf("ok\n");                                                     \
    } while (0)

static void load_into(GrievanceSystem *sys)
{
    int n, i;
    Complaint **samples = load_sample_complaints(&n);
    system_init(sys);
    for (i = 0; i < n; i++)
        system_add_complaint(sys, samples[i]);
    free(samples);
}

/* True if both arrays hold equivalent complaints under cmp (same order of keys). */
static int same_order(Complaint **a, Complaint **b, int n, CmpFn cmp)
{
    int i;
    for (i = 0; i < n; i++)
        if (cmp(a[i], b[i]) != 0)
            return 0;
    return 1;
}

/* ------------------------------------------------------------- sorting */
static int test_all_sorts_match_reference(void)
{
    static const int sizes[] = {0, 1, 2, 50, 400};
    int failed_here = 0, s, k, a;
    for (s = 0; s < 5; s++) {
        int n = sizes[s];
        Complaint **data = generate_random_complaints(n, 1);
        for (k = 0; k < SORT_KEY_COUNT; k++) {
            Complaint **reference = copy_array(data, n);
            insertion_sort(reference, n, SORT_KEY_COMPARATORS[k]);   /* simple reference sort */
            for (a = 0; a < SORT_ALGORITHM_COUNT; a++) {
                Complaint **work = copy_array(data, n);
                SORT_FUNCTIONS[a](work, n, SORT_KEY_COMPARATORS[k]);
                CHECK(same_order(work, reference, n, SORT_KEY_COMPARATORS[k]));
                free(work);
            }
            free(reference);
        }
        free_complaints(data, n);
    }
    return failed_here;
}

static int test_sorts_handle_many_deterministic_random_inputs(void)
{
    static const int sizes[] = {3, 17, 64, 127, 256};
    int failed_here = 0, s, seed, key, algorithm;

    for (s = 0; s < 5; s++) {
        int n = sizes[s];
        for (seed = 1; seed <= 5; seed++) {
            Complaint **data = generate_random_complaints(n, seed * 101 + s);
            for (key = 0; key < SORT_KEY_COUNT; key++) {
                Complaint **reference = copy_array(data, n);
                insertion_sort(reference, n, SORT_KEY_COMPARATORS[key]);

                for (algorithm = 0; algorithm < SORT_ALGORITHM_COUNT; algorithm++) {
                    Complaint **work = copy_array(data, n);
                    int i, j;

                    SORT_FUNCTIONS[algorithm](work, n, SORT_KEY_COMPARATORS[key]);
                    CHECK(same_order(work, reference, n, SORT_KEY_COMPARATORS[key]));

                    /* Sorting must preserve every original pointer exactly once. */
                    for (i = 0; i < n; i++) {
                        int occurrences = 0;
                        for (j = 0; j < n; j++)
                            if (work[j] == data[i])
                                occurrences++;
                        CHECK(occurrences == 1);
                    }
                    free(work);
                }
                free(reference);
            }
            free_complaints(data, n);
        }
    }
    return failed_here;
}

static int test_quick_sort_on_sorted_and_reversed_input(void)
{
    int failed_here = 0, i, n = 2000;
    Complaint **data = generate_random_complaints(n, 3);
    Complaint **work = copy_array(data, n);
    quick_sort(work, n, cmp_id);
    for (i = 1; i < n; i++)
        CHECK(work[i - 1]->cid < work[i]->cid);
    quick_sort(work, n, cmp_id);                                  /* already sorted */
    for (i = 1; i < n; i++)
        CHECK(work[i - 1]->cid < work[i]->cid);
    for (i = 0; i < n / 2; i++) {                                 /* reverse it */
        Complaint *t = work[i];
        work[i] = work[n - 1 - i];
        work[n - 1 - i] = t;
    }
    quick_sort(work, n, cmp_id);
    for (i = 1; i < n; i++)
        CHECK(work[i - 1]->cid < work[i]->cid);
    free(work);
    free_complaints(data, n);
    return failed_here;
}

static int test_merge_sort_is_stable(void)
{
    int failed_here = 0, i, n = 300;
    Complaint **data = generate_random_complaints(n, 9);
    Complaint **work = copy_array(data, n);
    merge_sort(work, n, cmp_id);                                  /* order by ID first */
    merge_sort(work, n, cmp_priority);                            /* then by priority  */
    for (i = 1; i < n; i++)                                       /* equal priority -> IDs still ascending */
        if (work[i - 1]->priority == work[i]->priority)
            CHECK(work[i - 1]->cid < work[i]->cid);
    free(work);
    free_complaints(data, n);
    return failed_here;
}

/* ----------------------------------------------------------- searching */
static int test_bst_and_binary_search_find_every_complaint(void)
{
    GrievanceSystem sys;
    int failed_here = 0, i, n;
    Complaint **sorted;

    load_into(&sys);
    sorted = bst_inorder(&sys.bst, &n);
    CHECK(n == sys.count);
    for (i = 1; i < n; i++)
        CHECK(sorted[i - 1]->cid < sorted[i]->cid);
    for (i = 0; i < sys.count; i++) {
        CHECK(bst_search(&sys.bst, sys.all[i]->cid) == sys.all[i]);
        CHECK(binary_search(sorted, n, sys.all[i]->cid) == sys.all[i]);
    }
    free(sorted);
    system_free(&sys);
    return failed_here;
}

static int test_missing_id_returns_null(void)
{
    GrievanceSystem sys;
    int failed_here = 0, n;
    Complaint **sorted;
    load_into(&sys);
    sorted = bst_inorder(&sys.bst, &n);
    CHECK(bst_search(&sys.bst, 1) == NULL);
    CHECK(binary_search(sorted, n, 1) == NULL);
    free(sorted);
    system_free(&sys);
    return failed_here;
}

static int test_linear_search_by_area(void)
{
    GrievanceSystem sys;
    int failed_here = 0, found;
    Complaint **out;
    load_into(&sys);
    out = xmalloc((size_t)sys.count * sizeof(Complaint *));
    found = linear_search(sys.all, sys.count, match_area, "uppal", out);   /* case-insensitive */
    CHECK(found == 2);
    CHECK(out[0]->cid == 9036 && out[1]->cid == 8203);
    found = linear_search(sys.all, sys.count, match_name, "ANI", out);
    CHECK(found == 1 && out[0]->cid == 1307);
    free(out);
    system_free(&sys);
    return failed_here;
}

/* ----------------------------------------------------------------- BST */
static int test_duplicate_id_rejected(void)
{
    ComplaintBST tree;
    Complaint *a = complaint_create(10, "A", "X", "Roads", PRIORITY_NORMAL, today_day());
    Complaint *b = complaint_create(10, "B", "Y", "Roads", PRIORITY_NORMAL, today_day());
    int failed_here = 0;
    bst_init(&tree);
    CHECK(bst_insert(&tree, a) == 1);
    CHECK(bst_insert(&tree, b) == 0);
    CHECK(tree.size == 1);
    bst_free(&tree);
    complaint_free(a);
    complaint_free(b);
    return failed_here;
}

static int test_sorted_insertion_keeps_avl_balanced(void)
{
    ComplaintBST tree;
    Complaint *items[1000];
    Complaint **sorted;
    int failed_here = 0, i, n = 0;

    bst_init(&tree);
    for (i = 0; i < 1000; i++) {
        items[i] = complaint_create(i + 1, "A", "X", "Roads",
                                    PRIORITY_NORMAL, today_day());
        CHECK(bst_insert(&tree, items[i]) == 1);
    }

    CHECK(tree.size == 1000);
    CHECK(bst_height(&tree) <= 13); /* sorted input must not create a linear-height tree */
    for (i = 0; i < 1000; i++)
        CHECK(bst_search(&tree, i + 1) == items[i]);

    sorted = bst_inorder(&tree, &n);
    CHECK(n == 1000);
    for (i = 1; i < n; i++)
        CHECK(sorted[i - 1]->cid < sorted[i]->cid);

    free(sorted);
    bst_free(&tree);
    for (i = 0; i < 1000; i++)
        complaint_free(items[i]);
    return failed_here;
}

static int test_avl_all_four_rotation_cases(void)
{
    static const int sequences[4][3] = {
        {30, 20, 10}, /* left-left */
        {10, 20, 30}, /* right-right */
        {30, 10, 20}, /* left-right */
        {10, 30, 20}  /* right-left */
    };
    int failed_here = 0, i, j;

    for (i = 0; i < 4; i++) {
        ComplaintBST tree;
        Complaint *items[3];

        bst_init(&tree);
        for (j = 0; j < 3; j++) {
            items[j] = complaint_create(sequences[i][j], "A", "X", "Roads",
                                        PRIORITY_NORMAL, today_day());
            CHECK(bst_insert(&tree, items[j]) == 1);
        }

        CHECK(tree.root != NULL && tree.root->complaint->cid == 20);
        CHECK(bst_height(&tree) == 2);
        CHECK(tree.size == 3);
        for (j = 0; j < 3; j++)
            CHECK(bst_search(&tree, sequences[i][j]) == items[j]);

        bst_free(&tree);
        for (j = 0; j < 3; j++)
            complaint_free(items[j]);
    }
    return failed_here;
}

/* Validate ordering, stored heights and AVL balance recursively. */
static int verify_avl_node(const BSTNode *node, long lower, long upper,
                           int *count, int *valid)
{
    int left_height, right_height, expected_height;

    if (node == NULL)
        return 0;

    if (node->complaint->cid <= lower || node->complaint->cid >= upper)
        *valid = 0;

    left_height = verify_avl_node(node->left, lower,
                                  node->complaint->cid, count, valid);
    right_height = verify_avl_node(node->right, node->complaint->cid,
                                   upper, count, valid);
    expected_height = 1 + (left_height > right_height ? left_height : right_height);

    if (node->height != expected_height ||
        left_height - right_height > 1 ||
        right_height - left_height > 1)
        *valid = 0;

    (*count)++;
    return expected_height;
}

static int test_avl_randomized_insertion_preserves_invariants(void)
{
    enum { ITEM_COUNT = 750, ROUNDS = 4 };
    int failed_here = 0, round, i;

    for (round = 0; round < ROUNDS; round++) {
        ComplaintBST tree;
        Complaint *items[ITEM_COUNT];
        int order[ITEM_COUNT];
        int count = 0, valid = 1;
        unsigned int state = 12345u + (unsigned int)round;

        bst_init(&tree);
        for (i = 0; i < ITEM_COUNT; i++) {
            order[i] = i + 1;
            items[i] = complaint_create(i + 1, "AVL test", "Test area",
                                        "Roads", PRIORITY_NORMAL, today_day());
        }

        /* Deterministic Fisher-Yates shuffle: repeatable without rand(). */
        for (i = ITEM_COUNT - 1; i > 0; i--) {
            int j;
            int temp;
            state = state * 1664525u + 1013904223u;
            j = (int)(state % (unsigned int)(i + 1));
            temp = order[i];
            order[i] = order[j];
            order[j] = temp;
        }

        for (i = 0; i < ITEM_COUNT; i++)
            CHECK(bst_insert(&tree, items[order[i] - 1]) == 1);

        verify_avl_node(tree.root, LONG_MIN, LONG_MAX, &count, &valid);
        CHECK(valid);
        CHECK(count == ITEM_COUNT);
        CHECK(tree.size == ITEM_COUNT);
        CHECK(bst_height(&tree) <= 12);

        for (i = 0; i < ITEM_COUNT; i++)
            CHECK(bst_search(&tree, i + 1) == items[i]);

        bst_free(&tree);
        for (i = 0; i < ITEM_COUNT; i++)
            complaint_free(items[i]);
    }
    return failed_here;
}

/* -------------------------------------------------------------- queues */
static int test_linked_queue_is_fifo(void)
{
    LinkedQueue q;
    Complaint *c[3];
    int failed_here = 0, i;
    queue_init(&q);
    for (i = 0; i < 3; i++) {
        c[i] = complaint_create(i + 1, "A", "X", "Roads", PRIORITY_NORMAL, today_day());
        queue_enqueue(&q, c[i]);
    }
    CHECK(queue_peek(&q) == c[0]);
    CHECK(queue_dequeue(&q) == c[0]);
    CHECK(queue_dequeue(&q) == c[1]);
    CHECK(queue_dequeue(&q) == c[2]);
    CHECK(queue_dequeue(&q) == NULL);
    CHECK(queue_is_empty(&q));
    for (i = 0; i < 3; i++)
        complaint_free(c[i]);
    return failed_here;
}

static int test_priority_order_then_fifo_inside_a_priority(void)
{
    GrievanceSystem sys;
    int failed_here = 0, count = 0, last_rank = -1;
    int urgent_ids[4], urgent = 0;
    Complaint *c;

    load_into(&sys);
    CHECK(pqm_total(&sys.queues) == 9);
    while ((c = pqm_dequeue_next(&sys.queues)) != NULL) {
        CHECK((int)c->priority >= last_rank);                    /* Urgent, High, Normal */
        last_rank = (int)c->priority;
        if (c->priority == PRIORITY_URGENT)
            urgent_ids[urgent++] = c->cid;
        count++;
    }
    CHECK(count == 9);
    CHECK(urgent == 2 && urgent_ids[0] == 4821 && urgent_ids[1] == 9036);   /* arrival order */
    CHECK(pqm_total(&sys.queues) == 0);
    system_free(&sys);
    return failed_here;
}

/* ------------------------------------------------ status list and undo */
static int test_status_history_append_and_remove_last(void)
{
    StatusHistory h;
    int failed_here = 0;
    history_init(&h);
    history_append(&h, STATUS_FILED, "", 100);
    history_append(&h, STATUS_ASSIGNED, "", 101);
    history_append(&h, STATUS_IN_PROGRESS, "", 102);
    CHECK(history_last_status(&h) == STATUS_IN_PROGRESS);
    CHECK(history_remove_last(&h) == 1);
    CHECK(history_last_status(&h) == STATUS_ASSIGNED);
    CHECK(h.size == 2);
    history_free(&h);
    return failed_here;
}

static int test_filed_status_can_never_be_removed(void)
{
    StatusHistory h;
    int failed_here = 0;
    history_init(&h);
    history_append(&h, STATUS_FILED, "", 100);
    CHECK(history_remove_last(&h) == 0);
    CHECK(h.size == 1);
    history_free(&h);
    return failed_here;
}

static int test_stack_is_lifo(void)
{
    UndoStack s;
    UndoRecord a = {1, STATUS_FILED, STATUS_ASSIGNED};
    UndoRecord b = {2, STATUS_ASSIGNED, STATUS_RESOLVED};
    UndoRecord out;
    int failed_here = 0;
    undo_init(&s);
    CHECK(undo_is_empty(&s));
    undo_push(&s, a);
    undo_push(&s, b);
    CHECK(undo_peek(&s, &out) && out.cid == 2);
    CHECK(undo_pop(&s, &out) && out.cid == 2);
    CHECK(undo_pop(&s, &out) && out.cid == 1);
    CHECK(undo_pop(&s, &out) == 0);
    undo_free(&s);
    return failed_here;
}

static int test_undo_two_updates_in_reverse_order(void)
{
    GrievanceSystem sys;
    int failed_here = 0;
    Complaint *c;
    UndoRecord r, r1 = {4821, STATUS_FILED, STATUS_ASSIGNED},
                  r2 = {4821, STATUS_ASSIGNED, STATUS_IN_PROGRESS};

    load_into(&sys);
    c = bst_search(&sys.bst, 4821);
    history_append(&c->history, STATUS_ASSIGNED, "", today_day());
    undo_push(&sys.undo, r1);
    history_append(&c->history, STATUS_IN_PROGRESS, "", today_day());
    undo_push(&sys.undo, r2);

    undo_pop(&sys.undo, &r);
    history_remove_last(&bst_search(&sys.bst, r.cid)->history);
    CHECK(complaint_status(c) == STATUS_ASSIGNED);
    undo_pop(&sys.undo, &r);
    history_remove_last(&bst_search(&sys.bst, r.cid)->history);
    CHECK(complaint_status(c) == STATUS_FILED);
    system_free(&sys);
    return failed_here;
}

/* -------------------------------------------------------------- system */
static int test_resolved_complaint_stops_counting_pending_days(void)
{
    GrievanceSystem sys;
    int failed_here = 0;
    Complaint *c;
    load_into(&sys);
    c = bst_search(&sys.bst, 1889);          /* filed 20 days ago, resolved on day 3 */
    CHECK(complaint_status(c) == STATUS_RESOLVED);
    CHECK(complaint_pending_days(c) == 3);
    system_free(&sys);
    return failed_here;
}

static int test_only_unprocessed_complaints_enter_the_queues(void)
{
    GrievanceSystem sys;
    int failed_here = 0;
    load_into(&sys);
    CHECK(sys.count == 12);
    CHECK(pqm_total(&sys.queues) == 9);      /* 12 samples - 3 already processed */
    system_free(&sys);
    return failed_here;
}

static int test_duplicate_complaint_is_rejected_by_the_system(void)
{
    GrievanceSystem sys;
    int failed_here = 0;
    Complaint *dup;
    load_into(&sys);
    dup = complaint_create(4821, "X", "Y", "Roads", PRIORITY_NORMAL, today_day());
    CHECK(system_add_complaint(&sys, dup) == 0);
    CHECK(sys.count == 12);
    complaint_free(dup);
    system_free(&sys);
    return failed_here;
}

static int test_generated_ids_are_unused(void)
{
    GrievanceSystem sys;
    int failed_here = 0, i;
    load_into(&sys);
    for (i = 0; i < 50; i++)
        CHECK(bst_search(&sys.bst, system_new_id(&sys)) == NULL);
    system_free(&sys);
    return failed_here;
}

static int test_system_grows_beyond_initial_capacity(void)
{
    GrievanceSystem sys;
    int failed_here = 0, i, n = 100;
    Complaint **extra = generate_random_complaints(n, 11);
    system_init(&sys);
    for (i = 0; i < n; i++)
        CHECK(system_add_complaint(&sys, extra[i]) == 1);
    CHECK(sys.count == n);
    CHECK(sys.bst.size == n);
    CHECK(pqm_total(&sys.queues) == n);
    free(extra);                              /* the system owns the complaints now */
    system_free(&sys);
    return failed_here;
}

/* ------------------------------------------------ extra tests: empty cases and consistency */

static int test_benchmark_rejects_invalid_sizes(void)
{
    int failed_here = 0;
    int invalid_size = -1;
    SortBenchRow row;
    SearchBenchResult result;

    CHECK(generate_random_complaints(90001, 1) == NULL);

    result = benchmark_searching(0, 10);
    CHECK(result.linear_ms == 0.0 && result.binary_ms == 0.0 && result.bst_ms == 0.0);
    result = benchmark_searching(10, 0);
    CHECK(result.linear_ms == 0.0 && result.binary_ms == 0.0 && result.bst_ms == 0.0);

    benchmark_sorting(&invalid_size, 1, &row);
    CHECK(row.n == -1);
    CHECK(row.ms[0] == 0.0 && row.ms[1] == 0.0 && row.ms[2] == 0.0 &&
          row.ms[3] == 0.0 && row.ms[4] == 0.0);
    return failed_here;
}

static int test_benchmarks_report_repeated_run_results(void)
{
    int failed_here = 0;
    int sizes[2] = {20, 50};
    SortBenchRow rows[2];
    SearchBenchResult result;
    int i, a;

    benchmark_sorting(sizes, 2, rows);
    for (i = 0; i < 2; i++) {
        CHECK(rows[i].n == sizes[i]);
        for (a = 0; a < SORT_ALGORITHM_COUNT; a++)
            CHECK(rows[i].ms[a] >= 0.0);
    }

    result = benchmark_searching(250, 40);
    CHECK(result.n == 250);
    CHECK(result.lookups == 40);
    CHECK(result.bst_height > 0);
    CHECK(result.linear_ms >= 0.0);
    CHECK(result.binary_ms >= 0.0);
    CHECK(result.bst_ms >= 0.0);
    return failed_here;
}

static int test_empty_system_starts_clean(void)
{
    GrievanceSystem sys;
    int failed_here = 0;

    system_init(&sys);

    CHECK(sys.count == 0);
    CHECK(sys.bst.size == 0);
    CHECK(pqm_total(&sys.queues) == 0);
    CHECK(undo_is_empty(&sys.undo));

    system_free(&sys);
    return failed_here;
}

static int test_empty_bst_search_and_traversal(void)
{
    ComplaintBST tree;
    Complaint **items;
    int failed_here = 0, n = -1;

    bst_init(&tree);

    CHECK(bst_search(&tree, 1234) == NULL);
    CHECK(bst_height(&tree) == 0);

    items = bst_inorder(&tree, &n);
    CHECK(n == 0);

    free(items);
    bst_free(&tree);
    return failed_here;
}

static int test_priority_queue_counts_are_consistent(void)
{
    GrievanceSystem sys;
    int failed_here = 0, p, total = 0;

    load_into(&sys);

    for (p = 0; p < PRIORITY_COUNT; p++)
        total += pqm_count(&sys.queues, (Priority)p);

    CHECK(total == pqm_total(&sys.queues));
    CHECK(total == 9);

    system_free(&sys);
    return failed_here;
}

static int test_history_last_day_after_removal(void)
{
    StatusHistory h;
    int failed_here = 0;

    history_init(&h);
    history_append(&h, STATUS_FILED, "", 100);
    history_append(&h, STATUS_ASSIGNED, "", 101);
    history_append(&h, STATUS_IN_PROGRESS, "", 102);

    CHECK(history_last_day(&h) == 102);
    CHECK(history_remove_last(&h) == 1);
    CHECK(history_last_day(&h) == 101);
    CHECK(history_last_status(&h) == STATUS_ASSIGNED);

    history_free(&h);
    return failed_here;
}

/* ------------------------------------------------ saving and loading */

#define TEST_FILE "civicdesk_test_data.tmp"

static void write_text_file(const char *text)
{
    FILE *f = fopen(TEST_FILE, "w");
    if (f != NULL) {
        fputs(text, f);
        fclose(f);
    }
}

static int test_save_and_load_round_trip(void)
{
    GrievanceSystem a, b;
    int failed_here = 0, i;
    Complaint *c;
    char error[100];

    load_into(&a);
    c = pqm_dequeue_next(&a.queues);                                /* process one complaint */
    history_append(&c->history, STATUS_ASSIGNED, "Test remark", today_day());

    CHECK(system_save(&a, TEST_FILE) == 0);
    system_init(&b);
    CHECK(system_load(&b, TEST_FILE, error, sizeof error) == 12);
    CHECK(b.count == a.count);
    CHECK(pqm_total(&b.queues) == pqm_total(&a.queues));

    for (i = 0; i < a.count; i++) {
        const Complaint *x = a.all[i];
        const Complaint *y = bst_search(&b.bst, x->cid);
        CHECK(y != NULL);
        if (y == NULL)
            continue;
        CHECK(strcmp(x->name, y->name) == 0);
        CHECK(strcmp(x->area, y->area) == 0);
        CHECK(strcmp(x->department, y->department) == 0);
        CHECK(x->priority == y->priority);
        CHECK(x->filed_on == y->filed_on);
        CHECK(complaint_status(x) == complaint_status(y));
        CHECK(x->history.size == y->history.size);
    }

    while ((c = pqm_dequeue_next(&a.queues)) != NULL) {             /* same processing order */
        Complaint *d = pqm_dequeue_next(&b.queues);
        CHECK(d != NULL && d->cid == c->cid);
    }
    CHECK(pqm_total(&b.queues) == 0);

    system_free(&a);
    system_free(&b);
    remove(TEST_FILE);
    return failed_here;
}

static int test_load_rejects_invalid_files_and_keeps_data(void)
{
    static const char *bad_files[] = {
        "HELLO\n",
        "CIVICDESK 1junk\n",
        "CIVICDESK 1\nC|999999999999999999999999999|A|X|Roads|2|100\n",
        "CIVICDESK 1\nC|5|A|X|Roads|2|100\nC|5|B|Y|Roads|1|100\n",
        "CIVICDESK 1\nC|5|A|X|Roads|9|100\n",
        "CIVICDESK 1\nS|1|100|Orphan status\n",
        "CIVICDESK 1\nC|5|A|X|Roads|2|100\nS|3|101|\nS|2|102|\n",
        "CIVICDESK 1\nsomething else\n"
    };
    GrievanceSystem sys;
    int failed_here = 0, i;
    char error[100];

    load_into(&sys);
    for (i = 0; i < 8; i++) {
        write_text_file(bad_files[i]);
        CHECK(system_load(&sys, TEST_FILE, error, sizeof error) == -1);
        CHECK(error[0] != '\0');
        CHECK(sys.count == 12);                                    /* current data untouched */
        CHECK(bst_search(&sys.bst, 4821) != NULL);
    }
    write_text_file("CIVICDESK 1\n");                              /* a valid but empty file */
    CHECK(system_load(&sys, TEST_FILE, error, sizeof error) == 0);
    CHECK(sys.count == 0);

    system_free(&sys);
    remove(TEST_FILE);
    return failed_here;
}

static int test_load_rejects_future_dates(void)
{
    GrievanceSystem sys;
    int failed_here = 0;
    char error[100], record[256];
    long today = today_day();

    load_into(&sys);

    snprintf(record, sizeof record,
             "CIVICDESK 1\nC|5|A|X|Roads|2|%ld\n", today + 1);
    write_text_file(record);
    CHECK(system_load(&sys, TEST_FILE, error, sizeof error) == -1);
    CHECK(sys.count == 12);
    CHECK(bst_search(&sys.bst, 4821) != NULL);

    snprintf(record, sizeof record,
             "CIVICDESK 1\nC|5|A|X|Roads|2|%ld\nS|1|%ld|Future status\n",
             today, today + 1);
    write_text_file(record);
    CHECK(system_load(&sys, TEST_FILE, error, sizeof error) == -1);
    CHECK(sys.count == 12);
    CHECK(bst_search(&sys.bst, 4821) != NULL);

    system_free(&sys);
    remove(TEST_FILE);
    return failed_here;
}

static int test_load_rejects_null_arguments(void)
{
    GrievanceSystem sys;
    int failed_here = 0;
    char error[100];

    load_into(&sys);

    CHECK(system_load(NULL, TEST_FILE, error, sizeof error) == -1);
    CHECK(error[0] != '\0');

    error[0] = '\0';
    CHECK(system_load(&sys, NULL, error, sizeof error) == -1);
    CHECK(error[0] != '\0');

    error[0] = '\0';
    CHECK(system_load(&sys, "", error, sizeof error) == -1);
    CHECK(error[0] != '\0');

    CHECK(system_load(&sys, NULL, NULL, 0) == -1);
    CHECK(sys.count == 12);
    CHECK(bst_search(&sys.bst, 4821) != NULL);

    system_free(&sys);
    return failed_here;
}

static int test_load_missing_file_fails(void)
{
    GrievanceSystem sys;
    int failed_here = 0;
    char error[100];

    load_into(&sys);
    CHECK(system_load(&sys, "this_file_does_not_exist.tmp", error, sizeof error) == -1);
    CHECK(sys.count == 12);
    system_free(&sys);
    return failed_here;
}

static int test_save_replaces_separator_characters(void)
{
    GrievanceSystem a, b;
    int failed_here = 0;
    Complaint *c = complaint_create(77, "A|B", "Area|1", "Roads", PRIORITY_HIGH, today_day());
    const Complaint *y;
    char error[100];

    system_init(&a);
    history_append(&c->history, STATUS_ASSIGNED, "x|y\nz", today_day());
    system_add_complaint(&a, c);

    CHECK(system_save(&a, TEST_FILE) == 0);
    system_init(&b);
    CHECK(system_load(&b, TEST_FILE, error, sizeof error) == 1);
    y = bst_search(&b.bst, 77);
    CHECK(y != NULL);
    if (y != NULL) {
        CHECK(strcmp(y->name, "A B") == 0);
        CHECK(strcmp(y->history.tail->remarks, "x y z") == 0);
    }

    system_free(&a);
    system_free(&b);
    remove(TEST_FILE);
    return failed_here;
}


static int test_queue_rejects_invalid_inputs(void)
{
    LinkedQueue q;
    PriorityQueueManager manager;
    Complaint *c = complaint_create(7001, "Test", "Area", "Roads",
                                    PRIORITY_NORMAL, today_day());
    int failed_here = 0;

    queue_init(&q);
    pqm_init(&manager);

    CHECK(queue_enqueue(NULL, c) == 0);
    CHECK(queue_enqueue(&q, NULL) == 0);
    CHECK(queue_enqueue(&q, c) == 1);
    CHECK(queue_peek(&q) == c);
    CHECK(queue_dequeue(&q) == c);
    CHECK(queue_dequeue(NULL) == NULL);
    CHECK(queue_peek(NULL) == NULL);
    CHECK(queue_is_empty(NULL));

    CHECK(pqm_enqueue(NULL, c) == 0);
    CHECK(pqm_enqueue(&manager, NULL) == 0);
    c->priority = (Priority)PRIORITY_COUNT;
    CHECK(pqm_enqueue(&manager, c) == 0);
    CHECK(pqm_total(&manager) == 0);
    CHECK(pqm_count(&manager, (Priority)PRIORITY_COUNT) == 0);

    c->priority = PRIORITY_NORMAL;
    CHECK(pqm_enqueue(&manager, c) == 1);
    CHECK(pqm_total(&manager) == 1);
    CHECK(pqm_dequeue_next(&manager) == c);
    CHECK(pqm_dequeue_next(NULL) == NULL);

    queue_free(&q);
    queue_free(NULL);
    pqm_free(&manager);
    pqm_free(NULL);
    complaint_free(c);
    return failed_here;
}

static int test_system_rejects_invalid_complaints(void)
{
    GrievanceSystem sys;
    Complaint *bad;
    int failed_here = 0;

    system_init(&sys);
    CHECK(system_add_complaint(NULL, NULL) == 0);
    CHECK(system_add_complaint(&sys, NULL) == 0);

    bad = complaint_create(7002, "Test", "Area", "Roads",
                           PRIORITY_NORMAL, today_day());
    bad->priority = (Priority)PRIORITY_COUNT;
    CHECK(system_add_complaint(&sys, bad) == 0);
    CHECK(sys.count == 0);
    CHECK(sys.bst.size == 0);
    CHECK(pqm_total(&sys.queues) == 0);

    complaint_free(bad);
    system_free(&sys);
    return failed_here;
}


/* Reuse a linked queue after it has been completely drained. */
static int test_queue_can_be_reused_after_becoming_empty(void)
{
    LinkedQueue q;
    Complaint *a = complaint_create(7101, "A", "Area", "Roads",
                                    PRIORITY_NORMAL, today_day());
    Complaint *b = complaint_create(7102, "B", "Area", "Roads",
                                    PRIORITY_NORMAL, today_day());
    int failed_here = 0;

    queue_init(&q);
    CHECK(queue_enqueue(&q, a) == 1);
    CHECK(queue_enqueue(&q, b) == 1);
    CHECK(queue_dequeue(&q) == a);
    CHECK(queue_dequeue(&q) == b);
    CHECK(queue_is_empty(&q));
    CHECK(q.front == NULL && q.rear == NULL && q.size == 0);

    CHECK(queue_enqueue(&q, b) == 1);
    CHECK(q.front == b && q.rear == b && q.size == 1);
    CHECK(queue_dequeue(&q) == b);
    CHECK(queue_is_empty(&q));

    queue_free(&q);
    complaint_free(a);
    complaint_free(b);
    return failed_here;
}

/* Exercise array growth, AVL indexing and all priority queues together at scale. */
static int test_large_system_stress_and_priority_order(void)
{
    enum { ITEM_COUNT = 10000 };
    GrievanceSystem sys;
    Complaint **generated = generate_random_complaints(ITEM_COUNT, 20261122u);
    int failed_here = 0, i, p, drained = 0;

    if (generated == NULL)
        return 1;

    system_init(&sys);
    for (i = 0; i < ITEM_COUNT; i++)
        CHECK(system_add_complaint(&sys, generated[i]) == 1);

    CHECK(sys.count == ITEM_COUNT);
    CHECK(sys.capacity >= ITEM_COUNT);
    CHECK(sys.bst.size == ITEM_COUNT);
    CHECK(pqm_total(&sys.queues) == ITEM_COUNT);
    CHECK(bst_height(&sys.bst) <= 20);

    for (i = 0; i < ITEM_COUNT; i++)
        CHECK(bst_search(&sys.bst, sys.all[i]->cid) == sys.all[i]);

    /* Drain in priority order while preserving arrival order within each priority. */
    for (p = 0; p < PRIORITY_COUNT; p++) {
        for (i = 0; i < ITEM_COUNT; i++) {
            if ((int)sys.all[i]->priority == p) {
                CHECK(pqm_dequeue_next(&sys.queues) == sys.all[i]);
                drained++;
            }
        }
    }

    CHECK(drained == ITEM_COUNT);
    CHECK(pqm_total(&sys.queues) == 0);
    CHECK(sys.count == ITEM_COUNT);
    CHECK(sys.bst.size == ITEM_COUNT);

    free(generated); /* system now owns every complaint */
    system_free(&sys);
    return failed_here;
}

/* A physical record longer than the loader's fixed line buffer must be rejected atomically. */
static int test_load_rejects_oversized_line_without_changing_data(void)
{
    GrievanceSystem sys;
    char error[100];
    char oversized[700];
    size_t i;
    int failed_here = 0;

    load_into(&sys);
    strcpy(oversized, "CIVICDESK 1\n");
    for (i = strlen(oversized); i < sizeof oversized - 2; i++)
        oversized[i] = 'A';
    oversized[sizeof oversized - 2] = '\n';
    oversized[sizeof oversized - 1] = '\0';

    write_text_file(oversized);
    CHECK(system_load(&sys, TEST_FILE, error, sizeof error) == -1);
    CHECK(error[0] != '\0');
    CHECK(sys.count == 12);
    CHECK(bst_search(&sys.bst, 4821) != NULL);

    system_free(&sys);
    remove(TEST_FILE);
    return failed_here;
}

int main(void)
{
    printf("CivicDesk tests\n");
    RUN(test_all_sorts_match_reference);
    RUN(test_sorts_handle_many_deterministic_random_inputs);
    RUN(test_quick_sort_on_sorted_and_reversed_input);
    RUN(test_merge_sort_is_stable);
    RUN(test_bst_and_binary_search_find_every_complaint);
    RUN(test_missing_id_returns_null);
    RUN(test_linear_search_by_area);
    RUN(test_duplicate_id_rejected);
    RUN(test_sorted_insertion_keeps_avl_balanced);
    RUN(test_avl_all_four_rotation_cases);
    RUN(test_avl_randomized_insertion_preserves_invariants);
    RUN(test_linked_queue_is_fifo);
    RUN(test_priority_order_then_fifo_inside_a_priority);
    RUN(test_status_history_append_and_remove_last);
    RUN(test_filed_status_can_never_be_removed);
    RUN(test_stack_is_lifo);
    RUN(test_undo_two_updates_in_reverse_order);
    RUN(test_resolved_complaint_stops_counting_pending_days);
    RUN(test_only_unprocessed_complaints_enter_the_queues);
    RUN(test_duplicate_complaint_is_rejected_by_the_system);
    RUN(test_generated_ids_are_unused);
    RUN(test_system_grows_beyond_initial_capacity);

    RUN(test_benchmark_rejects_invalid_sizes);
    RUN(test_benchmarks_report_repeated_run_results);
    RUN(test_empty_system_starts_clean);
    RUN(test_empty_bst_search_and_traversal);
    RUN(test_priority_queue_counts_are_consistent);
    RUN(test_queue_rejects_invalid_inputs);
    RUN(test_queue_can_be_reused_after_becoming_empty);
    RUN(test_large_system_stress_and_priority_order);
    RUN(test_load_rejects_oversized_line_without_changing_data);
    RUN(test_system_rejects_invalid_complaints);
    RUN(test_history_last_day_after_removal);

    RUN(test_save_and_load_round_trip);
    RUN(test_load_rejects_invalid_files_and_keeps_data);
    RUN(test_load_rejects_future_dates);
    RUN(test_load_rejects_null_arguments);
    RUN(test_load_missing_file_fails);
    RUN(test_save_replaces_separator_characters);

    printf("\n%d tests run, %d failed.\n", tests_run, tests_failed);
    return tests_failed == 0 ? 0 : 1;
}
