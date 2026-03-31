import { Suspense } from "react";
import { useTaskModule } from "../hooks/useTaskModule";
import { useTaskUI } from "../hooks/useTaskUI";
import { TaskList } from "./TaskList";
import { TaskDetail } from "./TaskDetail";

type TaskWorkspaceDesktopProps = {
    userId: string | null;
    activeRoomId: string | null;
    activeRoomName?: string | null;
    accessToken?: string | null;
    hsUrl?: string | null;
    matrixUserId?: string | null;
    onOpenRoom: (roomId: string) => void;
    onOpenTasksTab: () => void;
    onMobileDetail: () => void;
    onMobileList: () => void;
};

function DeferredTaskPanel({ title, description }: { title: string; description: string }) {
    return (
        <div className="flex h-full min-h-0 items-center justify-center bg-white p-6 dark:bg-slate-900">
            <div className="max-w-sm rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-center dark:border-slate-800 dark:bg-slate-950">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</div>
                <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{description}</div>
            </div>
        </div>
    );
}

export function TaskWorkspaceDesktop({
    userId,
    activeRoomId,
    activeRoomName,
    accessToken = null,
    hsUrl = null,
    matrixUserId = null,
    onOpenRoom,
    onOpenTasksTab,
    onMobileDetail,
    onMobileList,
}: TaskWorkspaceDesktopProps) {
    const taskModule = useTaskModule({
        userId,
        activeRoomId,
        activeRoomName,
        accessToken,
        hsUrl,
        matrixUserId,
    });

    const taskUi = useTaskUI({
        taskModule,
        onOpenRoom,
        onOpenTasksTab,
        onMobileDetail,
        onMobileList,
    });

    return (
        <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-900 lg:flex-row">
            <aside className="min-h-0 w-full border-b border-gray-100 dark:border-slate-800 lg:w-80 lg:flex-none lg:border-b-0 lg:border-r">
                {taskModule.hydrated ? (
                    <Suspense fallback={<DeferredTaskPanel title="Preparing tasks" description="Task data is being restored from local storage and recent updates." />}>
                        <TaskList {...taskUi.listProps} />
                    </Suspense>
                ) : (
                    <DeferredTaskPanel title="Preparing tasks" description="Task data is being restored from local storage and recent updates." />
                )}
            </aside>
            <main className="flex-1 min-h-0 overflow-hidden">
                {taskModule.hydrated ? (
                    <Suspense fallback={<DeferredTaskPanel title="Preparing tasks" description="Task detail is being restored from local storage and recent updates." />}>
                        <TaskDetail {...taskUi.detailProps} />
                    </Suspense>
                ) : (
                    <DeferredTaskPanel title="Preparing tasks" description="Task detail is being restored from local storage and recent updates." />
                )}
            </main>
        </div>
    );
}
