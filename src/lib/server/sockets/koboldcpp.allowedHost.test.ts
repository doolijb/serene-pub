/**
 * 3a: koboldcpp:downloadModel used to fetch a client-supplied downloadUrl
 * with no hostname validation — an admin session (or forged socket
 * emission) could point the server at an arbitrary internal address. Every
 * legitimate downloadUrl this app ever constructs is huggingface.co; the
 * allowlist must also cover hf.co (confirmed via web search: Hugging
 * Face's Xet storage migration commonly redirects a real download to a
 * host under hf.co, eg. cas-bridge.xethub.hf.co, which is not a subdomain
 * of huggingface.co — an allowlist of only huggingface.co would reject
 * that redirect target and break real downloads).
 */
import { describe, expect, test } from "vitest"
import { isAllowedHuggingFaceHost } from "./koboldcpp"

describe("isAllowedHuggingFaceHost", () => {
	test("accepts huggingface.co and its subdomains", () => {
		expect(isAllowedHuggingFaceHost("huggingface.co")).toBe(true)
		expect(isAllowedHuggingFaceHost("cdn-lfs.huggingface.co")).toBe(true)
		expect(isAllowedHuggingFaceHost("HUGGINGFACE.CO")).toBe(true)
	})

	test("accepts hf.co and its subdomains, including the real Xet redirect target", () => {
		expect(isAllowedHuggingFaceHost("hf.co")).toBe(true)
		expect(isAllowedHuggingFaceHost("cas-bridge.xethub.hf.co")).toBe(true)
	})

	test("rejects lookalike and unrelated hosts", () => {
		expect(isAllowedHuggingFaceHost("huggingface.co.evil.com")).toBe(false)
		expect(isAllowedHuggingFaceHost("nothuggingface.co")).toBe(false)
		expect(isAllowedHuggingFaceHost("evilhf.co")).toBe(false)
		expect(isAllowedHuggingFaceHost("169.254.169.254")).toBe(false)
		expect(isAllowedHuggingFaceHost("localhost")).toBe(false)
	})
})
