type TimelineEventLike = {
    getId(): string | null | undefined;
    getTxnId(): string | null | undefined;
    getTs(): number;
    getSender?(): string | null | undefined;
};

export function getTimelineEventStableKey(event: TimelineEventLike): string {
    return event.getId() ?? event.getTxnId() ?? `${event.getTs()}-${event.getSender?.() ?? "unknown"}`;
}

export function haveSameTimelineEventSequence<T extends TimelineEventLike>(current: T[], next: T[]): boolean {
    if (current === next) return true;
    if (current.length !== next.length) return false;
    for (let index = 0; index < current.length; index += 1) {
        if (getTimelineEventStableKey(current[index]) !== getTimelineEventStableKey(next[index])) {
            return false;
        }
    }
    return true;
}

export function mergeTimelineEventGroups<T extends TimelineEventLike>(...groups: T[][]): T[] {
    const order: string[] = [];
    const latestByKey = new Map<string, T>();

    groups.forEach((group) => {
        group.forEach((event) => {
            const key = getTimelineEventStableKey(event);
            if (!latestByKey.has(key)) {
                order.push(key);
            }
            latestByKey.set(key, event);
        });
    });

    return order
        .map((key) => latestByKey.get(key) ?? null)
        .filter((event): event is T => Boolean(event));
}

export function resolveTimelineBottomScrollTop({
    previousDistanceFromBottom,
    shouldStickBottom,
    nextScrollHeight,
    threshold = 120,
}: {
    previousDistanceFromBottom: number;
    shouldStickBottom: boolean;
    nextScrollHeight: number;
    threshold?: number;
}): number | null {
    if (shouldStickBottom || previousDistanceFromBottom < threshold) {
        return nextScrollHeight;
    }
    return null;
}
