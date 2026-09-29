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
		...(d.sheetId !== undefined ? { sheetId: d.sheetId } : {})
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
	return { key: o.key, kind: o.kind, id: o.id, label: o.label, configs }
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
	const out: Record<string, Record<string, unknown>> = {}
	for (const o of owners) {
		if (o.kind !== "session_cast") continue
		const entry = (cast ?? {})[o.key] ?? {}
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
		owners: owners.map(ownerOf)
	}
}
