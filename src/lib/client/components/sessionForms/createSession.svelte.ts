/**
 * Starting a session: the derivations and the one payload builder.
 *
 * A session starts by choosing a **genre**, then an admin-enabled **session
 * preset** of that genre, then very few session-level settings (ruled
 * 2026-09-10). Everything that decision needs lives here rather than in a
 * component, so the dashboard's wizard and `StartSessionForm` send the same
 * `sessions:create` body and cannot drift.
 *
 * The server derives the genre from the preset and refuses a preset or a genre
 * an administrator has switched off, so the payload this module builds is a
 * proposal: it names both, and the preset wins. See `sessionsCreateHandler`.
 */
import type { StoredSwapContribution } from "$lib/shared/swaps"
import { settingValueOf } from "@serene-pub/sdk"
import { adoptedBookRules, howStrictChoices, rigourFor, rulesField } from "$lib/shared/rulesets/rulesOffer"
import {
	INITIAL_PRESET_FILLABLE_FIELDS,
	resolvePresetFill,
	type PresetFillState,
	type PresetFillableFields
} from "./applyPresetDefaults"

/**
 * The F29 floor: the genre every build answers for, stated here rather than
 * imported from the server-only `sessionGenres` module. When `sessions:genres`
 * returns nothing — a registry that never synced — the flow behaves as a
 * single-genre install, which is the standard genre alone.
 */
/** The genre a session with none is read as — **Story** since 2026-10-19 (was Chat, which is the assistant now). */
export const STANDARD_GENRE_ID = "core:genre/story"

/**
 * The Guide genre — one envoy answering about the app, no characters. Stated
 * here for the same reason as the standard genre: the client reads no SDK
 * catalogue. The home wizard's "Talk to an AI" starts one.
 */
export const GUIDE_GENRE_ID = "core:genre/guide"

/**
 * 🚧 The game the home wizard's **Play a game** opens (2026-10-18, the
 * 100-turn walk #31: nothing on the wizard named a game). Stated here as the
 * Guide's is: the client reads no SDK catalogue.
 */
export const GAME_GENRE_ID = "core:genre/dungeon-crawler"

export type GenreRow = Sockets.Sessions.Genres.Response["genres"][number]
export type GenreShape = GenreRow["shape"]
export type PresetRow = Sockets.SessionAdmin.PresetRow

/** `ns:kind/name@N` split into the bare type and its version. */
export function genreVersion(genreId: string): {
	bare: string
	version: number
} {
	const [bare, v] = genreId.split("@")
	return { bare: bare ?? genreId, version: Number(v ?? 1) }
}

/**
 * A genre's version as a person reads it: "version 2" for `…@2`. The id's
 * `@N` suffix is the only record of it; an id without one is version 1.
 */
export function genreVersionLabel(genreId: string): string {
	return `version ${genreVersion(genreId).version}`
}

/**
 * Each genre once, at its newest registered version. Starting a session on a
 * superseded version is a support question waiting to happen, and an existing
 * session reaches a newer one through the upgrade instead.
 */
export function latestGenres(genres: GenreRow[]): GenreRow[] {
	const byBare = new Map<string, GenreRow>()
	for (const g of genres) {
		const p = genreVersion(g.genreId)
		const held = byBare.get(p.bare)
		if (!held || genreVersion(held.genreId).version < p.version)
			byBare.set(p.bare, g)
	}
	return [...byBare.values()]
}

/**
 * The presets a person may start this genre with. `sessionPresets:list`
 * already cuts to the enabled presets of enabled genres for a non-admin; an
 * administrator's copy carries the disabled ones too, because they administer
 * them, so the filter runs again here rather than offering one nobody may
 * start.
 */
export function enabledPresetsFor(
	presets: PresetRow[],
	genreId: string | null
): PresetRow[] {
	if (!genreId) return []
	return presets.filter((p) => p.enabled && p.genreId === genreId)
}

/**
 * Which genre the picker opens on: the one whose default preset an
 * administrator has starred, else the first registered.
 *
 * `isDefault` on the preset row is the one record of a genre's default
 * preset (one per genre; "Make default" in the Pipelines view and Admin both
 * write it through `sessionPresets:update`) — so a genre that has one is a
 * genre the instance is set up to start.
 */
export function defaultGenreId(
	genres: GenreRow[],
	presets: PresetRow[]
): string | null {
	const latest = latestGenres(genres)
	if (!latest.length) return null
	for (const g of latest) {
		if (enabledPresetsFor(presets, g.genreId).some((p) => p.isDefault))
			return g.genreId
	}
	return latest[0].genreId
}

/**
 * How many characters and personas a session of this genre needs before it can
 * start.
 *
 * The standard genre keeps the ≥1 / ≥1 floor the form has always asked for,
 * even though its shape states min 0: the shape says what the *server*
 * permits, and a session with nobody in it is not what somebody starting one
 * means. Any other genre's shape speaks for itself, and an unknown genre falls
 * back to the standard floor.
 */
export function participantFloors(
	shape: GenreShape | null | undefined,
	genreId: string | null
): { characters: number; personas: number } {
	// No special case for the standard genre any more (2026-10-19): Story's
	// Minimal preset starts with nobody, so the shape alone decides.
	if (!shape || !genreId) return { characters: 1, personas: 1 }
	return {
		characters: shape.characters?.min ?? 0,
		personas: shape.personas?.min ?? 0
	}
}

/**
 * Does the new-session form start with the person's default persona chosen?
 * Ruled 2026-10-19: nothing inserts a default persona on create any more —
 * a person is a seat with no card unless they pick one. Only a genre that
 * says `preselectDefault: true` outright gets the old behaviour.
 */
export function preselectsDefaultPersona(
	shape: GenreShape | null | undefined
): boolean {
	if (!shape?.personas || shape.personas.max === 0) return false
	return shape.personas.preselectDefault === true
}

/** What `firstUnmetStartRule` reads: the start screen's answers, as values. */
export interface StartReadiness {
	genreId: string | null
	noPresetsForGenre: boolean
	characterCount: number
	personaCount: number
	floors: { characters: number; personas: number }
}

/**
 * Why Start cannot be pressed yet: the first rule the answers do not meet,
 * in the order the screen asks them, as one sentence the person can act on;
 * null when the session can start. The start screen says it under its greyed
 * Start, so the button never stands disabled without a reason, and the flow's
 * `canStart` is exactly "this is null".
 */
export function firstUnmetStartRule(r: StartReadiness): string | null {
	if (!r.genreId) return "Choose a genre."
	if (r.noPresetsForGenre) return "No preset is available for this genre."
	if (r.characterCount < r.floors.characters)
		return r.floors.characters === 1
			? "Add at least one character."
			: `Add at least ${r.floors.characters} characters.`
	if (r.personaCount < r.floors.personas) return "Choose who you play as."
	// No lorebook rule (RF fix 2, 2026-10-23): a session may always start
	// without a book — its own book (its session notes) is its world.
	return null
}

/**
 * What a one-click start — the wizard's character card, a character's own
 * Start — can do on its own: the genre and preset the instance is set up to
 * start (`defaultGenreId`), and whether `sessions:create` can be sent with
 * only what such a caller knows (a character, the first persona).
 *
 * `direct` was false when the genre asked something the caller could not
 * answer — a required lorebook (2026-09-17: an administrator-starred
 * Adventure preset made every character card's Start a refusal). ⏳ Since RF
 * fix 2 (2026-10-23) no genre requires one — a session always has its own
 * book — so `direct` is always true.
 */
export function oneClickStart(
	genres: GenreRow[],
	presets: PresetRow[]
): { genreId: string; presetId: number | null; direct: boolean } {
	const genreId = defaultGenreId(genres, presets) ?? STANDARD_GENRE_ID
	const enabled = enabledPresetsFor(presets, genreId)
	const preset = enabled.find((p) => p.isDefault) ?? enabled[0] ?? null
	return {
		genreId,
		presetId: preset?.id ?? null,
		direct: true
	}
}

/**
 * How many of something a genre takes, in words: "exactly 1", "1–3",
 * "at least 1", "up to 4", or "" when neither bound holds. `floor` is what the
 * form requires (`participantFloors`), `max` the shape's cap.
 */
export function castCountHint(floor: number, max: number | undefined): string {
	if (max != null && floor > 0 && max <= floor) return `exactly ${floor}`
	if (max != null && floor > 0) return `${floor}–${max}`
	if (floor > 0) return `at least ${floor}`
	if (max != null) return `up to ${max}`
	return ""
}

/**
 * One line of shape facts for a genre card — presentation over the same
 * shape the server validates against, in plain words (less-confusing E5,
 * 2026-10-11): a persona is "a character you play", the absent composer is
 * "you don't type messages", the narrator voice is "a narrator tells the
 * story".
 */
export function genreFacts(shape: GenreShape | null | undefined): string {
	if (!shape) return ""
	const parts: string[] = []
	const bounds = (b: { min: number; max?: number }) =>
		b.min > 0
			? b.max != null
				? b.max === b.min
					? `exactly ${b.min}`
					: `${b.min}–${b.max}`
				: `${b.min}+`
			: b.max != null
				? `up to ${b.max}`
				: ""
	const cast = shape.characters
	if (!cast || cast.max === 0) parts.push("no characters")
	else {
		const n = bounds(cast)
		parts.push(n ? `characters ${n}` : "characters")
	}
	const seat = shape.personas
	if (!seat || seat.max === 0) parts.push("no character you play")
	else if (seat.max === 1) parts.push("a character you play")
	else {
		const n = bounds(seat)
		parts.push(n ? `${n} characters you play` : "characters you play")
	}
	if (shape.lorebook) parts.push("lorebook optional")
	if (shape.composer === "none") parts.push("you don't type messages")
	if (shape.voice === "narrator") parts.push("a narrator tells the story")
	return parts.join(" · ")
}

/**
 * The name a session takes when the person starting it types none: the cast
 * for one character, everyone in the room for a group.
 */
export function autoSessionName(
	characterNames: string[],
	personaNames: string[]
): string {
	const cast = characterNames.filter(Boolean)
	if (cast.length === 0) return "New session"
	if (cast.length === 1) return `Session with ${cast[0]}`
	const everyone = [...cast, ...personaNames.filter(Boolean)]
	const last = everyone.pop()!
	return `${everyone.join(", ")} and ${last}`
}

/**
 * The name the session is created with: what the person typed, trimmed, or —
 * left blank — the automatic name (`autoSessionName`).
 */
export function finalSessionName(typed: string, automatic: string): string {
	return typed.trim() || automatic
}

/** The fields `playAsOptions` reads off a `characters:list` row. */
export interface PlayAsCandidate {
	id: number
	name?: string | null
	isPersona?: boolean | null
	isDefaultPersona?: boolean | null
}

/**
 * Who the person can play as: every character they have, not only the flagged
 * personas. A persona is a character carrying `isPersona`, and the seat takes
 * any of them — the server flags an unflagged one the moment it is seated
 * (`markCharacterAsPersona`), so a library with no personas yet can still
 * start a session.
 *
 * Personas lead — the default persona first — then everyone else, each group
 * by name. A character already in the cast is left out: nobody plays a
 * character the session also voices.
 */
export function playAsOptions<T extends PlayAsCandidate>(
	characters: T[],
	castIds: number[]
): T[] {
	const cast = new Set(castIds)
	const rank = (c: T) =>
		c.isDefaultPersona ? 0 : c.isPersona ? 1 : 2
	return characters
		.filter((c) => !cast.has(c.id))
		.sort(
			(a, b) =>
				rank(a) - rank(b) || (a.name || "").localeCompare(b.name || "")
		)
}

/**
 * Who the cast picker offers: every character except the one the person plays
 * as — the other half of `playAsOptions`' rule (note 33, 2026-10-02). Nobody
 * is both voiced by the session and played by the person, so each picker
 * hides what the other holds. Order is the list's own.
 */
export function castOptions<T extends { id: number }>(
	characters: T[],
	personaIds: number[]
): T[] {
	const seat = new Set(personaIds)
	return characters.filter((c) => !seat.has(c.id))
}

/**
 * The cast with several picks added at its end, in the order they were picked
 * — the cast's order is its turn order (`characterPositions`). Anyone already
 * in it is skipped, and the cast stops at the genre's cap.
 */
export function addToCast(
	cast: number[],
	picks: number[],
	max: number = Infinity
): number[] {
	const next = [...cast]
	for (const id of picks) {
		if (next.length >= max) break
		if (!next.includes(id)) next.push(id)
	}
	return next
}

/**
 * The cast with one member moved a place earlier (`-1`) or later (`1`). The
 * first cannot go up nor the last down; an id not in the cast changes nothing.
 */
export function moveInCast(cast: number[], id: number, by: -1 | 1): number[] {
	const from = cast.indexOf(id)
	const to = from + by
	if (from < 0 || to < 0 || to >= cast.length) return cast
	const next = [...cast]
	next[from] = next[to]
	next[to] = id
	return next
}

/** A picker row's searchable shape — the `characters:list` columns it reads. */
export interface PickFilterCandidate {
	name?: string | null
	nickname?: string | null
	characterTags?: Array<{ tag?: { name?: string | null } | null }> | null
}

/**
 * The filter both session-form pickers share: a case-insensitive match on the
 * name, the nickname or any tag name. Blank keeps everyone.
 */
export function filterPickRows<T extends PickFilterCandidate>(
	rows: T[],
	query: string
): T[] {
	const q = query.trim().toLowerCase()
	if (!q) return rows
	return rows.filter(
		(r) =>
			(r.name || "").toLowerCase().includes(q) ||
			(r.nickname || "").toLowerCase().includes(q) ||
			(r.characterTags ?? []).some((ct) =>
				(ct?.tag?.name || "").toLowerCase().includes(q)
			)
	)
}

/** What a genre's shape allows, applied to what the flow currently holds. */
export interface ReconcilableSelection {
	genreFields: Record<string, unknown>
	characterIds: number[]
	personaIds: number[]
	lorebookId: number | null
}

/**
 * Re-fit a held selection to a genre's shape: field values filtered to the
 * declared keys, participants trimmed to the shape's bounds, the lorebook
 * detached when the capability is absent — so a create can never carry another
 * genre's leftovers. The server filters and validates again; this keeps what
 * is *sent* honest, so a refusal never fires from stale form state.
 *
 * An unknown shape is returned untouched: a build that does not register the
 * genre has nothing to trim against.
 */
export function reconcileToShape(
	shape: GenreShape | null | undefined,
	held: ReconcilableSelection
): ReconcilableSelection {
	if (!shape) return held
	const declared = shape.fields ?? {}
	const charMax = shape.characters ? (shape.characters.max ?? Infinity) : 0
	const personaMax = shape.personas ? (shape.personas.max ?? Infinity) : 0
	return {
		genreFields: Object.fromEntries(
			Object.entries(held.genreFields).filter(([k]) => k in declared)
		),
		characterIds: held.characterIds.slice(0, charMax),
		personaIds: held.personaIds.slice(0, personaMax),
		lorebookId: shape.lorebook ? held.lorebookId : null
	}
}

/** Everything `sessions:create` needs, as a start screen holds it. */
export interface CreateSessionInput {
	name: string
	genreId: string
	presetId: number | null
	characterIds: number[]
	personaIds: number[]
	scenario?: string
	tags?: string[]
	genreFields?: Record<string, unknown>
	/** Swaps to seat the session with (R40); absent or empty inherits every pin. */
	swaps?: StoredSwapContribution[]
	lorebookId?: number | null
	/**
	 * 🚧 A starter lorebook to start from (PLAN-lorebook-kinds ruling 8): copied
	 * into the session's own notes, its Rules the session's. Never with
	 * `lorebookId` — the kit wins and no book is sent.
	 */
	starterKit?: Sockets.StarterKits.Ref | null
	/** 🚧 Rules (PLAN-rulesets §4): absent or null, the server's default (W4-A). */
	primaryRuleset?: string | null
	/** 🚧 How strict (§21): absent or null, the genre's default. */
	rigour?: string | null
}

/** The name of the Guide session the setup wizard starts. */
export const WELCOME_SESSION_NAME = "Welcome to Serene Pub"

/**
 * The setup wizard's first session: a Guide session with Serene, named
 * {@link WELCOME_SESSION_NAME}. No characters, no scenario and no lorebook —
 * Serene answers from the docs — and the person's default persona when they
 * have one (the genre takes at most one, and none is fine).
 */
export function welcomeSessionInput(
	pick: { genreId: string; presetId: number },
	personaId: number | null
): CreateSessionInput {
	return {
		name: WELCOME_SESSION_NAME,
		genreId: pick.genreId,
		presetId: pick.presetId,
		characterIds: [],
		personaIds: personaId != null ? [personaId] : [],
		scenario: "",
		lorebookId: null
	}
}

/**
 * The one `sessions:create` body. Every caller that starts a session builds it
 * here.
 *
 * `characterPositions` is derived from the order of `characterIds`, which is
 * the round-robin turn order in a group session. `isGroup` and `userId` are
 * the server's — it computes both and ignores a client that supplies them.
 */
export function buildCreatePayload(
	input: CreateSessionInput
): Sockets.Sessions.Create.Params {
	const characterIds = [...input.characterIds]
	return {
		session: {
			name: input.name.trim(),
			scenario: (input.scenario ?? "").trim(),
			...(input.swaps?.length ? { swaps: input.swaps } : {}),
			lorebookId: input.starterKit ? null : (input.lorebookId ?? null),
			genreId: input.genreId,
			// The preset picks the genre server-side: a `genreId` above that
			// disagrees with it loses, and a null here is the preset-less
			// create the handler still tolerates for programmatic callers.
			presetId: input.presetId,
			genreFields: input.genreFields ?? {},
			...(input.primaryRuleset ? { primaryRuleset: input.primaryRuleset } : {}),
			...(input.rigour ? { rigour: input.rigour } : {})
		} as Sockets.Sessions.Create.Params["session"],
		characterIds,
		personaIds: [...input.personaIds],
		characterPositions: Object.fromEntries(
			characterIds.map((id, i) => [id, i])
		),
		tags: input.tags ?? [],
		...(input.starterKit ? { starterKit: input.starterKit } : {})
	}
}

/**
 * The preset's creation pre-fill, applied to what the flow holds.
 *
 * Fills only what is still pristine — the blank value, or the value the last
 * applied preset left there — so switching presets never discards
 * something the person starting the session has typed. The decision itself is
 * `resolvePresetFill`; this is the pair of it the flow calls.
 */
export function applyPresetFill(
	fields: PresetFillableFields,
	fillState: PresetFillState,
	preset: PresetRow | undefined | null
): { fields: PresetFillableFields; fillState: PresetFillState } {
	return resolvePresetFill(fields, fillState, preset?.defaults)
}

/**
 * The reactive half: the two lists, the two answers, and the pre-fill they
 * drive. A component owns the requests and the effects; this owns the state
 * and the rules, so the same flow can back the start screen and the wizard.
 *
 * Deliberately effect-free — an effect needs an initialisation scope, and this
 * is constructed by whoever wants it. The one rule that has to run on a change,
 * the single-preset auto-pick, is `syncPresetChoice()`, which a caller runs
 * inside its own effect.
 */
export class StartSessionFlow {
	/** Every registered genre, newest version of each kept by `genres`. */
	rawGenres = $state<GenreRow[]>([])
	/** Every preset this user may see; `presetsForGenre` cuts it. */
	rawPresets = $state<PresetRow[]>([])
	/**
	 * Separates "this genre has no presets" from "the list has not landed".
	 * Only the first refuses to start.
	 */
	presetsLoaded = $state(false)

	/** The chosen genre, or null while the answer is still open. */
	genreId = $state<string | null>(null)
	/** The chosen preset, or null while none is selected. */
	presetId = $state<number | null>(null)

	/** The fields a preset's creation defaults can fill. */
	fields = $state<PresetFillableFields>({
		...INITIAL_PRESET_FILLABLE_FIELDS
	})
	/** What the applied preset last put in each field. */
	fillState: PresetFillState = {}
	/** The preset the current pre-fill came from, so a re-run never re-fills. */
	private appliedPresetId: number | null = null

	characterIds = $state<number[]>([])
	personaIds = $state<number[]>([])

	/** 🚧 The person's Rules pick; null takes the genre's default. */
	rulesPick = $state<string | null>(null)
	/** 🚧 The person's How strict pick; null takes the genre's default. */
	rigourPick = $state<string | null>(null)
	/**
	 * 🚧 The chosen lorebook's rules (its `primaryRuleset`): a session
	 * attached to a book at creation adopts them, whatever is sent — unless
	 * they are Freeform, every book's default, which brings none
	 * (`adoptedRules`). Null with no book. Said by the component that holds
	 * the lorebook list.
	 */
	lorebookRules = $state<string | null>(null)
	/**
	 * 🚧 The starter lorebook chosen on the Lorebook card instead of a book
	 * (PLAN-lorebook-kinds ruling 8). Its rules ride `lorebookRules` (the
	 * session adopts them the same way); the card says where they come from.
	 */
	starterKit = $state<Sockets.StarterKits.Ref | null>(null)

	genres = $derived(latestGenres(this.rawGenres))
	genre = $derived(
		this.genres.find((g) => g.genreId === this.genreId) ?? null
	)
	shape = $derived(this.genre?.shape ?? null)
	/** 🚧 The genre's Rules / How strict offer; null when it offers no choice (Chat). */
	rulesOffer = $derived(this.genre?.rules ?? null)
	/**
	 * 🚧 How strict as it stands: the person's pick among the options the
	 * chosen rules play, else the genre's default — and with rules that roll
	 * no dice (Story), Words only (`rigourFor`, 2026-10-18).
	 */
	/**
	 * The How strict a preset pins (Story's Rule Based pins Rules and dice,
	 * 2026-10-19), the default under the person's own pick. A preset stores
	 * it as a setting decision (`setting('scripts', { lock: true })` →
	 * `{ value, lock }`), read out with the SDK's `settingValueOf` — read as
	 * a bare string it was never found (fix7, 2026-10-23), so *The rules
	 * decide* started on Freeform and played in words.
	 */
	presetRigour = $derived.by(() => {
		const raw = (this.preset?.settings as Record<string, unknown> | null | undefined)?.rigour
		const r = raw === undefined ? undefined : settingValueOf(raw).value
		return typeof r === "string" ? r : null
	})
	/**
	 * The rules the form starts on: the genre's default — unless the preset
	 * pins a How strict that ruleset cannot play (Rule Based over Freeform),
	 * when the first choice that plays it, recommended first.
	 */
	rulesDefault = $derived.by(() => {
		const offer = this.rulesOffer
		if (!offer) return null
		const want = this.presetRigour
		const plays = (id: string) => howStrictChoices(offer, id).some((o) => o.id === want)
		if (!want || plays(offer.defaultId)) return offer.defaultId
		return offer.choices.find((c) => c.fit?.rating !== "incompatible" && plays(c.id))?.id ?? offer.defaultId
	})
	/** The rules as they stand: the person's pick, else `rulesDefault`. */
	rulesNowId = $derived(
		this.rulesOffer && this.rulesPick && this.rulesOffer.choices.some((c) => c.id === this.rulesPick)
			? this.rulesPick
			: this.rulesDefault
	)
	/**
	 * 🚧 The rules the chosen book (or starter lorebook) gives the session:
	 * its own, or null for none or a book on Freeform (`adoptedBookRules`),
	 * when the Rules stay the person's to choose (fix7).
	 */
	adoptedRules = $derived(adoptedBookRules(this.lorebookRules))
	/**
	 * 🚧 The Rules field as the form shows it (`rulesField`): the chosen
	 * lorebook's own rules, else the person's pick, else the default.
	 */
	rulesShown = $derived(
		this.rulesOffer
			? rulesField(
					this.rulesOffer,
					this.rulesNowId,
					this.lorebookRules ? { primaryRuleset: this.lorebookRules } : null
				)
			: null
	)
	/** How strict follows the rules shown — a lorebook's when it brings its own. */
	rigour = $derived(
		this.rulesOffer
			? rigourFor(
					this.rulesOffer,
					this.rulesShown?.value ?? this.rulesNowId,
					this.rigourPick ?? this.presetRigour
				)
			: null
	)
	presetsForGenre = $derived(enabledPresetsFor(this.rawPresets, this.genreId))
	preset = $derived(
		this.presetsForGenre.find((p) => p.id === this.presetId) ?? null
	)
	/**
	 * 🚧 **What the start form asks under the chosen preset** (R32, A10;
	 * lane 7): the server's `PresetRow.asks` — settings open to the owner
	 * the preset or the genre's defaults mark `askAtStart`, and those fixed
	 * at start. Left alone, an ask is the value it shows; only an answer the
	 * person moved is sent.
	 */
	asks = $derived(this.preset?.asks ?? [])
	/** The genre fields among them; the rules (ruleset, How strict) keep their own card. */
	genreAsks = $derived(this.asks.filter((a) => !a.rules))
	/** The rules the session plays are fixed once it starts (R32). */
	rulesFixed = $derived(this.asks.some((a) => a.rules && a.key === "ruleset" && a.fixed === true))
	/**
	 * A preset that locks How strict (Rule Based) asks nothing about it: the
	 * server takes the locked value whatever is sent, so the form offers no
	 * choice. Read only where the preset states its asks.
	 */
	rigourLocked = $derived(
		!!this.rulesOffer &&
			this.preset?.asks !== undefined &&
			!this.asks.some((a) => a.rules && a.key === "rigour")
	)
	/** Nothing an administrator has enabled to start this genre with. */
	noPresetsForGenre = $derived(
		!!this.genreId &&
			this.presetsLoaded &&
			this.presetsForGenre.length === 0
	)
	floors = $derived(participantFloors(this.shape, this.genreId))

	/**
	 * Why Start is not offered yet, as one sentence, or null when it is: a
	 * genre and a preset, and a cast that meets the floors
	 * (`firstUnmetStartRule`). Never a lorebook: a session may always start
	 * without one (RF fix 2, 2026-10-23).
	 */
	startBlocker = $derived(
		firstUnmetStartRule({
			genreId: this.genreId,
			noPresetsForGenre: this.noPresetsForGenre,
			characterCount: this.characterIds.length,
			personaCount: this.personaIds.length,
			floors: this.floors
		})
	)
	/** True once nothing stands in Start's way (`startBlocker` is null). */
	canStart = $derived(this.startBlocker === null)

	chooseGenre(id: string) {
		if (this.genreId === id) return
		this.genreId = id
		// Rules and How strict are the genre's to offer: a new genre starts
		// from its own defaults.
		this.rulesPick = null
		this.rigourPick = null
		this.askAnswers = {}
		// A preset belongs to one genre, so the answer below it reopens.
		this.presetId = null
		this.appliedPresetId = null
		this.reconcile()
	}

	choosePreset(id: number | null) {
		if (this.presetId !== id) this.askAnswers = {}
		this.presetId = id
		if (id === null) {
			this.appliedPresetId = null
			return
		}
		if (this.appliedPresetId === id) return
		this.appliedPresetId = id
		const result = applyPresetFill(
			this.fields,
			this.fillState,
			this.rawPresets.find((p) => p.id === id)
		)
		this.fillState = result.fillState
		this.fields = result.fields
		this.reconcile()
	}

	/**
	 * 🚧 The person's answers to the preset's asks, by key — held apart from
	 * the creation pre-fill, so an ask left alone shows (and keeps) what the
	 * preset's settings say rather than an older pre-fill's value.
	 */
	askAnswers = $state<Record<string, unknown>>({})

	/** Answer one start-form ask (a genre field), held until Start. */
	setAsk(key: string, value: unknown) {
		this.askAnswers = { ...this.askAnswers, [key]: value }
	}

	/**
	 * The genre fields Start sends: the pre-fill, with each ask the person
	 * answered — and each ask they left alone taken OUT, so the session
	 * inherits the preset's value through the cascade instead of storing a
	 * pre-fill over it (R32, A10).
	 */
	sentGenreFields(): Record<string, unknown> {
		const out: Record<string, unknown> = { ...this.fields.genreFields }
		for (const ask of this.genreAsks) {
			if (ask.key in this.askAnswers) out[ask.key] = this.askAnswers[ask.key]
			else delete out[ask.key]
		}
		return out
	}

	/**
	 * Step 2's answer where there is only one. A single enabled preset is taken
	 * silently; several open the chooser with the genre's default selected, so
	 * the fields below start pre-filled from something.
	 */
	syncPresetChoice() {
		const rows = this.presetsForGenre
		if (!rows.length) {
			if (this.presetId !== null) this.choosePreset(null)
			return
		}
		if (rows.some((p) => p.id === this.presetId)) return
		this.choosePreset((rows.find((p) => p.isDefault) ?? rows[0]).id)
	}

	/**
	 * Add or take away a cast member, up to the genre's cap. A character the
	 * person was playing leaves the player seat as it joins the cast.
	 */
	toggleCharacter(id: number) {
		if (this.characterIds.includes(id)) {
			this.characterIds = this.characterIds.filter((c) => c !== id)
			return
		}
		const max = this.shape?.characters?.max ?? Infinity
		if (this.characterIds.length >= max) return
		this.characterIds = [...this.characterIds, id]
		if (this.personaIds.includes(id))
			this.personaIds = this.personaIds.filter((p) => p !== id)
	}

	/**
	 * Add several to the cast at once, in the order picked, up to the genre's
	 * cap. As with `toggleCharacter`, a character the person was playing
	 * leaves the player seat as it joins the cast.
	 */
	addCharacters(ids: number[]) {
		const max = this.shape?.characters?.max ?? Infinity
		this.characterIds = addToCast(this.characterIds, ids, max)
		const cast = new Set(this.characterIds)
		if (this.personaIds.some((p) => cast.has(p)))
			this.personaIds = this.personaIds.filter((p) => !cast.has(p))
	}

	/** Move a cast member one place earlier (`-1`) or later (`1`). */
	moveCharacter(id: number, by: -1 | 1) {
		this.characterIds = moveInCast(this.characterIds, id, by)
	}

	/** Seat the person as this character — any character, flagged or not. */
	playAs(id: number) {
		this.personaIds = [id]
		// The picker hides the cast, but a prefill or a stale row must not
		// leave the same character on both sides.
		if (this.characterIds.includes(id))
			this.characterIds = this.characterIds.filter((c) => c !== id)
	}

	/** Re-fit held fields, cast and lorebook to the chosen genre's shape. */
	reconcile() {
		const next = reconcileToShape(this.shape, {
			genreFields: this.fields.genreFields,
			characterIds: this.characterIds,
			personaIds: this.personaIds,
			lorebookId: this.fields.lorebookId
		})
		this.fields = {
			...this.fields,
			genreFields: next.genreFields,
			lorebookId: next.lorebookId
		}
		this.characterIds = next.characterIds
		this.personaIds = next.personaIds
		// A genre with no lorebook step has no place for a kit either.
		if (!this.shape?.lorebook && this.shape) this.starterKit = null
	}

	/** The `sessions:create` body for what the flow currently holds. */
	payload(name: string): Sockets.Sessions.Create.Params {
		return buildCreatePayload({
			name,
			genreId: this.genreId ?? STANDARD_GENRE_ID,
			presetId: this.presetId,
			characterIds: this.characterIds,
			personaIds: this.personaIds,
			scenario: this.fields.scenario,
			tags: this.fields.tags,
			genreFields: this.sentGenreFields(),
			swaps: this.fields.swaps,
			lorebookId: this.fields.lorebookId,
			starterKit: this.starterKit,
			// A lorebook's (or a kit's) own rules are adopted server-side
			// whatever is sent; a book on Freeform brings none, so the
			// pick travels (fix7).
			primaryRuleset: this.rulesOffer && !this.adoptedRules ? this.rulesNowId : null,
			rigour: this.rigour
		})
	}
}
