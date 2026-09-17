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
export const STANDARD_GENRE_ID = "core:genre/chat"

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
 * `isDefault` on the row is the client's view of
 * `session_genre_settings.defaultPresetId` — the flag the admin pages write
 * when a preset becomes a genre's default — so a genre that has one is the
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
	if (!shape || genreId === STANDARD_GENRE_ID || !genreId)
		return { characters: 1, personas: 1 }
	return {
		characters: shape.characters?.min ?? 0,
		personas: shape.personas?.min ?? 0
	}
}

/** One line of shape facts for a genre card — presentation over the same
 * shape the server validates against. */
export function genreFacts(shape: GenreShape | null | undefined): string {
	if (!shape) return ""
	const parts: string[] = []
	const cap = (label: string, b?: { min: number; max?: number }) => {
		if (!b || b.max === 0) return void parts.push(`no ${label}`)
		const bounds =
			b.min > 0
				? b.max != null
					? `${b.min}–${b.max}`
					: `${b.min}+`
				: b.max != null
					? `up to ${b.max}`
					: ""
		parts.push(bounds ? `${label} ${bounds}` : label)
	}
	cap("characters", shape.characters)
	cap("personas", shape.personas)
	if (shape.lorebook === "required") parts.push("lorebook required")
	else if (shape.lorebook) parts.push("lorebook optional")
	if (shape.composer === "none") parts.push("no composer")
	if (shape.voice === "narrator") parts.push("narrator voice")
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
	groupReplyStrategy?: string
	lorebookId?: number | null
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
			groupReplyStrategy: input.groupReplyStrategy ?? "ordered",
			lorebookId: input.lorebookId ?? null,
			genreId: input.genreId,
			// The preset picks the genre server-side: a `genreId` above that
			// disagrees with it loses, and a null here is the preset-less
			// create the handler still tolerates for programmatic callers.
			presetId: input.presetId,
			genreFields: input.genreFields ?? {}
		} as Sockets.Sessions.Create.Params["session"],
		characterIds,
		personaIds: [...input.personaIds],
		characterPositions: Object.fromEntries(
			characterIds.map((id, i) => [id, i])
		),
		tags: input.tags ?? []
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

	genres = $derived(latestGenres(this.rawGenres))
	genre = $derived(
		this.genres.find((g) => g.genreId === this.genreId) ?? null
	)
	shape = $derived(this.genre?.shape ?? null)
	presetsForGenre = $derived(enabledPresetsFor(this.rawPresets, this.genreId))
	preset = $derived(
		this.presetsForGenre.find((p) => p.id === this.presetId) ?? null
	)
	/** Nothing an administrator has enabled to start this genre with. */
	noPresetsForGenre = $derived(
		!!this.genreId &&
			this.presetsLoaded &&
			this.presetsForGenre.length === 0
	)
	floors = $derived(participantFloors(this.shape, this.genreId))

	/** True once both answers are settled and the cast meets the floors. */
	canStart = $derived(
		!!this.genreId &&
			!this.noPresetsForGenre &&
			this.characterIds.length >= this.floors.characters &&
			this.personaIds.length >= this.floors.personas
	)

	chooseGenre(id: string) {
		if (this.genreId === id) return
		this.genreId = id
		// A preset belongs to one genre, so the answer below it reopens.
		this.presetId = null
		this.appliedPresetId = null
		this.reconcile()
	}

	choosePreset(id: number | null) {
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
			genreFields: this.fields.genreFields,
			groupReplyStrategy: this.fields.groupReplyStrategy,
			lorebookId: this.fields.lorebookId
		})
	}
}
