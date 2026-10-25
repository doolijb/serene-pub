/**
 * 🚧 `session_state.v1` (R72): the session's stats and states as a widget
 * reads them, built from what the page's state store holds
 * (`client/state/sessionState.svelte.ts`) — the viewer's view of the one
 * resolved read (`state:get`).
 *
 * Pure: plain values in, a detached section out. The page wraps it in a
 * `$derived` and sets it under `SESSION_STATE_KEY`; a panel granted
 * `session:state` hands it to its widget — on its ctx when native, posted when
 * remote — so both read ONE projection.
 *
 * What it leaves behind on purpose:
 *  - a slot's model-facing `descriptor` — never on the read to begin with,
 *    and copied field by field here so a later server field cannot ride
 *    through unnoticed; and the same sentence where it DOES ride the read,
 *    as a per-world deviation in an owner's slot config (`configure` takes
 *    `descriptor`), dropped from every config copied here;
 *  - the resolver's cast index as the server holds it: `state.cast` is
 *    `{ byId: { <characterId>: entry }, <slug>: entry }`, and each entry
 *    carries `id`, `key` and `name` beside the values. A widget is promised
 *    each cast member's VALUES by owner key, so the cast is rebuilt from the
 *    owners, and only a slot's keys are copied out of an entry;
 *  - a WRITE's refusal: `error` is why the last read failed, and a write a
 *    widget asked for fails as that request's own rejection (R77).
 */
import type {
	SessionStateOfferV1,
	SessionStateOwnerV1,
	SessionStateSlotV1,
	SessionStateV1
} from "@serene-pub/sdk"

/** What the page's store holds, as this projection reads it. */
export interface SessionStateSource {
	/** The session the store is pointed at — module-scoped, so it can lag the page's. */
	sessionId: number | null
	loaded: boolean
	/** Why the last read failed (`readError`), never a write's refusal. */
	readError: string | null
	state: Sockets.State.ResolvedState
	slots: Iterable<Sockets.State.SlotDescriptor>
	owners: Iterable<Sockets.State.StateOwnerRow>
	/** 🚧 The held changes the store lists: an **offer** among them is drawn on both sheets (★4). */
	proposals?: Iterable<Sockets.State.ProposalRow>
	/** 🚧 Who is looking: an offer they made is theirs to withdraw. */
	viewerUserId?: number | null
	/** 🚧 The table keeps no numbers (Q2-3, ★3). */
	wordsOnly?: boolean
	/** 🚧 The people the story has met (Q3-5). */
	metPeople?: readonly { entryId: number; name: string }[]
	/** 🚧 The session's story clock in words (RF fix 8). */
	storyTime?: string | null
}

/** Before the store answers for THIS session: empty means "not yet", never "nothing". */
function notYet(sessionId: number): SessionStateV1 {
	return {
		sessionId,
		loaded: false,
		error: null,
		resolved: { world: {}, cast: {} },
		slots: [],
		owners: []
	}
}

/** A detached copy of plain data: a widget cannot reach into the store's. */
const detached = <T extends object>(value: T): T =>
	JSON.parse(JSON.stringify(value))

function slotOf(d: Sockets.State.SlotDescriptor): SessionStateSlotV1 {
	return {
		slotId: d.slotId,
		key: d.key,
		qualifiedKey: d.qualifiedKey,
		label: d.label,
		...(d.description !== undefined ? { description: d.description } : {}),
		type: d.type,
		// The stat shape a widget draws the value by (phase 2), detached.
		...(d.shape !== undefined ? { shape: d.shape } : {}),
		...(d.field !== undefined ? { field: detached(d.field) } : {}),
		appliesTo: [...d.appliesTo],
		...(d.required ? { required: true } : {}),
		...(d.retired ? { retired: true } : {}),
		...(d.sheetId !== undefined ? { sheetId: d.sheetId } : {}),
		// 🚧 How it reads at a table that keeps no numbers (Q2-3).
		...(d.words?.length ? { words: d.words.map((b) => ({ upTo: b.upTo, label: b.label })) } : {}),
		// 🚧 Drawn only while it holds something (Q3-8).
		...(d.shownWhenSet ? { shownWhenSet: true as const } : {}),
		// 🚧 RF fix 8: the rules' kind and hint, or what the host keeps it as.
		...(d.kind ? { kind: d.kind } : {}),
		...(d.shownAs ? { shownAs: d.shownAs } : {}),
		...(d.hostState ? { hostState: d.hostState } : {})
	}
}

/** Config keys a person never reads: the sentence the MODEL reads about a slot. */
const MODEL_FACING_CONFIG_KEYS: ReadonlySet<string> = new Set(["descriptor"])

function ownerOf(o: Sockets.State.StateOwnerRow): SessionStateOwnerV1 {
	const configs: Record<string, Record<string, unknown>> = {}
	for (const [slotId, config] of Object.entries(o.configs ?? {}))
		configs[slotId] = detached(
			Object.fromEntries(
				Object.entries(config ?? {}).filter(
					([k]) => !MODEL_FACING_CONFIG_KEYS.has(k)
				)
			)
		)
	return {
		key: o.key,
		kind: o.kind,
		id: o.id,
		label: o.label,
		// 🚧 Not the viewer's to write (another player's seat): the widget
		// draws its values without edit controls.
		...(o.editable === false ? { editable: false } : {}),
		// 🚧 The viewer's own seat (`owners: 'mine'` on the stats widget).
		// TODO: drop the cast once the SDK dist carries `SessionStateOwnerV1.mine`.
		...(o.mine ? ({ mine: true } as unknown as Partial<SessionStateOwnerV1>) : {}),
		// 🚧 Each repertoire its list stats hold — name and piece shape (§8).
		// TODO: drop the cast once the SDK dist carries `SessionStateOwnerV1.repertoires`.
		...(o.repertoires ? ({ repertoires: detached(o.repertoires) } as unknown as Partial<SessionStateOwnerV1>) : {}),
		// 🚧 A player seat (`owners: 'seats'`, 2026-10-18).
		...(o.seat ? { seat: true } : {}),
		// 🚧 The owner's face (PLAN-sheet §12): the sheet head's and the
		// faces strip's picture. Sent by the host since 2026-10-17, never
		// projected until 2026-10-18 — the sheet drew initials only.
		...(o.face !== undefined ? { face: o.face ? { ...o.face } : null } : {}),
		// 🚧 What the ruleset works out from the sheet (2026-10-18): armour class.
		...(o.derived?.length ? { derived: detached(o.derived) } : {}),
		// 🚧 The owner's tie sides (ties on the graph, screen 2).
		...(o.ties?.length ? ({ ties: detached(o.ties) } as unknown as Partial<SessionStateOwnerV1>) : {}),
		// 🚧 RF fix 8: what it holds, zone by zone, and its carry switches.
		...(o.zones?.length ? { zones: detached(o.zones) } : {}),
		...(o.carries?.length ? { carries: detached(o.carries) } : {}),
		configs
	}
}

/**
 * Each cast member's values, by owner key — out of the resolver's index,
 * which also holds `byId` and each entry's `id`/`key`/`name`. Only a slot's
 * keys (the qualified one every value is filed under, and the bare one its
 * first claimant also answers to) are values.
 */
function castOf(
	cast: Sockets.State.ResolvedState["cast"] | undefined,
	owners: readonly Sockets.State.StateOwnerRow[],
	slots: readonly Sockets.State.SlotDescriptor[]
): Record<string, Record<string, unknown>> {
	const valueKeys = new Set(slots.flatMap((s) => [s.qualifiedKey, s.key]))
	// 🚧 A card-less player seat's owner key is its `byId` key (`player_seat:<id>`).
	const byId = ((cast ?? {}) as Record<string, unknown>).byId as
		| Record<string, Record<string, unknown>>
		| undefined
	const out: Record<string, Record<string, unknown>> = {}
	for (const o of owners) {
		if (o.kind !== "session_cast" && o.kind !== "player_seat") continue
		const entry = (o.kind === "player_seat" ? byId?.[o.key] : (cast ?? {})[o.key]) ?? {}
		out[o.key] = detached(
			Object.fromEntries(
				Object.entries(entry).filter(([k]) => valueKeys.has(k))
			)
		)
	}
	return out
}

/**
 * 🚧 Each location's values, by owner key (phase 4) — out of the resolver's
 * `locations` index by the owner's id (its entry id), so no key function is
 * copied here. Only a slot's keys are values, as for the cast.
 */
function locationsOf(
	locations: Sockets.State.ResolvedState["locations"] | undefined,
	owners: readonly Sockets.State.StateOwnerRow[],
	slots: readonly Sockets.State.SlotDescriptor[]
): Record<string, Record<string, unknown>> {
	const valueKeys = new Set(slots.flatMap((s) => [s.qualifiedKey, s.key]))
	const byId = ((locations ?? {}) as Record<string, unknown>).byId as
		| Record<string, Record<string, unknown>>
		| undefined
	const out: Record<string, Record<string, unknown>> = {}
	for (const o of owners) {
		if (o.kind !== "session_location") continue
		const entry = byId?.[String(o.id)] ?? {}
		out[o.key] = detached(
			Object.fromEntries(
				Object.entries(entry).filter(([k]) => valueKeys.has(k))
			)
		)
	}
	return out
}

/**
 * The section, for the page's own session. While the store still answers
 * for another session (it is module-scoped, and re-pointed from an effect)
 * this is the not-yet value rather than another session's state.
 */
export function projectSessionState(
	source: SessionStateSource,
	sessionId: number
): SessionStateV1 {
	if (source.sessionId !== sessionId) return notYet(sessionId)
	const state = source.state ?? { world: {}, cast: {} }
	const slots = [...source.slots]
	const owners = [...source.owners]
	return {
		sessionId,
		loaded: source.loaded,
		error: source.readError ?? null,
		resolved: {
			world: detached(state.world ?? {}),
			cast: castOf(state.cast, owners, slots),
			...(owners.some((o) => o.kind === "session_location")
				? { locations: locationsOf(state.locations, owners, slots) }
				: {}),
			...(typeof state.version === "number"
				? { version: state.version }
				: {})
		},
		slots: slots.map(slotOf),
		owners: owners.map(ownerOf),
		...(source.wordsOnly ? { wordsOnly: true as const } : {}),
		...(source.metPeople?.length
			? { metPeople: source.metPeople.map((p) => ({ entryId: p.entryId, name: p.name })) }
			: {}),
		...(source.storyTime ? { storyTime: source.storyTime } : {}),
		...((): { offers?: SessionStateOfferV1[] } => {
			const offers = offersOf(source.proposals, owners, source.viewerUserId ?? null)
			return offers.length ? { offers } : {}
		})()
	}
}

/**
 * 🚧 The pending **offers** (_Give to…_, owner ruling ★4): a held change whose
 * payload is an offer (`state/give.ts`), named by the owners the store holds —
 * the words the offer was made with when an owner is not among them.
 */
function offersOf(
	proposals: Iterable<Sockets.State.ProposalRow> | undefined,
	owners: readonly Sockets.State.StateOwnerRow[],
	viewerUserId: number | null
): SessionStateOfferV1[] {
	const out: SessionStateOfferV1[] = []
	const named = (o: { kind?: unknown; id?: unknown } | undefined, words: unknown) => {
		const row = owners.find((r) => r.kind === o?.kind && r.id === o?.id)
		if (!row || !o) return null
		return {
			kind: row.kind as SessionStateOfferV1["from"]["kind"],
			id: row.id,
			key: row.key,
			label: row.label || (typeof words === "string" ? words : "")
		}
	}
	for (const row of proposals ?? []) {
		if (row.status !== "pending") continue
		const payload = (row.payload ?? {}) as {
			owner?: { kind?: unknown; id?: unknown }
			slotId?: unknown
			offer?: { from?: { kind?: unknown; id?: unknown }; count?: unknown; by?: unknown; fromLabel?: unknown; toLabel?: unknown; itemName?: unknown }
		}
		const offer = payload.offer
		if (!offer || typeof payload.slotId !== "string") continue
		const from = named(offer.from, offer.fromLabel)
		const to = named(payload.owner, offer.toLabel)
		if (!from || !to) continue
		const count = typeof offer.count === "number" && offer.count >= 1 ? Math.trunc(offer.count) : 1
		out.push({
			proposalId: row.id,
			slotId: payload.slotId,
			from,
			to,
			item: typeof offer.itemName === "string" && offer.itemName ? offer.itemName : "something",
			count,
			...(viewerUserId != null && offer.by === viewerUserId ? { yours: true } : {})
		})
	}
	return out
}
