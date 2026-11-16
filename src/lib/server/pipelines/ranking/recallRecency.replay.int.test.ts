/**
 * Recall-recency replay: on a COPY of a real install, how does lore selection
 * change when `lastRefRecency` ("Recently referenced") is weighted 0?
 *
 * Measures only; changes nothing shipped. Runs when `REPLAY_DATA_DIR` names an
 * app data root (`<dir>/data/serene-pub.db`, `<dir>/data/meta.json`); skipped
 * otherwise, and then imports nothing from `src/lib/server`.
 *
 * Rules held here:
 * - the copy is the only database opened; the source is never modified;
 * - no message or entry text is printed, logged or written — ids, entry names,
 *   scores and counts only (the app's own console is silenced);
 * - no embedding model: meaning search contributes nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
	agoOf,
	ranked,
	renderGroup,
	summarize,
	type LoreRow,
	type SessionRecord,
	type TurnRecord
} from "./recallRecency.replay"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

/** The dated genres whose sessions run on story time (plan ★14). */
const STORY_TIME_GENRES = [
	"core:genre/story",
	"core:genre/lair",
	"core:genre/dungeon-crawler"
]
const RANK_NODE = "core:task/rank-hybrid@1"
const LORE_SOURCES = ["worldLore", "characterLore", "history"]
const BANDS = [
	"worldLore",
	"characterLore",
	"history",
	"messages",
	"relationships"
]
const MIN_LIVE = 20
const MIN_CONSIDERED = 10
const FIRST_N = 10
const OUT_JSON = path.resolve(
	process.cwd(),
	"plans/measurements/recall-recency-2026-11-15.json"
)
const HOURS = 30 * 60 * 1000

const out = (s: string) => process.stdout.write(s + "\n")

describe.skipIf(!process.env.REPLAY_DATA_DIR)("recall recency replay", () => {
	let db: any
	let schema: any
	let runTurn: any
	let sql: any
	let drizzle: { and: any; eq: any; gt: any; inArray: any; asc: any }
	let notAFailedReplySql: any

	beforeAll(async () => {
		for (const m of ["log", "info", "debug", "warn"] as const)
			vi.spyOn(console, m).mockImplementation(() => {})

		const src = path.join(process.env.REPLAY_DATA_DIR!, "data")
		const dest = path.join(process.env.SERENE_PUB_DATA_DIR!, "data")
		fs.mkdirSync(dest, { recursive: true })
		fs.cpSync(
			path.join(src, "serene-pub.db"),
			path.join(dest, "serene-pub.db"),
			{
				recursive: true
			}
		)
		fs.cpSync(path.join(src, "meta.json"), path.join(dest, "meta.json"))
		const metaPath = path.join(dest, "meta.json")
		const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"))
		if ("lock" in meta) {
			delete meta.lock
			fs.writeFileSync(metaPath, JSON.stringify(meta))
		}

		const dbModule = await import("$lib/server/db")
		await dbModule.dbReady
		db = dbModule.db
		schema = await import("$lib/server/db/schema")
		const orm = await import("drizzle-orm")
		sql = orm.sql
		drizzle = orm as any
		notAFailedReplySql = (await import("$lib/server/messages/failedReply"))
			.notAFailedReplySql
		runTurn = (await import("$lib/server/pipelines/runtime/runTurn"))
			.runTurn
	}, HOURS)

	afterAll(() => vi.restoreAllMocks())

	const M = () => schema.sessionMessages

	async function liveRows(sessionId: number) {
		const m = M()
		return (await db
			.select({
				id: m.id,
				role: m.role,
				characterId: m.characterId,
				createdAt: m.createdAt
			})
			.from(m)
			.where(
				drizzle.and(
					drizzle.eq(m.sessionId, sessionId),
					sql`(${m.channel} = 'main' or ${m.channel} like 'main:%')`,
					drizzle.eq(m.isHidden, false),
					drizzle.eq(m.isGenerating, false),
					notAFailedReplySql
				)
			)
			.orderBy(drizzle.asc(m.id))) as {
			id: number
			role: string
			characterId: number | null
			createdAt: Date
		}[]
	}

	async function contentOf(id: number): Promise<string> {
		const m = M()
		const [row] = await db
			.select({ content: m.content })
			.from(m)
			.where(drizzle.eq(m.id, id))
		return row.content
	}

	/** Run one preview; returns the receipt's rank nodes and a considered count. */
	async function preview(
		sessionId: number,
		userId: number,
		currentCharacterId: number | null,
		text: string,
		seed: string,
		overrides?: any[]
	) {
		const receipt: any = await runTurn({
			db,
			sessionId,
			userId,
			currentCharacterId,
			text,
			seed,
			overrides,
			preview: true,
			skipReceipt: true
		})
		const nodes: any[] = receipt?.nodes ?? []
		const rankNodes = nodes.filter((n) => n.definitionId === RANK_NODE)
		let considered = 0
		for (const n of nodes) {
			const c = n?.output?.diagnostics?.considered
			if (typeof c === "number") considered += c
		}
		return { rankNodes, considered }
	}

	function loreRows(rankNodes: any[]): LoreRow[] {
		const rows: Omit<LoreRow, "rank">[] = []
		for (const node of rankNodes)
			for (const d of node?.output?.decisions ?? []) {
				const c = d?.candidate ?? {}
				if (!LORE_SOURCES.includes(c.source)) continue
				const p = c.payload ?? {}
				const name = p.name ?? p.title ?? c.name
				const s = Number(c.signals?.lastRefRecency ?? 0)
				rows.push({
					id: c.id,
					name:
						typeof name === "string" && name
							? name
							: `${c.source}:${c.id}`,
					source: c.source,
					typeId: typeof p.typeId === "string" ? p.typeId : null,
					included: !!d.included,
					score: Number(d.score),
					s,
					ago: agoOf(s)
				})
			}
		return ranked(rows)
	}

	/** Hide every live-or-not row after `cutId`; returns the ids this call hid. */
	async function hideAfter(
		sessionId: number,
		cutId: number
	): Promise<number[]> {
		const m = M()
		const rows = await db
			.update(m)
			.set({ isHidden: true })
			.where(
				drizzle.and(
					drizzle.eq(m.sessionId, sessionId),
					drizzle.gt(m.id, cutId),
					drizzle.eq(m.isHidden, false)
				)
			)
			.returning({ id: m.id })
		return rows.map((r: { id: number }) => r.id)
	}

	async function unhide(ids: number[]) {
		if (!ids.length) return
		await db
			.update(M())
			.set({ isHidden: false })
			.where(drizzle.inArray(M().id, ids))
	}

	const entryCreated = new Map<number, number>()
	async function entriesCreated(ids: number[]) {
		const need = ids.filter((i) => !entryCreated.has(i))
		if (need.length) {
			const rows = await db
				.select({
					id: schema.lorebookEntries.id,
					createdAt: schema.lorebookEntries.createdAt
				})
				.from(schema.lorebookEntries)
				.where(drizzle.inArray(schema.lorebookEntries.id, need))
			for (const r of rows) entryCreated.set(r.id, r.createdAt.getTime())
		}
	}

	function overridesFor(rankKeys: string[]) {
		return rankKeys.map((nodeKey) => ({
			nodeKey,
			path: "signalLastRefRecency",
			value: Object.fromEntries(BANDS.map((b) => [b, 0]))
		}))
	}

	function assistantAfter(
		live: { id: number; role: string; characterId: number | null }[],
		cutId: number
	) {
		return live.find((r) => r.id > cutId && r.role === "assistant")
	}

	/** Replay one session at every position; restores the rows it hid. */
	async function replay(
		sessionId: number,
		userId: number,
		recordWeights?: Map<string, number[]>
	): Promise<TurnRecord[]> {
		const live = await liveRows(sessionId)
		const hidden: number[] = []
		const turns: TurnRecord[] = []
		try {
			hidden.push(...(await hideAfter(sessionId, live[FIRST_N - 1]!.id)))
			let nonLoreIds = new Set<number>()
			for (let n = FIRST_N; n <= live.length; n++) {
				const cut = live[n - 1]!
				// Un-hide what this position newly reaches.
				const reach = hidden.filter((id) => id <= cut.id)
				await unhide(reach)
				for (const id of reach) hidden.splice(hidden.indexOf(id), 1)

				const next =
					n === live.length
						? [...live]
								.reverse()
								.find((r) => r.role === "assistant")
						: assistantAfter(live, cut.id)
				const currentCharacterId = next?.characterId ?? null
				const text = await contentOf(cut.id)
				const seed = `replay:${sessionId}:${n}`

				const a = await preview(
					sessionId,
					userId,
					currentCharacterId,
					text,
					seed
				)
				const keys = a.rankNodes.map((x: any) => x.nodeKey)
				const b = await preview(
					sessionId,
					userId,
					currentCharacterId,
					text,
					seed,
					overridesFor(keys)
				)
				const shipped = loreRows(a.rankNodes)
				const noRecency = loreRows(b.rankNodes)

				// The lever must have reached the rank node.
				const off = new Map(
					noRecency.map((r) => [`${r.source}:${r.id}`, r])
				)
				const perBand = new Map<string, number[]>()
				for (const r of shipped) {
					const o = off.get(`${r.source}:${r.id}`)
					if (!o) continue
					const d = r.score - o.score
					if (r.s === 0)
						expect(Math.abs(d)).toBeLessThanOrEqual(1e-12)
					else
						perBand.set(r.source, [
							...(perBand.get(r.source) ?? []),
							d / r.s
						])
				}
				for (const [band, ws] of perBand) {
					for (const w of ws)
						expect(Math.abs(w - ws[0]!)).toBeLessThanOrEqual(1e-9)
					recordWeights?.set(band, [
						...(recordWeights.get(band) ?? []),
						ws[0]!
					])
				}

				const ids = [
					...new Set(
						[...shipped, ...noRecency].map((r) => Number(r.id))
					)
				].filter(Number.isFinite)
				await entriesCreated(ids)
				const at = cut.createdAt.getTime()
				const known = ids.filter((i) => entryCreated.has(i))
				nonLoreIds = new Set([
					...nonLoreIds,
					...ids.filter((i) => !entryCreated.has(i))
				])
				turns.push({
					n,
					cutId: cut.id,
					currentCharacterId,
					loreExistedThen: known.every(
						(i) => entryCreated.get(i)! <= at
					),
					shipped,
					noRecency
				})
			}
			if (nonLoreIds.size)
				out(
					`note: ${nonLoreIds.size} candidate ids are not lorebook_entries ids (session ${sessionId})`
				)
		} finally {
			await unhide(hidden)
		}
		return turns
	}

	it(
		"replays real sessions with and without lastRefRecency",
		async () => {
			const started = Date.now()
			const s = schema.sessions
			const sessions = (await db
				.select({ id: s.id, userId: s.userId, genreId: s.genreId })
				.from(s)
				.where(
					drizzle.and(
						drizzle.inArray(s.genreId, STORY_TIME_GENRES),
						sql`${s.archivedAt} is null`
					)
				)
				.orderBy(drizzle.asc(s.id))) as {
				id: number
				userId: number
				genreId: string
			}[]

			const kept: Array<(typeof sessions)[number] & { live: number }> = []
			for (const ses of sessions) {
				const live = await liveRows(ses.id)
				if (live.length < MIN_LIVE) continue
				const last = live[live.length - 1]!
				const asst = [...live]
					.reverse()
					.find((r) => r.role === "assistant")
				const base = await preview(
					ses.id,
					ses.userId,
					asst?.characterId ?? null,
					await contentOf(last.id),
					`replay:${ses.id}:${live.length}`
				)
				out(
					`session ${ses.id} (${ses.genreId}): ${live.length} live, ${base.considered} considered`
				)
				if (base.considered >= MIN_CONSIDERED)
					kept.push({ ...ses, live: live.length })
			}
			out(
				`kept ${kept.length} of ${sessions.length} story-time sessions (gate: sum of diagnostics.considered >= ${MIN_CONSIDERED})`
			)

			const weights = new Map<string, number[]>()
			const records: SessionRecord[] = []
			for (const ses of kept) {
				const turns = await replay(ses.id, ses.userId, weights)
				records.push({
					sessionId: ses.id,
					genreId: ses.genreId,
					liveMessages: ses.live,
					turns
				})
				out(`session ${ses.id}: ${turns.length} turns replayed`)
			}

			// Determinism: a second pass changes nothing.
			for (const rec of records) {
				const ses = kept.find((k) => k.id === rec.sessionId)!
				const again = await replay(rec.sessionId, ses.userId)
				expect(again.length).toBe(rec.turns.length)
				for (let i = 0; i < again.length; i++)
					for (const v of ["shipped", "noRecency"] as const) {
						const pick = (t: TurnRecord) =>
							t[v].map((r) => [
								r.source,
								r.id,
								r.included,
								r.score
							])
						expect(pick(again[i]!)).toEqual(pick(rec.turns[i]!))
					}
			}

			const all = records.flatMap((r) => r.turns)

			// `lastRefRecency` is produced for keyed entries only
			// (`buildLastRefMap`), and it can change a selection only on a
			// turn where the budget left a candidate out.
			const candidateIds = [
				...new Set(
					all.flatMap((t) => t.shipped.map((r) => Number(r.id)))
				)
			].filter(Number.isFinite)
			const keyed = candidateIds.length
				? ((await db
						.select({ id: schema.lorebookEntries.id })
						.from(schema.lorebookEntries)
						.where(
							drizzle.and(
								drizzle.inArray(
									schema.lorebookEntries.id,
									candidateIds
								),
								sql`cardinality(${schema.lorebookEntries.keys}) > 0`
							)
						)) as { id: number }[])
				: []
			const leftOut = all.filter((t) =>
				t.shipped.some((r) => !r.included)
			)
			const signalled = all.reduce(
				(a, t) => a + t.shipped.filter((x) => x.s > 0).length,
				0
			)
			const structure = [
				`Distinct lore candidates whose entry has keys: ${keyed.length} of ${candidateIds.length}`,
				`Turns where the shipped run left a lore candidate out: ${leftOut.length} of ${all.length}`,
				signalled
					? "Lever check: exercised (score difference / signal constant per band)."
					: "Lever check: not exercised; no candidate carried the signal, so only 'no score moves when the signal is 0' was asserted."
			]
			const weightLines = BANDS.filter((b) => weights.has(b)).map((b) => {
				const ws = weights.get(b)!
				return `- ${b}: ${Math.min(...ws).toFixed(6)} .. ${Math.max(...ws).toFixed(6)}`
			})
			const report = [
				"## Recall recency replay: lastRefRecency weighted 0",
				"",
				...records.map((r) =>
					renderGroup(
						`Session ${r.sessionId} (${r.genreId}, ${r.liveMessages} live)`,
						r.turns
					)
				),
				renderGroup("All sessions", all),
				"**7. Inferred shipped lastRefRecency weight per band** (min .. max over positions)",
				"",
				...(weightLines.length ? weightLines : ["- none observed"]),
				"",
				`Lore candidates with lastRefRecency > 0: ${signalled} of ${all.reduce((a, t) => a + t.shipped.length, 0)}`,
				...structure,
				"",
				"Embeddings took part: no.",
				""
			].join("\n")
			out(report)

			fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true })
			fs.writeFileSync(
				OUT_JSON,
				JSON.stringify(
					{
						embeddings: false,
						gate: `sum of diagnostics.considered >= ${MIN_CONSIDERED} at the last position`,
						summary: summarize(all),
						sessions: records.map((r) => ({
							...r,
							summary: summarize(r.turns)
						}))
					},
					null,
					2
				)
			)
			out(`wall ${Math.round((Date.now() - started) / 1000)} s`)
		},
		HOURS
	)
})
