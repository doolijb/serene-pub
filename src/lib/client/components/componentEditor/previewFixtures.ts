/**
 * What the editor's preview feeds a component (C6, P6): a made-up session
 * with a short log, a cast, their stats and a little lore — the SDK
 * ui-preview harness's fixtures idea (`ui-preview/src/lib/fixtures.ts`),
 * grown to the scoped sections core's widgets read.
 *
 * Nothing here touches a real session. A request the component makes is
 * answered from these fixtures (`messages`, `session-entries`) or stubbed —
 * resolved without doing anything, and logged for the pane — so pressing a
 * button in a preview never writes, sends or opens anything.
 */
import type {
	SessionCharactersV1,
	SessionEntryV1,
	SessionStateV1,
	SessionV1,
	WidgetRequestKind,
	WidgetScopedSectionValues
} from "@serene-pub/sdk"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

export const PREVIEW_SESSION: SessionV1 = { id: 1, name: "The Sunken Vault" }

const line = (id: number, role: string, speakerLabel: string, content: string, characterId: number | null = null) => ({
	id,
	sessionId: 1,
	channel: "main",
	kind: "core:chat",
	role,
	speakerLabel,
	characterId,
	status: "settled",
	content,
	createdAt: `2026-08-28T12:0${id}:00.000Z`
})

export const PREVIEW_MESSAGES = [
	line(1, "user", "Wren", "We push the door open. What do we see?"),
	line(2, "assistant", "Narrator", "Cold air, and a stairwell going down further than the lantern reaches."),
	line(3, "assistant", "Mira", "I'll go first. Keep the light low.", 11),
	line(4, "user", "Wren", "Fine — but if the stairs give way, you're carrying me.")
]

const slot = (name: string, label: string, type: SessionStateV1["slots"][number]["type"]) => ({
	slotId: `core:slot/${name}@1`,
	key: name,
	qualifiedKey: `core.${name}`,
	label,
	type,
	appliesTo: ["cast" as const]
})

const SLOTS = [slot("hp", "Health", "integer"), slot("mood", "Mood", "enum"), slot("notes", "Notes", "text"), slot("armed", "Armed", "boolean")]
const CONFIGS = {
	"core:slot/hp@1": { min: 0, max: 20 },
	"core:slot/mood@1": { of: ["calm", "wary", "afraid"] },
	"core:slot/notes@1": {},
	"core:slot/armed@1": {}
}

export const PREVIEW_SESSION_STATE: SessionStateV1 = {
	sessionId: 1,
	loaded: true,
	error: null,
	slots: SLOTS,
	owners: [
		{ key: "world", kind: "session", id: 1, label: "World", configs: {} },
		{ key: "cast:11", kind: "session_cast", id: 11, label: "Mira", configs: CONFIGS },
		{ key: "cast:12", kind: "session_cast", id: 12, label: "Wren", configs: CONFIGS }
	],
	resolved: {
		world: {},
		cast: {
			"cast:11": { "core.hp": 14, "core.mood": "wary", "core.notes": "Carries the lantern", "core.armed": true },
			"cast:12": { "core.hp": 9, "core.mood": "afraid", "core.armed": false }
		},
		version: 1
	}
}

const member = (characterId: number, name: string, isPersona: boolean) => ({
	ref: `character:${characterId}` as const,
	characterId,
	isPersona,
	mine: isPersona,
	name,
	face: null,
	sprite: null,
	spriteSets: [],
	spriteSet: null,
	canChangeSpriteSet: false
})

export const PREVIEW_CHARACTERS: SessionCharactersV1 = {
	members: [member(11, "Mira", false), member(12, "Wren", true)],
	sceneImages: { left: null, right: null }
}

const entry = (id: number, title: string, keys: string[], pinned = false): SessionEntryV1 => ({
	id,
	typeId: "core:lore",
	title,
	keys,
	off: false,
	pinned,
	timesJudged: 3,
	timesIncluded: pinned ? 3 : 1,
	lastJudgedAt: "2026-08-28T12:04:00.000Z",
	lastIncluded: true,
	lastReason: pinned ? "pinned" : "matched a key",
	lastRank: id
})

export const PREVIEW_LORE: SessionEntryV1[] = [
	entry(1, "The Sunken Vault", ["vault", "stairwell"], true),
	entry(2, "Mira", ["mira"]),
	entry(3, "Lanterns of the deep", ["lantern"])
]

/** Every scoped section a preview posts. `persona`, `lore` and `session_full` are declared-but-not-pushed today. */
export const PREVIEW_SCOPED: Partial<WidgetScopedSectionValues> = {
	session_state: PREVIEW_SESSION_STATE,
	characters: PREVIEW_CHARACTERS
}

/** One request the preview answered or stubbed, for the pane. */
export interface PreviewRequestNote {
	kind: string
	answered: "fixture" | "stub"
	at: number
}

/**
 * The page's request handler for a preview: fixtures where there are some,
 * a stub (resolved, nothing done) for everything else. `note` hears each.
 */
export function previewRequestHandler(note: (n: PreviewRequestNote) => void): WidgetRequestHandler {
	const handler = async (kind: WidgetRequestKind, params: unknown) => {
		if (kind === "messages") {
			note({ kind, answered: "fixture", at: Date.now() })
			return { rows: PREVIEW_MESSAGES }
		}
		if (kind === "session-entries") {
			note({ kind, answered: "fixture", at: Date.now() })
			const p = (params ?? {}) as { titleOrKey?: string; offset?: number; limit?: number }
			const q = (p.titleOrKey ?? "").toLowerCase()
			const rows = PREVIEW_LORE.filter(
				(e) => !q || e.title.toLowerCase().includes(q) || e.keys.some((k) => k.includes(q))
			)
			const offset = Math.max(0, Math.min(p.offset ?? 0, rows.length))
			return {
				lorebookId: 1,
				bookName: "Preview lore",
				ownerOnly: false,
				rows: rows.slice(offset, offset + (p.limit ?? 50)),
				total: rows.length,
				offset
			}
		}
		if (kind === "authors-note" || kind === "set-authors-note") {
			// 🚧 The author's note (AN1): a preview's note, and a save that
			// answers with what was sent — nothing is stored.
			note({ kind, answered: "fixture", at: Date.now() })
			const sent = (params as { note?: unknown } | undefined)?.note
			return {
				offered: true,
				canEdit: true,
				note:
					kind === "set-authors-note" && sent
						? sent
						: { text: "The fog is lifting over the moor.", depth: 4, interval: 1, role: "system" },
				lastReply: { included: true, reason: "included", depth: 4, targetIndex: 6 }
			}
		}
		note({ kind, answered: "stub", at: Date.now() })
		return undefined
	}
	return handler as unknown as WidgetRequestHandler
}
