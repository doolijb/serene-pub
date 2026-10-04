/**
 * The release download (CONTRACT §C12): allowlisted on every hop, at most five
 * redirects, streamed to disk, and never finished without a matching
 * checksum — a missing one refuses before the asset is fetched at all.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	downloadVerifiedAsset,
	fetchFromRelease,
	isAllowedGithubReleaseHost,
	parseSha256File,
	ReleaseDownloadError
} from "./githubReleaseDownload"

const NAME = "serene-pub-v0.6.1-linux-x64.zip"
const ZIP_URL = `https://github.com/doolijb/serene-pub/releases/download/v0.6.1/${NAME}`
const CDN_URL = "https://release-assets.githubusercontent.com/abc"
const SHA_URL = `${ZIP_URL}.sha256`
const BODY = Buffer.from("pretend this is a zip ".repeat(1000))
const SHA = crypto.createHash("sha256").update(BODY).digest("hex")

let dir: string
let dest: string
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-dl-"))
	dest = path.join(dir, "download.part")
})
afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true })
})

type Route = () => Response
function fakeFetch(routes: Record<string, Route>) {
	return vi.fn(async (url: string, _init?: RequestInit) => {
		const route = routes[url]
		if (!route) return new Response("not found", { status: 404 })
		return route()
	})
}

const redirect = (to: string): Route => () => new Response(null, { status: 302, headers: { location: to } })
const ok = (body: string | Buffer): Route => () =>
	new Response(typeof body === "string" ? body : new Uint8Array(body))

describe("fetchFromRelease", () => {
	test("follows GitHub's redirect to its asset host", async () => {
		const f = fakeFetch({ [ZIP_URL]: redirect(CDN_URL), [CDN_URL]: ok("x") })
		const res = await fetchFromRelease(ZIP_URL, { fetch: f })
		expect(await res.text()).toBe("x")
		expect(f.mock.calls.map((c) => c[0])).toEqual([ZIP_URL, CDN_URL])
		expect(f.mock.calls[0][1]).toMatchObject({ redirect: "manual" })
	})

	test("refuses a disallowed host before asking it anything", async () => {
		const f = fakeFetch({})
		await expect(fetchFromRelease("https://evil.example/x.zip", { fetch: f })).rejects.toMatchObject({
			code: "host"
		})
		expect(f).not.toHaveBeenCalled()
	})

	test("refuses a redirect to a disallowed host without following it", async () => {
		const f = fakeFetch({ [ZIP_URL]: redirect("https://evil.example/x.zip") })
		await expect(fetchFromRelease(ZIP_URL, { fetch: f })).rejects.toMatchObject({ code: "host" })
		expect(f).toHaveBeenCalledTimes(1)
	})

	test("refuses plain http even on an allowed host", async () => {
		const f = fakeFetch({})
		await expect(fetchFromRelease("http://github.com/x", { fetch: f })).rejects.toMatchObject({
			code: "host"
		})
	})

	test("gives up after five redirects", async () => {
		const routes: Record<string, Route> = {}
		for (let i = 0; i < 7; i++) routes[`https://github.com/r${i}`] = redirect(`https://github.com/r${i + 1}`)
		const f = fakeFetch(routes)
		await expect(fetchFromRelease("https://github.com/r0", { fetch: f })).rejects.toMatchObject({
			code: "redirects"
		})
		expect(f).toHaveBeenCalledTimes(6)
	})

	test("the allowlist is exact", () => {
		expect(isAllowedGithubReleaseHost("GitHub.com")).toBe(true)
		expect(isAllowedGithubReleaseHost("evil.github.com")).toBe(false)
		expect(isAllowedGithubReleaseHost("api.github.com")).toBe(false)
	})
})

describe("downloadVerifiedAsset", () => {
	test("streams the asset to disk and returns its checksum", async () => {
		const f = fakeFetch({
			[SHA_URL]: ok(`${SHA}  ${NAME}\n`),
			[ZIP_URL]: redirect(CDN_URL),
			[CDN_URL]: ok(BODY)
		})
		const progress = vi.fn()
		const result = await downloadVerifiedAsset({
			url: ZIP_URL,
			sha256Url: SHA_URL,
			assetName: NAME,
			destPath: dest,
			fetch: f,
			onProgress: progress
		})
		expect(result).toEqual({ sha256: SHA, size: BODY.length })
		expect(fs.readFileSync(dest).equals(BODY)).toBe(true)
		expect(progress).toHaveBeenCalled()
		// The checksum is fetched first.
		expect(f.mock.calls[0][0]).toBe(SHA_URL)
	})

	test("no checksum asset: refused before the asset is fetched", async () => {
		const f = fakeFetch({ [ZIP_URL]: ok(BODY) })
		await expect(
			downloadVerifiedAsset({ url: ZIP_URL, sha256Url: null, assetName: NAME, destPath: dest, fetch: f })
		).rejects.toMatchObject({ code: "checksum-missing" })
		expect(f).not.toHaveBeenCalled()
		expect(fs.existsSync(dest)).toBe(false)
	})

	test("an unfetchable checksum: refused before the asset is fetched", async () => {
		const f = fakeFetch({ [ZIP_URL]: ok(BODY) })
		await expect(
			downloadVerifiedAsset({ url: ZIP_URL, sha256Url: SHA_URL, assetName: NAME, destPath: dest, fetch: f })
		).rejects.toMatchObject({ code: "checksum-missing" })
		expect(f.mock.calls.map((c) => c[0])).toEqual([SHA_URL])
		expect(fs.existsSync(dest)).toBe(false)
	})

	test("a malformed checksum file is no checksum", async () => {
		const f = fakeFetch({ [SHA_URL]: ok("<html>rate limited</html>"), [ZIP_URL]: ok(BODY) })
		await expect(
			downloadVerifiedAsset({ url: ZIP_URL, sha256Url: SHA_URL, assetName: NAME, destPath: dest, fetch: f })
		).rejects.toMatchObject({ code: "checksum-missing" })
		expect(f).toHaveBeenCalledTimes(1)
	})

	test("a mismatch deletes what was written", async () => {
		const f = fakeFetch({ [SHA_URL]: ok(`${"0".repeat(64)}  ${NAME}\n`), [ZIP_URL]: ok(BODY) })
		await expect(
			downloadVerifiedAsset({ url: ZIP_URL, sha256Url: SHA_URL, assetName: NAME, destPath: dest, fetch: f })
		).rejects.toMatchObject({ code: "checksum-mismatch" })
		expect(fs.existsSync(dest)).toBe(false)
	})

	test("a checksum for a different file is refused", async () => {
		const f = fakeFetch({ [SHA_URL]: ok(`${SHA}  other.zip\n`), [ZIP_URL]: ok(BODY) })
		await expect(
			downloadVerifiedAsset({ url: ZIP_URL, sha256Url: SHA_URL, assetName: NAME, destPath: dest, fetch: f })
		).rejects.toBeInstanceOf(ReleaseDownloadError)
	})

	test("a checksum on a disallowed host is refused as such", async () => {
		const f = fakeFetch({})
		await expect(
			downloadVerifiedAsset({
				url: ZIP_URL,
				sha256Url: "https://evil.example/x.sha256",
				assetName: NAME,
				destPath: dest,
				fetch: f
			})
		).rejects.toMatchObject({ code: "host" })
		expect(f).not.toHaveBeenCalled()
	})
})

describe("parseSha256File", () => {
	test("reads sha256sum output, BOM and CRLF tolerated", () => {
		expect(parseSha256File(`${SHA}  ${NAME}\n`, NAME)).toBe(SHA)
		expect(parseSha256File(`﻿${SHA.toUpperCase()} *${NAME}\r\n`, NAME)).toBe(SHA)
		expect(parseSha256File(SHA, NAME)).toBe(SHA)
	})
	test("rejects anything else", () => {
		expect(parseSha256File("abc", NAME)).toBeNull()
		expect(parseSha256File(`${SHA}  other.zip`, NAME)).toBeNull()
	})
})
