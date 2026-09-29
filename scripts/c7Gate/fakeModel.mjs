/**
 * The C7 gate's model, standalone: an OpenAI-compatible host that streams
 * "r<n> w0 w1 … w119 " at 50 tokens a second — a fast local model. `<n>`
 * counts the replies it has streamed, so every reply reads differently (a
 * swipe can be told from the reply it replaced) and predictably. A run points
 * its connection at `/run-<id>/v1` and counts from 1 on its own there, so a
 * fresh fixture's replies read the same every run whichever process serves it.
 * `/models` carries `gateReplies`, so the gate can tell this build from an
 * older one still listening.
 * The gate starts one itself; run this and pass GATE_MODEL_URL where the app
 * cannot reach a listener inside the gate's own process (a sandboxed shell).
 *
 *   node scripts/c7Gate/fakeModel.mjs 47998   →  GATE_MODEL_URL=http://127.0.0.1:47998/v1
 */
import { createServer } from "node:http"

export const TOKENS = 120
export const TOKEN_MS = 20
/** Every reply's shape, as `/models` says it — the gate refuses a model that says otherwise. */
export const REPLY_SHAPE = `r<n> w0 … w${TOKENS - 1}`

export function fakeModelServer() {
	/** Replies streamed so far, per run (`/run-<id>/…`; "" for a bare path). */
	const served = new Map()
	return createServer((req, res) => {
		if (req.method === "GET" && req.url?.includes("/models")) {
			res.writeHead(200, { "content-type": "application/json" })
			return res.end(
				JSON.stringify({ object: "list", data: [{ id: "gate-model", object: "model" }], gateReplies: REPLY_SHAPE })
			)
		}
		req.on("data", () => {})
		req.on("end", () => {
			const chat = req.url?.includes("/chat/")
			const run = /^\/run-([\w-]+)\//.exec(req.url ?? "")?.[1] ?? ""
			const n = (served.get(run) ?? 0) + 1
			served.set(run, n)
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
			let i = 0
			const tick = setInterval(() => {
				if (i >= TOKENS) {
					clearInterval(tick)
					res.write("data: [DONE]\n\n")
					return res.end()
				}
				// The counter rides the first token, so the rate is unchanged.
				const piece = i === 0 ? `r${n} w0 ` : `w${i} `
				const chunk = chat ? { choices: [{ index: 0, delta: { content: piece } }] } : { choices: [{ index: 0, text: piece }] }
				res.write(`data: ${JSON.stringify(chunk)}\n\n`)
				i++
			}, TOKEN_MS)
			// The RESPONSE closing is the client leaving; a request closes once its body is read.
			res.on("close", () => clearInterval(tick))
		})
	})
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const port = Number(process.argv[2] ?? 47998)
	fakeModelServer().listen(port, "127.0.0.1", () => console.log(`fake model at http://127.0.0.1:${port}/v1`))
}
