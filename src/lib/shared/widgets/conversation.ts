/**
 * 🚧 The conversation **dossier**: what core's conversation widget is told
 * about its session, beyond the
 * envelope's base sections (C0b) — the `session_full.v1` its host projects,
 * core's own widget being granted `session:full`.
 *
 * The page answers here what only the page can: who the viewer controls, who
 * spoke each line and with what face, where scenes and history entries fall,
 * whether older messages remain. The widget judges nothing it is not told,
 * and acts only through its verbs (`invoke`, `request`) — so the same widget
 * runs as a remote in the page's UI worker, where there is no page to ask.
 *
 * Provisional: a plugin is granted none of this, and its shape settles with
 * the C7 cutover.
 */

/** A participant as a line names them: display name, reference, face. */
export interface ConversationSpeakerV1 {
	name: string
	/** `character:3` — what `sp-avatar` and `view-avatar` take; null for narration. */
	ref: string | null
	/** The speaker's avatar. */
	face: string | null
	/** The sprite this line was shown with — what `avatarFace: sprite` draws instead. */
	sprite: string | null
}

/** What the page decided about one message. */
export interface ConversationLineV1 {
	/** The viewer may press this line's own verbs (edit, hide, delete). */
	controllable: boolean
	speaker: ConversationSpeakerV1
	/** Swipe arrows: shown at all, and whether there is a newer reply to take. */
	swipes: { show: boolean; right: boolean }
	/** The line's vectors against the active embedding model (hidden when retrieval is off). */
	embedding: "current" | "stale" | "none" | "hidden"
}

/** A scene over some of the log, with the history entry it sits in. */
export interface ConversationSceneV1 {
	id: number
	name: string | null
	lorebookId: number
	historyEntryId: number | null
	selectedMessageIds: number[]
	historyEntry: {
		id: number
		year: number
		month: number | null
		day: number | null
		isCompleted: boolean
		nextEntry: { id: number; year: number; month: number | null; day: number | null } | null
	} | null
}

/** The cast, as far as answering a form needs it (`canAnswerForm`). */
export interface ConversationCastV1 {
	sessionPersonas: Array<{ personaId: number | null; persona: { userId: number | null } | null }>
	sessionCharacters: Array<{ characterId: number | null }>
}

export interface ConversationDossierV1 {
	sessionId: number
	/** Per message, by id. */
	lines: Record<number, ConversationLineV1>
	scenes: ConversationSceneV1[]
	/** Messages already captured in a scene (not selectable for another). */
	scened: number[]
	/** Older messages remain to load, and a load is under way. */
	hasOlder: boolean
	loadingOlder: boolean
	/** Why Continue is unavailable in this session, when it is. */
	continueRefusal?: string
	/** The viewer owns the session (not a guest) — a form to the owner is theirs. */
	isOwner: boolean
	cast: ConversationCastV1
	/** What the session may write beyond messages (R-B): a scene, lore. */
	writes: { scenes: boolean; lore: boolean }
	/** Admins with context debugging on may open a line's prompt. */
	debugPrompts: boolean
	/**
	 * Bumped when a host view (the workflow tab) asks the conversation to
	 * start selecting lines for a summary — the widget starts on a change.
	 */
	selectForSummary: number
	/** Bumped when the host's summary finished: the selection it was handed ends. */
	summaryEnded: number
	/** What the composer is told. */
	composer: ConversationComposerV1
	/** Who is due next, from the session's stored turn order. */
	turn: {
		order: Array<{ ref: string | null; [k: string]: unknown }>
		candidates: Array<{ ref: string; kind: string; name: string; nickname?: string; ownerUserId?: number }>
		/** The nudge applies now (a turn is due, nothing is generating or drafted). */
		show: boolean
		/** Anyone else could take the turn. */
		canChoose: boolean
	}
	/** The session's mode is not installed: the log is read-only (19 §6). */
	readOnly: { genreId: string | null } | null
	/** The session state's ledger under each line, and what waits for the viewer. */
	state: ConversationStateV1
	/** A backdrop image is painted behind the shell: the conversation gets its glass panel. */
	backdrop: boolean
}

/** One proposed change, described. */
export interface ConversationProposalV1 {
	id: number
	status: string
	messageId: number | null
	/** The change, in words. */
	text: string
	proposedBy: string | null
	/** For a superseded proposal: what moved since. */
	moved: string | null
}

/** 🚧 The session state's ledger, as the conversation draws it (C0b). */
export interface ConversationStateV1 {
	/** Per message id: the changes it made, grouped by whose they are. */
	ledgers: Record<
		number,
		Array<{ ownerKey: string; ownerLabel: string; lines: Array<{ key: string; text: string; updatedBy: string }> }>
	>
	/** Per message id: proposals anchored to it. */
	pending: Record<number, ConversationProposalV1[]>
	/** Every proposal waiting for the viewer (the Review panel). */
	waiting: ConversationProposalV1[]
}

/** A tab of the composer's More panel: one of the host's own views. */
export interface ConversationTabV1 {
	view: string
	title: string
	icon: string
}

/** 🚧 What core's composer is told (C0b): the page's half of writing a line. */
export interface ConversationComposerV1 {
	/** The draft the host kept, handed back when the session opens. */
	draft: string
	/** Whom the viewer may write as, and whom they are writing as. */
	personas: Array<{ personaId: number; name: string }>
	personaId: number | null
	/** A guest with no persona: the composer offers to add one instead. */
	addPersona: boolean
	/** A genre with no field (`composer: 'none'`): triggers only. */
	hidden: boolean
	/** The lanes a line may be written on, `main` first. */
	channels: string[]
	/** The draft's share of the context window, when counted. */
	usage: { total: number; limit: number } | null
	/** The More panel's tabs, and the turn controls' own (`session-controls`). */
	tabs: ConversationTabV1[]
	/** The session's action chips (`session-actions`) have something to show. */
	actions: boolean
	/** The retrieval notice (`retrieval-notice`) applies to this session. */
	notice: boolean
	/** The composer venue's overflow and `/` palette rows, and the newest line's values. */
	overflow: unknown[]
	palette: unknown[]
	newest: unknown | null
	/** Someone is due next: Send takes the quieter look. */
	sendTonal: boolean
}

/** What a line reads as when the dossier names it not. */
export const NO_LINE: ConversationLineV1 = {
	controllable: false,
	speaker: { name: "Unknown", ref: null, face: null, sprite: null },
	swipes: { show: false, right: false },
	embedding: "hidden"
}
