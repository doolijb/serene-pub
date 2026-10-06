/**
 * Every pipeline's label for a list that mixes genres: its name with its
 * genre beside it — "Reply · Adventure" — and the bare name for a pipeline
 * every genre shares (NOMENCLATURE §2, "Pipeline names").
 *
 * For the payloads that name pipelines by a string (the library's `usedBy`
 * and `origin`, a script's chains, a picker's "from …"). Names carry no
 * genre, so a bare name there is four genres' _Reply_ reading alike — and a
 * set of names collapses them into one.
 *
 * The genre is the active version's declared claim (`taxonomy.genre`), as
 * `pipelines:list` sends it and Admin › Pipelines' Genre column reads it;
 * its display name is the genre's own (`listSessionGenres`, the names
 * `sessions:genres` sends), else its id.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { withGenre } from "$lib/shared/utils/withGenre"

/** Spec id → "Reply · Adventure" (or the bare name, or the slug). */
export async function pipelineLabelsById(db: Db): Promise<Map<number, string>> {
	const rows = await db
		.select({
			id: schema.pipelineSpecs.id,
			slug: schema.pipelineSpecs.slug,
			name: schema.pipelineSpecs.name,
			taxonomy: schema.pipelineSpecVersions.taxonomy
		})
		.from(schema.pipelineSpecs)
		.leftJoin(
			schema.pipelineSpecVersions,
			eq(
				schema.pipelineSpecVersions.id,
				schema.pipelineSpecs.activeVersionId
			)
		)
	const { listSessionGenres } = await import("./sessionGenres")
	const genreNames = new Map(
		(await listSessionGenres(db)).map((g) => [g.genreId, g.name])
	)
	return new Map(
		(rows as any[]).map((r) => {
			const genre: string | undefined = r.taxonomy?.genre
			return [
				r.id,
				withGenre(
					r.name ?? r.slug,
					genre ? (genreNames.get(genre) ?? genre) : null
				)
			]
		})
	)
}
