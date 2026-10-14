# PLAN — Private messages between people on a pub (2026-10-12)

**Status: BUILT + VERIFIED 2026-10-12, uncommitted.** Owner "Go ahead and build" after the Q1–Q7
rulings. Six lanes (A1 conversations server · A2 uploads/media/share access · A3 lorebook reader
access · B shell wiring · C Messages view · D sharing UI + read-only workspace) plus docs/canon by
the lead. Verification: `tsc` clean · svelte-check 0 errors (7 pre-existing warnings) · 47 test
files / 610 tests across the lanes' suites · docs compile · two-account browser walk on an
isolated instance (direct conversation, live push both ways, read-on-dwell + suppression while
viewing, Activity row + Messages dot for the other person, Share… a lorebook → attach it → the
recipient opens it read-only with Duplicate as the only verb, person detail with Lorebooks 1,
PNG upload rendered inline for both sides, anonymous `/media` fetch 401). Migration is **0107**
(0102–0106 landed from another session meanwhile).

**Deviations and loose ends (from the lane reports):** the attachment gate runs just before
`send`'s transaction, not inside it (the access helpers read through the outer `db`); `remove`
drops the message's attachment rows; `person` sessions = owned by them where the viewer is a
guest; `characters:share` / `lorebooks:share` are typed but not yet in `GATED_EVENTS` (ungated is
safe); live relays to a shared book's readers cover `entries:list` and `lorebooks:bindingList`
only (scenes, graph, story time, amendments refetch on open); `lorebooks:bindingList` sends a
recipient full character rows of the cast; `bindingSuggestions:list` stays owner-only (it quotes
session transcripts); admins can now read any book server-side but have no read-only UI;
`characters:duplicate` was added (lane D) without a server test; Share… uses a new
`SharePeopleModal` (UserSelectModal cannot pre-tick or confirm empty); `EditSessionForm`'s guest
picker still uses the admin-only `users:list` (Q2 follow-up, not done); `conversations:list`
rows carry no Android gate beyond the client's; the lead fixed a stale upload chip after send
(composer re-lists the tray) and let share recipients export a card (owner's lorebook never
embedded).

Original status line: RULED 2026-10-12 (Q1–Q7 in §9). Can be built as written. Surveyed
2026-10-12 against HEAD `2e544d1a` (two readers over shell/sockets/users and
sharing/media/uploads).

## 0. What is being asked

1. People with accounts on one pub can message each other privately, one to one and in groups.
2. It lives in the sidebar as a rail view, with an unread signal.
3. A message can carry a **session, character, lorebook or file**, but only when **every** person
   in the conversation is allowed to see it. Sessions are shared **only** by the existing guest
   model (owner adds a guest; nothing new). Characters and lorebooks gain an **explicit share**.
4. People can upload files into a conversation.
5. Clicking a person opens their **detail**: who they are, a **Message** button, and tabs for
   their sessions, characters and lorebooks — listing only what *you* are permitted to view, each
   row opening the thing. (Added by the owner 2026-10-12.)

## 1. Facts that shape the build

- **Accounts.** Single-user pubs have nobody to message. `system_settings.is_accounts_enabled`
  (schema.ts:3164) is the gate; Android is single-user and never shows the view.
- **No member-visible user directory exists.** `users:list` is admin-only
  (`sockets/users.ts:529-536`); `sessions:addGuest` (`sockets/sessions.ts:5441`) deliberately
  answers "Unable to add this guest." for every failure so ids cannot be probed; Jump omits the
  `user` kind for members (`shared/sockets/interest.ts:1140`). Ruled Q2: a member roster is new
  and visible to every member while messaging is on.
- **Users have no avatar column** (`users` schema.ts:52-91). Rows draw initials
  (`Avatar fallback="initial"`, STYLE-GUIDE §6.4). A user picture is a follow-up, not this plan.
- **Session access** is one function: `checkSessionAccess(sessionId, userId)` →
  `{isOwner, isGuest, hasAccess}` (`server/utils/sessionAccess.ts:9`). Guests are
  `session_guests (session_id, user_id, is_player)` (schema.ts:3113). Nothing else grants a session.
- **Character visibility** is `canViewCharacter(characterId, userId)` (`sessionAccess.ts:47-69`):
  owner, or cast/voice in a session the viewer can open. No share flag exists.
- **Lorebooks are owner-only everywhere** (`utils/ownedBook.ts` `assertOwnedBook`,
  `lorebooks:get` filters `user_id`; `entries:sessionEntries` answers guests `ownerOnly: true`,
  rule R58). Admins are the one exception. Every lens in the lorebook workspace writes.
- **Media** is `files` + `variants` (schema.ts:2647, 2851), provenance as plain integers with no
  FKs (`user_id`, `character_id`, `session_id`, `message_id`), `visibility 'scoped'|'private'`.
  Served by `GET /media/[id]` through `canViewMedia` (`media/access.ts:29-69`), 404 on refusal.
  `canViewMedia` already has a branch "referenced by a message part in a session you can open"
  (`attachments/references.ts`). A conversation-scoped file needs a sibling branch.
- **Upload transport** is the composer tray: `attachments:begin|chunk|finish|remove|list`
  (`sockets/attachments.ts`), 1 MiB binary chunks, caps in `shared/attachments/caps.ts`
  (10 files, image 20 MiB, text 1 MiB, pdf 32 MiB, 100 MiB per tray), lifecycle in
  `server/attachments/tray.ts`, files written by `createMedia` (`media/index.ts:306`, magic-byte
  sniff, SVG/HEIC refused, metadata stripped). `tray_items.session_id` is NOT NULL (schema.ts:2932).
- **Session messages are not reusable.** `messages.session_id` is NOT NULL (schema.ts:2487); the
  model is pipeline-shaped (parts × step × revision), and the log is a core remote widget run in
  the UI worker (`sessionPage/coreWidgets.ts`). A private message is a plain row; it gets its own
  tables and its own small component.
- **Notifications are built** (PLAN-notifications phases 1+2): `raiseNotification({userIds, kind,
  regarding, href, vars})` (`server/notifications/store.ts:100`) with per-user dedupe on
  `regarding`, context-aware suppression through `covers(viewing, href)`
  (`shared/notifications/covers.ts:99`, which knows only lore, `/admin`, `/docs`, `/sessions/:id`),
  and `pushToUser` (`sockets/utils/userPush.ts`) to reach any user from anywhere.
- **One socket listener.** A new family gets ONE domain context provided by both shells
  (`Layout.svelte:1976`, `AccessibleShell.svelte:76`); the pilot is
  `client/contexts/characterImports.svelte.ts`. Views register listeners and never toast.
- **Rail.** Items are registered in `Layout.svelte` `panelsCtx.rightNav` (Play) / `leftNav`
  (Tune); conditional ones in the `$effect` at L709-771 (the `users` item is the model). The mount
  switch is the `sidebarView(key)` snippet (L3294-3336) and `shell/railViews.test.ts` fails if a
  key has no branch. Addresses are `shell/viewRoutes.ts` `VIEW_ROUTES` plus an empty
  `src/routes/<view>/+page.svelte`. Dots: `shell/railDots.ts` + Layout L1719-1763 (`activityDot`,
  `viewsDot`, `viewsLabel`). Phone: `BOTTOM_BAR_VIEWS` is sessions/characters/lorebooks; everything
  else is in the Views sheet, whose button carries the one combined dot (ruled 09-28 Q2).
- **Feature flags are columns** on the single `system_settings` row; copy
  `systemSettings:updateLoreWriteModeDefault` (`sockets/systemSettings.ts:366-394`) because it
  broadcasts `systemSettings:get` to every user's interested sockets, not only the admin's tabs.
  Admin card: `components/admin/pub/ScriptsCard.svelte` (36 lines); register in
  `shell/adminSettings.ts` `STATIC`.
- **Markdown for user-typed text:** `renderMarkdownWithQuotedText` is marked + DOMPurify defaults
  (`client/utils/markdownToHTML.ts:23`); `SpMessageBody.svelte:26-49` has the **STRICT** profile
  (no forms, media, style, ids; `target=_blank rel=noopener`; `img`/`href` limited to app media).
  Private text uses STRICT.
- **Migrations.** Journal max idx **101**; the next is **0102**, generated (`db:generate`).

## 2. Vocabulary (ruled Q1: plain words, qualified only where two things share a file)

| Word | Means | Note |
|---|---|---|
| **conversation** | One private room: its people and what they said. `conversations` table, socket family `conversations:`, view key `conversations`, address `/messages`. A **direct conversation** is exactly two people, unnamed, one per pair (`pair_key`); a **group conversation** is two or more, named, with a **host** (its creator). UI: the rail item **Messages**, **New conversation**. | The session-side `sessionMessages/conversation.svelte.ts` store keeps its name; context tells them apart (owner, Q1). Never *chat* (retired object word). |
| **message** | One thing a person wrote in a conversation. Table **`conversation_messages`** because `messages` (session lines) sits in the same schema file. In code outside the schema the bare word is fine where the module is already `conversations/`. | ⚠ Not a session message, which has parts; a conversation message has a body and attachments. |
| **attachment** | A session, character, lorebook or file carried with a message. Table **`conversation_attachments`**, `attachment kind` ∈ `session · character · lorebook · file`. UI: **Attach** (one button; the picker has tabs for all four kinds plus upload). | Reuses the tray family `attachments:` for uploads, which fits. A session message's file parts also say *attachment*; same idea, different table. |
| **share** | The explicit, revocable read grant one person gives another on a character or lorebook. Tables **`character_shares`**, **`lorebook_shares`**. UI: **Share…**, **Shared with**, **Shared with you**. | Sessions are never shared this way: guests only. The retired layout *share* (a grow track's twelfth) stays retired; §23 gets a one-line note that the word returns with this meaning only. |
| **host** | The person who made a group conversation: renames it, adds and removes people. `conversations.host_user_id`. One host; passes to the oldest member if the host leaves. | Qualify as **conversation host** where the widget/plugin host could be meant. |
| **people** | The roster a member may pick from: `conversations:people`. | Not *users* (the admin roster/table). |
| **person detail** | The read-only screen for one account seen by another member (§26 *detail*): name, `@username`, Admin badge, **Message**, and tabs of what the viewer may see of theirs. `conversations:person`. | Not a *profile* (an **export profile** is a lorebook export format, §16) and not the admin **Users** detail, which edits the account. |

Notification kind: `core:notification/conversation-message@1`, `regarding: conversation:<id>`,
href `/messages/<id>`. System setting column: `messaging_enabled`; admin card **Messages between
people**. Rail glyph `Icons.Mail` (`MessagesSquare` is the session messages widget, §22).

## 3. Data (one generated migration, **0102**)

```
conversations
  id identity · kind text CHECK(direct|group) · name text NULL (group only)
  host_user_id int FK users SET NULL (group only)
  pair_key text NULL UNIQUE  — "<loUserId>:<hiUserId>" for direct; the dedupe
  last_message_at timestamp NULL · created_at · updated_at
  CHECK ((kind='direct' AND name IS NULL AND host_user_id IS NULL AND pair_key IS NOT NULL)
      OR (kind='group' AND pair_key IS NULL))

conversation_members
  conversation_id FK conversations CASCADE · user_id FK users CASCADE · joined_at
  last_read_message_id int NULL  — canonical unread marker
  muted_at timestamp NULL
  UNIQUE (conversation_id, user_id) · INDEX (user_id)

conversation_messages
  id identity · conversation_id FK conversations CASCADE · author_user_id FK users SET NULL
  body text NOT NULL (≤ 8,000 chars, server-enforced) · is_edited bool
  deleted_at timestamp NULL  — tombstone; body emptied on delete
  created_at · updated_at
  INDEX (conversation_id, id)

conversation_attachments
  id identity · message_id FK conversation_messages CASCADE · ordinal int
  kind text CHECK(session|character|lorebook|file)
  subject_id int NOT NULL  — no FK, by the media provenance convention: a deleted
                             subject renders "No longer available", the message stands
  UNIQUE (message_id, ordinal)

character_shares  character_id FK characters CASCADE · user_id FK users CASCADE · shared_at
                  · UNIQUE (character_id, user_id)
lorebook_shares   lorebook_id FK lorebooks CASCADE · user_id FK users CASCADE · shared_at · UNIQUE

system_settings   + messaging_enabled bool NOT NULL DEFAULT true          (Q7)
files             + conversation_id int NULL  (provenance, no FK; bucket conversations/<id>/)
tray_items        session_id → NULL-able · + conversation_id int NULL FK conversations CASCADE
                  · CHECK (num_nonnulls(session_id, conversation_id) = 1)
```

Soft-deleted users (`users.is_deleted`) stay members so history keeps its author; the roster hides
them and `conversations:send` refuses into a direct conversation whose other half is deleted.
Deleting a user cascades membership and nulls authorship (rows read *Former member*).

Not stored: others' read receipts (only your own `last_read_message_id`), typing, online. See §8.

## 4. Server

`src/lib/server/conversations/`

- `store.ts` — every query is `WHERE EXISTS (member row for socket.user.id)`; ids are guessable
  integers and membership is the only authority. Admins get **no** bypass: an administrator who is
  not a member cannot list or read a conversation through the app. Documented plainly: the pub's
  disk is not encrypted; whoever runs the server can read its database.
  - `listFor(userId)` rows: `{id, kind, name, members[{id, username, displayName}], lastMessage
    {authorId, excerpt, at}, unread: count(id > last_read_message_id AND author ≠ me), mutedAt}`.
  - `open(userId, conversationId, before?, limit 50)` — a page of messages with attachments
    resolved to **attachment cards** (§6.4), each gated for the *asker* (Q6: a later-joined member
    who cannot see an old attachment gets `{kind, available: false}`; the text is always theirs).
  - `create(userId, memberIds, name?)` — one other id and no name → direct (upsert on `pair_key`,
    returns the existing row); otherwise group with `host_user_id = userId`. Every id must be in
    the asker's **people** roster and not deleted.
  - `send(userId, conversationId, body, attachments[], trayItemIds[])` — one transaction (`tx`
    only): gate every attachment (§5), move tray items to `files.conversation_id` as `file`
    attachments, insert, bump `last_message_at`, set the author's own `last_read_message_id`.
    Then, outside the transaction: `pushToUser(memberId, "conversations:message", {…})` for every
    member and `raiseNotification` for every member except the author and the muted (§7).
  - `edit` / `remove` (own message only; remove = tombstone), `markRead(userId, conversationId,
    upTo)`, `rename` / `addMembers` / `removeMember` (host only), `leave` (host leaving passes host
    to the oldest remaining member; the last member leaving deletes the conversation),
    `mute` / `unmute`.
  - `people(userId)` — `{id, username, displayName}` of every non-deleted account except the
    asker, when `messaging_enabled` (Q2).
  - `attachable(userId, conversationId, kind, q)` — candidates the asker can see **and** every
    current member can see (§5), by title filter, ≤ 25.
  - `person(viewerId, userId)` — `{id, username, displayName, isAdmin, lastSeen?: null}` plus
    what the viewer may see of theirs, each through the §5 helpers with the **viewer** as the
    subject: `sessions` (owned by them where the viewer is owner or guest, i.e.
    `session_guests` either way round), `characters` (owned by them and `canViewCharacter(viewer)`:
    shared with the viewer, or cast/voice in a session the viewer can open), `lorebooks` (owned by
    them and `canViewLorebook(viewer)`: shared with the viewer). Each row is `{id, title, subtitle,
    avatar?}`, capped at 100 per tab, owned-by-them only (never things *they* can merely see).
    Refuses with one wording unless the target is in the viewer's `people` roster.
- `gate.ts` — `canAttach(kind, subjectId, userIds[]) → {ok} | {ok:false, blockedBy: userId[]}`
  (§5). Pure over the existing access helpers; unit-tested with fixtures.
- Socket family `src/lib/server/sockets/conversations.ts`,
  `registerConversationHandlers(socket, emitToUser, register)` wired in `sockets/index.ts` beside
  notifications (L332). Every handler re-checks `messaging_enabled` and `is_accounts_enabled`
  (`requireAccountsEnabled` pattern) and throws `Unauthorized` for non-members with one wording,
  so a refusal never confirms a conversation exists. Requests reply on their own name, errors on
  `<event>:error`, `refusable` for worded refusals:
  `conversations:list` · `:open {conversationId, before?}` · `:create` · `:send` · `:edit` ·
  `:remove` · `:read {conversationId, upTo}` · `:rename` · `:addMembers` · `:removeMember` ·
  `:leave` · `:mute {conversationId, muted}` · `:people` · `:attachable {conversationId, kind, q}`
  · `:person {userId}`
  Pushes: `conversations:message {conversationId, message}` (new/edited/removed; scoped by
  `conversationId` in `SCOPED_EVENTS`), `conversations:changed {conversationId}` (membership,
  name, left — client re-lists).
  Born gated: `GATED_EVENTS` (success events only), `MIGRATED_FAMILIES`, `typedSocket.ts`
  `SocketEventMap`, types in `shared/sockets/conversations.ts`.
- Uploads: `attachments:begin|chunk|finish|list|remove` accept `{conversationId}` in place of
  `{sessionId}`; the access check becomes `sessionId ? checkSessionAccess : isMember`.
  `finishTrayUpload` passes `conversationId` to `createMedia`, which writes under
  `data/users/<uid>/conversations/<id>/{hash}.{ext}` (`media/paths.ts` gains the bucket). Caps
  reused unchanged; `files.visibility` stays `scoped`.
- `canViewMedia` (`media/access.ts`) gains, after the owner branch: `file.conversationId` → the
  viewer is a member. Attaching **existing** media (a session image, say) changes nothing there:
  the gate already proved every member passes `canViewMedia`, and serving re-checks per viewer.
- System setting: `systemSettings:updateMessagingEnabled {enabled}` on the
  `updateLoreWriteModeDefault` pattern (admin check → update → broadcast `systemSettings:get` to
  all interested sockets). Off hides the rail item everywhere and makes every `conversations:*`
  handler refuse; data stays.
- Shares: `characters:share {characterId, userIds}` / `lorebooks:share {lorebookId, userIds}`
  (replace-set, owner only, ids from `people`); `characters:get` / `lorebooks:get` return
  `sharedWith[]` to the owner and `isSharedWithMe` to a recipient. `canViewCharacter` gains a
  share branch; **`canViewLorebook(id, userId)`** is new in `utils/ownedBook.ts` (owner · shared ·
  the existing admin exception) and every lorebook **read** path moves to it while every **write**
  keeps `assertOwnedBook`. R58 is unchanged for **session guests**, who are not share recipients.
  Jump's character and lorebook searches include shared items for recipients.
  `sockets/sprites.ts`, `mayListGallery` and `lorebooks:bindingsForCharacter` already route
  through `canViewCharacter` and follow.
- `ManagedService` not needed: nothing runs at boot. Retention: none in this plan (§8).

## 5. The attachment gate

One rule, applied at **send** for the whole conversation and at **read** for the asker:

| kind | a person may see it when | helper |
|---|---|---|
| `session` | they are its owner or a guest | `checkSessionAccess(id, userId).hasAccess` |
| `character` | owner · in a session they can open · **shared** with them | `canViewCharacter` + share branch |
| `lorebook` | owner · **shared** with them (admin exception stays) | `canViewLorebook` |
| `file` | `canViewMedia` says so (owner · session · character · referenced · conversation member) | `canViewMedia` |

- `conversations:send` runs the gate for **every current member**. Any failure refuses the whole
  send with a worded refusal naming the people: *Nia and Tomas can't see "The Long Night". Add
  them as guests first, or send without it.* The client shows this inline under the composer,
  never as a toast (`HANDLED_ERROR_EVENTS`).
- `conversations:attachable` pre-filters with the same gate so the picker only offers what will
  pass; the refusal is for the race (a guest removed between pick and send).
- Membership changes do **not** re-gate history (Q6): a person added later sees *Not shared with
  you* on an attachment they cannot open; a person whose access is later revoked sees the same
  from then on, because `open` gates per asker at read time. The text stands.
- The gate never **creates** access. Attaching a session does not add guests; attaching a
  character does not share it. Sessions are guest-only: the only way to make one attachable to
  someone is the owner adding them as a guest in the session's settings (`sessions:addGuest`),
  and the refusal says so.

## 6. Client

### 6.1 Domain context (the one listener)

`src/lib/client/contexts/conversations.svelte.ts` — `provideConversations()` in both shells;
`useInterest` for `conversations:list`, `:message`, `:changed`, `:send:error` …; holds
`conversations` (`$state`), `unreadTotal` / `unreadIds` (`$derived`), `messagesOf(id)` pages,
pending sends; `onMessage(listener)` / `onChanged(listener)` helpers that release on unmount. It
toasts nothing (a new message is a notification row and a dot, never a toast). Re-lists on
reconnect like `notifications.connect()` (Layout L1947).

### 6.2 Rail and addresses

- Rail item **Messages** (`Icons.Mail`), key `conversations`, in `rightNav` so it sits in **Play**
  after Sessions, Characters, Lorebooks (append to `CONTENT_ORDER`). Registered in the L709
  `$effect` when `isAccountsEnabled && settings.messagingEnabled`; never on Android.
- `VIEW_ROUTES.conversations = "/messages"`, `src/routes/messages/+page.svelte` (title only), and
  `/messages/<id>` through `TREE_VIEWS` + `registerViewAddress` like admin/help so Focus and the
  notification href land on one conversation. `openHref` learns the shape.
- Dot: `railDots.ts` gains `unreadMessages: number`; the Messages item draws a **primary** dot
  when `unreadTotal > 0`, aria-label *Messages, 3 unread*. `viewsDot` / `viewsLabel` fold it in
  for the phone. The Activity dot is unchanged: a `conversation-message` row is `attention`, so
  both light the same colour from the same moment (§7).
- Jump: no new jump kind in this plan.

### 6.3 The view — `components/sidebars/ConversationsSidebar.svelte`

A list-with-detail view on `PanelSplit`, 380px list (rows carry faces), STYLE-GUIDE §5.2 exactly:
root `flex h-full min-h-0 flex-col` + `ViewModeTracker`, toolbar in `toolbar`, scroller in `list`.

**List column.** View toolbar: primary **New conversation** (people picker, §6.5), find row
filters by name or member. Rows (`SidebarListItem`): `AvatarStack` of the *other* members
(initials; a direct conversation shows one 40px face), a 15px name (group name, or the other
person's display name), a 12px muted `Author: excerpt` line, relative time at the right with a
6px primary dot before it when unread, a muted `BellOff` glyph when muted. Groups under
`ListGroupLabel`: **Unread** · **Recent** · **Older**. Empty state (STYLE-GUIDE §6.7): *No messages yet.
Start one with New conversation.* When `people` is empty: *Nobody else has an account on this
pub yet*, with a link to Users for admins.

**Detail.** `PanelNavHeader` (back when compact) with the name and a `⋯` `RowMenu`: **Rename**,
**Add people**, **Mute** / **Unmute**, **Leave** (host: also **Remove …** per member in a members
sheet). Under it a one-line member strip (`xs` faces + names, overflow `+N`). Then the **log**:
a scroller (no padding on the scroller, margin on the inner wrapper, ruling 10-11), oldest at
top, newest at bottom, pinned to the bottom when you were there, **Load earlier** at the top
(50 per page). **Ruled Q5: uniform rows, no bubbles, no own-side alignment.** A **message row**
is one recipe for everybody, yours included: a `md` round initial face, the name at 14px medium
with the time at 12px muted, the body rendered from markdown with the STRICT profile, then
attachment cards. Consecutive messages by one author within five minutes collapse the face and
name. Edited shows a muted *edited*; a tombstone reads *Message removed* in muted italics. Own
rows have a `⋯` with **Edit** / **Remove**.

**Composer**, pinned at the bottom of the detail: a growing textarea (1–8 lines), **Attach**
(§6.5), **Send** (primary icon button; Enter sends on desktop, Shift+Enter newlines; on touch
only the button sends). Chips above the field for picked attachments and uploads in progress
(remove `×`, same caps as the session composer). Inline refusal line under the field (§5).
Drafts live per conversation in the context, not persisted.

**Reading marks.** The context marks a conversation read (`conversations:read {upTo}`) when its
detail is open, the view is active, the document is visible and focused, after a 1.5 s dwell
(reuse `autoRead.svelte.ts`'s dwell). The server's `markRead` also clears the
`conversation:<id>` notification `viewed`.

### 6.4 Attachment cards

One component, `ConversationAttachmentCard`, a 56px row at radius 10 on `surface-200-800`: a face
or icon (`Avatar` for a character; `AvatarStack` of cast for a session; `BookOpen` tile for a
lorebook; a thumbnail or `FileText` tile for a file), a 14px title, a 12px muted kind line
(*Session · Lair*, *Character*, *Lorebook*, *PNG · 1.2 MB*). Click opens the thing exactly as a
Jump hit does (`openJumpHit.ts:93-170`: session → `goto`, character → `digest.viewCharacterId`,
lorebook → `digest.lore`); a file opens `/media/<uuid>` (image: inline preview capped at 320px,
click for full; other kinds `?download=1`). Unavailable: the same card dimmed, *Not shared with
you* / *No longer available*, not clickable.

### 6.5 Pickers

- **People picker** — `UserSelectModal` exists but calls the admin-only `users:list`; give it a
  `source` prop (`"users:list" | "conversations:people"`) rather than a second modal. Multi-select;
  one person → direct, several → asks for a **Name** (optional; default the names joined).
  Follow-up from Q2: `EditSessionForm`'s guest picker uses `source="conversations:people"` so
  non-admin session owners can finally add guests.
- **Attach picker** — a `PanelTabStrip` of **Files · Sessions · Characters · Lorebooks**. Files
  has the upload button (tray) and lists your own media the gate passes, recent first; the other
  tabs filter through `conversations:attachable`, rows on `CharacterPickRow`'s recipe (face,
  title, subtitle). A chosen item becomes a chip above the composer.

### 6.6 Person detail

Where a person's face or name appears to another member, it is a button that opens their
**person detail**: the member strip and message rows in a conversation, the people picker's
rows, a session's guest list in its settings, the owner line on a shared character or lorebook
(`ownerName` already comes back from `characters:get`). For admins the **Users** view keeps its
own editing detail; the person detail is the member-facing one and admins get it too from the
same entry points.

It opens as the detail pane of the Messages view (`panelsCtx.digest.viewPersonId = id`, then
`openView("conversations")`, the `viewCharacterId` pattern), address `/messages/people/<id>`
through the same `TREE_VIEWS` registration, so Jump hits and hrefs can land on it later.

Layout, STYLE-GUIDE §6.4: `PanelNavHeader` → `DetailHero` (72px initial tile, display name at
18px, `@username` muted, an **Admin** chip where true) → the one primary **Message** (opens or
creates the direct conversation and switches the pane to it) → `PanelTabStrip` **Sessions ·
Characters · Lorebooks**, each tab a list of `SidebarListItem` rows (session: faces + name +
genre; character: face + name; lorebook: `BookOpen` tile + name + entry count), from
`conversations:person`. A row opens the thing exactly as an attachment card does (§6.4). Empty tab:
*Nothing of Aria's is shared with you* / *You're not in any of Aria's sessions*. Counts in the tab
labels are copy, not pills (STYLE-GUIDE :920). Nothing here is editable; sharing is done from the
owner's side (§6.7), never from a person detail.

### 6.7 Sharing (ruled Q3: a share grants **read and copy**; Q4: read-only lorebook workspace now)

- **Characters view** — detail `⋯` gains **Share…** (owner only): the people picker in
  multi-select with current recipients pre-ticked; unticking revokes. A **Shared with** line under
  `DetailHero` lists recipients as `xs` faces. The list column gains a group **Shared with you**
  (`ListGroupLabel`). A shared character's detail is **read-only**: no Edit, Delete, gallery or
  sprite writes, no Share…; its `⋯` offers **Copy to my characters** (a full card copy under the
  recipient's account, avatar media duplicated, no link back) and **Export card**. A shared
  character is **not** pickable as cast or voice directly — copy first.
- **Lorebooks view** — book `⋯` gains **Share…**; the shelf gains **Shared with you**, which opens
  the book **read-only** in the full workspace: every lens renders, every write verb is hidden or
  disabled (entries, cast, places, time, graph, scenes, branches, amendments, settings, scripts).
  Its `⋯` offers **Duplicate** (an owned copy, the existing full-copy path) and nothing else.
  A shared book cannot be read into the recipient's session (world state lives on the lorebook;
  writes would land in the owner's world) — Duplicate is the path, and the session's lorebook
  picker lists only owned books.
- Read-only workspace mechanics: one `bookAccess: 'owner' | 'shared' | 'admin'` on `BookData` (the wire word; `readOnly = bookAccess !== 'owner'`) (the
  lorebooks reading contract), every lens reads it; a shared `readOnly` derived in the lorebook
  context; the server refuses writes with `assertOwnedBook` regardless, so the client gate is
  presentation only. An **audit lane** walks every write verb per lens before the UI lane hides
  them (the lorebook workspace has never had a reader).
- Revoking a share removes the item from the recipient's lists on the next `changed` push and
  makes any attachment of it read *Not shared with you* for them.

## 7. Notifications

- Kind `CONVERSATION_MESSAGE = defineNotificationKind({ id:
  "core:notification/conversation-message@1", level: "attention", clearsOn: "view", title:
  "{author} in {conversation}", detail: "{excerpt}", cta: "Open" })`, `regarding:
  conversation:<id>` so a burst is one row that re-lights, href `/messages/<id>`. Raised for every
  member except the author and anyone with `muted_at`.
- `covers.ts` gains `/messages/:id` (path match, as `/sessions/:id`), so a message arriving while
  that conversation is open and focused is suppressed at raise.
- Cleared `viewed` by `markRead`.

## 8. Out of this plan (named so nobody builds them by accident)

User pictures (no column; initials everywhere) · online/away marks (no tracking exists;
`socketsInUserRoom` is the fact if ever wanted) · typing indicators · others' read receipts ·
@mentions · reactions · search inside conversations · retention/pruning · admin moderation or
oversight · Document View page (follow PLAN-notifications phase 3 later) · browser/OS
notifications (phase 4 there) · plugin access to conversations (R53 posture: none) · export ·
sharing with *everyone on the pub* (a `user_id NULL` row would do it later) · using a shared
character directly as cast (copy first, Q3).

## 9. Owner rulings (answered 2026-10-12)

- **Q1 — Words:** plain set **conversation · message · attachment · share**, qualified only where
  two things sit in the same file (`conversation_messages`, `conversation_attachments`). The owner
  rejected the first draft's distinctive set (`snug · missive · enclosure · lend`) as "too granular
  about name collisions across contexts".
- **Q2 — Roster:** yes, every signed-in member sees every account's username and display name
  through `conversations:people` while messaging is on. Follow-up: non-admin session owners get
  the same picker for guests.
- **Q3 — What a share grants:** **read and copy**, both kinds. Character: read-only detail +
  Copy to my characters + Export card; not usable as cast until copied. Lorebook: read-only
  workspace + Duplicate; never read into the recipient's session.
- **Q4 — Lorebook scope:** gate, Share…, Duplicate **and the read-only workspace, all now**
  (phase 3, with an audit lane first).
- **Q5 — Log look:** uniform rows, no bubbles.
- **Q6 — History:** new members see the whole history; attachments gated per reader.
- **Q7 — Default:** `messaging_enabled` defaults **on** once accounts are on.

## 10. Phases (narrow lanes, 3–4 in parallel, one grouped verification at the end)

1. **Foundation.** Schema + 0102 · `conversations/store.ts` + `gate.ts` (session/character/file
   branches) · socket family born gated + `shared/sockets/conversations.ts` + typedSocket ·
   `contexts/conversations` in both shells · rail item, address, dots, Views dot ·
   `ConversationsSidebar` list + detail + composer (text only) · **person detail** (`:person`,
   hero, Message button, Sessions tab; Characters/Lorebooks tabs show session-visible characters
   now and shared items once phase 3 lands) · people picker source (+ the
   session guest picker follow-up) · `conversation-message` kind + `covers` rule · setting
   column, handler, admin card, `adminSettings` row · docs `docs/messages.md` + lines in
   `getting-around.md` and `users-and-accounts.md` · NOMENCLATURE §2/§23 note/§25/§26 rows ·
   STYLE-GUIDE §6 message row + attachment card.
2. **Attachments and uploads.** Tray scope (`tray_items.conversation_id`, nullable `session_id`)
   · `files.conversation_id` + paths bucket · `canViewMedia` branch · `conversations:attachable` ·
   Attach picker and chips · `ConversationAttachmentCard` + open behaviour · gate refusal wording
   and the inline line.
3. **Sharing.** `character_shares` / `lorebook_shares` (in 0102 if phases 1–3 land as one change;
   otherwise 0103) · `canViewCharacter` branch, `canViewLorebook` and the read/write split in
   every lorebook handler · `characters:share` / `lorebooks:share` · Share… + Shared with ·
   **Shared with you** groups · read-only character detail + Copy to my characters · **lorebook
   write-verb audit** (one lane, list per lens) → read-only workspace (`bookAccess`) · Jump
   includes shared · gate's lorebook branch · docs `characters.md` / `lorebooks.md` **Sharing**
   sections.
4. **Later.** Document View page · user pictures · the §8 list as separately planned items.

Tests per lane: store int tests (membership scoping, `pair_key` dedupe, host hand-over,
tombstone), `gate.test.ts` fixtures per kind × member outcome, `gatedEvents`/`scopedReplies`
registry tests, `railViews.test.ts` + `railDots.test.ts`, `covers.test.ts` `/messages/:id`,
`canViewMedia` branch, tray scope CHECK, share branches in `sessionAccess`/`ownedBook` tests,
every lorebook write handler refusing a reader, `adminSettings.test.ts` target. Full suites,
svelte-check and tsc once after all lanes; browser walk on an isolated instance with two accounts
(direct, group, attachment refusal, upload, share → attachable, read-only book, person detail
tabs before and after a share).
