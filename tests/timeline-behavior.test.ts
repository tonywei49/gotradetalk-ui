import test from "node:test";
import assert from "node:assert/strict";
import {
    haveSameTimelineEventSequence,
    mergeTimelineEventGroups,
    resolveTimelineBottomScrollTop,
    resolveTimelineRenderWindowSize,
} from "../src/features/chat/timelineBehavior.ts";

type FakeEvent = {
    label: string;
    id?: string;
    txnId?: string;
    ts: number;
    sender?: string;
    getId(): string | undefined;
    getTxnId(): string | undefined;
    getTs(): number;
    getSender(): string | undefined;
};

function createEvent(label: string, options: Partial<Omit<FakeEvent, "label" | "getId" | "getTxnId" | "getTs" | "getSender">> = {}): FakeEvent {
    const {
        id,
        txnId,
        ts = 0,
        sender = "@alice:example.com",
    } = options;

    return {
        label,
        id,
        txnId,
        ts,
        sender,
        getId: () => id,
        getTxnId: () => txnId,
        getTs: () => ts,
        getSender: () => sender,
    };
}

test("haveSameTimelineEventSequence ignores object identity when stable keys match", () => {
    const first = [createEvent("a-old", { id: "$a", ts: 1 }), createEvent("b-old", { id: "$b", ts: 2 })];
    const second = [createEvent("a-new", { id: "$a", ts: 10 }), createEvent("b-new", { id: "$b", ts: 20 })];

    assert.equal(haveSameTimelineEventSequence(first, second), true);
});

test("mergeTimelineEventGroups keeps the original order while refreshing event references", () => {
    const aOld = createEvent("a-old", { id: "$a", ts: 1 });
    const bOld = createEvent("b-old", { id: "$b", ts: 2 });
    const aNew = createEvent("a-new", { id: "$a", ts: 100 });
    const cNew = createEvent("c-new", { id: "$c", ts: 3 });

    const merged = mergeTimelineEventGroups([aOld, bOld], [aNew, cNew]);

    assert.deepEqual(merged.map((event) => event.label), ["a-new", "b-old", "c-new"]);
    assert.equal(merged[0], aNew);
});

test("resolveTimelineBottomScrollTop snaps to bottom when the viewer was already near the bottom", () => {
    assert.equal(resolveTimelineBottomScrollTop({
        previousDistanceFromBottom: 48,
        shouldStickBottom: false,
        nextScrollHeight: 1280,
    }), 1280);
});

test("resolveTimelineBottomScrollTop does not force scrolling when the viewer left the bottom", () => {
    assert.equal(resolveTimelineBottomScrollTop({
        previousDistanceFromBottom: 280,
        shouldStickBottom: false,
        nextScrollHeight: 1280,
    }), null);
});

test("resolveTimelineRenderWindowSize expands the tail window while bottom lock is active", () => {
    assert.equal(resolveTimelineRenderWindowSize({
        renderedEventCount: 40,
        initialWindow: 40,
        shouldStickBottom: true,
        stickBottomWindow: 200,
    }), 200);
});

test("resolveTimelineRenderWindowSize preserves explicit history expansion outside bottom lock", () => {
    assert.equal(resolveTimelineRenderWindowSize({
        renderedEventCount: 160,
        initialWindow: 40,
        shouldStickBottom: false,
        stickBottomWindow: 200,
    }), 160);
});
