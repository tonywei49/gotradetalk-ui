# Work Tasks Feature Plan

## Goal

Add a new `Work Tasks` area to the left navigation and provide a unified task system that works in both:

- the standalone task workspace
- the chat room quick-create entry

The same task data must be shared across both entry points.

## Core Product Shape

### 1. Left Navigation: Work Tasks

Add a new navigation item beside existing chat / contacts / notebook / files entries.

When selected:

- center pane shows the task list
- right pane shows task detail and editing form

### 2. Task Workspace

Center pane:

- list all tasks
- create task button
- filter by status / reminder / source room in later phases

Right pane:

- task title
- task content
- status selector
- optional reminder time
- linked room
- created time / updated time
- edit / save / delete actions

### 3. Chat Room Task Entry

In chat room header tools, add a `Work Task` button near the existing notebook entry.

Clicking it shows a quick-create panel inside chat that supports:

- task content input
- status selection
- optional reminder time
- save

Saved tasks must also appear in the main task workspace.

### 4. Chat Room Task Bar

For tasks linked to the current room, show task bars above the timeline.

Each bar shows:

- task title preview
- status
- created date in `YYYY/M/D`

Behavior:

- click once to expand
- click again to collapse
- support multiple task bars

### 5. Reminder Broadcast

When reminder time is reached, show a broadcast bar at the top of the app.

Broadcast content:

- task title
- optional linked room hint

Actions:

- `Remind again in 5 min`
- `Dismiss`

Both actions remove the current banner from view.

## Product Rules

### Unified Data Rule

Chat-created tasks and workspace-created tasks are the same entity.

There must not be two separate task systems.

### Status Rule

First version should use predefined statuses, while the data model remains extensible.

Initial statuses:

- Preparing
- In Progress
- Completed

Each status has:

- name
- color
- sort order

Future versions may allow configuration management for custom statuses.

### Reminder Rule

Reminder state should not rely only on UI visibility.

Each task reminder should track:

- `pending`
- `snoozed`
- `notified`

Supporting fields:

- `remind_at`
- `snoozed_until`
- `remind_state`

## Suggested Data Model

### task_items

- `id`
- `title`
- `content`
- `status_id`
- `remind_at`
- `remind_state`
- `snoozed_until`
- `room_id`
- `room_name_snapshot`
- `created_by`
- `created_at`
- `updated_at`
- `completed_at`

### task_statuses

- `id`
- `name`
- `color`
- `sort_order`
- `scope`

## Frontend Module Plan

Create a dedicated module:

- `src/features/tasks/`

Suggested files:

- `types.ts`
- `index.ts`
- `TaskWorkspace.tsx`
- `components/TaskList.tsx`
- `components/TaskDetail.tsx`
- `components/TaskQuickCreate.tsx`
- `components/TaskRoomBar.tsx`
- `components/TaskReminderBanner.tsx`
- `hooks/useTaskModule.ts`

## Integration Plan

### MainLayout

Main layout should only handle:

- active tab switching
- shared app-level reminder banner mounting
- passing selected room context into task module when needed

Task business logic should stay inside `features/tasks`.

### ChatRoom

Chat room should only handle:

- quick-create trigger
- room task bar display
- linking created task to current `roomId`

Chat room should not become the main source of task state.

## MVP Scope

Phase 1:

- new `Work Tasks` navigation entry
- task list
- task detail
- create / edit / delete
- predefined statuses with color
- optional reminder time
- global top broadcast reminder
- chat room quick-create
- chat room task bar
- jump from task to linked room

Out of scope for MVP:

- sub-tasks
- assignees
- comments
- drag-and-drop board
- repeating reminders
- custom status management UI

## Delivery Order

1. Scaffold independent task module components
2. Add task tab shell in main layout
3. Add task list and task detail workspace
4. Add reminder banner and polling/check logic
5. Add chat room quick-create
6. Add room task bars
7. Add jump-to-room behavior

## Risk Notes

- `MainLayout.tsx` is already large, so task UI should be isolated early
- chat room vertical space is limited on mobile, so room task bars must remain compact
- reminder behavior must be data-driven, otherwise duplicate broadcasts will happen after tab switches
