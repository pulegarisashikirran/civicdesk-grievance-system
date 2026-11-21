const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const scriptStart = html.indexOf("<script>");
const scriptEnd = html.indexOf("</script>", scriptStart + 8);
assert.notEqual(scriptStart, -1, "index.html must contain the CivicDesk application script");
assert.notEqual(scriptEnd, -1, "CivicDesk application script must be closed");

const source = html.slice(scriptStart + 8, scriptEnd).split("/* ---------- screen ---------- */")[0] + `
globalThis.CivicDeskTest = {
  StatusList, Complaint, LinkedQueue, PriorityQueues, UndoStack, BST,
  linearSearch, binarySearch, bubble, selection, insertion, merge, quick,
  SORTS, sys, add, dashboardStats
};
`;
const context = vm.createContext({});
vm.runInContext(source, context, { filename: "index.html#civicdesk-core" });
const C = context.CivicDeskTest;

const complaint = (id, priority = 2) =>
  new C.Complaint(id, "Citizen " + id, "Area " + (id % 3), "Roads", priority, 20000);

test("dashboard metrics count waiting, active and resolved complaints", () => {
  const items = [complaint(1), complaint(2), complaint(3), complaint(4)];
  items[1].history.append(1, "Assigned", 20001);
  items[2].history.append(2, "In progress", 20001);
  items[3].history.append(3, "Resolved", 20002);
  assert.deepEqual({ ...C.dashboardStats(items) }, { total: 4, waiting: 1, active: 2, resolved: 1, rate: 25 });
  assert.deepEqual({ ...C.dashboardStats([]) }, { total: 0, waiting: 0, active: 0, resolved: 0, rate: 0 });
});

test("status history appends and removes the latest status", () => {
  const h = new C.StatusList();
  h.append(0, "Filed", 20000);
  h.append(1, "Assigned", 20001);
  assert.equal(h.size, 2);
  assert.equal(h.removeLast(), true);
  assert.equal(h.tail.status, 0);
  assert.equal(h.removeLast(), false);
});

test("complaint status and pending days follow its history", () => {
  const c = complaint(1);
  c.history.append(1, "Assigned", 20001);
  assert.equal(c.status, 1);
  c.history.append(3, "Resolved", 20002);
  assert.equal(c.status, 3);
  assert.equal(c.pending(), 2);
});

test("linked queue preserves FIFO order and empty behavior", () => {
  const q = new C.LinkedQueue();
  assert.equal(q.dequeue(), null);
  q.enqueue("first");
  q.enqueue("second");
  assert.equal(q.dequeue(), "first");
  assert.equal(q.dequeue(), "second");
  assert.equal(q.dequeue(), null);
  assert.equal(q.size, 0);
});

test("priority queues serve urgent before high before normal, FIFO within priority", () => {
  const q = new C.PriorityQueues();
  const normal = complaint(1, 2), urgent1 = complaint(2, 0);
  const urgent2 = complaint(3, 0), high = complaint(4, 1);
  q.enqueue(normal); q.enqueue(urgent1); q.enqueue(urgent2); q.enqueue(high);
  assert.deepEqual([q.next().id, q.next().id, q.next().id, q.next().id], [2, 3, 4, 1]);
  assert.equal(q.next(), null);
});

test("undo stack is LIFO and safely handles empty pop", () => {
  const s = new C.UndoStack();
  assert.equal(s.pop(), null);
  s.push("older"); s.push("newer");
  assert.equal(s.pop(), "newer");
  assert.equal(s.pop(), "older");
  assert.equal(s.pop(), null);
});

test("BST inserts, searches, rejects duplicate IDs and returns sorted traversal", () => {
  const tree = new C.BST();
  [5, 2, 8, 1, 3].forEach(id => assert.equal(tree.insert(complaint(id)), true));
  assert.equal(tree.insert(complaint(3)), false);
  assert.equal(tree.search(8).id, 8);
  assert.equal(tree.search(99), null);
  assert.deepEqual(Array.from(tree.inorder(), c => c.id), [1, 2, 3, 5, 8]);
});

test("linear search returns every matching item", () => {
  const items = [complaint(1), complaint(2), complaint(3)];
  assert.deepEqual(Array.from(C.linearSearch(items, c => c.id > 1), c => c.id), [2, 3]);
});

test("binary search finds present IDs and returns null for missing IDs", () => {
  const items = [1, 3, 5, 7].map(id => complaint(id));
  assert.equal(C.binarySearch(items, 5).id, 5);
  assert.equal(C.binarySearch(items, 4), null);
});

for (const [name, sort] of Object.entries(C.SORTS)) {
  test(name + " sorts without mutating its input", () => {
    const input = [7, 2, 9, 1, 5].map(id => complaint(id));
    const output = sort(input, (a, b) => a.id - b.id);
    assert.deepEqual(Array.from(output, c => c.id), [1, 2, 5, 7, 9]);
    assert.deepEqual(Array.from(input, c => c.id), [7, 2, 9, 1, 5]);
  });
}

test("all sorting algorithms handle empty and single-item arrays", () => {
  for (const sort of Object.values(C.SORTS)) {
    assert.equal(sort([], (a, b) => a - b).length, 0);
    assert.deepEqual(Array.from(sort([42], (a, b) => a - b)), [42]);
  }
});

test("merge sort preserves the order of equal-key items", () => {
  const input = [{ key: 1, order: "a" }, { key: 0, order: "x" }, { key: 1, order: "b" }];
  const output = C.merge(input, (a, b) => a.key - b.key);
  assert.deepEqual(Array.from(output, x => x.order), ["x", "a", "b"]);
});
