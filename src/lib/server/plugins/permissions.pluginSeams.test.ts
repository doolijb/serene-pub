import { describe, expect, it } from "vitest"
import {
	autoplayGranted,
	declaredPermissions,
	effectivePermissions,
	reviewMarks,
	servedStorageGlobs
} from "./permissions"

const keys = (m: unknown) => declaredPermissions(m as never).map((p) => p.key)
const granted = (m: unknown, denied: string[] = []) => {
	const d = declaredPermissions(m as never)
	return effectivePermissions(d, [...reviewMarks(d), ...denied])
}

describe("M0 permissions", () => {
	it("a bare storage key defaults to 64 MB with an MB label", () => {
		const [s] = declaredPermissions({ permissions: ["storage"] } as never)
		expect(s.config).toEqual({ quotaBytes: 67108864 })
		expect(s.label).toBe("Private file storage (up to 64 MB)")
	})

	it("a quota under 1 MiB keeps the KB label", () => {
		const [s] = declaredPermissions({ permissions: ["storage:512000"] } as never)
		expect(s.label).toMatch(/KB\)$/)
	})

	it("flat and object forms declare the same served glob and autoplay", () => {
		const flat = keys({ permissions: ["storage", "storage-serve:worlds/**", "media:autoplay"] })
		const obj = keys({ permissions: { storage: { serve: ["worlds/**"] }, media: { autoplay: true } } })
		expect(flat.filter((k) => k === "storage-serve:worlds/**")).toHaveLength(1)
		expect(obj).toContain("storage-serve:worlds/**")
		expect(obj).toContain("media:autoplay")
		expect([...flat].sort()).toEqual([...obj].sort())
	})

	it("an unservable glob is surfaced as an unknown key and never served", () => {
		const m = { permissions: ["storage", "storage-serve:../x"] }
		expect(keys(m)).toContain("storage-serve:../x")
		expect(servedStorageGlobs(granted(m))).toEqual([])
	})

	it("serve without storage is surfaced and serves nothing", () => {
		const m = { permissions: ["storage-serve:worlds/**"] }
		expect(keys(m)).toContain("storage-serve:worlds/**")
		expect(servedStorageGlobs(granted(m))).toEqual([])
	})

	it("served globs and autoplay follow review and denial", () => {
		const m = { permissions: ["storage", "storage-serve:worlds/**", "media:autoplay"] }
		expect(servedStorageGlobs(granted(m))).toEqual(["worlds/**"])
		expect(autoplayGranted(granted(m))).toBe(true)
		expect(servedStorageGlobs(effectivePermissions(declaredPermissions(m as never), []))).toEqual([])
		expect(autoplayGranted(granted(m, ["media:autoplay"]))).toBe(false)
		expect(servedStorageGlobs(granted(m, ["storage"]))).toEqual([])
	})
})
