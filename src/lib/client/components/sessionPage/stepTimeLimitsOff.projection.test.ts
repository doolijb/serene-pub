/** The dossier's `stepTimeLimitsOff`: set for an administrator while the pub's switch is on, absent otherwise. */
import { describe, expect, test } from "vitest"
import { projectConversationDossier } from "./sessionPageProjections"

function dossierFor(isAdmin: boolean, stepTimeLimitsOff: boolean) {
	const src = {
		data: {
			session: {
				id: 1,
				name: "S",
				rewind: { ahead: 0, back: null, forward: null, regenerate: null },
				sessionMessages: [],
				sessionCharacters: [],
				sessionPersonas: []
			},
			isGuest: false,
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
		userCtx: { user: { id: 1, isAdmin } },
		systemSettingsCtx: { settings: { stepTimeLimitsOff } },
		userSettingsCtx: { settings: {} },
		composerDraft: () => ({}),
		snapshot: (x: unknown) => x
	} as never
	return projectConversationDossier(src, new Map()) as unknown as Record<string, unknown>
}

describe("dossier stepTimeLimitsOff", () => {
	test("an administrator with the switch on gets it", () => {
		expect(dossierFor(true, true).stepTimeLimitsOff).toBe(true)
	})
	test("an administrator with it off has no such key", () => {
		expect("stepTimeLimitsOff" in dossierFor(true, false)).toBe(false)
	})
	test("a member with it on has no such key", () => {
		expect("stepTimeLimitsOff" in dossierFor(false, true)).toBe(false)
	})
})
