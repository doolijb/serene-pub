/**
 * 🚧 `switch-persona` (core only): switch the viewer's persona. The id is
 * passed on as a number; the page's own switch judges it.
 */

/** What this answer needs of the page. */
export interface SwitchPersonaDeps {
	switchPersona(personaId: number): void
}

/** Answer one `switch-persona`. */
export function answerSwitchPersona(params: unknown, deps: SwitchPersonaDeps): void {
	const p = params as Record<string, unknown>
	deps.switchPersona(Number(p.personaId))
}
