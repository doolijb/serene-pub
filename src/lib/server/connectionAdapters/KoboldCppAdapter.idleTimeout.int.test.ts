/**
 * Round-7 audit fix: KoboldCppAdapter's streaming path used to have no
 * hang-protection at all beyond user-triggered cancel. The fix is
 * idle-based (resets on every received chunk), not a flat wall-clock cap —
 * this app's core audience is slow, self-hosted local inference, where a
 * long response can legitimately take many minutes to stream while
 * actively producing tokens the whole time. This test proves the
 * distinction actually holds against a real HTTP server (not a mocked
 * fetch): a server that accepts the connection and never writes anything
 * gets aborted once idle-timeout elapses, while a server that trickles a
 * chunk every interval well inside the idle window is never aborted, even
 * once the *cumulative* wall-clock time exceeds that window.
 *
 * LLM_IDLE_TIMEOUT_MS is shrunk via a partial module mock so this runs in
 * milliseconds instead of the real 10-minute constant — createIdleWatchdog
 * itself is left real, so the timer behavior under test is authentic.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import * as http from "http"

const IDLE_MS = 150

vi.mock("$lib/server/db", () => ({
	db: {
		query: {
			systemSettings: { findFirst: vi.fn(async () => null) }
		}
	}
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	batchEmbed: vi.fn(),
	embed: vi.fn(),
	getLoadedModelId: () => null
}))
vi.mock("./idleTimeout", async () => {
	const actual =
		await vi.importActual<typeof import("./idleTimeout")>("./idleTimeout")
	return { ...actual, LLM_IDLE_TIMEOUT_MS: IDLE_MS }
})

const { KoboldCppAdapter } = await import("./KoboldCppAdapter")

function makeAdapter(baseUrl: string) {
	const adapter = new KoboldCppAdapter({
		connection: {
			id: 1,
			type: "koboldcpp",
			baseUrl,
			model: "koboldcpp",
			promptFormat: "vicuna",
			extraJson: {}
		} as any,
		sampling: { contextTokensEnabled: false } as any,
		contextConfig: {} as any,
		promptConfig: { systemPrompt: "You are a helpful narrator." } as any,
		chat: {
			id: 1,
			userId: 1,
			chatType: "chat",
			metadata: { ragIgnored: true },
			chatMessages: [],
			chatCharacters: [],
			chatPersonas: [],
			lorebook: {
				id: 1,
				lorebookBindings: [],
				worldLoreEntries: [],
				characterLoreEntries: [],
				historyEntries: []
			}
		} as any,
		currentCharacterId: null
	})
	vi.spyOn(adapter.promptBuilder, "compilePrompt").mockResolvedValue({
		prompt: "hi",
		messages: [{ role: "user", content: "hi" }],
		meta: {} as any
	})
	return adapter
}

function listen(server: http.Server): Promise<number> {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve((server.address() as any).port)
		})
	})
}

describe("KoboldCppAdapter streaming — idle timeout (real HTTP server)", () => {
	let server: http.Server | undefined

	afterEach(async () => {
		await new Promise<void>((resolve) => {
			if (server) server.close(() => resolve())
			else resolve()
		})
		server = undefined
	})

	test("a server that accepts and never responds gets aborted once idle", async () => {
		server = http.createServer((req, res) => {
			res.writeHead(200, { "Content-Type": "text/event-stream" })
			// Never write anything, never end — a genuine hang.
		})
		const port = await listen(server)
		const adapter = makeAdapter(`http://127.0.0.1:${port}`)

		const result = await adapter.generate()
		expect(typeof result.completionResult).toBe("function")

		let caught: any
		try {
			await (result.completionResult as any)(() => {})
		} catch (e) {
			caught = e
		}
		expect(caught).toBeTruthy()
		expect(String(caught?.message)).toMatch(/idle/i)
	}, 10_000)

	test("a server that trickles chunks inside the idle window is never aborted", async () => {
		server = http.createServer((req, res) => {
			res.writeHead(200, { "Content-Type": "text/event-stream" })
			// Each gap is well inside IDLE_MS, but the total run exceeds it —
			// proving this is genuinely idle-based, not a disguised wall clock.
			const chunk =
				'data: {"choices":[{"delta":{"content":"x"}}]}\n\n'
			let sent = 0
			const timer = setInterval(() => {
				res.write(chunk)
				sent++
				if (sent >= 6) {
					clearInterval(timer)
					res.end("data: [DONE]\n\n")
				}
			}, Math.floor(IDLE_MS / 2))
		})
		const port = await listen(server)
		const adapter = makeAdapter(`http://127.0.0.1:${port}`)

		const result = await adapter.generate()
		let content = ""
		await (result.completionResult as any)((chunk: string) => {
			content += chunk
		})

		expect(content).toBe("xxxxxx")
	}, 10_000)
})
