/**
 * The C7 gate (PLAN-sdk-1.0 §4, R21): core's conversation as a remote must be
 * the same widget as the native copy before anything native is removed — and
 * stays a permanent suite, the acceptance test for any later renderer swap
 * (R23). Run against a live instance:
 *
 *   GATE_URL=http://localhost:5234 GATE_SESSION=4 npm run test:gate
 *
 * For each of the five message style packs it loads the session natively and
 * as a remote (`?remote=1`) and compares, inside the conversation:
 *   - structure: every element's tag and classes, in document order;
 *   - computed styles of every styled element (layout, box, type, colour);
 *   - axe violations: the remote adds no rule the native copy does not break;
 *   - keyboard: the Tab order through the conversation.
 * Exits non-zero with every difference named.
 */
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { createRequire } from "node:module"
import { chromium, type Page } from "playwright"

const URL_BASE = process.env.GATE_URL ?? "http://localhost:5234"
const SESSION = Number(process.env.GATE_SESSION ?? "0")
if (!SESSION) {
	console.error("GATE_SESSION=<id> — a session with a few lines in it (see scripts/c7Gate/README note in the file header)")
	process.exit(2)
}
const PACKS = ["default", "bubbles", "novel", "compact", "cameo"]
const STYLE_PROPS = [
	"display", "position", "box-sizing", "width", "height",
	"margin-top", "margin-right", "margin-bottom", "margin-left",
	"padding-top", "padding-right", "padding-bottom", "padding-left",
	"font-family", "font-size", "font-weight", "line-height", "font-style",
	"color", "background-color", "border-top-width", "border-radius", "gap",
	"flex-direction", "align-items", "justify-content", "opacity", "visibility"
]

type Snapshot = {
	tree: string[]
	styles: Array<{ path: string; style: Record<string, string> }>
	axe: string[]
	tabs: string[]
}

const require = createRequire(import.meta.url)
const axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8")

/** Everything the gate reads off one mode, the conversation's own subtree only. */
async function snapshot(page: Page, remote: boolean): Promise<Snapshot> {
	await page.goto(`${URL_BASE}/sessions/${SESSION}${remote ? "?remote=1" : ""}`)
	await page.waitForSelector(remote ? '[data-sp-owner="core"] .sp-conversation' : ".sp-conversation", { timeout: 60_000 })
	await page.waitForTimeout(2500)
	const shape = await page.evaluate(
		({ remote, props }) => {
			const root = (remote ? document.querySelector('[data-sp-owner="core"] .sp-conversation') : document.querySelector(".sp-conversation")) as HTMLElement
			const tree: string[] = []
			const styles: Array<{ path: string; style: Record<string, string> }> = []
			const walk = (el: Element, path: string) => {
				// A host element's own render is the host's either way; what the
				// widget placed is what is compared — and nothing hidden in a park.
				if (el.hasAttribute("data-sp-park")) return
				const cls = (el.getAttribute("class") ?? "")
					.split(/\s+/)
					.filter((c) => c && !/^s-[\w-]+$/.test(c))
					.sort()
					.join(".")
				const line = `${path} ${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`
				tree.push(line)
				if (cls) {
					const cs = getComputedStyle(el)
					const style: Record<string, string> = {}
					for (const p of props) {
						let v = cs.getPropertyValue(p)
						if (/^-?\d+(\.\d+)?px$/.test(v)) v = `${Math.round(parseFloat(v))}px`
						style[p] = v
					}
					styles.push({ path: line, style })
				}
				let i = 0
				for (const c of el.children) walk(c, `${path}/${i++}`)
			}
			walk(root, "0")
			return { tree, styles }
		},
		{ remote, props: STYLE_PROPS }
	)
	// axe, scoped to the conversation.
	// Served same-origin through the test's own interception: the page's CSP
	// refuses an inline script, and nothing is written into the app.
	if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ url: "/__gate_axe.js" })
	const axe = await page.evaluate(async (remote) => {
		const root = remote ? document.querySelector('[data-sp-owner="core"] .sp-conversation') : document.querySelector(".sp-conversation")
		// @ts-expect-error injected
		const r = await window.axe.run(root, { resultTypes: ["violations"] })
		return (r.violations as Array<{ id: string; nodes: unknown[] }>).map((v) => `${v.id}×${v.nodes.length}`).sort()
	}, remote)
	// Keyboard: from the top of the conversation, the Tab order inside it.
	const tabs = await page.evaluate(async (remote) => {
		const root = (remote ? document.querySelector('[data-sp-owner="core"] .sp-conversation') : document.querySelector(".sp-conversation")) as HTMLElement
		const all = [...root.querySelectorAll<HTMLElement>("a[href],button,input,textarea,select,[tabindex]")].filter(
			(e) => !e.hasAttribute("disabled") && e.tabIndex >= 0 && e.offsetParent !== null
		)
		return all.map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute("aria-label") ?? e.textContent?.trim().slice(0, 24) ?? ""}]`)
	}, remote)
	return { ...shape, axe, tabs }
}

async function pinPack(page: Page, slug: string) {
	await page.goto(`${URL_BASE}/sessions/${SESSION}`)
	await page.waitForSelector(".sp-conversation", { timeout: 60_000 })
	await page.evaluate(async (slug) => {
		const s = await import("/src/lib/client/stores/widgetStyles.svelte.ts")
		const store = s.widgetStylesStore() as { rows?: Array<{ id: number; slug: string }>; pins: Record<string, { slug: string }> }
		for (let i = 0; i < 50 && !store.rows?.length; i++) await new Promise((r) => setTimeout(r, 100))
		// A system style's slug is `<widget>:<preset>` (`systemStyleSlug`).
		const row = store.rows?.find((r) => r.slug === `messages:${slug}`)
		if (!row) throw new Error(`no system style 'messages:${slug}'`)
		// The pin round-trips through the server (the page re-reads its layout
		// settings); asked again once if the first write was lost to a reload.
		for (let attempt = 0; attempt < 2 && store.pins.messages?.slug !== row.slug; attempt++) {
			s.setWidgetStylePin("messages", { id: row.id, slug: row.slug })
			for (let i = 0; i < 100 && store.pins.messages?.slug !== row.slug; i++) await new Promise((r) => setTimeout(r, 100))
		}
		if (store.pins.messages?.slug !== row.slug) throw new Error(`the pin to '${row.slug}' did not come back from the page`)
	}, slug)
}

/* ── streaming (the gate's first bullet) ─────────────────────────────── */

const TOKENS = 120
const TOKEN_MS = 20 // 50 tokens a second: a fast local model

/** An OpenAI-compatible host that streams a fixed reply at a fixed rate. */
async function fakeModel(): Promise<{ server: Server; baseUrl: string }> {
	const server = createServer((req, res) => {
		if (req.method === "GET" && req.url?.includes("/models")) {
			res.writeHead(200, { "content-type": "application/json" })
			return res.end(JSON.stringify({ object: "list", data: [{ id: "gate-model", object: "model" }] }))
		}
		let body = ""
		req.on("data", (c) => (body += c))
		req.on("end", () => {
			const chat = req.url?.includes("/chat/")
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
			let i = 0
			const tick = setInterval(() => {
				if (i >= TOKENS) {
					clearInterval(tick)
					res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, text: "", finish_reason: "stop" }] })}\n\n`)
					res.write("data: [DONE]\n\n")
					return res.end()
				}
				const piece = `w${i} `
				const chunk = chat ? { choices: [{ index: 0, delta: { content: piece } }] } : { choices: [{ index: 0, text: piece }] }
				res.write(`data: ${JSON.stringify(chunk)}\n\n`)
				i++
			}, TOKEN_MS)
			req.on("close", () => clearInterval(tick))
		})
	})
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
	return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` }
}

/** Point Chat at the fake host, through the app's own socket (admin). */
async function useFakeModel(page: Page, baseUrl: string) {
	await page.goto(`${URL_BASE}/sessions/${SESSION}`)
	await page.waitForSelector(".sp-conversation", { timeout: 60_000 })
	await page.evaluate(async (baseUrl) => {
		const ts = await import("/src/lib/client/sockets/typedSocket.ts")
		const ir = await import("/src/lib/client/sockets/interest.svelte.ts")
		const s = ts.typedSocketOrNull()!
		const ask = (event: string, params: unknown) =>
			new Promise<any>((res, rej) => {
				const t = setTimeout(() => (rel(), rej(new Error(`timeout ${event}`))), 15000)
				const rel = ir.declareInterest(event, (d: any) => (clearTimeout(t), rel(), res(d)))
				ir.flushInterestSync?.()
				setTimeout(() => s.emit(event, params), 120)
			})
		const name = `Gate stream ${Date.now()}`
		const made = await ask("connections:create", {
			connection: { name, type: "openai", baseUrl, model: "gate-model", enabled: true }
		})
		if (!made?.connection?.id) throw new Error(`the gate's connection was refused: ${JSON.stringify(made)}`)
		// A default names the MODEL on the endpoint (0114).
		const listed = await ask("connections:models", { id: made.connection.id })
		const modelId = listed?.models?.[0]?.id
		if (!modelId) throw new Error(`the gate's connection has no model: ${JSON.stringify(listed)}`)
		// Refusals arrive on \`error\`, not on the request's own name.
		const refused = new Promise<never>((_, rej) => {
			const off = ir.declareInterest("error", (d: any) => (off(), rej(new Error(`setDefault refused: ${d?.error}`))))
		})
		const set = await Promise.race([
			ask("connections:setDefault", { capability: "text->text", id: made.connection.id, modelId }),
			refused
		])
		if (!set?.ok) throw new Error(`the gate's connection could not be Chat's default: ${JSON.stringify(set)}`)
	}, baseUrl)
}

/** Send a line and record, frame by frame, when the reply's text changed on the page. */
async function streamTiming(page: Page, remote: boolean) {
	await page.goto(`${URL_BASE}/sessions/${SESSION}${remote ? "?remote=1" : ""}`)
	const scope = remote ? '[data-sp-owner="core"] ' : ""
	await page.waitForSelector(`${scope}.sp-conversation textarea`, { timeout: 60_000 })
	await page.waitForTimeout(1500)
	const before = await page.locator(`${scope}.sp-msg`).count()
	await page.evaluate((scope) => {
		const w = window as unknown as { __gate: { t: number; len: number }[]; __gateStop?: boolean }
		w.__gate = []
		w.__gateStop = false
		const body = () => {
			const rows = document.querySelectorAll(`${scope}.sp-msg`)
			return rows[rows.length - 1]?.querySelector("sp-message-body")?.getAttribute("text") ?? ""
		}
		let last = -1
		const frame = () => {
			const len = body().length
			if (len !== last) w.__gate.push({ t: performance.now(), len }), (last = len)
			if (!w.__gateStop) requestAnimationFrame(frame)
		}
		requestAnimationFrame(frame)
	}, scope)
	const field = page.locator(`${scope}.sp-conversation textarea`).last()
	await field.fill(`gate stream ${remote ? "remote" : "native"}`)
	const sent = await page.evaluate(() => performance.now())
	await field.press("Enter")
	// Done when the last row holds the whole reply.
	const whole = Array.from({ length: TOKENS }, (_, i) => `w${i}`).join(" ")
	await page.waitForFunction(
		({ scope, whole, before }) => {
			const rows = document.querySelectorAll(`${scope}.sp-msg`)
			return rows.length >= before + 2 && (rows[rows.length - 1]?.querySelector("sp-message-body")?.getAttribute("text") ?? "").trim() === whole
		},
		{ scope, whole, before },
		{ timeout: 60_000 }
	)
	await page.waitForTimeout(300)
	const trace = await page.evaluate(() => {
		const w = window as unknown as { __gate: { t: number; len: number }[]; __gateStop?: boolean }
		w.__gateStop = true
		return w.__gate
	})
	const growing = trace.filter((p, i) => i > 0 && p.len > trace[i - 1]!.len)
	const first = growing[0]?.t ?? sent
	const done = trace[trace.length - 1]!.t
	return { toFirst: first - sent, toDone: done - sent, updates: growing.length }
}

const problems: string[] = []
const compare = (pack: string, a: Snapshot, b: Snapshot) => {
	const n = Math.max(a.tree.length, b.tree.length)
	for (let i = 0; i < n; i++)
		if (a.tree[i] !== b.tree[i]) {
			problems.push(`[${pack}] structure differs at #${i}:\n    native ${a.tree[i] ?? "∅"}\n    remote ${b.tree[i] ?? "∅"}`)
			break
		}
	const byPath = new Map(b.styles.map((s) => [s.path, s.style]))
	let styleDiffs = 0
	for (const s of a.styles) {
		const other = byPath.get(s.path)
		if (!other) continue
		for (const p of STYLE_PROPS)
			if (s.style[p] !== other[p] && styleDiffs++ < 25)
				problems.push(`[${pack}] ${s.path}: ${p} native ${s.style[p]} ≠ remote ${other[p]}`)
	}
	if (styleDiffs > 25) problems.push(`[${pack}] …and ${styleDiffs - 25} more style differences`)
	const nativeRules = new Set(a.axe.map((v) => v.split("×")[0]))
	for (const v of b.axe) if (!nativeRules.has(v.split("×")[0])) problems.push(`[${pack}] axe: the remote adds ${v}`)
	if (JSON.stringify(a.tabs) !== JSON.stringify(b.tabs))
		problems.push(`[${pack}] Tab order differs:\n    native ${a.tabs.join(" → ")}\n    remote ${b.tabs.join(" → ")}`)
}

const browser = await chromium.launch()
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	// tsx names functions it transpiles (`__name(fn, "x")`); the functions this
	// file hands the page carry that call, and the page has no such helper.
	await page.addInitScript("globalThis.__name = (f) => f")
	await page.route("**/__gate_axe.js", (route) =>
		route.fulfill({ status: 200, contentType: "text/javascript", body: axeSource })
	)
	const looks = new Set<string>()
	for (const pack of PACKS) {
		await pinPack(page, pack)
		const native = await snapshot(page, false)
		const remote = await snapshot(page, true)
		compare(pack, native, remote)
		const look = createHash("sha256").update(JSON.stringify(native.styles)).digest("hex").slice(0, 10)
		looks.add(look)
		console.log(`[${pack}] look ${look}; native ${native.tree.length} elements, remote ${remote.tree.length}; axe native ${native.axe.join(",") || "clean"}`)
	}
	// A gate that compared one look five times would pass while proving nothing.
	if (looks.size < PACKS.length) problems.push(`only ${looks.size} distinct looks across ${PACKS.length} packs — a pack was not applied`)
	await pinPack(page, "default")

	// Streaming at a fast local model's rate: the remote finishes as soon as
	// the native copy does and redraws as often.
	const model = await fakeModel()
	try {
		await useFakeModel(page, model.baseUrl)
		const native = await streamTiming(page, false)
		const remote = await streamTiming(page, true)
		console.log(`[stream] native ${JSON.stringify(native)}  remote ${JSON.stringify(remote)}`)
		if (remote.toDone > native.toDone + 150)
			problems.push(`[stream] the remote finished ${Math.round(remote.toDone - native.toDone)}ms after the native copy`)
		if (remote.updates < native.updates * 0.6)
			problems.push(`[stream] the remote redrew ${remote.updates} times against the native ${native.updates} — visibly steppier`)
	} finally {
		model.server.close()
	}
} finally {
	await browser.close()
}

if (problems.length) {
	console.error(`\nC7 gate: ${problems.length} difference(s)\n\n${problems.join("\n")}`)
	process.exit(1)
}
console.log("\nC7 gate: the remote conversation matches the native one under every pack.")
