/**
 * What the Adventure genre's four agents are told before they write anything:
 * where the scene is, who is in it, what the numbers are, and which values the
 * state-keeper is allowed to name.
 *
 * ## Why these are STRINGS
 *
 * A template context carries `state` and `plan` as structure, unrendered, and
 * a template that writes `{{{state}}}` over an object renders the literal
 * `[object Object]` — which is what the shipped narrator template did on every
 * turn until this module existed. Everything here is text on purpose, because
 * the surface these reach is an authored prompt row: a person editing the
 * narrator writes `{{location}}` beside `{{tone}}` and gets a sentence.
 *
 * ## Read off the declarations, not off a list
 *
 * `slotGuide` walks the slot registry and keeps the declarations this session
 * actually resolved a value for, so a genre that adds a slot gets it in the
 * keeper's vocabulary with nothing here to update. The bounds it prints are the
 * DECLARATION's, resolved through `resolveSlotConfig`, which is the same floor
 * an owner's own deviations are laid over — so a card that raised a cap is not
 * reflected in the prose. That is deliberate and it is why the prose is not the
 * enforcement: `core:query/resolve-state-changes@1` checks every change against
 * the config resolved for the owner it names, and refuses what does not fit.
 */

import {
	attributeSlots,
	getAttributeSlot,
	isSlotLoreRef,
	parseParticipantRef,
	resolveSlotConfig,
	slotListItemText,
	type AttributeSlotDecl,
	type SlotConfig,
	type SlotListItem
} from "@serene-pub/sdk"
import { castKey, qualifiedSlotKey, slotKey } from "$lib/server/state/resolve"
import { heardOnly } from "$lib/server/state/earshot"
import { locationRowOf } from "$lib/shared/lorebooks/describingRow"
import {
	relationshipSentence,
	type RelationshipEndRef,
	type SayableRelationship
} from "$lib/shared/lorebooks/linkVocabulary"

/** The shape `core:query/session-state@1` publishes, read defensively. */
export interface StateLike {
	world?: Record<string, unknown>
	cast?: Record<string, Record<string, unknown>>
	/** 🚧 The world's places (phase 4): `byId` by entry id, each with its `name`. */
	locations?: Record<string, Record<string, unknown>>
	/**
	 * The genre's vocabulary, values or no values (`TrackedSlot` in
	 * state/resolve) — with the owners the session's sheet put each slot on,
	 * which may be fewer than the declaration's (`location` on the world in
	 * Adventure, on the cast in a genre whose characters split up).
	 */
	slots?: Array<{ id?: unknown; appliesTo?: unknown; earshot?: unknown }>
}

/** The planner's document, read defensively — it is a model's answer. */
export interface PlanLike {
	beats?: unknown
	worldHints?: {
		location?: unknown
		timeOfDay?: unknown
		weather?: unknown
	}
}

const bag = (v: unknown): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: {}

/**
 * A value as the prompt says it. A list reads as its items — a lore reference
 * by its title and held count (`Rusty key ×2`, SDK `slotListItemText`), never
 * as the `{ entryId, name }` object a template would print as
 * `[object Object]` (attributes phase 3a).
 */
const text = (v: unknown): string =>
	typeof v === "string"
		? v.trim()
		: typeof v === "number"
			? String(v)
			: // 🚧 One reference on its own — a location that is a place entry — by its title.
				isSlotLoreRef(v)
				? slotListItemText(v).trim()
				: Array.isArray(v)
				? v
						.map((item) => slotListItemText(item as SlotListItem).trim())
						.filter(Boolean)
						.join(", ")
				: ""

/**
 * One slot's value out of a bag, under either of the two keys a state carries
 * it under — the bare name a template reads and the qualified one that makes a
 * contested name reachable.
 */
function valueOf(from: Record<string, unknown>, decl: AttributeSlotDecl) {
	const bare = from[slotKey(decl.id)]
	return bare === undefined ? from[qualifiedSlotKey(decl.id)] : bare
}

/**
 * The state as one prompt may hear it — **earshot** (lair pass R1,
 * 2026-09-28; SDK `AttributeSlotProps.earshot`).
 *
 * A slot declared `earshot: 'holder'` (the Lair's whisper) is read only by its
 * holder's own voice. So every prompt is built from the state with each such
 * value taken off every cast member but the one `speaker` names:
 *
 *  · `speaker` a `character:<id>` reference — a cast member's own voice
 *    (`build-side-character-context@1`, or a spec that wires `speaker` on
 *    `build-template-context@1`): that member keeps theirs, nobody else does;
 *  · anything else — `null`, an `envoy:` reference, a role — is nobody's
 *    voice: the planner, the scene, the state-keeper, a trap or a reveal. No
 *    member keeps one.
 *
 * ⚠ **Applied where state becomes a prompt, never at the run's read.**
 * `session-state@1` is one read a whole run shares — every voice of a turn
 * takes the same `state` — so the query cannot know whose prompt it is
 * feeding. The context builders do; `bindings.ts` calls this at both of the
 * places state reaches a template: the shared builder
 * (`build-template-context@1`, the `{{state}}` a template walks) and the
 * adventure surfaces' `mergeContext` (`{{stateSummary}}`, `{{slots}}`,
 * `{{location}}`).
 *
 * The filter itself is `heardOnly` (`state/earshot.ts`) — the one a
 * person's view takes too, with the holder-only value's data audience in
 * place of the speaker (`stateAsHeard`, every `state:*` reply). It never
 * mutates and fails closed; see there.
 */
export function withinEarshot<S>(state: S, speaker: unknown): S {
	const holder = holderOf(speaker)
	return heardOnly(state, (characterId) => holder !== null && characterId === holder)
}

/**
 * The state as a **voice** sees the places — the third looker of place sight
 * (plan A28; `shared/lorebooks/placeSight.ts`).
 *
 * A voice is somebody in the scene speaking for themselves
 * (`build-side-character-context@1`: a delver, an Adventure cast member, a
 * suspect). Of the places the session sees (`state.locations`, already the
 * session's sight), a voice reads the stats of ONE: the place the scene is
 * at — the world's `location`, else the planner's hint, resolved by the room
 * rule (`worldValueOrHint` + `locationRowOf`) against the rooms listing when
 * the voice is handed one (`entries`, so a key finds the room exactly as
 * `{{locationEntry}}` finds it), else against the places' names. What lies
 * in a room the party have not reached is the game master's knowledge; a
 * voice handed it walks straight to the treasure. When the scene's place
 * names none of them, a voice reads no place's stats.
 *
 * Only the stats narrow: the rooms' NAMES (`{{knownLocations}}`, from the
 * rooms listing) are unchanged, so a voice still knows which rooms exist.
 * The planner, the scene and the keeper are nobody's voice and read every
 * place the session sees. Pure; never mutates.
 */
export function withinSight<S>(state: S, plan?: PlanLike, entries?: unknown): S {
	const s = state as StateLike | undefined
	const byId = bag(bag(s?.locations).byId)
	const rows = Object.values(byId)
	if (!rows.length) return state
	const where = worldValueOrHint(s, plan, "location", "location")
	const listed = Array.isArray(entries) && entries.length ? entries : rows
	const here = where !== undefined ? locationRowOf(where, listed) : null
	const hereId = here ? (here as { id?: unknown }).id : undefined
	const locations: Record<string, unknown> = {}
	const kept: Record<string, unknown> = {}
	for (const [id, entry] of Object.entries(byId)) {
		if (hereId === undefined || bag(entry).id !== hereId) continue
		kept[id] = entry
		const key = bag(entry).key
		if (typeof key === "string" && key) locations[key] = entry
	}
	return { ...(state as object), locations: { ...locations, byId: kept } } as S
}

/**
 * 🚧 The state as **the party's reach** sees the places (place sight, owner
 * ruling 2026-09-30): the Lair's Castellan speaking for the party.
 *
 * Of the places the session sees, the stats of the place the scene is at —
 * found exactly as `withinSight` finds it — and of every place one way from
 * it: the far ends of that room's listed links (`links` on the rooms listing,
 * the "From here:" ways, already the session's reading of the places graph)
 * that are places the session sees. No other place's stats; names are
 * untouched. With no room found, no place's stats. Pure; never mutates.
 *
 * ⚠ Wider than a voice's sight (one place) and narrower than the planner's
 * (every place): the party may know what lies in the next room along, never
 * the far end of the dungeon.
 */
export function withinReach<S>(state: S, plan?: PlanLike, entries?: unknown): S {
	const s = state as StateLike | undefined
	const byId = bag(bag(s?.locations).byId)
	const rows = Object.values(byId)
	if (!rows.length) return state
	const where = worldValueOrHint(s, plan, "location", "location")
	const listed = Array.isArray(entries) && entries.length ? entries : rows
	const here = where !== undefined ? locationRowOf(where, listed) : null
	const reached = new Set<unknown>()
	if (here) {
		reached.add((here as { id?: unknown }).id)
		const links = (here as { links?: unknown }).links
		for (const link of Array.isArray(links) ? links : [])
			reached.add(bag(bag(link).to).entryId)
	}
	const locations: Record<string, unknown> = {}
	const kept: Record<string, unknown> = {}
	for (const [id, entry] of Object.entries(byId)) {
		if (!reached.has(bag(entry).id)) continue
		kept[id] = entry
		const key = bag(entry).key
		if (typeof key === "string" && key) locations[key] = entry
	}
	return { ...(state as object), locations: { ...locations, byId: kept } } as S
}

/** The character id a `character:<id>` reference names; null for any other speaker. */
function holderOf(speaker: unknown): string | null {
	if (typeof speaker !== "string") return null
	try {
		const ref = parseParticipantRef(speaker)
		return ref.kind === "character" ? ref.id : null
	} catch {
		return null
	}
}

/**
 * The declarations this session tracks for one facet, in a stable order.
 *
 * The state's own `slots` when it carries them, because a slot with no default
 * has no VALUE until somebody sets it and a vocabulary missing `location` is a
 * keeper that can never name the place. A state built without them falls back
 * to the keys that do have values, which is the most an old shape can say.
 */
function present(
	state: StateLike | undefined,
	facet: "world" | "cast" | "location"
): AttributeSlotDecl[] {
	const declared = tracked(state)
	const bags =
		facet === "world"
			? [bag(state?.world)]
			: facet === "location"
				? places(state).map((p) => p.values)
				: Object.entries(bag(state?.cast))
						.filter(([key]) => key !== "byId")
						.map(([, values]) => bag(values))
	const pool = declared.length ? declared : [...attributeSlots()]
	const forFacet = [...pool]
		.sort((a, b) => a.id.localeCompare(b.id))
		.filter((d) => d.appliesTo.includes(facet))
	return declared.length
		? forFacet
		: forFacet.filter((d) => bags.some((b) => valueOf(b, d) !== undefined))
}

/**
 * The session's vocabulary as declarations, each on the owners the session
 * carries it on: the state row's `appliesTo` when it has one (the sheet's
 * narrowing), else the declaration's own.
 */
function tracked(state: StateLike | undefined): AttributeSlotDecl[] {
	return (Array.isArray(state?.slots) ? state.slots : []).flatMap((row) => {
		const decl = typeof row?.id === "string" ? getAttributeSlot(row.id) : undefined
		if (!decl) return []
		const owners = Array.isArray(row?.appliesTo)
			? (row.appliesTo as AttributeSlotDecl["appliesTo"])
			: undefined
		return [owners ? { ...decl, appliesTo: owners } : decl]
	})
}

/** 🚧 The world's places (phase 4), by their names, from the `byId` index. */
function places(state: StateLike | undefined): Array<{ name: string; values: Record<string, unknown> }> {
	return Object.values(bag(bag(state?.locations).byId)).map((v) => {
		const values = bag(v)
		return { name: typeof values.name === "string" ? values.name : "", values }
	})
}

/** `0 to 20` · `one of calm, wary` · `text` — what a slot will accept. */
function accepts(decl: AttributeSlotDecl, config: SlotConfig): string {
	if (decl.type === "integer") {
		const low = typeof config.min === "number" ? config.min : null
		const high = typeof config.max === "number" ? config.max : null
		if (low !== null && high !== null)
			return `a whole number from ${low} to ${high}`
		if (high !== null) return `a whole number, at most ${high}`
		if (low !== null) return `a whole number, at least ${low}`
		return "a whole number"
	}
	if (decl.type === "enum")
		return `one of ${(config.of ?? []).join(", ") || "nothing declared"}`
	if (decl.type === "boolean") return "true or false"
	if (decl.type === "derived") return "computed, and never set here"
	if (decl.type === "list")
		return typeof config.maxItems === "number"
			? `a list of items, at most ${config.maxItems}`
			: "a list of items"
	return typeof config.maxLength === "number"
		? `a short line of text, at most ${config.maxLength} characters`
		: "a short line of text"
}

/**
 * The vocabulary the keeper is answering in: every tracked value, its type, its
 * bounds and the exact words an enum accepts.
 *
 * Written out because a 12B model that has not been shown the options invents
 * them: a live Rest proposed stamina 90 on a slot that stops at 10 and weather
 * "Overcast with Storm Clouds", and every one of them landed in front of a
 * player as a pending change to accept or reject.
 */
export function slotGuide(state: StateLike | undefined): string {
	const lines: string[] = []
	for (const decl of present(state, "cast"))
		lines.push(
			`- ${slotKey(decl.id)}: ${accepts(decl, resolveSlotConfig(decl))}, on a character, named as the conversation names them`
		)
	for (const decl of present(state, "world"))
		lines.push(
			`- ${slotKey(decl.id)}: ${accepts(decl, resolveSlotConfig(decl))}, on the world, whose owner is written as world`
		)
	// A place holds state too (phase 4) — said only when the world has one.
	if (places(state).length)
		for (const decl of present(state, "location"))
			lines.push(
				`- ${slotKey(decl.id)}: ${accepts(decl, resolveSlotConfig(decl))}, on a place, named as the lorebook names it`
			)
	return lines.join("\n") || "- nothing: this session tracks no values."
}

/**
 * The numbers as they stand, as the one paragraph an agent reads before it
 * writes: the world's own values, then each cast member's, then what anybody is
 * carrying.
 *
 * Names come from the cast bundle when there is one, because the state's own
 * keys are lowercased and punctuation-stripped for templates to address, and a
 * prompt that says `verity` is teaching the model to write the key instead of
 * the name.
 */
export function stateSummary(
	state: StateLike | undefined,
	names: readonly string[] = []
): string {
	const nameOf = new Map(names.map((n) => [castKey(n), n]))
	const lines: string[] = []

	const world = bag(state?.world)
	const worldValues = present(state, "world")
		.map(
			(d) => `${slotKey(d.id)} is ${text(valueOf(world, d)) || "not set"}`
		)
		.join(", ")
	if (worldValues) lines.push(`The world: ${worldValues}.`)

	const castDecls = present(state, "cast")
	for (const [key, values] of Object.entries(bag(state?.cast))) {
		// `byId` is the cast's other INDEX, not a cast member (R17). It sits
		// inside `cast` so a template has one place to look; a prompt walking
		// the keys has to step over it or it reads as somebody called "byId".
		if (key === "byId") continue
		const owned = bag(values)
		const written = castDecls
			.map((d) => [slotKey(d.id), text(valueOf(owned, d))] as const)
			.filter(([, v]) => v !== "")
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")
		if (written) lines.push(`${nameOf.get(key) ?? key}: ${written}.`)
	}

	// What somebody carries is their `inventory` stat since phase 3b, and
	// reads above as any list does (`inventory Rusty key ×2, rope`).

	// 🚧 Each place with something said of it (phase 4): what lies where.
	const placeDecls = present(state, "location")
	for (const place of places(state)) {
		const written = placeDecls
			.map((d) => [slotKey(d.id), text(valueOf(place.values, d))] as const)
			.filter(([, v]) => v !== "")
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")
		if (written && place.name) lines.push(`${place.name}: ${written}.`)
	}

	return lines.join("\n") || "Nothing is tracked in this session yet."
}

/** Where the scene is, when it is, what the sky is doing, and what happens. */
export interface SceneAnchor {
	location: string
	timeOfDay: string
	weather: string
	beats: string
}

/**
 * The declarations the session keeps on the WORLD: its own vocabulary when
 * the state carries it; an older shape with no `slots` falls back to the
 * registry, as `present` does.
 */
function onWorld(state: StateLike | undefined): AttributeSlotDecl[] {
	return Array.isArray(state?.slots)
		? tracked(state).filter((d) => d.appliesTo.includes("world"))
		: [...attributeSlots()].filter((d) => d.appliesTo.includes("world"))
}

/**
 * One world fact as a prompt reads it — the world's value where the session
 * keeps that slot on the world, else the planner's hint — raw: words or a
 * lore reference, `undefined` when neither says anything.
 *
 * The ONE answer to "where is the scene" (plan A27): `{{location}}`
 * (`sceneAnchor`) and the room `{{locationEntry}}` shows (`locationVariables`)
 * both read it, so a first turn whose location only the planner has named
 * shows that room's body and ways out under the name the narrator is given.
 */
function worldValueOrHint(
	state: StateLike | undefined,
	plan: PlanLike | undefined,
	key: string,
	hint: string
): unknown {
	const decl = onWorld(state).find((d) => slotKey(d.id) === key)
	const held = decl ? valueOf(bag(state?.world), decl) : undefined
	if (text(held)) return held
	const hinted = bag(plan?.worldHints)[hint]
	return text(hinted) ? hinted : undefined
}

/**
 * The four facts a narrator has to be given rather than left to infer.
 *
 * The world state answers first and the planner's hint second, which is the
 * order that makes a FIRST turn work: nothing has written a location down yet,
 * the planner has just decided one, and a narrator told "not set" opens the
 * scene wherever it likes. A live turn did exactly that, on a dock, with a
 * character nobody had written.
 *
 * ⚠ **The world's value only where the session keeps it on the world**
 * (2026-09-26: location is a premade stat, not a built-in). A genre that puts
 * `location` on each character has no "where the scene is" on the world, and
 * reading one off it would be reading a value its sheet never declared; such
 * a genre's templates say `{{state.cast.<who>.location}}` or read the state
 * block, and `{{location}}` falls to the planner's hint.
 */
export function sceneAnchor(
	state: StateLike | undefined,
	plan: PlanLike | undefined
): SceneAnchor {
	const at = (key: string, hint: string, missing: string) =>
		text(worldValueOrHint(state, plan, key, hint)) || missing
	const beats = (Array.isArray(plan?.beats) ? plan.beats : [])
		.map((b) => text(b))
		.filter(Boolean)
	return {
		location: at(
			"location",
			"location",
			"somewhere this session has not named yet"
		),
		timeOfDay: at("time-of-day", "timeOfDay", "an unstated hour"),
		weather: at("weather", "weather", "unstated"),
		beats: beats.length
			? beats.map((b) => `- ${b}`).join("\n")
			: "Nothing was planned for this turn, so carry on from what just happened."
	}
}

/** The names a listing (rows with a `name`, or plain strings) holds. */
export function listedNames(entries: unknown): string[] {
	if (!Array.isArray(entries)) return []
	return entries
		.map((e) =>
			typeof e === "string"
				? e
				: e && typeof e === "object"
					? (e as { name?: unknown }).name
					: undefined
		)
		.filter((n): n is string => typeof n === "string" && n.trim() !== "")
		.map((n) => n.trim())
}

/**
 * A listed room's ways out, one `- ` line each, said FROM the room — the
 * "From here:" block of `{{locationEntry}}` (places plan B6, §6.3).
 *
 * `links` is what `core:query/lorebook-entries@1` puts on a row when asked
 * `withLinks`: `LoreLinkRow`s already said from the row (its `linkType` is the
 * wording from here, whichever end the row is), already filtered by the host's
 * reading — standing, never `secret`, both ends live, the far end one the
 * wired speaker may see (with none wired, one every voice may), and one way
 * INTO the room left out. The host is the only place that last rule can be
 * kept: a `LoreLinkRow` is said from the row, so it always reads out from
 * here, and nothing on it could tell an inbound one apart. Each is said with
 * the one sentence every surface says a relationship with
 * (`relationshipSentence`, shared with the editor and the canvas). A link with
 * no far end, or a far end with no name, says nothing a prompt could use.
 */
export function fromHereLines(row: { id?: unknown; links?: unknown }): string[] {
	if (typeof row.id !== "number" || !Array.isArray(row.links)) return []
	const here: RelationshipEndRef = { kind: "entry", id: row.id }
	const out: string[] = []
	for (const link of row.links) {
		if (!link || typeof link !== "object") continue
		const l = link as {
			to?: { entryId?: unknown; name?: unknown }
			linkType?: unknown
			reverseLinkType?: unknown
			name?: unknown
		}
		const farId = l.to?.entryId
		const farName = typeof l.to?.name === "string" ? l.to.name.trim() : ""
		if (typeof farId !== "number" || !farName) continue
		const rel: SayableRelationship = {
			from: here,
			to: { kind: "entry", id: farId },
			relationshipType: typeof l.linkType === "string" ? l.linkType : "",
			reverseRelationshipType:
				typeof l.reverseLinkType === "string" ? l.reverseLinkType : null,
			name: typeof l.name === "string" ? l.name : null
		}
		const sentence = relationshipSentence(rel, here, () => farName)
		if (sentence) out.push(`- ${sentence}`)
	}
	return out
}

/**
 * The places a planner or narrator is always shown (lair pass B13,
 * 2026-09-27), whatever the retrieval ranking admitted: every place the
 * session sees (the rooms listing: a session's place sight, plan A27), by
 * name, as `{{knownLocations}}`; and the entry of the one the party are in —
 * the world's `location` slot, else the planner's hint, as `{{location}}`
 * reads it — as `{{locationEntry}}`,
 * its body under its name and, when the listing carried its links, its ways
 * out under "From here:" (places plan B6; `fromHereLines`). Each is absent
 * when there is nothing to say, so a template writes `{{#if knownLocations}}`.
 *
 * The ranker keys off the direction text, so a turn about a torch gutters
 * admitted no rooms at all and the planner — told "the rooms you have been
 * shown are the rooms that exist" — knocked at every door (F12).
 */
export function locationVariables(
	entries: unknown,
	state: StateLike | undefined,
	plan?: PlanLike
): { knownLocations?: string; locationEntry?: string } {
	const names = listedNames(entries)
	if (!names.length) return {}
	const out: { knownLocations?: string; locationEntry?: string } = {
		knownLocations: [...new Set(names)].join(", ")
	}
	// Where the scene is, as `{{location}}` says it: the world's value, else
	// the planner's hint (`worldValueOrHint`). The Lair's Answer the door finds
	// the room it links to in the same order and by the same rule
	// (`locationRowOf`): the world's value, else the knock's `vantage`, which
	// is the knock turn's own plan rather than one a prompt was built from.
	const where = worldValueOrHint(state, plan, "location", "location")
	const row = where !== undefined ? locationRowOf(where, entries) : null
	if (row && typeof row === "object") {
		const { name, content } = row as { name?: unknown; content?: unknown }
		const body = typeof content === "string" ? content.trim() : ""
		const ways = fromHereLines(row as { id?: unknown; links?: unknown })
		out.locationEntry = [
			String(name).trim(),
			...(body ? [body] : []),
			...(ways.length ? ["From here:", ...ways] : [])
		].join("\n")
	}
	return out
}
