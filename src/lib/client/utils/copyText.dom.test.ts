import { afterEach, describe, expect, it, vi } from "vitest"
import { copyText } from "./copyText"

function setup(opts: {
	secure: boolean
	clipboard?: { writeText: ReturnType<typeof vi.fn> }
	exec?: ReturnType<typeof vi.fn>
}) {
	vi.stubGlobal("isSecureContext", opts.secure)
	vi.stubGlobal("navigator", { clipboard: opts.clipboard })
	if (opts.exec) (document as any).execCommand = opts.exec
}

afterEach(() => {
	vi.unstubAllGlobals()
	delete (document as any).execCommand
	document.body.innerHTML = ""
})

describe("copyText", () => {
	it("uses the clipboard API in a secure context", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		const exec = vi.fn().mockReturnValue(true)
		setup({ secure: true, clipboard: { writeText }, exec })
		expect(await copyText("hi")).toBe(true)
		expect(writeText).toHaveBeenCalledWith("hi")
		expect(exec).not.toHaveBeenCalled()
	})

	it("uses the selection copy in an insecure context", async () => {
		const writeText = vi.fn()
		const exec = vi.fn().mockReturnValue(true)
		setup({ secure: false, clipboard: { writeText }, exec })
		expect(await copyText("hi")).toBe(true)
		expect(writeText).not.toHaveBeenCalled()
		expect(exec).toHaveBeenCalledWith("copy")
		expect(document.body.querySelector("textarea")).toBeNull()
	})

	it("falls back when writeText rejects", async () => {
		const writeText = vi.fn().mockRejectedValue(new Error("denied"))
		const exec = vi.fn().mockReturnValue(true)
		setup({ secure: true, clipboard: { writeText }, exec })
		expect(await copyText("hi")).toBe(true)
		expect(exec).toHaveBeenCalledWith("copy")
	})

	it("resolves false when the selection copy fails, never rejects", async () => {
		setup({ secure: false, exec: vi.fn().mockReturnValue(false) })
		expect(await copyText("hi")).toBe(false)
		expect(document.body.querySelector("textarea")).toBeNull()

		setup({
			secure: false,
			exec: vi.fn().mockImplementation(() => {
				throw new Error("nope")
			})
		})
		expect(await copyText("hi")).toBe(false)
		expect(document.body.querySelector("textarea")).toBeNull()

		delete (document as any).execCommand
		expect(await copyText("hi")).toBe(false)
		expect(document.body.querySelector("textarea")).toBeNull()
	})
})
