import { describe, test, expect } from "vitest"
import { Server } from "socket.io"
import { io as ioClient } from "socket.io-client"
import { createServer } from "http"
import type { AddressInfo } from "net"
import { concatenateBatch, stageFilesToServer } from "./sillyTavernFolderImport"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"

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
	// socket.io disconnects the transport almost immediately when a single
	// message contains more than ~10-14 *separate* binary attachments,
	// regardless of total payload size (verified empirically against
	// socket.io 4.8.x — a batch of 20 individually-Uint8Array'd files failed
	// every time in under 5ms, while a single concatenated attachment of the
	// same total size never did). This test sends more files than that
	// threshold over a real socket.io connection to guard against
	// regressing back to an array-of-Uint8Array payload shape.
	test("uploads 30 small files over a real socket.io connection without the transport disconnecting", async () => {
		const httpServer = createServer()
		const io = new Server(httpServer, { maxHttpBufferSize: 1e8 })
		const received: { relativePath: string; length: number }[] = []

		io.on("connection", (socket) => {
			socket.on("import:sillytavern:stageFiles", (message: any) => {
				for (const entry of message.manifest) {
					received.push({
						relativePath: entry.relativePath,
						length: entry.length
					})
				}
				socket.emit("import:sillytavern:stageFiles", {
					success: true,
					staged: message.manifest.length
				})
			})
		})

		await new Promise<void>((resolve) => httpServer.listen(0, resolve))
		const port = (httpServer.address() as AddressInfo).port

		try {
			const rawClient = ioClient(`http://localhost:${port}`)
			await new Promise<void>((resolve, reject) => {
				rawClient.on("connect", () => resolve())
				rawClient.on("connect_error", reject)
			})

			const socket = {
				emit: (event: string, params: unknown) => rawClient.emit(event, params),
				on: (event: string, listener: (...args: any[]) => void) =>
					rawClient.on(event, listener),
				off: (event: string, listener: (...args: any[]) => void) =>
					rawClient.off(event, listener),
				id: rawClient.id ?? "",
				connected: rawClient.connected,
				join: () => {},
				leave: () => {},
				disconnect: () => rawClient.disconnect()
			} as unknown as TypedSocket

			const pickedFiles = Array.from({ length: 30 }, (_, i) => ({
				relativePath: `characters/char${i}.png`,
				file: new File(
					[new Uint8Array(2000).fill(i % 256)],
					`char${i}.png`
				)
			}))

			let lastProgress = { staged: 0, total: 0 }
			await stageFilesToServer(
				socket,
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

			rawClient.close()
		} finally {
			io.close()
			httpServer.close()
		}
	}, 20000)
})
