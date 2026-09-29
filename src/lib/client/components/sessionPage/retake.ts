/**
 * Regenerate the last turn, as the page presses it (`core#retake`, lair pass
 * R2, owner 2026-09-28): one `sessions:retakeTurn`, behind a confirm.
 *
 * - **Asked first.** A press sends a `preview` — which writes nothing — and
 *   the rows it names open the confirm dialog (`RetakeConfirm.svelte`). The
 *   retake itself is sent only on Regenerate.
 * - **Don't ask again for this session** fires core's annex field
 *   `core:annex#retake-quietly` `{ value: true }`. While the viewer's annex
 *   view says so, a press skips the dialog and retakes at once. Edit Session →
 *   Settings takes it back ("Ask before regenerating a turn").
 * - **A row's ⋮ Regenerate** on a row that is not a delver's, in a genre that
 *   offers retake, is asked the same preview: when the newest turn holds that
 *   row among several, it is the whole turn that is regenerated; otherwise
 *   the row regenerate runs as it always has (a knock, a narration, a pick
 *   keep their swipes). The server refuses a row regenerate on such a row in
 *   the same words either way (`retakeRowRefusal`).
 *
 * The server answers every refusal in a sentence on
 * `sessions:retakeTurn:error`; this module only routes.
 */

/** Core's annex field for "don't ask again" — `<owner>:annex#<key>`. */
export const RETAKE_QUIETLY = "core:annex#retake-quietly"

/** Is retake's "don't ask again" set, in this viewer's annex view? */
export const retakeQuietly = (annex: Record<string, Record<string, unknown>> | undefined) =>
	annex?.core?.["retake-quietly"] === true

export type RetakeRow = Sockets.Sessions.RetakeTurn.Row

export interface RetakeDeps {
	sessionId: () => number
	/** The viewer's annex flag (`retakeQuietly`). */
	quiet: () => boolean
	/** `sessions:retakeTurn`. */
	send: (params: Sockets.Sessions.RetakeTurn.Params) => void
	/** Fire `core:annex#retake-quietly` with `{ value }`. */
	setQuiet: (value: boolean) => void
	/** Show the confirm dialog, naming these rows. */
	ask: (rows: RetakeRow[]) => void
}

export interface Retake {
	/** The composer's Regenerate, `/retake`, a widget's `invoke('retake')`. */
	press(): void
	/**
	 * A row's ⋮ Regenerate on a row that is not a delver's: retake the whole
	 * turn when the newest turn holds `messageId` among several rows, else
	 * `rowRegenerate()`.
	 */
	pressRow(messageId: number, rowRegenerate: () => void): void
	/** The dialog's Regenerate; `quietly` is its checkbox. */
	confirm(quietly: boolean): void
	/** The dialog closed without Regenerate. */
	cancel(): void
	/** A `sessions:retakeTurn` answer (success or `:error`). True when it was this module's preview. */
	hear(res: Sockets.Sessions.RetakeTurn.Response): boolean
}

export function createRetake(deps: RetakeDeps): Retake {
	/** The preview in flight, and what it was asked for. */
	let pending: { row?: { messageId: number; fallback: () => void } } | null = null
	const retakeNow = () => deps.send({ sessionId: deps.sessionId() })
	const preview = () => deps.send({ sessionId: deps.sessionId(), preview: true })

	return {
		press() {
			if (deps.quiet()) return retakeNow()
			pending = {}
			preview()
		},
		pressRow(messageId, rowRegenerate) {
			pending = { row: { messageId, fallback: rowRegenerate } }
			preview()
		},
		confirm(quietly) {
			if (quietly) deps.setQuiet(true)
			retakeNow()
		},
		cancel() {
			pending = null
		},
		hear(res) {
			if (res.sessionId !== deps.sessionId() || !pending) return false
			const asked = pending
			if (!res.preview) {
				// A refused preview answers on `:error`, with no `preview` flag.
				if (res.ok) return false
				pending = null
				// A row press the server will not retake is the row's own
				// regenerate, which answers in its own words if it cannot.
				if (!asked.row) return false
				asked.row.fallback()
				return true
			}
			pending = null
			const rows = res.rows ?? []
			if (asked.row) {
				const whole =
					rows.length > 1 && rows.some((r) => r.messageId === asked.row!.messageId)
				if (!whole) {
					asked.row.fallback()
					return true
				}
			}
			if (deps.quiet()) retakeNow()
			else deps.ask(rows)
			return true
		}
	}
}

/**
 * The dialog's sentence: "This deletes and rewrites: Brannoc, Vell, and the
 * narrator." Names in the turn's order, each once.
 */
export function retakeSentence(rows: ReadonlyArray<RetakeRow>, locale = "en"): string {
	const names = [...new Set(rows.map((r) => (r.channel === "main" ? r.name : `${r.name} (${r.channel})`)))]
	if (!names.length) return "This deletes and rewrites the last turn."
	const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names)
	return `This deletes and rewrites: ${list}.`
}
