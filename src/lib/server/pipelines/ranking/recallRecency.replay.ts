/**
 * Pure functions for the recall-recency replay: per-turn diffing of the lore a
 * ranker selected under two variants, and the markdown report. No I/O, no
 * message or entry text — only ids, names, scores and counts.
 */

export interface LoreRow {
	id: number | string
	name: string
	source: string
	typeId: string | null
	included: boolean
	score: number
	/** `candidate.signals.lastRefRecency` */
	s: number
	/** Messages since the last reference, inferred from `s`; null when `s` is 0. */
	ago: number | null
	/** 1-based position by score descending among the turn's lore candidates. */
	rank: number
}

export interface TurnRecord {
	n: number
	cutId: number
	currentCharacterId: number | null
	loreExistedThen: boolean
	shipped: LoreRow[]
	noRecency: LoreRow[]
}

export interface SessionRecord {
	sessionId: number
	genreId: string
	liveMessages: number
	turns: TurnRecord[]
}

const keyOf = (r: Pick<LoreRow, "source" | "id">) => `${r.source}:${r.id}`

/** Messages-ago from a `lastRefRecency` value (`exp(-0.01 * ago)`). */
export function agoOf(s: number): number | null {
	return s > 0 ? Math.round(-Math.log(s) / 0.01) : null
}

/** Rank rows by score descending, ties by id; returns new rows with `rank` set. */
export function ranked(rows: Omit<LoreRow, "rank">[]): LoreRow[] {
	const order = [...rows].sort(
		(a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id))
	)
	const rankOf = new Map(order.map((r, i) => [keyOf(r), i + 1]))
	return rows.map((r) => ({ ...r, rank: rankOf.get(keyOf(r))! }))
}

export interface TurnDiff {
	out: LoreRow[]
	in: LoreRow[]
	shifts: number[]
}

/** What left, what entered, and how far entries selected in both moved. */
export function diffTurn(t: TurnRecord): TurnDiff {
	const off = new Map(t.noRecency.map((r) => [keyOf(r), r]))
	const on = new Map(t.shipped.map((r) => [keyOf(r), r]))
	const out: LoreRow[] = []
	const came: LoreRow[] = []
	const shifts: number[] = []
	for (const r of t.shipped) {
		if (!r.included) continue
		const other = off.get(keyOf(r))
		if (!other?.included) out.push(r)
		else shifts.push(Math.abs(r.rank - other.rank))
	}
	for (const r of t.noRecency) {
		if (!r.included) continue
		if (!on.get(keyOf(r))?.included) came.push(r)
	}
	return { out, in: came, shifts }
}

export const mean = (xs: number[]): number =>
	xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0

export function median(xs: number[]): number {
	if (!xs.length) return 0
	const s = [...xs].sort((a, b) => a - b)
	const m = s.length >> 1
	return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

const f = (x: number, d = 2) => x.toFixed(d)

export interface Summary {
	turns: number
	meanCandidates: number
	meanSelected: number
	differingTurns: number
	entriesOut: number
	entriesIn: number
	meanOutPerDiffering: number
	meanInPerDiffering: number
	meanAbsShift: number
	worstShift: number
}

export function summarize(turns: TurnRecord[]): Summary {
	const diffs = turns.map(diffTurn)
	const differing = diffs.filter((d) => d.out.length || d.in.length)
	const shifts = diffs.flatMap((d) => d.shifts)
	const out = diffs.reduce((a, d) => a + d.out.length, 0)
	const inn = diffs.reduce((a, d) => a + d.in.length, 0)
	return {
		turns: turns.length,
		meanCandidates: mean(turns.map((t) => t.shipped.length)),
		meanSelected: mean(
			turns.map((t) => t.shipped.filter((r) => r.included).length)
		),
		differingTurns: differing.length,
		entriesOut: out,
		entriesIn: inn,
		meanOutPerDiffering: differing.length ? out / differing.length : 0,
		meanInPerDiffering: differing.length ? inn / differing.length : 0,
		meanAbsShift: mean(shifts),
		worstShift: shifts.length ? Math.max(...shifts) : 0
	}
}

/** Per entry name: times, source/type, messages-ago min / median / max. */
function entryTable(rows: LoreRow[]): string {
	const by = new Map<string, LoreRow[]>()
	for (const r of rows) {
		const k = `${r.name} [${r.source}${r.typeId ? "/" + r.typeId : ""}]`
		by.set(k, [...(by.get(k) ?? []), r])
	}
	if (!by.size) return "_none_\n"
	const lines = [
		"| entry | times | ago min / median / max |",
		"|---|---|---|"
	]
	for (const [k, rs] of [...by].sort((a, b) => b[1].length - a[1].length)) {
		const ago = rs.map((r) => r.ago).filter((a): a is number => a !== null)
		lines.push(
			`| ${k} | ${rs.length} | ${
				ago.length
					? `${Math.min(...ago)} / ${median(ago)} / ${Math.max(...ago)}`
					: "never referenced"
			} |`
		)
	}
	return lines.join("\n") + "\n"
}

const names = (rs: LoreRow[]) => rs.map((r) => r.name).join(", ") || "-"

function examples(turns: TurnRecord[]): string {
	const idx = turns
		.map((t, i) => ({ t, d: diffTurn(t), i }))
		.filter((x) => x.d.out.length || x.d.in.length)
	if (!idx.length) return "_no differing turns_\n"
	const pick =
		idx.length <= 3
			? idx
			: [idx[0]!, idx[idx.length >> 1]!, idx[idx.length - 1]!]
	return (
		pick
			.map(
				(x) =>
					`- turn ${x.t.n}: out [${names(x.d.out)}] / in [${names(x.d.in)}]`
			)
			.join("\n") + "\n"
	)
}

function summaryTable(s: Summary): string {
	return [
		"| metric | value |",
		"|---|---|",
		`| turns replayed | ${s.turns} |`,
		`| mean lore candidates | ${f(s.meanCandidates)} |`,
		`| mean selected (shipped) | ${f(s.meanSelected)} |`,
		`| turns where the selected set differs | ${s.differingTurns} |`,
		`| entries out / in (total) | ${s.entriesOut} / ${s.entriesIn} |`,
		`| mean out / in per differing turn | ${f(s.meanOutPerDiffering)} / ${f(s.meanInPerDiffering)} |`,
		`| rank shift, selected in both: mean abs / worst | ${f(s.meanAbsShift)} / ${s.worstShift} |`
	].join("\n")
}

/** The report for one group of turns (a session, or all of them). */
export function renderGroup(title: string, turns: TurnRecord[]): string {
	const diffs = turns.map(diffTurn)
	const then = turns.filter((t) => t.loreExistedThen)
	const sThen = summarize(then)
	return [
		`### ${title}`,
		"",
		"**1-2, 4. All turns**",
		"",
		summaryTable(summarize(turns)),
		"",
		"**3. Dropped out (in shipped, not in noRecency)**",
		"",
		entryTable(diffs.flatMap((d) => d.out)),
		"**3. Came in (in noRecency, not in shipped)**",
		"",
		entryTable(diffs.flatMap((d) => d.in)),
		"**5. Examples**",
		"",
		examples(turns),
		`**6. Turns where every lore candidate already existed (${then.length} of ${turns.length})**`,
		"",
		summaryTable(sThen),
		""
	].join("\n")
}
