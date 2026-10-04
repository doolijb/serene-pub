import { describe, expect, it } from "vitest"
import { passphraseSchema } from "$lib/shared/validation/passphrase"
import { randomPassphrase, userDeletion } from "./usersAdmin"

describe("userDeletion", () => {
	const me = { id: 1, username: "jody", displayName: null, isAdmin: true }
	const ann = { id: 2, username: "ann", displayName: null, isAdmin: false }
	it("keeps your own account and deactivates the rest", () => {
		const d = userDeletion([me, ann], 1)
		expect(d.objects.map((o) => o.label)).toEqual(["ann"])
		expect(d.summary).toContain("jody stays: you cannot delete your own account")
		expect(d.summary).toContain("can no longer sign in")
	})
	it("only yourself selected: nothing to delete", () => {
		expect(userDeletion([me], 1).objects).toEqual([])
	})
})

describe("randomPassphrase", () => {
	it("passes the passphrase rule", () => {
		for (let i = 0; i < 20; i++)
			expect(passphraseSchema.safeParse(randomPassphrase()).success).toBe(true)
	})
})
