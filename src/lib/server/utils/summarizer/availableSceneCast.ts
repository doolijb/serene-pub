/**
 * Builds a temporally-scoped "known cast" list for character extraction.
 *
 * Sources (in merge priority):
 *  1. Chat characters + personas — always in scope
 *  2. Lorebook bindings → characters/personas — always in scope
 *  3. Narrative nodes filtered to ≤ current timeline position (brings aliases from merges)
 *  4. participantCharacters + mentionedCharacters from prior scenes (chronologically earlier)
 *
 * Names are fuzzy-matched and deduplicated so LLM-invented variants collapse onto the
 * canonical name and their aliases are collected in one entry.
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, and } from "drizzle-orm"

export interface CastEntry {
	name: string
	aliases: string[]
}

// ── Fuzzy matching ────────────────────────────────────────────────────────────

function normalize(s: string): string {
	return s
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9 ]/g, "")
		.replace(/\s+/g, " ")
}

function levenshtein(a: string, b: string): number {
	const m = a.length,
		n = b.length
	const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [
		i,
		...Array(n).fill(0)
	])
	for (let j = 0; j <= n; j++) dp[0][j] = j
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] =
				a[i - 1] === b[j - 1]
					? dp[i - 1][j - 1]
					: 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
		}
	}
	return dp[m][n]
}

/** True if a and b refer to the same person. */
function namesMatch(a: string, b: string): boolean {
	const na = normalize(a)
	const nb = normalize(b)
	if (!na || !nb) return false
	if (na === nb) return true

	// Word-subset: "Alice" matches "Alice Vance" and vice-versa
	const wa = na.split(" ")
	const wb = nb.split(" ")
	if (wa.every((w) => wb.includes(w))) return true
	if (wb.every((w) => wa.includes(w))) return true

	// Levenshtein for short strings (handles LLM typos)
	const shorter = Math.min(na.length, nb.length)
	if (shorter >= 4) {
		const threshold = shorter <= 6 ? 1 : Math.floor(shorter / 6)
		if (levenshtein(na, nb) <= threshold) return true
	}

	return false
}

/** True if `name` matches the canonical name or any alias of `entry`. */
function entryMatches(entry: CastEntry, name: string): boolean {
	return (
		namesMatch(entry.name, name) ||
		entry.aliases.some((a) => namesMatch(a, name))
	)
}

/**
 * Try to merge `name` + `extraAliases` into an existing entry.
 * Returns true if a match was found (and the entry was updated).
 */
function mergeIntoExisting(
	entries: CastEntry[],
	name: string,
	extraAliases: string[]
): boolean {
	for (const entry of entries) {
		if (!entryMatches(entry, name)) continue

		// Add name as alias if it's meaningfully different from the canonical
		if (
			!namesMatch(entry.name, name) &&
			!entry.aliases.some((a) => namesMatch(a, name))
		) {
			entry.aliases.push(name)
		}
		for (const alias of extraAliases) {
			if (
				!namesMatch(entry.name, alias) &&
				!entry.aliases.some((a) => namesMatch(a, alias))
			) {
				entry.aliases.push(alias)
			}
		}
		return true
	}
	return false
}

// ── Timeline comparison ───────────────────────────────────────────────────────

interface TimelinePos {
	entryId: number
	year: number
	month: number | null
	day: number | null
}

/** True if position A is strictly before position B (or same entry, earlier scene). */
function isStrictlyBefore(
	a: TimelinePos,
	aSceneId: number | null,
	b: TimelinePos,
	bSceneId: number
): boolean {
	if (a.year !== b.year) return a.year < b.year
	const am = a.month ?? 0,
		bm = b.month ?? 0
	if (am !== bm) return am < bm
	const ad = a.day ?? 0,
		bd = b.day ?? 0
	if (ad !== bd) return ad < bd
	if (a.entryId !== b.entryId) return a.entryId < b.entryId
	// Same history entry — scene id is the tiebreaker
	return (aSceneId ?? 0) < bSceneId
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildSceneCastList(
	sceneId: number,
	lorebookId: number,
	chatId: number | null
): Promise<CastEntry[]> {
	const entries: CastEntry[] = []

	// ── 1. Current scene's timeline position ─────────────────────────────────
	const currentScene = await db.query.scenes.findFirst({
		where: eq(schema.scenes.id, sceneId),
		columns: { historyEntryId: true }
	})
	const currentHistoryEntryId = currentScene?.historyEntryId ?? null

	let currentPos: TimelinePos | null = null
	if (currentHistoryEntryId) {
		const he = await db.query.historyEntries.findFirst({
			where: eq(schema.historyEntries.id, currentHistoryEntryId),
			columns: { id: true, year: true, month: true, day: true }
		})
		if (he) {
			currentPos = {
				entryId: he.id,
				year: he.year ?? 0,
				month: he.month,
				day: he.day
			}
		}
	}

	// ── 2. Chat characters + personas ────────────────────────────────────────
	if (chatId) {
		const [chatChars, chatPersonas] = await Promise.all([
			db.query.chatCharacters.findMany({
				where: eq(schema.chatCharacters.chatId, chatId),
				with: {
					character: {
						columns: {
							id: true,
							name: true,
							nickname: true,
							aliases: true
						}
					}
				}
			}),
			db.query.chatPersonas.findMany({
				where: eq(schema.chatPersonas.chatId, chatId),
				with: {
					persona: {
						columns: { id: true, name: true, aliases: true }
					}
				}
			})
		])

		for (const cc of chatChars) {
			const char = (cc as any).character
			if (!char?.name) continue
			const aliases = [
				...(char.nickname ? [char.nickname] : []),
				...(char.aliases ?? [])
			].filter((a: string) => !namesMatch(a, char.name))
			if (!mergeIntoExisting(entries, char.name, aliases)) {
				entries.push({ name: char.name, aliases })
			}
		}

		for (const cp of chatPersonas) {
			const persona = (cp as any).persona
			if (!persona?.name) continue
			const aliases = (persona.aliases ?? []).filter(
				(a: string) => !namesMatch(a, persona.name)
			)
			if (!mergeIntoExisting(entries, persona.name, aliases)) {
				entries.push({ name: persona.name, aliases })
			}
		}
	}

	// ── 3. Lorebook bindings → characters/personas not already in chat ───────
	const bindings = await db.query.lorebookBindings.findMany({
		where: eq(schema.lorebookBindings.lorebookId, lorebookId),
		with: {
			character: {
				columns: { id: true, name: true, nickname: true, aliases: true }
			},
			persona: { columns: { id: true, name: true, aliases: true } }
		}
	})

	for (const binding of bindings) {
		const char = (binding as any).character
		if (char?.name) {
			const aliases = [
				...(char.nickname ? [char.nickname] : []),
				...(char.aliases ?? [])
			].filter((a: string) => !namesMatch(a, char.name))
			if (!mergeIntoExisting(entries, char.name, aliases)) {
				entries.push({ name: char.name, aliases })
			}
		}
		const persona = (binding as any).persona
		if (persona?.name) {
			const aliases = (persona.aliases ?? []).filter(
				(a: string) => !namesMatch(a, persona.name)
			)
			if (!mergeIntoExisting(entries, persona.name, aliases)) {
				entries.push({ name: persona.name, aliases })
			}
		}
	}

	// ── 4. Narrative nodes (chronologically eligible) ────────────────────────
	const allNodes = await db.query.narrativeNodes.findMany({
		where: eq(schema.narrativeNodes.lorebookId, lorebookId),
		columns: {
			id: true,
			name: true,
			aliases: true,
			historyEntryId: true,
			sceneId: true,
			parentNodeId: true
		},
		with: {
			historyEntry: {
				columns: { id: true, year: true, month: true, day: true }
			}
		}
	})

	// Build parent map for alias inheritance from merged nodes
	const nodeById = new Map(allNodes.map((n: any) => [n.id, n]))

	const eligibleNodes = allNodes.filter((node: any) => {
		if (!node.historyEntryId || !(node as any).historyEntry) return true // unlinked = always eligible
		if (!currentPos) return true
		const nodePos: TimelinePos = {
			entryId: (node as any).historyEntry.id,
			year: (node as any).historyEntry.year ?? 0,
			month: (node as any).historyEntry.month,
			day: (node as any).historyEntry.day
		}
		// Include if node appeared at or before current scene
		return (
			isStrictlyBefore(nodePos, node.sceneId, currentPos, sceneId) ||
			(nodePos.entryId === currentPos.entryId &&
				(node.sceneId ?? 0) <= sceneId)
		)
	})

	for (const node of eligibleNodes) {
		const nodeAliases: string[] = [...((node as any).aliases ?? [])]

		// Inherit aliases from parent (merged) node
		if ((node as any).parentNodeId) {
			const parent = nodeById.get((node as any).parentNodeId)
			if (parent) {
				nodeAliases.push(...((parent as any).aliases ?? []))
				// Also include the parent's name as an alias if different
				if (
					(parent as any).name &&
					!namesMatch((parent as any).name, (node as any).name)
				) {
					nodeAliases.push((parent as any).name)
				}
			}
		}

		const uniqueAliases = nodeAliases.filter(
			(a) => !namesMatch(a, (node as any).name)
		)

		if (!mergeIntoExisting(entries, (node as any).name, uniqueAliases)) {
			entries.push({ name: (node as any).name, aliases: uniqueAliases })
		}
	}

	// ── 5. Names from prior scenes ────────────────────────────────────────────
	if (currentPos) {
		const allScenes = await db.query.scenes.findMany({
			where: eq(schema.scenes.lorebookId, lorebookId),
			columns: {
				id: true,
				historyEntryId: true,
				participantCharacters: true,
				mentionedCharacters: true
			},
			with: {
				historyEntry: {
					columns: { id: true, year: true, month: true, day: true }
				}
			}
		})

		for (const s of allScenes) {
			if (s.id === sceneId) continue
			const he = (s as any).historyEntry
			if (!he) continue
			const sPos: TimelinePos = {
				entryId: he.id,
				year: he.year ?? 0,
				month: he.month,
				day: he.day
			}
			if (
				!isStrictlyBefore(sPos, s.id, currentPos, sceneId) &&
				!(sPos.entryId === currentPos.entryId && s.id < sceneId)
			)
				continue

			const names = [
				...((s.participantCharacters as string[]) ?? []),
				...((s.mentionedCharacters as string[]) ?? [])
			]
			for (const name of names) {
				if (!name?.trim()) continue
				if (!mergeIntoExisting(entries, name, [])) {
					entries.push({ name, aliases: [] })
				}
			}
		}
	}

	// ── 6. Final dedup pass — collapse entries whose canonical names match ────
	const merged: CastEntry[] = []
	for (const entry of entries) {
		if (!mergeIntoExisting(merged, entry.name, entry.aliases)) {
			merged.push({
				name: entry.name,
				aliases: [...new Set(entry.aliases)]
			})
		}
	}

	// Deduplicate aliases within each entry
	for (const entry of merged) {
		entry.aliases = [...new Set(entry.aliases)]
	}

	return merged
}
