/**
 * 🚧 The asks a widget's request is waiting on a socket reply for
 * (`requests/pendingAsks.ts`) — one table per event, so a reply settles
 * exactly one ask and a reply nobody here asked for (another tab's) settles
 * none. The sprite-set reply is heard on the page's inbox (its standing
 * `sessions:setSpriteSet` interest); the lore and author's-note tables listen
 * only while an ask waits. `drop` rejects every waiting ask: the page closed,
 * or another session opened in it (plan B8). `runOfMessage` asks which run
 * wrote a reply, listening only until it is answered.
 */
import { declareInterest } from "$lib/client/sockets/interest.svelte"
import { toaster } from "$lib/client/utils/toaster"
import { createPendingAsks } from "$lib/client/components/sessionPage/requests/pendingAsks"
import { runThatWrote } from "$lib/client/components/sessionPage/runInspection"
import {
	settleSpriteSetReply,
	spriteSetReplyKey,
	spriteSetWrite
} from "$lib/client/components/sessionPage/requests/setSpriteSet"
import {
	hearSessionEntries,
	sessionEntriesReplyKey,
	tokenedEntriesRead
} from "$lib/client/components/sessionPage/requests/sessionEntries"
import {
	entryMarksReplyKey,
	entryMarksWrite
} from "$lib/client/components/sessionPage/requests/setEntryMarks"
import {
	authorsNoteReplyKey,
	tokenedAsk
} from "$lib/client/components/sessionPage/requests/authorsNote"
import { storyClockReplyKey } from "$lib/client/components/sessionPage/requests/storyClock"
import { sessionPlacesReplyKey } from "$lib/client/components/sessionPage/requests/sessionPlaces"
import { statTrailReplyKey } from "$lib/client/components/sessionPage/requests/statTrail"
import { backdropReplyKey } from "$lib/client/components/sessionPage/requests/setBackdrop"
import { ownerFaceReplyKey } from "$lib/client/components/sessionPage/requests/setOwnerFace"
import { giveReplyKey } from "$lib/client/components/sessionPage/requests/givePiece"
import { tieShownReplyKey } from "$lib/client/components/sessionPage/requests/setTieShown"
import { attributeCarryReplyKey } from "$lib/client/components/sessionPage/requests/setAttributeCarry"
import type { HistoryRow } from "$lib/client/components/sessionPage/requests/historyEntries"
import { awaitReply } from "$lib/client/utils/awaitReply"
import { interestKey } from "$lib/shared/sockets/interest"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import type { LineBranch } from "$lib/shared/lorebooks/lineReading"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import type { SessionPageInbox } from "$lib/client/components/sessionPage/sessionPageInbox.svelte"

export interface PageAsksDeps {
	socket: TypedSocket
	inbox: SessionPageInbox
	/** The session in the route. */
	sessionId(): number
}

/** The page's ask tables and the reads and writes built on them. */
export function createPageAsks(d: PageAsksDeps) {
	const socket = d.socket

	const spriteSetAsks = createPendingAsks<
		Sockets.Sessions.SetSpriteSet.Params,
		Sockets.Sessions.SetSpriteSet.Response
	>({
		emit: (ask) => socket.emit("sessions:setSpriteSet", ask),
		keyOf: spriteSetReplyKey,
		timeout: "the sprite set did not change: the server did not answer"
	})
	const entriesAsks = createPendingAsks<
		Sockets.Entries.SessionEntries.Params,
		Sockets.Entries.SessionEntries.Response
	>({
		emit: (ask) => socket.emit("entries:sessionEntries", ask),
		listen: hearSessionEntries({
			reply: (onReply) =>
				declareInterest<"entries:sessionEntries">(
					"entries:sessionEntries",
					onReply
				),
			refusal: (onRefusal) =>
				declareInterest<"entries:sessionEntries:error">(
					"entries:sessionEntries:error",
					onRefusal
				)
		}),
		keyOf: sessionEntriesReplyKey,
		timeout: "the lore entries did not arrive: the server did not answer"
	})
	const readSessionEntries = tokenedEntriesRead(entriesAsks)
	const entryMarksAsks = createPendingAsks<
		Sockets.Entries.SetMarks.Params,
		Sockets.Entries.SetMarks.Response
	>({
		emit: (ask) => socket.emit("entries:setMarks", ask),
		listen: (onReply) => {
			const refused = declareInterest<"entries:setMarks:error">(
				"entries:setMarks:error",
				onReply
			)
			const done = declareInterest<"entries:setMarks">(
				"entries:setMarks",
				onReply
			)
			return () => {
				done()
				refused()
			}
		},
		keyOf: entryMarksReplyKey,
		timeout: "the marks did not change: the server did not answer"
	})
	const writeEntryMarks = entryMarksWrite(entryMarksAsks)
	// 🚧 The author's note (AN1): one table per event, each ask tokened.
	const authorsNoteAsks = createPendingAsks<
		Sockets.Sessions.AuthorsNote.Params,
		Sockets.Sessions.AuthorsNote.Response
	>({
		emit: (ask) => socket.emit("sessions:authorsNote", ask),
		listen: (onReply) => {
			const refused = declareInterest<"sessions:authorsNote:error">(
				"sessions:authorsNote:error",
				onReply
			)
			const done = declareInterest<"sessions:authorsNote">(
				"sessions:authorsNote",
				onReply
			)
			return () => {
				done()
				refused()
			}
		},
		keyOf: authorsNoteReplyKey,
		timeout: "the author's note did not arrive: the server did not answer"
	})
	const setAuthorsNoteAsks = createPendingAsks<
		Sockets.Sessions.SetAuthorsNote.Params,
		Sockets.Sessions.SetAuthorsNote.Response
	>({
		emit: (ask) => socket.emit("sessions:setAuthorsNote", ask),
		listen: (onReply) => {
			const refused = declareInterest<"sessions:setAuthorsNote:error">(
				"sessions:setAuthorsNote:error",
				onReply
			)
			const done = declareInterest<"sessions:setAuthorsNote">(
				"sessions:setAuthorsNote",
				onReply
			)
			return () => {
				done()
				refused()
			}
		},
		keyOf: authorsNoteReplyKey,
		timeout: "the author's note was not saved: the server did not answer"
	})
	// 🚧 Chronicle (W3): the session's story clock, read and moved — one
	// table per event, each ask tokened, as the author's note's.
	const storyClockAsks = createPendingAsks<
		Sockets.Sessions.StoryClock.Params,
		Sockets.Sessions.StoryClock.Response
	>({
		emit: (ask) => socket.emit("sessions:storyClock", ask),
		listen: (onReply) => {
			const refused = declareInterest<"sessions:storyClock:error">(
				"sessions:storyClock:error",
				onReply
			)
			const done = declareInterest<"sessions:storyClock">(
				"sessions:storyClock",
				onReply
			)
			return () => {
				done()
				refused()
			}
		},
		keyOf: storyClockReplyKey,
		timeout: "the story clock did not arrive: the server did not answer"
	})
	const setStoryClockAsks = createPendingAsks<
		Sockets.Sessions.SetStoryClock.Params,
		Sockets.Sessions.SetStoryClock.Response
	>({
		emit: (ask) => socket.emit("sessions:setStoryClock", ask),
		listen: (onReply) => {
			const refused = declareInterest<"sessions:setStoryClock:error">(
				"sessions:setStoryClock:error",
				onReply
			)
			const done = declareInterest<"sessions:setStoryClock">(
				"sessions:setStoryClock",
				onReply
			)
			return () => {
				done()
				refused()
			}
		},
		keyOf: storyClockReplyKey,
		timeout: "the story clock did not move: the server did not answer"
	})
	// 🚧 Places (W4): the session's places and ways, read — tokened, as the clock's.
	const placesAsks = createPendingAsks<
		Sockets.Sessions.Places.Params,
		Sockets.Sessions.Places.Response
	>({
		emit: (ask) => socket.emit("sessions:places", ask),
		listen: (onReply) => {
			const refused = declareInterest<"sessions:places:error">(
				"sessions:places:error",
				onReply
			)
			const done = declareInterest<"sessions:places">(
				"sessions:places",
				onReply
			)
			return () => {
				done()
				refused()
			}
		},
		keyOf: sessionPlacesReplyKey,
		timeout: "the places did not arrive: the server did not answer"
	})
	// 🚧 Stats (F2): one stat's trail, read — tokened, as the places'.
	const statTrailAsks = createPendingAsks<
		Sockets.Sessions.StatTrail.Params,
		Sockets.Sessions.StatTrail.Response
	>({
		emit: (ask) => socket.emit("sessions:statTrail", ask),
		listen: (onReply) => {
			const refused = declareInterest<"sessions:statTrail:error">(
				"sessions:statTrail:error",
				onReply
			)
			const done = declareInterest<"sessions:statTrail">(
				"sessions:statTrail",
				onReply
			)
			return () => {
				done()
				refused()
			}
		},
		keyOf: statTrailReplyKey,
		timeout: "the stat's changes did not arrive: the server did not answer"
	})
	// 🚧 Backdrop (DESIGN-image-generation §6.4): set or clear, each ask tokened.
	const backdropAsks = createPendingAsks<
		Sockets.Sessions.SetBackdrop.Params,
		Sockets.Sessions.SetBackdrop.Response
	>({
		emit: (ask) => socket.emit("sessions:setBackdrop", ask),
		listen: (onReply) => {
			const refused = declareInterest<"sessions:setBackdrop:error">(
				"sessions:setBackdrop:error",
				onReply
			)
			const done = declareInterest<"sessions:setBackdrop">(
				"sessions:setBackdrop",
				onReply
			)
			return () => {
				done()
				refused()
			}
		},
		keyOf: backdropReplyKey,
		timeout: "the backdrop did not change: the server did not answer"
	})
	// 🚧 Stats (PLAN-sheet §12): a player seat's portrait, each ask tokened.
	const ownerFaceAsks = createPendingAsks<
		Sockets.State.SetOwnerFace.Params,
		Sockets.State.SetOwnerFace.Response
	>({
		emit: (ask) => socket.emit("state:setOwnerFace", ask),
		listen: (onReply) => {
			const refused = declareInterest<"state:setOwnerFace:error">(
				"state:setOwnerFace:error",
				onReply
			)
			const done = declareInterest<"state:setOwnerFace">(
				"state:setOwnerFace",
				onReply
			)
			return () => {
				done()
				refused()
			}
		},
		keyOf: ownerFaceReplyKey,
		timeout: "the portrait did not change: the server did not answer"
	})
	// 🚧 Stats (★4): Give to…, each ask tokened.
	const giveAsks = createPendingAsks<Sockets.State.GivePiece.Params, Sockets.State.GivePiece.Response>({
		emit: (ask) => socket.emit("state:givePiece", ask),
		listen: (onReply) => {
			const refused = declareInterest<"state:givePiece:error">("state:givePiece:error", onReply)
			const done = declareInterest<"state:givePiece">("state:givePiece", onReply)
			return () => {
				done()
				refused()
			}
		},
		keyOf: giveReplyKey,
		timeout: "nothing was given: the server did not answer"
	})

	/** 🚧 A tie side shown or hidden (ties on the graph, screen 2), settled on its own reply. */
	const tieShownAsks = createPendingAsks<Sockets.State.ShowTieSide.Params, Sockets.State.ShowTieSide.Response>({
		emit: (ask) => socket.emit("state:showTieSide", ask),
		listen: (onReply) => {
			const refused = declareInterest<"state:showTieSide:error">("state:showTieSide:error", onReply)
			const done = declareInterest<"state:showTieSide">("state:showTieSide", onReply)
			return () => {
				done()
				refused()
			}
		},
		keyOf: tieShownReplyKey,
		timeout: "nothing was shown: the server did not answer"
	})

	/** 🚧 An optional attribute carried or not (RF fix 8), settled on its own reply. */
	const carryAsks = createPendingAsks<Sockets.State.SetCarry.Params, Sockets.State.SetCarry.Response & { error?: string }>({
		emit: (ask) => socket.emit("state:setCarry", ask),
		listen: (onReply) => {
			const refused = declareInterest<"state:setCarry:error">("state:setCarry:error", onReply as never)
			const done = declareInterest<"state:setCarry">("state:setCarry", onReply)
			return () => {
				done()
				refused()
			}
		},
		keyOf: attributeCarryReplyKey,
		timeout: "nothing changed: the server did not answer"
	})

	/**
	 * The book's history entries (`entries:list`), its lines
	 * (`lorebooks:lines`) and its next date (`entries:iterateNext`) — the
	 * three the composer's Lore pane asked, each on the book's scoped key
	 * and settled on its own reply. The book owner's alone: the server
	 * refuses anyone else, and the refusal is the asking widget's.
	 */
	const readHistory = async (lorebookId: number): Promise<HistoryRow[]> => {
		const reply = await awaitReply({
			socket,
			event: "entries:list",
			params: {
				lorebookId,
				typeId: HISTORY_TYPE_ID
			} satisfies Sockets.Entries.List.Params,
			replyKey: interestKey("entries:list", lorebookId),
			errorEvent: "entries:list:error",
			fallbackError: "the history entries could not be read",
			match: (data) =>
				data.lorebookId === lorebookId && data.typeId === HISTORY_TYPE_ID
		})
		return reply.entryList as unknown as HistoryRow[]
	}
	const readLines = async (lorebookId: number): Promise<LineBranch[]> => {
		const reply = await awaitReply({
			socket,
			event: "lorebooks:lines",
			params: { lorebookId },
			replyKey: interestKey("lorebooks:lines", lorebookId),
			errorEvent: "lorebooks:lines:error",
			fallbackError: "the lorebook's lines could not be read",
			match: (data) => data.lorebookId === lorebookId
		})
		return reply.lines
			.filter((line) => line.id != null)
			.map((line) => ({
				id: line.id as number,
				forkedFromBranchId: line.forkedFromBranchId,
				forkYear: line.forkYear,
				forkMonth: line.forkMonth,
				forkDay: line.forkDay
			}))
	}
	/**
	 * 🚧 One character's gallery (W6, `character-images`): the character
	 * panel's own read, on its scoped key, settled on the reply naming that
	 * character — its refusal too, which echoes the id.
	 */
	const readCharacterGallery = async (
		characterId: number
	): Promise<Sockets.Media[]> => {
		const reply = await awaitReply({
			socket,
			event: "characters:listGallery",
			params: { characterId },
			replyKey: interestKey("characters:listGallery", characterId),
			errorEvent: "characters:listGallery:error",
			matchError: (data) =>
				(data as { characterId?: number })?.characterId === characterId,
			fallbackError: "the character's images could not be read",
			match: (data) => data.characterId === characterId
		})
		return reply.images
	}
	let nextEntryAsked = 0
	const startNextEntry = async (ask: {
		lorebookId: number
		id: number
		branchId: number | null
	}): Promise<number> => {
		const requestId = `widget-next-entry:${++nextEntryAsked}:${Math.random().toString(36).slice(2, 8)}`
		const reply = await awaitReply({
			socket,
			event: "entries:iterateNext",
			params: {
				id: ask.id,
				typeId: HISTORY_TYPE_ID,
				branchId: ask.branchId,
				requestId
			} satisfies Sockets.Entries.IterateNext.Params,
			replyKey: interestKey("entries:iterateNext", ask.lorebookId),
			errorEvent: "entries:iterateNext:error",
			matchError: (data) =>
				(data as { requestId?: string })?.requestId === requestId,
			fallbackError: "the next history entry could not be made",
			match: (data) => data.requestId === requestId
		})
		if (typeof reply.entry?.id !== "number")
			throw new Error("the server did not say which entry it made")
		return reply.entry.id
	}

	/**
	 * 🚧 Live scenes (PROPOSAL-live-scenes §14 C): the conversation's scene
	 * boundaries — `scenes:open`, `scenes:close`, `scenes:moveBoundary` —
	 * each settled on ITS reply by `requestId`, the reply heard on the
	 * session's scoped key and the refusal (echoing the id) said by the
	 * asking widget. 🚧 Lane E: the rename (`scenes:update`), the removal
	 * (`scenes:delete`) and the merge (`scenes:merge`) carry one too, so
	 * their refusals are the divider's to say (Layout leaves a refusal that
	 * names its asker alone).
	 */
	let sceneAsked = 0
	const sceneRequestId = (what: string) =>
		`widget-scene-${what}:${++sceneAsked}:${Math.random().toString(36).slice(2, 8)}`
	const openScene = (ask: {
		sessionId: number
		channel: string
		atMessageId: number
		/** 🚧 Opens closed, over the run (lane E). */
		closeAt?: number
	}): Promise<Sockets.Scenes.LiveSceneReply> => {
		const requestId = sceneRequestId("open")
		return awaitReply({
			socket,
			event: "scenes:open",
			params: { ...ask, requestId } satisfies Sockets.Scenes.Open.Params,
			replyKey: interestKey("scenes:open", ask.sessionId),
			errorEvent: "scenes:open:error",
			matchError: (data) =>
				(data as { requestId?: string })?.requestId === requestId,
			fallbackError: "the scene could not be opened",
			match: (data) => data.requestId === requestId
		})
	}
	const closeScene = (ask: {
		sessionId: number
		sceneId: number
		atMessageId?: number
	}): Promise<Sockets.Scenes.LiveSceneReply> => {
		const requestId = sceneRequestId("close")
		const { sessionId, ...params } = ask
		return awaitReply({
			socket,
			event: "scenes:close",
			params: { ...params, requestId } satisfies Sockets.Scenes.Close.Params,
			replyKey: interestKey("scenes:close", sessionId),
			errorEvent: "scenes:close:error",
			matchError: (data) =>
				(data as { requestId?: string })?.requestId === requestId,
			fallbackError: "the scene could not be closed",
			match: (data) => data.requestId === requestId
		})
	}
	const moveSceneBoundary = (ask: {
		sessionId: number
		sceneId: number
		openedAt?: number
		/** 🚧 `null` reopens the scene (lane E). */
		closedAt?: number | null
	}): Promise<Sockets.Scenes.LiveSceneReply> => {
		const requestId = sceneRequestId("move")
		const { sessionId, ...params } = ask
		return awaitReply({
			socket,
			event: "scenes:moveBoundary",
			params: {
				...params,
				requestId
			} satisfies Sockets.Scenes.MoveBoundary.Params,
			replyKey: interestKey("scenes:moveBoundary", sessionId),
			errorEvent: "scenes:moveBoundary:error",
			matchError: (data) =>
				(data as { requestId?: string })?.requestId === requestId,
			fallbackError: "the scene's boundary could not be moved",
			match: (data) => data.requestId === requestId
		})
	}
	const renameScene = async (ask: {
		sceneId: number
		name: string | null
	}): Promise<void> => {
		const requestId = sceneRequestId("rename")
		await awaitReply({
			socket,
			event: "scenes:update",
			params: {
				scene: { id: ask.sceneId, name: ask.name },
				requestId
			} satisfies Sockets.Scenes.Update.Params,
			errorEvent: "scenes:update:error",
			matchError: (data) =>
				(data as { requestId?: string })?.requestId === requestId,
			fallbackError: "the scene was not renamed",
			match: (data) =>
				data.requestId === requestId || data.scene?.id === ask.sceneId
		})
	}
	const deleteScene = async (sceneId: number): Promise<void> => {
		const requestId = sceneRequestId("delete")
		const reply = await awaitReply({
			socket,
			event: "scenes:delete",
			params: { id: sceneId, requestId } satisfies Sockets.Scenes.Delete.Params,
			errorEvent: "scenes:delete:error",
			matchError: (data) =>
				(data as { requestId?: string })?.requestId === requestId,
			fallbackError: "the scene was not removed",
			match: (data) => data.requestId === requestId || data.id === sceneId
		})
		if (reply.error) throw new Error(reply.error)
	}
	/** 🚧 `scenes:merge` (lane E): the scene joins the one before it on its lane. */
	const mergeScene = (ask: {
		sessionId: number
		sceneId: number
	}): Promise<Sockets.Scenes.Merge.Response> => {
		const requestId = sceneRequestId("merge")
		const { sessionId, ...params } = ask
		return awaitReply({
			socket,
			event: "scenes:merge",
			params: { ...params, requestId } satisfies Sockets.Scenes.Merge.Params,
			replyKey: interestKey("scenes:merge", sessionId),
			errorEvent: "scenes:merge:error",
			matchError: (data) =>
				(data as { requestId?: string })?.requestId === requestId,
			fallbackError: "the scenes could not be joined",
			match: (data) => data.requestId === requestId
		})
	}

	const readAuthorsNote = tokenedAsk(authorsNoteAsks, "widget-authors-note")
	const writeAuthorsNote = tokenedAsk(
		setAuthorsNoteAsks,
		"widget-set-authors-note"
	)

	/**
	 * Which run wrote a reply (R55; `runInspection.ts`), for the conversation's
	 * `inspect-run` request below: the page asks the server and opens the
	 * inspector, so the conversation reaches neither the socket nor the store.
	 */
	const runOfMessage = (messageId: number): Promise<string | null> =>
		new Promise((resolve) => {
			let done = false
			const finish = (runId: string | null) => {
				if (done) return
				done = true
				release()
				clearTimeout(timer)
				resolve(runId)
			}
			// BARE: `pipelines:artifactRuns` is not a scoped event; the
			// kind/entity check is the filter.
			const release = declareInterest<"pipelines:artifactRuns">(
				"pipelines:artifactRuns",
				(res) => {
					if (res.kind !== "message" || res.entityId !== messageId)
						return
					finish(runThatWrote(res.runs))
				}
			)
			const timer = setTimeout(() => finish(null), 15_000)
			socket.emit("pipelines:artifactRuns", {
				kind: "message",
				entityId: messageId
			})
		})

	/**
	 * 🚧 What the session's routines did (`routine-log`, A7; lane 7): one
	 * `sessions:routineLog` for this session, settled on the first reply for
	 * it. The log names no token, and one widget asks it at a time
	 * (`maxInstances: 1`), so the session id is the filter.
	 */
	const readRoutineLog = (
		ask: Sockets.Sessions.RoutineLog.Params
	): Promise<Sockets.Sessions.RoutineLog.Response> =>
		new Promise((resolve, reject) => {
			let done = false
			const finish = (fn: () => void) => {
				if (done) return
				done = true
				release()
				clearTimeout(timer)
				fn()
			}
			// BARE: `sessions:routineLog` is not a scoped event; the session id is the filter.
			const release = declareInterest<"sessions:routineLog">("sessions:routineLog", (res) => {
				if (res?.sessionId !== ask.sessionId) return
				finish(() => resolve(res))
			})
			const timer = setTimeout(
				() => finish(() => reject(new Error("the server did not answer"))),
				15_000
			)
			socket.emit("sessions:routineLog", ask)
		})

	// A widget's `set-sprite-set` owns its reply, refusal included (R77).
	d.inbox.on("sessions:setSpriteSet", (msg) =>
		settleSpriteSetReply(msg, spriteSetAsks, d.sessionId(), (title) =>
			toaster.error({ title })
		)
	)

	return {
		writeSpriteSet: spriteSetWrite(spriteSetAsks),
		readSessionEntries,
		writeEntryMarks,
		readAuthorsNote,
		writeAuthorsNote,
		readStoryClock: tokenedAsk(storyClockAsks, "widget-story-clock"),
		writeStoryClock: tokenedAsk(setStoryClockAsks, "widget-set-story-clock"),
		readHistory,
		readLines,
		startNextEntry,
		readSessionPlaces: tokenedAsk(placesAsks, "widget-places"),
		readCharacterGallery,
		readStatTrail: tokenedAsk(statTrailAsks, "widget-stat-trail"),
		readRoutineLog,
		writeBackdrop: tokenedAsk(backdropAsks, "widget-set-backdrop"),
		writeOwnerFace: tokenedAsk(ownerFaceAsks, "widget-set-owner-face"),
		writeGive: tokenedAsk(giveAsks, "widget-give-piece"),
		writeTieShown: tokenedAsk(tieShownAsks, "widget-set-tie-shown"),
		writeCarry: tokenedAsk(carryAsks, "widget-set-attribute-carry"),
		openScene,
		closeScene,
		moveSceneBoundary,
		renameScene,
		deleteScene,
		mergeScene,
		runOfMessage,
		/** Rejects every waiting ask, saying why. */
		drop(why: string) {
			spriteSetAsks.drop(why)
			entriesAsks.drop(why)
			entryMarksAsks.drop(why)
			authorsNoteAsks.drop(why)
			setAuthorsNoteAsks.drop(why)
			storyClockAsks.drop(why)
			setStoryClockAsks.drop(why)
			placesAsks.drop(why)
			statTrailAsks.drop(why)
			backdropAsks.drop(why)
			ownerFaceAsks.drop(why)
			giveAsks.drop(why)
			tieShownAsks.drop(why)
			carryAsks.drop(why)
		}
	}
}

/** The session page's ask tables (`createPageAsks`). */
export type PageAsks = ReturnType<typeof createPageAsks>
