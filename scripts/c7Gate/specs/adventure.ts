/**
 * The side widgets' fixture (PLAN-r21-core-widgets §4): one Adventure session
 * the four side-widget specs share, built once per run through the app's own
 * socket, the way a person's page would.
 *
 *   - a cast of two characters and a persona, each with a face; Rook carries
 *     two sprite sets ("casual", the default, and "armor"), each with a
 *     `neutral` sprite of its own colour, so which set is in force shows in
 *     which image is drawn; Wren carries none;
 *   - a lorebook of seven entries (more than one page at the fixture's page
 *     size of 5), the one Adventure requires;
 *   - world and cast values set through `state:set`;
 *   - the Lore entries widget seated (core offers it off) and paged at 5;
 *   - one fake turn whose line names two entries' keys, so the rankings hold
 *     something for this session (`takeTheTurn`, sent from a page already
 *     open on the session).
 *
 * Everything a golden holds is the same shape every run: names, keys, values
 * and the turn's line are fixed; database numbers and media uuids are the
 * run's own and are normalised by the specs.
 */
import type { Page } from "playwright"
import { REPLY, URL_BASE, ask, booted, open } from "../engine"

export const ADVENTURE_NAME = "C7 gate fixture adventure"
export const ADVENTURE_GENRE = "core:genre/adventure"
/** The Lore entries page size the fixture pins: seven entries make two pages. */
export const LORE_PAGE_SIZE = 5
/** The fixture's line: it names two entries' keys ("lantern", "mill"). */
export const TURN_LINE = "We cross the lantern bridge toward the old mill."

export const CAST = {
	rook: { name: "C7 gate Rook", color: "#b45309", isPersona: false },
	wren: { name: "C7 gate Wren", color: "#1d4ed8", isPersona: false },
	ash: { name: "C7 gate Ash", color: "#15803d", isPersona: true }
} as const
/** Rook's sprite sets, the default first, each with one `neutral` sprite in its own colour. */
export const ROOK_SETS = [
	{ name: "casual", color: "#f59e0b" },
	{ name: "armor", color: "#475569" }
] as const

export const ENTRIES = [
	{ name: "Lantern Bridge", keys: "lantern, bridge", content: "A stone bridge hung with lanterns that never go out." },
	{ name: "Old Mill", keys: "mill, millstone", content: "The mill upriver, silent since the flood." },
	{ name: "Ferryman", keys: "ferry, ferryman", content: "He takes coin for the crossing and asks no names." },
	{ name: "Fog Market", keys: "market, fog", content: "Stalls that open only when the fog comes in." },
	{ name: "Salt Road", keys: "salt, road", content: "The old trade road to the coast." },
	{ name: "Bell Tower", keys: "bell, tower", content: "Its bell rings the hours no one keeps." },
	{ name: "Willow Ford", keys: "willow, ford", content: "A shallow crossing under the willows." }
] as const

/** The values the fixture sets, as `state:set` takes them (slot ids read back from `state:get`). */
export const WORLD_VALUES = { location: "The Lantern Bridge", weather: "fog" } as const
export const ROOK_VALUES = { hp: 14, mood: "wary" } as const

/**
 * The session's stored layout: Lore entries docked down the left, as the
 * layout editor stores a side a person arranged. Adventure's own right column
 * is restated, since a stored zone layout and arrangement replace the
 * genre's whole.
 */
export const FIXTURE_LAYOUT = {
	active: [{ id: "lore-entries", on: true }],
	zoneLayout: {
		version: 1,
		zones: {
			left: { kind: "side", side: "left", pinned: true, widgets: ["lore-entries"] },
			right: { kind: "side", side: "right", pinned: true, widgets: ["scene-portraits", "stats"] }
		}
	},
	arrangedGrid: {
		left: { cols: 1, rows: 12, items: [{ id: "lore-entries", x: 0, y: 0, w: 1, h: 12 }] },
		right: {
			cols: 1,
			rows: 12,
			items: [
				{ id: "scene-portraits", x: 0, y: 0, w: 1, h: 6 },
				{ id: "stats", x: 0, y: 6, w: 1, h: 6 }
			]
		}
	}
}
/** The per-widget settings the fixture stores: Lore entries paged at five; the portraits as Adventure ships them. */
export const FIXTURE_WIDGET_SETTINGS = {
	"lore-entries": { pageSize: LORE_PAGE_SIZE },
	"scene-portraits": { source: "scene", bars: true }
} as const

/** Store the session's layout and widget settings (`sessions:panelLayout:set`). */
export async function storeLayout(page: Page, sessionId: number, widgetSettings: Record<string, unknown> = FIXTURE_WIDGET_SETTINGS) {
	const laid = await ask(page, "sessions:panelLayout:set", { sessionId, layout: FIXTURE_LAYOUT, widgetSettings }, { where: { sessionId }, refusable: true })
	if (!laid?.ok) throw new Error(`the fixture's layout was refused: ${JSON.stringify(laid)}`)
}

export type AdventureFixture = {
	sessionId: number
	lorebookId: number
	url: string
	cast: Record<keyof typeof CAST, number>
	/** Every entry's id by name. */
	entries: Map<string, number>
	/** Rook's sprite media uuids by set name (lower case). */
	rookSprites: Map<string, string>
	/** Each cast card's avatar media uuid (lower case). */
	faces: Map<number, string>
	/** Each cast card's avatar thumbnail, as the Scene images tab pins it (`/media/<uuid>?v=thumb&r=<rev>`). */
	thumbs: Map<number, string>
	/** The session's slots: `core:slot/<name>@1` by short name (`hp`, `location`). */
	slots: Map<string, string>
}

let built: Promise<AdventureFixture> | null = null
/** The fixture, built by the first spec that asks and shared by the rest. */
export const adventureFixture = (page: Page) => (built ??= build(page).catch((e) => ((built = null), Promise.reject(e))))

type Sets = Array<{ id: number; name: string; isDefault: boolean; sprites: Array<{ label: string; media: { uuid: string } | null }> }>

async function build(page: Page): Promise<AdventureFixture> {
	await open(page, URL_BASE)
	await booted(page)
	const list: Array<{ id: number; name: string; isPersona: boolean; avatarMediaId?: number | null; avatarMedia?: { uuid?: string } | null }> =
		(await ask(page, "characters:list", {}))?.characterList ?? []
	const cast = {} as Record<keyof typeof CAST, number>
	for (const [key, c] of Object.entries(CAST) as Array<[keyof typeof CAST, (typeof CAST)[keyof typeof CAST]]>) {
		const had = list.find((x) => x.name === c.name && !!x.isPersona === c.isPersona && x.avatarMediaId != null)?.id
		cast[key] =
			had ??
			(
				await ask(
					page,
					"characters:create",
					{ character: { name: c.name, description: "The C7 gate's adventure fixture.", isPersona: c.isPersona } },
					{ avatar: { color: c.color, letter: c.name.split(" ").at(-1)![0]! } }
				)
			)?.character?.id
		if (!cast[key]) throw new Error(`the fixture's ${c.name} was refused`)
	}
	const faces = new Map<number, string>()
	const thumbs = new Map<number, string>()
	for (const c of ((await ask(page, "characters:list", {}))?.characterList ?? []) as Array<{ id: number; avatarMedia?: { uuid?: string; rev?: number } | null }>)
		if (Object.values(cast).includes(c.id) && c.avatarMedia?.uuid) {
			faces.set(c.id, c.avatarMedia.uuid.toLowerCase())
			thumbs.set(c.id, `/media/${c.avatarMedia.uuid}?v=thumb&r=${c.avatarMedia.rev ?? 0}`)
		}

	// Rook's two sets, each with its own neutral sprite (made once, kept across runs).
	const rook = cast.rook
	let sets: Sets = (await ask(page, "characters:listSprites", { characterId: rook }, { scope: rook }))?.sets ?? []
	for (const s of ROOK_SETS) {
		if (!sets.some((x) => x.name === s.name))
			sets = (await ask(page, "characters:createSpriteSet", { characterId: rook, name: s.name }, { scope: rook, refusable: true }))?.sets ?? []
		const set = sets.find((x) => x.name === s.name)
		if (!set) throw new Error(`Rook's sprite set "${s.name}" was not made`)
		if (!set.sprites.some((p) => p.label === "neutral" && p.media))
			sets =
				(
					await ask(
						page,
						"characters:uploadSprite",
						{ characterId: rook, setId: set.id, label: "neutral", filename: `${s.name}.png` },
						{ scope: rook, refusable: true, file: { field: "imageFile", color: s.color, letter: s.name[0]!.toUpperCase() } }
					)
				)?.sets ?? []
	}
	const rookSprites = new Map<string, string>()
	for (const s of sets) {
		const uuid = s.sprites.find((p) => p.label === "neutral")?.media?.uuid
		if (uuid) rookSprites.set(s.name, uuid.toLowerCase())
	}
	if (rookSprites.size !== ROOK_SETS.length) throw new Error(`Rook's sprites read back as ${JSON.stringify([...rookSprites])}`)
	if (!sets.find((s) => s.isDefault && s.name === ROOK_SETS[0].name))
		throw new Error(`Rook's default sprite set is ${sets.find((s) => s.isDefault)?.name ?? "none"}, not ${ROOK_SETS[0].name}`)

	// A lorebook of its own every run: the rankings the widget reads are this session's.
	const stamp = new Date().toISOString()
	const book = (await ask(page, "lorebooks:create", { name: `${ADVENTURE_NAME} ${stamp}` }, { refusable: true }))?.lorebook
	if (!book?.id) throw new Error("the fixture's lorebook was refused")
	const entries = new Map<string, number>()
	for (const e of ENTRIES) {
		const made = await ask(
			page,
			"entries:create",
			{ entry: { typeId: "core:entry/world-lore", lorebookId: book.id, name: e.name, keys: e.keys, content: e.content } },
			{ scope: book.id, refusable: true }
		)
		if (!made?.entry?.id) throw new Error(`the entry "${e.name}" was refused: ${JSON.stringify(made)}`)
		entries.set(e.name, made.entry.id)
	}

	const created = await ask(
		page,
		"sessions:create",
		{
			session: { name: `${ADVENTURE_NAME} ${stamp}`, genreId: ADVENTURE_GENRE, lorebookId: book.id },
			characterIds: [cast.rook, cast.wren],
			personaIds: [cast.ash],
			characterPositions: { [cast.rook]: 0, [cast.wren]: 1 }
		},
		{ refusable: true }
	)
	const sessionId = created?.session?.id as number | undefined
	if (!sessionId) throw new Error(`the Adventure session was refused: ${JSON.stringify(created)}`)

	// Lore entries seated and paged at five (`FIXTURE_LAYOUT`).
	await storeLayout(page, sessionId)

	// Values: the world's and Rook's.
	const got = await ask(page, "state:get", { sessionId }, { where: { sessionId } })
	const slots = new Map<string, string>()
	for (const s of (got?.slots ?? []) as Array<{ slotId: string }>) {
		const short = /^core:slot\/([\w-]+)@\d+$/.exec(s.slotId)?.[1]
		if (short) slots.set(short, s.slotId)
	}
	const set = async (owner: { kind: string; id: number }, short: string, value: unknown) => {
		const slotId = slots.get(short)
		if (!slotId) throw new Error(`the Adventure session tracks no ${short} slot (it tracks ${[...slots.keys()].join(", ")})`)
		await ask(page, "state:set", { sessionId, owner, slotId, value }, { where: { sessionId }, refusable: true })
	}
	for (const [k, v] of Object.entries(WORLD_VALUES)) await set({ kind: "session", id: sessionId }, k, v)
	for (const [k, v] of Object.entries(ROOK_VALUES)) await set({ kind: "session_cast", id: cast.rook }, k, v)

	const fixture: AdventureFixture = { sessionId, lorebookId: book.id, url: `${URL_BASE}/sessions/${sessionId}`, cast, entries, rookSprites, faces, thumbs, slots }
	return fixture
}

let turned: AdventureFixture | null = null
/**
 * The fixture's one fake turn: its line, answered by the gate's model, sent
 * from the session's own page — whatever else that page shows is watching
 * (the Lore entries spec sends it with its widget open, to see `lore:ranked`
 * arrive). Once per run.
 */
export async function takeTheTurn(page: Page, f: AdventureFixture) {
	if (turned === f) return
	const field = page.locator('[data-widget-part~="messages.root"] textarea').last()
	await field.waitFor({ timeout: 60_000 })
	await page.waitForTimeout(1500)
	await field.fill(TURN_LINE)
	await field.press("Enter")
	await page.waitForFunction(
		({ line, reply }) => {
			const rows = [...document.querySelectorAll('[data-widget-part~="messages.message"]')]
			const at = rows.findIndex((r) => r.querySelector("sp-message-body")?.getAttribute("text")?.trim() === line)
			const row = at >= 0 ? rows[rows.length - 1] : undefined
			const text = row?.querySelector("sp-message-body")?.getAttribute("text")?.trim()
			return at >= 0 && row !== rows[at] && !row!.hasAttribute("data-msg-generating") && !!text && new RegExp(reply).test(text)
		},
		{ line: TURN_LINE, reply: REPLY },
		{ timeout: 90_000 }
	)
	await page.waitForFunction(() => !document.querySelector('[data-widget-part~="messages.root"] [aria-label="Stop generating"]'), null, { timeout: 60_000 })
	turned = f
}

/* ── the values, read and put back ────────────────────────────────────── */

/** An owner as `state:set` names it: the world is the session's, a cast member's is its character id. */
export type StateOwner = { kind: "session" | "session_cast"; id: number }
export const world = (f: AdventureFixture): StateOwner => ({ kind: "session", id: f.sessionId })
export const castOwner = (f: AdventureFixture, who: keyof typeof CAST): StateOwner => ({ kind: "session_cast", id: f.cast[who] })

/** Set one value through the app's socket (`null` clears the session's layer). */
export async function setValue(page: Page, f: AdventureFixture, owner: StateOwner, short: string, value: unknown) {
	const slotId = f.slots.get(short)
	if (!slotId) throw new Error(`the Adventure session tracks no ${short} slot`)
	await ask(page, "state:set", { sessionId: f.sessionId, owner, slotId, value }, { where: { sessionId: f.sessionId }, refusable: true })
}

/** One value as the server resolves it now (`state:get`), by owner and slot short name. */
export async function serverValue(page: Page, f: AdventureFixture, owner: StateOwner, short: string): Promise<unknown> {
	const got = await ask(page, "state:get", { sessionId: f.sessionId }, { where: { sessionId: f.sessionId } })
	const slot = (got?.slots ?? []).find((s: { slotId: string }) => s.slotId === f.slots.get(short))
	if (!slot) throw new Error(`state:get lists no ${short} slot`)
	if (owner.kind === "session") return got.state?.world?.[slot.qualifiedKey]
	const key = (got?.owners ?? []).find((o: { kind: string; id: number }) => o.kind === "session_cast" && o.id === owner.id)?.key
	return key ? got.state?.cast?.[key]?.[slot.qualifiedKey] : undefined
}

/** Every value a flow may change, back as the fixture set it (or cleared to the genre's default). */
export async function resetValues(page: Page, f: AdventureFixture) {
	await open(page, URL_BASE)
	await booted(page)
	for (const short of ["location", "weather", "time-of-day", "inventory"])
		await setValue(page, f, world(f), short, (WORLD_VALUES as Record<string, unknown>)[short] ?? null)
	for (const who of ["rook", "wren", "ash"] as const)
		for (const short of ["hp", "mood", "stamina", "trust", "inventory"])
			await setValue(page, f, castOwner(f, who), short, who === "rook" ? ((ROOK_VALUES as Record<string, unknown>)[short] ?? null) : null)
}
