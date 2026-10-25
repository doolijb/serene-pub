/**
 * 0126 — **Genre slots retire: attributes are the rules'** (RF fix 8, owner
 * ruling 2026-10-23: "Story still injects cast attributes not the ruleset's
 * — retire them now"; "sessions never add attributes"). No shape change (the
 * anchor migration is drizzle's custom file).
 *
 * Story, the Lair and the Dungeon Crawler carried attribute slots of their
 * own — health, stamina, mood, trust, time of day, weather, inventory,
 * conditions, currency, level, class, abilities, the ⏳ numbers question —
 * and Freeform borrowed mood. None of them is tracked any more unless the
 * session's rules keep it. A value a session still holds on one is carried
 * forward, never lost:
 *
 * | what the session's rules declare | what happens to the session's rows |
 * |---|---|
 * | that very slot (Vis Itineris borrows health, level and class) | nothing: it is theirs now |
 * | an attribute of the same tag or id, of a kind the value fits (`health` → health, `mood` → mood) | moved onto that attribute's slot, history and all |
 * | neither | its newest value written into the session's notes as one line ("Verity: Mood giddy"), under one entry *Carried over from before*; the rows go |
 *
 * The world's place and the crawl's tools are the host's now (`hostState`),
 * so `location` and the crawl's own slots are never touched; ⏳ nor is what
 * someone carries (`inventory`) in a session of any genre but the crawl — the
 * host keeps that list for Story and the Lair, whose reckoning hands the
 * lorebook's items out on it, and a plugin genre's stored slots are its tool
 * state; the crawl retired it on 2026-10-17 for the rules' pieces. Nor is a
 * ruleset's own data parked under a ruleset the session does not play
 * (`itineris-*`). Only the session's own layer moves (`attribute_values.
 * session_id`); a lorebook's or a card's timeline is that book's. What a
 * slot's rows also hung off the session layer — its stat configurations and
 * its carry switches — goes with them.
 *
 * Idempotent: a second run finds no row on a retired slot to carry, and the
 * notes entry is written once per session. Ids are never seeded: the notes
 * book is made only where a session has none, by its own sequence.
 *
 * The 0.5.3 attic needs nothing: a 0.5.3 chat held no stats to map (its
 * sessions arrive as Story sessions with an empty sheet — `attic/etl/
 * sessions.ts`), which `upgrade.*.int.test.ts` hold.
 */
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import type { DataUpgradeContext } from "./index"

/**
 * The retired genre slots, frozen here (an upgrade runs against the data as
 * it stood, never today's catalogue): each with the tag a ruleset's attribute
 * would say it by, its kind of value, and the words a person reads.
 */
export const RETIRED_GENRE_SLOTS: Readonly<
	Record<string, { tag: string; value: "number" | "word" | "list"; label: string; onlyIn?: readonly string[] }>
> = Object.freeze({
	"core:slot/hp@1": { tag: "health", value: "number", label: "Health" },
	"core:slot/stamina@1": { tag: "stamina", value: "number", label: "Stamina" },
	"core:slot/mood@1": { tag: "mood", value: "word", label: "Mood" },
	"core:slot/trust@1": { tag: "trust", value: "number", label: "Trust" },
	"core:slot/time-of-day@1": { tag: "time-of-day", value: "word", label: "Time of day" },
	"core:slot/weather@1": { tag: "weather", value: "word", label: "Weather" },
	// ⏳ Retired only in the crawl's sessions: Story and the Lair keep it as the host's list of what someone carries.
	"core:slot/inventory@1": { tag: "inventory", value: "list", label: "Inventory", onlyIn: Object.freeze(["core:genre/dungeon-crawler"]) },
	"core:slot/conditions@1": { tag: "condition", value: "list", label: "Conditions" },
	"core:slot/currency@1": { tag: "currency", value: "number", label: "Currency" },
	"core:slot/level@1": { tag: "level", value: "number", label: "Level" },
	"core:slot/character-class@1": { tag: "class", value: "word", label: "Class" },
	"core:slot/abilities@1": { tag: "abilities", value: "list", label: "Abilities" },
	"core:slot/stat-mode@1": { tag: "stat-mode", value: "word", label: "Story or dice" }
})

/** The notes entry the lines are filed under. */
export const CARRIED_OVER_TITLE = "Carried over from before"

/** One of the rules' attributes, as the upgrade matches against it. */
interface RuledAttribute {
	id: string
	slot: string
	tags: string[]
	kinds: string[]
	of?: readonly string[]
}

/** What one session's rules declare, by slot — core's from the catalogue, a published one from its row. */
async function attributesOf(tx: MigrationTx, rulesetId: string | null): Promise<RuledAttribute[]> {
	if (!rulesetId) return []
	const sdk = await import("@serene-pub/sdk")
	await import("@serene-pub/core-catalog")
	let decl: unknown = sdk.getRuleset(rulesetId)
	if (!decl) {
		const [row] = rawRows<{ published: unknown }>(
			await tx.execute(sql`SELECT published FROM rulesets WHERE ruleset_id = ${rulesetId} LIMIT 1`)
		)
		decl = row?.published ?? null
	}
	if (!decl || typeof decl !== "object") return []
	const attrs = sdk.rulesetSections(decl).attributes ?? []
	return attrs.map((a) => ({
		id: a.id,
		slot: typeof a.slot === "string" && a.slot ? a.slot : sdk.rulesetAttributeSlotId(rulesetId, a.id),
		tags: [...(a.tags ?? [])],
		kinds: [...(sdk.rulesetAttributeKinds(a) ?? [])],
		...(Array.isArray(a.of) ? { of: a.of } : {})
	}))
}

const NUMBER_KINDS = ["number", "pool", "tally"]

/** Does a value of this sort fit the attribute's kind (and, for a word, its words)? */
function fits(a: RuledAttribute, value: "number" | "word" | "list", held: unknown): boolean {
	if (value === "number") return a.kinds.some((k) => NUMBER_KINDS.includes(k))
	if (value === "list") return a.kinds.includes("list")
	if (!a.kinds.some((k) => k === "label" || k === "text")) return false
	return !a.of?.length || (typeof held === "string" && a.of.includes(held))
}

/** A stored value as a person reads it: a word, a number, a list's items by name. */
function words(v: unknown): string {
	if (v === null || v === undefined) return ""
	if (typeof v === "string") return v.trim()
	if (typeof v === "number" || typeof v === "boolean") return String(v)
	if (Array.isArray(v))
		return v
			.map((i) => {
				if (typeof i === "string") return i
				if (i && typeof i === "object") {
					const o = i as { name?: unknown; entryId?: unknown; count?: unknown }
					const name = typeof o.name === "string" && o.name ? o.name : typeof o.entryId === "number" ? `entry ${o.entryId}` : ""
					return name && typeof o.count === "number" && o.count > 1 ? `${name} ×${o.count}` : name
				}
				return ""
			})
			.filter(Boolean)
			.join(", ")
	return ""
}

export interface GenreSlotsReport {
	sessions: number
	moved: number
	noted: number
	dropped: number
}

/** The upgrade — exported for its test. */
export async function retireGenreSlots(tx: MigrationTx): Promise<GenreSlotsReport> {
	const report: GenreSlotsReport = { sessions: 0, moved: 0, noted: 0, dropped: 0 }
	const slots = Object.keys(RETIRED_GENRE_SLOTS)
	const held = rawRows<{ session_id: number; owner_kind: string; owner_id: number; slot_id: string; genre_id: string | null }>(
		await tx.execute(sql`
			SELECT DISTINCT v.session_id, v.owner_kind, v.owner_id, v.slot_id, s.genre_id
			FROM attribute_values v
			JOIN sessions s ON s.id = v.session_id
			WHERE v.session_id IS NOT NULL AND v.slot_id IN (${sql.join(slots.map((s) => sql`${s}`), sql`, `)})
			ORDER BY v.session_id, v.owner_kind, v.owner_id, v.slot_id
		`)
	).filter((r) => {
		const only = RETIRED_GENRE_SLOTS[r.slot_id]?.onlyIn
		return !only || only.includes(String(r.genre_id))
	})
	const bySession = new Map<number, typeof held>()
	for (const r of held) bySession.set(Number(r.session_id), [...(bySession.get(Number(r.session_id)) ?? []), r])
	for (const [sessionId, rows] of bySession) {
		const [session] = rawRows<{ user_id: number; name: string | null; lorebook_id: number | null; primary_ruleset: string | null; ruleset_version: string | null }>(
			await tx.execute(sql`SELECT user_id, name, lorebook_id, primary_ruleset, ruleset_version FROM sessions WHERE id = ${sessionId} LIMIT 1`)
		)
		if (!session) continue
		const ruled = await attributesOf(tx, session.primary_ruleset)
		const lines: string[] = []
		let touched = false
		for (const r of rows) {
			const said = RETIRED_GENRE_SLOTS[r.slot_id]!
			// The rules keep this very slot: it is theirs now.
			if (ruled.some((a) => a.slot === r.slot_id)) continue
			touched = true
			const [newest] = rawRows<{ value: { v?: unknown } | null }>(
				await tx.execute(sql`
					SELECT value FROM attribute_values
					WHERE session_id = ${sessionId} AND owner_kind = ${r.owner_kind} AND owner_id = ${r.owner_id} AND slot_id = ${r.slot_id}
					ORDER BY id DESC LIMIT 1
				`)
			)
			const value = newest?.value && typeof newest.value === "object" ? newest.value.v : undefined
			const slug = r.slot_id.replace(/^.*:slot\//, "").replace(/@\d+$/, "")
			const target = ruled.find((a) => (a.id === slug || a.id === said.tag || a.tags.includes(said.tag) || a.tags.includes(slug)) && fits(a, said.value, value))
			const owned = sql`session_id = ${sessionId} AND owner_kind = ${r.owner_kind} AND owner_id = ${r.owner_id} AND slot_id = ${r.slot_id}`
			if (target) {
				// Onto the rules' own attribute of the same tag, history and all.
				const moved = rawRows<{ id: number }>(await tx.execute(sql`UPDATE attribute_values SET slot_id = ${target.slot} WHERE ${owned} RETURNING id`))
				report.moved += moved.length
				continue
			}
			const said2 = words(value)
			if (said2) {
				lines.push(`${await ownerName(tx, r.owner_kind, Number(r.owner_id))}: ${said.label} ${said2}`)
				report.noted++
			}
			const dropped = rawRows<{ id: number }>(await tx.execute(sql`DELETE FROM attribute_values WHERE ${owned} RETURNING id`))
			report.dropped += dropped.length
		}
		if (!touched) continue
		report.sessions++
		// What hung off the session layer for those slots goes with them.
		const gone = rows.filter((r) => !ruled.some((a) => a.slot === r.slot_id)).map((r) => r.slot_id)
		if (gone.length) {
			const list = sql.join([...new Set(gone)].map((s) => sql`${s}`), sql`, `)
			await tx.execute(sql`DELETE FROM attribute_carries WHERE session_id = ${sessionId} AND slot_id IN (${list})`)
			await tx.execute(sql`DELETE FROM attribute_configs WHERE session_id = ${sessionId} AND slot_id IN (${list})`)
		}
		if (lines.length) await noteLines(tx, sessionId, session, lines)
	}
	return report
}

/** Who a row belongs to, in words: the world, a character, a seat, a place. */
async function ownerName(tx: MigrationTx, kind: string, id: number): Promise<string> {
	if (kind === "session") return "The world"
	const [row] =
		kind === "session_cast"
			? rawRows<{ name: string | null }>(await tx.execute(sql`SELECT name FROM characters WHERE id = ${id} LIMIT 1`))
			: kind === "player_seat"
				? rawRows<{ name: string | null }>(await tx.execute(sql`SELECT coalesce(seat_name, removed_name) AS name FROM session_personas WHERE id = ${id} LIMIT 1`))
				: kind === "session_location"
					? rawRows<{ name: string | null }>(await tx.execute(sql`SELECT title AS name FROM lorebook_entries WHERE id = ${id} LIMIT 1`))
					: []
	return row?.name?.trim() || (kind === "session_location" ? "A place" : "Someone")
}

/**
 * The lines, into the session's notes (its own lorebook — made where it has
 * none, as the app makes it: the session's name, owner, book and rules), as
 * one world-lore entry *Carried over from before*, its lines appended once.
 */
async function noteLines(
	tx: MigrationTx,
	sessionId: number,
	session: { user_id: number; name: string | null; lorebook_id: number | null; primary_ruleset: string | null; ruleset_version: string | null },
	lines: string[]
): Promise<void> {
	let [notes] = rawRows<{ id: number }>(await tx.execute(sql`SELECT id FROM lorebooks WHERE session_id = ${sessionId} LIMIT 1`))
	if (!notes) {
		;[notes] = rawRows<{ id: number }>(
			await tx.execute(sql`
				INSERT INTO lorebooks (name, user_id, session_id, overlay_of, primary_ruleset, ruleset_version)
				VALUES (${session.name?.trim() || "Untitled session"}, ${session.user_id}, ${sessionId}, ${session.lorebook_id}, ${session.primary_ruleset ?? "core:ruleset/freeform@1"}, ${session.ruleset_version})
				RETURNING id
			`)
		)
	}
	if (!notes) return
	const [entry] = rawRows<{ id: number; content: string }>(
		await tx.execute(sql`SELECT id, content FROM lorebook_entries WHERE lorebook_id = ${notes.id} AND title = ${CARRIED_OVER_TITLE} LIMIT 1`)
	)
	if (entry) {
		const have = new Set(entry.content.split("\n"))
		const fresh = lines.filter((l) => !have.has(l))
		if (fresh.length) await tx.execute(sql`UPDATE lorebook_entries SET content = ${[entry.content, ...fresh].filter(Boolean).join("\n")} WHERE id = ${entry.id}`)
		return
	}
	const [{ next } = { next: 0 }] = rawRows<{ next: number }>(
		await tx.execute(sql`SELECT coalesce(max(position) + 1, 0) AS next FROM lorebook_entries WHERE lorebook_id = ${notes.id}`)
	)
	await tx.execute(sql`
		INSERT INTO lorebook_entries (lorebook_id, type_id, type_version, title, content, position)
		VALUES (${notes.id}, 'core:entry/world-lore', 1, ${CARRIED_OVER_TITLE}, ${lines.join("\n")}, ${Number(next)})
	`)
}

export async function run(tx: MigrationTx, _ctx: DataUpgradeContext): Promise<void> {
	const r = await retireGenreSlots(tx)
	if (r.sessions)
		console.log(
			`[0126] genre slots retired (attributes are the rules'): ${r.sessions} sessions — ${r.moved} rows moved onto the rules' attributes, ${r.noted} values carried into the session's notes, ${r.dropped} rows dropped`
		)
}
