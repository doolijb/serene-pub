/**
 * Envoys, as the host reads them (U5g review, S4) — the cache-freeze guard.
 *
 * `declaredEnvoys` hands out a fresh top-level array/object per caller (the
 * top level stays a plain, mutable copy — "the cached one is nobody's to
 * mutate" is answered by copying it, not by freezing what a caller holds).
 * But the copy is shallow: `prompts` is still the object the cache holds,
 * and every other reader gets the SAME reference on their own "fresh" copy.
 * A caller mutating `entry.prompts` would corrupt every other reader without
 * ever touching the cache map directly — that is the write `Object.freeze`
 * on the cached entry's `prompts` turns into a thrown TypeError (this file
 * is an ES module, so strict mode) instead of silent cross-reader
 * corruption. Freezing the cached entry itself is the same discipline one
 * level up, for whichever internal reader might someday hold the cached
 * object rather than a copy of it.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { declaredEnvoys } from "$lib/server/pipelines/entities/envoys"
import { GUIDE_GENRE_ID, GUIDE_MASCOT_KEY } from "@serene-pub/core-catalog"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
}, 60_000)

describe("declaredEnvoys' cache is frozen against its callers", () => {
	it("the top level is a fresh, writable copy; its `prompts` is the shared, frozen object", async () => {
		const [mascot] = (await declaredEnvoys(db, GUIDE_GENRE_ID)).filter(
			(e) => e.key === GUIDE_MASCOT_KEY
		)
		expect(mascot).toBeTruthy()
		expect(mascot.prompts?.systemPrompt).toBeTruthy()

		// The entry itself is a shallow copy, not the cached object — writable,
		// as a caller mutating their own "fresh" answer should be.
		expect(Object.isFrozen(mascot)).toBe(false)
		;(mascot as any).default = false
		expect(mascot.default).toBe(false)

		// `prompts` did not get copied — it is the cached, frozen object every
		// reader's copy points at. This file is an ES module — always strict
		// mode — so writing to it throws rather than silently corrupting
		// every other reader's answer.
		expect(Object.isFrozen(mascot.prompts)).toBe(true)
		expect(() => {
			;(mascot.prompts as any).systemPrompt = "hijacked"
		}).toThrow(TypeError)
	})

	it("a second read is unaffected by the first read's copy — including the attempted write above", async () => {
		const first = (await declaredEnvoys(db, GUIDE_GENRE_ID)).find(
			(e) => e.key === GUIDE_MASCOT_KEY
		)!
		const second = (await declaredEnvoys(db, GUIDE_GENRE_ID)).find(
			(e) => e.key === GUIDE_MASCOT_KEY
		)!
		expect(second.prompts?.systemPrompt).toBe(first.prompts?.systemPrompt)
		// The mutation attempt above never landed (freeze refused it), so the
		// default this read sees is still the declaration's own.
		expect(second.default).toBe(true)
	})
})
