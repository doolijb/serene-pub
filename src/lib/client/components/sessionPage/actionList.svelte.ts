/**
 * The session page's copy of the action list (R-15, U5c): what this session
 * offers this person, per venue and per channel, as the server lists it — and
 * the verdicts every control that draws a listed action reads off it (the
 * chips, the turn controls, the `/` palette, the More menu and the legend),
 * so they grey exactly the same rows.
 */
import { statusText } from "$lib/client/i18n/state.svelte"
import { itemValuesOf } from "$lib/shared/actions/itemValues"
import { actionIdentity, NARRATE_ACTION } from "$lib/shared/actions/identity"
import { paletteRowState } from "@serene-pub/core-catalog/conversation"
import { DEFAULT_CHANNEL } from "@serene-pub/sdk"
import { canRegenerateNewest } from "$lib/client/components/sessionPage/swipeControls"
import { actionTitle } from "$lib/client/components/sessionPage/actionTitle"
import { withinAudience } from "$lib/client/components/sessionPage/audienceVenues"
import {
	legendSections,
	type LegendVerdict
} from "$lib/client/components/sessionPage/actionLegend"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import type { SessionPageInbox } from "$lib/client/components/sessionPage/sessionPageInbox.svelte"
import type { SessionPageData } from "$lib/client/components/sessionPage/sessionPageData.svelte"

export interface ActionListDeps {
	socket: TypedSocket
	inbox: SessionPageInbox
	/** The session in the route. */
	sessionId(): number
	/** The loaded session and its viewer: the newest line, the channels, the verbs, the narrator's name. */
	data: SessionPageData
}

/** The action list and its verdicts. Registers its listeners on the inbox at once. */
export function createActionList(d: ActionListDeps) {
	const socket = d.socket
	const sessionId = $derived(d.sessionId())
	const session = $derived(d.data.session)
	const lastMessage = $derived(d.data.lastMessage)
	const narratorName = $derived(d.data.narratorName)
	const needsPersona = $derived(d.data.needsPersona)
	const sessionChannels = $derived(d.data.sessionChannels)
	const messageVerbs = $derived(d.data.messageVerbs)
	const canControlMessage = (msg: SelectSessionMessage) =>
		d.data.canControlMessage(msg)

	// The action list (R-15, U5c): what this session offers this person, per
	// venue, from rows. The narrate button's *presence* comes from here —
	// retiring the narrate spec removes it with no UI code involved. Its
	// presentation stays bespoke (the resolved narrator name), which is a
	// client mapping on the function key, not a hardcoded button. Core's
	// message verbs ride the same list, so the message menu and the quick
	// row hand-write no verb button either.
	let actionVenues = $state<Sockets.Sessions.Actions.Response["venues"]>({})
	/** 🚧 Where this viewer's Delete is refused (owner ruling ★9), off the list. */
	let deleteRefusedThrough = $state<Sockets.Sessions.Actions.Response["deleteRefusedThrough"]>(null)
	/**
	 * What a block press of a form-venue action collects (lair pass R9) —
	 * those actions are listed in no venue, so `listedAction` cannot find
	 * them; `collectingAction` reads here after the venues.
	 */
	let formCollects = $state<
		NonNullable<Sockets.Sessions.Actions.Response["formCollects"]>
	>({})
	/**
	 * Every other channel's listing (lair re-plan S1), by slug: a composer on
	 * the Sanctum draws the Sanctum's chips and turn controls — Continue and
	 * Narrate, never Pick or retake there. `main`'s is `actionVenues`, which
	 * every other reader keeps; these arrive beside it, asked for each time
	 * `main`'s does (`handleSessionsActions`), so a run's end refreshes both.
	 */
	let channelVenues = $state<
		Record<string, Sockets.Sessions.Actions.Response["venues"]>
	>({})
	const onOtherChannel = (channel?: string): channel is string =>
		!!channel && channel !== DEFAULT_CHANNEL
	/** One venue of a channel's listing — `main`'s when none is named. */
	const venueOn = (kind: string, channel?: string) =>
		onOtherChannel(channel)
			? (channelVenues[channel]?.[kind] ?? { primary: [], overflow: [] })
			: venueOf(kind)
	const venueOf = (kind: string) =>
		actionVenues[kind] ?? { primary: [], overflow: [] }
	/**
	 * The composer venue's primary set — the chips. A genre that contributes
	 * none gets no row at all, which is what keeps the composer of a genre
	 * with nothing to press exactly as wide as its message field.
	 */
	let sessionActions = $derived(venueOf("composer").primary)
	/**
	 * The ONE chip of the composer's Actions row (note 30, 2026-10-02): the
	 * turn controls and the genre's actions alike. The row's widget sheet
	 * (`messages.composer-actions`) draws its colour and shape; this is the
	 * button underneath it.
	 */
	const sessionChipClass = "btn btn-sm preset-tonal-surface"
	/** …and its overflow: every enabled action the chips leave out (F38). */
	let composerOverflow = $derived(venueOf("composer").overflow)
	/** The More menu's list — primary then overflow, every enabled action, quick or not (NOMENCLATURE overflow). */
	let composerMenuActions = $derived([...sessionActions, ...composerOverflow])
	/** The message venue, handed to every row. */
	let messageActions = $derived(venueOf("message"))
	/** The extra tab's — the turn controls and Regenerate, when the server lists them. */
	let extraActions = $derived([
		...venueOf("extra").primary,
		...venueOf("extra").overflow
	])
	/**
	 * What `/` offers (R-15 slash names): the composer's own venues — the
	 * chips row and the extra tab — one entry per action, whether it sits in
	 * the primary set or the overflow.
	 */
	let paletteActions = $derived(
		[...sessionActions, ...composerOverflow, ...extraActions].map((a) => ({
			key: a.key,
			specSlug: a.specSlug,
			name: a.name,
			slash: a.slash,
			icon: a.icon,
			audience: a.audience,
			canAct: a.canAct,
			isNew: a.isNew,
			venue: a.venue,
			// The enabled-when verdict (U5e), its reason resolved here once
			// for the chips, the More menu and the palette alike; the
			// `item.*` half rides for the palette to judge against the
			// newest row (`newestItem`).
			enabled: a.enabled,
			...(a.reason
				? { reason: statusText(a.reason) || a.reason.i18n.en }
				: {}),
			...(a.itemPredicates?.length
				? { itemPredicates: a.itemPredicates }
				: {}),
			// What it collects (R3): whether it takes a slash argument (S2).
			...(a.collects ? { collects: a.collects } : {})
		}))
	)
	/**
	 * What a composer press of a message action acts on — the newest row's
	 * `item` document, the same shape the message row and the server's door
	 * build — or `null` for a session with no row, which fails every `item.*`
	 * predicate: nothing to regenerate, extend or swipe.
	 */
	let newestItem = $derived.by(() => {
		const newest = lastMessage
		if (!newest) return null
		return itemValuesOf(newest, {
			isNewest: true,
			mine: canControlMessage(newest)
		})
	})

	/**
	 * The verdict a chip reads off its listed action: the audience and the
	 * enabled-when (U5e), the reason resolved to a sentence — the same
	 * `paletteRowState` the palette and the More menu read.
	 */
	const chipVerdict = (a: Sockets.Sessions.Actions.Action) => ({
		name: a.name,
		audience: a.audience,
		canAct: a.canAct,
		enabled: a.enabled,
		venue: a.venue,
		...(a.reason
			? { reason: statusText(a.reason) || a.reason.i18n.en }
			: {}),
		...(a.itemPredicates?.length
			? { itemPredicates: a.itemPredicates }
			: {})
	})
	/**
	 * The turn controls' chips — Regenerate, Continue — are core's `retry`
	 * and `advance` at the **extra** venue; `retry` acts on the newest
	 * row: their state is the listed verdict plus the `item.*` predicates
	 * judged against `newestItem`, exactly as the `/` palette judges the
	 * same rows (review pass 3). The bespoke handlers stay the click
	 * targets; only the grey decision is the list's.
	 */
	const extraAction = (key: string) =>
		extraActions.find((a) => a.specSlug === "core" && a.key === key)
	/** A turn control on a channel's listing (S1) — `extraAction` for `main`. */
	const extraActionOn = (key: string, channel?: string) =>
		onOtherChannel(channel)
			? [
					...venueOn("extra", channel).primary,
					...venueOn("extra", channel).overflow
				].find((a) => a.specSlug === "core" && a.key === key)
			: extraAction(key)
	const extraChip = (
		t: Sockets.Sessions.Actions.Action,
		busy: [holds: boolean, reason: string][] = []
	) => {
		for (const [holds, reason] of busy)
			if (holds) return { disabled: true, reason }
		return paletteRowState(chipVerdict(t), {
			generating: d.data.generating,
			newest: newestItem,
			// The reason for a failed `item.*` predicate, in the viewer's
			// language: the app's own `statusText`, as `chipVerdict` resolves
			// the listed reason.
			statusText
		})
	}
	/** A persona-less session cannot take a turn — the one client-side condition the turn controls keep. */
	const NO_PERSONA = "add a persona first"
	/**
	 * The action legend's verdict (2026-09-28): the one each row's own button
	 * reads — the chips', the turn controls' and the message menu's — so the
	 * legend greys exactly what is grey. A message row is judged without a
	 * row: its `item.*` predicates are per message, and the menu says those.
	 */
	const legendVerdict: LegendVerdict = (t, venue) => {
		const generating = d.data.generating
		if (venue === "composer")
			return paletteRowState(chipVerdict(t), {
				generating,
				newest: newestItem,
				statusText
			})
		if (venue === "extra")
			return extraChip(
				t,
				t.specSlug === "core" &&
					(t.key === "advance" || t.key === "pick")
					? [[needsPersona, NO_PERSONA]]
					: []
			)
		return paletteRowState(chipVerdict(t), { generating, statusText })
	}
	/** Every action this session offers right now, by venue — the legend's rows. */
	let actionLegend = $derived(
		// The narrate chip wears the narrator's resolved name and its own icon;
		// its legend row wears the same, so the two cannot disagree.
		legendSections(actionVenues, legendVerdict).map((s) => ({
			...s,
			entries: s.entries.map((e) =>
				e.identity === NARRATE_ACTION && s.venue === "composer"
					? {
							...e,
							name: narratorName,
							icon: "cloud-sun",
							iconAlt: narratorName
						}
					: e
			)
		}))
	)

	const offersVerb = (verb: "retry" | "swipe") => {
		const listed = [...messageActions.primary, ...messageActions.overflow]
		if (listed.length)
			return listed.some((a) => a.specSlug === "core" && a.key === verb)
		return messageVerbs?.[verb] !== false
	}

	let canRegenerateLastMessage: boolean = $derived(
		canRegenerateNewest(lastMessage, offersVerb("retry"))
	)

	/**
	 * The enabled-when verdict is a snapshot of the session's published
	 * values (U5e). The SERVER re-sends the list when a run ends — every road
	 * pushes `sessions:actions` after `runRegistry.finish` (review C1) — so
	 * nothing here relists off progress frames or the generating flag. The
	 * one client-side ask is a state write landing (`state:changed`, scoped
	 * to this session): a person setting a slot by hand starts no run, and
	 * *Set a location first* should lift the moment they set it.
	 */
	function relistActions() {
		if (!Number.isFinite(sessionId)) return
		socket.emit("sessions:actions", { sessionId })
	}

	function handleSessionsActions(msg: Sockets.Sessions.Actions.Response) {
		if (msg.sessionId !== sessionId) return
		// Another channel's listing (S1): kept beside `main`'s, never over it.
		if (onOtherChannel(msg.channel)) {
			channelVenues = {
				...channelVenues,
				[msg.channel]: withinAudience(msg.venues)
			}
			return
		}
		// Outside the viewer's audience is hidden, never listed greyed (round 2).
		actionVenues = withinAudience(msg.venues)
		formCollects = msg.formCollects ?? {}
		deleteRefusedThrough = msg.deleteRefusedThrough ?? null
		// Every other channel the session has is listed again with it: a run
		// ending pushes `main`'s alone, and the Sanctum's Continue must lift
		// when the story's does.
		for (const channel of sessionChannels)
			if (onOtherChannel(channel))
				socket.emit("sessions:actions", { sessionId, channel })
	}

	/**
	 * The person opened a list that showed these newcomers: the mark clears
	 * here at once and on the server for good (`sessions:actionsSeen`).
	 */
	function markActionsSeen(keys: string[]) {
		if (!keys.length) return
		const set = new Set(keys)
		const next: typeof actionVenues = {}
		for (const [kind, v] of Object.entries(actionVenues))
			next[kind] = {
				primary: v.primary.map((a) =>
					set.has(actionIdentity(a)) ? { ...a, isNew: false } : a
				),
				overflow: v.overflow.map((a) =>
					set.has(actionIdentity(a)) ? { ...a, isNew: false } : a
				)
			}
		actionVenues = next
		socket.emit("sessions:actionsSeen", { sessionId, keys })
	}

	/** A run's toast title: the pressed action's name, never its `<spec>#<key>` identity. */
	const runActionTitle = (action: string | undefined) =>
		actionTitle(
			action,
			Object.values(actionVenues).flatMap((v) => [
				...v.primary,
				...v.overflow
			])
		)

	/** A listed action by identity, from any venue — what a press collects is on it. */
	function listedAction(
		identity: string
	): Sockets.Sessions.Actions.Action | undefined {
		for (const v of Object.values(actionVenues))
			for (const a of [...v.primary, ...v.overflow])
				if (actionIdentity(a) === identity) return a
		return undefined
	}

	d.inbox.on("state:changed", () => relistActions())
	d.inbox.on("sessions:actions", handleSessionsActions)

	/**
	 * 🚧 Whether the server would refuse this viewer's Delete on `row`
	 * (owner ruling ★9, `deleteRefusedThrough`): a kept turn's row, which
	 * loses Delete rather than offering it to refuse.
	 */
	function deleteRefused(row: { id: number; channel?: string | null }): boolean {
		const kept = deleteRefusedThrough
		if (!kept || row.id > kept.messageId) return false
		const slug = (row.channel || "main").split(":")[0]
		return kept.channels.includes(slug)
	}

	return {
		deleteRefused,
		/** For a projection's cache key: moves whenever the delete floor does. */
		get deleteRefusedKey(): string {
			return deleteRefusedThrough ? `${deleteRefusedThrough.messageId}:${deleteRefusedThrough.channels.join(",")}` : ""
		},
		/** `main`'s venues. */
		get actionVenues() {
			return actionVenues
		},
		/** What a block press of a form-venue action collects (lair pass R9). */
		get formCollects() {
			return formCollects
		},
		onOtherChannel,
		venueOn,
		/** The composer venue's primary set — the chips. */
		get sessionActions() {
			return sessionActions
		},
		sessionChipClass,
		get composerMenuActions() {
			return composerMenuActions
		},
		get extraActions() {
			return extraActions
		},
		get paletteActions() {
			return paletteActions
		},
		get newestItem() {
			return newestItem
		},
		chipVerdict,
		extraAction,
		extraActionOn,
		extraChip,
		NO_PERSONA,
		get actionLegend() {
			return actionLegend
		},
		offersVerb,
		get canRegenerateLastMessage() {
			return canRegenerateLastMessage
		},
		markActionsSeen,
		listedAction,
		runActionTitle
	}
}

/** The session page's action list (`createActionList`). */
export type ActionList = ReturnType<typeof createActionList>
