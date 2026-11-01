import { describe, it, expect, vi } from "vitest"

vi.mock("$lib/server/db", () => ({ db: {} }))
vi.mock("$lib/server/audiocpp/binary", () => ({}))
vi.mock("$lib/server/audio/audioList", () => ({}))
vi.mock("$lib/server/audiocpp/packages", () => ({}))
vi.mock("$lib/server/audiocpp/process", () => ({}))
vi.mock("$lib/server/audiocpp/managedEndpoint", () => ({}))
vi.mock("$lib/server/utils", () => ({ isAndroidWrapper: () => false }))

import { validateAudioCppSettingsPatch as v } from "./audiocpp"

describe("validateAudioCppSettingsPatch", () => {
	it("accepts a good patch", () => {
		expect(
			v({
				enabled: true,
				port: 5002,
				threads: null,
				maxLoadedModels: 2,
				idleUnloadMs: 0,
				subprocessTimeoutMinutes: 0,
				deviceIndex: 0,
				modelsDir: "/srv/audio"
			})
		).toBeNull()
		expect(v({})).toBeNull()
	})
	it("refuses bad values with sentences", () => {
		expect(v({ port: 80 })).toMatch(/port/)
		expect(v({ port: 70000 })).toMatch(/port/)
		expect(v({ port: 5002.5 })).toMatch(/port/)
		expect(v({ threads: 0 })).toMatch(/Threads/)
		expect(v({ maxLoadedModels: -1 })).toMatch(/models/)
		expect(v({ idleUnloadMs: -5 })).toMatch(/Idle/)
		expect(v({ subprocessTimeoutMinutes: -1 })).toMatch(/Idle/)
		expect(v({ deviceIndex: -1 })).toMatch(/device/)
		expect(v({ modelsDir: "relative/dir" })).toMatch(/absolute/)
		expect(v(null)).toMatch(/Nothing/)
	})
})
