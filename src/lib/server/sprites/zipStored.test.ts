import { describe, expect, test } from "vitest"
import { strToU8, unzipSync, zipSync } from "fflate"
import { zipPackage } from "$lib/server/plugins/exportPackage"

describe("zipPackage stores already-compressed files", () => {
	test("same entry names and contents as the all-deflate zip", () => {
		const png = Buffer.alloc(4000, 7)
		const files = {
			"a/manifest.json": '{"a":1}\n'.repeat(200),
			"a/img.PNG": png,
			"a/readme.md": "hello"
		}
		const out = unzipSync(new Uint8Array(zipPackage(files)))
		const ref = unzipSync(
			zipSync(
				{
					"a/manifest.json": strToU8(files["a/manifest.json"]),
					"a/img.PNG": new Uint8Array(png),
					"a/readme.md": strToU8("hello")
				},
				{ level: 6 }
			)
		)
		expect(Object.keys(out)).toEqual(Object.keys(ref))
		for (const k of Object.keys(ref)) expect(out[k]).toEqual(ref[k])
	})
})
