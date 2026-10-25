/**
 * 🚧 **Find-or-update and filing** for `create-lore-entry@1` (pr-6 lane C1):
 * `match` (R-h) finds the entry a create would otherwise duplicate; `bind`
 * files an entry under a cast member. Both read `tx`, never the outer handle.
 */
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { entryDeclaration } from "$lib/server/entries/declarations"
import { answeringRows, keyTerms } from "$lib/shared/lorebooks/describingRow"
import { HostScopeError } from "$lib/server/pipelines/runtime/host"

const fold = (s: string): string => s.trim().toLowerCase()

/**
 * The entry `match` names: null = none (create); an id = update it. Two or
 * more are refused, naming every candidate. Looks within this write's own
 * entry type, on the session's reading, among the entries it sees.
 */
export async function findLoreMatch(
	tx: Db,
	at: { lorebookId: number; typeId: string; reading: unknown },
	match: unknown,
	nodeKey: string
): Promise<number | null> {
	const bad = () =>
		new HostScopeError(`${nodeKey}: match is { entryId }, { name } or { key }.`)
	if (!match || typeof match !== "object" || Array.isArray(match)) throw bad()
	const m = match as Record<string, unknown>
	const { entriesAsRead } = await import("$lib/server/state/entriesOnReading")
	const reading = at.reading as Parameters<typeof entriesAsRead>[2]

	if (typeof m.entryId === "number" && Number.isInteger(m.entryId)) {
		const [row] = await entriesAsRead(tx, at.lorebookId, reading, "session", [at.typeId], [
			m.entryId
		])
		if (!row)
			throw new HostScopeError(
				`${nodeKey}: entry ${m.entryId} is not a '${at.typeId}' entry of this session's lorebook — match finds within this write's own entry type.`
			)
		return row.entryId
	}

	const byName = typeof m.name === "string" && m.name.trim() !== ""
	const byKey = typeof m.key === "string" && m.key.trim() !== ""
	if (byName === byKey) throw bad()
	const needle = (byName ? m.name : m.key) as string

	const all = (
		await entriesAsRead(tx, at.lorebookId, reading, "session", [at.typeId])
	).filter((e) => !e.unseen)
	const hits = byName
		? (answeringRows(needle, all.map((e) => ({ name: e.name, keys: e.keys, id: e.entryId }))) as {
				id: number
				name: string
			}[]).map((r) => ({ id: r.id, name: r.name }))
		: all
				.filter((e) => keyTerms(e.keys).some((k) => fold(k) === fold(needle)))
				.map((e) => ({ id: e.entryId, name: e.name }))
	if (hits.length === 0) return null
	if (hits.length === 1) return hits[0]!.id
	throw new HostScopeError(
		`${nodeKey}: ${hits.length} entries answer to '${needle.trim()}' — ${hits
			.map((h) => `'${h.name}' (entry ${h.id})`)
			.join(", ")}. Name one: match { entryId }.`
	)
}

/** The cast member (`lorebook_bindings.id`) a `bind` of `character:<id>` files an entry under. */
export async function resolveBind(
	tx: Db,
	at: { lorebookId: number; typeId: string },
	bind: unknown,
	nodeKey: string
): Promise<number> {
	if (!entryDeclaration(at.typeId)?.roles.anchor)
		throw new HostScopeError(
			`${nodeKey}: '${at.typeId}' entries are not filed under a cast member — leave bind off.`
		)
	const parsed = typeof bind === "string" ? /^character:([1-9][0-9]*)$/.exec(bind.trim()) : null
	const characterId = parsed ? Number(parsed[1]) : NaN
	if (!Number.isSafeInteger(characterId) || characterId > 2147483647)
		throw new HostScopeError(`${nodeKey}: bind names a character, as character:<id>.`)
	const [member] = await tx
		.select({ id: schema.lorebookBindings.id })
		.from(schema.lorebookBindings)
		.where(
			and(
				eq(schema.lorebookBindings.lorebookId, at.lorebookId),
				eq(schema.lorebookBindings.characterId, characterId)
			)
		)
		.limit(1)
	if (member) return member.id
	const [character] = await tx
		.select({ name: schema.characters.name })
		.from(schema.characters)
		.where(eq(schema.characters.id, characterId))
		.limit(1)
	throw new HostScopeError(
		`${nodeKey}: ${character?.name ?? `character ${characterId}`} is not in this book's cast, so there is nobody to file this under — add them to the cast, or leave bind off.`
	)
}
