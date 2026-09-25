/**
 * C30's parity half (§3.5), run by the app: core's messages widget mounted
 * natively and as a remote built from the same source, over the same
 * sections, judged by the conformance kit's one case — the same rows, a
 * streamed reply followed the same way, an edit reaching the host as the
 * same `edit` verb.
 */
import { describe, expect, test } from "vitest"
import { resolve } from "node:path"
import { mountComponent } from "@serene-pub/cli/testing"
import { componentParityCase } from "@serene-pub/conformance"
import type { ConversationDossierV1 } from "$lib/shared/widgets/conversation"
import { registerHostElements } from "$lib/client/components/hostElements/registry"
import { mountNativeMessagesWidget } from "./nativeView.svelte"

const APP = resolve(import.meta.dirname, "../../../../../..")

const row = (id: number, role: string, content: string) => ({
	id,
	role,
	content,
	channel: "main",
	createdAt: "2026-09-24T10:00:00Z"
})
const line = (name: string) => ({
	controllable: true,
	speaker: { name, ref: null, face: null, sprite: null },
	swipes: { show: false, right: false },
	embedding: "hidden" as const
})
const dossier: ConversationDossierV1 = {
	sessionId: 1,
	lines: { 1: line("You"), 2: line("Mira"), 3: line("Mira") },
	scenes: [],
	scened: [],
	hasOlder: false,
	loadingOlder: false,
	isOwner: true,
	cast: { sessionPersonas: [], sessionCharacters: [] },
	writes: { scenes: true, lore: true },
	debugPrompts: false,
	selectForSummary: 0,
	summaryEnded: 0,
	composer: {
		draft: "",
		personas: [{ personaId: 9, name: "You" }],
		personaId: 9,
		addPersona: false,
		hidden: false,
		channels: ["main"],
		usage: null,
		tabs: [],
		actions: false,
		notice: false,
		overflow: [],
		palette: [],
		newest: null,
		sendTonal: false
	},
	turn: { order: [], candidates: [], show: false, canChoose: false },
	readOnly: null,
	state: { ledgers: {}, pending: {}, waiting: [] },
	backdrop: false
}
const edit = {
	key: "edit",
	specSlug: "core",
	name: "Edit",
	icon: "pencil",
	slash: "edit",
	audience: { see: ["participant"], act: ["item"] },
	venue: "message",
	origin: "core",
	canAct: true,
	itemGated: true,
	isNew: false,
	enabled: true,
	quick: true
}
const sections = {
	session: { id: 1, name: "Parity" },
	messages: [row(1, "user", "Hello there"), row(2, "assistant", "Hi!")],
	settings: {},
	actions: { message: { primary: [edit], overflow: [] } },
	viewer: { userId: 1, isAdmin: false, isGuest: false },
	scoped: { session_full: dossier }
}

describe("core's messages widget: native and remote are one widget (C30)", () => {
	test("the same rows, the same stream, the same edit", { timeout: 120_000 }, async () => {
		registerHostElements()
		const native = await mountNativeMessagesWidget(sections)
		const remote = await mountComponent({
			root: APP,
			alias: { $lib: resolve(APP, "src/lib") },
			entry: "src/lib/client/components/sessionMessages/remote/messages-widget.ts",
			timeoutMs: 60_000,
			context: sections as never
		})
		try {
			await componentParityCase(native, remote)
			expect(remote.refused).toEqual([])
		} finally {
			await native.unmount()
			await remote.unmount()
		}
	})
})
