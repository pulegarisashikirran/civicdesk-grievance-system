/* sample_data.h - sample complaints for the demo, plus a random generator for benchmarks */
#ifndef SAMPLE_DATA_H
#define SAMPLE_DATA_H

#include "complaint.h"

/* 12 fixed complaints (some already processed). Returns a malloc'd array of malloc'd
 * complaints; the caller takes ownership of the complaints and free()s the array. */
Complaint **load_sample_complaints(int *count);

/* n random complaints with unique, non-sequential IDs (0 <= n <= 90000).
 * Returns NULL if n is outside that range. */
Complaint **generate_random_complaints(int n, unsigned long seed);

/* Frees every complaint and then the array itself. */
void free_complaints(Complaint **items, int n);

#endif
