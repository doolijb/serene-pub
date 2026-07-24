import { beforeEach, describe, expect, test, vi } from "vitest"
import { spawn } from "child_process"

// Minimal db mock — doStart()'s gating check is the only thing these tests
// exercise, and it only ever touches db.query.koboldCppSettings.findFirst().
const findFirstMock = vi.fn()
vi.mock("$lib/server/db", () => ({
	db: {
		query: {
			koboldCppSettings: {
				findFirst: () => findFirstMock()
			}
		}
	}
}))

vi.mock("child_process", () => ({
	spawn: vi.fn()
}))

// Not exercised by any test below (the gate rejects before doStart() ever
// reaches a running-state re-check or a real port probe), but mocked
// defensively so a real network call can never sneak into a unit test.
vi.mock("./kcppHttp", () => ({
	pingKoboldCPP: vi.fn().mockResolvedValue(false)
}))

import { start } from "./subprocessManager"

describe("subprocessManager.start — managed-mode gating", () => {
	beforeEach(() => {
		findFirstMock.mockReset()
		vi.mocked(spawn).mockClear()
	})

	test("refuses to start when the manager isn't enabled at all", async () => {
		findFirstMock.mockResolvedValue({
			koboldCppManagerEnabled: false,
			koboldCppManagedMode: "managed"
		})
		await expect(start()).rejects.toThrow("Managed mode is not enabled")
		expect(spawn).not.toHaveBeenCalled()
	})

	test("refuses to start when mode is \"external\" even if the manager is enabled", async () => {
		findFirstMock.mockResolvedValue({
			koboldCppManagerEnabled: true,
			koboldCppManagedMode: "external"
		})
		await expect(start()).rejects.toThrow("Managed mode is not enabled")
		expect(spawn).not.toHaveBeenCalled()
	})

	test("refuses to start when mode is unset (null)", async () => {
		findFirstMock.mockResolvedValue({
			koboldCppManagerEnabled: true,
			koboldCppManagedMode: null
		})
		await expect(start()).rejects.toThrow("Managed mode is not enabled")
		expect(spawn).not.toHaveBeenCalled()
	})

	test("refuses to start when there's no settings row at all", async () => {
		findFirstMock.mockResolvedValue(undefined)
		await expect(start()).rejects.toThrow("Managed mode is not enabled")
		expect(spawn).not.toHaveBeenCalled()
	})

	test("a properly enabled + managed config passes this gate (fails later, on binary configuration, instead)", async () => {
		// Positive control: confirms the gate isn't over-matching (e.g.
		// accidentally rejecting every config regardless of these two
		// fields) — a valid combination should get past THIS check and fail
		// on the next one (no binary configured) instead.
		findFirstMock.mockResolvedValue({
			koboldCppManagerEnabled: true,
			koboldCppManagedMode: "managed",
			koboldCppManagedBinaryDir: null,
			koboldCppManagedBinaryVariant: null
		})
		await expect(start()).rejects.toThrow("Binary not configured")
		expect(spawn).not.toHaveBeenCalled()
	})
})
