import test from "node:test";
import assert from "node:assert/strict";
import { buildTaskStatuses, getDefaultTaskStatusId } from "../src/features/tasks/taskStatusConfig.ts";
import { filterTaskItems } from "../src/features/tasks/taskFilters.ts";
import { buildTaskStorageKey, readStoredTasks, writeStoredTasks } from "../src/features/tasks/taskStorage.ts";

function createTask(partial = {}) {
    return {
        id: partial.id ?? "task-1",
        title: partial.title ?? "",
        content: partial.content ?? "",
        statusId: partial.statusId ?? "preparing",
        remindAt: partial.remindAt ?? null,
        remindState: partial.remindState ?? "pending",
        snoozedUntil: partial.snoozedUntil ?? null,
        roomId: partial.roomId ?? null,
        roomNameSnapshot: partial.roomNameSnapshot ?? null,
        createdBy: partial.createdBy ?? null,
        createdAt: partial.createdAt ?? "2026-03-08T00:00:00.000Z",
        updatedAt: partial.updatedAt ?? "2026-03-08T00:00:00.000Z",
        completedAt: partial.completedAt ?? null,
    };
}

test("task status config exposes expanded statuses in order", () => {
    const statuses = buildTaskStatuses((key) => key);
    assert.equal(getDefaultTaskStatusId(), "preparing");
    assert.deepEqual(
        statuses.map((status) => status.id),
        ["preparing", "pending_review", "in_progress", "waiting_reply", "blocked", "completed"],
    );
});

test("task filters support reminder, linked room, and dynamic status filters", () => {
    const tasks = [
        createTask({ id: "a", statusId: "preparing" }),
        createTask({ id: "b", statusId: "waiting_reply", roomId: "!room:example", remindAt: "2026-03-08T08:00:00.000Z" }),
        createTask({ id: "c", statusId: "completed", completedAt: "2026-03-08T09:00:00.000Z" }),
    ];

    assert.deepEqual(filterTaskItems(tasks, "all").map((task) => task.id), ["a", "b", "c"]);
    assert.deepEqual(filterTaskItems(tasks, "reminder").map((task) => task.id), ["b"]);
    assert.deepEqual(filterTaskItems(tasks, "linked").map((task) => task.id), ["b"]);
    assert.deepEqual(filterTaskItems(tasks, "status:waiting_reply").map((task) => task.id), ["b"]);
    assert.deepEqual(filterTaskItems(tasks, "status:completed").map((task) => task.id), ["c"]);
});

test("task storage adapter reads and writes task snapshots safely", () => {
    const bucket = new Map();
    const storage = {
        getItem: (key) => bucket.get(key) ?? null,
        setItem: (key, value) => {
            bucket.set(key, value);
        },
    };
    const key = buildTaskStorageKey("@test:example");
    const tasks = [createTask({ id: "task-storage", title: "storage check" })];

    writeStoredTasks(storage, key, tasks);
    assert.deepEqual(readStoredTasks(storage, key), tasks);
    assert.equal(buildTaskStorageKey(""), null);
    assert.deepEqual(readStoredTasks(storage, null), []);
});
