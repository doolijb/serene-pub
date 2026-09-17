import { afterEach, beforeEach, describe, test, expect, vi } from "vitest"
import { Server } from "socket.io"
import { io as ioClient } from "socket.io-client"
import type { Socket } from "socket.io-client"
import { createServer } from "http"
import type { AddressInfo } from "net"

// The interest registry reads `dev` to word its one refusal warning; nothing
// here exercises that path, and the real module is a SvelteKit virtual one.
vi.mock("$app/environment", () => ({ dev: true, building: false }))

import { concatenateBatch, stageFilesToServer } from "./sillyTavernFolderImport"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { setSocket } from "$lib/client/sockets/socketInstance"

/** The event the staged upload asks on, and the key its reply is declared at. */
const STAGE_FILES = "import:sillytavern:stageFiles"

beforeEach(() => {
	_resetInterestForTests()
	setSocket(null)
})

afterEach(() => {
	_resetInterestForTests()
	setSocket(null)
})

describe("concatenateBatch", () => {
	test("concatenates multiple files into one blob with a matching manifest", () => {
		const batch = [
			{ relativePath: "a.txt", data: new Uint8Array([1, 2, 3]) },
			{ relativePath: "b.txt", data: new Uint8Array([4, 5]) },
			{ relativePath: "c.txt", data: new Uint8Array([]) }
		]
		const { manifest, blob } = concatenateBatch(batch)

		expect(manifest).toEqual([
			{ relativePath: "a.txt", length: 3 },
			{ relativePath: "b.txt", length: 2 },
			{ relativePath: "c.txt", length: 0 }
		])
		expect(Array.from(blob)).toEqual([1, 2, 3, 4, 5])

		let offset = 0
		for (let i = 0; i < manifest.length; i++) {
			const slice = blob.slice(offset, offset + manifest[i].length)
			expect(Array.from(slice)).toEqual(Array.from(batch[i].data))
			offset += manifest[i].length
		}
	})

	test("handles a single file", () => {
		const { manifest, blob } = concatenateBatch([
			{ relativePath: "only.txt", data: new Uint8Array([9, 9]) }
		])
		expect(manifest).toEqual([{ relativePath: "only.txt", length: 2 }])
		expect(Array.from(blob)).toEqual([9, 9])
	})

	test("handles an empty batch", () => {
		const { manifest, blob } = concatenateBatch([])
		expect(manifest).toEqual([])
		expect(blob.byteLength).toBe(0)
	})
})

describe("stageFilesToServer transport", () => {
	// Two things at once, because they are the same round trip.
	//
	// 1. socket.io disconnects the transport almost immediately when a single
	//    message contains more than ~10-14 *separate* binary attachments,
	//    regardless of total payload size (verified empirically against
	//    socket.io 4.8.x — a batch of 20 individually-Uint8Array'd files failed
	//    every time in under 5ms, while a single concatenated attachment of the
	//    same total size never did). This sends more files than that threshold
	//    over a real socket.io connection to guard against regressing back to
	//    an array-of-Uint8Array payload shape.
	// 2. The upload asks through the interest registry, so the interest sync
	//    that declares the reply's key has to reach the server BEFORE the
	//    request (plan ruling 3 — the server's gate drops a reply whose key it
	//    does not hold yet), and the key has to go again once the reply lands:
	//    one request wants one answer.
	//
	// The registry reaches the app's ONE socket itself, so the client under
	// test is the app socket: `setSocket` puts this throwaway connection there
	// rather than handing `stageFilesToServer` a socket of its own.
	test("uploads 30 small files over a real socket.io connection, syncing interest first and releasing after the reply", async () => {
		const httpServer = createServer()
		const io = new Server(httpServer, { maxHttpBufferSize: 1e8 })
		const received: { relativePath: string; length: number }[] = []
		/** Every event this server saw, in arrival order. */
		const serverEvents: string[] = []
		/** The key list of each interest sync, in arrival order. */
		const syncedKeys: string[][] = []

		io.on("connection", (socket) => {
			// onAny runs ahead of the specific listener, so this records the
			// order the packets actually arrived in.
			socket.onAny((event: string, payload: any) => {
				serverEvents.push(event)
				if (event === "interest:sync") syncedKeys.push(payload.keys)
			})
			socket.on(STAGE_FILES, (message: any) => {
				for (const entry of message.manifest) {
					received.push({
						relativePath: entry.relativePath,
						length: entry.length
					})
				}
				socket.emit(STAGE_FILES, {
					success: true,
					staged: message.manifest.length
				})
			})
		})

		await new Promise<void>((resolve) => httpServer.listen(0, resolve))
		const port = (httpServer.address() as AddressInfo).port

		let rawClient: Socket | null = null
		try {
			rawClient = ioClient(`http://localhost:${port}`)
			const client = rawClient
			await new Promise<void>((resolve, reject) => {
				client.on("connect", () => resolve())
				client.on("connect_error", reject)
			})

			setSocket(client)
			// `import:` is restricted interest: an unknown user holds the key
			// off the wire, which is the right answer everywhere but here.
			setInterestUser({ id: 1, isAdmin: true })

			const pickedFiles = Array.from({ length: 30 }, (_, i) => ({
				relativePath: `characters/char${i}.png`,
				file: new File(
					[new Uint8Array(2000).fill(i % 256)],
					`char${i}.png`
				)
			}))

			let lastProgress = { staged: 0, total: 0 }
			await stageFilesToServer(
				"test-session",
				pickedFiles,
				(staged, total) => {
					lastProgress = { staged, total }
				}
			)

			expect(lastProgress).toEqual({ staged: 30, total: 30 })
			expect(received).toHaveLength(30)
			expect(received[0].relativePath).toBe("characters/char0.png")
			expect(received[29].relativePath).toBe("characters/char29.png")

			// The sync comes first, and it names the key the reply needs.
			expect(serverEvents[0]).toBe("interest:sync")
			expect(serverEvents.indexOf("interest:sync")).toBeLessThan(
				serverEvents.indexOf(STAGE_FILES)
			)
			expect(syncedKeys[0]).toContain(STAGE_FILES)

			// Released on reply: the last subscriber going means the registry
			// takes its one raw listener back off the socket.
			expect(client.listeners(STAGE_FILES)).toHaveLength(0)
		} finally {
			rawClient?.close()
			io.close()
			httpServer.close()
		}
	}, 20000)
})
