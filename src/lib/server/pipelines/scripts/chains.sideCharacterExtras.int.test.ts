/**
 * The new-name fact reaches a script, through the one dispatch.
 *
 * The ruling of 2026-09-07 asked for a hook and a fact and nothing more: "a
 * script can detect if they are new/not in the lorebook and suggest to add
 * them." Core supplies the fact; whether anything is suggested is the script's
 * business. So there are exactly two things to pin, and they are the two that
 * can rot independently:
 *
 *  1. the **declaration** — `core:input/side-character-turn@1` names
 *     `speakerIsKnown` in its scripts hook's `extras`, so `scriptTypeInfos`
 *     offers it in the script editor's fixed choice set. A read a hook does not
 *     declare is a name typed on faith, and the editor refuses it;
 *  2. the **value** — `scriptExtras` supplies it, and it arrives inside the
 *     sandbox on a link that declared it.
 *
 * ⚠ **Through the applier, and only through it.** Core scripts and extension
 * hooks share one dispatch (the applier seam, 18 §4a/§5): `site.extras` narrows
 * what is serialized in, the transport fork routes a plugin-owned type
 * out-of-process, and both hand back one `ScriptRunResult`. A second path from
 * the trigger to a script — an event, a callback, a notification — would be a
 * second set of rules for ordering, recording and failure, and there is exactly
 * one place those are written down. Nothing here adds one.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { makeScriptApplier, scriptExtras } from "./chains"

let db: TestDb
let sessionId: number
let userId: number
let castCharacterId: number

const TEXT_TRANSFORM = "core:script:text/transform@1"

/**
 * The input node's hook, exactly as
 * `core:input/side-character-turn@1` declares it. Restated here rather than
 * read from the registry on purpose: the declaration itself is asserted
 * separately below, and a site derived from the thing under test would agree
 * with it however wrong both were.
 */
const site = {
	nodeKey: "input",
	slot: "scripts",
	phase: "after",
	port: "text",
	accepts: [TEXT_TRANSFORM],
	extras: [
		"speakerName",
		"speakerCharacterId",
		"speakerIsKnown",
		"castNames"
	],
	origin: "substrate"
} as any

async function scriptRow(
	name: string,
	source: string,
	varsIn: string[]
): Promise<number> {
	const [row] = await db
		.insert(schema.pipelineScripts)
		.values({
			typeId: TEXT_TRANSFORM,
			name,
			enabled: true,
			source,
			varsIn,
			varsOut: ["text"]
		})
		.returning()
	return row.id
}

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "side-extras", isAdmin: false })
		.returning()
	userId = user.id
	const [cast] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
		.returning()
	castCharacterId = cast.id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId: castCharacterId })
}, 120_000)

describe("the hook declares the fact", () => {
	it("offers speakerIsKnown as a declared read on text/transform", async () => {
		const { scriptType } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const info = await scriptType(db, TEXT_TRANSFORM)
		expect(info, "text/transform is not registered on this build").toBeTruthy()
		// `hookExtras` unions the `extras` of every hook accepting the type,
		// read from the projected registry rows — so this passing means the
		// side-character input's declaration actually reached the database that
		// the script editor's choice set is built from.
		expect(info!.extras).toContain("speakerIsKnown")
		expect(info!.extras).toContain("speakerName")
		expect(info!.extras).toContain("speakerCharacterId")
	}, 60_000)

	it("refuses a script declaring a read no hook supplies", async () => {
		// The other half of "a declared read is either a port or an extra some
		// hook provides, never a name typed on faith" (ruled 2026-08-23). If
		// this stopped refusing, `speakerIsKnown` would no longer be a
		// *declaration* — it would be whatever the sandbox happened to hold.
		const { ScriptNotUsableError, createScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		await expect(
			createScript(db, {
				typeId: TEXT_TRANSFORM,
				name: "reads a name nobody supplies",
				source: "return text",
				varsIn: ["text", "speakerIsUnheardOf"],
				varsOut: ["text"]
			} as any)
		).rejects.toBeInstanceOf(ScriptNotUsableError)
	}, 60_000)
})

describe("the fact reaches the sandbox", () => {
	it("hands a free-form speaker's name and unknown-ness to a link", async () => {
		const id = await scriptRow(
			"suggest adding a newcomer",
			// What a real script would do with it: leave the text alone unless
			// the lorebook has never heard of the speaker, and say so in the
			// text the turn was triggered with. Core supplies the fact; this is
			// the part core does not write.
			//
			// ⚠ `ctx.speakerIsKnown`, not a bare identifier. Declared *ins*
			// are bound as locals; **extras ride on `ctx`**, read-only, which
			// is the shape 18 §6a gives them — a hook's context is not the
			// hook's data, and the sandbox keeps the two apart on purpose.
			`return ctx.speakerIsKnown
				? text
				: text + " (" + ctx.speakerName + " is new here.)"`,
			["text", "speakerName", "speakerIsKnown"]
		)
		const apply = makeScriptApplier(db, {
			seed: "seed",
			nowMs: 1_000_000,
			extras: await scriptExtras(db, {
				sessionId,
				currentCharacterId: null,
				speaker: {
					name: "The innkeeper",
					characterId: null,
					known: false
				}
			})
		})
		const r = await apply(site, [id], "have you seen the ashguard?")
		expect(
			r.applications[0],
			`the link did not run: ${(r.applications[0] as any)?.reason}`
		).toMatchObject({
			scriptId: id,
			result: "ok"
		})
		expect(r.value).toBe(
			"have you seen the ashguard? (The innkeeper is new here.)"
		)
	}, 60_000)

	it("stays quiet for a name the lorebook already knows", async () => {
		// Same script, same hook, opposite fact — so the branch is the fact's
		// and not the script's. A `known` that never came through would make
		// the suggestion fire on everybody, which is the failure a person would
		// notice and blame on their script.
		const id = await scriptRow(
			"suggest adding a newcomer (known case)",
			`return ctx.speakerIsKnown
				? text
				: text + " (" + ctx.speakerName + " is new here.)"`,
			["text", "speakerName", "speakerIsKnown"]
		)
		const apply = makeScriptApplier(db, {
			seed: "seed",
			nowMs: 1_000_000,
			extras: await scriptExtras(db, {
				sessionId,
				currentCharacterId: null,
				speaker: {
					name: "Captain Vell",
					characterId: 7,
					known: true
				}
			})
		})
		const r = await apply(site, [id], "have you seen the ashguard?")
		expect(r.value).toBe("have you seen the ashguard?")
	}, 60_000)

	it("does not let a cast member's name overwrite a typed one", async () => {
		/**
		 * ⚠ The ordering inside `scriptExtras`, pinned.
		 *
		 * It has always resolved `speakerName` by looking the scope's
		 * `currentCharacterId` up in `characters`. A side-character turn
		 * supplies the name from the trigger instead — and a free-form name has
		 * no row to look up at all — so the lookup must not run when the
		 * trigger already answered. Written the other way round it would hand
		 * every script the cast member's name while the turn was spoken by
		 * somebody else entirely.
		 */
		const extras = await scriptExtras(db, {
			sessionId,
			currentCharacterId: castCharacterId,
			speaker: {
				name: "The innkeeper",
				characterId: null,
				known: false
			}
		})
		expect(extras.speakerName).toBe("The innkeeper")
		expect(extras.speakerIsKnown).toBe(false)
		// And the cast still rides along, untouched.
		expect(extras.castNames).toEqual(["Alice"])
	}, 60_000)

	it("leaves every other pipeline exactly as it was", async () => {
		// No speaker means no speaker keys — a run of the reply pipeline must
		// not start carrying three nulls a script could branch on.
		const extras = await scriptExtras(db, {
			sessionId,
			currentCharacterId: castCharacterId
		})
		expect(extras.speakerName).toBe("Alice")
		expect("speakerIsKnown" in extras).toBe(false)
		expect("speakerCharacterId" in extras).toBe(false)
	}, 60_000)
})
