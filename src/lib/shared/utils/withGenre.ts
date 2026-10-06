/**
 * A pipeline's name with its genre beside it: "Reply · Adventure".
 *
 * Pipeline names carry no genre (NOMENCLATURE §2, "Pipeline names"), so
 * wherever pipelines of several genres are listed the genre is shown beside
 * the name. One formatter for both sides: the server writes it into the
 * strings a payload names pipelines by (`usedBy`, `origin`, a picker's
 * "from …"), and the client matches a row against those strings.
 */
export function withGenre(name: string, genreName: string | null): string {
	return genreName ? `${name} · ${genreName}` : name
}
