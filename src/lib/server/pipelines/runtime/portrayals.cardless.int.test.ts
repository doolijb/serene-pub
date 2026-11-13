/**
 * 🚧 `turnRefs` over a card-less character seat (plan §34.2, S4): asked about as
 * `seated-member:<castMemberId>`; an envoy seat stays `envoy:<slug>` only.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { createTestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"
import { turnRefs } from "./portrayals"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const switchWas = memberFormSwitch.on
afterEach(() => {
	memberFormSwitch.on = switchWas
})

describe("turnRefs — a card-less seat", () => {
	it("includes seated-member:<M> for a card-less seat and not the envoy seat's member form", async () => {
		memberFormSwitch.on = true
		const db = await createTestDb()
		const [user] = await db
			.insert(schema.users)
			.values({ username: "portrayals-cardless" })
			.returning()
		const [book] = await db
			.insert(schema.lorebooks)
			.values({ userId: user!.id, name: "Cardless refs" })
			.returning()
		const { member } = await insertCastMember(db, {
			lorebookId: book!.id,
			binding: "{{char:cl-refs}}",
			characterId: null,
			name: "Nobody",
			ownName: "Nobody"
		})
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId: user!.id, isGroup: true, lorebookId: book!.id })
			.returning()
		const sessionId = session!.id
		await db.insert(schema.sessionCharacters).values([
			{
				sessionId,
				characterId: null,
				castMemberId: member!.id,
				isActive: true
			},
			{
				sessionId,
				characterId: null,
				envoySlug: "mascot",
				isActive: true
			}
		] as any)
		const refs = await turnRefs(db as any, sessionId, null)
		expect(refs).toContain(`seated-member:${member!.id}`)
		expect(refs).toContain("envoy:mascot")
		// The envoy seat is asked about as an envoy only: no member-form ref for it.
		expect(refs.filter((r) => r.startsWith("seated-member:"))).toEqual([
			`seated-member:${member!.id}`
		])
	})
})
