/** A line's `promptDetails` flag: an administrator's, with context debugging on and a recorded prompt (DG1). */
import { describe, expect, test } from "vitest"
import { projectConversationDossier } from "./sessionPageProjections"

function dossierFor(opts: { viewerId: number; isAdmin: boolean; isGuest: boolean }) {
	const src = {
		data: {
			session: {
				id: 1,
				name: "S",
				rewind: { ahead: 0, back: null, forward: null, regenerate: null },
				sessionMessages: [
					{
						id: 5,
						sessionId: 1,
						channel: "main",
						role: "assistant",
						content: "hello",
						metadata: null,
						isGenerating: false,
						updatedAt: "2026-11-16T00:00:00.000Z",
						debugMeta: { prompt: "P" }
					}
				],
				sessionCharacters: [],
				sessionPersonas: []
			},
			isGuest: opts.isGuest,
			sessionPlayerLabel: "",
			ownVoice: "You",
			pagination: { hasMore: false, olderIn: [] },
			userPersonasInSession: [],
			sessionChannels: ["main"],
			loadingOlderMessages: false,
			extendRefusal: null,
			currentUserPersona: undefined,
			ownCardlessSeat: null,
			showAddPersonaCTA: false,
			showTakeSeatCTA: false,
			composerHidden: false,
			modeMissing: false,
			getMessageCharacter: () => null,
			canControlMessage: () => true,
			canRerunMessage: () => true,
			personLine: () => undefined,
			offersWrite: () => false,
			rerunRefusals: undefined,
			annex: undefined,
			liveRunIds: [],
			runningRoutineNames: []
		},
		actions: {
			canRegenerateLastMessage: false,
			sessionActions: [],
			composerMenuActions: [],
			paletteActions: [],
			newestItem: null
		},
		turns: {
			turnOrder: null,
			shouldShowNextCharacterBlock: false,
			canChooseDifferentCharacter: false
		},
		controls: { showSwipeControls: () => false, canSwipeRight: () => false },
		composer: {
			draftCompiledPrompt: null,
			composerTray: { view: null, readers: [] }
		},
		scenes: {
			sceneList: [],
			capturedMessageIds: [],
			selectForSummary: false,
			summaryEnded: false
		},
		stateStore: {
			ledgerFor: () => [],
			pendingFor: () => [],
			ledgerHead: () => ({}),
			pending: []
		},
		remoteFaces: { face: (x: unknown) => x, landed: 0 },
		userCtx: { user: { id: opts.viewerId, isAdmin: opts.isAdmin } },
		systemSettingsCtx: { settings: { contextDebuggingEnabled: true } },
		userSettingsCtx: { settings: {} },
		composerDraft: () => ({}),
		snapshot: (x: unknown) => x
	} as never
	const d = projectConversationDossier(src, new Map()) as unknown as {
		lines: Record<string, { promptDetails?: boolean }>
	}
	return d.lines[5]?.promptDetails === true
}

describe("line promptDetails", () => {
	test("an owner who is not an administrator does not", () => {
		expect(dossierFor({ viewerId: 1, isAdmin: false, isGuest: false })).toBe(false)
	})
	test("an owner who is an administrator gets it", () => {
		expect(dossierFor({ viewerId: 1, isAdmin: true, isGuest: false })).toBe(true)
	})
	test("a guest does not", () => {
		expect(dossierFor({ viewerId: 2, isAdmin: false, isGuest: true })).toBe(false)
	})
	test("an administrator who is a guest gets it (D64)", () => {
		expect(dossierFor({ viewerId: 2, isAdmin: true, isGuest: true })).toBe(true)
	})
})
