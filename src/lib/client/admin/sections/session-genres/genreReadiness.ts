/**
 * A genre's **Readiness** card (PLAN-pipeline-canvas-and-genre-authoring
 * §6.2): what an in-app genre still needs before people can play it — and
 * before it can be packaged — read back from the change page's detail.
 *
 * The same shape as the wizard's service road (`wizard/serviceRoadChecklist.ts`)
 * and the Overview's _Needs you_: a line is a fact the server already holds,
 * gold until it is set and green once it is ("gold until set", 10-06), and
 * only the NEXT unticked line carries an action — a later one cannot usefully
 * be done before it.
 *
 * Three lines are **optional** (state, layout, export): a genre plays without
 * stats or its own layout, and export is the last, never-finished act. They
 * wear the same gold dot, but `next` reaches one only once every required
 * line is green, and only when it has something to offer.
 *
 * Pure: the page passes its detail in and renders what comes back.
 */
export type GenreDetail = Sockets.SessionAdmin.GenreDetail.Response

export type ReadinessLineId =
	| "name"
	| "fields"
	| "create"
	| "reply"
	| "preset"
	| "state"
	| "layout"
	| "events"
	| "export"

/** Where the next line's button goes. The page maps each kind to a control. */
export type ReadinessAction =
	/** Scroll to one of the change form's own cards. */
	| { kind: "section"; section: "about" | "session-fields" | "availability" | "events"; label: string }
	/** Open another admin page. */
	| { kind: "href"; href: string; label: string }
	/** Open the Export as plugin… question. */
	| { kind: "export"; label: string }

export interface ReadinessLine {
	id: ReadinessLineId
	label: string
	done: boolean
	/** Not needed to play: state, layout, export. */
	optional: boolean
	/** One sentence: what is set, or what is missing. */
	detail: string
	/** Only on the `next` line; null everywhere else. */
	action: ReadinessAction | null
}

export interface Readiness {
	lines: ReadinessLine[]
	/** The line that carries the one action; null when nothing is left to offer. */
	next: ReadinessLineId | null
}

/** The reply event, by slug: `core:event/message-respond@1` or the bare slug. */
const RESPOND = /^(?:[^:]+:event\/)?message-respond(?:@\d+)?$/

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function genreReadiness(detail: GenreDetail): Readiness {
	const genre = detail.genre
	const editable = genre?.editable === true
	const slots = detail.slots ?? []
	const defaultPreset =
		genre?.defaultPresetId != null
			? detail.presets.find((p) => p.id === genre.defaultPresetId)
			: undefined
	const bound = (event: string) => !!defaultPreset?.bindings[event]?.spec

	type Draft = Omit<ReadinessLine, "action"> & { offer: ReadinessAction | null }
	const lines: Draft[] = []

	// ── name and description ─────────────────────────────────────────
	const named = !!genre?.name.trim()
	const described = !!genre?.description.trim()
	lines.push({
		id: "name",
		label: "Name and description",
		done: named && described,
		optional: false,
		detail: !named
			? "The genre has no name."
			: described
				? `People pick it as ${genre!.name}.`
				: "Say in a sentence what kind of session it is — the picker shows it.",
		offer: editable ? { kind: "section", section: "about", label: "Describe it" } : null
	})

	// ── session fields ───────────────────────────────────────────────
	const fieldCount = Object.keys(genre?.fields ?? {}).length
	lines.push({
		id: "fields",
		label: "Session fields",
		done: fieldCount > 0,
		optional: false,
		detail: fieldCount
			? `${plural(fieldCount, "field", "fields")} on the new-session form.`
			: "The form people fill in to start a session asks nothing yet.",
		offer: editable ? { kind: "section", section: "session-fields", label: "Add a field" } : null
	})

	// ── create pipeline ──────────────────────────────────────────────
	const createSlug = genre?.createSpecSlug ?? null
	lines.push({
		id: "create",
		label: "Create pipeline",
		done: !!createSlug,
		optional: false,
		detail: createSlug
			? "Sets a new session up when someone starts one."
			: "Nothing sets a new session up — the genre has no create pipeline.",
		offer: { kind: "href", href: "/admin/pipelines", label: "Open pipelines" }
	})

	// ── reply pipeline: the default preset binds message-respond ─────
	const respondSlot = slots.find((s) => RESPOND.test(s.event))
	const replyDone = !respondSlot || bound(respondSlot.event)
	lines.push({
		id: "reply",
		label: "Reply pipeline",
		done: replyDone,
		optional: false,
		detail: !respondSlot
			? "This genre declares no reply event."
			: replyDone
				? "The default preset answers each message."
				: defaultPreset
					? "The default preset binds nothing to answer a message."
					: "Needs a default preset to bind it on.",
		offer:
			!defaultPreset
				? { kind: "section", section: "availability", label: "Pick a default preset" }
				: editable
					? { kind: "section", section: "events", label: "Bind the reply" }
					: { kind: "href", href: `/admin/session-presets/${defaultPreset.id}`, label: "Open the preset" }
	})

	// ── default preset ───────────────────────────────────────────────
	const presetDone = !!defaultPreset?.enabled
	lines.push({
		id: "preset",
		label: "Default preset",
		done: presetDone,
		optional: false,
		detail: !defaultPreset
			? "New sessions have no preset to start from."
			: defaultPreset.enabled
				? `New sessions start from ${defaultPreset.name}.`
				: `${defaultPreset.name} is hidden, so it is not offered.`,
		offer: { kind: "section", section: "availability", label: defaultPreset ? "Offer it" : "Pick one" }
	})

	// ── state (what the host keeps for it; RF fix 8: attributes are the rules') ──
	lines.push({
		id: "state",
		label: "State",
		done: !!genre?.hasState,
		optional: true,
		detail: genre?.hasState
			? "Sessions keep a place, a time or a tool of the genre's own; their stats come from the rules they play."
			: "Sessions keep no place or time of their own; their stats come from the rules they play.",
		offer: null
	})

	// ── layout ───────────────────────────────────────────────────────
	lines.push({
		id: "layout",
		label: "Layout",
		done: !!genre?.layout,
		optional: true,
		detail: genre?.layout
			? `Sessions open in ${genre!.layout!.name}.`
			: "Sessions open in the app's default layout.",
		offer: null
	})

	// ── every other required event bound ────────────────────────────
	const unbound = slots.filter(
		(s) => s.required && !s.open && s !== respondSlot && !bound(s.event)
	)
	lines.push({
		id: "events",
		label: "Other events",
		done: !!defaultPreset && unbound.length === 0,
		optional: false,
		detail: !defaultPreset
			? "Needs a default preset to bind them on."
			: unbound.length
				? `${plural(unbound.length, "required event is", "required events are")} unbound.`
				: "Every required event has a pipeline.",
		offer: !defaultPreset
			? { kind: "section", section: "availability", label: "Pick a default preset" }
			: editable
				? { kind: "section", section: "events", label: "Bind events" }
				: { kind: "href", href: `/admin/session-presets/${defaultPreset.id}`, label: "Open the preset" }
	})

	// ── export ───────────────────────────────────────────────────────
	const canExport = editable && genre?.pluginsEnabled === true
	lines.push({
		id: "export",
		label: "Export",
		done: false,
		optional: true,
		detail: canExport
			? "Package it as a plugin to share or install on another pub."
			: !editable
				? "Shipped genres travel with the code that declares them."
				: "Plugins are switched off on this pub, so a genre cannot be packaged.",
		offer: canExport ? { kind: "export", label: "Export as plugin…" } : null
	})

	const required = lines.find((l) => !l.optional && !l.done)
	const nextLine = required ?? lines.find((l) => l.optional && !l.done && l.offer)
	const next = nextLine?.id ?? null
	return {
		lines: lines.map(({ offer, ...l }) => ({ ...l, action: l.id === next ? offer : null })),
		next
	}
}
