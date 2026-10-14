/**
 * This person's session layout as the page holds it (the copy model): the
 * layout itself, what it started from and whether that moved, the genre's
 * layout list, the style pins and per-widget settings — and every answer of
 * the layout card menu, _Start from_ and _Save changes to_. Seeds the surface
 * manager once both the panel set (`sessions:view`) and the saved layout
 * (`sessions:panelLayout:get`) have landed.
 */
import { onDestroy } from "svelte"
import { toaster } from "$lib/client/utils/toaster"
import { onConnect } from "$lib/client/sockets/interest.svelte"
import { coreDefaultWidgets } from "$lib/client/components/sessionPage/coreWidgets"
import {
	authoredOwnersOf,
	retargetAuthoredGrants,
	retargetAuthoredSrc
} from "$lib/client/components/sessionPage/authoredReload"
import { LayoutCopyAsks } from "$lib/client/sessionLayout/layoutCopyAsks"
import { LayoutAsks, olderThanHeld } from "$lib/client/sessionLayout/layoutAsks"
import { quoted as quotedLayoutName } from "$lib/client/sessionLayout/startFrom"
import { setWidgetStylePins } from "$lib/client/stores/widgetStyles.svelte"
import {
	setWidgetSettingValues,
	setWidgetSettingsWriter
} from "$lib/client/stores/widgetSettings.svelte"
import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import type { LayoutBlob } from "$lib/client/surfaces/types"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import type { SessionPageInbox } from "$lib/client/components/sessionPage/sessionPageInbox.svelte"
import type { SessionPageData } from "$lib/client/components/sessionPage/sessionPageData.svelte"

export interface SessionLayoutDataDeps {
	socket: TypedSocket
	inbox: SessionPageInbox
	/** The session in the route. */
	sessionId(): number
	/** The page's surface manager — what the layout seeds and persists through. */
	surfaceManager: SurfaceManager
	/** The session view (its panels), the session's genre and its name. */
	data: SessionPageData
}

/** The page's session layout. Registers its listeners on the inbox at once. */
export function createSessionLayoutData(d: SessionLayoutDataDeps) {
	const socket = d.socket
	const surfaceManager = d.surfaceManager
	const sessionId = $derived(d.sessionId())
	const sessionFrames = $derived(d.data.sessionFrames)
	const genreName = $derived(d.data.genreName)
	const sessionGenreId = () => d.data.sessionGenreId()
	const handleRecordedEvent = (push: Sockets.Sessions.RecordedEvent.Push) =>
		surfaceManager.announceRecordedEvent(push)

	let panelViewLoaded = $state(false)
	let panelLayoutLoaded = $state(false)
	// This person's session layout, WHOLE (the copy model): the first open
	// copied a starting point in, so there is no base under it. What it
	// started from is provenance only — the editor's label, "Start again
	// from", and the Updated mark — and never read to draw.
	let panelLayoutBlob = $state<LayoutBlob>({})
	let layoutPresets = $state<Sockets.Sessions.LayoutPreset[]>([])
	let startedFromLayoutPresetId = $state<number | null>(null)
	let startedFromUpdated = $state(false)
	// When this session's layout was last copied in, as the last answer said.
	// Not drawn: it orders the answers — a started-from push about an OLDER
	// copy (read before a copy this tab asked for landed) is old news.
	let layoutCopiedAt: string | null = null
	// The answer to "what does deleting this preset touch?", held for exactly
	// one pending delete confirmation. `null` = nothing asked, or still asking;
	// `unknown` = the ask failed (the confirmation says so rather than wait).
	let layoutPresetUsage = $state<
		import("$lib/client/sessionLayout/startFrom").LayoutPresetUsage | null
	>(null)
	let layoutSettings = $state<Record<string, unknown>>({})
	let widgetSettings = $state<Record<string, Record<string, unknown>>>({})

	// PLAN 25: the per-widget style pins ride `layoutSettings.widgetStyles`.
	// They are pushed into the widget-style store rather than threaded as
	// props because the thing that needs them — WidgetHost — is mounted deep
	// inside Panel, several layers below anything this page hands down.
	$effect(() => {
		setWidgetStylePins(layoutSettings?.widgetStyles)
	})

	/**
	 * Per-instance widget settings (PLAN 25), pushed to the same store lane and
	 * for the same reason: the settings overlay is inside a `WidgetHost`. They
	 * ride their OWN key on the layout round trip rather than `layoutSettings`,
	 * so the writer here needs nothing but the current blob. They are this
	 * person's own values and nothing else: a layout's own `widgetSettings`
	 * were copied into them when the session started from it.
	 */
	$effect(() => {
		setWidgetSettingValues(widgetSettings)
	})
	$effect(() => {
		const id = sessionId
		if (id == null) return
		setWidgetSettingsWriter((next) => {
			widgetSettings = next
			socket.emit("sessions:panelLayout:set", {
				sessionId: id,
				layout: surfaceManager.toBlob() as Record<string, unknown>,
				widgetSettings: next
			})
		})
		return () => setWidgetSettingsWriter(null)
	})

	/**
	 * Persist a replacement `layoutSettings` blob (the Settings tab's style
	 * pins today). Sent with `layout` because the server requires it, and WITH
	 * the `layoutSettings` key present — key presence is what tells it to write
	 * that column at all, so an absent key here would silently drop the write.
	 */
	function persistLayoutSettings(next: Record<string, unknown>) {
		if (sessionId == null) return
		layoutSettings = next
		socket.emit("sessions:panelLayout:set", {
			sessionId,
			layout: surfaceManager.toBlob() as Record<string, unknown>,
			layoutSettings: next
		})
	}

	/**
	 * Core's default widgets for the standard chat — the widgets beside the
	 * conversation, from one table (`sessionPage/coreWidgets.ts`), each core's
	 * own remote component (R79). A custom mode's own widgets arrive via
	 * `sessions:view.modePanels` and are merged on top (mode wins by id).
	 */
	const CORE_DEFAULT_PANELS: Sockets.Sessions.View.ModePanel[] =
		coreDefaultWidgets()

	function persistPanelLayout(blob: LayoutBlob) {
		if (sessionId == null) return
		panelLayoutBlob = blob
		// Deliberately blob-only: omitting the other keys is what tells the
		// server to leave this person's style pins and widget settings alone.
		socket.emit("sessions:panelLayout:set", {
			sessionId,
			layout: blob as Record<string, unknown>
		})
	}

	/** The copies this tab asked for and has no answer to yet (see `startLayoutFrom`). */
	const layoutCopyAsks = new LayoutCopyAsks()

	/**
	 * Replace this session's layout by COPYING one in — a card (_Start from_),
	 * _Start again from "X"_, _Reset to genre default layout_ (the genre
	 * default's id), or `null` for _Start from scratch_. The server answers
	 * with the whole new layout, like `:get`, and the page re-seeds from it
	 * (`handleLayoutStartFrom`); nothing changes here until it does. Resolves
	 * whether the copy landed, so the open editor stops waiting on a refusal.
	 *
	 * A debounced blob save still waiting to go out is dropped first: sent
	 * after this ask, it could land after the copy and write the old layout
	 * back over it. If the copy is refused, that save is sent after all
	 * (`settleLayoutCopy`), so a drag made just before is not lost.
	 */
	function startLayoutFrom(layoutPresetId: number | null): Promise<boolean> {
		if (sessionId == null) return Promise.resolve(false)
		const landed = layoutCopyAsks.ask(surfaceManager.cancelPendingSave())
		socket.emit("sessions:panelLayout:startFrom", {
			sessionId,
			layoutPresetId
		})
		return landed
	}

	/**
	 * An answer to the oldest copy this tab asked for. A refused one gives
	 * back the blob save its ask dropped: the layout it would have replaced
	 * is still this session's, drag included. `false` when this tab asked
	 * for nothing (another tab's answer).
	 */
	function settleLayoutCopy(landed: boolean): boolean {
		return layoutCopyAsks.settle(landed, () => surfaceManager.persistNow())
	}

	/**
	 * _Save as new layout_: a new named layout from this session's layout,
	 * which this session then started from. Sends the arrangement — the
	 * manager's own slots, which the editor has just committed — and every
	 * widget instance the session draws (`drawn`, the floor's included: an
	 * empty layout still draws the conversation and the genre's panels); the
	 * server packs those instances' settings and style pins in with it.
	 */
	function saveLayoutPreset(
		name: string,
		drawn: string[],
		description?: string
	) {
		if (sessionId == null) return
		socket.emit("sessions:layoutPreset:save", {
			sessionId,
			name,
			...(description ? { description } : {}),
			layout: committedArrangement(),
			drawnWidgetIds: drawn
		})
	}

	/**
	 * The arrangement the editor just committed — the manager's own slots —
	 * as _Save as new layout_ and _Save changes to_ send it.
	 */
	function committedArrangement(): Record<string, unknown> {
		const slot = (k: string, v: unknown) =>
			v !== undefined ? { [k]: $state.snapshot(v) } : {}
		return {
			...slot("zoneLayout", surfaceManager.zoneLayout),
			...slot("widgetGrid", surfaceManager.widgetGrid),
			...slot("arrangedGrid", surfaceManager.arrangedGrid)
		}
	}

	/* ── the card menu and Save changes to (brief 6b) ─────────────────────
	 * Every tab of this person hears every answer, and adopts the refreshed
	 * list when it is for this session's genre; only the tab that ASKED says
	 * how it went (`layoutAsks`), so a second tab never toasts someone
	 * else's click. A handler that threw answers with its `:error` twin,
	 * which settles this tab's oldest ask of that verb. */
	const layoutAsks = new LayoutAsks()
	/**
	 * Read this session's started-from facts again — provenance, Updated and
	 * the list. After a refusal (the card may be gone: someone stopped
	 * sharing or deleted it; the layout may have changed elsewhere), and on
	 * every reconnect (a push sent while the socket was down is lost).
	 */
	function askStartedFrom() {
		if (sessionId != null)
			socket.emit("sessions:panelLayout:startedFromUpdated", {
				sessionId
			})
	}
	const nameOf = (id: number) =>
		layoutPresets.find((p) => p.id === id)?.name ?? "that layout"

	/** _Save changes to "*Name*"_: the committed arrangement into that layout. */
	function saveLayoutChanges(
		presetId: number,
		drawn: string[],
		overwriteUpdated: boolean
	) {
		if (sessionId == null) return
		layoutAsks.ask("update", presetId)
		socket.emit("sessions:layoutPreset:update", {
			sessionId,
			id: presetId,
			layout: committedArrangement(),
			drawnWidgetIds: drawn,
			...(overwriteUpdated ? { overwriteUpdated: true } : {})
		})
	}
	function shareLayout(presetId: number, visibility: "shared" | "private") {
		if (sessionId == null) return
		layoutAsks.ask("share", presetId)
		socket.emit("sessions:layoutPreset:share", {
			sessionId,
			id: presetId,
			visibility
		})
	}
	function cloneLayout(presetId: number) {
		layoutAsks.ask("clone", presetId)
		socket.emit("sessions:layoutPreset:clone", { id: presetId })
	}
	function setNewSessionLayout(presetId: number | null) {
		const genreId = sessionGenreId()
		if (!genreId) return
		layoutAsks.ask("new-session", genreId)
		socket.emit("sessions:layoutPreset:setNewSessionLayout", {
			genreId,
			layoutPresetId: presetId
		})
	}
	/** "New Adventure sessions", or plainer while the genre's name loads. */
	const newSessionsOfGenre = () =>
		genreName ? `New ${genreName} sessions` : "New sessions of this genre"

	/** (Re)seed the manager once both the panel set and the saved layout land. */
	function initSurfaceManagerIfReady() {
		if (!panelViewLoaded || !panelLayoutLoaded) return
		const byId = new Map<string, Sockets.Sessions.View.ModePanel>()
		// What the genre withholds (R71) is not offered — core's included.
		const omit = new Set(sessionFrames?.omitWidgets ?? [])
		for (const p of CORE_DEFAULT_PANELS)
			if (!omit.has(p.id)) byId.set(p.id, p)
		for (const p of sessionFrames?.modePanels ?? []) byId.set(p.id, p) // mode wins
		surfaceManager.init(
			sessionId,
			[...byId.values()],
			panelLayoutBlob,
			persistPanelLayout,
			omit
		)
	}

	/** The panel set landed (its frames are the data's): seed when the layout has too. */
	function handleSessionsView(res: Sockets.Sessions.View.Response) {
		if (res.sessionId !== sessionId) return
		panelViewLoaded = true
		initSurfaceManagerIfReady()
	}

	/** Adopt a whole session layout — the first open's, or a copy's. */
	function adoptPanelLayout(res: Sockets.Sessions.PanelLayout.Get.Response) {
		panelLayoutBlob = (res.layout ?? {}) as LayoutBlob
		layoutPresets = res.presets ?? []
		startedFromLayoutPresetId = res.startedFromLayoutPresetId ?? null
		startedFromUpdated = !!res.startedFromUpdated
		layoutCopiedAt = res.layoutCopiedAt ?? null
		layoutSettings = res.layoutSettings ?? {}
		widgetSettings = res.widgetSettings ?? {}
		panelLayoutLoaded = true
		initSurfaceManagerIfReady()
	}

	function handleSessionsPanelLayoutGet(
		res: Sockets.Sessions.PanelLayout.Get.Response
	) {
		if (res.sessionId !== sessionId) return
		adoptPanelLayout(res)
	}

	/**
	 * A copy landed (or was refused). The answer is the whole new layout, so
	 * the manager re-seeds from it — the editor, if open, re-reads its working
	 * copy when it sees the manager re-seeded. A refusal is said only in the
	 * tab that asked; every tab of this person hears the answer.
	 */
	function handleLayoutStartFrom(
		res: Sockets.Sessions.PanelLayout.StartFrom.Response
	) {
		if (res.sessionId !== sessionId) return
		if (!res.ok) {
			if (settleLayoutCopy(false))
				toaster.error({
					title: res.error ?? "Could not change the layout"
				})
			return
		}
		adoptPanelLayout(res)
		settleLayoutCopy(true)
	}

	/**
	 * The copy's handler threw. The generic `:error` names no session, so it
	 * settles this tab's oldest ask, if it has one. Saying so is left to the
	 * shell's catch-all toast for every unhandled `*:error`.
	 */
	function handleLayoutStartFromError() {
		settleLayoutCopy(false)
	}

	function handleLayoutPresetSave(
		res: Sockets.Sessions.PanelLayout.Save.Response
	) {
		if (res.sessionId !== sessionId) return
		if (!res.ok) {
			toaster.error({ title: res.error ?? "Could not save that layout" })
			return
		}
		layoutPresets = res.presets ?? layoutPresets
		// The session now started from the row it just wrote.
		if (res.startedFromLayoutPresetId != null) {
			startedFromLayoutPresetId = res.startedFromLayoutPresetId
			startedFromUpdated = false
			layoutCopiedAt = res.layoutCopiedAt ?? layoutCopiedAt
		}
	}

	/**
	 * Managing the presets this user saved (PLAN 25 redesign).
	 *
	 * These three are GENRE-scoped, not session-scoped: a preset belongs to a
	 * genre and an author, not to the session you happened to be looking at
	 * when you saved it. So the refreshed list is adopted only when the reply
	 * names THIS session's genre — and a refusal names no genre at all (it must
	 * not say where an id it declined to touch lives), which the same check
	 * correctly declines to adopt.
	 *
	 * A refusal arrives on the main channel with `ok: false` and the server's
	 * own sentence; it is toasted verbatim rather than re-worded here, because
	 * the server is the only thing that knows which of "built-in", "not yours"
	 * or "already gone" happened.
	 */
	function handleLayoutPresetRename(
		res: Sockets.Sessions.PanelLayout.Rename.Response
	) {
		if (!res.ok) {
			toaster.error({
				title: res.error ?? "Could not rename that layout"
			})
			return
		}
		if (res.genreId !== sessionGenreId()) return
		layoutPresets = res.presets ?? layoutPresets
	}

	function handleLayoutPresetDelete(
		res: Sockets.Sessions.PanelLayout.Delete.Response
	) {
		layoutPresetUsage = null
		if (!res.ok) {
			toaster.error({
				title: res.error ?? "Could not delete that layout"
			})
			return
		}
		if (res.genreId !== sessionGenreId()) return
		layoutPresets = res.presets ?? layoutPresets
		// `layout_preset_id` is ON DELETE SET NULL, so the label is already
		// gone server-side; mirror it. The layout itself is this session's own
		// copy and does not move.
		if (res.id === startedFromLayoutPresetId) {
			startedFromLayoutPresetId = null
			startedFromUpdated = false
		}
	}

	function handleLayoutPresetUsage(
		res: Sockets.Sessions.PanelLayout.Usage.Response
	) {
		if (!res.ok) {
			// Answered, not pending: the delete question must not wait for good.
			layoutPresetUsage = {
				id: res.id,
				sessions: 0,
				newSessionLayoutUsers: 0,
				unknown: true
			}
			toaster.error({ title: res.error ?? "Could not read that layout" })
			return
		}
		layoutPresetUsage = {
			id: res.id,
			sessions: res.sessions,
			newSessionLayoutUsers: res.newSessionLayoutUsers ?? 0
		}
	}

	/** A card-menu answer: adopt its list in every tab of the genre; toast in the asker's. */
	function adoptManagedList(res: {
		ok: boolean
		genreId?: string
		presets: Sockets.Sessions.LayoutPreset[]
	}) {
		if (res.ok && res.genreId === sessionGenreId())
			layoutPresets = res.presets
	}

	/**
	 * This tab's card-menu ask was refused. Said as the server says it; then
	 * the list is read again, because the commonest cause is a card that is
	 * not this person's to act on any more (unshared or deleted elsewhere).
	 */
	function refusedLayoutAsk(error: string | undefined, fallback: string) {
		toaster.error({ title: error ?? fallback })
		askStartedFrom()
	}

	function handleLayoutPresetShare(
		res: Sockets.Sessions.PanelLayout.Share.Response
	) {
		adoptManagedList(res)
		if (!layoutAsks.take("share", res.id)) return
		if (!res.ok) {
			refusedLayoutAsk(res.error, "Could not change who sees that layout")
			return
		}
		const name = quotedLayoutName(res.preset?.name ?? nameOf(res.id))
		if (res.preset?.visibility === "shared")
			toaster.success({
				title: `Shared ${name} with everyone on this pub.`
			})
		else
			toaster.success({
				title: `${name} is private again.`,
				description: "Sessions that copied it keep their layout."
			})
	}

	function handleLayoutPresetClone(
		res: Sockets.Sessions.PanelLayout.Clone.Response
	) {
		adoptManagedList(res)
		if (!layoutAsks.take("clone", res.id)) return
		if (!res.ok) {
			refusedLayoutAsk(res.error, "Could not copy that layout")
			return
		}
		toaster.success({
			title: `Made a copy: ${quotedLayoutName(res.preset?.name ?? "")}.`,
			description: "It's under Your layouts."
		})
	}

	/**
	 * _Save changes to_ answered. This session now started from the row it
	 * saved into (and does not read it as Updated). A refusal — including
	 * "changed since this session copied it", when the Updated news had not
	 * reached this tab yet — re-reads the started-from facts, so the next ask
	 * warns.
	 */
	function handleLayoutPresetUpdate(
		res: Sockets.Sessions.PanelLayout.Update.Response
	) {
		adoptManagedList(res)
		if (
			res.ok &&
			res.sessionId === sessionId &&
			res.startedFromLayoutPresetId != null
		) {
			startedFromLayoutPresetId = res.startedFromLayoutPresetId
			startedFromUpdated = false
			layoutCopiedAt = res.layoutCopiedAt ?? layoutCopiedAt
		}
		if (!layoutAsks.take("update", res.id)) return
		if (!res.ok) {
			refusedLayoutAsk(res.error, "Could not save changes to that layout")
			return
		}
		toaster.success({
			title: `Saved changes to ${quotedLayoutName(res.preset?.name ?? nameOf(res.id))}.`
		})
	}

	function handleLayoutPresetSetNewSessionLayout(
		res: Sockets.Sessions.PanelLayout.SetNewSessionLayout.Response
	) {
		if (res.genreId !== sessionGenreId()) return
		if (res.ok) layoutPresets = res.presets
		if (!layoutAsks.take("new-session", res.genreId)) return
		if (!res.ok) {
			refusedLayoutAsk(
				res.error,
				"Could not change the layout for new sessions"
			)
			return
		}
		toaster.success({
			title:
				res.layoutPresetId != null
					? `${newSessionsOfGenre()} will start from ${quotedLayoutName(nameOf(res.layoutPresetId))}.`
					: `${newSessionsOfGenre()} will start from the genre default layout.`
		})
	}

	/**
	 * **Updated**, live (brief 6b): a layout this session started from moved
	 * — saved into from another session, or updated by its plugin or core.
	 * Only the label and the list move; the layout on screen is this
	 * session's own copy.
	 */
	function handleLayoutStartedFromUpdated(
		res: Sockets.Sessions.PanelLayout.StartedFromUpdated.Response
	) {
		if (res.sessionId !== sessionId) return
		// Read before a copy this tab asked for landed, sent after its answer:
		// it names the OLD source (and its Updated mark). Old news.
		if (olderThanHeld(layoutCopiedAt, res.layoutCopiedAt)) return
		layoutPresets = res.presets
		startedFromLayoutPresetId = res.startedFromLayoutPresetId
		startedFromUpdated = res.startedFromUpdated
		layoutCopiedAt = res.layoutCopiedAt
	}

	/**
	 * A card-menu verb's handler threw. Its `:error` twin names no layout, so
	 * it settles this tab's oldest ask of that verb; saying so is the shell's
	 * catch-all toast, as for every unhandled `*:error`.
	 */
	const failLayoutAsk =
		(verb: "share" | "clone" | "update" | "new-session") => () => {
			layoutAsks.fail(verb)
		}

	function renameLayoutPreset(presetId: number, name: string) {
		socket.emit("sessions:layoutPreset:rename", { id: presetId, name })
	}
	function deleteLayoutPreset(presetId: number) {
		socket.emit("sessions:layoutPreset:delete", { id: presetId })
	}
	function askLayoutPresetUsage(presetId: number) {
		// Cleared first so the confirmation cannot show a stale count for the
		// preset it asked about last time while this answer is in flight.
		layoutPresetUsage = null
		socket.emit("sessions:layoutPreset:usage", { id: presetId })
	}

	/** Explicit surface intents (21 §9): a node/action opened or closed panels. */
	function handleSurfaceIntent(res: Sockets.Sessions.SurfaceIntent.Push) {
		if (res.sessionId !== sessionId) return
		for (const id of res.open ?? []) surfaceManager.applyOpenIntent(id)
		for (const id of res.close ?? []) surfaceManager.applyCloseIntent(id)
	}

	/**
	 * Live reload of the authored components this page draws (C6, P5,
	 * `sessionPage/authoredReload.ts`): one SCOPED `components:changed` key
	 * per authored owner offered here, so a page hears only about its own. A
	 * push retargets that owner's widgets — declarations and placed
	 * instances both, so a re-seed keeps the new module: a new `src` remounts
	 * the widget in place, `null` draws it missing. A component newly switched
	 * on that this page does not offer is NOT fetched now; it is offered on
	 * the next `sessions:view` (re-seeding would re-seat every widget).
	 */
	const authoredOwnersKey = $derived(
		authoredOwnersOf([
			...(sessionFrames?.modePanels ?? []),
			...surfaceManager.instances
		]).join(" ")
	)

	// **Updated**, asked again on every reconnect: a push sent while the
	// socket was down — a server restart's boot reconcile included — is
	// lost, and this page would never learn it missed it.
	$effect(() => {
		if (!Number.isFinite(sessionId)) return
		return onConnect(askStartedFrom)
	})
	onDestroy(() => surfaceManager.destroy())

	d.inbox.on("sessions:view", handleSessionsView)
	d.inbox.on("sessions:panelLayout:get", handleSessionsPanelLayoutGet)
	d.inbox.on("sessions:panelLayout:startFrom", handleLayoutStartFrom)
	d.inbox.on(
		"sessions:panelLayout:startFrom:error",
		handleLayoutStartFromError
	)
	d.inbox.on(
		"sessions:panelLayout:startedFromUpdated",
		handleLayoutStartedFromUpdated
	)
	d.inbox.on("sessions:layoutPreset:save", handleLayoutPresetSave)
	d.inbox.on("sessions:layoutPreset:rename", handleLayoutPresetRename)
	d.inbox.on("sessions:layoutPreset:delete", handleLayoutPresetDelete)
	d.inbox.on("sessions:layoutPreset:usage", handleLayoutPresetUsage)
	// The card menu and Save changes to (brief 6b): every answer carries the
	// refreshed list for the layout's genre.
	d.inbox.on("sessions:layoutPreset:share", handleLayoutPresetShare)
	d.inbox.on("sessions:layoutPreset:clone", handleLayoutPresetClone)
	d.inbox.on("sessions:layoutPreset:update", handleLayoutPresetUpdate)
	d.inbox.on("sessions:layoutPreset:share:error", failLayoutAsk("share"))
	d.inbox.on("sessions:layoutPreset:clone:error", failLayoutAsk("clone"))
	d.inbox.on("sessions:layoutPreset:update:error", failLayoutAsk("update"))
	d.inbox.on(
		"sessions:layoutPreset:setNewSessionLayout:error",
		failLayoutAsk("new-session")
	)
	d.inbox.on(
		"sessions:layoutPreset:setNewSessionLayout",
		handleLayoutPresetSetNewSessionLayout
	)
	// No server emitter with a caller today — heard as it stands, since the
	// surface-intent push is the declared seam.
	d.inbox.on("sessions:surfaceIntent", handleSurfaceIntent)
	// A package's recorded event (R56), to this session's widgets.
	d.inbox.on("sessions:recordedEvent", handleRecordedEvent)
	// An authored component this page offers changed: its widgets retarget.
	d.inbox.on("components:changed", (res) => {
		const panels = [...(sessionFrames?.modePanels ?? []), ...surfaceManager.instances]
		retargetAuthoredSrc(panels, res)
		// An admin's review: the mount re-posts the grants and withdraws a revoked section.
		retargetAuthoredGrants(panels, res)
	})

	return {
		get layoutPresets() {
			return layoutPresets
		},
		get startedFromLayoutPresetId() {
			return startedFromLayoutPresetId
		},
		get startedFromUpdated() {
			return startedFromUpdated
		},
		get layoutPresetUsage() {
			return layoutPresetUsage
		},
		get layoutSettings() {
			return layoutSettings
		},
		/** The authored owners this page offers, space-joined — the inbox's `components:changed` keys. */
		get authoredOwnersKey() {
			return authoredOwnersKey
		},
		persistLayoutSettings,
		startLayoutFrom,
		saveLayoutPreset,
		saveLayoutChanges,
		shareLayout,
		cloneLayout,
		setNewSessionLayout,
		renameLayoutPreset,
		deleteLayoutPreset,
		askLayoutPresetUsage,
		/**
		 * Another session opened in the page: the surface grid re-seeds for it
		 * (plan 21) — its panel set and this user's saved layout are asked for
		 * again, and the manager re-inits once both land.
		 */
		reset() {
			panelViewLoaded = false
			panelLayoutLoaded = false
			panelLayoutBlob = {}
			layoutPresets = []
			startedFromLayoutPresetId = null
			startedFromUpdated = false
			layoutCopiedAt = null
			layoutSettings = {}
			widgetSettings = {}
			layoutPresetUsage = null
		}
	}
}

/** The page's session layout (`createSessionLayoutData`). */
export type SessionLayoutData = ReturnType<typeof createSessionLayoutData>
