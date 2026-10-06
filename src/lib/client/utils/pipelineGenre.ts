/**
 * A pipeline's genre, for showing beside its name.
 *
 * Pipeline names carry no genre (NOMENCLATURE §2, "Pipeline names", ruled
 * 2026-10-05): every genre's reply is _Reply_. So wherever pipelines of
 * several genres are listed, the genre is shown beside the name — otherwise
 * four genres' _Reply_ are four identical rows. A list inside one session is
 * one genre already, and shows the bare name.
 *
 * The genre is the spec's declared claim (`taxonomy.genre`, off the
 * `pipelines:list` row), never parsed from the slug; its display name is the
 * registry's (`sessions:genres`), as Admin › Pipelines' Genre column reads it.
 * A pipeline every genre shares (the built-ins, summarize) has none.
 */

import { withGenre } from "$lib/shared/utils/withGenre"

type GenreName = { genreId: string; name: string }

/** The genre a pipeline serves, or null for one every genre shares. */
export function pipelineGenreId(p: {
	taxonomy?: { genre?: string } | null
}): string | null {
	return p.taxonomy?.genre ?? null
}

/**
 * The display name of the genre a pipeline serves, or null.
 *
 * `genres` is the `sessions:genres` list, or null until it has arrived —
 * null names nothing rather than flashing the genre's id. A genre the list
 * does not carry (a plugin's genre while its plugin is off) shows its id:
 * a pipeline that says which genre it is for, unreadably, beats one that
 * looks shared.
 */
export function pipelineGenreName(
	p: { taxonomy?: { genre?: string } | null },
	genres: readonly GenreName[] | null
): string | null {
	const id = pipelineGenreId(p)
	if (!id || !genres) return null
	return genres.find((g) => g.genreId === id)?.name ?? id
}

/** "Reply · Adventure" — or the bare name when there is no genre to show. */
export { withGenre }

/**
 * A pipeline's name with its genre beside it, found by slug in the
 * `pipelines:list` rows — for a surface that holds only the slug (a review
 * card, a run). Null while either list is still on its way, or when the
 * slug is not published, so the caller keeps its own fallback.
 */
export function pipelineLabel(
	slug: string,
	pipelines:
		| readonly {
				slug: string
				name: string
				taxonomy?: { genre?: string } | null
		  }[]
		| null,
	genres: readonly GenreName[] | null
): string | null {
	const p = pipelines?.find((x) => x.slug === slug)
	if (!p || !genres) return null
	return withGenre(p.name, pipelineGenreName(p, genres))
}
