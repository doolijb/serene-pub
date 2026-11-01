/**
 * 🚧 **One message as a line to speak** (`core:query/message-line@1`, speech
 * lane D follow-up ★1, 2026-10-28): the stored row's words, whose line it is
 * and the inflection it was recorded with — what *Read aloud* and *Say it as…*
 * (`core:spec/speak-message`) hand `cue-lines@1`.
 *
 * The host's read (`message_line`, `runtime/host.ts`) calls `messageLineFor`;
 * the binding below shapes the ports and applies `say`.
 */
import type { Bindings, Inflection } from "@serene-pub/sdk"
import { INFLECTION_LABELS, ok, reads } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { speakerRefOf } from "$lib/server/messages/sessionChanges"
import type { CoreQueryCtx, NodeInput } from "$lib/server/pipelines/runtime/bindingTypes"
import { markerInflection } from "./markers"

/** What the host read answers: the row as a line, or null when there is none to speak. */
export interface StoredMessageLine {
	text: string
	/** `envoy:<slug>` / `character:<id>`; null = narration or a person with no persona. */
	speakerRef: string | null
	/** The label of the sprite shown on the active swipe; null when none was shown. */
	spriteLabel: string | null
}

/**
 * The row by id — this session's only; hidden or still being written reads
 * as null (the history read's rule: such a row is not a stored line).
 */
export async function messageLineFor(
	db: Db,
	sessionId: number,
	messageId: number
): Promise<StoredMessageLine | null> {
	const [row] = await db
		.select({
			content: schema.sessionMessages.content,
			characterId: schema.sessionMessages.characterId,
			personaId: schema.sessionMessages.personaId,
			isNarratorResponse: schema.sessionMessages.isNarratorResponse,
			metadata: schema.sessionMessages.metadata
		})
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.id, messageId),
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.isHidden, false),
				eq(schema.sessionMessages.isGenerating, false)
			)
		)
		.limit(1)
	if (!row) return null
	const meta = (row.metadata ?? {}) as { speaker?: unknown; sprite?: { label?: unknown } | null }
	// An envoy's row says who voiced it by reference; a character's or a
	// persona's by id (`speakerRefOf`, the deleted-message record's reading).
	const envoy =
		typeof meta.speaker === "string" && meta.speaker.startsWith("envoy:") ? meta.speaker : null
	const label = typeof meta.sprite?.label === "string" ? meta.sprite.label.trim() : ""
	return {
		text: typeof row.content === "string" ? row.content : "",
		speakerRef: envoy ?? speakerRefOf(row),
		spriteLabel: label || null
	}
}

/** The longest *Say it as…* text kept: a direction, not a paragraph. */
export const SAY_AS_MAX_CHARS = 120

/**
 * *Say it as…*'s words as an inflection: a word the marker table knows
 * (`sighs`, `angrily`) or a label name (`joy`) is that label; anything else is
 * kept as written (whitespace collapsed, capped) — a prose-taking model reads
 * it as direction, a tag-taking model finds no tag for it and drops it.
 * Blank → null.
 */
export function sayAsInflection(say: unknown): Inflection | null {
	if (typeof say !== "string") return null
	const words = say.replace(/\s+/g, " ").trim().slice(0, SAY_AS_MAX_CHARS).trim()
	if (!words) return null
	const lower = words.toLowerCase()
	const known =
		(INFLECTION_LABELS as readonly string[]).find((l) => l === lower) ?? markerInflection(words)
	return { label: known ?? words }
}

export function messageLineBindings(): Bindings {
	return {
		/**
		 * The row as a line (★1): words, speaker, inflection. No row (hidden,
		 * still written, another session's) → `text` empty and the other two
		 * absent, so the spec's junction speaks nothing. `say` wins over the
		 * recorded sprite label.
		 */
		"core:query/message-line@1": reads<typeof C.messageLine>(
			async (input: NodeInput<typeof C.messageLine>, ctx: CoreQueryCtx) => {
				const messageId = typeof input?.messageId === "number" ? input.messageId : null
				const line =
					messageId === null
						? null
						: ((await ctx.read("message_line", {
								sessionId: input?.scope?.sessionId,
								messageId
							})) as StoredMessageLine | null)
				const text = line?.text ?? ""
				if (!line || !text.trim()) return ok({ main: "", text: "" })
				const inflection =
					sayAsInflection(input?.say) ??
					(line.spriteLabel ? ({ label: line.spriteLabel } satisfies Inflection) : null)
				return ok({
					main: text,
					text,
					...(line.speakerRef ? { speaker: line.speakerRef } : {}),
					...(inflection ? { inflection } : {})
				})
			},
			{ ports: ["scope", "messageId", "say"] }
		)
	}
}
