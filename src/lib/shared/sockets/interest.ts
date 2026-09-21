/**
 * Socket interest — the shared contract between the client's interest
 * registry and the server's interest gate.
 *
 * **Interest** is a client's declared wish to receive one kind of event.
 * The client keeps ONE registry of it (`client/sockets/interest.svelte.ts`),
 * tells the server its full key list (`interest:sync`), and the server keeps
 * a per-socket **interest set**. Reply helpers consult that set — the
 * **interest gate** — before running a query or emitting a **gated event**.
 *
 * It is not a *lease*: that word means a model permission (NOMENCLATURE §10).
 * Interest never expires from silence; it ends when the socket disconnects.
 *
 * Every constant here is read by both sides, which is why it lives under
 * `shared/`.
 */

/** `event` or `event#scope`, e.g. `sessions:streamChunk#42`. */
export type InterestKey = string

/** Separator between the event name and an optional scope id. */
export const INTEREST_SCOPE_SEPARATOR = "#"

export function interestKey(
	event: string,
	scope?: string | number | null
): InterestKey {
	return scope == null || scope === ""
		? event
		: `${event}${INTEREST_SCOPE_SEPARATOR}${scope}`
}

export function parseInterestKey(key: InterestKey): {
	event: string
	scope: string | null
} {
	const at = key.indexOf(INTEREST_SCOPE_SEPARATOR)
	return at === -1
		? { event: key, scope: null }
		: { event: key.slice(0, at), scope: key.slice(at + 1) }
}

/** Where one scoped event keeps its scope. `null`/`undefined` means "not this one". */
export type InterestScopeExtractor = (
	payload: any
) => string | number | null | undefined

/**
 * Where each scoped event's **interest scope** lives in its payload.
 *
 * This is the ONE extractor both sides use: the client fans a payload out to
 * `event#scope` subscribers with it, and the server reads the same field to
 * decide who wants the push. That is the whole point of the table — a client
 * that guesses a scope the server does not extract (or a server that extracts
 * one no client spells the same way) receives nothing at all, with no error
 * anywhere to say so. One table, read by both, is what makes that mismatch
 * impossible to introduce in one half.
 *
 * An event NOT listed here has no scope: every client declaring it gets every
 * payload, exactly as before scopes existed. Adding an entry is therefore safe
 * on its own — a bare declaration still matches every scope (see
 * `GATED_EVENTS` below) — and only a consumer that starts declaring
 * `event#id` narrows anything.
 *
 * ⚠ Each entry must name the field the SERVER actually broadcasts, not the one
 * the event is named after. `sessions:get` is the example: its payload carries
 * the session on `session.id`, so an extractor reading only `payload.sessionId`
 * here would return null for every successful reply and a `sessions:get#42` key
 * would match nothing. It reads BOTH, because the one reply with no session in
 * it carries the requested id beside the null instead.
 */
export const SCOPED_EVENTS: ReadonlyMap<string, InterestScopeExtractor> =
	new Map<string, InterestScopeExtractor>([
		// The streaming push: one row per chunk, broadcast to the session's
		// users. The scope is the row's own session, which every caller passes
		// a full `sessionMessages` row for.
		["sessionMessage", (payload) => payload?.sessionMessage?.sessionId],

		// `{ sessionId }` and nothing else — the signal to re-read state.
		["state:changed", (payload) => payload?.sessionId],

		// The session itself, so the id is normally on the row rather than
		// beside it. A NOT-FOUND reply has no session to read an id off, so the
		// server puts the requested id on `sessionId` for exactly that case
		// (`Sockets.Sessions.Get.Response`) and this falls through to it —
		// otherwise a view would have to hold a bare `sessions:get` to hear
		// "not found", and a bare key matches every other session's reply too.
		[
			"sessions:get",
			(payload) => payload?.session?.id ?? payload?.sessionId
		],

		// `{ sessionId, personaId, personaName }`.
		["sessions:userTyping", (payload) => payload?.sessionId],

		// `{ sessionId, runId, status }` — a run's status changed or ended
		// (R-19). The sessions sidebar declares it BARE (every session it
		// lists); a session page may declare its own scope.
		["sessions:runStatus", (payload) => payload?.sessionId],

		// `{ sessionId, messageCount, lastMessage, updatedAt }` — the session's
		// list row moved. The sessions sidebar and the home page both declare
		// it BARE (every session they list); a session page may declare its
		// own scope.
		["sessions:rowChanged", (payload) => payload?.sessionId],

		// `{ sessionId, channel, venues }` — the session's action list (U5e):
		// the reply to `sessions:actions` and the push every finished run
		// makes (`pushSessionActions`). A session page declares its own
		// scope, so a tab on another session is neither sent this one's list
		// nor has one built for it.
		["sessions:actions", (payload) => payload?.sessionId],

		// The run's progress card, pushed from three places — the reply path
		// (`server/utils/runReply.ts`: one `runStarted`, then a
		// `progress` per stage) and the triggered-function path
		// (`server/sockets/sessions.ts`: `runStarted`, the throttled
		// `onProgress` sink, and the terminal `{ done: true }` in its `finally`,
		// which carries `sessionId` exactly like the others). Every emit builds
		// its payload around a top-level `sessionId` beside the `runId`, so a
		// tab reading another session is not shown this one's card.
		["pipelines:runStarted", (payload) => payload?.sessionId],
		["pipelines:progress", (payload) => payload?.sessionId],

		// Cast (slice 4). The entity rides the reply; a NOT-FOUND reply carries
		// the requested id beside its null, the `sessions:get` treatment.
		[
			"characters:get",
			(payload) => payload?.character?.id ?? payload?.characterId
		],
		// Gallery replies and cascades carry the owner id top-level.
		["characters:listGallery", (payload) => payload?.characterId],
		["characters:uploadGalleryImage", (payload) => payload?.characterId],
		["characters:deleteGalleryImage", (payload) => payload?.characterId],
		// `characters:setFolder` answers with the character it moved, so a
		// panel open on one character hears about that one and no other. The
		// id is top-level beside the ack, the not-found treatment.
		["characters:setFolder", (payload) => payload?.characterId],

		// Content (slice 5). A book's replies and cascades carry `lorebookId`
		// top-level; an entry row carries its book on `entry.lorebookId`; a
		// NOT-FOUND `lorebooks:get` echoes the requested id beside its null.
		["lorebooks:bindingList", (payload) => payload?.lorebookId],
		[
			"lorebooks:get",
			(payload) => payload?.lorebook?.id ?? payload?.lorebookId
		],
		["entries:list", (payload) => payload?.lorebookId],
		["entries:counts", (payload) => payload?.lorebookId],
		["entries:recentDecisions", (payload) => payload?.lorebookId],
		["entries:delete", (payload) => payload?.lorebookId],
		["entries:create", (payload) => payload?.entry?.lorebookId],
		["entries:update", (payload) => payload?.entry?.lorebookId],
		["entries:iterateNext", (payload) => payload?.entry?.lorebookId],
		["bindingSuggestions:list", (payload) => payload?.lorebookId],
		// `{ lorebookId, sessionId, unboundEntities, orphanedBindings }`.
		["bindingCheck:result", (payload) => payload?.sessionId],

		// Session-adjacent (slice 6): declared by the lorebook workspaces and
		// the session page ahead of that slice's gating. `scenes:list` and
		// `scenes:scenedMessageIds` carry `sessionId` once the server puts it
		// on the reply; `scenes:compile:progress` carries `historyEntryId`
		// likewise. Until then the extractor answers null and a scoped
		// subscriber hears nothing — a bare one hears everything.
		["scenes:listByLorebook", (payload) => payload?.lorebookId],
		["scenes:list", (payload) => payload?.sessionId],
		["scenes:scenedMessageIds", (payload) => payload?.sessionId],
		["scenes:process:progress", (payload) => payload?.sceneId],
		["scenes:process:complete", (payload) => payload?.sceneId],
		["scenes:process:error", (payload) => payload?.sceneId],
		["scenes:compile:progress", (payload) => payload?.historyEntryId],
		["scenes:compile:complete", (payload) => payload?.historyEntryId],
		["narrativeGraph:list", (payload) => payload?.lorebookId],
		[
			"narrativeGraph:duplicateCandidates",
			(payload) => payload?.lorebookId
		],
		["narrativeGraph:listMergeLogs", (payload) => payload?.lorebookId],
		["vectorization:itemUpdated", (payload) => payload?.lorebookId],
		// `{ id, uuid, rev, frame }` — the media row that changed.
		["media:changed", (payload) => payload?.id],
		// The admin plugins page opens one plugin's panel at a time.
		["plugins:permissions", (payload) => payload?.pluginId],
		["plugins:getSettings", (payload) => payload?.pluginId],

		// Connections (slice 8). The document-view edit page opens one
		// endpoint; the success reply carries it on `connection.id`. Not-found
		// is an `error` throw in this handler rather than a null reply, so
		// there is no id to echo beside a null — the `sessions:get` fallback
		// is kept for the day one is added.
		[
			"connections:get",
			(payload) => payload?.connection?.id ?? payload?.connectionId
		]
	])

/** Does this event carry a scope the two sides can agree on? */
export function isScopedEvent(event: string): boolean {
	return SCOPED_EVENTS.has(event)
}

/**
 * The interest scope this payload is about, as a string, or null.
 *
 * Always a string when there is one, because an interest key is text: a scope
 * extracted as the number 42 and a scope declared as the string "42" have to be
 * the same key or the gate closes on a client that is listening.
 */
export function scopeOfPayload(event: string, payload: unknown): string | null {
	const extract = SCOPED_EVENTS.get(event)
	if (!extract) return null
	const raw = extract(payload)
	if (typeof raw === "number")
		return Number.isFinite(raw) ? String(raw) : null
	if (typeof raw === "string") return raw === "" ? null : raw
	return null
}

/**
 * Event namespaces whose handlers are admin-only, every one of them.
 * A key under one of these is **restricted interest**: the client registry
 * refuses to declare it for a non-admin, and the server drops it from a
 * non-admin socket's sync. Defence in depth — the handlers' own admin checks
 * remain the boundary.
 *
 * Only whole families belong here. A family with even one non-admin reader
 * (e.g. `connections:` — reads are for everyone, writes are admin) must NOT
 * be listed, or non-admins go dark on it.
 *
 * ⚠ A family listed here takes its `{event}:error` events with it, since they
 * carry the same prefix. That is the intended reading — a non-admin who cannot
 * hold the key has no surface that emits the request either (ruling 6b) — but
 * it is why the bar for listing one is EVERY handler, not most of them.
 *
 * ## Verified 2026-09-14, handler by handler
 *
 * Kept — every handler in the namespace refuses a non-admin:
 *   - `backups:`      `sockets/backups.ts`, 3 handlers, all `requireAdmin`.
 *   - `tunnels:`      `sockets/tunnels.ts`, 4 handlers, all `isAdmin`.
 *   - `allowedHosts:` `sockets/allowedHosts.ts`, 1 handler, `isAdmin`. There is
 *                     no write handler at all — see that file on why.
 *   - `invites:`      `sockets/invites.ts`, 3 handlers, all `isAdmin`.
 *
 * Added — same check, same result:
 *   - `koboldcpp:`    `sockets/koboldcpp.ts`, 34 handlers, all `isAdmin`; the
 *                     three progress/status emitters are registered only when
 *                     `socket.user?.isAdmin`. (Its two `systemSettings:update…`
 *                     handlers live in that file but are not in this family.)
 *   - `ollama:`       `sockets/ollama.ts`, 13 handlers, all `isAdmin`.
 *   - `ner:`          `sockets/ner.ts`, 1 handler (`ner:status`), `isAdmin`.
 *   - `plugins:`      `sockets/plugins.ts`, 17 handlers, all `requireAdmin`.
 *   - `sessionGenres:` `sockets/sessionAdmin.ts`, 3 handlers, all `adminOnly`.
 *
 * Removed:
 *   - `sessionAdmin:` matched NOTHING. No event in the application is spelled
 *     that way; `sockets/sessionAdmin.ts` registers `sessionGenres:*`,
 *     `sessionPresets:*` and `sessions:adminList`. Replaced by
 *     `sessionGenres:`, the part of it that is wholly admin-only.
 *   - `activity:` is every user's OWN activity stream —
 *     `activityStore.getFor(userId, isAdmin)`, and dismiss/cancel accept the
 *     owner. Restricting it would blind every non-admin to their own cards.
 *
 * Rejected, with the handler that disqualifies each:
 *   - `systemSettings:`  `systemSettings:get` has no role check; every client
 *                        reads it.
 *   - `vectorization:`   `vectorization:checkRagStatus` and
 *                        `…:setSessionRagIgnored` have no role check.
 *   - `users:`           `users:current`, `users:setTheme`, `users:current:*`
 *                        are self-service.
 *   - `totp:`            everything but `totp:adminClear` is self-service.
 *   - `sessionPresets:`  `sessionPresets:list` deliberately serves a non-admin
 *                        the filtered picker list.
 *   - `pipelines:` — mixed by design.
 *   - `connections:`  every one of its 19 handlers refuses a non-admin today
 *                     (11 inline, 3 via `connectionScriptsGate`, 5 via
 *                     `modelGate`), so it would pass the handler test — but
 *                     it is kept OFF the list by ruling (the connections
 *                     handover, 2026-09-15): session-side surfaces such as
 *                     `EditSessionForm` hold `connections:list` under their
 *                     own admin guard, and a family that a non-admin view can
 *                     legitimately ask about must not be one the registry
 *                     refuses outright. Revisit only with a ruling.
 */
export const RESTRICTED_INTEREST_PREFIXES: readonly string[] = [
	"backups:",
	"tunnels:",
	"allowedHosts:",
	"invites:",
	"koboldcpp:",
	"ollama:",
	"ner:",
	"plugins:",
	"sessionGenres:",
	// Slice 6/7 (2026-09-15), every handler verified admin-only. `images:` is
	// NOT here: `profileSchema` needs only a login and `cancel` only ownership.
	"import:",
	"taskQueue:",
	"worldSummarizeConfigs:",
	"sceneSummarizeConfigs:",
	"characterSummarizeConfigs:",
	"completionTemplates:",
	"contextConfigs:",
	"promptConfigs:",
	"narratorPromptConfigs:",
	"graphBuildConfigs:",
	"samplingConfigs:",
	// Slice 8 (2026-09-15): `sockets/connectionDefaults.ts`, 2 handlers, both
	// `requireAdmin`; no read-shaped surface exists for anyone else.
	"connectionDefaults:"
]

export function isRestrictedInterest(key: InterestKey): boolean {
	return RESTRICTED_INTEREST_PREFIXES.some((p) => key.startsWith(p))
}

/**
 * Events the interest gate applies to. Everything NOT listed keeps the room
 * emit it has today, so the migration has no dark period.
 *
 * ## The three rules for adding one
 *
 * 1. **Never gate an `:error` event.** `client/components/Layout.svelte`'s
 *    `socket.onAny(handleAnyEvent)` toasts every otherwise-unhandled
 *    `*:error`, and a catch-all declares interest in nothing. A gated error
 *    event would therefore reach a client that has no specific listener as
 *    silence — the one failure a request cannot recover from (plan ruling 2:
 *    gate outputs, never failures). Only SUCCESS events belong here.
 * 2. **Only when the LAST consumer is on the registry.** A consumer still on
 *    `socket.on` declares nothing, so gating its event makes it go dark.
 *    Every entry below names the file(s) that consume it; adding an entry
 *    means having grepped `on("<family>:` across `src/lib/client` and
 *    `src/routes` first.
 * 3. **Grouped by family, with its consumers on one line.** The group is the
 *    unit a later slice extends and the unit a reviewer checks.
 * 4. **A scoped event is gated per scope.** A client wanting one session
 *    declares `event#id`; a bare declaration means every scope. The scope comes
 *    from `SCOPED_EVENTS` above on both sides, so an event listed there is
 *    gated for the scope its payload names — and an event with no entry is
 *    gated for all of them, which is what every event added before phase 3 is.
 *
 * ## Phase 2, slice 1 (2026-09-14)
 *
 * `state:configure` flows through the same `settled()` helper as the four
 * state writes below and its consumer is on the registry too, but nothing in
 * the application sends it yet — left ungated until it has a caller.
 */
export const GATED_EVENTS: ReadonlySet<string> = new Set<string>([
	// language: — consumers: client/i18n/state.svelte.ts (the UI translation
	// runtime; the shells' `registerLanguageSocket` is the same module).
	"language:catalog",

	// widgetStyles: — consumers: client/stores/widgetStyles.svelte.ts.
	// `:update` and `:delete` have no listener at all — the store reads the
	// re-sent `:list` instead — so gating them skips a reply nobody ever read.
	"widgetStyles:list",
	"widgetStyles:create",
	"widgetStyles:update",
	"widgetStyles:delete",
	"widgetStyles:clone",

	// state: — consumers: client/state/sessionState.svelte.ts.
	// `state:changed` is SCOPED (see `SCOPED_EVENTS`): the store declares
	// `state:changed#<sessionId>` for the session it has open, so a tab looking
	// at another session is not asked to re-read this one's state — and the
	// two roster reads behind the broadcast are skipped when no tab anywhere
	// has that session open.
	"state:get",
	"state:ledger",
	"state:proposals",
	"state:changed",
	"state:set",
	"state:give",
	"state:take",
	"state:transfer",
	"state:decide",

	// backups: — consumers:
	// client/components/settingsTabs/DataSettingsTab.svelte (Settings → Data).
	// Restricted interest as well (see RESTRICTED_INTEREST_PREFIXES), so a
	// non-admin holds no key here and the tab sends no request either.
	"backups:list",
	"backups:create",
	"backups:delete",

	// sessions: — slice 2 (2026-09-14). Consumers, all on the registry:
	// routes/sessions/[id]/+page.svelte, routes/+page.svelte, the four
	// routes/document-view/sessions/** pages, routes/admin/{sessions,pipelines,
	// pipelines/[slug]}/+page.svelte, client/components/sidebars/
	// SessionsSidebar.svelte, client/components/sessionForms/{EditSessionForm,
	// SessionViewPanel}.svelte, client/lorebooks/LorebooksWorkspace.svelte,
	// client/components/lorebookForms/EntryFireTest.svelte,
	// client/components/modals/SummarizeLoreModal.svelte.
	// `sessions:get` and `sessions:userTyping` are SCOPED (see SCOPED_EVENTS);
	// a page declares `sessions:get#<id>` and, because a not-found reply carries
	// the requested id beside its null session, holds no bare key at all.
	// Every success event of the family is listed — including the ones with no
	// listener anywhere (`functionCandidates`, `bindFunction`, `panelLayout:set`,
	// `surfaceIntent`): gating a reply nobody reads is the point, and an emitter
	// that later gains a consumer gains it through the registry. NOT listed:
	// `sessions:removedAsGuest`, which sessions.ts sends with a raw room emit
	// that never passes the gate — listing it here would claim a gate it has not.
	// Every `sessions:*:error` stays out, like every other error event.
	"sessions:accountVisibility",
	"sessions:actions",
	"sessions:actionsSeen",
	"sessions:addGuest",
	"sessions:addPersona",
	"sessions:adminList",
	"sessions:bindFunction",
	"sessions:branch",
	"sessions:choosePreset",
	"sessions:create",
	"sessions:delete",
	"sessions:functionCandidates",
	"sessions:functions",
	"sessions:genres",
	"sessions:get",
	"sessions:getNarratorName",
	"sessions:getResponseOrder",
	"sessions:layoutPreset:delete",
	"sessions:layoutPreset:rename",
	"sessions:layoutPreset:save",
	"sessions:layoutPreset:usage",
	"sessions:list",
	"sessions:panelLayout:get",
	"sessions:panelLayout:set",
	"sessions:pipelines",
	"sessions:presetStatus",
	"sessions:presets",
	"sessions:promptTokenCount",
	"sessions:reassignRemovedParticipant",
	"sessions:removeGuest",
	// The list-row push — consumers: client/components/sidebars/
	// SessionsSidebar.svelte and routes/+page.svelte, both on the patch store
	// (client/sessions/sessionRowPatches.svelte.ts).
	"sessions:rowChanged",
	// The run status push (R-19, 2026-09-16) — consumer:
	// client/components/sidebars/SessionsSidebar.svelte, on the registry.
	"sessions:runStatus",
	"sessions:saveDraft",
	"sessions:setEnvoySeat",
	"sessions:setFunction",
	"sessions:setLorebook",
	"sessions:setSpeakerStrategy",
	"sessions:sideCharacterOptions",
	"sessions:speakerStrategies",
	"sessions:summarize",
	"sessions:summarize:complete",
	"sessions:summarize:progress",
	"sessions:surfaceIntent",
	"sessions:toggleSessionCharacterActive",
	"sessions:triggerFunction",
	"sessions:triggerGenerateMessage",
	"sessions:triggerNarratorResponse",
	"sessions:triggers",
	"sessions:typing",
	"sessions:update",
	"sessions:updateSessionCharacterVisibility",
	"sessions:upgradeGenre",
	"sessions:userTyping",
	"sessions:view",

	// pipelines: — slice 3 (2026-09-14). A MIXED family (25 admin-only, 28 open
	// handlers), so it is NOT a restricted prefix. Consumers, all on the registry:
	// client/components/pipelines/** (RunProgressCard, PipelineReviewModal,
	// inspector/RunInspector, workspace/*, ConfigNotices, PipelineConfigOptions),
	// client/components/sidebars/PipelinesSidebar.svelte,
	// client/components/sessionMessages/MessageControls.svelte,
	// client/components/media/MediaManagerTab.svelte,
	// client/components/lorebookForms/EntryFireTest.svelte,
	// client/lorebooks/editor/retrievalReadout.svelte.ts,
	// client/components/admin/{TemplateChangeForm,TemplateChangelist}.svelte,
	// routes/sessions/[id]/+page.svelte, routes/pipelines/library/+page.svelte,
	// routes/admin/{pipelines,pipelines/[slug],configurations,session-presets/[id],
	// prompts,prompts/[id],scripts,scripts/new,scripts/[id]}/+page.svelte.
	// `runStarted` and `progress` are SCOPED on sessionId (see SCOPED_EVENTS);
	// `reviewRequested`/`reviewClosed` travel through the review transport in
	// sockets/pipelines.ts, which honours this set like broadcastHelpers does.
	// Fifteen write handlers answer ONLY through the cascaded `pipelines:get`
	// (and `acknowledgeConfigNotices` through `pipelines:configNotices`), so a
	// view that can write must hold that key — every converted one does. Every
	// success event of the family is listed, including the ones no client reads
	// (`validateTemplate`, the `cancelRun`/`resolveReview` acks).
	"pipelines:acknowledgeConfigNotices",
	"pipelines:artifactRuns",
	"pipelines:cancelRun",
	"pipelines:clearOption",
	"pipelines:cloneContextTemplate",
	"pipelines:clonePrompt",
	"pipelines:cloneScript",
	"pipelines:cloneVariableTemplate",
	"pipelines:configNotices",
	"pipelines:configsIndex",
	"pipelines:createConfig",
	"pipelines:createContextTemplate",
	"pipelines:createPrompt",
	"pipelines:createScript",
	"pipelines:deleteConfig",
	"pipelines:deleteContextTemplate",
	"pipelines:deletePrompt",
	"pipelines:deleteScript",
	"pipelines:deleteVariableTemplate",
	"pipelines:detail",
	"pipelines:exportScripts",
	"pipelines:get",
	"pipelines:importScripts",
	"pipelines:library",
	"pipelines:libraryClonePrompt",
	"pipelines:libraryCloneTemplate",
	"pipelines:libraryCreateTemplate",
	"pipelines:libraryDeletePrompt",
	"pipelines:libraryDeleteTemplate",
	"pipelines:libraryUpdatePrompt",
	"pipelines:libraryUpdateTemplate",
	"pipelines:list",
	"pipelines:messageExplain",
	"pipelines:previewRetrieval",
	"pipelines:previewTemplate",
	"pipelines:progress",
	"pipelines:renameConfig",
	"pipelines:resetConfig",
	"pipelines:resolveReview",
	"pipelines:reviewClosed",
	"pipelines:reviewRequested",
	"pipelines:reviews",
	"pipelines:run",
	"pipelines:runExplain",
	"pipelines:runStarted",
	"pipelines:runs",
	"pipelines:scripts",
	"pipelines:selectConfig",
	"pipelines:sessionEntryUsage",
	"pipelines:setOption",
	"pipelines:setOptions",
	"pipelines:setPresetActions",
	"pipelines:updateContextTemplate",
	"pipelines:updatePrompt",
	"pipelines:updateScript",
	"pipelines:updateVariableTemplate",
	"pipelines:validateTemplate",

	// characters: / characterFolders: / tags: / cardSources: — slice 4
	// (2026-09-15). All four families are open to every user (cardSources has
	// three admin-only CharaVault handlers beside two open readers), so none is
	// a restricted prefix. Consumers, all on the registry:
	// client/components/{characterForms,gallery,modals,sessionForms,
	// sessionMessages,settingsTabs,sidebars}/**,
	// client/lorebooks/CastWorkspace.svelte, routes/+page.svelte,
	// routes/sessions/[id]/+page.svelte, routes/library/**,
	// routes/document-view/{characters,sessions,settings/system}/**.
	// `characters:get`, the three gallery events and `characters:setFolder` are
	// SCOPED (see SCOPED_EVENTS). `reorderGallery`, `setDefaultPersona` and the
	// three `characterFolders:` mutators have no reader: gating drops the ack,
	// the cascaded list is what the client reads.
	"cardSources:capabilities",
	"cardSources:cardDetail",
	"cardSources:charaVault:connect",
	"cardSources:charaVault:disconnect",
	"cardSources:charaVault:status",
	"characterFolders:create",
	"characterFolders:delete",
	"characterFolders:list",
	"characterFolders:update",
	"characters:create",
	"characters:delete",
	"characters:deleteGalleryImage",
	"characters:exportCard",
	"characters:get",
	"characters:importCard",
	"characters:importFromLibrary",
	"characters:importResolve",
	"characters:list",
	"characters:listGallery",
	"characters:reorderGallery",
	"characters:searchLibrary",
	"characters:setAvatar",
	"characters:setDefaultPersona",
	"characters:setFolder",
	"characters:update",
	"characters:uploadGalleryImage",
	"tags:create",
	"tags:delete",
	"tags:getRelatedData",
	"tags:list",
	"tags:update",

	// lorebooks: / entries: / bindingSuggestions: / bindingCheck: — slice 5
	// (2026-09-15). Ownership-scoped families with no admin handler — never a
	// restricted prefix. Consumers, all on the registry: client/lorebooks/**,
	// client/components/{lorebookForms,modals,sessionForms,sessionMessages,
	// sidebars,surfaces/panels,characterForms}/**, client/utils/
	// createLorebookBinding.ts, routes/+page.svelte, routes/sessions/[id]/
	// +page.svelte. Every book-bound reply is SCOPED on lorebookId (see
	// SCOPED_EVENTS). `entries:testRetrieval` has no client at all and the
	// three bindingSuggestions mutators answer only through the cascaded list:
	// gating those drops acks nobody reads.
	"bindingCheck:result",
	"bindingSuggestions:add",
	"bindingSuggestions:ignore",
	"bindingSuggestions:list",
	"bindingSuggestions:unignore",
	"entries:counts",
	"entries:create",
	"entries:delete",
	"entries:iterateNext",
	"entries:list",
	"entries:recentDecisions",
	"entries:testRetrieval",
	"entries:update",
	"entries:updatePositions",
	"lorebooks:bindingList",
	"lorebooks:bindingsForCharacter",
	"lorebooks:create",
	"lorebooks:createBinding",
	"lorebooks:delete",
	"lorebooks:duplicate",
	"lorebooks:export",
	"lorebooks:get",
	"lorebooks:import",
	"lorebooks:importResolve",
	"lorebooks:list",
	"lorebooks:resolveOrCreateBindingByName",
	"lorebooks:update",
	"lorebooks:updateBinding",

	// Session-adjacent — slice 6 (2026-09-15): scenes, sessionGenres (restricted),
	// sessionPresets, narrativeGraph, media, vectorization (part), taskQueue
	// (restricted), activity, import (part, restricted), world/scene summarize
	// configs (restricted). Consumers: client/lorebooks/**, client/components/
	// {modals,sessionMessages,media,sidebars,settingsTabs}/**, Layout.svelte,
	// routes/sessions/[id]/+page.svelte, routes/document-view/sessions/[id]/
	// +page.svelte, routes/import/+page.svelte, routes/admin/session-{presets,
	// genres}/**. DEFERRED with the model-column work, so NOT listed: the
	// vectorization queue/model events read by components/connections/
	// EmbeddingQueuePanel.svelte, `ner:status` (NerLanePanel, ConnectionsSidebar),
	// every `images:*` (connectionForms/ImageConnectionForm.svelte),
	// `characterSummarizeConfigs:*` (PromptsSidebar), and `import:sillytavern:
	// startSession|stageFiles` (utils/sillyTavernFolderImport.ts keeps a raw
	// one-shot listener until its test drives the app socket). The taskQueue and
	// activity pushes leave through per-socket closures that consult this set.
	"activity:update",
	"import:sillytavern:execute",
	"import:sillytavern:scan",
	"media:changed",
	"media:cleanupPreview",
	"media:cullDerived",
	"media:cullOriginals",
	"media:delete",
	"media:list",
	"media:regenerateThumbnail",
	"media:setCachePolicy",
	"media:setFrame",
	"media:setVisibility",
	"narrativeGraph:applyProposal",
	"narrativeGraph:buildLog",
	"narrativeGraph:checkNodeMergeReferences",
	"narrativeGraph:createNode",
	"narrativeGraph:createRelationship",
	"narrativeGraph:deleteNode",
	"narrativeGraph:deleteRelationship",
	"narrativeGraph:duplicateCandidates",
	"narrativeGraph:linkOrphanBinding",
	"narrativeGraph:list",
	"narrativeGraph:listMergeLogs",
	"narrativeGraph:mergeNode",
	"narrativeGraph:queryContext",
	"narrativeGraph:undoMerge",
	"narrativeGraph:updateNode",
	"narrativeGraph:updateRelationship",
	"sceneSummarizeConfigs:create",
	"sceneSummarizeConfigs:delete",
	"sceneSummarizeConfigs:get",
	"sceneSummarizeConfigs:list",
	"sceneSummarizeConfigs:setUserActive",
	"sceneSummarizeConfigs:update",
	"scenes:compile:complete",
	"scenes:compile:progress",
	"scenes:create",
	"scenes:list",
	"scenes:listByLorebook",
	"scenes:process:complete",
	"scenes:process:progress",
	"scenes:scenedMessageIds",
	"scenes:update",
	"sessionGenres:detail",
	"sessionGenres:list",
	"sessionGenres:update",
	"sessionPresets:create",
	"sessionPresets:delete",
	"sessionPresets:list",
	"sessionPresets:update",
	"taskQueue:update",
	"vectorization:addToQueue",
	"vectorization:checkRagStatus",
	"vectorization:itemUpdated",
	"vectorization:progress",
	"vectorization:reindexCost",
	"vectorization:setSessionRagIgnored",
	"worldSummarizeConfigs:create",
	"worldSummarizeConfigs:delete",
	"worldSummarizeConfigs:get",
	"worldSummarizeConfigs:list",
	"worldSummarizeConfigs:setUserActive",
	"worldSummarizeConfigs:update",

	// Admin/config — slice 7 (2026-09-15): users, userSettings, systemSettings,
	// plugins (restricted), totp, completionTemplates/contextConfigs/prompt-
	// Configs/narratorPromptConfigs/graphBuildConfigs/samplingConfigs (all
	// restricted), customThemes, tunnels/invites/allowedHosts (restricted),
	// setup, account. Consumers: both shells (Layout.svelte, AccessibleShell.
	// svelte — two subscribers on one key), client/components/{auth,backgrounds,
	// settingsTabs,sidebars,userForms,modals}/**, CustomTheme{Editor,Manager}.
	// svelte, stores/completionTemplateOptions.svelte.ts, routes/+layout.svelte,
	// routes/+page.svelte, routes/admin/**, routes/document-view/settings/**.
	// `users:current` is a cascade target of seven other families and now leaves
	// through emitToUser like everything else. `systemSettings:update{Ollama,
	// KoboldCpp}ManagerEnabled` are emitted by the deferred ollama/koboldcpp
	// handlers but consumed by converted settings views, so they are listed.
	"account:setPassword",
	"account:setupState",
	"allowedHosts:get",
	"completionTemplates:clone",
	"completionTemplates:create",
	"completionTemplates:delete",
	"completionTemplates:get",
	"completionTemplates:list",
	"completionTemplates:options",
	"completionTemplates:update",
	"contextConfigs:create",
	"contextConfigs:delete",
	"contextConfigs:get",
	"contextConfigs:list",
	"contextConfigs:preview",
	"contextConfigs:setUserActive",
	"contextConfigs:update",
	"customThemes:delete",
	"customThemes:getCss",
	"customThemes:list",
	"customThemes:save",
	"customThemes:setInstanceTheme",
	"graphBuildConfigs:create",
	"graphBuildConfigs:delete",
	"graphBuildConfigs:get",
	"graphBuildConfigs:list",
	"graphBuildConfigs:setDefault",
	"graphBuildConfigs:update",
	"invites:create",
	"invites:list",
	"invites:revoke",
	"narratorPromptConfigs:create",
	"narratorPromptConfigs:delete",
	"narratorPromptConfigs:get",
	"narratorPromptConfigs:list",
	"narratorPromptConfigs:setUserActive",
	"narratorPromptConfigs:update",
	"plugins:abort",
	"plugins:active",
	"plugins:getSettings",
	"plugins:install",
	"plugins:installLocal",
	"plugins:kill",
	"plugins:list",
	"plugins:logs",
	"plugins:permissions",
	"plugins:reviewPermissions",
	"plugins:setBackend",
	"plugins:setEnabled",
	"plugins:setPermission",
	"plugins:setSequential",
	"plugins:setSettings",
	"plugins:setStorageQuota",
	"plugins:uninstall",
	"plugins:unload",
	"promptConfigs:create",
	"promptConfigs:delete",
	"promptConfigs:get",
	"promptConfigs:list",
	"promptConfigs:setUserActive",
	"promptConfigs:update",
	"samplingConfigs:create",
	"samplingConfigs:delete",
	"samplingConfigs:get",
	"samplingConfigs:list",
	"samplingConfigs:setUserActive",
	"samplingConfigs:update",
	"setup:get",
	"setup:markComplete",
	"systemSettings:get",
	"systemSettings:updateAccountsEnabled",
	"systemSettings:updateAutoTranslate",
	"systemSettings:updateBackupSettings",
	"systemSettings:updateContextDebuggingEnabled",
	"systemSettings:updateDefaultLanguage",
	"systemSettings:updateKoboldCppManagerEnabled",
	"systemSettings:updateLegacyConfigsVisible",
	"systemSettings:updateOllamaManagerEnabled",
	"systemSettings:updateRequireTwoFactor",
	"systemSettings:updateScriptsEnabled",
	"totp:adminClear",
	"totp:disable",
	"totp:enroll:begin",
	"totp:enroll:confirm",
	"totp:regenerateCodes",
	"totp:status",
	"totp:verify",
	"tunnels:disable",
	"tunnels:enable",
	"tunnels:get",
	"tunnels:updateConfig",
	"userSettings:deleteBackground",
	"userSettings:get",
	"userSettings:listBackgrounds",
	"userSettings:updateBackground",
	"userSettings:updateCharaVaultIncludeNsfw",
	"userSettings:updateDarkMode",
	"userSettings:updateEasyCharacterCreation",
	"userSettings:updateLanguage",
	"userSettings:updateShowAllCharacterFields",
	"userSettings:updateShowHomePageBanner",
	"userSettings:updateTheme",
	"userSettings:uploadBackground",
	"users:create",
	"users:current",
	"users:current:changePassphrase",
	"users:current:hasPassphrase",
	"users:current:logout",
	"users:current:setPassphrase",
	"users:current:updateDisplayName",
	"users:delete",
	"users:get",
	"users:list",
	"users:setTheme",
	"users:update",

	// sessionMessage — the streaming push, one broadcast per chunk. Consumers:
	// routes/sessions/[id]/+page.svelte, routes/document-view/sessions/[id]/
	// +page.svelte, client/lorebooks/LorebooksWorkspace.svelte — all three
	// declare the SCOPED key, so a tab reading another session is not sent
	// this one's chunks. No family prefix and no `:error` sibling in here:
	// `sessionMessage:error` stays ungated like every other error event.
	//
	// It is also the one gated event whose cost is a broadcast rather than a
	// reply: `broadcastToSessionUsers` reads the owner and the guest roster —
	// two queries — for every chunk, so the gate is applied BEFORE them.
	"sessionMessage",

	// Slice 8 (2026-09-15): the connections group, deferred until the
	// model-column work settled. Every consumer below is on the registry.
	//
	// `connections:` — client/components/connections/** (ConnectionCapabilities,
	// useConnectionModels, EmbeddingQueuePanel, NerLanePanel),
	// client/connectionForms/*.svelte, client/stores/connectionWireMode.svelte.ts,
	// sidebars/ConnectionsSidebar + PromptsSidebar, sessionForms/EditSessionForm,
	// koboldcppManager/KoboldCppModelsTab, ollamaManager/Ollama{Installed,Available}Tab,
	// routes/+page.svelte, routes/admin/connections, routes/document-view/connections/**.
	// `connections:get` is scoped (above); the rest are bare.
	"connections:addHubModel",
	"connections:attachScript",
	"connections:cancelModelDownload",
	"connections:capabilities",
	"connections:create",
	"connections:createModel",
	"connections:delete",
	"connections:deleteModel",
	"connections:detachScript",
	"connections:downloadModel",
	"connections:get",
	"connections:importModels",
	"connections:list",
	"connections:modelDownloadProgress",
	"connections:models",
	"connections:refreshModels",
	"connections:removeModelFiles",
	"connections:scripts",
	"connections:setCapability",
	"connections:setDefault",
	"connections:syncModels",
	"connections:test",
	"connections:update",
	"connections:updateModel",
	// `connectionDefaults:` — routes/admin/defaults, routes/+page.svelte (the
	// wizard's pair registration). Restricted prefix: both handlers admin-only.
	"connectionDefaults:list",
	"connectionDefaults:set",
	// `koboldcpp:` — client/components/koboldcppManager/**,
	// connections/ManagedConnectionView (the managed connection's view since
	// the 2026-09-17 fold), routes/document-view/settings/system
	// (`setBaseUrl`), routes/document-view/koboldcpp, routes/+page.svelte.
	// The three pushes (`downloadProgress`, `binaryDownloadProgress`,
	// `subprocessStatus`) leave through per-user closures that call the gated
	// `emitToUser`, so they are gated per socket like everything else.
	"koboldcpp:binaryDownloadProgress",
	"koboldcpp:cancelBinaryDownload",
	"koboldcpp:cancelDownload",
	"koboldcpp:checkManagedBinaryUpdate",
	"koboldcpp:clearDownloadHistory",
	"koboldcpp:connectImageModel",
	"koboldcpp:connectModel",
	"koboldcpp:deleteModel",
	"koboldcpp:downloadBinary",
	"koboldcpp:downloadModel",
	"koboldcpp:downloadProgress",
	"koboldcpp:getBinaryDownloadProgress",
	"koboldcpp:getDownloadProgress",
	"koboldcpp:getLoadedConfig",
	"koboldcpp:getSubprocessStatus",
	"koboldcpp:isUpdateAvailable",
	"koboldcpp:listBinaryVariants",
	"koboldcpp:listModels",
	"koboldcpp:listReleaseVersions",
	"koboldcpp:loadModel",
	"koboldcpp:perf",
	"koboldcpp:recommendedModels",
	"koboldcpp:searchModels",
	"koboldcpp:setBaseUrl",
	"koboldcpp:setManagedAdminPassword",
	"koboldcpp:setManagedBinaryDir",
	"koboldcpp:setManagedMode",
	"koboldcpp:setManagedPort",
	"koboldcpp:setModelKind",
	"koboldcpp:setModelsDir",
	"koboldcpp:setModelTtl",
	"koboldcpp:setSubprocessTimeout",
	"koboldcpp:startSubprocess",
	"koboldcpp:stopSubprocess",
	"koboldcpp:subprocessStatus",
	"koboldcpp:unloadModel",
	"koboldcpp:version",
	// `ollama:` — client/components/ollamaManager/**,
	// connections/ManagedConnectionView (the managed connection's view since
	// the 2026-09-17 fold), routes/document-view/ollama, routes/+page.svelte. `ollama:pullProgress`
	// is the per-chunk push from inside `ollama:pullModel` (was the bare
	// `ollamaPullProgress`).
	"ollama:cancelPull",
	"ollama:clearDownloadHistory",
	"ollama:connectModel",
	"ollama:deleteModel",
	"ollama:getDownloadProgress",
	"ollama:isUpdateAvailable",
	"ollama:listRunningModels",
	"ollama:modelsList",
	"ollama:pullModel",
	"ollama:pullProgress",
	"ollama:recommendedModels",
	"ollama:searchAvailableModels",
	"ollama:setBaseUrl",
	"ollama:version",
	// Left ungated by slices 6–7 because their last consumer sat in the files
	// above: the embedding-model lane and queue —
	// client/components/connections/EmbeddingQueuePanel (+ routes/+page.svelte
	// for `listModels`) …
	"vectorization:getQueue",
	"vectorization:listModels",
	"vectorization:loadModel",
	"vectorization:modelDownloadProgress",
	"vectorization:moveQueueGroup",
	"vectorization:removeFromQueue",
	"vectorization:startQueue",
	"vectorization:status",
	"vectorization:stopQueue",
	"vectorization:unloadModel",
	// … the NER lane — client/components/connections/NerLanePanel,
	// sidebars/ConnectionsSidebar (restricted prefix) …
	"ner:status",
	"ner:unloadModel",
	// … the image-connection form's test render —
	// client/connectionForms/ImageConnectionForm (`images:cancel` has no
	// listener anywhere; gated so nobody pays for it) …
	"images:cancel",
	"images:generate",
	"images:profileSchema",
	"images:progress",
	// … and the character summarize configs — sidebars/PromptsSidebar
	// (`characterSummarizeConfigs:delete` has no listener; same reasoning).
	"characterSummarizeConfigs:create",
	"characterSummarizeConfigs:delete",
	"characterSummarizeConfigs:get",
	"characterSummarizeConfigs:list",
	"characterSummarizeConfigs:setUserActive",
	"characterSummarizeConfigs:update",

	// `jump:` — the shell's universal search overlay (Ctrl K), added with the
	// family (2026-09-15). One event, and the ONLY consumer is that overlay,
	// which is on the interest registry by construction: phase 4 retired
	// `on`/`off` from the typed socket, so the registry is the one listener
	// path a client has. NOT a restricted prefix — every user may jump; the
	// handler simply omits the two admin-only kinds (`connection`, `user`) for
	// everyone else rather than refusing the request.
	//
	// Bare, not scoped: a jump is a per-socket request/reply, and its reply
	// echoes the `query` it answers so a client can tell a superseded answer
	// from its own. `jump:search:error` stays out, like every other error event.
	"jump:search"
])

export function isGatedEvent(event: string): boolean {
	return GATED_EVENTS.has(event)
}

/** The event the client sends its full key list on. */
export const INTEREST_SYNC_EVENT = "interest:sync"

/** Periodic full-set sync. Self-healing only — the server never expires on silence. */
export const INTEREST_SYNC_INTERVAL_MS = 30_000

export interface InterestSyncParams {
	keys: InterestKey[]
}
