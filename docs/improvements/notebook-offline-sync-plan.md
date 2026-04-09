# Notebook Offline Sync Plan

## Goal

Turn notebook into a local-first note experience:

- Offline: users can create, edit, and delete notes as a simple notebook.
- Online: local changes sync to the platform, then the backend handles indexing, company knowledge, embeddings, and AI retrieval.

This plan keeps the backend as the source of truth. Desktop and mobile only own:

- local cache
- local edit state
- sync queue

They do not own:

- vector storage
- embedding generation
- final knowledge retrieval

## Product Rules

### Local-first editing

- Note create/update/delete must succeed locally even when offline.
- UI should reflect the local result immediately.
- Sync happens in the background when connectivity returns.

### Source of truth

- Server remains the canonical data source.
- Local database is a cache plus pending mutation journal.
- Multi-device consistency is eventual, not peer-to-peer.

### Delete behavior

- Offline delete must not hard-delete the local row immediately.
- Mark the row as `pending_delete`.
- Hide it from normal notebook lists.
- When sync succeeds, remove the local row.
- If sync fails, keep the row tombstoned and retry later.

## Shared State Model

All clients should use the same sync states:

- `synced`
- `pending_create`
- `pending_update`
- `pending_delete`
- `sync_failed`

Queue operations:

- `create`
- `update`
- `delete`

Entities:

- `item`
- `item_file`

## Local Database Scope

Desktop and mobile should both store these logical tables, even if the physical storage engine differs:

- `notebook_items`
- `notebook_item_files`
- `notebook_parsed_preview`
- `notebook_chunks`
- `sync_queue`
- `sync_meta`

Desktop implementation recommendation:

- SQLite in app data directory

Mobile implementation recommendation:

- mobile SQLite or equivalent persistent local store

## Suggested SQLite Schema

```sql
CREATE TABLE notebook_items (
  local_id TEXT PRIMARY KEY,
  server_id TEXT,
  user_id TEXT NOT NULL,
  api_base_url TEXT NOT NULL,
  title TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  item_type TEXT NOT NULL,
  is_indexable INTEGER NOT NULL DEFAULT 0,
  index_status TEXT,
  index_error TEXT,
  source_scope TEXT,
  source_file_name TEXT,
  read_only INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL,
  deleted_at TEXT,
  server_updated_at TEXT,
  local_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_notebook_items_scope
ON notebook_items (user_id, api_base_url, sync_status, local_updated_at DESC);

CREATE TABLE notebook_item_files (
  local_id TEXT PRIMARY KEY,
  server_id TEXT,
  local_item_id TEXT NOT NULL,
  server_item_id TEXT,
  user_id TEXT NOT NULL,
  api_base_url TEXT NOT NULL,
  matrix_media_mxc TEXT,
  matrix_media_name TEXT,
  matrix_media_mime TEXT,
  matrix_media_size INTEGER,
  sync_status TEXT NOT NULL,
  deleted_at TEXT,
  local_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE notebook_parsed_preview (
  item_local_id TEXT PRIMARY KEY,
  item_server_id TEXT,
  user_id TEXT NOT NULL,
  api_base_url TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  chunks_json TEXT NOT NULL,
  chunks_total INTEGER NOT NULL,
  cached_at TEXT NOT NULL
);

CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  api_base_url TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_local_id TEXT NOT NULL,
  entity_server_id TEXT,
  operation_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_sync_queue_pending
ON sync_queue (user_id, api_base_url, status, created_at ASC);

CREATE TABLE sync_meta (
  user_id TEXT NOT NULL,
  api_base_url TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, api_base_url, key)
);
```

## Sync Rules

### Create

1. Create local row with a temporary id like `local:item:<uuid>`.
2. Mark item `pending_create`.
3. Add queue entry `create`.
4. When server succeeds:
   - save returned `server_id`
   - change status to `synced`
   - update timestamps
   - remap dependent file queue entries if needed

### Update

1. Apply update locally immediately.
2. If item is already `pending_create`, do not enqueue a second create.
3. Merge latest content into the existing create payload, or enqueue `update` if already synced.
4. Mark row `pending_update` unless already `pending_create`.
5. On success, mark `synced`.

### Delete

1. Mark row `pending_delete`.
2. Set `deleted_at`.
3. Remove it from normal notebook query results.
4. Queue `delete`.
5. On success:
   - remove item row
   - remove related file rows
   - remove parsed preview cache

Special case:

- If a row is still `pending_create` and the user deletes it before first sync, drop both the row and the create queue entry locally. No server delete call is needed.

## Conflict Policy

Use a pragmatic first policy:

- local edits are optimistic
- remote is canonical
- first release: last successful server write wins

Conflict detection can be added later by comparing:

- `server_updated_at`
- optional `revision`

If conflict is detected later, create a conflict copy instead of silently overwriting.

## Query Behavior

Notebook list should read from local DB first.

Filtering rules:

- exclude `pending_delete` by default
- include `sync_failed` and show a sync indicator
- sort by local updated time, with server timestamp fallback

When online:

1. render local cache immediately
2. refresh from server
3. merge newer server results
4. keep pending local mutations intact

## AI / Vector Boundary

Local client stores only:

- note content
- file metadata
- parsed preview
- chunks cache
- sync state

Backend stores and computes:

- company knowledge
- personal knowledge official index
- embeddings
- vector DB
- retrieval
- permission checks

Offline mode is only a notebook editor, not an offline RAG system.

## Rollout Order

### Phase 1

- shared sync types
- local persistent cache
- local-first item create/update/delete
- queue model

### Phase 2

- queue executor
- online reconciliation
- retry/backoff
- logout cleanup

### Phase 3

- file sync queue
- parsed preview cache invalidation
- conflict handling
- sync status UI

## Immediate Desktop Implementation

1. replace notebook cache `localStorage` with SQLite-backed storage adapter
2. add `sync_queue`
3. switch item CRUD to local-first writes
4. add background sync runner when network is available
5. keep AI and vector calls server-side only
