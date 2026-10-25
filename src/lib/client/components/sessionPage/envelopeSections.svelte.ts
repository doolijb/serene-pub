/**
 * The session page's sections of the widget envelope, each a `{ current }`
 * reader the page sets as a context: who is looking (`viewer.v1`), the turn
 * order (`turnOrder.v1`), who of the session's people has it open
 * (`attendance.v1`), the viewer's language (`locale.v1`) and annex view
 * (`annex.v1`), the session dossier (`session_full.v1`), the session state
 * (`session_state.v1`) and the cast (`characters.v1`). Each is computed only
 * while a widget reads it.
 */
import { createRemoteFaces } from "$lib/client/components/sessionPage/remoteFace"
import { projectSessionState } from "$lib/client/components/sessionPage/projections/sessionState"
import { charactersSection } from "$lib/client/components/sessionPage/projections/charactersSection.svelte"
import {
	personaOwnersOf,
	projectAttendance
} from "$lib/client/components/sessionPage/projections/attendance"
import {
	projectConversationDossier,
	type DossierLineCache
} from "$lib/client/components/sessionPage/sessionPageProjections"
import type { ConversationDossierV1 } from "$lib/shared/widgets/conversation"
import type { AttendanceV1, TurnOrderV1, ViewerV1 } from "@serene-pub/sdk"
import type { SessionStateHandle } from "$lib/client/state/sessionState.svelte"
import type { ScenePins } from "$lib/client/components/sessionPage/scenePins.svelte"
import type { DraftWrite } from "$lib/client/components/sessionPage/collects"
import type { SessionPageData } from "$lib/client/components/sessionPage/sessionPageData.svelte"
import type { ActionList } from "$lib/client/components/sessionPage/actionList.svelte"
import type { TurnFlow } from "$lib/client/components/sessionPage/turnFlow.svelte"
import type { MessageControls } from "$lib/client/components/sessionPage/messageControls.svelte"
import type { ComposerFlow } from "$lib/client/components/sessionPage/composerFlow.svelte"
import type { ScenesFlow } from "$lib/client/components/sessionPage/scenesFlow.svelte"

export interface EnvelopeSectionsDeps {
	/** The session in the route. */
	sessionId(): number
	data: SessionPageData
	actions: ActionList
	turns: TurnFlow
	controls: MessageControls
	composer: ComposerFlow
	scenes: ScenesFlow
	/** 🚧 The session's scene cues (live scenes §4): the conversation's *New scene?* chips. */
	sceneCues?: {
		readonly cues: readonly Sockets.Scenes.SceneCue[]
		readonly settings?: { readonly summary: "onClose" | "onRequest" | "never" }
	}
	stateStore: SessionStateHandle
	scenePins: ScenePins
	userCtx: UserCtx
	systemSettingsCtx: SystemSettingsCtx
	userSettingsCtx: UserSettingsCtx
	/** The page's last write to core's composer draft (C0b, D1). */
	composerDraft(): DraftWrite
}

/** The page's envelope sections. Call during the page's init. */
export function createEnvelopeSections(d: EnvelopeSectionsDeps) {
	const userCtx = d.userCtx
	const stateStore = d.stateStore
	const scenePins = d.scenePins
	const sessionId = $derived(d.sessionId())
	const session = $derived(d.data.session)

	/**
	 * The faces core's box takes (C7, `remoteFace.ts`): the app's media,
	 * `https:` and raster data pass; an envoy's SVG is drawn to a WebP here
	 * first (none until it lands); `http:` is none.
	 */
	const remoteFaces = createRemoteFaces()
	/** Each line's facts, and what they were built from (a plain map: a cache, not state). */
	const lineCache: DossierLineCache = new Map()
	/** What core's conversation widget is told about this session (C0b, `projectConversationDossier`). */
	const conversationDossier: ConversationDossierV1 | null = $derived(
		projectConversationDossier(
			{
				data: d.data,
				actions: d.actions,
				turns: d.turns,
				controls: d.controls,
				composer: d.composer,
				scenes: d.scenes,
				sceneCues: d.sceneCues,
				stateStore,
				remoteFaces,
				userCtx,
				systemSettingsCtx: d.systemSettingsCtx,
				userSettingsCtx: d.userSettingsCtx,
				composerDraft: () => d.composerDraft(),
				snapshot: (value) => $state.snapshot(value) as typeof value
			},
			lineCache
		)
	)

	/**
	 * 🚧 `session_state.v1` (R72) for any widget granted `session:state` —
	 * core's state widgets, or a plugin's an admin granted
	 * `widget:session:state`: the store's one resolved read, projected once
	 * and read by every panel holding the grant. Lazy — computed only while
	 * some granted widget reads it.
	 */
	const sessionStateSection = $derived(
		sessionId == null
			? undefined
			: projectSessionState(
					{
						sessionId: stateStore.sessionId,
						loaded: stateStore.loaded,
						readError: stateStore.readError,
						state: stateStore.state,
						slots: stateStore.slots.values(),
						owners: stateStore.owners.values(),
						// 🚧 Offers (Give to…, ★4) ride the held changes.
						proposals: stateStore.proposals,
						viewerUserId: userCtx.user?.id ?? null,
						wordsOnly: stateStore.wordsOnly,
						metPeople: stateStore.metPeople,
						storyTime: stateStore.storyTime
					},
					sessionId
				)
	)
	/**
	 * 🚧 `characters.v1` (R76) for any widget granted `characters` — core's
	 * scene portraits, or a plugin's an admin granted `widget:characters`:
	 * the cast, cast over card, with the page's own scene-image pins riding
	 * along. Lazy, like the state section; never another session's cast
	 * while the payload still lags the address; untouched by a streamed
	 * chunk that moves no current sprite (`charactersSection.svelte.ts`).
	 */
	const sessionCharactersSection = charactersSection({
		sessionId: () => sessionId,
		session: () => session,
		viewerUserId: () => userCtx.user?.id ?? null,
		voicedPersonaId: () => d.data.currentUserPersona?.personaId,
		sceneImages: () => ({ left: scenePins.left, right: scenePins.right })
	})

	/**
	 * Who writes as whom, as a string: a streamed chunk replaces the session
	 * and moves no persona, so the section below is not rebuilt per token.
	 */
	const personaOwners = $derived(personaOwnersOf(session))
	/**
	 * `attendance.v1` (W10): the server's last word on who has the session
	 * open, with the personas each writes as and who is typing. Lazy — built
	 * only while a widget reads it.
	 */
	const attendanceSection: AttendanceV1 = $derived(
		projectAttendance({
			sessionId,
			pushed: d.data.attendance,
			personaOwners,
			typingPersonaIds: d.data.typingPersonas.keys()
		})
	)

	return {
		/** Who is looking (`viewer.v1`, C0b) — so a widget asks "may I" of the host's answer instead of comparing user ids itself. */
		viewer: {
			get current(): ViewerV1 {
				return {
					userId: userCtx.user?.id ?? null,
					isAdmin: !!userCtx.user?.isAdmin,
					isGuest: d.data.isGuest
				}
			}
		},
		/** The session's turn order (`turnOrder.v1`, C5), for every widget on the page. */
		turnOrder: {
			get current(): TurnOrderV1 {
				return d.turns.turnOrderDoc
			}
		},
		/** Who of the session's people has it open (`attendance.v1`, W10), for every widget that reads it. */
		attendance: {
			get current(): AttendanceV1 {
				return attendanceSection
			}
		},
		/** The viewer's language, off `sessions:view` — every widget's `locale.v1`. */
		locale: {
			get current() {
				return d.data.sessionFrames?.language ?? "en"
			}
		},
		/**
		 * What this viewer may see of the session annex (R57): the server's
		 * merged view, never the annex — every widget's `annex.v1`, so no
		 * layout has to thread it.
		 */
		annex: {
			get current() {
				return d.data.annex
			}
		},
		/**
		 * The dossier core's conversation is told (C0b); any widget granted
		 * `session:full` reads the same one (C5): a plugin's, when an admin
		 * granted its `widget:session:full`.
		 */
		dossier: {
			get current() {
				return conversationDossier
			}
		},
		state: {
			get current() {
				return sessionStateSection
			}
		},
		characters: sessionCharactersSection
	}
}

/** The session page's envelope sections (`createEnvelopeSections`). */
export type EnvelopeSections = ReturnType<typeof createEnvelopeSections>
