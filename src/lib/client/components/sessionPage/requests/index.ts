/**
 * Every request kind the session page answers (C1, F2) — ONE table, typed
 * off the SDK's `WidgetRequests`, so a kind added there with no answer here,
 * or an answer here for a kind the SDK does not name, does not compile. WHO
 * may ask each kind is the SDK's askers table, held in front of this by
 * `guardWidgetRequests` (`./askers.ts`, F9); no answer here repeats it.
 *
 * Each `answerX` keeps its own signature and its own deps; the table adapts
 * them to the page's one {@link WidgetRequestDeps}. Every member of that is a
 * function, called when a request arrives — never a value captured when the
 * answerer is built — so an answer reads the page as it stands at that
 * moment, and the page may build the answerer before the locals it names.
 */
import type {
	SessionCharactersV1,
	WidgetRequestKind,
	WidgetRequests
} from "@serene-pub/sdk"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"
import { answerActionsSeen, type ActionsSeenDeps } from "./actionsSeen"
import { answerAddPersona, type AddPersonaDeps } from "./addPersona"
import { answerTakeSeat, type TakeSeatDeps } from "./takeSeat"
import {
	answerAttachFiles,
	answerRemoveAttachment,
	answerRemoveTrayItem,
	type AttachmentRequestDeps
} from "./attachments"
import {
	answerAuthorsNote,
	answerSetAuthorsNote,
	type AuthorsNoteRead,
	type AuthorsNoteWrite
} from "./authorsNote"
import { answerChangeSprite } from "./changeSprite"
import { answerClearSceneImage, type SceneImagePins } from "./clearSceneImage"
import { answerDecideProposal, type DecideProposalDeps } from "./decideProposal"
import { answerDraft, type DraftDeps } from "./draft"
import { answerFireTurn, type FireTurnDeps } from "./fireTurn"
import { answerForwardTurn, answerRewindTurn, type RewindTurnDeps } from "./rewindTurn"
import { answerInspectRun, type InspectRunDeps } from "./inspectRun"
import { answerMessages, type MessagesDeps } from "./messages"
import { answerChannelLanes, type ChannelLanesDeps } from "./channelLanes"
import { answerOpenCharacter, type OpenCharacterDeps } from "./openCharacter"
import { answerOpenLore, type OpenLoreDeps } from "./openLore"
import { answerPickTurn, type PickTurnDeps } from "./pickTurn"
import { answerPromptDetails, type PromptDetailsDeps } from "./promptDetails"
import { answerSend, type SendDeps } from "./send"
import { answerSessionEntries, type SessionEntriesRead } from "./sessionEntries"
import { answerSessionImages } from "./sessionImages"
import {
	answerSetAttributeValue,
	type AttributeWriter
} from "./setAttributeValue"
import { answerSetEntryMarks, type EntryMarksWrite } from "./setEntryMarks"
import { answerSetSpriteSet, type SpriteSetWrite } from "./setSpriteSet"
import { answerSetTieShown, type TieShownWrite } from "./setTieShown"
import { answerSetAttributeCarry, type AttributeCarryWrite } from "./setAttributeCarry"
import { answerSummarize, type SummarizeDeps } from "./summarize"
import {
	answerSceneClose,
	answerSceneMove,
	answerSceneOpen,
	answerSceneRemove,
	answerSceneRename,
	type SceneBoundaryDeps
} from "./sceneBoundaries"
import { answerSwitchPersona, type SwitchPersonaDeps } from "./switchPersona"
import { answerViewAvatar } from "./viewAvatar"
import { answerViewImage, type ViewImageDeps } from "./viewImage"
import {
	answerHistoryEntries,
	type HistoryEntriesDeps,
	type SceneRow
} from "./historyEntries"
import {
	answerSetStoryClock,
	type StoryClockRead,
	type StoryClockWrite
} from "./storyClock"
import {
	answerStartHistoryEntry,
	type StartHistoryEntryDeps
} from "./startHistoryEntry"
import { answerExtendGraph } from "./extendGraph"
import { answerDecideSceneCue, type DecideSceneCueDeps } from "./decideSceneCue"
import { answerSummarizeScenes, type SummarizeScenesDeps } from "./summarizeScenes"
import { answerSessionPlaces, type SessionPlacesRead } from "./sessionPlaces"
import { answerCharacterImages, type CharacterGalleryRead } from "./characterImages"
import { answerStatTrail, type StatTrailRead } from "./statTrail"
import { answerRoutineLog, type RoutineLogRead } from "./routineLog"
import { answerSetChosenImage, type InstanceSettings } from "./setChosenImage"
import { answerSetBackdrop, type BackdropWrite } from "./setBackdrop"
import { answerSetOwnerFace, type OwnerFaceWrite } from "./setOwnerFace"
import { answerGivePiece, type GiveWrite } from "./givePiece"
import {
	patchWidgetSettings,
	widgetSettingDecl,
	widgetSettingValues
} from "$lib/client/stores/widgetSettings.svelte"
import { widgetSettingsSchema } from "$lib/shared/widgets/settings"
import type { StoryClock } from "$lib/shared/lorebooks/storyDate"

/** Which widget asks — what a `WidgetRequestHandler` is handed beside the params. */
type RequestFrom = Parameters<WidgetRequestHandler>[2]

/**
 * What the session page answers widget requests with (C1) — one object, its
 * members named after the page's own locals. Every member is a function, read
 * when a request arrives (see the module note).
 */
export interface WidgetRequestDeps {
	// ── The session ──
	/** The page's session; null when it has none yet. */
	sessionId(): number | null
	/** One of the session's lines, by id. */
	findMessage(messageId: number): SelectSessionMessage | undefined
	/** One page of the session's lines for one widget (`messages`), from the server. */
	messagesPage: MessagesDeps["messagesPage"]
	/** 🚧 The log's next older page, per channel (`load-older`, ★7): merged into the page's own window. */
	loadOlderIn(channels?: readonly string[]): Promise<void>
	/** The channel lanes under one channel (`channel-lanes`), from the server. */
	channelLanes: ChannelLanesDeps["channelLanes"]
	/** The cast the page projects to widgets — what `set-sprite-set` is judged against. */
	characters(): SessionCharactersV1 | undefined
	/** One participant, by the ref a widget names it with. */
	characterForRef(ref: string): SelectCharacter | undefined

	// ── The viewer ──
	isAdmin(): boolean
	/** Context debugging is on (system settings). */
	contextDebugging(): boolean
	/** The viewer may control this line (the page's own controls' rule). */
	canControlMessage(msg: SelectSessionMessage): boolean

	// ── Panels ──
	castMemberOf: OpenCharacterDeps["castMemberOf"]
	openCastMember: OpenCharacterDeps["openCastMember"]
	openCharactersPanel: OpenCharacterDeps["openCharactersPanel"]
	viewCharacter: OpenCharacterDeps["viewCharacter"]
	showLore: OpenLoreDeps["showLore"]
	openLorebooksPanel: OpenLoreDeps["openLorebooksPanel"]

	// ── Viewers, pickers and modals ──
	viewAvatar(who: SelectCharacter): void
	viewImage: ViewImageDeps["viewImage"]
	showReport: PromptDetailsDeps["showReport"]
	runOfMessage: InspectRunDeps["runOfMessage"]
	openRun: InspectRunDeps["openRun"]
	showTurnPicker: PickTurnDeps["showTurnPicker"]
	showSpritePicker(msg: SelectSessionMessage): void
	showAddPersona: AddPersonaDeps["showAddPersona"]
	/** 🚧 A guest's seat, opened by name (`take-seat`, Lair rewrite D5). */
	takeSeat: TakeSeatDeps["takeSeat"]
	markActionsSeen: ActionsSeenDeps["markActionsSeen"]

	// ── Summarize ──
	scened(): SummarizeDeps["scened"]
	opensScenes: SummarizeDeps["opensScenes"]
	select: SummarizeDeps["select"]
	openSummarize: SummarizeDeps["openSummarize"]
	summarizeOpen: SummarizeDeps["summarizeOpen"]
	/** Start the conversation's selection, empty (a `summarize` naming no lines). */
	startSummarySelection(): void
	/** 🚧 Summarize an existing scene (a `summarize` naming its `sceneId`) in the Process scene window. */
	processScene: SummarizeDeps["processScene"]

	// ── 🚧 Live scenes: the conversation's scene boundaries (§14 C) ──
	/** May the viewer place scene boundaries here (the dossier's verdict)? */
	sceneBoundaries: SceneBoundaryDeps["sceneBoundaries"]
	openScene: SceneBoundaryDeps["openScene"]
	closeScene: SceneBoundaryDeps["closeScene"]
	moveSceneBoundary: SceneBoundaryDeps["moveSceneBoundary"]
	renameScene: SceneBoundaryDeps["renameScene"]
	/** The page's question before *Remove boundary*. */
	confirmRemoveScene: SceneBoundaryDeps["confirmRemoveScene"]
	deleteScene: SceneBoundaryDeps["deleteScene"]
	/** 🚧 *Remove boundary* into the scene before (lane E). */
	mergeScene: SceneBoundaryDeps["mergeScene"]

	// ── Chronicle (W3): the story clock, the history, the scenes ──
	/** This session's scenes, as the page holds them. */
	sceneList(): readonly SceneRow[]
	/** 🚧 The session's own book (its Session notes): what Chronicle and Places read when it reads no shared lorebook (pr-6 B §B-3). */
	ownBookId?(): number | null
	/** This session's scenes on its line not yet in the lorebook's graph. */
	ungraphedScenes(): number
	/** Open the page's Extend graph review. */
	openExtendGraph(): void
	/** The session's own clock as the server last said it — the page keeps its row current. */
	noteStoryClock(own: StoryClock | null): void
	/** 🚧 The session's book's calendar as a clock reading said it (§15 G9): the conversation's dates. */
	noteStoryCalendar?(calendar: unknown): void
	/** 🚧 The session's open scenes and scene settings (`scenes:openScenes`, live scenes §7). */
	readOpenScenes: NonNullable<HistoryEntriesDeps["readOpenScenes"]>
	/** 🚧 Summarize scenes in the background (`scenes:processAll`, live scenes §5). */
	summarizeScenes: SummarizeScenesDeps["summarizeScenes"]
	/** 🚧 Decide a scene cue — a chip's Yes or Not here (`scenes:decideCue`, live scenes §4). */
	decideSceneCue: DecideSceneCueDeps["decideSceneCue"]

	// ── The composer ──
	setDraft: DraftDeps["setDraft"]
	/** The channel the composer is on (a plugin's `draft` is held to it, D4). */
	composerChannel(): string | null | undefined
	channels(): SendDeps["channels"]
	setChannel: SendDeps["setChannel"]
	switchPersona: SwitchPersonaDeps["switchPersona"]
	send: SendDeps["send"]
	composerTray(): AttachmentRequestDeps
	fireTurn: FireTurnDeps["fireTurn"]
	/** 🚧 Back · Forward (`rewind-turn` · `forward-turn`, RF fix 5). */
	rewindTurn: RewindTurnDeps["rewindTurn"]
	forwardTurn: RewindTurnDeps["forwardTurn"]

	// ── Session state and scene pins ──
	stateStore(): AttributeWriter & DecideProposalDeps
	/** ⏳ The page's scene-image pins (`clear-scene-image`), until 0.7.0 (W6). */
	scenePins(): SceneImagePins

	// ── Socket asks, each settled on its own reply (`./pendingAsks.ts`) ──
	writeSpriteSet: SpriteSetWrite
	readSessionEntries: SessionEntriesRead
	writeEntryMarks: EntryMarksWrite
	readAuthorsNote: AuthorsNoteRead
	writeAuthorsNote: AuthorsNoteWrite
	readStoryClock: StoryClockRead
	writeStoryClock: StoryClockWrite
	readHistory: HistoryEntriesDeps["readHistory"]
	readLines: HistoryEntriesDeps["readLines"]
	startNextEntry: StartHistoryEntryDeps["startNextEntry"]
	/** 🚧 Places (W4): the session's places and ways (`sessions:places`). */
	readSessionPlaces: SessionPlacesRead
	/** 🚧 Scene Portraits (W6): one member's gallery (`characters:listGallery`). */
	readCharacterGallery: CharacterGalleryRead
	/** 🚧 Stats (F2): one owner's stat trail (`sessions:statTrail`). */
	readStatTrail: StatTrailRead
	/** 🚧 What the session's routines did (`routine-log`, A7), from the server. */
	readRoutineLog: RoutineLogRead
	/** 🚧 Backdrop: set or clear the session's backdrop (`sessions:setBackdrop`). */
	writeBackdrop: BackdropWrite
	/** 🚧 Stats (PLAN-sheet §12): set or clear a player seat's portrait (`state:setOwnerFace`). */
	writeOwnerFace: OwnerFaceWrite
	/** 🚧 Stats (★4): Give to… — a piece given or offered (`state:givePiece`). */
	writeGive: GiveWrite
	/** 🚧 Stats (ties on the graph): a tie side shown or hidden (`state:showTieSide`). */
	writeTieShown: TieShownWrite
	/** 🚧 Stats (RF fix 8): one of the rules' optional attributes carried or not (`state:setCarry`). */
	writeCarry: AttributeCarryWrite
}

/**
 * The page's per-instance widget settings (`stores/widgetSettings`), as
 * `set-chosen-image` reads and writes the asking instance's — the one store
 * every settings write goes through, module-scoped, so not a page dep.
 */
const instanceSettings: InstanceSettings = {
	declares: (id, key) => {
		const decl = widgetSettingDecl(id)
		return !!decl && Object.hasOwn(widgetSettingsSchema(decl), key)
	},
	values: widgetSettingValues,
	patch: patchWidgetSettings
}

/** The Chronicle's reads (W3), out of the page's deps. */
const chronicleReads = (d: WidgetRequestDeps): HistoryEntriesDeps => ({
	sessionId: d.sessionId,
	readStoryClock: d.readStoryClock,
	readHistory: d.readHistory,
	readLines: d.readLines,
	sceneList: d.sceneList,
	ownBookId: d.ownBookId,
	opensScenes: d.opensScenes,
	noteStoryClock: d.noteStoryClock,
	noteStoryCalendar: d.noteStoryCalendar,
	readOpenScenes: d.readOpenScenes
})

/** The scene boundaries' answers (§14 C), out of the page's deps. */
const sceneBoundaryDeps = (d: WidgetRequestDeps): SceneBoundaryDeps => ({
	sessionId: d.sessionId,
	sceneBoundaries: d.sceneBoundaries,
	sceneList: d.sceneList,
	findMessage: d.findMessage,
	openScene: d.openScene,
	closeScene: d.closeScene,
	moveSceneBoundary: d.moveSceneBoundary,
	renameScene: d.renameScene,
	confirmRemoveScene: d.confirmRemoveScene,
	deleteScene: d.deleteScene,
	mergeScene: d.mergeScene
})

/** How the page answers one request kind. */
type Answerer<K extends WidgetRequestKind> = (
	params: WidgetRequests[K]["params"],
	from: RequestFrom,
	deps: WidgetRequestDeps
) => WidgetRequests[K]["result"] | Promise<WidgetRequests[K]["result"]>

/**
 * The answer to every request kind, once (C1). The mapped type is the law: a
 * kind the SDK adds is a missing key here, and a key the SDK does not name is
 * an excess one — both type errors. A kind that opens something of the
 * page's own resolves with nothing once it is shown.
 */
export const WIDGET_REQUEST_ANSWERS: {
	readonly [K in WidgetRequestKind]: Answerer<K>
} = {
	messages: (p, from, d) => answerMessages(p, d, from),
	"channel-lanes": (p, from, d) => answerChannelLanes(p, d, from),
	"open-character": (p, _from, d) => {
		answerOpenCharacter(p, d)
	},
	"view-avatar": (p, _from, d) => {
		answerViewAvatar(p, d)
	},
	"view-image": (p, from, d) => {
		answerViewImage(p, from, d)
	},
	"open-lore": (p, _from, d) => {
		answerOpenLore(p, d)
	},
	"prompt-details": (p, _from, d) => {
		answerPromptDetails(p, {
			isAdmin: d.isAdmin(),
			contextDebugging: d.contextDebugging(),
			findMessage: d.findMessage,
			showReport: d.showReport
		})
	},
	"inspect-run": async (p, _from, d) => {
		await answerInspectRun(p, {
			isAdmin: d.isAdmin(),
			runOfMessage: d.runOfMessage,
			openRun: d.openRun
		})
	},
	"pick-turn": (p, _from, d) => {
		answerPickTurn(p, d)
	},
	"change-sprite": (p, _from, d) => {
		answerChangeSprite(p, {
			findMessage: d.findMessage,
			canControl: d.canControlMessage,
			showSpritePicker: d.showSpritePicker
		})
	},
	"actions-seen": (p, _from, d) => {
		answerActionsSeen(p, d)
	},
	summarize: (p, _from, d) => {
		answerSummarize(p, {
			scened: d.scened(),
			opensScenes: d.opensScenes,
			select: d.select,
			openSummarize: d.openSummarize,
			summarizeOpen: d.summarizeOpen,
			startSelection: d.startSummarySelection,
			hasScene: (sceneId) => d.sceneList().some((s) => s.id === sceneId),
			processScene: d.processScene
		})
	},
	// 🚧 Live scenes (§14 C): the conversation's scene boundaries, each
	// refused in words where the server would refuse it, and the server's
	// own refusal the asking widget's (R77) — never a toast.
	"scene-open": (p, _from, d) => answerSceneOpen(p, sceneBoundaryDeps(d)),
	"scene-close": (p, _from, d) => answerSceneClose(p, sceneBoundaryDeps(d)),
	"scene-move": (p, _from, d) => answerSceneMove(p, sceneBoundaryDeps(d)),
	"scene-rename": (p, _from, d) => answerSceneRename(p, sceneBoundaryDeps(d)),
	// Asked first, with the page's own question (STYLE-GUIDE §6.6).
	"scene-remove": (p, _from, d) => answerSceneRemove(p, sceneBoundaryDeps(d)),
	// 🚧 D4: a plugin's send is held to a channel it may write (`./send.ts`).
	send: (p, from, d) => {
		answerSend(
			p,
			{
				setDraft: d.setDraft,
				channels: d.channels(),
				setChannel: d.setChannel,
				switchPersona: d.switchPersona,
				send: d.send
			},
			from
		)
	},
	"attach-files": (p, _from, d) => {
		answerAttachFiles(p, d.composerTray())
	},
	"remove-tray-item": (p, _from, d) => {
		answerRemoveTrayItem(p, d.composerTray())
	},
	"remove-attachment": (p, _from, d) => {
		answerRemoveAttachment(p, d.composerTray())
	},
	// 🚧 D4: a plugin's draft is held to the composer's channel (`./draft.ts`).
	draft: (p, from, d) => {
		answerDraft(p, d, from)
	},
	"switch-persona": (p, _from, d) => {
		answerSwitchPersona(p, d)
	},
	"add-persona": (p, _from, d) => {
		answerAddPersona(p, d)
	},
	"take-seat": (p, _from, d) => {
		answerTakeSeat(p, d)
	},
	"fire-turn": (p, _from, d) => {
		answerFireTurn(p, d)
	},
	"rewind-turn": (p, _from, d) => {
		answerRewindTurn(p, d)
	},
	"forward-turn": (p, _from, d) => {
		answerForwardTurn(p, d)
	},
	"decide-proposal": (p, _from, d) => {
		answerDecideProposal(p, d.stateStore())
	},
	// 🚧 The conversation's far end reached (★7): the next older page of the
	// copy's own channels, into the page's log — never a page spent on others.
	"load-older": (p, _from, d) => {
		const asked = (p as { channels?: unknown } | undefined)?.channels
		const channels = Array.isArray(asked) ? asked.filter((c): c is string => typeof c === "string" && !!c.trim()) : undefined
		return d.loadOlderIn(channels?.length ? channels : undefined)
	},
	// Core's state widgets (R21): the viewer's own edit at the session
	// layer; its refusal is the asking widget's (R77).
	"set-attribute-value": (p, from, d) =>
		answerSetAttributeValue(p, d.stateStore(), d.sessionId(), from),
	// 🚧 Give to… (★4): ONE request; the host gives at once or files an
	// offer, and its refusal is the asking widget's (R77).
	"give-piece": (p, from, d) => answerGivePiece(p, d.sessionId(), d.writeGive, from),
	// 🚧 A tie side shown or hidden (ties on the graph, screen 2): the holder's or the game master's.
	"set-tie-shown": (p, from, d) => answerSetTieShown(p, d.sessionId(), d.writeTieShown, from),
	// 🚧 RF fix 8: an optional attribute carried or not — the holder's or the session owner's.
	"set-attribute-carry": (p, from, d) => answerSetAttributeCarry(p, d.sessionId(), d.writeCarry, from),
	// Core's scene portraits (R21): judged against the cast the widget was
	// shown (R77 — offered only where allowed); the server's refusal is the
	// asking widget's, not a toast.
	"set-sprite-set": (p, _from, d) =>
		answerSetSpriteSet(p, d.characters(), d.sessionId(), d.writeSpriteSet),
	// ⏳ The PAGE's pin (R77, F10): the one it persists, mirrors into the
	// store and projects, so page and widget never disagree. Core's Scene
	// Portraits does not ask it (its chosen image is a setting); REMOVE in 0.7.0.
	"clear-scene-image": (p, _from, d) => {
		answerClearSceneImage(p, d.scenePins())
	},
	// The session's lore, paged by request (R58); `titleOrKey` becomes the
	// socket's `query`, and each ask takes its own reply.
	"session-entries": (p, _from, d) =>
		answerSessionEntries(p, d.sessionId(), d.readSessionEntries),
	// Answered as this session reads the entry (A14).
	"set-entry-marks": (p, _from, d) =>
		answerSetEntryMarks(p, d.sessionId(), d.writeEntryMarks),
	// 🚧 The session's author's note and the last reply's verdict (AN1).
	"authors-note": (p, _from, d) =>
		answerAuthorsNote(p, d.sessionId(), d.readAuthorsNote),
	// Saved by the session's owner; the server judges it (AN1).
	"set-authors-note": (p, _from, d) =>
		answerSetAuthorsNote(p, d.sessionId(), d.writeAuthorsNote),
	// 🚧 Chronicle (W3): the session's story, read off what already exists
	// — the clock's read, the book's history and lines, the page's scenes.
	"history-entries": (p, _from, d) => answerHistoryEntries(p, chronicleReads(d)),
	// Moved by the session's owner; the server judges it and the calendar.
	"set-story-clock": (p, _from, d) =>
		answerSetStoryClock(p, d.sessionId(), d.writeStoryClock, d.noteStoryClock),
	// The lorebook's next date after the one the session reads now.
	"start-history-entry": (p, _from, d) =>
		answerStartHistoryEntry(p, {
			...chronicleReads(d),
			startNextEntry: d.startNextEntry
		}),
	// The page's own Extend graph review, opened.
	"extend-graph": (p, _from, d) => {
		answerExtendGraph(p, d)
	},
	// 🚧 Live scenes (§5, §7, lane D): Chronicle's background summaries — a
	// row's Summarize, Close and summarize, Summarize all (N).
	"summarize-scenes": (p, _from, d) => answerSummarizeScenes(p, d),
	// 🚧 Live scenes (§4, lane D): a scene cue's Yes / Not here; the
	// server's refusal is the asking widget's (R77).
	"decide-scene-cue": (p, _from, d) => answerDecideSceneCue(p, d),
	// 🚧 Places (W4): the session's places and the ways between them, as
	// the server reads the session's book; who stands where is the widget's.
	"session-places": (p, _from, d) =>
		answerSessionPlaces(p, d.sessionId(), d.readSessionPlaces, d.ownBookId?.() ?? null),
	// 🚧 Scene Portraits (W6): a page of a session member's gallery — only
	// a member of the cast the page projects.
	"character-images": (p, _from, d) => answerCharacterImages(p, d),
	// 🚧 Stats (F2): one stat's trail in the page's session, as the server
	// reads the ledger; a guest may ask.
	"stat-trail": (p, _from, d) =>
		answerStatTrail(p, d.sessionId(), d.readStatTrail),
	// 🚧 While you were away (A7, R23): what the session's routines did.
	"routine-log": (p, _from, d) => answerRoutineLog(p, d.sessionId(), d.readRoutineLog),
	// 🚧 Scene Portraits (F2): the ASKING instance's own settings — the
	// wire's `from.widgetId` is the instance its panel mounted.
	"set-chosen-image": (p, from, d) => {
		answerSetChosenImage(p, from, {
			characters: d.characters,
			settings: instanceSettings
		})
	},
	// 🚧 Backdrop (DESIGN-image-generation §6.4): the session's backdrop, set
	// or cleared; the server judges who may, and its refusal is the widget's.
	"set-backdrop": (p, _from, d) =>
		answerSetBackdrop(p, d.sessionId(), d.writeBackdrop),
	// 🚧 Stats (PLAN-sheet §12): a player seat's portrait, set or cleared;
	// the server judges who may, and its refusal is the widget's.
	"set-owner-face": (p, _from, d) =>
		answerSetOwnerFace(p, d.sessionId(), d.writeOwnerFace),
	// 🚧 Backdrop (D3): the session's generated pictures, for the chooser's
	// *From this session* — the Album's `generated` source over a `messages` page.
	"session-images": (p, _from, d) => answerSessionImages(p, d)
}

/**
 * The page's one answer to every widget request (C1): the kind's row of
 * {@link WIDGET_REQUEST_ANSWERS}, over `deps`. Put `guardWidgetRequests` in
 * front of it. A refusal — thrown or rejected — rejects the request, and a
 * kind the table does not hold is refused, never answered.
 */
export function buildWidgetRequestAnswerer(
	deps: WidgetRequestDeps
): WidgetRequestHandler {
	return async (kind, params, from) => {
		if (!Object.hasOwn(WIDGET_REQUEST_ANSWERS, kind))
			throw new Error(
				`'${String(kind)}' is not something this page answers`
			)
		return await WIDGET_REQUEST_ANSWERS[kind](params, from, deps)
	}
}
