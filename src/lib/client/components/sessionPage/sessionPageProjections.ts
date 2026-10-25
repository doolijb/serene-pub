/**
 * The session page's projections: what the envelope and the page's own
 * controls read off the loaded session, the viewer and the page's stores —
 * plain functions with no state of their own. Each is called inside a
 * `$derived` or a handler of the page's, so whatever it reads is tracked
 * there, exactly where it is read.
 */
import { avatarSrc } from "$lib/client/utils/media"
import { composerClosuresFor, DEFAULT_CHANNEL, parseChannel } from "@serene-pub/sdk"
import { castFaceOf } from "./projections/characters"
import { sessionBookOf } from "$lib/client/sessions/store/derive"
import {
	resolveSprite,
	shownSpriteOf,
	spriteSrc,
	currentSpriteIn,
	currentSpriteOf
} from "$lib/client/utils/sprites"
import { embeddingsStarred } from "$lib/shared/constants/embeddings"
import {
	messageEnvoySlug,
	messageSpeaker,
	personLineName,
	seatNameOf,
	seatPortraitOf,
	withPortrait
} from "$lib/client/utils/messageSpeaker"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import { describeProposal } from "$lib/shared/state/ledgerLines"
import { t } from "$lib/client/i18n/state.svelte"
import type {
	ConversationDossierV1,
	ConversationLineV1,
	ConversationProposalV1
} from "$lib/shared/widgets/conversation"
import type { SessionStateHandle } from "$lib/client/state/sessionState.svelte"
import type { RemoteFaces } from "$lib/client/components/sessionPage/remoteFace"
import type { SessionPageData } from "$lib/client/components/sessionPage/sessionPageData.svelte"
import type { ActionList } from "$lib/client/components/sessionPage/actionList.svelte"
import type { TurnFlow } from "$lib/client/components/sessionPage/turnFlow.svelte"
import type { MessageControls } from "$lib/client/components/sessionPage/messageControls.svelte"
import type { ComposerFlow } from "$lib/client/components/sessionPage/composerFlow.svelte"
import type { ScenesFlow } from "$lib/client/components/sessionPage/scenesFlow.svelte"
import {
	conversationSceneOf,
	sceneBoundariesFor,
	type LiveSceneRow,
	type SceneCastFaces
} from "$lib/client/components/sessionPage/liveSceneProjection"
import {
	effectiveLoreWriteMode,
	loreWriteLimit,
	type LoreWriteMode
} from "$lib/shared/lorebooks/loreWriteMode"
import { composerWritingAs } from "$lib/shared/sessions/playerSeat"
import { roundWaitingFor } from "$lib/client/components/sessionPage/roundWaiting"
import type { DraftWrite } from "$lib/client/components/sessionPage/collects"

type LoadedSession = Sockets.Sessions.Get.Response["session"] | undefined

/** A face for a turn ref, from the loaded cast (`character:<id>`). */
export function characterForRefIn(
	session: LoadedSession,
	ref: string | null | undefined
): SelectCharacter | undefined {
	const m = /^character:(\d+)$/.exec(ref ?? "")
	if (!m) return undefined
	const id = Number(m[1])
	return (session?.sessionCharacters?.find((cc) => cc.characterId === id)
		?.character ??
		session?.sessionPersonas?.find((cp) => cp.personaId === id)
			?.persona) as SelectCharacter | undefined
}

// Check if current user can edit/control a specific message — mirrors
// `canActOnMessage` (`server/messages/permissions.ts`) branch for branch:
// - Persona messages: only that persona's own owner, never the session
//   owner (a persona is another participant's own self-representation).
// - Character messages: the session owner, or whoever owns that character
//   (so a guest who brought their own character in can control it).
// - An envoy's line and narration: the session owner's.
// - A user line with no persona: its author's, by `userId`.
// - An orphaned row (its character/persona deleted globally, its author
//   gone — the rows that render as "Unknown"): the session owner's.
// - 🚧 For the rerun verbs (swipe, retry, extend) only: an envoy's line in a
//   channel lane the viewer is the member of (ruled 2026-10-15) — see
//   `viewerLanesIn`.
// An affordance only — the server refuses regardless.
export function canControlMessageAs(
	userCtx: UserCtx,
	isGuest: boolean,
	session: LoadedSession,
	msg: SelectSessionMessage,
	verb: "change" | "rerun" = "change",
	annex?: Readonly<Record<string, Readonly<Record<string, unknown>>>> | null
): boolean {
	if (!userCtx.user?.id) return false

	if (msg.personaId) {
		return (
			session?.sessionPersonas?.some(
				(cp) =>
					cp.personaId === msg.personaId &&
					cp.persona?.userId === userCtx.user?.id
			) ?? false
		)
	}

	if (msg.characterId) {
		if (!isGuest) return true
		return (
			session?.sessionCharacters?.some(
				(cc) =>
					cc.characterId === msg.characterId &&
					cc.character?.userId === userCtx.user?.id
			) ?? false
		)
	}

	// An envoy's line (U5g): no character row behind it, the reference
	// on the row is its identity, and it is the session owner's to act
	// on, as narration is.
	if (messageEnvoySlug(msg)) {
		if (!isGuest) return true
		if (verb !== "rerun") return false
		const ref = parseChannel(msg.channel)
		return viewerLanesIn(annex, userCtx.user.id).some(
			(l) => l.slug === ref.slug && l.lane === ref.lane
		)
	}

	// Narrator response messages aren't owned by any persona/character —
	// only the session owner controls them, mirroring
	// canActOnMessage server-side.
	if (msg.isNarratorResponse) return !isGuest

	// A person's own line with no persona voicing it: the author's —
	// nobody else's, not even the owner's, on a persona line's terms.
	if (msg.role === "user" && msg.userId != null)
		return msg.userId === userCtx.user?.id

	// Nothing on the row names anyone: the session owner's, as narration.
	return !isGuest
}

/**
 * 🚧 The channel lanes the viewer is the member of, off their annex view —
 * the client half of the server's `laneMemberOf`
 * (`server/messages/permissions.ts`). Core stores no lane membership; a
 * genre keeps it in an annex map keyed `user:<id>` → lane (the Dungeon
 * Crawler's `dungeon-crawler-lanes`). The view carries only declared keys
 * the viewer may see, so the map is found by its value's shape: an object
 * whose `user:<viewerId>` entry names a lane. `main` is never one.
 */
export function viewerLanesIn(
	annex: Readonly<Record<string, Readonly<Record<string, unknown>>>> | null | undefined,
	viewerId: number | null | undefined
): Array<{ slug: string; lane: number }> {
	if (!annex || typeof viewerId !== "number") return []
	const out: Array<{ slug: string; lane: number }> = []
	for (const doc of Object.values(annex)) {
		if (!doc || typeof doc !== "object") continue
		for (const map of Object.values(doc)) {
			if (!map || typeof map !== "object" || Array.isArray(map)) continue
			const mine = (map as Record<string, unknown>)[`user:${viewerId}`]
			if (typeof mine !== "string" || !mine.trim()) continue
			const ref = parseChannel(mine)
			if (ref.warning || ref.slug === DEFAULT_CHANNEL) continue
			out.push({ slug: ref.slug, lane: ref.lane })
		}
	}
	return out
}

/**
 * A person speaking as themselves — no persona, as a genre with
 * `personas: { min: 0 }` allows (the Guide, the Lair). Named by the genre's
 * `playerLabel` when it declares one (R4), with the member beside it on a
 * shared session; else by the member the row belongs to: the viewer's own
 * display name, a guest's off the member list.
 */
export function personLineOf(
	userCtx: UserCtx,
	session: LoadedSession,
	sessionPlayerLabel: string | null | undefined,
	msg: SelectSessionMessage
): { name: string; member?: string } | undefined {
	const me = userCtx.user
	const member =
		me && msg.userId === me.id
			? me
			: session?.sessionGuests?.find((g) => g.userId === msg.userId)?.user
	return personLineName({
		seatName: seatNameOf(session, msg),
		playerLabel: sessionPlayerLabel,
		memberName: member
			? member.displayName?.trim() || member.username
			: null,
		memberCount: 1 + (session?.sessionGuests?.length ?? 0)
	})
}

/**
 * Who spoke a line. The resolution itself is in `messageSpeaker` so it can
 * be tested without a page; a person's own line with no persona is named by
 * `personLine`.
 */
export function messageCharacterOf(
	session: LoadedSession,
	sessionFrames: Sockets.Sessions.View.Response | null,
	msg: SelectSessionMessage,
	personLine: (msg: SelectSessionMessage) => { name: string } | undefined
): SelectCharacter | undefined {
	// The envoys ride the view payload, not the session row (U5g).
	const speaker = messageSpeaker(
		session ? { ...session, envoys: sessionFrames?.envoys } : session,
		msg
	)
	if (speaker || msg.role !== "user" || msg.personaId != null) return speaker
	const own = personLine(msg)
	// The character shape, so the row renders as any other — with the
	// seat's portrait as its face when it has one (PLAN-sheet §12).
	return own
		? withPortrait({ name: own.name } as unknown as SelectCharacter, seatPortraitOf(session, msg))
		: undefined
}

/**
 * The session header's cast stack: the session's characters, then the
 * personas people speak as. Names come from `resolveCharacterName`, the same
 * helper the message log labels a speaker with, so a face and its lines
 * carry one name. The header renders under `<main>` as a sibling of this
 * page, so `openSessionCtx` is what carries the faces up to it.
 *
 * Built from the streamed `session`, so the build re-runs per chunk; kept
 * as a STRING, which a `$derived` compares by value, so the header's cast — and
 * the header that reads it — moves only when a face, a name or the next
 * speaker does.
 */
/**
 * A seated character's face for the header disc: the CURRENT sprite when the
 * card has one for the line, else the face the cast retells (`castFaces`,
 * plan cast-retold-fields), else the card's avatar — the same order
 * `projectCharacters` gives widgets, so the header and the widgets never
 * disagree about who someone looks like.
 */
function headerFaceOf(
	session: LoadedSession,
	character: NonNullable<Parameters<typeof spriteSrc>[0]> & { id: number },
	wanted: ReturnType<typeof currentSpriteIn>
): string | undefined {
	if (resolveSprite(character as any, wanted))
		return spriteSrc(character as any, wanted)
	return (
		castFaceOf(session as any, character.id, {}) ??
		avatarSrc(character, {})
	)
}

export function headerCastKeyOf(
	session: LoadedSession,
	nextId: number | null
): string {
	const characters = (session?.sessionCharacters ?? [])
		.filter((cc) => !!cc.character)
		.map((cc) => ({
			key: `character:${cc.character.id}`,
			name: resolveCharacterName(cc.character, cc.character.name),
			// The CURRENT sprite (DESIGN-sprites §7): the face on this
			// character's newest line, else its avatar. Derived from the
			// loaded messages, never stored.
			avatarSrc:
				headerFaceOf(
					session,
					cc.character,
					currentSpriteIn(
						currentSpriteOf(
							cc.character.id,
							(session?.sessionMessages ?? []) as any[]
						),
						(session as any)?.spriteSetOverrides?.[cc.character.id]
					)
				) ?? null,
			isPersona: false,
			isNext: cc.character.id === nextId
		}))
	const personas = (session?.sessionPersonas ?? [])
		.filter((cp) => !!cp.persona)
		.map((cp) => ({
			key: `persona:${cp.persona.id}`,
			name: resolveCharacterName(cp.persona, cp.persona.name),
			avatarSrc: avatarSrc(cp.persona) ?? null,
			isPersona: true,
			isNext: false
		}))
	return JSON.stringify([...characters, ...personas])
}

/** A state proposal row as the conversation draws it (C0b). */
export function describeProposalRowWith(
	stateStore: SessionStateHandle,
	row: Sockets.State.ProposalRow,
	viewerId?: number | null
): ConversationProposalV1 {
	const payload = (row.payload ?? {}) as Record<string, unknown>
	// 🚧 A player's offer (Give to…, ★4; PLAN-dc-after-walk3 R1-2): its two
	// names as the offer was made, and whether the viewer made it — the
	// giver's own offer is theirs to withdraw, never to accept.
	const offer =
		payload.offer && typeof payload.offer === "object"
			? (payload.offer as { by?: unknown; fromLabel?: unknown; toLabel?: unknown })
			: null
	const moved =
		row.status !== "superseded"
			? null
			: typeof payload.slotId === "string"
				? (stateStore.slotLabelFor(payload.slotId) ?? payload.slotId)
				: t("a value")
	return {
		id: row.id,
		status: row.status,
		messageId: (row as { messageId?: number | null }).messageId ?? null,
		text: describeProposal(row, {
			ownerLabel: (owner) => stateStore.ownerLabelFor(owner),
			slotLabel: (slotId) => stateStore.slotLabelFor(slotId),
			itemName: (entryId) => stateStore.itemNameFor(entryId)
		}),
		proposedBy: (row as { proposedBy?: string | null }).proposedBy ?? null,
		moved,
		...(offer
			? {
					offer: {
						from: typeof offer.fromLabel === "string" ? offer.fromLabel : "",
						to: typeof offer.toLabel === "string" ? offer.toLabel : "",
						yours: viewerId != null && offer.by === viewerId
					}
				}
			: {})
	}
}

/** A line's vectors against the active embedding model (the old EmbeddingStatusIcon's rule). */
export function embeddingStatusIn(
	systemSettingsCtx: SystemSettingsCtx,
	model: string | null | undefined
): ConversationLineV1["embedding"] {
	const active = systemSettingsCtx?.settings?.activeEmbeddingModel ?? null
	if (!embeddingsStarred(systemSettingsCtx?.capabilityDefaults) || !active)
		return "hidden"
	if (model === active) return "current"
	return model ? "stale" : "none"
}

/** Each line's facts, and what they were built from (a plain map: a cache, not state). */
export type DossierLineCache = Map<
	number,
	{ key: string; line: ConversationLineV1 }
>

/** What the conversation's dossier is built from: the page's stores and contexts, read as the build reads them. */
export interface DossierSources {
	data: SessionPageData
	actions: ActionList
	turns: TurnFlow
	controls: MessageControls
	composer: ComposerFlow
	scenes: ScenesFlow
	/** 🚧 The session's scene cues (live scenes §4, `sceneCuesFlow`); absent, none are drawn. */
	sceneCues?: {
		readonly cues: readonly Sockets.Scenes.SceneCue[]
		readonly settings?: { readonly summary: "onClose" | "onRequest" | "never" }
	}
	stateStore: SessionStateHandle
	remoteFaces: RemoteFaces
	userCtx: UserCtx
	systemSettingsCtx: SystemSettingsCtx
	userSettingsCtx: UserSettingsCtx
	/** The page's last write to core's composer draft (C0b, D1). */
	composerDraft(): DraftWrite
	/** `$state.snapshot`, from the page: a plain copy of what a store holds. */
	snapshot<T>(value: T): T
}

/**
 * What core's conversation widget is told about this session (C0b,
 * `session_full.v1`): the page's answers — who the viewer controls, who
 * spoke each line, where the scenes fall — so the widget judges nothing
 * it would need the page for. Null until a session is loaded.
 */
export function projectConversationDossier(
	src: DossierSources,
	lineCache: DossierLineCache
): ConversationDossierV1 | null {
	const session = src.data.session
	if (!session) return null
	const {
		userCtx,
		systemSettingsCtx,
		userSettingsCtx,
		remoteFaces,
		stateStore,
		snapshot
	} = src
	const {
		isGuest,
		lastMessage,
		lastAuthorMessage,
		sessionFrames,
		sessionPlayerLabel,
		ownVoice,
		pagination,
		loadingOlderMessages,
		extendRefusal,
		userPersonasInSession,
		currentUserPersona,
		ownCardlessSeat,
		showAddPersonaCTA,
		showTakeSeatCTA,
		composerHidden,
		sessionChannels,
		modeMissing,
		getMessageCharacter,
		canControlMessage,
		canRerunMessage,
		rerunRefusals,
		annex,
		personLine,
		offersWrite
	} = src.data
	const {
		canRegenerateLastMessage,
		sessionActions,
		composerMenuActions,
		paletteActions,
		newestItem
	} = src.actions
	// 🚧 A kept turn's rows lose Delete (owner ruling ★9). Absent from an
	// action list built before it (a test double): every row keeps it.
	const deleteRefused = (row: { id: number; channel?: string | null }) =>
		src.actions.deleteRefused?.(row) ?? false
	const { showSwipeControls, canSwipeRight } = src.controls
	const {
		turnOrder,
		shouldShowNextCharacterBlock,
		canChooseDifferentCharacter
	} = src.turns
	const { draftCompiledPrompt, composerTray } = src.composer
	const { sceneList, capturedMessageIds, selectForSummary, summaryEnded } =
		src.scenes
	const composerDraft = src.composerDraft()
	// Whom the viewer writes as with no persona (`composerWritingAs`).
	const writingAs = composerWritingAs({
		ownSeat: ownCardlessSeat,
		playerLabel: sessionPlayerLabel
	})
	const describeProposalRow = (row: Sockets.State.ProposalRow) =>
		describeProposalRowWith(stateStore, row, userCtx.user?.id ?? null)
	const embeddingStatusOf = (model: string | null | undefined) =>
		embeddingStatusIn(systemSettingsCtx, model)
	const lines: ConversationDossierV1["lines"] = {}
	// A line's facts are rebuilt only when something they read changed —
	// a streamed token rewrites one row's text, not who spoke every line.
	const castKey = [
		userCtx.user?.id,
		isGuest,
		// `promptDetails` reads both.
		userCtx.user?.isAdmin,
		systemSettingsCtx.settings?.contextDebuggingEnabled,
		// A face drawn for the box landed: the lines waiting on it rebuild.
		remoteFaces.landed,
		lastMessage?.id,
		lastAuthorMessage?.id,
		canRegenerateLastMessage,
		systemSettingsCtx.settings?.activeEmbeddingModel,
		...(session.sessionCharacters ?? []).map(
			(cc) =>
				`${cc.characterId}:${cc.character?.name}:${cc.character?.avatarMediaId}:${(session as any)?.castFaces?.[cc.characterId ?? -1] ?? ""}`
		),
		...(session.sessionPersonas ?? []).map(
			(cp) => `${cp.personaId}:${cp.persona?.name}:${cp.persona?.userId}`
		),
		// An envoy's line takes its name and face off the view's list (U5g).
		// A data: image by its length (it rides every line's key), a URL whole.
		...(sessionFrames?.envoys ?? []).map(
			(e) =>
				`${e.slug}:${e.name}:${e.image?.startsWith("data:") ? e.image.length : e.image}`
		),
		// A person's own line: the label and the members that name it (R4).
		sessionPlayerLabel,
		// A line nobody claims: the own voice's name (R5).
		ownVoice,
		...(session.sessionGuests ?? []).map(
			(g) => `${g.userId}:${g.user?.displayName}:${g.user?.username}`
		),
		// The lanes the viewer is a member of: an envoy's line there reruns.
		JSON.stringify(viewerLanesIn(annex, userCtx.user?.id)),
		// 🚧 A row the server refused a rerun of loses its rerun controls.
		rerunRefusals?.key ?? "",
		// 🚧 Where Delete is refused moves with each turn (★9).
		src.actions.deleteRefusedKey ?? ""
	].join("|")
	for (const m of session.sessionMessages) {
		const key = JSON.stringify([
			castKey,
			m.characterId,
			m.personaId,
			m.userId,
			m.role,
			m.isGenerating,
			m.isNarratorResponse,
			m.metadata?.narratorName,
			// Who the row names (U5g); a fallback stamped at the write.
			(m.metadata as { speaker?: unknown } | undefined)?.speaker,
			(m.metadata as any)?.sprite,
			m.metadata?.isGreeting,
			m.metadata?.swipes?.currentIdx,
			m.metadata?.swipes?.history?.length,
			// A greeting that asks is not rerunnable (`rowAsks`).
			(m as { parts?: unknown[] }).parts?.length,
			(m as { embeddingModel?: string | null }).embeddingModel,
			!!(m as { debugMeta?: unknown }).debugMeta
		])
		const held = lineCache.get(m.id)
		if (held?.key === key) {
			lines[m.id] = held.line
			continue
		}
		const who = getMessageCharacter(m)
		const ref = m.characterId
			? `character:${m.characterId}`
			: m.personaId
				? `character:${m.personaId}`
				: null
		const greeting = !!m.metadata?.isGreeting
		const line: ConversationLineV1 = {
			// 🚧 Two verdicts (ruled 2026-10-15): edit, hide and delete read
			// `controllable` (`canActOnMessage`'s rule); swipe, retry and
			// extend read `rerunnable` — wider for an envoy's line in a lane
			// the viewer is the member of.
			controllable: canControlMessage(m),
			rerunnable: canRerunMessage(m),
			// 🚧 Hidden, not refused, on a kept turn's row (owner ruling ★9).
			...(deleteRefused(m as { id: number; channel?: string | null }) ? { deletable: false } : {}),
			speaker: {
				name: m.isNarratorResponse
					? m.metadata?.narratorName || "Narrator"
					: resolveCharacterName(who, ownVoice),
				ref,
				// The cast's retold face over the card's (plan cast-retold-fields);
				// a persona is voiced, not cast, so only a character line gets one.
				face: remoteFaces.face(
					(m.characterId
						? castFaceOf(session as any, m.characterId, {})
						: null) ?? avatarSrc(who)
				),
				sprite: remoteFaces.face(
					spriteSrc(who as any, shownSpriteOf(m), {
						variantKey: m.id
					})
				),
				// Whose "Dungeon Master" line it is, on a shared session (R4).
				...(m.role === "user" &&
				m.personaId == null &&
				!m.characterId &&
				!m.isNarratorResponse
					? (() => {
							const member = personLine(m)?.member
							return member ? { member } : {}
						})()
					: {})
			},
			swipes: {
				// 🚧 No rerun, no swipe row (2026-10-16): the arrows are a
				// rerun affordance, gone rather than dead.
				show: showSwipeControls(m, greeting) && canRerunMessage(m),
				right: canSwipeRight(m, greeting)
			},
			embedding: embeddingStatusOf(
				(m as { embeddingModel?: string | null }).embeddingModel
			),
			// Whether a prompt is on record — the prompt itself stays on the
			// page (`prompt-details`); rows reach the widget without it.
			promptDetails:
				!!userCtx.user?.isAdmin &&
				!!systemSettingsCtx.settings?.contextDebuggingEnabled &&
				!!(m as { debugMeta?: unknown }).debugMeta
		}
		lineCache.set(m.id, { key, line })
		lines[m.id] = line
	}
	// 🚧 A scene's cast, named and drawn for its divider's faces (lane E):
	// the book's members (the owner's list), a card's face as its lines
	// show it. A guest's page holds no member list: its dividers keep their
	// speakers.
	const members = new Map(
		(src.scenes.lorebookBindingList ?? []).map((b) => [b.id, b])
	)
	const castOf: SceneCastFaces | undefined = members.size
		? (ids) =>
				ids.flatMap((id) => {
					const b = members.get(id)
					if (!b) return []
					const cid = b.characterId
					const card =
						cid != null
							? ((session.sessionCharacters ?? []).find(
									(cc) => cc.characterId === cid
								)?.character ??
								(session.sessionPersonas ?? []).find(
									(cp) => cp.personaId === cid
								)?.persona ??
								null)
							: null
					const face = card
						? remoteFaces.face(
								castFaceOf(session as any, cid!, {}) ??
									avatarSrc(card as any)
							)
						: null
					return [
						{
							ref: cid != null ? `character:${cid}` : null,
							name: b.name,
							face: face ?? null
						}
					]
				})
		: undefined
	return {
		sessionId: session.id,
		lines,
		// 🚧 Live scenes (§14 C): each row with its lane, boundaries, clocks
		// and summary state; `scened` adds the lines inside a live range.
		scenes: (sceneList as unknown as LiveSceneRow[]).map((row) =>
			conversationSceneOf(row, castOf)
		),
		scened: capturedMessageIds,
		hasOlder: !!pagination?.hasMore,
		loadingOlder: loadingOlderMessages,
		// 🚧 Which channels hold older lines (★7): each copy scrolls back through its own.
		...(Array.isArray(pagination?.olderIn) ? { olderIn: [...pagination!.olderIn] } : {}),
		extendRefusal,
		// 🚧 Back · Forward (RF fix 5): the server's state off the session; the
		// strip adds the owner rule and a reply being written.
		...(src.data.rewind
			? { rewind: { ahead: src.data.rewind.ahead, back: src.data.rewind.back, forward: src.data.rewind.forward } }
			: {}),
		// 🚧 pr-6s2 (I §I-1): the settle line — the conversation marks the newest settled line it shows.
		settledThrough: typeof (session as { settledLine?: unknown }).settledLine === "number" ? (session as { settledLine: number }).settledLine : null,
		isOwner: !isGuest,
		cast: {
			sessionPersonas: (session.sessionPersonas ?? []).map((cp) => ({
				personaId: cp.personaId ?? null,
				persona: cp.persona
					? { userId: cp.persona.userId ?? null }
					: null
			})),
			sessionCharacters: (session.sessionCharacters ?? []).map((cc) => ({
				characterId: cc.characterId ?? null
			}))
		},
		writes: { scenes: offersWrite("scenes"), lore: offersWrite("lore") },
		// 🚧 Scene boundaries (§7): the server's refusals, mirrored.
		sceneBoundaries: sceneBoundariesFor({
			isOwner: !isGuest,
			// 🚧 Every session has a book (own or shared): the server's openScene falls back to the own book.
			readsLorebook: sessionBookOf(session) != null,
			opensScenes: offersWrite("scenes"),
			// Off at either level (Personal > Lorebook > Session, 2026-10-21):
			// the owner's own setting, or the book's (on the joined row).
			loreWritesOff:
				loreWriteLimit({
					personal: effectiveLoreWriteMode(
						userSettingsCtx.settings?.loreWriteMode,
						systemSettingsCtx.settings?.loreWriteModeDefault
					),
					book: (session as { lorebook?: { loreWriteMode?: string } | null })
						.lorebook?.loreWriteMode as LoreWriteMode | undefined
				}).mode === "off"
		}),
		// 🚧 Suggested mode's *New scene?* chips (live scenes §4, lane D):
		// the owner's alone — deciding one is a boundary write.
		...(src.sceneCues && !isGuest
			? {
					sceneCues: src.sceneCues.cues.map((c) => ({
						id: c.id,
						channel: c.channel,
						messageId: c.messageId,
						triggers: [...c.triggers],
						reason: c.reason
					}))
				}
			: {}),
		// The session's summary mode: under Never no Summarize is offered (§5).
		...(src.sceneCues?.settings
			? { sceneSummaryMode: src.sceneCues.settings.summary }
			: {}),
		// 🚧 The book's calendar (§15 G9): the conversation spells its
		// dates — dividers, day marks, history markers — through it.
		storyCalendar: src.data.storyCalendar ?? null,
		debugPrompts:
			!!userCtx.user?.isAdmin &&
			!!systemSettingsCtx.settings?.contextDebuggingEnabled,
		selectForSummary,
		summaryEnded,
		composer: {
			draft: composerDraft,
			personas: userPersonasInSession
				.filter((cp) => cp.persona && cp.personaId != null)
				.map((cp) => ({
					personaId: cp.personaId!,
					name: cp.persona!.name
				})),
			personaId:
				currentUserPersona?.personaId ??
				// 🚧 Writing from their own card-less player seat: no persona.
				(!isGuest && !ownCardlessSeat
					? (session.sessionPersonas?.[0]?.personaId ?? null)
					: null),
			addPersona: showAddPersonaCTA,
			// 🚧 A guest's seat, offered on the story (Lair rewrite D5).
			...(showTakeSeatCTA ? { takeSeat: true } : {}),
			// "Write as Ann…" from the viewer's own card-less seat, else
			// "Write as the Dungeon Master…" (R4's label; S2).
			...(writingAs ? { playerLabel: writingAs } : {}),
			hidden: composerHidden,
			// 🚧 The lanes the genre closed this viewer's composer on, with
			// what each waits on (`set-composer-state@1`, owner ruling
			// 2026-10-15); absent when every composer is open.
			...(() => {
				const closed = composerClosuresFor(
					(session as { composerStates?: unknown }).composerStates,
					userCtx.user?.id ?? null
				)
				return Object.keys(closed).length ? { closed } : {}
			})(),
			channels: sessionChannels,
			// What each channel is called (S1): the strip and a pinned
			// copy's head read the Lair's `sanctum` as _Sanctum_.
			...(sessionFrames?.channelLabels
				? { channelLabels: sessionFrames.channelLabels }
				: {}),
			// What each channel IS (B3, 2026-10-11): a `folio` channel's copy
			// reads as prose unless its `presentation` setting says otherwise.
			...(sessionFrames?.channelRoles
				? { channelRoles: sessionFrames.channelRoles }
				: {}),
			usage: draftCompiledPrompt?.meta?.tokenCounts
				? {
						total: draftCompiledPrompt.meta.tokenCounts.total,
						limit: draftCompiledPrompt.meta.tokenCounts.limit
					}
				: null,
			// A member has the turn controls too (round 2, 2026-10-15): the
			// server's listing and its door decide what is in them; the
			// owner's own tools (Lore, Statistics) stay the owner's.
			tabs: isGuest
				? [
						{
							view: "session-controls",
							title: "Turn controls",
							icon: "message-square"
						}
					]
				: [
						{
							view: "session-controls",
							title: "Turn controls",
							icon: "message-square"
						},
						...(session.lorebookId
							? [
									{
										view: "session-workflow",
										title: "Lore",
										icon: "book-open"
									}
								]
							: []),
						// ⏳ "Pinned images" ("scene-images") is gone (W6):
						// Scene Portraits chooses its own images.
						...(systemSettingsCtx.settings?.contextDebuggingEnabled
							? [
									{
										view: "session-statistics",
										title: "Statistics",
										icon: "bar-chart-2"
									}
								]
							: [])
					],
			actions: sessionActions.length > 0,
			notice: embeddingsStarred(systemSettingsCtx.capabilityDefaults),
			overflow: snapshot(composerMenuActions) as unknown[],
			palette: snapshot(paletteActions) as unknown[],
			newest: newestItem ? snapshot(newestItem) : null,
			sendTonal: shouldShowNextCharacterBlock,
			tray: composerTray.view,
			attachments: composerTray.readers
		},
		turn: {
			order: snapshot(
				turnOrder?.order ?? []
			) as ConversationDossierV1["turn"]["order"],
			candidates: snapshot(
				turnOrder?.candidates ?? []
			) as ConversationDossierV1["turn"]["candidates"],
			// 🚧 pr-6 (R-k): an archived session offers no next turn — its
			// composer is closed by the server, and the turn line goes with it.
			show: shouldShowNextCharacterBlock && !(session as { archivedAt?: unknown }).archivedAt,
			canChoose: canChooseDifferentCharacter,
			ownVoiceName: ownVoice,
			// 🚧 Who the round waits on once the viewer has had their say
			// (PLAN-dc-after-walk2 Q3-3): "Waiting for Maren Holt".
			...(() => {
				const states = (session as { composerStates?: unknown }).composerStates
				const cast = (stateStore.state?.cast ?? {}) as Record<string, unknown>
				const byId = (cast.byId ?? {}) as Record<string, Record<string, unknown> | undefined>
				const waitingFor = roundWaitingFor({
					seats: session.sessionPersonas as never,
					rows: session.sessionMessages as never,
					viewerUserId: userCtx.user?.id ?? null,
					preparedOnStory: (turnOrder?.order ?? []).filter(
						(e) => ((e as { channel?: unknown }).channel ?? "main") === "main"
					).length,
					fateOf: (ref) => {
						const key = ref.startsWith("player-seat:") ? `player_seat:${ref.slice(12)}` : ref.replace(/^character:/, "")
						const bag = byId[key]
						const fate = bag?.["core.fate"] ?? bag?.fate
						return typeof fate === "string" ? fate : null
					},
					storyClosedFor: (uid) => Object.hasOwn(composerClosuresFor(states, uid), "main")
				})
				return waitingFor.length ? { waitingFor } : {}
			})()
		},
		readOnly: modeMissing
			? { genreId: ((session as any)?.genreId as string | null) ?? null }
			: null,
		state: {
			ledgers: Object.fromEntries(
				session.sessionMessages
					.map((m) => [m.id, stateStore.ledgerFor(m.id)] as const)
					.filter(([, groups]) => groups.length)
			) as ConversationDossierV1["state"]["ledgers"],
			// 🚧 The ledger head (§15 G13): clock moves made before any line.
			head: stateStore.ledgerHead() as NonNullable<ConversationDossierV1["state"]["head"]>,
			pending: Object.fromEntries(
				session.sessionMessages
					.map(
						(m) =>
							[
								m.id,
								stateStore
									.pendingFor(m.id)
									.map(describeProposalRow)
							] as const
					)
					.filter(([, rows]) => rows.length)
			),
			waiting: stateStore.pending.map(describeProposalRow)
		},
		appBackground: !!userSettingsCtx.settings?.backgroundImagePath
	}
}
