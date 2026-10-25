/**
 * 🚧 **Placed media in the context budget** (O10, PROPOSAL-layering §13).
 *
 * Placement put a media marker on each line whose file the call reads, and
 * beside it two keys (`attachments/placement.ts`): `mediaTokens`, what those
 * markers are estimated to cost the service, and `attachmentsAsText`, the same
 * attachments with every marker as its name. The rendered prompt's text
 * cannot see a picture or a sound — a marker is a few characters — so
 * `assemble` adds these to what it measured, and when the prompt with its
 * media is over the budget, the media goes back to its text form, OLDEST line
 * first, before any line of the conversation is cut. A note says so on the
 * receipt — never silently.
 *
 * Pure. Lines with no media are returned as the same objects.
 */
import {
	LINE_ATTACHMENTS_AS_TEXT,
	LINE_MEDIA_TOKENS
} from "$lib/server/attachments/placement"

type Line = { [key: string]: unknown }

const mediaTokensOf = (line: Line | null | undefined): number => {
	const n = line?.[LINE_MEDIA_TOKENS]
	return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0
}

const MARKER = /<@media:[A-Za-z0-9-]{1,64}>/g

/** What every line's placed media is estimated to cost, together. */
export function placedMediaTokens(lines: readonly unknown[]): number {
	return lines.reduce<number>((n, l) => n + mediaTokensOf(l as Line), 0)
}

export interface MediaFallback<L> {
	lines: L[]
	/** Files sent as their names instead. */
	files: number
	/** Estimated tokens the fallback freed. */
	freed: number
}

/**
 * Fall placed media back to its text form, oldest line first, until at least
 * `over` estimated tokens are freed (or none is left). A line's text form
 * costs a few tokens of its own — `count` measures it, so the freed figure is
 * net.
 */
export function fallBackMedia<L>(
	lines: readonly L[],
	over: number,
	count: (text: string) => number = (t) => Math.ceil(t.length / 4)
): MediaFallback<L> {
	let freed = 0
	let files = 0
	const out = lines.map((line) => {
		if (freed >= over) return line
		const cost = mediaTokensOf(line as Line)
		if (!cost) return line
		const l = line as Line
		const before = typeof l.attachments === "string" ? l.attachments : ""
		const after =
			typeof l[LINE_ATTACHMENTS_AS_TEXT] === "string"
				? (l[LINE_ATTACHMENTS_AS_TEXT] as string)
				: before.replace(MARKER, "").trim()
		files += before.match(MARKER)?.length ?? 0
		freed += cost - Math.max(0, count(after) - count(before))
		const { [LINE_MEDIA_TOKENS]: _t, [LINE_ATTACHMENTS_AS_TEXT]: _a, ...rest } = l
		return { ...rest, attachments: after } as L
	})
	return { lines: out, files, freed }
}

/** The receipt's sentence for a fallback. */
export function mediaBudgetNote(fit: {
	files: number
	media: number
	measured: number
	budget: number
}): string {
	return (
		`${fit.files} ${fit.files === 1 ? "file" : "files"} did not fit the context window and ` +
		`${fit.files === 1 ? "was" : "were"} sent as ${fit.files === 1 ? "its name" : "names"} instead ` +
		`(the prompt measured ${fit.measured} tokens with about ${fit.media} of media, against a budget of ${fit.budget}).`
	)
}
