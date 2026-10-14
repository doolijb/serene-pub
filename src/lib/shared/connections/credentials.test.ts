import { describe, expect, it } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { credentialPolicy } from "./credentials"

const at = (baseUrl: string) =>
	credentialPolicy({ type: CONNECTION_TYPE.OPENAI, baseUrl })

describe("an OpenAI-compatible URL with no preset", () => {
	it("a public host wants a key", () => {
		expect(at("https://api.example.com/v1")).toBe("required")
		expect(at("http://100.128.0.1:8080/v1")).toBe("required")
		expect(at("http://169.255.0.1/v1")).toBe("required")
	})
	it("loopback and RFC 1918 addresses are somebody's own machine", () => {
		for (const url of [
			"http://localhost:5001/v1",
			"http://127.0.0.1:5001/v1",
			"http://192.168.1.4:5001/v1",
			"http://10.0.0.2/v1",
			"http://172.20.0.3/v1",
			"http://[::1]:5001/v1"
		])
			expect(at(url)).toBe("optional")
	})
	it("CGNAT (Tailscale), link-local and single-label hosts are private (D13)", () => {
		for (const url of [
			"http://100.64.0.1:11434/v1",
			"http://100.101.102.103/v1",
			"http://100.127.255.254/v1",
			"http://169.254.10.20/v1",
			"http://ollama:11434/v1",
			"http://gpu-box:5001/v1"
		])
			expect(at(url)).toBe("optional")
	})
})
