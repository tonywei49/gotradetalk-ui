export type FileLibraryItem = {
    eventId: string;
    roomId: string;
    roomName: string;
    body: string;
    ts: number;
    msgtype: string;
    mxcUrl: string;
    mimeType?: string;
    sizeBytes: number | null;
};

export type FileLibraryRoomSummary = {
    roomId: string;
    roomName: string;
    attachmentCount: number;
    totalKnownBytes: number;
    unknownSizeCount: number;
    latestTs: number;
};

export function summarizeFileRooms(myFileLibrary: FileLibraryItem[]): FileLibraryRoomSummary[] {
    const map = new Map<string, FileLibraryRoomSummary>();
    myFileLibrary.forEach((item) => {
        const existing = map.get(item.roomId);
        if (!existing) {
            map.set(item.roomId, {
                roomId: item.roomId,
                roomName: item.roomName,
                attachmentCount: 1,
                totalKnownBytes: item.sizeBytes ?? 0,
                unknownSizeCount: item.sizeBytes == null ? 1 : 0,
                latestTs: item.ts,
            });
            return;
        }
        existing.attachmentCount += 1;
        if (item.sizeBytes != null) existing.totalKnownBytes += item.sizeBytes;
        else existing.unknownSizeCount += 1;
        if (item.ts > existing.latestTs) existing.latestTs = item.ts;
    });
    return Array.from(map.values()).sort((a, b) => b.latestTs - a.latestTs);
}

export function filterRoomSummaries(
    roomSummaries: FileLibraryRoomSummary[],
    searchKeyword: string,
): FileLibraryRoomSummary[] {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return roomSummaries;
    return roomSummaries.filter((item) => item.roomName.toLowerCase().includes(keyword));
}

export function filesByRoom(myFileLibrary: FileLibraryItem[], roomId: string | null): FileLibraryItem[] {
    if (!roomId) return [];
    return myFileLibrary
        .filter((item) => item.roomId === roomId)
        .sort((a, b) => b.ts - a.ts);
}

export function filterRoomFiles(params: {
    roomFiles: FileLibraryItem[];
    keyword: string;
    typeFilter: "all" | "image" | "video" | "audio" | "pdf" | "other";
    getFileTypeGroup: (item: FileLibraryItem) => "image" | "video" | "audio" | "pdf" | "other";
}): FileLibraryItem[] {
    const { roomFiles, keyword, typeFilter, getFileTypeGroup } = params;
    const normalizedKeyword = keyword.trim().toLowerCase();
    return roomFiles.filter((item) => {
        if (typeFilter !== "all" && getFileTypeGroup(item) !== typeFilter) return false;
        if (!normalizedKeyword) return true;
        return item.body.toLowerCase().includes(normalizedKeyword);
    });
}

export function paginateRoomFiles(
    visibleRoomFiles: FileLibraryItem[],
    page: number,
    pageSize: number,
): FileLibraryItem[] {
    return visibleRoomFiles.slice(0, page * pageSize);
}
