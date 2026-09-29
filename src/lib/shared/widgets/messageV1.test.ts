/**
 * The host's end of the widget contract (F1): what the session page posts as
 * `messages.v1` is `session.sessionMessages` — `SelectSessionMessage` rows as
 * they arrive over the socket (JSON: timestamps as strings) — and `actions.v1`
 * is the `sessions:actions` listing. Both must BE the SDK's public types with
 * no cast, or a plugin compiled against the SDK is promised shapes the host
 * does not send. Compiled by `tsc` (the type-level half — an assignment below
 * stops compiling if the two drift) and run by vitest (the runtime half: a
 * row serialised as the socket does reads as the types say).
 *
 * The SDK holds the mirror: `sdk-tests/messageRowContract.test.ts`.
 */
import { describe, expect, test } from "vitest"
import {
	MESSAGE_HOST_FIELDS,
	projectMessageRow,
	type MessageHostField,
	isStatusText,
	renderStatusText,
	type MessageV1,
	type WidgetAction
} from "@serene-pub/sdk"

/** A value as it arrives over JSON: a `Date` becomes its ISO string. */
type OverTheWire<T> = T extends Date
	? string
	: T extends (infer U)[]
		? OverTheWire<U>[]
		: T extends object
			? { [K in keyof T]: OverTheWire<T[K]> }
			: T

/** A full row — every column, the enrichment included — as the server holds it. */
const stored: SelectSessionMessage = {
	id: 41,
	sessionId: 7,
	userId: 2,
	characterId: 3,
	personaId: null,
	role: "assistant",
	channel: "main",
	isNarratorResponse: false,
	content: "The door creaks open.",
	createdAt: "2026-09-25",
	updatedAt: new Date("2026-09-25T18:04:11.201Z"),
	isEdited: false,
	metadata: {
		swipes: {
			currentIdx: 1,
			history: ["The door is locked.", "The door creaks open."],
			thinkingHistory: [null, "They asked twice."]
		},
		thinking: "They asked twice.",
		answersForm: { messageId: 39, blockId: "q1" }
	},
	isGenerating: true,
	generationStage: null,
	generationStatus: {
		i18n: { en: "{speaker} is typing" },
		vars: { speaker: "Bell" }
	},
	generationOutcome: null,
	error: {
		message: "The model stopped answering.",
		connection: { id: 4, name: null, model: null, type: "koboldcpp" }
	},
	queueItemId: null,
	isHidden: false,
	debugMeta: null,
	embedding: [0.0125, -0.33, 0.9],
	embeddingModel: "all-MiniLM-L6-v2",
	vectorizedAt: new Date("2026-09-25T18:04:12.000Z"),
	parts: [
		{
			id: 90,
			messageId: 41,
			step: 0,
			revision: 1,
			ordinal: 0,
			type: "core:markdown",
			content: "The door creaks open.",
			data: null
		}
	],
	activeRevisions: { "0": 1 },
	kind: "core:reply",
	speakerLabel: "Bell",
	extras: {},
	version: null
}

describe("messages.v1 is the host's own rows", () => {
	test("a SelectSessionMessage, as the socket delivers it, is a MessageV1 — no cast", () => {
		const wire: OverTheWire<SelectSessionMessage> = JSON.parse(
			JSON.stringify(stored)
		)
		const m: MessageV1 = wire
		expect(isStatusText(m.generationStatus)).toBe(true)
		expect(renderStatusText(m.generationStatus!)).toBe("Bell is typing")
		expect(m.activeRevisions).toEqual({ "0": 1 })
		expect(m.metadata?.swipes?.currentIdx).toBe(1)
		expect(m.error?.connection?.name).toBeNull()
		expect(typeof m.updatedAt).toBe("string")
		expect(m.parts?.[0]?.type).toBe("core:markdown")
	})

	test("the SDK's host fields are this row's columns, and none survives the projection", () => {
		// Type-level: a name on the SDK's list that is not a column here is a
		// strip that strips nothing — this stops compiling.
		const columns: readonly (keyof SelectSessionMessage)[] = MESSAGE_HOST_FIELDS satisfies readonly MessageHostField[]
		expect(columns.length).toBeGreaterThan(0)
		const posted = projectMessageRow(JSON.parse(JSON.stringify(stored)) as OverTheWire<SelectSessionMessage>)
		for (const field of MESSAGE_HOST_FIELDS) expect(posted, field).not.toHaveProperty(field)
		const m: MessageV1 = posted
		expect(m.content).toBe(stored.content)
	})
})

describe("actions.v1 is the sessions:actions listing", () => {
	test("a listed action (with its enabled-when verdict) is a WidgetAction — no cast", () => {
		const listed: Sockets.Sessions.Actions.Action = {
			key: "summarize",
			specSlug: "acme-tools",
			name: "Summarize",
			slash: "summarize",
			quick: false,
			audience: { see: ["participant"], act: ["owner"] },
			venue: "message",
			origin: "companion",
			floor: false,
			canAct: true,
			itemGated: false,
			isNew: true,
			enabled: false,
			reason: { i18n: { en: "Not yet" } },
			itemPredicates: [
				{ on: "item.hidden", equals: false, reason: { en: "Unhide it first" } }
			]
		}
		const a: WidgetAction = listed
		expect(a.enabled).toBe(false)
		expect(renderStatusText(a.reason!)).toBe("Not yet")
	})
})
