import { TaskDetail } from "./components/TaskDetail";
import { TaskList } from "./components/TaskList";
import type { TaskDraft, TaskItem, TaskStatus } from "./types";

type TaskWorkspaceProps = {
    tasks: TaskItem[];
    statuses: TaskStatus[];
    selectedTaskId: string | null;
    selectedTask: TaskItem | null;
    draft: TaskDraft;
    editing: boolean;
    onSelectTask: (taskId: string) => void;
    onCreateTask: () => void;
    onDraftChange: (patch: Partial<TaskDraft>) => void;
    onStartEdit: () => void;
    onSave: () => void;
    onDelete: () => void;
    onCancelEdit: () => void;
};

export function TaskWorkspace({
    tasks,
    statuses,
    selectedTaskId,
    selectedTask,
    draft,
    editing,
    onSelectTask,
    onCreateTask,
    onDraftChange,
    onStartEdit,
    onSave,
    onDelete,
    onCancelEdit,
}: TaskWorkspaceProps) {
    return (
        <>
            <TaskList
                tasks={tasks}
                statuses={statuses}
                selectedTaskId={selectedTaskId}
                onSelectTask={onSelectTask}
                onCreateTask={onCreateTask}
            />
            <TaskDetail
                task={selectedTask}
                statuses={statuses}
                draft={draft}
                editing={editing}
                onDraftChange={onDraftChange}
                onStartEdit={onStartEdit}
                onSave={onSave}
                onDelete={onDelete}
                onCancelEdit={onCancelEdit}
            />
        </>
    );
}
