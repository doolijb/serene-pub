/**
 * 🚧 The **line template** seam: what the speak effect (lane D1) calls to turn
 * a group of speech cues into the text of ONE synthesis call, and to turn the
 * `prompts.direction` text into the written direction a prose-taking model is
 * sent.
 *
 * What the host hands a node for the three slots (`config/world.ts`):
 *  - `template`   `{ source: string, engine: string }` — the dereferenced
 *                 context-template row (an inline `{source, engine?}` is taken
 *                 as written). Absent/dangling → undefined (we fall to the
 *                 shipped Whole line).
 *  - `prompts`    `{ direction?: string }` — the prompt row's `fields`.
 *  - `variables`  `{ inflectionSentence?: Row, inflectionTag?: Row }` — each
 *                 a variable-template row `{ variableId, engine, source, name }`
 *                 (only when a layout resolved; absent → the shipped layout).
 *
 * Deterministic: the same cues, controls and slots give the same text.
 */

import { and, eq, isNull } from "drizzle-orm"
import {
	INFLECTION_SENTENCE_LAYOUT,
	INFLECTION_TAG_LAYOUT,
	SHIPPED_SPOKEN_LINE_TEMPLATES,
	SPEAK_DIRECTION_SOURCE,
	SPOKEN_LINE_WHOLE
} from "@serene-pub/core-catalog"
import { INFLECTION_LABELS, render, type Cue } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { renderTemplate } from "$lib/server/pipelines/prompt/renderers"
import { poolKeyFor } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import type { SpeechControls } from "$lib/shared/connectionAdapters/speechFacts"
import {
	TAG_LAYOUT_SCOPE_KEY,
	escapeDeep,
	escapeForTemplate,
	layoutFromSlot,
	renderSpeechLayout,
	restoreAfterTemplate,
	speechFilters
} from "./jinja"

/** The speak node's pool key (unversioned). */
const SPEAK_POOL = poolKeyFor("core:oracle/speak")

/** Only the seed row's text (core-catalog `SPEAK_DIRECTION_SOURCE`) — used when no prompt row resolves. */
export const DEFAULT_DIRECTION = SPEAK_DIRECTION_SOURCE

export interface RenderSpokenGroupInput {
	/** `p.template` as the host gets it; null → the shipped Whole line. */
	template: unknown
	/**
	 * The session's `speechTemplate`. Wins only when the session set it explicitly
	 * (and it names a line template in speak's pool); null → the node's `template` slot.
	 */
	sessionTemplateId?: string | null
	cues: readonly Cue[]
	speaker: { ref: string; name?: string }
	voice: "speaker" | "narrator"
	controls: SpeechControls | null
	/** `p.variables` raw. */
	variables?: unknown
	/** Defaults to the app database; pass one in tests. */
	db?: Db
}

export interface RenderDirectionInput {
	/** `p.prompts` raw. */
	prompts: unknown
	inflection: string | null
	timbreDescription?: string | null
	controls: SpeechControls | null
	variables?: unknown
}

interface TemplateValue {
	source: string
	engine: string
}

const ENGINE = SPOKEN_LINE_WHOLE.engine

/** The slot's raw value as a template; a bare string is jinja2 source. */
function templateOf(raw: unknown): TemplateValue | null {
	if (typeof raw === "string") return raw.trim() ? { source: raw, engine: ENGINE } : null
	if (raw && typeof raw === "object") {
		const v = raw as { source?: unknown; engine?: unknown }
		if (typeof v.source === "string" && v.source.trim())
			return { source: v.source, engine: typeof v.engine === "string" ? v.engine : ENGINE }
	}
	return null
}

/**
 * The line template the session's setting names, else null. A shipped id
 * answers from the catalogue (no database); any other id is a row in speak's
 * pool carrying that template id (a package's).
 */
async function sessionTemplate(id: string | null | undefined, db?: Db): Promise<TemplateValue | null> {
	if (!id) return null
	const shipped = SHIPPED_SPOKEN_LINE_TEMPLATES.find((t) => t.templateId === id)
	if (shipped) return { source: shipped.source, engine: shipped.engine }
	try {
		let handle = db
		if (!handle) {
			const m = await import("$lib/server/db")
			await m.dbReady
			handle = m.db as Db
		}
		const [row] = await handle
			.select()
			.from(schema.pipelineContextTemplates)
			.where(
				and(
					eq(schema.pipelineContextTemplates.templateId, id),
					eq(schema.pipelineContextTemplates.nodeDefinitionId, SPEAK_POOL),
					isNull(schema.pipelineContextTemplates.withdrawnAt)
				)
			)
			.limit(1)
		return row?.source ? { source: row.source, engine: row.engine } : null
	} catch {
		return null
	}
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim()

/** One group of cues → the text of one call: trimmed, whitespace runs collapsed, tags inline. */
export async function renderSpokenGroup(i: RenderSpokenGroupInput): Promise<string> {
	const template =
		(await sessionTemplate(i.sessionTemplateId, i.db)) ??
		templateOf(i.template) ?? { source: SPOKEN_LINE_WHOLE.source, engine: SPOKEN_LINE_WHOLE.engine }
	const scope: Record<string, unknown> = {
		cues: escapeDeep([...i.cues]),
		speaker: escapeDeep({ ref: i.speaker.ref, ...(i.speaker.name ? { name: i.speaker.name } : {}) }),
		voice: i.voice,
		controls: i.controls,
		[TAG_LAYOUT_SCOPE_KEY]: layoutFromSlot(i.variables, INFLECTION_TAG_LAYOUT)
	}
	const out = await renderTemplate(template.engine, { template: template.source, variables: scope })
	return collapse(restoreAfterTemplate(out))
}

/** The standard labels: the sentence layout speaks for these (an empty sentence is deliberate, as `neutral`'s). */
const STANDARD_LABELS: ReadonlySet<string> = new Set(INFLECTION_LABELS)

/**
 * 🚧 A label outside the standard set — *Say it as…*'s own words
 * (`message-line@1`, speech ★1) — is directed as written: the sentence layout
 * has no row for it, so without this the person's words would vanish from the
 * direction. A standard label is the layout's alone.
 */
export function freeDirectionOf(label: string): string {
	const words = label.trim().replace(/[.!?…\s]+$/u, "")
	return words && !STANDARD_LABELS.has(words.toLowerCase()) ? `Speak it this way: ${words}.` : ""
}

/**
 * The written direction, or undefined: the model takes none
 * (`controls.instruction !== 'prose'`), or it rendered to nothing.
 */
export async function renderDirection(i: RenderDirectionInput): Promise<string | undefined> {
	if (i.controls?.instruction !== "prose") return undefined
	const prompts = i.prompts && typeof i.prompts === "object" ? (i.prompts as { direction?: unknown }) : null
	const source =
		typeof prompts?.direction === "string" && prompts.direction.trim()
			? prompts.direction
			: typeof i.prompts === "string" && i.prompts.trim()
				? i.prompts
				: DEFAULT_DIRECTION
	const label = i.inflection?.trim() ?? ""
	const laidOut = label
		? renderSpeechLayout(
				layoutFromSlot(i.variables, INFLECTION_SENTENCE_LAYOUT),
				INFLECTION_SENTENCE_LAYOUT,
				{ label }
			).trim()
		: ""
	const sentence = laidOut || freeDirectionOf(label)
	const timbre = escapeForTemplate(i.timbreDescription?.trim() ?? "")
	const out = render(
		source,
		{
			inflectionSentence: escapeForTemplate(sentence),
			inflection: escapeForTemplate(label),
			timbreDescription: timbre,
			timbre
		},
		{ filters: speechFilters() }
	)
	return collapse(restoreAfterTemplate(out)) || undefined
}
