/**
 * The one algorithm (20 §1/§5): a legacy `session_messages` row → the new
 * model's `{message, parts}`. Pure, total, and used by *both* the boot
 * migration and the store's runtime mirror — parity between the two worlds is
 * structural, not maintained.
 *
 * ## The legacy invariants this reads
 *
 * - `content === metadata.swipes.history[currentIdx]` whenever swipes exist,
 *   maintained by every legacy write path; `currentIdx: null` means 0.
 * - `metadata.thinking` mirrors `thinkingHistory[currentIdx]` (denormalized).
 * - `isNarratorResponse` marks a narration: role stays "assistant",
 *   characterId stays null, the display name sits in `metadata.narratorName`.
 *
 * ## Fixed ordinals
 *
 * Within a revision, parts land at fixed slots — instructions 0, thinking 1,
 * markdown 2 — rather than being packed. Gaps are legal (the address is
 * unique, not dense), and fixed slots make the projection deterministic and
 * idempotent: re-projecting a row always produces byte-identical parts.
 *
 * A revision carrying **folded sections** (B4; D5, 2026-09-27 —
 * `metadata.sections`, or `swipes.sectionsHistory[i]`, read through the SDK's
 * one `foldedSectionsOf`) lays them out after the instructions and shifts the
 * other two down: instructions 0, sections 1…k, thinking k+1, markdown k+2 —
 * a Plan reads above the reasoning and the reply. With no sections that is
 * exactly 0, 1, 2, so every row written before B4 projects byte-identically.
 * `MAX_FOLDED_SECTIONS` keeps the whole layout under the store's
 * `NATIVE_ORDINAL_BASE`.
 */

import { foldedSectionPart, foldedSectionsOf } from "@serene-pub/sdk"
import type { ConnectionIdentity } from "$lib/shared/connections/identity"
import type { messages, messageParts } from "$lib/server/db/schema"

/** What the projection reads — the legacy row, loosely typed on purpose. */
export interface LegacyMessageRow {
	id: number
	sessionId: number
	userId?: number | null
	characterId?: number | null
	personaId?: number | null
	role: string
	/** The lane this message is on (20 §7). Absent means `main`. */
	channel?: string | null
	isNarratorResponse?: boolean | null
	content: string
	createdAt?: unknown
	updatedAt?: Date | string | null
	isEdited?: boolean | null
	metadata?: {
		isGreeting?: boolean
		swipes?: {
			currentIdx: number | null
			history: string[]
			thinkingHistory?: (string | null)[]
			/** B4: each alternative's folded sections, parallel to `history`. */
			sectionsHistory?: unknown[]
		}
		thinking?: string | null
		/** B4: the row's folded sections while it has no alternatives. */
		sections?: unknown
		narratorInstructions?: string
		narratorName?: string
	} | null
	isGenerating?: boolean | null
	generationStage?: string | null
	/** Present means a node has reported what it is doing (R-19) — see below. */
	generationStatus?: unknown | null
	/**
	 * `connection` is connection identity, kept out of `message` on purpose —
	 * this projection is a READ path, re-run on every reload, and only a key can
	 * be removed on the way out. See `connections/visibility.ts`.
	 */
	error?: {
		message: string
		code?: string
		connection?: ConnectionIdentity
	} | null
	queueItemId?: string | null
	isHidden?: boolean | null
	debugMeta?: Record<string, any> | null
}

export type NewMessage = typeof messages.$inferInsert
export type NewPart = Omit<typeof messageParts.$inferInsert, "messageId">

export const ORDINAL_INSTRUCTIONS = 0
export const ORDINAL_THINKING = 1
export const ORDINAL_MARKDOWN = 2

export function projectLegacy(row: LegacyMessageRow): {
	message: NewMessage
	parts: NewPart[]
} {
	const meta = row.metadata ?? {}
	const swipes = meta.swipes
	const hasSwipes = !!swipes?.history?.length
	const revisions: string[] = hasSwipes
		? swipes!.history
		: [row.content ?? ""]
	const active = hasSwipes
		? Math.max(0, Math.min(swipes!.currentIdx ?? 0, revisions.length - 1))
		: 0

	const thinkingFor = (i: number): string | null => {
		const fromHistory = swipes?.thinkingHistory?.[i]
		if (typeof fromHistory === "string" && fromHistory) return fromHistory
		// A single-revision message stores its thinking only in the
		// denormalized field; it belongs to the active (only) revision.
		if (!hasSwipes && i === 0 && meta.thinking) return meta.thinking
		return null
	}

	const parts: NewPart[] = []
	for (let i = 0; i < revisions.length; i++) {
		// Message-level in the legacy model, shown whatever the swipe — so it
		// rides every revision. Small text, deterministic, honest.
		if (meta.narratorInstructions)
			parts.push({
				step: 0,
				revision: i,
				ordinal: ORDINAL_INSTRUCTIONS,
				type: "core:section",
				content: meta.narratorInstructions,
				data: { title: "Instructions" }
			})
		// Folded sections (B4): the slots after the instructions, pushing
		// thinking and the body down by as many as there are.
		const sections = foldedSectionsOf(meta, i)
		sections.forEach((section, k) => {
			const part = foldedSectionPart(section)
			parts.push({
				step: 0,
				revision: i,
				ordinal: ORDINAL_THINKING + k,
				type: part.type,
				content: part.content,
				data: { ...part.data }
			})
		})
		const shift = sections.length
		const thinking = thinkingFor(i)
		if (thinking)
			parts.push({
				step: 0,
				revision: i,
				ordinal: ORDINAL_THINKING + shift,
				type: "core:thinking",
				content: thinking,
				data: null
			})
		parts.push({
			step: 0,
			revision: i,
			ordinal: ORDINAL_MARKDOWN + shift,
			type: "core:markdown",
			content: revisions[i] ?? "",
			data: null
		})
	}

	const extras: Record<string, unknown> = {}
	if (meta.isGreeting) extras.core = { isGreeting: true }

	// `generationStatus` (R-19) is the live signal — a node has said what it
	// is doing, so the row IS generating, whatever the retired `generationStage`
	// enum still holds. `generationStage` is written by nothing any more (a
	// one-release fallback the client also reads); a row generating with
	// neither yet set — the moment before a node's first status — reads as
	// the honest default, "generating".
	const status = row.generationStatus
		? "generating"
		: row.isGenerating
			? (row.generationStage ?? "generating")
			: row.error
				? "error"
				: "settled"

	const updatedAt =
		row.updatedAt instanceof Date
			? row.updatedAt
			: row.updatedAt
				? new Date(row.updatedAt)
				: new Date()

	return {
		message: {
			id: row.id,
			sessionId: row.sessionId,
			// Carried, not assumed. This was hardcoded `"main"` for as long as
			// the legacy row had no channel to carry (0200), which made the
			// mirror the only place a lane could live and the store's own
			// "the legacy row leads" rule untrue of exactly one field.
			channel: row.channel || "main",
			kind: row.isNarratorResponse ? "core:narration" : "core:chat",
			// Ruled 2026-08-26: nullable, no DB default, every creating code
			// path writes "1.0" — migration included.
			version: "1.0",
			userId: row.userId ?? null,
			characterId: row.characterId ?? null,
			personaId: row.personaId ?? null,
			speakerLabel: meta.narratorName ?? null,
			role: row.role,
			status,
			error: row.error ?? null,
			activeRevisions: { "0": active },
			extras,
			isHidden: !!row.isHidden,
			isEdited: !!row.isEdited,
			debugMeta: row.debugMeta ?? null,
			queueItemId: row.queueItemId ?? null,
			// The legacy created_at is day-precision; updated_at is the best
			// truthful timestamp available (20 §5).
			createdAt: updatedAt,
			updatedAt
		},
		parts
	}
}
