/**
 * A NON-VICUNA prompt, rendered and generated against a real model.
 *
 * `liveGeneration.int.test.ts` proves the chain reaches a provider, but it does
 * it on the one format every default already picks: Vicuna, in whichever wire
 * mode the connection happens to resolve to. Nothing in this tree has ever been
 * driven against a real backend in ChatML, and nothing has ever compared the two
 * wire modes on the same fixture — so the two claims this file makes were, until
 * now, entirely untested against a model:
 *
 *  1. **Completion wire renders in the connection's own template.** A ChatML
 *     connection puts `<|im_start|>` / `<|im_end|>` on the wire and no Vicuna
 *     `### User:` / `### Assistant:` anywhere, and the model answers it.
 *  2. **Chat wire sends role-tagged messages.** The same fixture, the same
 *     template, one connection flag different, and what goes out is a populated
 *     `messages[]` with no delimiters and no `<@role:` transport markers leaked
 *     into content.
 *
 * ## Why a proxy rather than a mocked transport
 *
 * The point is what the REAL adapter puts on the REAL wire, so nothing is
 * stubbed. Both connections' `baseUrl` points at a recording HTTP proxy in this
 * process which forwards verbatim to Ollama on 11434 — so the assertions read
 * the exact bytes the model received, and the model's reply is a real one.
 *
 * **Opt-in.** Skipped unless `LIVE_MODEL=1` and Ollama answers on 11434 with the
 * model named by `LIVE_MODEL_NAME` (default: the Qwen2.5 build below, which is a
 * ChatML model — the format under test has to be one the model actually speaks,
 * or a wrong reply proves nothing).
 *
 *     LIVE_MODEL=1 npx vitest run \
 *       src/lib/server/pipelines/parity/liveWireFormats.live.int.test.ts
 *
 * ⚠ Deliberately gentle: one sampling config for every case so the model loads
 * ONCE (a differing `num_ctx` forces a reload), `responseTokens: 48`, and every
 * request sequential.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import http from "node:http"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"

const OLLAMA_HOST = "127.0.0.1"
const OLLAMA_PORT = 11434

/**
 * A ChatML model, because ChatML is what is under test.
 *
 * Overridable by `LIVE_MODEL_NAME` — `liveGeneration.int.test.ts` picks the
 * SMALLEST installed model, which is the right default there (it proves the
 * chain, not the format) and the wrong one here: a Llama- or Mistral-family
 * build handed a ChatML prompt would answer something, and that answer would
 * say nothing about whether the markers were right.
 */
const DEFAULT_MODEL =
	"hf.co/bartowski/Qwen2.5-14B_Uncensored_Instruct-GGUF:Q4_K_M"

/**
 * The line the persona says — a CANARY, not a trivia question.
 *
 * The word below appears nowhere except in this prompt, so getting it back is
 * proof that these bytes reached the model in a form it could read. A factual
 * question would not be: a model that answers "white" may have answered from
 * the question alone, and one that stays in character and deflects has told you
 * nothing about the plumbing either way. Both were observed on the two wire
 * modes here, which is exactly why this is a canary now.
 */
const CANARY = "pomegranate"
const USER_LINE = `Say the word: ${CANARY}`

/** What a working chain gets back. Case-insensitive, substring. */
const EXPECTED_WORD = CANARY

async function liveModel(): Promise<string | null> {
	if (!process.env.LIVE_MODEL) return null
	const want = process.env.LIVE_MODEL_NAME || DEFAULT_MODEL
	try {
		const res = await fetch(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/tags`, {
			signal: AbortSignal.timeout(3000)
		})
		if (!res.ok) return null
		const body: any = await res.json()
		const names: string[] = (body.models ?? []).map((m: any) => m.name)
		if (names.includes(want)) return want
		console.warn(
			`[live] ${want} is not installed (set LIVE_MODEL_NAME). Installed: ${names.join(", ")}`
		)
		return null
	} catch {
		return null
	}
}

/** One recorded request: what the adapter actually put on the wire. */
interface Sent {
	path: string
	body: any
}

const sent: Sent[] = []
let proxy: http.Server | undefined
let proxyUrl = ""

/**
 * A verbatim forwarder to Ollama that keeps a copy of every request body.
 *
 * Verbatim matters: the assertions are about bytes, so this must not normalise,
 * re-encode or reorder anything. It reads the body to record it and writes the
 * SAME buffer upstream.
 */
function startProxy(): Promise<string> {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const chunks: Buffer[] = []
			req.on("data", (c) => chunks.push(c as Buffer))
			req.on("end", () => {
				const raw = Buffer.concat(chunks)
				let parsed: any = undefined
				if (raw.length) {
					try {
						parsed = JSON.parse(raw.toString("utf8"))
					} catch {
						parsed = raw.toString("utf8")
					}
				}
				sent.push({ path: req.url ?? "", body: parsed })

				const headers: Record<string, string> = {}
				for (const [k, v] of Object.entries(req.headers)) {
					if (k === "host" || k === "transfer-encoding") continue
					if (typeof v === "string") headers[k] = v
				}
				headers["host"] = `${OLLAMA_HOST}:${OLLAMA_PORT}`
				headers["content-length"] = String(raw.length)

				const upstream = http.request(
					{
						host: OLLAMA_HOST,
						port: OLLAMA_PORT,
						path: req.url,
						method: req.method,
						headers
					},
					(up) => {
						res.writeHead(up.statusCode ?? 200, up.headers as any)
						up.pipe(res)
					}
				)
				upstream.on("error", (e) => {
					res.writeHead(502, { "content-type": "text/plain" })
					res.end(String(e))
				})
				upstream.end(raw)
			})
		})
		// A generation outlives Node's 5-minute default request timeout only if
		// the model is very slow, but the failure mode is a socket hangup that
		// reads as an adapter fault, so both bounds are lifted rather than
		// tuned.
		server.requestTimeout = 0
		server.headersTimeout = 0
		server.timeout = 0
		server.on("error", reject)
		server.listen(0, "127.0.0.1", () => {
			proxy = server
			const addr = server.address() as any
			resolve(`http://127.0.0.1:${addr.port}`)
		})
	})
}

let db: TestDb
let dataDir: string
let model: string | null = null
let userId: number
let completionSessionId: number
let chatSessionId: number
let characterId: number
let completionConnectionId: number
let chatConnectionId: number
let samplingId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "live-wire-formats-secret" }
})

// No embedding model is loaded for this: retrieval is not what is under test,
// and loading one alongside a 14B generation model is exactly the "two models at
// once" this file is careful not to do.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

beforeAll(async () => {
	model = await liveModel()
	if (!model) return

	proxyUrl = await startProxy()

	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-live-wire-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "live-wire", isAdmin: true })
		.returning()
	userId = user.id

	/**
	 * ONE sampling config for both connections.
	 *
	 * `contextTokens` becomes Ollama's `num_ctx`, and a differing `num_ctx`
	 * between two requests makes the server unload and reload the weights — 9GB,
	 * twice, on somebody's desktop. Sharing the row is what keeps this to a
	 * single load.
	 */
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Live Wire Formats",
			values: {
				responseTokens: 48,
				contextTokens: 4096,
				temperature: 0.2,
				seed: 7
			},
			enabled: ["responseTokens", "contextTokens", "temperature", "seed"]
		})
		.returning()
	samplingId = sampling.id

	const base = {
		type: CONNECTION_TYPE.OLLAMA,
		baseUrl: proxyUrl,
		model,
		// ChatML on BOTH rows on purpose. In chat wire the format must have no
		// effect on a single byte (NOMENCLATURE §10), and a row carrying one is
		// the realistic case — the picker has been offered to every type.
		promptFormat: PromptFormats.CHATML,
		tokenCounter: "estimate",
		// `keepAlive` pinned BELOW the adapter's own default, which is "5m" since
		// 0108 — a live run has no business holding a GPU for five minutes after
		// its last assertion. 60s is still far longer than the gap between the two
		// cases below, so the second one reuses the weights the first one loaded,
		// which is the only reason this key is on the fixture at all.
		extraJson: { stream: false, keepAlive: "60s" }
	}

	const [completion] = await db
		.insert(schema.connections)
		.values({
			...base,
			name: "Live Ollama (completion wire, ChatML)",
			// `wire_chat: false` is the hand-set override the capability panel
			// promises, and the ONLY way to reach completion wire on a type that
			// declares both: the tie-break prefers chat whenever it is available,
			// so switching completion "on" would change nothing.
			capabilities: { overrides: { wire_chat: false } }
		})
		.returning()
	completionConnectionId = completion.id

	const [chat] = await db
		.insert(schema.connections)
		.values({
			...base,
			name: "Live Ollama (chat wire)",
			// No override: both modes are declared and defaulted, and the
			// tie-break picks chat.
			capabilities: {}
		})
		.returning()
	chatConnectionId = chat.id

	const [character] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Echo",
			description:
				"An echo. When Rell asks Echo to say a word, Echo replies with " +
				"that word alone and nothing else.",
			personality:
				"Replies with exactly one word. Never a sentence, never a " +
				"question, never an explanation."
		})
		.returning()
	characterId = character.id

	const [persona] = await db
		.insert(schema.personas)
		.values({
			userId,
			isDefault: false,
			name: "Rell",
			description: "A cartographer."
		})
		.returning()

	/**
	 * ONE session per case, seeded identically.
	 *
	 * Not a tidiness preference: a non-preview turn WRITES its reply, so a
	 * second case sharing the session renders a transcript containing the
	 * first case's answer and the two payloads stop being comparable. It also
	 * hid a real observation behind noise — the stored reply still carries its
	 * `Echo: ` seed line, so the second render read `Echo: Echo: …`.
	 */
	const makeSession = async () => {
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false })
			.returning()
		await db.insert(schema.sessionCharacters).values({
			sessionId: session.id,
			characterId,
			isActive: true,
			visibility: "visible"
		})
		await db
			.insert(schema.sessionPersonas)
			.values({ sessionId: session.id, personaId: persona.id })
		await db.insert(schema.sessionMessages).values({
			sessionId: session.id,
			role: "user",
			content: USER_LINE,
			personaId: persona.id
		})
		return session.id
	}
	completionSessionId = await makeSession()
	chatSessionId = await makeSession()
}, 300_000)

afterAll(async () => {
	if (proxy) await new Promise<void>((r) => proxy!.close(() => r()))
	if (dataDir) await fs.rm(dataDir, { recursive: true, force: true })
})

/**
 * Register a connection as the instance's `text->text` default and run a real
 * turn against it.
 *
 * Non-preview on purpose: preview stops at the Provider with the payload built,
 * which proves the render and nothing about the send. The whole question here is
 * what reached the model, so the model is reached.
 */
async function runAgainst(
	connectionId: number,
	sessionId: number,
	seed: string
) {
	sent.length = 0
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId,
		samplingConfigId: samplingId
	})

	const { runTurn, generatedText, haltExplanation } = await import(
		"$lib/server/pipelines/runtime/runTurn"
	)
	const receipt: any = await runTurn({
		db: db,
		sessionId,
		userId,
		currentCharacterId: characterId,
		text: USER_LINE,
		specId: RESPOND_SPEC_ID,
		seed
	})
	return {
		receipt,
		halt: haltExplanation(receipt),
		text: generatedText(receipt),
		// The generation request, told apart from any probe Ollama's client makes
		// on the way (`/api/tags`, `/api/show`).
		request: sent.find(
			(s) => s.path.includes("/api/generate") || s.path.includes("/api/chat")
		)
	}
}

/** Vicuna's delimiters, which must not appear in a ChatML render. */
const VICUNA_MARKER = /###\s*(System|User|Assistant)\s*:/i

describe("completion wire, ChatML, against a real model", () => {
	it("puts ChatML markers on the wire and gets a real answer back", async () => {
		if (!model) {
			console.log(
				"skipped: set LIVE_MODEL=1 with Ollama on 11434 and " +
					`LIVE_MODEL_NAME (default ${DEFAULT_MODEL})`
			)
			return
		}

		const { halt, text, request } = await runAgainst(
			completionConnectionId,
			completionSessionId,
			"live-wire:completion"
		)
		expect(halt).toBe(null)
		expect(
			request,
			`no generation request reached Ollama; saw ${sent.map((s) => s.path).join(", ")}`
		).toBeTruthy()

		// The METHOD, which is the half of wire mode the render cannot show.
		expect(request!.path).toContain("/api/generate")
		expect(typeof request!.body.prompt).toBe("string")
		expect(request!.body.messages).toBeUndefined()

		const prompt: string = request!.body.prompt
		console.log(
			`\n[live] ${model}\n[wire] completion ${request!.path}` +
				`\n[prompt head] ${JSON.stringify(prompt.slice(0, 300))}` +
				`\n[prompt tail] ${JSON.stringify(prompt.slice(-200))}` +
				`\n[reply] ${JSON.stringify(text)}\n`
		)

		// ⚠ THE claim. A ChatML connection renders ChatML and nothing else — the
		// defect this catches is a format that never reached the render, which
		// looks exactly like a working prompt in Vicuna's delimiters.
		expect(prompt).toContain("<|im_start|>")
		expect(prompt).toContain("<|im_end|>")
		expect(prompt).not.toMatch(VICUNA_MARKER)
		expect(prompt).toContain(USER_LINE)
		// The transport markers of chat wire's split_session emit have no
		// business in a flat render.
		expect(prompt).not.toContain("<@role:")

		// The stop strings the connection sends are the SAME template's, which is
		// the pairing `BaseConnectionAdapter.completionTemplate` exists to hold.
		const stop: string[] = request!.body.options?.stop ?? []
		expect(stop).toContain("<|im_start|>")
		expect(stop).toContain("<|im_end|>")

		// Gentle, as promised, and asserted rather than trusted.
		expect(request!.body.options?.num_predict).toBe(48)

		// A real answer, not garbage: the character answers factual questions in
		// one word, and snow is white.
		expect(text, "the model returned nothing").toBeTruthy()
		expect(text!.trim().length).toBeGreaterThan(0)
		expect(text!.toLowerCase()).toContain(EXPECTED_WORD)
		// Nothing structural leaked into the reply.
		expect(text).not.toContain("<|im_start|>")
	}, 600_000)

	/**
	 * ⚠ **This case was expected to FAIL, and the failure was the finding.**
	 * It passes now — the adapter sets the flag — and the finding it used to
	 * carry is recorded by the sibling measurement case below, which prices the
	 * defect in tokens instead of asserting it away.
	 *
	 * `/api/generate` applies the MODEL'S OWN chat template to `prompt` unless
	 * `raw: true` is set — so a completion-wire prompt this app rendered in
	 * ChatML is wrapped a second time, in ChatML, by Ollama. Every other
	 * completion-wire backend in this tree posts to an endpoint that templates
	 * nothing (KoboldCPP `/api/v1/generate`, llama.cpp `/completion`), which is
	 * why Ollama is the only place the flag is needed and was the only place it
	 * was missing.
	 *
	 * `OllamaAdapter.generateText()` built its `GenerateRequest` with no `raw`
	 * key at all. The field was on the SDK's own interface the whole time
	 * (`ollama/dist/shared/*.d.ts`, `raw?: boolean`), so it was an omission
	 * rather than a limitation, and the `else` branch of that method sets it.
	 *
	 * Left as an assertion rather than a comment because it was the one claim in
	 * this file that the code did not satisfy, until 2026-09-08. It stays an
	 * assertion for the other direction now: dropping `raw` again would restore
	 * the double-templating silently, on the send path, and this is what notices.
	 */
	it("sets raw:true so Ollama does not re-template the prompt", async () => {
		if (!model) return
		const request = sent.find((s) => s.path.includes("/api/generate"))
		expect(request, "run the case above first").toBeTruthy()
		expect(
			request!.body.raw,
			"OllamaAdapter sends /api/generate without `raw: true`, so Ollama " +
				"applies the model's own chat template on top of the ChatML prompt " +
				"this app already rendered. See src/lib/server/connectionAdapters/" +
				"OllamaAdapter.ts, the `else` branch of generateText()."
		).toBe(true)
	})

	/**
	 * The same claim, measured rather than asserted — and this one PASSES, so
	 * the evidence survives whatever happens to the assertion above.
	 *
	 * `prompt_eval_count` is how many tokens the server actually fed the model.
	 * Send one prompt twice, once as the adapter sends it and once with
	 * `raw: true`, and the difference is exactly the wrapper Ollama added.
	 * `num_predict: 1` because nothing here reads the completion.
	 */
	it("measures how many tokens Ollama's own template adds", async () => {
		if (!model) return
		const request = sent.find((s) => s.path.includes("/api/generate"))
		expect(request, "run the first case in this block first").toBeTruthy()

		const probe = async (raw: boolean) => {
			const res = await fetch(
				`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/generate`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						model,
						prompt: request!.body.prompt,
						stream: false,
						keep_alive: "60s",
						...(raw ? { raw: true } : {}),
						options: { num_predict: 1, num_ctx: 4096, seed: 7 }
					})
				}
			)
			const body: any = await res.json()
			return body.prompt_eval_count as number
		}

		const asSent = await probe(false)
		const asRaw = await probe(true)
		console.log(
			`\n[live] prompt_eval_count as the adapter sends it: ${asSent}` +
				`\n[live] prompt_eval_count with raw:true:          ${asRaw}` +
				`\n[live] tokens Ollama's template added:           ${asSent - asRaw}\n`
		)
		// Recorded, not gated: the number is the evidence, and pinning it would
		// make this file fail on a model whose template differs.
		expect(typeof asSent).toBe("number")
		expect(typeof asRaw).toBe("number")
	}, 300_000)
})

describe("chat wire, same fixture, against a real model", () => {
	it("puts a populated messages[] on the wire and gets a real answer back", async () => {
		if (!model) return

		const { halt, text, request } = await runAgainst(
			chatConnectionId,
			chatSessionId,
			"live-wire:chat"
		)
		expect(halt).toBe(null)
		expect(
			request,
			`no generation request reached Ollama; saw ${sent.map((s) => s.path).join(", ")}`
		).toBeTruthy()

		expect(request!.path).toContain("/api/chat")
		expect(request!.body.prompt).toBeUndefined()
		const messages = request!.body.messages
		expect(Array.isArray(messages)).toBe(true)
		expect(messages.length).toBeGreaterThan(0)

		console.log(
			`\n[live] ${model}\n[wire] chat ${request!.path}` +
				`\n[roles] ${messages.map((m: any) => m.role).join(" → ")}` +
				`\n[messages] ${JSON.stringify(messages, null, 2)}` +
				`\n[reply] ${JSON.stringify(text)}\n`
		)

		const asText = JSON.stringify(messages)
		expect(asText).toContain(USER_LINE)
		// Roles carry the structure in chat wire, so NO delimiters and no
		// transport markers may survive into content.
		expect(asText).not.toContain("<|im_start|>")
		expect(asText).not.toContain("<@role:")
		expect(asText).not.toMatch(VICUNA_MARKER)
		for (const m of messages)
			expect(["system", "user", "assistant"]).toContain(m.role)

		expect(text, "the model returned nothing").toBeTruthy()
		expect(text!.trim().length).toBeGreaterThan(0)
		expect(text!.toLowerCase()).toContain(EXPECTED_WORD)
	}, 600_000)
})
