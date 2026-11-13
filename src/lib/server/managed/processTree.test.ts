import { afterEach, describe, expect, test, vi } from "vitest"

const execFileMock = vi.fn()
const spawnSyncMock = vi.fn()
vi.mock("child_process", () => ({
	execFile: (...args: any[]) => execFileMock(...args),
	spawnSync: (...args: any[]) => spawnSyncMock(...args)
}))

import { commandOf, killTree, killTreeSync, pidRunsBinary } from "./processTree"

/** `promisify(execFile)` calls the mock with a trailing callback. */
function answer(stdout: string) {
	execFileMock.mockImplementation((...args: any[]) => {
		const cb = args[args.length - 1]
		cb(null, { stdout, stderr: "" })
	})
}

afterEach(() => {
	vi.restoreAllMocks()
	execFileMock.mockReset()
	spawnSyncMock.mockReset()
})

describe("killTree — the whole tree, on every platform", () => {
	test("POSIX signals the process group (negative pid)", async () => {
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true)
		await killTree(4242, "SIGTERM", "linux")
		expect(kill).toHaveBeenCalledWith(-4242, "SIGTERM")
		expect(execFileMock).not.toHaveBeenCalled()
	})

	test("POSIX falls back to the pid alone when the group is gone", async () => {
		const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
			if ((pid as number) < 0) throw new Error("ESRCH")
			return true
		})
		await killTree(4242, "SIGKILL", "darwin")
		expect(kill).toHaveBeenLastCalledWith(4242, "SIGKILL")
	})

	test("Windows has no groups a signal reaches: taskkill /T /F", async () => {
		const kill = vi.spyOn(process, "kill")
		answer("SUCCESS")
		await killTree(4242, "SIGTERM", "win32")
		expect(kill).not.toHaveBeenCalled()
		expect(execFileMock.mock.calls[0][0]).toBe("taskkill")
		expect(execFileMock.mock.calls[0][1]).toEqual(["/PID", "4242", "/T", "/F"])
	})

	test("killTreeSync mirrors it for the exit hook", () => {
		const kill = vi.spyOn(process, "kill").mockImplementation(() => true)
		killTreeSync(7, "linux")
		expect(kill).toHaveBeenCalledWith(-7, "SIGKILL")
		killTreeSync(7, "win32")
		expect(spawnSyncMock.mock.calls[0][0]).toBe("taskkill")
		expect(spawnSyncMock.mock.calls[0][1]).toEqual(["/PID", "7", "/T", "/F"])
	})
})

describe("pidRunsBinary — ownership before a kill, on every platform", () => {
	test("Windows reads the image name from tasklist's CSV", async () => {
		answer('"koboldcpp.exe","4242","Console","1","1,234,567 K"\r\n')
		expect(await commandOf(4242, "win32")).toBe("koboldcpp.exe")
		expect(await pidRunsBinary(4242, "C:\\sp\\koboldcpp\\koboldcpp.exe", "win32")).toBe(true)
		expect(execFileMock.mock.calls[0][0]).toBe("tasklist")
	})

	test("Windows: a gone pid answers with an INFO line, never a match", async () => {
		answer("INFO: No tasks are running which match the specified criteria.\r\n")
		expect(await pidRunsBinary(4242, "C:\\sp\\koboldcpp.exe", "win32")).toBe(false)
	})

	test("macOS reads ps -o command=", async () => {
		answer("/Users/x/sp/koboldcpp-mac-arm64 --port 5001\n")
		expect(await pidRunsBinary(4242, "/Users/x/sp/koboldcpp-mac-arm64", "darwin")).toBe(true)
		expect(execFileMock.mock.calls[0][0]).toBe("ps")
	})

	test("a different program on a recycled pid is not ours", async () => {
		answer("/usr/bin/python3 something_else.py\n")
		expect(await pidRunsBinary(4242, "/opt/sp/koboldcpp-linux-x64", "darwin")).toBe(false)
	})

	test("an unreadable process fails closed", async () => {
		execFileMock.mockImplementation((...args: any[]) =>
			args[args.length - 1](new Error("EPERM"))
		)
		expect(await pidRunsBinary(4242, "/opt/sp/koboldcpp-linux-x64", "darwin")).toBe(false)
	})
})
