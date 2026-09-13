/**
 * The two figures a reader asks for out of a retrieval row's criteria.
 *
 * ⚠ **The wire's own labels are the handle.** `explainRetrieval` names each
 * criterion in content vocabulary and carries no machine key beside it, so a
 * label is what says which signal a number came from. A renamed label is a
 * renamed signal here: the two constants below are the seam, and a criterion
 * this file cannot recognise is left out rather than guessed at.
 */

/** The keyword scan's own line. */
const LEXICAL_LABEL = "Its keys"
/** The vector mechanism's cosine, as the projection words it. */
const SEMANTIC_LABEL = "Similar in meaning"

type Row = Pick<Sockets.Pipelines.RetrievalRow, "criteria">

const valueOf = (row: Row | undefined, label: string): number | undefined =>
	row?.criteria?.find((c) => c.label === label)?.value

export const lexicalScore = (row: Row | undefined): number | undefined =>
	valueOf(row, LEXICAL_LABEL)

export const semanticScore = (row: Row | undefined): number | undefined =>
	valueOf(row, SEMANTIC_LABEL)

/**
 * The keyword the run says matched, when it named one.
 *
 * The criterion quotes a single key and lists several, so a quoted term is
 * read first and the head of a list second. A criterion that names neither
 * says only *how many* keys matched, and this answers with nothing rather than
 * picking a key the run never pointed at.
 */
export function matchedKeyword(row: Row | undefined): string | undefined {
	const detail = row?.criteria?.find((c) => c.label === LEXICAL_LABEL)?.detail
	if (!detail) return undefined
	const quoted = /[“"]([^”"]+)[”"]/.exec(detail)
	if (quoted) return quoted[1].trim() || undefined
	const listed = /\(([^)]+)\)/.exec(detail)
	if (!listed) return undefined
	const first = listed[1].split(",")[0]?.trim()
	return first && first !== "…" ? first : undefined
}
