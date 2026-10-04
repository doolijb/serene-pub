/**
 * B8's request storm (lorebooks consolidation plan, 2026-09-29), measured on
 * the children the session page mounts.
 *
 * The page replaces `session` WHOLESALE on every streamed chunk
 * (`handleSessionMessage`: `session = { ...currentSession, sessionMessages }`).
 * A prop written `lorebookId={session.lorebookId}` is a bare member chain,
 * which Svelte compiles to a getter over `session` rather than a memoised
 * `$derived` — so an effect in the child that reads the prop tracks the whole
 * object and re-runs per token, though the id never moved. SessionWorkflowTab
 * re-declared its interest keys and re-asked `lorebooks:storyTime` and
 * `entries:list` (a DB query per token); RunProgressCard re-declared its two;
 * RagNotice re-asked `vectorization:checkRagStatus`; SessionRetrievalPreview
 * cleared the answer on screen.
 *
 * The props below are handed exactly that getter (the page's old spelling,
 * compiled), and a reply streams N chunks. A child reading its ids through a
 * `$derived` re-runs only when the id actually changes: nothing is asked or
 * declared again after the first. (The page's own effects are pinned from its
 * source in `streamedSessionReads.test.ts`; the page itself is not mountable
 * here.)
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

/** Every key a view hands `declareInterest`, in order — a re-declare shows as a repeat. */
const declared = vi.hoisted(() => [] as string[])
vi.mock("$lib/client/sockets/interest.svelte", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/client/sockets/interest.svelte")>()
	return {
		...real,
		declareInterest: ((key: string, handler: (data: unknown) => void) => {
			declared.push(key)
			return real.declareInterest(key as never, handler)
		}) as typeof real.declareInterest
	}
})

import { setSocket } from "$lib/client/sockets/socketInstance"
import { _resetInterestForTests, setInterestUser } from "$lib/client/sockets/interest.svelte"
import SessionWorkflowTab from "./SessionWorkflowTab.svelte"
import RagNotice from "./RagNotice.svelte"
import RunProgressCard from "../pipelines/RunProgressCard.svelte"
import SessionRetrievalPreview from "../pipelines/workspace/SessionRetrievalPreview.svelte"

type Listener = (payload: any) => void
function makeClientSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		id: "tab-a",
		emits: [] as Array<{ event: string; payload: any }>,
		on(event: string, fn: Listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), fn])
		},
		off(event: string, fn: Listener) {
			const arr = listeners.get(event) ?? []
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
		},
		emit(event: string, payload: any) {
			this.emits.push({ event, payload })
		},
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		}
	}
}

/** The reply being streamed, one chunk at a time. */
const CHUNKS = 40
const SESSION_ID = 7
const BOOK_ID = 3
const BRANCH_ID = 12

type Row = { id: number; content: string; isGenerating: boolean }
type StreamedSession = {
	id: number
	lorebookId: number | null
	lorebookBranchId: number | null
	sessionMessages: Row[]
}

function freshSession(): StreamedSession {
	return {
		id: SESSION_ID,
		lorebookId: BOOK_ID,
		lorebookBranchId: BRANCH_ID,
		sessionMessages: [
			{ id: 1, content: "Hello.", isGenerating: false },
			{ id: 2, content: "", isGenerating: true }
		]
	}
}

/** The page's `session`: replaced, never mutated, per chunk. */
let session = $state<StreamedSession>(freshSession())

/** One streamed chunk, as `handleSessionMessage` applies it. */
function streamChunk(n: number) {
	const current = session
	const rows = [...current.sessionMessages]
	const last = rows[rows.length - 1]
	rows[rows.length - 1] = { ...last, content: `${last.content} token${n}` }
	session = { ...current, sessionMessages: rows }
	flushSync()
}

function streamReply() {
	for (let n = 0; n < CHUNKS; n++) streamChunk(n)
}

let client: ReturnType<typeof makeClientSocket>
let apps: ReturnType<typeof mount>[] = []

beforeEach(() => {
	session = freshSession()
	declared.length = 0
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: true })
})

afterEach(() => {
	for (const app of apps) unmount(app)
	apps = []
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

function place<P extends Record<string, any>>(component: any, props: P) {
	const target = document.createElement("div")
	document.body.append(target)
	apps.push(mount(component, { target, props }))
	flushSync()
}

/** Frames of `event` this tab has put on the wire so far. */
const sent = (event: string) => client.emits.filter((e) => e.event === event).length
/** Every frame on the wire so far, whatever its event. */
const frames = () => client.emits.length

describe("a streamed reply asks the server nothing the ids did not change", () => {
	test("SessionWorkflowTab: storyTime / entries:list / lorebooks:lines and its eight keys, once", () => {
		place(SessionWorkflowTab, {
			// The page's `lorebookId={session.lorebookId}`, as compiled.
			get lorebookId() {
				return session.lorebookId
			},
			get branchId() {
				return session.lorebookBranchId
			},
			sceneList: [],
			onOpenEntry: () => {}
		})
		const before = {
			storyTime: sent("lorebooks:storyTime"),
			entriesList: sent("entries:list"),
			lines: sent("lorebooks:lines"),
			declares: declared.length,
			frames: frames()
		}
		expect(before.storyTime).toBe(1)
		expect(before.entriesList).toBe(1)
		// The lines alone (plan B6), never the whole amendments list.
		expect(before.lines).toBe(1)
		expect(sent("amendments:list")).toBe(0)
		// The story time family's three and the lines (`BookTime.listen`),
		// and the four entry keys.
		expect(before.declares).toBe(8)

		streamReply()

		expect({
			storyTime: sent("lorebooks:storyTime") - before.storyTime,
			entriesList: sent("entries:list") - before.entriesList,
			lines: sent("lorebooks:lines") - before.lines,
			redeclares: declared.length - before.declares,
			frames: frames() - before.frames
		}).toEqual({ storyTime: 0, entriesList: 0, lines: 0, redeclares: 0, frames: 0 })
	})

	test("SessionWorkflowTab: a real book change still re-keys and re-asks, once", () => {
		place(SessionWorkflowTab, {
			get lorebookId() {
				return session.lorebookId
			},
			get branchId() {
				return session.lorebookBranchId
			},
			sceneList: [],
			onOpenEntry: () => {}
		})
		streamReply()
		const storyTime = sent("lorebooks:storyTime")
		const entriesList = sent("entries:list")

		session = { ...session, lorebookId: 4 }
		flushSync()

		expect(sent("lorebooks:storyTime") - storyTime).toBe(1)
		expect(sent("entries:list") - entriesList).toBe(1)
		expect(client.emits.at(-1)).toMatchObject({ event: "entries:list", payload: { lorebookId: 4 } })
		expect(declared).toContain("entries:list#4")
	})

	test("RunProgressCard: its two scoped keys are declared once", () => {
		place(RunProgressCard, {
			get sessionId() {
				return session.id
			}
		})
		const before = declared.length
		expect(before).toBe(2)

		streamReply()

		expect(declared.length - before).toBe(0)
	})

	test("RagNotice: checkRagStatus is asked once, not per token", () => {
		place(RagNotice, {
			get sessionId() {
				return session.id
			},
			// The page's `totalMessages={session.sessionMessages?.length ?? 0}`
			// is already memoised by the compiler; the count does not move
			// while one reply streams.
			get totalMessages() {
				return session.sessionMessages.length
			}
		})
		const before = sent("vectorization:checkRagStatus")
		expect(before).toBe(1)

		streamReply()

		expect(sent("vectorization:checkRagStatus") - before).toBe(0)
	})

	test("SessionRetrievalPreview: the answer on screen survives the stream", () => {
		place(SessionRetrievalPreview, {
			get sessionId() {
				return session.id
			},
			content: "",
			personaId: null,
			disabledReason: null
		})
		const ask = [...document.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("What would fire now")
		)!
		ask.click()
		flushSync()
		expect(sent("pipelines:previewRetrieval")).toBe(1)
		// The answer is claimed by the press's own id (plan B8).
		const asked = client.emits.find(
			(e) => e.event === "pipelines:previewRetrieval"
		)!.payload
		client.dispatch("pipelines:previewRetrieval", {
			requestId: asked.requestId,
			sessionId: SESSION_ID,
			explanation: {
				rows: [],
				notes: ["The Harbour entry would come in."],
				warnings: [],
				bands: [],
				ranked: true,
				omitted: 0
			}
		})
		flushSync()
		expect(document.body.textContent).toContain("The Harbour entry would come in.")

		streamReply()

		expect(document.body.textContent).toContain("The Harbour entry would come in.")
	})
})
