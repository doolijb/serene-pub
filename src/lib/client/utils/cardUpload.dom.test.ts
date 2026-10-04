/**
 * A card file as the page uploads it (S4 review): measured against the
 * server's own ceiling BEFORE a byte is read or sent — the first-run wizard
 * uploaded any size, and a file past Socket.IO's transport limit disconnected
 * with no sentence at all.
 */
import { describe, expect, test, vi } from "vitest"
import { IMPORT_FILE_CAPS } from "$lib/shared/imports/fileCaps"
import { cardFileForUpload } from "./cardUpload"

describe("cardFileForUpload", () => {
	test("a file past the card ceiling is refused in the server's sentence, unread", async () => {
		const read = vi.spyOn(FileReader.prototype, "readAsDataURL")
		// Only its size is looked at, so a stand-in carries just that.
		const huge = { size: IMPORT_FILE_CAPS.cardBytes + 1 } as Blob
		expect(await cardFileForUpload(huge)).toEqual({
			refused:
				"This card file is 65 MB, larger than the 64 MB Serene Pub will read."
		})
		expect(read).not.toHaveBeenCalled()
		read.mockRestore()
	})

	test("a file under it is read as the base64 the import takes", async () => {
		const file = new File([JSON.stringify({ name: "Aria" })], "aria.json", {
			type: "application/json"
		})
		expect(await cardFileForUpload(file)).toEqual({
			base64: Buffer.from(JSON.stringify({ name: "Aria" })).toString(
				"base64"
			)
		})
	})
})
