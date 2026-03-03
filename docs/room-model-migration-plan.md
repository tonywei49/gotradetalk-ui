# Chat Room Model Migration Plan

## Goal
- Keep contact (friend) relationship as social graph.
- Move chat behavior back to Matrix-native room model.
- Remove product-level "direct vs group" mental split in user-facing flows.

## Scope
- Frontend repo: `gotradetalk-ui`
- Backend repo (`hub-backend`) is out of scope for this phase, except compatibility checks.

## Baseline Rules (Current Decision)
- Keep `matrix_room_id` required in contact request flow for now.
- Contact remove only removes relationship record; no room deletion.
- User can:
  - enter existing shared rooms with a contact
  - create a new room and invite contact
  - accept/decline room invites from unified invite entry

## Delivered (Done)
- Contact detail panel:
  - shared room list + room selector
  - `Chat` enters selected room
  - `Open new room` creates room and sends invite
- Removed contact-delete side effects:
  - no `deprecated/hide/leave` auto actions on remove contact
- ChatRoom capability unification:
  - invite members / rename room / members actions available for all non-space rooms (permission still enforced)
- Room list unification:
  - single room list pipeline (no split rendering by room type)
  - terminology moved toward "room/chat room"
- Scrollbar fixes:
  - single-pane mobile and major side panels can scroll with visible scrollbar style
- Invite list behavior:
  - unified pending room invites (all non-space invite rooms)
 - Leave behavior:
   - leave-room entry available for all non-space rooms
   - leave action decoupled from hide-room action
- Naming alignment:
  - `GroupInviteList` renamed to `RoomInviteList`
  - `CreateGroupModal` renamed to `CreateRoomModal`
  - `GroupDetailsPanel` renamed to `RoomDetailsPanel` (with compatibility alias)
  - `createRoomWithInvite` added as room-first alias for existing room creation helper
- Runtime logic alignment:
  - room conversation grouping no longer requires legacy `room_kind = group`
  - direct-room hide filtering no longer depends on legacy `room_kind`
  - room action menu leave flow available for all non-space rooms
  - `ChatRoom` internal variables shifted to room-first naming (`isMultiMemberRoom`, `joinedMembers`)
  - membership policy now exposes one-to-one aliases (`isOneToOneRoomByPolicy`, etc.) while keeping old APIs
  - translation pipeline now supports room-first context keys (`isMultiMemberRoom`, `roomTranslationEnabled`) with backward compatibility
  - member modal labels in `ChatRoom` now use `chat.*` keys instead of `group.*`
  - room creation helper module moved to `src/matrix/room.ts` with `src/matrix/group.ts` shim for compatibility
  - `chat.roomNameFallback` key introduced; `groupNameFallback` kept for backward compatibility

## This Iteration (In Progress)
- Continue replacing remaining user-facing "group/direct" copy with "room/chat room" copy.
- Keep old i18n keys for backward compatibility, but update displayed values.
- Clean up old inline comments that still describe direct/group product logic.

## Next Iteration
- Frontend model cleanup:
  - reduce legacy `ROOM_KIND_DIRECT/GROUP` branching where not required
  - centralize room display-name fallback strategy
- Backend compatibility prep:
  - evaluate making `matrix_room_id` optional in contact relation API (not implemented yet)
  - add migration path for old records and API response fallback
- UX polish:
  - room invite list naming/component rename (`GroupInviteList` -> `RoomInviteList`)
  - entry-point consistency in nav/search/empty states

## Risks
- Legacy clients may still depend on direct/group key naming.
- Existing rooms without stable name may show weak fallback labels.
- Mixed room metadata (`room_kind`, `is_direct`, `m.direct`) can produce edge-case categorization.

## Mitigation
- Keep compatibility keys and fallback logic in this phase.
- Do not change backend schema contract in this phase.
- Ship small commits + build verification for each step.

## Rollback
- All changes are split by feature commit; can revert specific commits without DB migration rollback.
