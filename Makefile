CC      = gcc
CFLAGS  = -std=c99 -Wall -Wextra -pedantic -O2
MODULES = util.c status_list.c complaint.c bst.c queues.c undo_stack.c \
          search_sort.c sample_data.c grievance_system.c

all: civicdesk test_civicdesk\n\nscalability_benchmark: tools/scalability_benchmark.c $(MODULES)\n\t$(CC) $(CFLAGS) -o $@ tools/scalability_benchmark.c $(MODULES)\n\nbenchmark: scalability_benchmark\n\t./scalability_benchmark

civicdesk: main.c $(MODULES)
	$(CC) $(CFLAGS) -o $@ main.c $(MODULES)

test_civicdesk: test_civicdesk.c $(MODULES)
	$(CC) $(CFLAGS) -o $@ test_civicdesk.c $(MODULES)

test: test_civicdesk
	./test_civicdesk

clean:
	rm -f civicdesk test_civicdesk scalability_benchmark civicdesk.exe test_civicdesk.exe scalability_benchmark.exe *.o
