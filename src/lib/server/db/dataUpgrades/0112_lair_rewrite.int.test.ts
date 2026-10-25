/**
 * The 0112 data upgrade (PLAN-lair-build D11, 2026-10-21): Lair sessions
 * from before the rewrite — the old fields, the old reply's registrations,
 * the old Lair's own slots — carried into the rewritten genre. A pre-rewrite
 * fixture in scratch tables with the columns the upgrade touches, so the SQL
 * is what is under test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import { lairRewriteUpgrade } from "./0112_lair_rewrite"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const rows = async <T extends Record<string, unknown>>(s: string): Promise<T[]> => rawRows<T>(await q(s))
const KEEPER = "after-each-round→lair-keeper"

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(`CREATE TABLE sessions (id integer PRIMARY KEY, genre_id text, preset_id integer, genre_fields json)`)
	await q(`CREATE TABLE session_presets (id integer PRIMARY KEY, seed_key text, genre_id text, defaults json, settings json)`)
	await q(`CREATE TABLE registrations (
		id serial PRIMARY KEY, scope_kind text NOT NULL, scope_ref text NOT NULL, preset_id integer, session_id integer,
		key text NOT NULL, trigger_family text, trigger_ref text, spec_slug text, "values" jsonb, mode text,
		dropped boolean NOT NULL DEFAULT false, origin text NOT NULL,
		UNIQUE (scope_kind, scope_ref, key))`)
	await q(`CREATE TABLE attribute_values (id serial PRIMARY KEY, owner_kind text, owner_id integer, session_id integer, slot_id text, value jsonb)`)
	await q(`CREATE TABLE session_attribute_picks (id serial PRIMARY KEY, session_id integer, slot_id text, enabled boolean,
		UNIQUE (session_id, slot_id))`)

	// The shipped Lair default (its seed key kept by the rewrite) and an administrator's Lair preset.
	await q(`INSERT INTO session_presets (id, seed_key, genre_id, defaults, settings) VALUES
		(1, 'core-lair-default', 'core:genre/lair', '{"genreFields":{"tone":"grounded"}}', null),
		(2, null, 'core:genre/lair', '{"genreFields":{"tone":"grim","partySpeech":"castellan"}}', '{"trustNarrator":{"value":true,"lock":true}}'),
		(3, 'core-story-living', 'core:genre/story', null, '{"trustNarrator":true}')`)
	// Pre-rewrite sessions: one trusting the narrator with no preset, one on the shipped default, one Story session.
	await q(`INSERT INTO sessions (id, genre_id, preset_id, genre_fields) VALUES
		(10, 'core:genre/lair', null, '{"tone":"pulpy","partySpeech":"castellan","trustNarrator":true,"sanctumSteers":false}'),
		(11, 'core:genre/lair', 1, '{"partySpeech":"each","trustNarrator":false}'),
		(12, 'core:genre/story', null, '{"trustNarrator":true}')`)
	await q(`INSERT INTO registrations (scope_kind, scope_ref, preset_id, session_id, key, spec_slug, "values", origin) VALUES
		('session', '10', null, 10, 'message-respond→lair-respond', 'core:spec/lair-respond', '{"via.turn.channel.story.door.play.beats":{"params":{"path":"beats"}}}', 'upgrade'),
		('session', '11', null, 11, 'message-respond→lair-respond', 'core:spec/lair-respond', null, 'upgrade'),
		('session', '11', null, 11, 'message-respond→lair-reply', 'core:spec/lair-reply', null, 'owner'),
		('preset', '2', 2, null, 'lair-advance-time#advance-time→lair-advance-time', null, null, 'upgrade'),
		('genre', 'core:genre/lair', null, null, 'admin:message-respond→lair-respond', null, '{"x":{"params":{"y":1}}}', 'admin')`)
	await q(`INSERT INTO attribute_values (owner_kind, owner_id, session_id, slot_id, value) VALUES
		('session', 10, 10, 'core:slot/floor@1', '{"v":3}'),
		('session', 10, 10, 'core:slot/gold@1', '{"v":40}'),
		('session', 10, 10, 'core:slot/gold@1', '{"v":45}'),
		('session_cast', 7, 10, 'core:slot/hp@1', '{"v":8}'),
		('session', 12, 12, 'core:slot/floor@1', '{"v":1}')`)
}, 60_000)

afterEach(async () => {
	await client.close()
})

const upgrade = () => db.transaction(async (tx: any) => lairRewriteUpgrade(tx, {} as any))

describe("0112 the Lair rewrite", () => {
	it("a Lair session with no preset takes Rules; the retired fields leave sessions and Lair presets", async () => {
		const report = await upgrade()
		expect(report.sessionsPreset).toBe(1)
		expect(await rows(`SELECT id, preset_id, genre_fields FROM sessions ORDER BY id`)).toEqual([
			{ id: 10, preset_id: 1, genre_fields: { tone: "pulpy", sanctumSteers: false } },
			{ id: 11, preset_id: 1, genre_fields: {} },
			// Another genre's session is not the Lair's to touch.
			{ id: 12, preset_id: null, genre_fields: { trustNarrator: true } }
		])
		expect(await rows(`SELECT id, defaults, settings FROM session_presets ORDER BY id`)).toEqual([
			{ id: 1, defaults: { genreFields: { tone: "grounded" } }, settings: null },
			{ id: 2, defaults: { genreFields: { tone: "grim" } }, settings: {} },
			{ id: 3, defaults: null, settings: { trustNarrator: true } }
		])
	}, 60_000)

	it("Trust the narrator on becomes the keeper at Full — for the session and for the preset that said it", async () => {
		const report = await upgrade()
		expect(report.keeperFull).toBe(2)
		expect(
			await rows(`SELECT scope_kind, scope_ref, session_id, preset_id, mode, origin FROM registrations WHERE key = '${KEEPER}' ORDER BY id`)
		).toEqual([
			{ scope_kind: "session", scope_ref: "10", session_id: 10, preset_id: null, mode: "full", origin: "upgrade" },
			{ scope_kind: "preset", scope_ref: "2", session_id: null, preset_id: 2, mode: "full", origin: "upgrade" }
		])
	}, 60_000)

	it("registrations naming the old reply move onto lair-reply, values dropped; Time passes leaves", async () => {
		const report = await upgrade()
		expect(report.registrationsRenamed).toBe(2)
		expect(report.registrationsDropped).toBe(1)
		const regs = await rows<{ scope_kind: string; scope_ref: string; key: string; spec_slug: string | null; values: unknown }>(
			`SELECT scope_kind, scope_ref, key, spec_slug, "values" FROM registrations WHERE key <> '${KEEPER}' ORDER BY scope_kind, scope_ref, key`
		)
		expect(regs).toEqual([
			{ scope_kind: "genre", scope_ref: "core:genre/lair", key: "admin:message-respond→lair-reply", spec_slug: null, values: null },
			{ scope_kind: "session", scope_ref: "10", key: "message-respond→lair-reply", spec_slug: "core:spec/lair-reply", values: null },
			// The new key already stood: the old row is dropped, the owner's kept.
			{ scope_kind: "session", scope_ref: "11", key: "message-respond→lair-reply", spec_slug: "core:spec/lair-reply", values: null }
		])
		expect(report.notCarried).toEqual(
			expect.arrayContaining([
				expect.stringContaining("'message-respond→lair-respond' dropped"),
				expect.stringContaining("Time passes"),
				expect.stringContaining("step values")
			])
		)
	}, 60_000)

	it("the old Lair's own slots stay tracked where a Lair session holds values", async () => {
		const report = await upgrade()
		expect(report.attributePicks).toBe(2)
		expect(await rows(`SELECT session_id, slot_id, enabled FROM session_attribute_picks ORDER BY session_id, slot_id`)).toEqual([
			{ session_id: 10, slot_id: "core:slot/floor@1", enabled: true },
			{ session_id: 10, slot_id: "core:slot/gold@1", enabled: true }
		])
	}, 60_000)

	it("is idempotent", async () => {
		await upgrade()
		const again = await upgrade()
		expect(again).toEqual({
			sessionsPreset: 0,
			fieldsRemoved: 0,
			keeperFull: 0,
			registrationsRenamed: 0,
			registrationsDropped: 0,
			attributePicks: 0,
			notCarried: []
		})
	}, 60_000)
})
