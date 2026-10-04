/**
 * populate-0.5.3 — builds the populated 0.5.3 database fixtures the
 * 0.5.3 → 0.6.0 upgrade is proven against (PLAN-chain-rebuild §2, lane L2).
 *
 * It runs the SHIPPED 0.5.3 bundle (production mode, own node, own PGlite) on
 * a scratch data dir and populates it in two layers:
 *
 *   1. Socket layer — a socket.io client drives 0.5.3's own write paths
 *      (characters/personas/lorebooks/entries/bindings/graph/scenes/chats/
 *      messages/swipes/configs/connections/users/settings/themes/backgrounds/
 *      vectorization). A built-in fake model host serves the OpenAI chat API,
 *      the Ollama chat API (with `thinking`) and an OpenAI embeddings API, so
 *      replies, swipes, thinking, errors and real `real[]` embeddings are all
 *      written by 0.5.3 itself.
 *   2. Bulk layer — with the bundle STOPPED (SIGINT, wait for exit), the
 *      bundle's own PGlite multiplies those rows to the target volume and
 *      plants the edge cases no UI path can produce (clamping history dates,
 *      `{char:N}` tokens and collisions, duplicate bindings, stuck
 *      generations, unknown embedding models, …).
 *
 * Then the gate: the populated dir is booted under the bundle again, stopped,
 * every table counted, and MANIFEST.json written (counts + planted edge cases
 * with their row ids). The fixture is dumped with PGlite's own `dumpDataDir`
 * (the exact format `loadDataDir` / 0.6 recovery consume).
 *
 * Usage (needs the 0.5.3 bundle on disk; CI never runs this, it consumes the
 * committed tgz — ruling D11):
 *
 *   npx tsx scripts/fixtures/populate-0.5.3.ts                 # both profiles
 *   npx tsx scripts/fixtures/populate-0.5.3.ts --profile tiny
 *   npx tsx scripts/fixtures/populate-0.5.3.ts --verify        # gate only, on the committed fixtures
 *
 * Options: --bundle <dir> (default ~/Downloads/serene-pub-v0.5.3-linux-x64/serene-pub-0.5.3-beta-linux-x64)
 *          --work <dir>   (scratch; default $TMPDIR/sp053-fixture-<pid>)
 *          --port <n>     (bundle port, default 5303)  --model-port <n> (fake model host, default 47991)
 *
 * Output (per profile): src/lib/server/db/fixtures/0.5.3[/tiny]/
 *   serene-pub.db.tgz  PGlite dumpDataDir (gzip) of data/serene-pub.db
 *   meta.json          as 0.5.3 wrote it (version 0.5.3-beta + cryptoSecretKey; lock dropped)
 *   meta.dev.json      same, version "0.0.0" — the 0.5.3 dev-mode variant (E2.5)
 *   users.tgz          data/users/ (avatars, galleries, uploaded background)
 *   MANIFEST.json      row counts per table + planted edge cases
 *
 * Deterministic seed for everything the generator chooses; ids, uuids and
 * timestamps are whatever 0.5.3 assigns.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type Server } from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import crypto from "node:crypto"
import { fileURLToPath, pathToFileURL } from "node:url"
import { io, type Socket } from "socket.io-client"

// ─── args ────────────────────────────────────────────────────────────────────

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const argv = process.argv.slice(2)
function arg(name: string, def?: string): string | undefined {
	const i = argv.indexOf(`--${name}`)
	return i >= 0 ? argv[i + 1] : def
}
const BUNDLE = path.resolve(
	arg(
		"bundle",
		path.join(os.homedir(), "Downloads/serene-pub-v0.5.3-linux-x64/serene-pub-0.5.3-beta-linux-x64")
	)!
)
const PORT = Number(arg("port", "5303"))
const MODEL_PORT = Number(arg("model-port", "47991"))
const WORK = path.resolve(arg("work", path.join(os.tmpdir(), `sp053-fixture-${process.pid}`))!)
const PROFILES = (arg("profile", "all") === "all" ? ["big", "tiny"] : [arg("profile")!]) as Profile[]
const VERIFY_ONLY = argv.includes("--verify")
const FIXTURE_ROOT = path.join(REPO, "src/lib/server/db/fixtures/0.5.3")
const BASE = `http://127.0.0.1:${PORT}`
const MODEL_BASE = `http://127.0.0.1:${MODEL_PORT}`

type Profile = "big" | "tiny"
const outDir = (p: Profile) => (p === "big" ? FIXTURE_ROOT : path.join(FIXTURE_ROOT, "tiny"))

const log = (...a: unknown[]) => console.log(`[populate-0.5.3]`, ...a)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─── deterministic randomness ────────────────────────────────────────────────

function mulberry32(seed: number) {
	return () => {
		seed |= 0
		seed = (seed + 0x6d2b79f5) | 0
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}
let rand = mulberry32(530)
const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

const FIRST = ["Aria", "Kael", "Maren", "Tobin", "Sera", "Ilya", "Doran", "Wren", "Petra", "Oswin", "Lysa", "Corvin", "Nadia", "Bram", "Elske", "Fenn", "Greta", "Hollis", "Isolde", "Jory"]
const LAST = ["Vell", "Ondel", "Ashgrove", "Thorne", "Marsh", "Quill", "Harrow", "Brightwater", "Stone", "Fairweather"]
const PLACES = ["Emberfall", "the Saltmarsh", "Highcrag", "the Glass Library", "Dunmere", "the Ashen Road", "Brightwater Keep"]
const WORDS = "lantern river oath ember ledger bridge winter crown harbour signal orchard forge relic storm tower market shrine".split(" ")
const sentence = (n = 12) => {
	const w = Array.from({ length: n }, () => pick(WORDS))
	w[0] = w[0][0].toUpperCase() + w[0].slice(1)
	return w.join(" ") + "."
}
const para = (s = 3) => Array.from({ length: s }, () => sentence(int(8, 16))).join(" ")

// ─── PNG (no dependency) ─────────────────────────────────────────────────────

function pngChunk(type: string, data: Buffer) {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length)
	const td = Buffer.concat([Buffer.from(type, "latin1"), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(zlib.crc32(td) >>> 0)
	return Buffer.concat([len, td, crc])
}
/** A small solid-ish RGB PNG; `text` adds tEXt chunks (e.g. a V2 card's `chara`). */
function makePng(seed: number, size = 48, text: Record<string, string> = {}) {
	const r = mulberry32(seed)
	const [cr, cg, cb] = [r() * 255, r() * 255, r() * 255].map(Math.floor)
	const raw = Buffer.alloc((size * 3 + 1) * size)
	for (let y = 0; y < size; y++) {
		raw[y * (size * 3 + 1)] = 0
		for (let x = 0; x < size; x++) {
			const o = y * (size * 3 + 1) + 1 + x * 3
			const d = (x + y) % 16 < 8 ? 0 : 40
			raw[o] = (cr + d) & 255
			raw[o + 1] = (cg + d) & 255
			raw[o + 2] = (cb + d) & 255
		}
	}
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(size, 0)
	ihdr.writeUInt32BE(size, 4)
	ihdr[8] = 8
	ihdr[9] = 2
	const chunks = [pngChunk("IHDR", ihdr)]
	for (const [k, v] of Object.entries(text)) chunks.push(pngChunk("tEXt", Buffer.from(`${k}\0${v}`, "latin1")))
	chunks.push(pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0)))
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks])
}

// ─── fake model host: OpenAI chat + embeddings, Ollama chat (thinking) ────────

const EMBED_DIMS = 384
let replyCounter = 0
function embedVector(text: string, dims = EMBED_DIMS) {
	const h = crypto.createHash("sha256").update(text).digest()
	const r = mulberry32(h.readUInt32LE(0))
	const v = Array.from({ length: dims }, () => r() * 2 - 1)
	const n = Math.hypot(...v)
	return v.map((x) => Number((x / n).toFixed(6)))
}
function replyText() {
	replyCounter++
	const n = int(18, 60)
	return `r${replyCounter} ` + Array.from({ length: n }, () => pick(WORDS)).join(" ") + "."
}
function startModelHost(): Promise<Server> {
	const server = createServer((req, res) => {
		let body = ""
		req.on("data", (c) => (body += c))
		req.on("end", () => {
			const url = req.url ?? ""
			let json: any = {}
			try {
				json = body ? JSON.parse(body) : {}
			} catch {}
			const send = (code: number, obj: unknown) => {
				res.writeHead(code, { "content-type": "application/json" })
				res.end(JSON.stringify(obj))
			}
			// OpenAI-compatible
			if (url.endsWith("/models") && req.method === "GET")
				return send(200, { object: "list", data: [{ id: "gate-model", object: "model" }, { id: "all-minilm", object: "model" }] })
			if (url.endsWith("/embeddings")) {
				const inputs: string[] = Array.isArray(json.input) ? json.input : [json.input ?? ""]
				return send(200, {
					object: "list",
					model: json.model,
					// the openai SDK asks for base64 (packed float32 LE) unless told otherwise
					data: inputs.map((t, index) => {
						const v = embedVector(String(t))
						return { object: "embedding", index, embedding: json.encoding_format === "base64" ? Buffer.from(new Float32Array(v).buffer).toString("base64") : v }
					}),
					usage: { prompt_tokens: 1, total_tokens: 1 }
				})
			}
			if (url.includes("/chat/completions") || url.endsWith("/completions")) {
				const text = replyText()
				const chat = url.includes("/chat/")
				if (json.stream === false) {
					return send(200, chat
						? { choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] }
						: { choices: [{ index: 0, text, finish_reason: "stop" }] })
				}
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
				for (const piece of text.match(/\S+\s*/g) ?? []) {
					const chunk = chat ? { choices: [{ index: 0, delta: { content: piece } }] } : { choices: [{ index: 0, text: piece }] }
					res.write(`data: ${JSON.stringify(chunk)}\n\n`)
				}
				res.write("data: [DONE]\n\n")
				return res.end()
			}
			// Ollama native
			if (url.startsWith("/api/tags")) return send(200, { models: [{ name: "fake-think:7b", model: "fake-think:7b", size: 1, digest: "x", details: {} }, { name: "gemma4", model: "gemma4", size: 1, digest: "y", details: {} }] })
			if (url.startsWith("/api/version")) return send(200, { version: "0.9.0" })
			if (url.startsWith("/api/show")) return send(200, { modelfile: "", parameters: "", template: "", details: {}, model_info: { "general.context_length": 8192 } })
			if (url.startsWith("/api/ps")) return send(200, { models: [] })
			if (url.startsWith("/api/chat") || url.startsWith("/api/generate")) {
				const isChat = url.startsWith("/api/chat")
				const text = replyText()
				const thinking = json.think ? `thinking about ${pick(WORDS)} and ${pick(WORDS)} before replying` : ""
				res.writeHead(200, { "content-type": "application/x-ndjson" })
				const now = new Date().toISOString()
				const line = (o: any) => res.write(JSON.stringify({ model: json.model, created_at: now, done: false, ...o }) + "\n")
				if (thinking) for (const p of thinking.match(/\S+\s*/g)!) line(isChat ? { message: { role: "assistant", content: "", thinking: p } } : { response: "", thinking: p })
				for (const p of text.match(/\S+\s*/g)!) line(isChat ? { message: { role: "assistant", content: p } } : { response: p })
				res.write(JSON.stringify({ model: json.model, created_at: now, done: true, done_reason: "stop", ...(isChat ? { message: { role: "assistant", content: "" } } : { response: "" }) }) + "\n")
				return res.end()
			}
			send(404, { error: "not found: " + url })
		})
	})
	return new Promise((r) => server.listen(MODEL_PORT, "127.0.0.1", () => r(server)))
}

// ─── bundle process ──────────────────────────────────────────────────────────

let bundleProc: ChildProcess | null = null
async function startBundle(dataRoot: string, logFile: string) {
	if (!fs.existsSync(path.join(BUNDLE, "build/index.js"))) throw new Error(`0.5.3 bundle not found at ${BUNDLE}`)
	try {
		await fetch(BASE + "/", { signal: AbortSignal.timeout(500) })
		throw new Error(`port ${PORT} is already in use — refusing to share it`)
	} catch (e: any) {
		if (String(e.message).includes("already in use")) throw e
	}
	const env = { ...process.env, NODE_ENV: "production", SERENE_PUB_DATA_DIR: dataRoot, PORT: String(PORT), SERENE_AUTO_OPEN: "1" }
	delete (env as any).CI // CI=true makes 0.5.3 ignore SERENE_PUB_DATA_DIR
	const out = fs.openSync(logFile, "a")
	bundleProc = spawn(path.join(BUNDLE, "node"), ["build/index.js"], { cwd: BUNDLE, env, stdio: ["ignore", out, out] })
	for (let i = 0; i < 120; i++) {
		if (bundleProc.exitCode !== null) throw new Error(`0.5.3 bundle exited early (see ${logFile})`)
		try {
			const r = await fetch(BASE + "/", { signal: AbortSignal.timeout(2000) })
			if (r.status < 500 && fs.readFileSync(logFile, "utf8").includes("Syncing database defaults")) {
				await sleep(1500)
				return
			}
		} catch {}
		await sleep(500)
	}
	throw new Error("0.5.3 bundle did not come up")
}
/** SIGINT and wait for the process to exit — never SIGKILL a PGlite server. */
async function stopBundle() {
	const p = bundleProc
	if (!p || p.exitCode !== null) return
	const exited = new Promise((r) => p.once("exit", r))
	p.kill("SIGINT")
	const t = setTimeout(() => log("bundle still stopping…"), 15000)
	await exited
	clearTimeout(t)
	bundleProc = null
}
process.on("SIGINT", async () => {
	await stopBundle()
	process.exit(130)
})

// ─── socket client ───────────────────────────────────────────────────────────

class Client {
	constructor(public s: Socket, public label: string) {}
	static async connect(label: string, token?: string) {
		await fetch(BASE + "/")
		const s = io(BASE, { transports: ["websocket"], auth: token ? { token } : undefined, reconnection: false })
		await new Promise<void>((res, rej) => {
			s.once("connect", () => res())
			s.once("connect_error", (e) => rej(e))
		})
		return new Client(s, label)
	}
	/** Fire-and-forget for handlers that ack nothing (saveDraft, trigger*). */
	async fire(event: string, params: unknown = {}, waitMs = 600) {
		this.s.emit(event, params)
		await sleep(waitMs)
	}
	/** Emit `event`; resolve on `reply` (default: the event's own name — 0.5.3's ack convention). */
	call<T = any>(event: string, params: unknown = {}, timeout = 30000, reply = event): Promise<T> {
		const s = this.s
		return new Promise((resolve, reject) => {
			const t = setTimeout(() => {
				cleanup()
				reject(new Error(`${this.label} ${event}: timeout`))
			}, timeout)
			const ok = (d: any) => {
				cleanup()
				if (d && typeof d === "object" && "error" in d && d.error && !("chatMessage" in d && d.chatMessage)) reject(new Error(`${this.label} ${event}: ${JSON.stringify(d.error)}`))
				else resolve(d)
			}
			const err = (d: any) => {
				cleanup()
				reject(new Error(`${this.label} ${event}: ${JSON.stringify(d)}`))
			}
			function cleanup() {
				clearTimeout(t)
				s.off(reply, ok)
				s.off(`${event}:error`, err)
			}
			s.on(reply, ok)
			s.on(`${event}:error`, err)
			s.emit(event, params)
		})
	}
	/** Fire, wait for the ack, then wait until the chat has no generating message. */
	async callAndSettle(event: string, params: unknown, chatId: number) {
		const r = await this.call(event, params, 60000)
		await this.settle(chatId)
		return r
	}
	async chat(chatId: number) {
		return (await this.call("chats:get", { id: chatId })).chat
	}
	async settle(chatId: number, timeoutMs = 90000) {
		const deadline = Date.now() + timeoutMs
		let lastSig = ""
		let stable = 0
		await sleep(300)
		while (Date.now() < deadline) {
			const chat = await this.chat(chatId)
			const msgs: any[] = chat?.chatMessages ?? []
			const busy = msgs.some((m) => m.isGenerating)
			const sig = msgs.map((m) => `${m.id}:${m.content.length}:${m.isGenerating}`).join("|")
			if (!busy && sig === lastSig) {
				if (++stable >= 6) return chat
			} else stable = 0
			lastSig = sig
			await sleep(400)
		}
		throw new Error(`chat ${chatId} did not settle`)
	}
	close() {
		this.s.close()
	}
}

async function login(username: string, passphrase: string): Promise<string> {
	const r = await fetch(BASE + "/api/login", {
		method: "POST",
		headers: { "content-type": "application/json", origin: BASE },
		body: JSON.stringify({ username, passphrase })
	})
	const j: any = await r.json()
	if (!j.token && !r.headers.get("set-cookie")) throw new Error(`login ${username} failed: ${JSON.stringify(j)}`)
	if (j.token) return j.token
	const m = /userToken=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")
	if (!m) throw new Error(`login ${username}: no token`)
	return decodeURIComponent(m[1])
}

// ─── card builders ───────────────────────────────────────────────────────────

function v3Card(name: string, withBook: boolean) {
	return {
		spec: "chara_card_v3",
		spec_version: "3.0",
		data: {
			name,
			nickname: name.split(" ")[0],
			description: para(3),
			personality: sentence(),
			scenario: `In ${pick(PLACES)}. ${sentence()}`,
			first_mes: `Well met, {{user}}. ${sentence()}`,
			mes_example: `<START>\n{{user}}: ${sentence(6)}\n{{char}}: ${sentence(9)}`,
			creator_notes: "Imported V3 card (fixture).",
			creator_notes_multilingual: { en: "Imported V3 card (fixture).", fr: "Carte importée." },
			system_prompt: "",
			post_history_instructions: "Stay in character as {{char}}.",
			alternate_greetings: [`Ah, {{user}} again. ${sentence()}`, `Quiet day. ${sentence()}`],
			group_only_greetings: [`Everyone's here. ${sentence()}`],
			tags: ["imported", "v3"],
			creator: "fixture-bot",
			character_version: "2.1",
			source: ["https://example.invalid/cards/" + name.toLowerCase().replace(/\s+/g, "-")],
			assets: [
				{ type: "icon", uri: "ccdefault:", name: "main", ext: "png" },
				{ type: "background", uri: "https://example.invalid/bg.png", name: "bg", ext: "png" }
			],
			extensions: { talkativeness: "0.5", fav: false, world: withBook ? `${name}'s World` : "", depth_prompt: { prompt: "", depth: 4, role: "system" } },
			character_book: withBook
				? {
						name: `${name}'s World`,
						description: "Embedded character book",
						scan_depth: 4,
						token_budget: 512,
						recursive_scanning: false,
						extensions: {},
						entries: [
							{ keys: ["harbour", "docks"], content: para(2), extensions: {}, enabled: true, insertion_order: 10, case_sensitive: false, name: "The Harbour", priority: 10, id: 1, comment: "harbour", selective: false, secondary_keys: [], constant: false, position: "before_char" },
							{ keys: ["/ward(en|ens)?/i"], content: para(1), extensions: {}, enabled: true, insertion_order: 20, use_regex: true, name: "Wardens", priority: 5, id: 2, comment: "regex key", constant: false, position: "after_char" },
							{ keys: [], content: "Always-on lore line.", extensions: {}, enabled: true, insertion_order: 30, constant: true, name: "Constant", id: 3, comment: "", position: "before_char" }
						]
					}
				: undefined
		}
	}
}
function v2CardPng(name: string, seed: number) {
	const card = {
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name,
			description: para(2),
			personality: sentence(),
			scenario: sentence(),
			first_mes: `Hello there, {{user}}.`,
			mes_example: "",
			creator_notes: "PNG V2 card (fixture)",
			system_prompt: "",
			post_history_instructions: "",
			alternate_greetings: [],
			tags: ["png", "v2"],
			creator: "fixture-bot",
			character_version: "1.0",
			extensions: {}
		}
	}
	return makePng(seed, 64, { chara: Buffer.from(JSON.stringify(card)).toString("base64") })
}

// ─── edge-case ledger (goes into MANIFEST) ───────────────────────────────────

type Edge = { id: string; table: string; rowIds?: (number | string)[]; note: string }
const edges: Edge[] = []
const edge = (id: string, table: string, note: string, rowIds?: (number | string)[]) => edges.push({ id, table, note, rowIds })

// ─── SOCKET LAYER ────────────────────────────────────────────────────────────

const ctx: Record<string, any> = {}

async function socketLayer(profile: Profile) {
	let admin = await Client.connect("admin")
	const me = (await admin.call("users:current")).user
	ctx.adminId = me.id
	ctx.adminUsername = me.username
	log("admin user", me.id, me.username)

	// users first: their creation transaction can queue behind in-flight
	// generations later on, so do it while the instance is idle
	if (profile === "big") {
		const sp = await admin.call("users:current:setPassphrase", { passphrase: "Fixture-Admin-1!" })
		if (!sp.success) throw new Error("setPassphrase: " + JSON.stringify(sp))
		// 0.5.3 disconnects every socket of a user who just set a passphrase
		await sleep(1000)
		admin.close()
		admin = await Client.connect("admin")
		ctx.u2 = (await admin.call("users:create", { username: "bard", displayName: "The Bard", isAdmin: true, passphrase: "Fixture-Bard-1!" }, 120000)).user
		ctx.u3 = (await admin.call("users:create", { username: "guest", displayName: "Guest Player", isAdmin: false, passphrase: "Fixture-Guest-1!" }, 120000)).user
		ctx.users = { admin: ctx.adminId, bard: ctx.u2.id, guest: ctx.u3.id }
	}

	// connections ------------------------------------------------------------
	const conn = async (c: any) => (await admin.call("connections:create", { connection: c })).connection
	const cOpenai = await conn({ name: "Fake OpenAI", type: "openai", baseUrl: `${MODEL_BASE}/v1`, model: "gate-model", promptFormat: "chatml", tokenCounter: "openai-gpt4o", extraJson: { apiKey: "sk-fixture-openai-0001", stream: true } })
	ctx.conns = { openai: cOpenai.id }
	if (profile === "tiny") {
		edge("connection-api-key", "connections", "encrypted extraJson.apiKey envelope ({__enc,ciphertext,iv,authTag}) — decrypts only with meta.json cryptoSecretKey", [cOpenai.id])
	} else {
		const cOllama = await conn({ name: "Fake Ollama (thinking)", type: "ollama", baseUrl: `${MODEL_BASE}/`, model: "fake-think:7b", promptFormat: "chatml", extraJson: { think: true, stream: true, useChat: true, keepAlive: "5m" } })
		const cLlmman = await conn({ name: "llmman local", type: "llmman", baseUrl: `${MODEL_BASE}/`, model: "gemma4", extraJson: { stream: true, useChat: true } })
		const cLmstudio = await conn({ name: "LM Studio", type: "lmstudio", baseUrl: "http://127.0.0.1:1234", model: "qwen2.5-7b-instruct", extraJson: { stream: true } })
		const cLlama = await conn({ name: "llama.cpp server", type: "llamacpp_completion", baseUrl: "http://127.0.0.1:8080", model: "local.gguf", promptFormat: "llama2_inst", tokenCounter: "llama3", extraJson: { stream: true } })
		const cKobold = await conn({ name: "KoboldCPP", type: "koboldcpp", baseUrl: "http://127.0.0.1:5001", model: "koboldcpp/mythomax", promptFormat: "mystery_format_v9", extraJson: { stream: true } })
		const cKoboldMgd = await conn({ name: "KoboldCPP Manager", type: "koboldcpp_managed", baseUrl: "http://127.0.0.1:5001", model: "mistral-7b.Q4_K_M.gguf", promptFormat: "tekken", extraJson: {} })
		const cAnthropic = await conn({ name: "Claude", type: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-3-7-sonnet-latest", promptFormat: "openai", tokenCounter: "anthropic-claude", extraJson: { apiKey: "sk-ant-fixture-0002", thinkingBudget: 1024, stream: true } })
		const cDead = await conn({ name: "Dead endpoint", type: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "nobody-home", promptFormat: "", extraJson: { stream: true } })
		ctx.conns = { ...ctx.conns, ollama: cOllama.id, llmman: cLlmman.id, lmstudio: cLmstudio.id, llamacpp: cLlama.id, kobold: cKobold.id, koboldManaged: cKoboldMgd.id, anthropic: cAnthropic.id, dead: cDead.id }
		edge("connection-every-type", "connections", "one connection per 0.5.3 type: openai, ollama, llmman, lmstudio, llamacpp_completion, koboldcpp, koboldcpp_managed, anthropic", Object.values(ctx.conns))
		edge("connection-llmman", "connections", "type 'llmman' — gone in 0.6; D9 (revised): becomes an Ollama connection at the same base URL, carrying its options (incl. think), with a notice", [cLlmman.id])
		edge("connection-llamacpp-completion", "connections", "type 'llamacpp_completion' → 'llamacpp' (0105)", [cLlama.id])
		edge("connection-unknown-prompt-format", "connections", "prompt_format 'mystery_format_v9' (no completion template knows it) → NULL", [cKobold.id])
		edge("connection-empty-prompt-format", "connections", "prompt_format '' → NULL", [cDead.id])
		edge("connection-api-key", "connections", "encrypted extraJson.apiKey envelopes — decrypt only with meta.json cryptoSecretKey", [cOpenai.id, cAnthropic.id])
		edge("connection-dead", "connections", "unreachable base URL and no API key; the chat using it holds a real 0.5.3 error row", [cDead.id])
	}
	await admin.call("connections:setUserActive", { id: cOpenai.id })

	// sampling configs ---------------------------------------------------------
	const sampling = async (s: any) => (await admin.call("samplingConfigs:create", { sampling: s })).sampling
	const sCreative = await sampling({ name: "Creative", temperature: 1.1, topP: 0.95, topPEnabled: true, minP: 0.07, minPEnabled: true, stop: ["\n\n###"], stopEnabled: true })
	ctx.sampling = { creative: sCreative.id }
	if (profile === "big") {
		const sCreative2 = await sampling({ name: " creative ", temperature: 0.9 })
		const sPrecise = await sampling({ name: "Precise", temperature: 0.2, temperatureEnabled: true, topK: 20, topKEnabled: true, seed: 42, seedEnabled: true, responseTokens: 256, responseTokensUnlocked: true })
		const sPrecise2 = await sampling({ name: "PRECISE", temperature: 0.3, contextTokens: 32768, contextTokensUnlocked: true })
		const sMirostat = await sampling({ name: "Mirostat", mirostat: 2, mirostatEnabled: true, mirostatTau: 4.5, mirostatTauEnabled: true, mirostatEta: 0.15, mirostatEtaEnabled: true, typicalP: 0.9, typicalPEnabled: true, tfsZ: 0.95, tfsZEnabled: true })
		const sDry = await sampling({ name: "DRY + XTC", dryMultiplier: 0.8, dryMultiplierEnabled: true, dryBase: 1.75, dryBaseEnabled: true, dryAllowedLength: 3, dryAllowedLengthEnabled: true, dryPenaltyLastN: 512, dryPenaltyLastNEnabled: true, drySequenceBreakers: ["\n", ":", "\"", "*", "<|im_end|>"], drySequenceBreakersEnabled: true, xtcProbability: 0.5, xtcProbabilityEnabled: true, xtcThreshold: 0.12, xtcThresholdEnabled: true, dynatempRange: 0.3, dynatempRangeEnabled: true, dynatempExponent: 1.2, dynatempExponentEnabled: true })
		const sAll = await sampling({
			name: "Everything enabled",
			temperatureEnabled: true, topPEnabled: true, topKEnabled: true, repetitionPenaltyEnabled: true, frequencyPenaltyEnabled: true, presencePenaltyEnabled: true,
			responseTokensEnabled: true, contextTokensEnabled: true, seedEnabled: true, minPEnabled: true, typicalPEnabled: true, mirostatEnabled: true, mirostatTauEnabled: true, mirostatEtaEnabled: true,
			xtcProbabilityEnabled: true, xtcThresholdEnabled: true, dryMultiplierEnabled: true, dryBaseEnabled: true, dryAllowedLengthEnabled: true, dryPenaltyLastNEnabled: true, drySequenceBreakersEnabled: true,
			dynatempRangeEnabled: true, dynatempExponentEnabled: true, tfsZEnabled: true, repeatLastNEnabled: true, penalizeNewline: true, penalizeNewlineEnabled: true,
			logitBias: { "50256": -100, "198": 2.5 }, logitBiasEnabled: true, stop: ["</s>", "User:"], stopEnabled: true, maxTokens: 900, maxTokensEnabled: true
		})
		const sNone = await sampling({ name: "Nothing enabled", temperatureEnabled: false, responseTokensEnabled: false, contextTokensEnabled: false, topP: null, topK: null })
		ctx.sampling = { ...ctx.sampling, creative2: sCreative2.id, precise: sPrecise.id, precise2: sPrecise2.id, mirostat: sMirostat.id, dry: sDry.id, all: sAll.id, none: sNone.id }
		edge("sampling-name-collision", "sampling_configs", "user configs whose names collide on lower(btrim(name)): 'Creative'/' creative ' and 'Precise'/'PRECISE' → suffix ' (2)'", [sCreative.id, sCreative2.id, sPrecise.id, sPrecise2.id])
		edge("sampling-all-enabled", "sampling_configs", "every *_enabled flag true, logitBias/stop/drySequenceBreakers non-empty", [sAll.id])
		edge("sampling-null-values", "sampling_configs", "nullable value columns NULL (top_p, top_k), all switches off", [sNone.id])
		await admin.call("samplingConfigs:setUserActive", { id: sMirostat.id })
		edge("system-default-sampling-user-row", "system_settings", "default_sampling_id points at a USER sampling row (remap by id map)", [sMirostat.id])
	}

	// legacy configs (read by Part C from the attic) ----------------------------
	if (profile === "big") {
		const cc = (await admin.call("contextConfigs:create", { contextConfig: { name: "My context", template: "{{#if char}}<char>{{char}}</char>{{/if}}\n{{wiBefore}}\n{{description}}\n{{personality}}\n{{scenario}}\n{{wiAfter}}" } })).contextConfig
		const pc = (await admin.call("promptConfigs:create", { promptConfig: { name: "My prompt", systemPrompt: "You are {{char}}. Write vividly.", postHistoryInstructions: "Keep replies under 200 words.", postHistoryDepth: 2, postHistoryTokenTrigger: 512, connectionId: ctx.conns.ollama, samplingConfigId: ctx.sampling.dry } })).promptConfig
		const pc2 = (await admin.call("promptConfigs:create", { promptConfig: { name: "Terse prompt", systemPrompt: "Reply tersely as {{char}}." } })).promptConfig
		const nc = (await admin.call("narratorPromptConfigs:create", { narratorPromptConfig: { name: "My narrator", narratorName: "The Chronicler", systemPrompt: "Narrate the scene.", postHistoryInstructions: "Do not speak for characters.", samplingConfigId: ctx.sampling.creative } })).narratorPromptConfig
		const ws = (await admin.call("worldSummarizeConfigs:create", { worldSummarizeConfig: { name: "My world summarizer", batchSystemPrompt: "Batch: summarise world facts.", synthSystemPrompt: "Synthesise.", nameSystemPrompt: "Name it.", batchSamplingConfigId: ctx.sampling.precise, synthConnectionId: ctx.conns.anthropic } })).worldSummarizeConfig
		const cs = (await admin.call("characterSummarizeConfigs:create", { characterSummarizeConfig: { name: "My character summarizer", batchSystemPrompt: "Batch: character facts.", synthSystemPrompt: "Synthesise.", nameSystemPrompt: "Name it." } })).characterSummarizeConfig
		const ss = (await admin.call("sceneSummarizeConfigs:create", { sceneSummarizeConfig: { name: "My scene summarizer", batchSystemPrompt: "Batch: scene.", synthSystemPrompt: "Synthesise.", nameSystemPrompt: "Name it.", characterExtractionSystemPrompt: "Extract cast.", characterExtractionSamplingConfigId: ctx.sampling.precise2 } })).sceneSummarizeConfig
		const gb = (await admin.call("graphBuildConfigs:create", { graphBuildConfig: { name: "My graph build", nodeResolutionSystemPrompt: "Resolve nodes.", preFilterSystemPrompt: "Filter.", perspectiveSystemPrompt: "Perspective.", nodeDescriptionSystemPrompt: "Describe.", stateDetectionSystemPrompt: "Detect state.", perspectiveConnectionId: ctx.conns.openai, stateDetectionSamplingConfigId: ctx.sampling.all } })).graphBuildConfig
		await admin.call("contextConfigs:setUserActive", { id: cc.id })
		await admin.call("promptConfigs:setUserActive", { id: pc.id })
		await admin.call("narratorPromptConfigs:setUserActive", { id: nc.id })
		await admin.call("worldSummarizeConfigs:setUserActive", { id: ws.id })
		await admin.call("characterSummarizeConfigs:setUserActive", { id: cs.id })
		await admin.call("sceneSummarizeConfigs:setUserActive", { id: ss.id })
		await admin.call("graphBuildConfigs:setDefault", { id: gb.id })
		ctx.cfg = { context: cc.id, prompt: pc.id, prompt2: pc2.id, narrator: nc.id, world: ws.id, character: cs.id, scene: ss.id, graph: gb.id }
		edge("legacy-user-configs", "context_configs,prompt_configs,narrator_prompt_configs,*_summarize_configs,graph_build_configs", "one user row per legacy config table, each selected as the admin's active/default — Part C must produce a migrated: marker for each", Object.values(ctx.cfg))
	}

	// vectorization (API mode, with key) — the known model for D4 -------------
	if (profile === "big") {
		const v = await admin.call("vectorization:setApiConfig", { baseUrl: `${MODEL_BASE}/v1`, apiKey: "sk-fixture-embed-0003", model: "all-minilm", startNow: false })
		if (!v.success) throw new Error("vectorization:setApiConfig failed: " + JSON.stringify(v))
		ctx.embedModelId = v.modelName
		log("embedding model", v.modelName, v.dimensions)
	}

	// tags ---------------------------------------------------------------------
	const tagNames = profile === "big" ? ["fantasy", "sci-fi", "Noir", "slow-burn", "comedy", "lore-heavy", "WIP", "favourites"] : ["fantasy"]
	const colors = ["preset-filled-primary-500", "preset-filled-secondary-500", "preset-filled-tertiary-500", "preset-filled-success-500", "preset-filled-warning-500", "preset-filled-error-500", "preset-tonal-primary", "preset-outlined-surface-500"]
	for (const [i, name] of tagNames.entries()) await admin.call("tags:create", { tag: { name, description: i % 2 ? sentence(6) : null, colorPreset: colors[i % colors.length] } })

	// characters ---------------------------------------------------------------
	const chars: any[] = []
	const nChars = profile === "big" ? 14 : 2
	for (let i = 0; i < nChars; i++) {
		const name = `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}`
		const character: any = {
			name,
			nickname: i % 3 === 0 ? FIRST[i % FIRST.length].slice(0, 3) : null,
			description: para(3),
			personality: sentence(),
			scenario: i % 2 ? `${name} waits in ${pick(PLACES)}.` : null,
			firstMessage: `*${name} looks up.* Hello, {{user}}. ${sentence()}`,
			alternateGreetings: i % 4 === 0 ? [`Back again, {{user}}?`, sentence()] : [],
			exampleDialogues: i % 3 === 1 ? [`{{user}}: hi\n{{char}}: ${sentence(5)}`] : [],
			groupOnlyGreetings: i % 5 === 0 ? [`*${name} nods to the room.*`] : null,
			postHistoryInstructions: i % 6 === 0 ? "Never break character." : null,
			creatorNotes: i % 2 ? "Fixture character." : null,
			creator: i % 2 ? "fixture-bot" : null,
			category: pick(["Fantasy", "Mystery", null, "Slice of life"]),
			aliases: i % 3 === 2 ? [FIRST[i % FIRST.length].toLowerCase(), `the ${pick(WORDS)}keeper`] : [],
			summary: i % 2 ? sentence(10) : null,
			isFavorite: i === 1,
			metadata: i % 4 === 3 ? { origin: "fixture", rating: i } : {},
			extensions: i % 4 === 1 ? { depth_prompt: { prompt: "Remember the oath.", depth: 3, role: "system" }, talkativeness: "0.7" } : {},
			source: i % 5 === 2 ? ["https://example.invalid/source/" + i] : [],
			tags: profile === "big" ? [pick(tagNames), pick(tagNames)] : ["fantasy"]
		}
		const withAvatar = profile === "tiny" ? i === 0 : i < 8
		const res = await admin.call("characters:create", withAvatar ? { character, avatarFile: makePng(100 + i) } : { character })
		chars.push(res.character)
	}
	ctx.chars = chars.map((c) => c.id)
	if (profile === "big") {
		// galleries: upload, set one gallery image as avatar, reorder
		for (const c of chars.slice(0, 4)) {
			const paths: string[] = []
			for (let k = 0; k < 3; k++) paths.push((await admin.call("characters:uploadGalleryImage", { characterId: c.id, imageFile: makePng(200 + c.id * 10 + k), mimeType: "image/png" })).path)
			await admin.call("characters:reorderGallery", { characterId: c.id, paths: [...paths].reverse() })
			if (c === chars[2]) await admin.call("characters:setAvatar", { characterId: c.id, path: paths[1] })
		}
		edge("character-gallery", "character_gallery_images", "3 gallery images on each of 4 characters, reordered; one character's avatar IS a gallery image", chars.slice(0, 4).map((c) => c.id))
		// imports: V3 JSON with character_book + assets, V2 PNG with an embedded avatar
		const imp1 = await admin.call("characters:importCard", { file: Buffer.from(JSON.stringify(v3Card("Kaethis Vell", true))).toString("base64") })
		const imp2 = await admin.call("characters:importCard", { file: v2CardPng("Sera Ondel", 77).toString("base64") })
		ctx.imported = [imp1.character?.id, imp2.character?.id]
		edge("character-imported-v3", "characters", "V3 card import: assets (D-loss 1), creator_notes_multilingual, group_only_greetings, source, extensions.depth_prompt; embedded character_book", [imp1.character?.id])
		edge("character-imported-png", "characters", "V2 PNG card import: avatar written from the card image", [imp2.character?.id])
		await admin.call("characters:delete", { id: chars[nChars - 1].id })
		edge("character-soft-deleted", "characters", "is_deleted=true (soft delete)", [chars[nChars - 1].id])
		edge("character-favourite", "characters", "is_favorite=true", [chars[1].id])
	}

	// personas -----------------------------------------------------------------
	const personas: any[] = []
	const nPersonas = profile === "big" ? 4 : 1
	for (let i = 0; i < nPersonas; i++) {
		const persona: any = {
			name: ["Warren", "Master Desir", "Quinn", "The Stranger"][i],
			description: para(2),
			isDefault: i === 0,
			aliases: i === 1 ? ["Desir", "the master"] : [],
			summary: i % 2 ? sentence(8) : null,
			creator: i === 2 ? "me" : null,
			category: i === 3 ? "Alt" : null,
			tags: profile === "big" ? [tagNames[i % tagNames.length]] : []
		}
		const res = await admin.call("personas:create", i < 2 ? { persona, avatarFile: makePng(300 + i) } : { persona })
		personas.push(res.persona)
	}
	ctx.personas = personas.map((p) => p.id)
	if (profile === "big") {
		for (let k = 0; k < 2; k++) await admin.call("personas:uploadGalleryImage", { personaId: personas[1].id, imageFile: makePng(400 + k), mimeType: "image/png" })
		await admin.call("personas:setDefault", { personaId: personas[1].id })
		edge("persona-gallery", "persona_gallery_images", "2 gallery images on one persona", [personas[1].id])
	}

	// lorebooks ----------------------------------------------------------------
	const createBook = async (name: string) => (await admin.call("lorebooks:create", { name })).lorebook
	const atlas = await createBook("Atlas of Everything")
	ctx.books = { atlas: atlas.id }
	// entry creates ack nothing in 0.5.3; they re-emit the list — newest id is ours
	const newest = (list: any[]) => list.reduce((a, b) => (b.id > a.id ? b : a))
	const world = async (lorebookId: number, e: any) => newest((await admin.call("worldLoreEntries:create", { worldLoreEntry: { lorebookId, ...e } }, 30000, "worldLoreEntries:list")).worldLoreEntryList)
	const charLore = async (lorebookId: number, e: any) => newest((await admin.call("characterLoreEntries:create", { characterLoreEntry: { lorebookId, ...e } }, 30000, "characterLoreEntries:list")).characterLoreEntryList)
	const hist = async (lorebookId: number, e: any) => (await admin.call("historyEntries:create", { historyEntry: { lorebookId, ...e } })).historyEntry
	const bind = async (lorebookId: number, b: any) => (await admin.call("lorebooks:createBinding", { lorebookBinding: { lorebookId, ...b } })).lorebookBinding

	const bChar0 = await bind(atlas.id, { characterId: chars[0].id })
	const bChar1 = await bind(atlas.id, { characterId: chars[1].id })
	const bPersona0 = await bind(atlas.id, { personaId: personas[0].id })
	ctx.bindings = { char0: bChar0.id, char1: bChar1.id, persona0: bPersona0.id }
	const wl: any[] = []
	wl.push(await world(atlas.id, { name: "The Harbour", category: "Places", keys: "harbour, docks, pier", content: para(2), priority: 3 }))
	wl.push(await world(atlas.id, { name: "Regex lore", category: "Factions", keys: "/ward(en|ens)?/i", useRegex: true, caseSensitive: true, content: para(1), priority: 1 }))
	wl.push(await world(atlas.id, { name: "Always on", keys: "", constant: true, content: "The sky is always amber here.", priority: 5 }))
	wl.push(await world(atlas.id, { name: "Disabled lore", keys: "secret", enabled: false, content: para(1), extraJson: { note: "kept for later", insertionOrder: 7 } }))
	const cl: any[] = []
	cl.push(await charLore(atlas.id, { name: `${chars[0].name}'s secret`, lorebookBindingId: bChar0.id, keys: "secret, past", content: `{{char:${bChar0.binding?.match(/\d+/)?.[0] ?? 1}}} once ${sentence()}`, priority: 2 }))
	cl.push(await charLore(atlas.id, { name: "Persona lore", lorebookBindingId: bPersona0.id, keys: "warren", content: para(1) }))
	cl.push(await charLore(atlas.id, { name: "Unbound char lore", keys: "drifter", content: para(1) }))
	const hl: any[] = []
	hl.push(await hist(atlas.id, { year: 1, month: 1, day: 1, keys: "founding", content: "The town was founded.", isCompleted: true }))
	hl.push(await hist(atlas.id, { year: 12, month: 6, day: null, content: "A long summer.", graphed: true }))
	hl.push(await hist(atlas.id, { year: 40, month: null, day: null, content: "The year of storms." }))
	hl.push(await hist(atlas.id, { year: 41, month: 3, day: 14, content: para(1), constant: true }))
	ctx.entries = { world: wl.map((e) => e.id), character: cl.map((e) => e.id), history: hl.map((e) => e.id) }
	edge("lorebook-every-entry-kind", "lorebooks", "Atlas of Everything: world (regex, case-sensitive, constant, disabled, extra_json), character lore (bound to a character binding, a persona binding, unbound), history (full date, month only, year only)", [atlas.id])

	if (profile === "big") {
		// imported 0.5.3 export (bindings, graph, characters+personas in the file)
		const emberRaw = JSON.parse(fs.readFileSync(path.join(REPO, "src/lib/server/sockets/fixtures/lorebook-0.5.3-export.json"), "utf8"))
		const ember = await admin.call("lorebooks:import", { lorebookData: emberRaw })
		ctx.books.emberfall = ember.lorebook?.id
		edge("lorebook-imported-export", "lorebooks", "0.5.3 lorebook export imported through lorebooks:import (carries its own characters/personas/graph)", [ember.lorebook?.id])

		// graph book: nodes, relationships, absorb (merge log), dismissed duplicate pair
		const graph = await createBook("Graph & Merges")
		ctx.books.graph = graph.id
		const gb0 = await bind(graph.id, { characterId: chars[2].id })
		const gb1 = await bind(graph.id, { characterId: chars[3].id })
		const gbP = await bind(graph.id, { personaId: personas[1].id })
		const node = async (name: string, nodeState = "active", nodeVisibility = "normal") => (await admin.call("narrativeGraph:createNode", { lorebookId: graph.id, name, nodeState, nodeVisibility, summary: sentence(8) })).node
		const nA = await node("Old Hermit", "deceased", "legendary")
		const nB = await node("The Hermit", "active", "hidden")
		const nC = await node("Harbourmaster", "missing")
		const nD = await node("Harbor master", "departed")
		const gh = await hist(graph.id, { year: 3, month: 2, day: 9, content: "The hermit vanished." })
		const rel = async (fromNodeId: number, toNodeId: number, relationshipType: string, status: string, visibility = "acknowledged", historyEntryId?: number) =>
			(await admin.call("narrativeGraph:createRelationship", { lorebookId: graph.id, fromNodeId, toNodeId, relationshipType, status, description: sentence(7), visibility, historyEntryId })).relationship
		const rels = [
			await rel(gb0.id, gb1.id, "ally", "active", "public", gh.id),
			await rel(gb1.id, gb0.id, "rival", "evolved", "secret"),
			await rel(gb0.id, nA.id, "mentor", "resolved"),
			await rel(nB.id, gb1.id, "life_debt", "active", "secret", gh.id),
			await rel(gbP.id, nC.id, "family", "broken"),
			await rel(nC.id, nB.id, "complicated", "active")
		]
		const cLoreOnB = await charLore(graph.id, { name: "Hermit lore", lorebookBindingId: nB.id, keys: "hermit", content: para(1) })
		// absorb nB into nA → binding_merge_logs with relationship rewrites + reassigned character lore
		await admin.call("narrativeGraph:mergeNode", { nodeId: nB.id, parentNodeId: nA.id })
		await admin.call("narrativeGraph:dismissDuplicate", { lorebookId: graph.id, bindingIdA: Math.min(nC.id, nD.id), bindingIdB: Math.max(nC.id, nD.id) }, 30000, "narrativeGraph:duplicateCandidates")
		ctx.graph = { gb0: gb0.id, gb1: gb1.id, gbP: gbP.id, nA: nA.id, nB: nB.id, nC: nC.id, nD: nD.id, gh: gh.id, rels: rels.map((r: any) => r.id), cLoreOnB: cLoreOnB.id }
		edge("binding-merge-log", "binding_merge_logs", "narrativeGraph:mergeNode absorbed a node: relationship_rewrites + reassigned_character_lore_entry_ids populated (remap to new entry ids, D5)", [graph.id])
		edge("dismissed-duplicate-pair", "dismissed_duplicate_pairs", "dismissed (binding_id_a < binding_id_b) pair", [nC.id, nD.id])
		edge("graph-nodes-unbound", "lorebook_bindings", "unbound background nodes (character_id and persona_id both NULL) in every node_state/node_visibility", [nA.id, nC.id, nD.id])

		await createBook("Empty Book")
		const legacy = await createBook("Legacy Tokens")
		ctx.books.legacy = legacy.id
		const lb0 = await bind(legacy.id, { characterId: chars[4].id })
		const lb1 = await bind(legacy.id, { characterId: chars[5].id })
		const lb2 = await bind(legacy.id, { personaId: personas[2].id })
		ctx.legacyBindings = [lb0.id, lb1.id, lb2.id]
		await charLore(legacy.id, { name: "Old token lore", lorebookBindingId: lb0.id, keys: "token", content: "{char:1} met {char:2} by the river." })
		await world(legacy.id, { name: "Old token world", keys: "river", content: "{char:2} and {{char:1}} share a boat." })

		// tags on a lorebook
		await admin.call("lorebooks:update", { lorebook: { id: atlas.id, name: atlas.name, description: "Every kind of entry.", tags: ["lore-heavy", "fantasy"] } })
		// character → lorebook link
		await admin.call("characters:update", { character: { id: chars[0].id, lorebookId: atlas.id } })
	}

	// chats ----------------------------------------------------------------------
	const newChat = async (c: Client, chat: any, characterIds: number[], personaIds: number[], tags?: string[]) =>
		(await c.call("chats:create", { chat, characterIds, personaIds, characterPositions: Object.fromEntries(characterIds.map((id, i) => [id, i])), tags })).chat
	const say = async (c: Client, chatId: number, personaId: number | null, content: string) => c.callAndSettle("chatMessages:sendPersonaMessage", { chatId, personaId, content }, chatId)
	const lastAssistant = async (c: Client, chatId: number) => (await c.chat(chatId)).chatMessages.filter((m: any) => m.role === "assistant" && !m.isNarratorResponse).at(-1)

	ctx.chats = {}
	const solo = await newChat(admin, { name: profile === "big" ? "Harbour talk" : "Tiny chat", scenario: "A foggy morning on the docks.", lorebookId: atlas.id }, [chars[0].id], [personas[0].id], profile === "big" ? ["fantasy", "slow-burn"] : undefined)
	ctx.chats.solo = solo.id
	await admin.settle(solo.id)
	const turns = profile === "big" ? 6 : 2
	for (let t = 0; t < turns; t++) await say(admin, solo.id, personas[0].id, `${sentence(int(5, 14))} (turn ${t + 1})`)
	{
		const a = await lastAssistant(admin, solo.id)
		await admin.callAndSettle("chatMessages:swipeRight", { id: a.id }, solo.id) // generates a 2nd swipe
		if (profile === "big") {
			await admin.callAndSettle("chatMessages:swipeRight", { id: a.id }, solo.id) // 3rd
			await admin.callAndSettle("chatMessages:swipeLeft", { id: a.id }, solo.id) // currentIdx back to 1
			const msgs = (await admin.chat(solo.id)).chatMessages
			const older = msgs.filter((m: any) => m.role === "assistant").at(-3)
			await admin.callAndSettle("chatMessages:regenerate", { id: older.id }, solo.id)
			await admin.callAndSettle("chatMessages:continue", { id: older.id }, solo.id)
			const user = msgs.filter((m: any) => m.role === "user").at(1)
			await admin.call("chatMessages:update", { id: user.id, content: user.content + " (edited)" })
			const hideMe = msgs.filter((m: any) => m.role === "user").at(2)
			await admin.call("chatMessages:update", { id: hideMe.id, isHidden: true })
			const delMe = msgs.filter((m: any) => m.role === "user").at(3)
			await admin.call("chatMessages:delete", { id: delMe.id })
			await admin.fire("chats:saveDraft", { chatId: solo.id, content: "Half-written reply about the lantern…" })
			// the greeting's alternates are swipes too
			edge("message-swipes", "chat_messages", "metadata.swipes with history>1 and currentIdx < last (swipeRight ×2, swipeLeft); regenerate + continue on an older message; one edited (is_edited), one hidden, one deleted", [a.id, older.id])
			edge("chat-drafts", "chats", "drafts JSON non-empty (chats:saveDraft)", [solo.id])
		}
	}

	if (profile === "big") {
		// thinking (Ollama think:true) — chat-level connection override
		const think = await newChat(admin, { name: "Thinking out loud" }, [chars[1].id], [personas[0].id])
		await admin.call("chats:update", { chat: { id: think.id, connectionId: ctx.conns.ollama } })
		await admin.settle(think.id)
		for (let t = 0; t < 3; t++) await say(admin, think.id, personas[0].id, sentence(8))
		const ta = await lastAssistant(admin, think.id)
		await admin.callAndSettle("chatMessages:swipeRight", { id: ta.id }, think.id)
		ctx.chats.thinking = think.id
		edge("message-thinking", "chat_messages", "metadata.thinking + swipes.thinkingHistory written by the Ollama adapter (think:true); chats.connection_id set (D-loss 3)", [think.id])

		// llmman connection chat
		const lm = await newChat(admin, { name: "Via llmman" }, [chars[6].id], [personas[0].id])
		await admin.call("chats:update", { chat: { id: lm.id, connectionId: ctx.conns.llmman } })
		await admin.settle(lm.id)
		await say(admin, lm.id, personas[0].id, "Testing the llmman runner.")
		ctx.chats.llmman = lm.id

		// error rows — dead connection
		const dead = await newChat(admin, { name: "Broken connection" }, [chars[7].id], [personas[0].id])
		await admin.call("chats:update", { chat: { id: dead.id, connectionId: ctx.conns.dead } })
		await admin.settle(dead.id)
		await say(admin, dead.id, personas[0].id, "Is anyone there?")
		ctx.chats.dead = dead.id
		edge("message-error", "chat_messages", "error JSON {message} written by 0.5.3's persistGenerationErrorRow (chat id listed)", [dead.id])

		// group chats — every strategy
		const ordered = await newChat(admin, { name: "Ordered table", groupReplyStrategy: "ordered" }, [chars[0].id, chars[1].id, chars[2].id], [personas[0].id], ["comedy"])
		await admin.settle(ordered.id)
		for (let t = 0; t < 3; t++) await say(admin, ordered.id, personas[0].id, sentence(9))
		ctx.chats.ordered = ordered.id

		const manual = await newChat(admin, { name: "Manual table", groupReplyStrategy: "manual" }, [chars[3].id, chars[4].id], [personas[0].id, personas[2].id])
		await admin.settle(manual.id)
		await say(admin, manual.id, personas[0].id, "Who speaks first?")
		await admin.fire("chats:triggerGenerateMessage", { chatId: manual.id, characterId: chars[4].id, once: true }, 1200)
		await admin.settle(manual.id)
		await say(admin, manual.id, personas[2].id, "And now the other one.")
		await admin.fire("chats:triggerGenerateMessage", { chatId: manual.id, characterId: chars[3].id, once: true }, 1200)
		await admin.settle(manual.id)
		ctx.chats.manual = manual.id
		edge("group-manual", "chats", "group_reply_strategy='manual' (D8) with two personas", [manual.id])

		// visibility mix + narrator + a removed participant
		const vis = await newChat(admin, { name: "Mixed visibility", groupReplyStrategy: "ordered" }, [chars[5].id, chars[6].id, chars[8].id], [personas[0].id])
		await admin.call("chats:updateChatCharacterVisibility", { chatId: vis.id, characterId: chars[6].id, visibility: "minimal" })
		await admin.call("chats:updateChatCharacterVisibility", { chatId: vis.id, characterId: chars[8].id, visibility: "hidden" })
		await admin.call("chats:toggleChatCharacterActive", { chatId: vis.id, characterId: chars[5].id, isActive: false }).catch(() => {})
		await admin.settle(vis.id)
		await say(admin, vis.id, personas[0].id, sentence(7))
		await admin.fire("chats:triggerNarratorResponse", { chatId: vis.id, instructions: "Describe the weather." }, 1200)
		await admin.settle(vis.id)
		await admin.call("chats:update", { chat: { id: vis.id, narratorPromptConfigId: ctx.cfg.narrator, promptConfigId: ctx.cfg.prompt2, samplingConfigId: ctx.sampling.creative2 } })
		await admin.fire("chats:triggerNarratorResponse", { chatId: vis.id }, 1200)
		await admin.settle(vis.id)
		ctx.chats.visibility = vis.id
		edge("visibility-mixed", "chat_characters", "one chat mixing visible/minimal/hidden (D7: most verbose wins) + an inactive character; narrator responses (is_narrator_response, metadata.narratorName/narratorInstructions); chat-level prompt/narrator/sampling overrides", [vis.id])

		const each = await newChat(admin, { name: "All hidden", groupReplyStrategy: "ordered" }, [chars[9].id, chars[10].id], [personas[0].id])
		for (const c of [chars[9].id, chars[10].id]) await admin.call("chats:updateChatCharacterVisibility", { chatId: each.id, characterId: c, visibility: "hidden" })
		await admin.settle(each.id)
		const minimalOnly = await newChat(admin, { name: "All minimal", groupReplyStrategy: "ordered" }, [chars[11].id, chars[12].id], [personas[0].id])
		for (const c of [chars[11].id, chars[12].id]) await admin.call("chats:updateChatCharacterVisibility", { chatId: minimalOnly.id, characterId: c, visibility: "minimal" })
		await admin.settle(minimalOnly.id)
		ctx.chats.allHidden = each.id
		ctx.chats.allMinimal = minimalOnly.id

		// a removed participant (soft remove keeps removed_at/removed_name)
		const rem = await newChat(admin, { name: "Someone left", groupReplyStrategy: "ordered" }, [chars[2].id, chars[3].id], [personas[0].id])
		await admin.settle(rem.id)
		await say(admin, rem.id, personas[0].id, "Before you go…")
		await admin.call("chats:update", { chat: { id: rem.id }, characterIds: [chars[2].id], personaIds: [personas[0].id], characterPositions: { [chars[2].id]: 0 } })
		ctx.chats.removed = rem.id
		edge("removed-participant", "chat_characters", "removed_at/removed_name set by chats:update dropping a character that has spoken", [rem.id])

		// summarize chat type + seeded prompt config id 7 (E4.1 seed-key rename trap)
		const summ = await newChat(admin, { name: "Summarize scratch" }, [chars[1].id], [personas[0].id])
		await admin.call("chats:update", { chat: { id: summ.id, chatType: "summarize", promptConfigId: 7, samplingConfigId: ctx.sampling.precise } })
		ctx.chats.summarize = summ.id
		edge("chat-summarize-type", "chats", "chat_type='summarize' (written via chats:update; 0.5.3's summarizer itself never persists one)", [summ.id])
		edge("chat-seeded-prompt-7", "chats", "prompt_config_id = 7 (seeded 'prompt-neutral-chat', renamed 'prompt-neutral-session' in 0.6) — resolve by seed_key (E4.1)", [summ.id])

		// rag-ignored chat metadata, branch, lorebook set
		await admin.call("vectorization:setChatRagIgnored", { chatId: ordered.id, ignored: true })
		const msgs = (await admin.chat(solo.id)).chatMessages
		const br = await admin.call("chats:branch", { chatId: solo.id, messageId: msgs[Math.floor(msgs.length / 2)].id, title: "Harbour talk (branch)" })
		ctx.chats.branch = br.chat?.id
		await admin.call("chats:setLorebook", { chatId: ordered.id, lorebookId: ctx.books.graph })
		edge("chat-branch", "chats", "chats:branch copy of a chat up to a message", [br.chat?.id])
		edge("chat-rag-ignored", "chats", "metadata.ragIgnored=true", [ordered.id])

		// scenes on the graph book
		const h2 = await hist(ctx.books.graph, { year: 4, month: 7, day: 1, content: "Scene-backed history." })
		const om = (await admin.chat(ordered.id)).chatMessages
		const scene = await admin.call("scenes:create", { scene: { chatId: ordered.id, lorebookId: ctx.books.graph, historyEntryId: h2.id, name: "Opening table", selectedMessageIds: om.slice(0, 4).map((m: any) => m.id), summary: para(1), participantCharacters: [ctx.graph.gb0, ctx.graph.gb1], mentionedCharacters: [ctx.graph.nA] } })
		ctx.scenes = [scene.scene.id]
		ctx.graph.h2 = h2.id
		edge("scene-with-cast", "scenes", "scene with selected_message_ids, scene_characters (participant + mentioned), history entry", [scene.scene.id])
	}

	// user settings / theme / background / setup / system flags -------------------
	if (profile === "big") {
		const bg = await admin.call("userSettings:uploadBackground", { backgroundFile: makePng(900, 96), mimeType: "image/png" })
		await admin.call("userSettings:updateBackground", { path: bg.path, opacity: 60 })
		await admin.call("userSettings:updateTheme", { theme: "cerberus" })
		await admin.call("userSettings:updateShowAllCharacterFields", { enabled: true })
		await admin.call("userSettings:updateEasyPersonaCreation", { enabled: false })
		const theme = await admin.call("customThemes:save", { name: "fixture-dusk", label: "Fixture Dusk", css: "[data-theme='fixture-dusk'] { --color-primary-500: 120 80 200; }" })
		await admin.call("customThemes:setInstanceTheme", { id: theme.theme.id, enabled: true })
		edge("custom-theme", "custom_themes", "instance custom theme", [theme.theme.id])
		edge("uploaded-background", "user_settings", "background_image_path names an UPLOADED file (→ files row + background_media_id)", [ctx.adminId])
		await admin.call("setup:markComplete", { step: "rag" })
		await admin.call("setup:markComplete", { step: "summarization" })
		await admin.call("systemSettings:updateSummarizationEnabled", { enabled: true })
		await admin.call("systemSettings:updateContextDebuggingEnabled", { enabled: true })
	} else {
		await admin.call("setup:markComplete", { step: "rag" })
	}

	// users, accounts, tokens, per-user data through their own sockets ------------
	if (profile === "big") {
		const [u2, u3] = [ctx.u2, ctx.u3]
		await admin.call("systemSettings:updateAccountsEnabled", { enabled: true })
		admin.close()
		const tAdmin = await login(ctx.adminUsername, "Fixture-Admin-1!")
		const tBard = await login("bard", "Fixture-Bard-1!")
		const tGuest = await login("guest", "Fixture-Guest-1!")
		const A = await Client.connect("admin", tAdmin)
		const B2 = await Client.connect("bard", tBard)
		const G = await Client.connect("guest", tGuest)
		edge("multi-user", "users", "3 users, accounts enabled, one non-admin; every user has a passphrase and a live user_tokens row", Object.values(ctx.users))

		// per-user tags collide by name with admin's (per-user uniqueness, E4.10)
		await B2.call("tags:create", { tag: { name: "Fantasy", colorPreset: "preset-filled-error-500" } })
		await G.call("tags:create", { tag: { name: "fantasy" } })
		edge("tag-name-across-users", "tags", "'fantasy'/'Fantasy' exist for three different users (per-user lower(name) uniqueness)")
		const bP = (await B2.call("personas:create", { persona: { name: "Lute", description: "A travelling bard.", isDefault: true, tags: ["Fantasy"] }, avatarFile: makePng(501) })).persona
		const gP = (await G.call("personas:create", { persona: { name: "Pip", description: "Curious guest.", isDefault: true } })).persona
		const gP2 = (await G.call("personas:create", { persona: { name: "Pip (alt)", description: "Second default candidate.", isDefault: false } })).persona
		const bC = (await B2.call("characters:create", { character: { name: "Verse", description: para(2), firstMessage: "Sing with me, {{user}}.", tags: ["Fantasy"] } })).character
		const gC = (await G.call("characters:create", { character: { name: "Echo", description: para(1), firstMessage: "…hello?" } })).character
		ctx.userData = { bardPersona: bP.id, guestPersona: gP.id, guestPersona2: gP2.id, bardChar: bC.id, guestChar: gC.id }
		const bBook = (await B2.call("lorebooks:create", { name: "Bard's songbook" })).lorebook
		await B2.call("worldLoreEntries:create", { worldLoreEntry: { lorebookId: bBook.id, name: "Ballad", keys: "ballad", content: para(1) } }, 30000, "worldLoreEntries:list")
		await B2.call("userSettings:updateDarkMode", { enabled: false })
		await B2.call("userSettings:updateTheme", { theme: "fixture-dusk" })
		await G.call("userSettings:updateShowHomePageBanner", { enabled: false })

		// userSplit group chat with guests: bard plays, guest watches
		const split = await newChat(A, { name: "Shared table", groupReplyStrategy: "userSplit" }, [chars[0].id, chars[1].id], [personas[0].id])
		await A.call("chats:addGuest", { chatId: split.id, guestUserId: u2.id })
		await A.call("chats:addGuest", { chatId: split.id, guestUserId: u3.id })
		await B2.call("chats:addPersona", { chatId: split.id, personaId: bP.id })
		await A.settle(split.id)
		await A.callAndSettle("chatMessages:sendPersonaMessage", { chatId: split.id, personaId: personas[0].id, content: "Welcome, both of you." }, split.id)
		await B2.callAndSettle("chatMessages:sendPersonaMessage", { chatId: split.id, personaId: bP.id, content: "A song for the table!" }, split.id)
		ctx.chats.userSplit = split.id
		edge("group-user-split-guests", "chats,chat_guests", "group_reply_strategy='userSplit' with two guests (one with a persona in the chat, one guest user without)", [split.id])

		// bard's own chat; guest's own chat
		const bChat = await newChat(B2, { name: "Bard solo" }, [bC.id], [bP.id], ["Fantasy"])
		await B2.settle(bChat.id)
		await B2.callAndSettle("chatMessages:sendPersonaMessage", { chatId: bChat.id, personaId: bP.id, content: "Tune check." }, bChat.id)
		const gChat = await newChat(G, { name: "Guest solo" }, [gC.id], [gP.id])
		await G.settle(gChat.id)
		ctx.chats.bard = bChat.id
		ctx.chats.guest = gChat.id
		A.close()
		B2.close()
		G.close()

		// vectorization queue over everything 0.5.3 embeds (fake API, all-minilm 384d)
		const A2 = await Client.connect("admin", await login(ctx.adminUsername, "Fixture-Admin-1!"))
		await A2.call("vectorization:startQueue", {}).catch((e) => log("startQueue:", e.message))
		for (let i = 0; i < 240; i++) {
			const q = await A2.call("vectorization:getQueue", {}).catch(() => null)
			const pending = q ? (q.items?.length ?? q.queue?.length ?? q.pending ?? 0) : 0
			const running = q?.isRunning ?? q?.running ?? false
			if (i > 30 && !running && !pending) break
			await sleep(500)
		}
		await A2.call("vectorization:stopQueue", {}).catch(() => {})
		A2.close()
	} else {
		admin.close()
	}
}

// ─── BULK LAYER (bundle stopped; bundle's own PGlite) ────────────────────────

type PG = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>; exec: (sql: string) => Promise<unknown>; close: () => Promise<void>; dumpDataDir: (c?: "gzip" | "none") => Promise<Blob> }
async function openPg(dbDir: string): Promise<PG> {
	const mod = await import(pathToFileURL(path.join(BUNDLE, "node_modules/@electric-sql/pglite/dist/index.js")).href)
	const pg = await mod.PGlite.create({ dataDir: dbDir })
	return pg
}
const one = async (pg: PG, sql: string, p: unknown[] = []) => (await pg.query(sql, p)).rows[0]
const all = async (pg: PG, sql: string, p: unknown[] = []) => (await pg.query(sql, p)).rows
const ids = async (pg: PG, sql: string, p: unknown[] = []) => (await all(pg, sql, p)).map((r) => r.id)

/** Copies a row (all columns but id + overrides) and returns the new id. */
async function cloneRow(pg: PG, table: string, id: number, overrides: Record<string, unknown> = {}, idCol = "id") {
	const cols = (await all(pg, `select column_name from information_schema.columns where table_schema='public' and table_name=$1 and column_name<>$2 and is_generated='NEVER' order by ordinal_position`, [table, idCol])).map((r) => r.column_name)
	const keys = Object.keys(overrides)
	const sel = cols.map((c) => (keys.includes(c) ? `$${keys.indexOf(c) + 2}` : `"${c}"`)).join(", ")
	const r = await one(pg, `insert into "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) select ${sel} from "${table}" where "${idCol}"=$1 returning "${idCol}" as id`, [id, ...keys.map((k) => overrides[k])])
	return r.id as number
}

async function bulkLayer(pg: PG, profile: Profile) {
	rand = mulberry32(5303)
	const u = ctx.users ?? { admin: ctx.adminId }
	await pg.exec("begin")
	try {
		// stuck generation in the tiny one too
		const lastMsg = await one(pg, `select id from chat_messages where chat_id=$1 and role='assistant' order by id desc limit 1`, [ctx.chats.solo])
		if (profile === "tiny") {
			await pg.query(`update chat_messages set is_generating=true, generation_stage='generating', queue_item_id=$2 where id=$1`, [lastMsg.id, crypto.randomUUID()])
			edge("message-stuck-generating", "chat_messages", "is_generating=true left by a crash (generation_stage 'generating', queue_item_id set)", [lastMsg.id])
			// one history date that clamps
			const h = await one(pg, `insert into history_entries (lorebook_id, year, month, day, content) values ($1, 0, 0, 5, 'Clamp me: year 0, month 0, day 5') returning id`, [ctx.books.atlas])
			edge("history-clamp", "history_entries", "year 0 / month 0 / day 5 → clamp to year 1, month 1", [h.id])
			await pg.exec("commit")
			return
		}

		// ── characters → 60 ────────────────────────────────────────────────
		const srcChars = await ids(pg, `select id from characters where user_id=$1 and not is_deleted order by id`, [u.admin])
		const owners = [u.admin, u.admin, u.admin, u.bard, u.guest]
		let nChars = Number((await one(pg, `select count(*)::int n from characters`)).n)
		let k = 0
		while (nChars < 60) {
			const src = srcChars[k++ % srcChars.length]
			const owner = owners[k % owners.length]
			await cloneRow(pg, "characters", src, { uuid: crypto.randomUUID(), user_id: owner, name: `${pick(FIRST)} ${pick(LAST)} ${k}`, is_favorite: k % 17 === 0, lorebook_id: null, avatar: null, embedding: null, embedding_model: null, vectorized_at: null })
			nChars++
		}
		// a second soft-deleted one owned by bard
		const bardDel = await one(pg, `update characters set is_deleted=true where id=(select max(id) from characters where user_id=$1) returning id`, [u.bard])
		edge("character-soft-deleted-other-user", "characters", "soft-deleted character owned by a non-admin user", [bardDel.id])

		// ── personas → 8 (+ 0133 uuid collision) ──────────────────────────
		let nPers = Number((await one(pg, `select count(*)::int n from personas`)).n)
		const pSrc = ctx.personas[3]
		while (nPers < 8) {
			await cloneRow(pg, "personas", pSrc, { uuid: crypto.randomUUID(), name: `Persona ${nPers + 1}`, is_default: false, position: nPers, avatar: null, embedding: null, embedding_model: null, vectorized_at: null })
			nPers++
		}
		const collideChar = await one(pg, `select id, uuid from characters where user_id=$1 and id=$2`, [u.admin, ctx.chars[5]])
		await pg.query(`update personas set uuid=$1 where id=$2`, [collideChar.uuid, ctx.personas[2]])
		edge("persona-character-uuid-collision", "personas", "persona shares its uuid with a character of the same user (0133 path: fresh uuid on merge)", [ctx.personas[2], collideChar.id])
		// two is_default personas for the guest (0.5.3 never enforced one) → keep only the lowest id
		await pg.query(`update personas set is_default=true where id=$1`, [ctx.userData.guestPersona2])
		edge("persona-two-defaults", "personas", "guest has two is_default personas → is_default_persona kept only on the lowest id (partial unique)", [ctx.userData.guestPersona, ctx.userData.guestPersona2])
		await pg.query(`update personas set position=7 where id=$1`, [ctx.personas[1]])
		edge("persona-position", "personas", "non-zero position (D-loss 2)", [ctx.personas[1]])
		// persona tags
		const tagIds = await ids(pg, `select id from tags where user_id=$1 order by id`, [u.admin])
		for (const p of ctx.personas) await pg.query(`insert into persona_tags (persona_id, tag_id) values ($1,$2) on conflict do nothing`, [p, tagIds[0]])
		// persona and character with the same tag (persona_tags → character_tags ON CONFLICT path)
		for (const [j, b] of [ctx.books.atlas, ctx.books.graph, ctx.books.legacy].entries()) await pg.query(`insert into lorebook_tags (lorebook_id, tag_id) values ($1,$2),($1,$3) on conflict do nothing`, [b, tagIds[j], tagIds[j + 1]])
		edge("lorebook-tags", "lorebook_tags", "lorebook_tags rows (0.5.3 has no writer for them — processLorebookTags is never called — but older installs carry them)", [ctx.books.atlas, ctx.books.graph, ctx.books.legacy])
		edge("persona-tags", "persona_tags", "every admin persona tagged; persona_tags → character_tags through the persona map", ctx.personas)

		// ── lorebooks → 12 ─────────────────────────────────────────────────
		let nBooks = Number((await one(pg, `select count(*)::int n from lorebooks`)).n)
		const bookOwners = [u.admin, u.bard, u.guest]
		const bulkBooks: number[] = []
		while (nBooks < 12) {
			const b = await one(pg, `insert into lorebooks (name, description, user_id, next_binding_number) values ($1,$2,$3,1) returning id`, [`Bulk Book ${nBooks + 1}`, sentence(8), bookOwners[nBooks % 3]])
			bulkBooks.push(b.id)
			nBooks++
		}

		// ── bindings: duplicates, legacy tokens, collisions, persona/char collapse ─
		const atlas = ctx.books.atlas
		const dupe = await one(pg, `insert into lorebook_bindings (lorebook_id, character_id, binding, name) select lorebook_id, character_id, '{{char:' || (select next_binding_number from lorebooks where id=$1) || '}}', name from lorebook_bindings where id=$2 returning id`, [atlas, ctx.bindings.char0])
		await pg.query(`update lorebooks set next_binding_number=next_binding_number+1 where id=$1`, [atlas])
		edge("binding-duplicate-character", "lorebook_bindings", "two bindings for the same character in one book (allowed in 0.5.3: persona_id NULL defeats the unique index) — 0.6 unique (lorebook, character) must merge", [ctx.bindings.char0, dupe.id])
		const [lb0, lb1, lb2] = ctx.legacyBindings
		await pg.query(`update lorebook_bindings set binding='{char:1}' where id=$1`, [lb0])
		await pg.query(`update lorebook_bindings set binding='{char:2}' where id=$1`, [lb1])
		await pg.query(`update lorebook_bindings set binding='{{char:2}}' where id=$1`, [lb2])
		edge("binding-legacy-token", "lorebook_bindings", "old '{char:N}' spelling", [lb0, lb1])
		edge("binding-token-collision", "lorebook_bindings", "'{char:2}' and '{{char:2}}' in the same book → normalise + renumber (0200), (lorebook_id, binding) unique in 0.6 (0201)", [lb1, lb2])
		// persona + character with the same uuid both bound in one book
		const collP = await one(pg, `insert into lorebook_bindings (lorebook_id, persona_id, binding, name) values ($1,$2,'{{char:90}}','collide persona') returning id`, [ctx.books.legacy, ctx.personas[2]])
		const collC = await one(pg, `insert into lorebook_bindings (lorebook_id, character_id, binding, name) values ($1,$2,'{{char:91}}','collide char') returning id`, [ctx.books.legacy, ctx.chars[5]])
		edge("binding-persona-character-same-uuid", "lorebook_bindings", "a book binds both the persona and the character that share a uuid", [collP.id, collC.id])
		// alias child (parent_node_id) + history-linked + scene-linked binding
		await pg.query(`update lorebook_bindings set parent_node_id=$1, history_entry_id=$3 where id=$2`, [ctx.graph.nA, ctx.graph.nD, ctx.graph.gh])
		edge("binding-parent-and-history", "lorebook_bindings", "parent_node_id alias child + history_entry_id (→ remapped entry id)", [ctx.graph.nD])

		// ── lore entries → 2000 ───────────────────────────────────────────
		const books = [atlas, ctx.books.graph, ctx.books.legacy, ...bulkBooks]
		const wlSrc = ctx.entries.world
		const clSrc = ctx.entries.character
		const hlSrc = ctx.entries.history
		const count = async (t: string) => Number((await one(pg, `select count(*)::int n from ${t}`)).n)
		const total = async () => (await count("world_lore_entries")) + (await count("character_lore_entries")) + (await count("history_entries"))
		let n = await total()
		const keySets = ["harbour, docks", "a, b ,,c", " spaced , keys ", "", "/regex(es)?/i", "single", "comma,,double,,", "Ünïcode, 東京"]
		let i = 0
		const bookBindings: Record<number, number[]> = {}
		for (const b of books) bookBindings[b] = await ids(pg, `select id from lorebook_bindings where lorebook_id=$1`, [b])
		while (n < 2000) {
			const book = books[i % books.length]
			const kind = Math.floor(i / books.length) % 3 // every book gets every kind
			const pos = i % 11 === 0 ? 0 : i // many duplicate position 0s
			if (kind === 0) {
				await cloneRow(pg, "world_lore_entries", wlSrc[i % wlSrc.length], { lorebook_id: book, name: `World ${i}`, keys: keySets[i % keySets.length], position: pos, category: pick(["Places", "Factions", null, "Items"]), priority: int(0, 9), embedding: null, embedding_model: null, vectorized_at: null })
			} else if (kind === 1) {
				const bs = bookBindings[book]
				await cloneRow(pg, "character_lore_entries", clSrc[i % clSrc.length], { lorebook_id: book, name: `Char lore ${i}`, keys: keySets[i % keySets.length], position: pos, character_binding_id: bs.length && i % 4 ? bs[i % bs.length] : null, embedding: null, embedding_model: null, vectorized_at: null })
			} else {
				const month = i % 7 === 0 ? null : int(1, 12)
				await cloneRow(pg, "history_entries", hlSrc[i % hlSrc.length], { lorebook_id: book, year: int(1, 400), month, day: month && i % 3 ? int(1, 28) : null, position: pos, content: sentence(10), is_completed: i % 5 === 0, graphed: i % 9 === 0, embedding: null, embedding_model: null, vectorized_at: null })
			}
			i++
			n++
		}
		edge("entry-duplicate-positions", "world_lore_entries,character_lore_entries,history_entries", "duplicate position values within (lorebook, kind) → renumber unique per (lorebook, type)")
		edge("entry-key-shapes", "world_lore_entries,character_lore_entries,history_entries", "keys text in odd shapes: empty, ', ,,', leading/trailing spaces, regex, unicode → text[] by 0.5.3's split")
		// clamping history dates — replace the last few bulk rows' dates
		const clampRows = await ids(pg, `select id from history_entries where lorebook_id=$1 order by id desc limit 7`, [bulkBooks[0]])
		if (clampRows.length < 7) throw new Error("not enough bulk history rows to plant clamp cases")
		const clampDates: [number, number | null, number | null][] = [[0, 0, 5], [-3, 4, 1], [10, 0, null], [11, null, 9], [12, 13, 2], [13, 2, 0], [14, 5, 32]]
		for (const [j, id] of clampRows.entries()) await pg.query(`update history_entries set year=$2, month=$3, day=$4, content=$5 where id=$1`, [id, ...clampDates[j], `Clamp case ${JSON.stringify(clampDates[j])}`])
		edge("history-clamp", "history_entries", "dates that must clamp (year≥1, month/day ≥1 or null, day without month → month 1): [year,month,day] = " + JSON.stringify(clampDates), clampRows)

		// ── embeddings: known model (live queue), identity mismatch, unknown dims ─
		const known = await one(pg, `select embedding_model_name m, embedding_model_dimensions d from system_settings limit 1`)
		const vecLit = (dims: number, seed: number) => `{${embedVector("seed" + seed, dims).join(",")}}`
		const embedSome = async (table: string, where: string, model: string, dims: number, limit: number) => {
			const rows = await ids(pg, `select id from ${table} where ${where} order by id limit ${limit}`)
			for (const id of rows) await pg.query(`update ${table} set embedding=$2::real[], embedding_model=$3, vectorized_at=now() where id=$1`, [id, vecLit(dims, id), model])
			return rows
		}
		const knownRows = {
			world: await embedSome("world_lore_entries", "embedding is null", known.m, known.d, 120),
			character: await embedSome("character_lore_entries", "embedding is null", known.m, known.d, 80),
			history: await embedSome("history_entries", "embedding is null", known.m, known.d, 80)
		}
		const mismatch = await embedSome("world_lore_entries", "embedding is null", "Xenova/all-MiniLM-L6-v2", 384, 40)
		const unknown = await embedSome("history_entries", "embedding is null", "legacy-mystery-embed", 128, 40)
		const unknownChars = await embedSome("characters", "id in (select id from characters order by id desc limit 5)", "legacy-mystery-embed", 128, 5)
		const unknownBindings = await embedSome("lorebook_bindings", "id in (select id from lorebook_bindings order by id desc limit 5)", "Xenova/all-MiniLM-L6-v2", 384, 5)
		const unknownRels = await embedSome("narrative_relationships", "id in (select id from narrative_relationships order by id desc limit 3)", "legacy-mystery-embed", 128, 3)
		const unknownPersonas = await embedSome("personas", "id in (select id from personas order by id desc limit 2)", "legacy-mystery-embed", 128, 2)
		ctx.embed = { known, knownRows, mismatch, unknown, unknownChars, unknownBindings, unknownRels, unknownPersonas }
		edge("embedding-known-model", "*", `vectors from the configured model '${known.m}' (${known.d}d, vectorization_configs api mode) — D4 carry-when-match`, [...knownRows.world.slice(0, 3)])
		edge("embedding-identity-mismatch", "world_lore_entries,lorebook_bindings", "vectors from 'Xenova/all-MiniLM-L6-v2' — SAME dims (384) as the configured model but a different identity → drop", mismatch.slice(0, 3))
		edge("embedding-unknown-model", "history_entries,characters,personas,narrative_relationships", "vectors from 'legacy-mystery-embed' (128d, no config names it) → drop", [...unknown.slice(0, 3), ...unknownChars, ...unknownPersonas, ...unknownRels])
		edge("embedding-synthetic-bulk", "*", "bulk-planted vectors are seeded noise, not embeddings of the row's text (socket-layer vectors were written by 0.5.3's own queue against the fake API)")

		// ── chats → 40, messages → 20000 ──────────────────────────────────
		const srcChats = [ctx.chats.solo, ctx.chats.thinking, ctx.chats.ordered, ctx.chats.manual, ctx.chats.visibility, ctx.chats.userSplit]
		const strategies = ["ordered", "manual", "userSplit", null]
		const visibilities = ["visible", "minimal", "hidden"]
		let nChats = Number((await one(pg, `select count(*)::int n from chats`)).n)
		const newChats: number[] = []
		let c = 0
		while (nChats < 40) {
			const src = srcChats[c % srcChats.length]
			const owner = [u.admin, u.admin, u.bard, u.guest][c % 4]
			const strategy = strategies[c % strategies.length]
			const cid = await cloneRow(pg, "chats", src, { name: `Bulk chat ${c + 1}`, user_id: owner, group_reply_strategy: strategy, connection_id: c % 5 === 0 ? ctx.conns.lmstudio : null, sampling_config_id: c % 6 === 0 ? ctx.sampling.dry : null, prompt_config_id: c % 7 === 0 ? ctx.cfg.prompt : null, drafts: c % 8 === 0 ? JSON.stringify({ [String(owner)]: "unsent words" }) : "{}" })
			// cast: owner's characters/personas
			const oc = await ids(pg, `select id from characters where user_id=$1 and not is_deleted order by id limit 3 offset $2`, [owner, c % 4])
			const op = await ids(pg, `select id from personas where user_id=$1 order by id limit 1`, [owner])
			const group = c % 3 !== 2 && oc.length > 1
			const cast = group ? oc : oc.slice(0, 1)
			await pg.query(`update chats set is_group=$2 where id=$1`, [cid, group])
			for (const [p, ch] of cast.entries()) await pg.query(`insert into chat_characters (chat_id, character_id, position, is_active, visibility) values ($1,$2,$3,$4,$5)`, [cid, ch, p, !(c % 9 === 0 && p === 1), visibilities[(c + p) % 3]])
			for (const p of op) await pg.query(`insert into chat_personas (chat_id, persona_id, position) values ($1,$2,0)`, [cid, p])
			const otags = await ids(pg, `select id from tags where user_id=$1 order by id limit 2`, [owner])
			if (c % 2 === 0) for (const t of otags) await pg.query(`insert into chat_tags (chat_id, tag_id) values ($1,$2) on conflict do nothing`, [cid, t])
			newChats.push(cid)
			nChats++
			c++
		}
		edge("chat-null-strategy", "chats", "group_reply_strategy NULL (column is nullable in 0.5.3)", newChats.filter((_, j) => strategies[j % strategies.length] === null).slice(0, 3))
		edge("chat-connection-override", "chats", "connection_id set (D-loss 3: a session names no connection)", newChats.filter((_, j) => j % 5 === 0))

		// message templates from the real (socket-written) messages
		const tmpl = await all(pg, `select id, role, character_id is not null as has_char, persona_id is not null as has_persona, is_narrator_response from chat_messages where chat_id = any($1::int[]) and coalesce(metadata::jsonb->>'isGreeting','false') <> 'true' and error is null order by id`, [srcChats])
		const assistantT = tmpl.filter((t) => t.role === "assistant" && !t.is_narrator_response).map((t) => t.id)
		const userT = tmpl.filter((t) => t.role === "user").map((t) => t.id)
		const narratorT = tmpl.filter((t) => t.is_narrator_response).map((t) => t.id)
		let nMsgs = Number((await one(pg, `select count(*)::int n from chat_messages`)).n)
		const perChat = Math.ceil((20000 - nMsgs) / newChats.length)
		for (const [j, cid] of newChats.entries()) {
			const owner = (await one(pg, `select user_id from chats where id=$1`, [cid])).user_id
			const cast = await ids(pg, `select character_id as id from chat_characters where chat_id=$1 order by position`, [cid])
			const pers = (await one(pg, `select persona_id from chat_personas where chat_id=$1`, [cid]))?.persona_id ?? null
			const want = Math.min(perChat, 20000 - nMsgs)
			// build with one INSERT…SELECT per batch for speed
			const rows: [number, string, number | null, number | null][] = []
			for (let m = 0; m < want; m++) {
				if (m % 2 === 0) rows.push([assistantT[(m + j) % assistantT.length], "a", cast[(m / 2) % cast.length] ?? null, null])
				else if (m % 29 === 0 && narratorT.length) rows.push([narratorT[m % narratorT.length], "n", null, null])
				else rows.push([userT[(m + j) % userT.length], "u", null, pers])
			}
			for (let s = 0; s < rows.length; s += 500) {
				const batch = rows.slice(s, s + 500)
				await pg.query(
					`insert into chat_messages (chat_id, user_id, character_id, persona_id, role, is_narrator_response, content, created_at, updated_at, is_edited, metadata, is_generating, generation_stage, error, queue_item_id, is_hidden, debug_meta)
					 select $1, $2, b.char_id, b.persona_id, t.role, t.is_narrator_response, t.content, t.created_at, t.updated_at, t.is_edited, t.metadata, false, null, t.error, null, (b.ord % 97 = 0), t.debug_meta
					 from unnest($3::int[], $4::int[], $5::int[], $6::int[]) with ordinality as b(src, char_id, persona_id, ord_in, ord)
					 join chat_messages t on t.id = b.src order by b.ord`,
					[cid, owner, batch.map((r) => r[0]), batch.map((r) => r[2]), batch.map((r) => r[3]), batch.map((_, x) => x)]
				)
			}
			nMsgs += want
		}
		// message embeddings: known model on a subset, mismatched on a few
		const msgKnown = await embedSome("chat_messages", "embedding is null and role='assistant'", known.m, known.d, 1200)
		const msgMismatch = await embedSome("chat_messages", "embedding is null and role='user'", "Xenova/all-MiniLM-L6-v2", 384, 100)
		ctx.embed.msgKnown = msgKnown.length
		ctx.embed.msgMismatch = msgMismatch.length
		// stuck generating + error rows in the bulk chats
		const stuck = await one(pg, `update chat_messages set is_generating=true, generation_stage='generating', queue_item_id=$2, content='' where id=(select max(id) from chat_messages where chat_id=$1 and role='assistant') returning id`, [newChats[0], crypto.randomUUID()])
		const queued = await one(pg, `update chat_messages set is_generating=true, generation_stage='queued', queue_item_id=$2, content='' where id=(select max(id) from chat_messages where chat_id=$1 and role='assistant') returning id`, [newChats[1], crypto.randomUUID()])
		edge("message-stuck-generating", "chat_messages", "is_generating=true left by a crash (stage 'generating' and 'queued', queue_item_id set) → false with an aborted generation_status", [stuck.id, queued.id])
		const edited = await ids(pg, `update chat_messages set is_edited=true where id in (select id from chat_messages where chat_id=$1 and role='user' order by id limit 3) returning id`, [newChats[3]])
		edge("message-is-edited", "chat_messages", "is_edited=true (0.5.3's own edit path never sets it; older versions did)", edited)
		const errRow = await one(pg, `update chat_messages set error=$2::json where id=(select min(id) from chat_messages where chat_id=$1 and role='assistant') returning id`, [newChats[2], JSON.stringify({ message: "HTTP 429: rate limited", code: "rate_limit" })])
		edge("message-error-with-code", "chat_messages", "error {message, code}", [errRow.id])
		edge("message-hidden", "chat_messages", "is_hidden=true on every 97th bulk message")
		edge("message-embedding-subset", "chat_messages", `${msgKnown.length} assistant rows embedded with the configured model, ${msgMismatch.length} user rows with 'Xenova/all-MiniLM-L6-v2'`)

		// ── scenes → 10, relationships → 30 ───────────────────────────────
		const g = ctx.books.graph
		const gBindings = await ids(pg, `select id from lorebook_bindings where lorebook_id=$1 order by id`, [g])
		const gHist = await ids(pg, `select id from history_entries where lorebook_id=$1 order by id`, [g])
		const sceneMsgs = await ids(pg, `select id from chat_messages where chat_id=$1 order by id`, [ctx.chats.ordered])
		let nScenes = await count("scenes")
		let s = 0
		while (nScenes < 10) {
			const sc = await one(pg, `insert into scenes (chat_id, lorebook_id, history_entry_id, name, selected_message_ids, summary, cast_resolved_at, graphed) values ($1,$2,$3,$4,$5::json,$6,$7,$8) returning id`, [s % 4 === 3 ? null : ctx.chats.ordered, g, gHist[s % gHist.length], `Scene ${s + 2}`, JSON.stringify(sceneMsgs.slice(s, s + 3)), sentence(12), s % 2 ? new Date() : null, s % 3 === 0])
			await pg.query(`insert into scene_characters (scene_id, binding_id, role, ordinal) values ($1,$2,'participant',0), ($1,$3,'mentioned',1)`, [sc.id, gBindings[s % gBindings.length], gBindings[(s + 1) % gBindings.length]])
			if (s === 0) await pg.query(`insert into scene_characters (scene_id, binding_id, role, ordinal) values ($1,$2,'mentioned',2) on conflict do nothing`, [sc.id, gBindings[s % gBindings.length]])
			nScenes++
			s++
		}
		edge("scene-chat-null", "scenes", "scene whose chat was deleted (chat_id NULL)")
		edge("scene-character-both-roles", "scene_characters", "the same binding is both participant and mentioned in one scene")
		const sceneIds = await ids(pg, `select id from scenes order by id`)
		let nRels = await count("narrative_relationships")
		const types = ["ally", "enemy", "rival", "mentor", "family", "romantic", "neutral", "complicated", "life_debt"]
		let r = 0
		while (nRels < 30) {
			const a = gBindings[r % gBindings.length]
			const b = gBindings[(r + 1 + (r % 3)) % gBindings.length]
			await pg.query(`insert into narrative_relationships (lorebook_id, from_node_id, to_node_id, history_entry_id, scene_id, relationship_type, description, visibility, status, reason) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [g, a, b === a ? gBindings[(r + 2) % gBindings.length] : b, r % 2 ? gHist[r % gHist.length] : null, r % 3 === 0 ? sceneIds[r % sceneIds.length] : null, types[r % types.length], sentence(8), ["secret", "acknowledged", "public"][r % 3], ["active", "resolved", "broken", "evolved"][r % 4], r % 4 ? sentence(5) : null])
			nRels++
			r++
		}
		// a scene whose history entry is a clamp case (NOT NULL FK to a remapped entry)
		await pg.query(`update scenes set history_entry_id=$2 where id=$1`, [sceneIds.at(-1), clampRows[0]])
		edge("scene-on-clamped-history", "scenes", "scene pointing at a history entry whose date clamps", [sceneIds.at(-1)])

		// ── koboldcpp/ollama singletons + models ───────────────────────────
		await pg.query(`update ollama_settings set ollama_manager_enabled=true, ollama_base_url='http://127.0.0.1:11434/' where id=1`)
		await pg.query(`update koboldcpp_settings set koboldcpp_manager_enabled=true, koboldcpp_managed_mode='managed', koboldcpp_models_dir='/srv/models', koboldcpp_managed_binary_variant='cuda12', koboldcpp_managed_binary_dir='/srv/kcpp', koboldcpp_managed_port=5011, koboldcpp_managed_admin_password='fixture-admin-pw', koboldcpp_managed_model_ttl_secs=600, koboldcpp_managed_release_tag='v1.98' where id=1`)
		for (const [fn, st, err] of [["mythomax-l2-13b.Q4_K_M.gguf", "complete", null], ["qwen2.5-7b-instruct-q5_k_m.gguf", "complete", null], ["half-done.gguf", "downloading", null], ["broken.gguf", "error", "HTTP 404"]] as const)
			await pg.query(`insert into koboldcpp_models (filename, model_name, model_url, download_url, description, quantization, size_bytes, status, error_message) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [fn, fn.replace(/\.gguf$/, ""), "https://huggingface.co/x/" + fn, "https://huggingface.co/x/resolve/main/" + fn, "fixture model", "Q4_K_M", 4_000_000_000, st, err])
		edge("koboldcpp-models", "koboldcpp_models", "complete ×2, downloading, error → local_models (format gguf, kind text, kind_source assumed)")
		edge("koboldcpp-settings-managed", "koboldcpp_settings", "managed mode with admin password, custom port/ttl/release tag")

		await pg.exec("commit")
	} catch (e) {
		await pg.exec("rollback")
		throw e
	}
}

// ─── counting + manifest ─────────────────────────────────────────────────────

async function countAll(pg: PG) {
	const tables = (await all(pg, `select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name`)).map((r) => r.table_name)
	const counts: Record<string, number> = {}
	for (const t of tables) counts[t] = Number((await one(pg, `select count(*)::int n from "${t}"`)).n)
	const ledger = await one(pg, `select count(*)::int n, max(created_at)::text as max from drizzle.__drizzle_migrations`).catch(() => null)
	return { counts, ledger }
}

async function detailCounts(pg: PG) {
	const q = async (sql: string) => (await all(pg, sql))
	return {
		connectionsByType: Object.fromEntries((await q(`select type, count(*)::int n from connections group by type order by type`)).map((r) => [r.type, r.n])),
		chatsByStrategy: Object.fromEntries((await q(`select coalesce(group_reply_strategy,'(null)') s, count(*)::int n from chats group by 1 order by 1`)).map((r) => [r.s, r.n])),
		chatsByType: Object.fromEntries((await q(`select chat_type t, is_group g, count(*)::int n from chats group by 1,2 order by 1,2`)).map((r) => [`${r.t}/${r.g ? "group" : "solo"}`, r.n])),
		chatCharacterVisibility: Object.fromEntries((await q(`select visibility v, count(*)::int n from chat_characters group by 1 order by 1`)).map((r) => [r.v, r.n])),
		messages: (await q(`select count(*)::int total, count(*) filter (where is_generating)::int generating, count(*) filter (where error is not null)::int errors, count(*) filter (where is_hidden)::int hidden, count(*) filter (where is_narrator_response)::int narrator, count(*) filter (where is_edited)::int edited, count(*) filter (where (metadata::jsonb->'swipes'->'history') is not null and jsonb_array_length(metadata::jsonb->'swipes'->'history') > 1)::int multi_swipe, count(*) filter (where (metadata::jsonb->>'thinking') is not null)::int thinking, count(*) filter (where (metadata::jsonb->>'isGreeting')='true')::int greetings, count(*) filter (where persona_id is not null)::int persona_authored from chat_messages`))[0],
		embeddingsByModel: (await q(`select t, embedding_model m, array_length(embedding,1) d, count(*)::int n from (
				select 'world_lore_entries' t, embedding_model, embedding from world_lore_entries union all
				select 'character_lore_entries', embedding_model, embedding from character_lore_entries union all
				select 'history_entries', embedding_model, embedding from history_entries union all
				select 'chat_messages', embedding_model, embedding from chat_messages union all
				select 'characters', embedding_model, embedding from characters union all
				select 'personas', embedding_model, embedding from personas union all
				select 'lorebook_bindings', embedding_model, embedding from lorebook_bindings union all
				select 'narrative_relationships', embedding_model, embedding from narrative_relationships union all
				select 'scenes', embedding_model, embedding from scenes
			) x where embedding is not null group by 1,2,3 order by 1,2`)),
		bindingTokens: Object.fromEntries((await q(`select case when binding like '{{char:%}}' then 'double' when binding like '{char:%}' then 'single' else 'other' end k, count(*)::int n from lorebook_bindings group by 1 order by 1`)).map((r) => [r.k, r.n])),
		historyClampCandidates: Number((await one(pg, `select count(*)::int n from history_entries where year < 1 or month < 1 or month > 12 or day < 1 or day > 31 or (day is not null and month is null)`)).n),
		usersAdmin: Object.fromEntries((await q(`select username, is_admin from users order by id`)).map((r) => [r.username, r.is_admin])),
		systemSettings: (await q(`select is_accounts_enabled, vectorization_enabled, embedding_model_name, embedding_model_dimensions, summarization_enabled, default_connection_id, default_sampling_id from system_settings`))[0],
		vectorizationConfig: (await q(`select mode, api_base_url, api_model, api_dimensions, api_key is not null as has_key from vectorization_configs`))[0]
	}
}

function listFiles(dir: string, base = dir): string[] {
	if (!fs.existsSync(dir)) return []
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))])).sort()
}

// ─── orchestration ───────────────────────────────────────────────────────────

async function gateBoot(dataRoot: string, logFile: string) {
	await startBundle(dataRoot, logFile)
	// a socket round-trip proves the populated db serves (accounts may be enabled → login)
	// read-only: a login would write a user_tokens row and break count parity
	const settings: any = await fetch(BASE + "/api/system-settings").then((r) => r.json())
	let chars: any = {}
	let chats: any = {}
	let loginProbe: number | null = null
	if (settings.isAccountsEnabled) {
		// a wrong passphrase reads users + passphrases and writes nothing
		loginProbe = (await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: ctx.adminUsername ?? "admin", passphrase: "Wrong-Passphrase-1!" }) })).status
		if (loginProbe !== 401) throw new Error(`gate: wrong-passphrase login answered ${loginProbe}, expected 401`)
	} else {
		const c = await Client.connect("gate")
		chars = await c.call("characters:list", {})
		chats = await c.call("chats:list", {})
		c.close()
	}
	await stopBundle()
	const errLines = fs.readFileSync(logFile, "utf8").split("\n").filter((l) => /Error|FATAL|failed/i.test(l) && !/VersionCheck|no internet/i.test(l))
	return { accountsEnabled: !!settings.isAccountsEnabled, loginProbe, characterList: chars.characterList?.length ?? null, chatList: chats.chatList?.length ?? null, suspiciousLogLines: errLines.slice(0, 20) }
}

async function buildProfile(profile: Profile) {
	edges.length = 0
	for (const k of Object.keys(ctx)) delete ctx[k]
	rand = mulberry32(profile === "big" ? 530 : 531)
	replyCounter = 0
	const root = path.join(WORK, profile)
	fs.rmSync(root, { recursive: true, force: true })
	fs.mkdirSync(root, { recursive: true })
	const logFile = path.join(WORK, `${profile}.bundle.log`)
	log(`[${profile}] booting 0.5.3 on ${BASE}, data ${root}`)
	// The model host runs only while the socket layer writes. It must be DOWN
	// for every later boot: 0.5.3 resumes its vectorization queue at boot and
	// would re-embed (and so erase) the planted foreign-model vectors.
	const host = await startModelHost()
	await startBundle(root, logFile)
	try {
		await socketLayer(profile)
	} finally {
		await stopBundle()
		await new Promise((r) => host.close(r))
	}
	log(`[${profile}] socket layer done; bulk layer`)
	const dbDir = path.join(root, "data/serene-pub.db")
	{
		const pg = await openPg(dbDir)
		await bulkLayer(pg, profile)
		await pg.close()
	}
	log(`[${profile}] gate boot`)
	const gate = await gateBoot(root, logFile)
	log(`[${profile}] gate`, gate)

	const out = outDir(profile)
	fs.mkdirSync(out, { recursive: true })
	const pg = await openPg(dbDir)
	const { counts, ledger } = await countAll(pg)
	const detail = await detailCounts(pg)
	const blob = await pg.dumpDataDir("gzip")
	await pg.close()
	fs.writeFileSync(path.join(out, "serene-pub.db.tgz"), Buffer.from(await blob.arrayBuffer()))
	const meta = JSON.parse(fs.readFileSync(path.join(root, "data/meta.json"), "utf8"))
	delete meta.lock
	fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify(meta, null, 2) + "\n")
	fs.writeFileSync(path.join(out, "meta.dev.json"), JSON.stringify({ ...meta, version: "0.0.0" }, null, 2) + "\n")
	const usersDir = path.join(root, "data/users")
	const files = listFiles(usersDir)
	if (files.length) {
		await new Promise<void>((res, rej) => {
			const p = spawn("tar", ["-czf", path.join(out, "users.tgz"), "--sort=name", "--owner=0", "--group=0", "--mtime=2026-10-01", "-C", path.join(root, "data"), "users"], { stdio: "inherit" })
			p.on("exit", (code) => (code === 0 ? res() : rej(new Error("tar users failed"))))
		})
	} else fs.rmSync(path.join(out, "users.tgz"), { force: true })
	const manifest = {
		fixture: profile,
		generator: "scripts/fixtures/populate-0.5.3.ts",
		generatedAt: new Date().toISOString(),
		bundle: { path: BUNDLE, version: JSON.parse(fs.readFileSync(path.join(BUNDLE, "package.json"), "utf8")).version, pglite: "0.2.17", lastMigration: "0093_green_bushwacker" },
		meta: { version: meta.version, devVariant: "meta.dev.json (version 0.0.0)", hasCryptoSecretKey: !!meta.cryptoSecretKey },
		credentials: profile === "big" ? { admin: [ctx.adminUsername, "Fixture-Admin-1!"], bard: ["bard", "Fixture-Bard-1!"], guest: ["guest", "Fixture-Guest-1!"] } : null,
		fakeModelHost: MODEL_BASE,
		counts,
		migrationLedger: ledger,
		detail,
		ids: { users: ctx.users ?? { admin: ctx.adminId }, connections: ctx.conns, sampling: ctx.sampling, legacyConfigs: ctx.cfg, lorebooks: ctx.books, chats: ctx.chats, characters: ctx.chars, personas: ctx.personas, perUser: ctx.userData, graph: ctx.graph, embedding: ctx.embed ? { configuredModel: ctx.embed.known } : undefined },
		edgeCases: edges,
		files: { usersTgz: files.length ? "users.tgz" : null, entries: files },
		gate
	}
	fs.writeFileSync(path.join(out, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n")
	log(`[${profile}] wrote ${out}: tgz ${(fs.statSync(path.join(out, "serene-pub.db.tgz")).size / 1e6).toFixed(2)} MB`)
}

/** Gate on the committed fixture: extract into a scratch dir, boot under 0.5.3, stop, recount == MANIFEST. */
async function verifyProfile(profile: Profile) {
	const out = outDir(profile)
	const manifest = JSON.parse(fs.readFileSync(path.join(out, "MANIFEST.json"), "utf8"))
	ctx.adminUsername = manifest.credentials?.admin?.[0] ?? "admin"
	const root = path.join(WORK, `verify-${profile}`)
	fs.rmSync(root, { recursive: true, force: true })
	fs.mkdirSync(path.join(root, "data"), { recursive: true })
	const mod = await import(pathToFileURL(path.join(BUNDLE, "node_modules/@electric-sql/pglite/dist/index.js")).href)
	const blob = new Blob([fs.readFileSync(path.join(out, "serene-pub.db.tgz"))])
	const dbDir = path.join(root, "data/serene-pub.db")
	const restored = await mod.PGlite.create({ dataDir: dbDir, loadDataDir: blob })
	await restored.close()
	fs.copyFileSync(path.join(out, "meta.json"), path.join(root, "data/meta.json"))
	if (fs.existsSync(path.join(out, "users.tgz"))) await new Promise<void>((res, rej) => spawn("tar", ["-xzf", path.join(out, "users.tgz"), "-C", path.join(root, "data")], { stdio: "inherit" }).on("exit", (c) => (c === 0 ? res() : rej(new Error("untar")))))
	const gate = await gateBoot(root, path.join(WORK, `verify-${profile}.bundle.log`))
	const pg = await openPg(dbDir)
	const { counts } = await countAll(pg)
	await pg.close()
	const diffs = Object.keys({ ...counts, ...manifest.counts }).filter((t) => counts[t] !== manifest.counts[t]).map((t) => `${t}: manifest ${manifest.counts[t]} vs fixture ${counts[t]}`)
	const meta = JSON.parse(fs.readFileSync(path.join(root, "data/meta.json"), "utf8"))
	log(`[verify ${profile}] boot ok (${gate.accountsEnabled ? `accounts on, wrong-passphrase login → ${gate.loginProbe}` : `characters:list ${gate.characterList}, chats:list ${gate.chatList}`}); meta.version after boot ${meta.version}; count diffs: ${diffs.length ? diffs.join("; ") : "none"}`)
	if (gate.suspiciousLogLines.length) log(`[verify ${profile}] log lines to look at:`, gate.suspiciousLogLines)
	if (diffs.length) throw new Error(`[verify ${profile}] counts differ from MANIFEST`)
}

async function main() {
	fs.mkdirSync(WORK, { recursive: true })
	log(`bundle ${BUNDLE}; work ${WORK}`)
	try {
		for (const p of PROFILES) {
			if (!VERIFY_ONLY) await buildProfile(p)
			await verifyProfile(p)
		}
	} finally {
		await stopBundle()
	}
	log("done")
}

main().catch(async (e) => {
	console.error(e)
	await stopBundle()
	process.exit(1)
})
