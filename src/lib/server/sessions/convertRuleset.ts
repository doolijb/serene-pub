/**
 * 🚧 **Converting a session's rules** (M0, lane T4, SHAPES L4): a
 * session pinned to an earlier version of its ruleset keeps playing it; the
 * owner moves it to the published version, following the document's
 * `upgrades` chain from the pin.
 *
 * Per session-layer owner, in ONE transaction and all anchored to the world's
 * open anchor (so `retractStateAnchoredTo` takes them back): a renamed slot's
 * value (and configuration) is filed under the new slot and the old slot
 * cleared; a removed slot is cleared; an added slot gets the step's default
 * where the new slot applies. A renamed value keeps the time it was written; an
 * added default has none. Then `sessions.ruleset_version` is `to`. The
 * caller emits `core:event/ruleset-converted@1` after the commit.
 *
 * ★ Held: Back past the anchor takes the re-keys back, not `ruleset_version`.
 */
import { and, eq, inArray } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { getAttributeSlot, getRuleset, compareRulesetVersions, i18nText, type I18n } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { rulesetOrigin } from "$lib/server/rulesets/pubRulesets"
import { GIVEN_WRITE_STAMP, StateRefusal, anchorFor, configure, setValue, type WriteContext } from "$lib/server/state/write"
import { sessionLinks } from "$lib/server/state/resolve"
import { fileSessionImprint } from "$lib/server/sessions/sessionImprints"
import { castOwnerOf, type StateOwner } from "$lib/server/state/owners"
import { clockOf } from "$lib/server/state/storyTime"
import { memberFormOn } from "$lib/server/state/memberForm"

type Step = {
	from: string
	to: string
	slots?: { renamed?: Record<string, string>; removed?: readonly string[]; added?: Record<string, unknown> }
}

export interface RulesetConversion {
	rulesetId: string
	from: string
	to: string
	slots: { renamed: Record<string, string>; removed: string[]; added: Record<string, unknown> }
}

// 🚧 ⏳ `seated_member` rows exist only once the flip is on (`memberForm.ts`); the list only filters rows, so adding it changes nothing while it is off.
const SESSION_LAYER = ["session", "session_cast", "player_seat", "seated_member", "session_location"] as const

/** The steps from `from` to `to`, followed by their `from`; null when the chain does not get there. */
function chainFrom(upgrades: readonly Step[], from: string, to: string): Step[] | null {
	const out: Step[] = []
	let at = from
	while (at !== to) {
		const next = upgrades.find((u) => u?.from === at && compareRulesetVersions(u.to, at) > 0)
		if (!next) return null
		out.push(next)
		at = next.to
	}
	return out.length ? out : null
}

/** The steps composed: renames compose, a renamed slot later removed is removed, `added` the later step wins. */
function compose(steps: readonly Step[]): RulesetConversion["slots"] {
	const renamed = new Map<string, string>()
	const removed = new Set<string>()
	const added = new Map<string, unknown>()
	for (const step of steps) {
		for (const [a, b] of Object.entries(step.slots?.renamed ?? {})) {
			const origin = [...renamed.entries()].find(([, now]) => now === a)?.[0]
			if (origin !== undefined) renamed.set(origin, b)
			else if (added.has(a)) {
				added.set(b, added.get(a))
				added.delete(a)
			} else renamed.set(a, b)
		}
		for (const r of step.slots?.removed ?? []) {
			const origin = [...renamed.entries()].find(([, now]) => now === r)?.[0]
			if (origin !== undefined) {
				renamed.delete(origin)
				removed.add(origin)
			} else if (added.has(r)) added.delete(r)
			else removed.add(r)
		}
		for (const [k, v] of Object.entries(step.slots?.added ?? {})) added.set(k, v)
	}
	return { renamed: Object.fromEntries(renamed), removed: [...removed], added: Object.fromEntries(added) }
}

/** Convert one session's rules to the published version `to`. Throws `StateRefusal` in the module's sentences. */
export async function convertSessionRuleset(
	db: Db,
	args: { sessionId: number; to: string; userId: number }
): Promise<RulesetConversion> {
	const [session] = await db
		.select({
			userId: schema.sessions.userId,
			rulesetId: schema.sessions.primaryRuleset,
			rulesetVersion: schema.sessions.rulesetVersion
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, args.sessionId))
		.limit(1)
	if (!session || session.userId !== args.userId) throw new StateRefusal("Only the session's owner can change its rules.")
	const cur = session.rulesetVersion
	if (!cur) throw new StateRefusal("This session has not pinned a version of its rules yet, so there is nothing to convert from.")
	const rulesetId = session.rulesetId
	if (!getRuleset(rulesetId) && (await rulesetOrigin(db, rulesetId)) === "plugin")
		throw new StateRefusal("These rules came with a plugin that is no longer installed.")
	const [row] = await db
		.select({ published: schema.rulesets.published, version: schema.rulesets.publishedVersion })
		.from(schema.rulesets)
		.where(eq(schema.rulesets.rulesetId, rulesetId))
		.limit(1)
	if (!row?.version || !row.published) throw new StateRefusal("These rules have no published version to convert to.")
	if (args.to !== row.version) throw new StateRefusal(`Only version ${row.version} of these rules is installed.`)
	const upgrades = ((row.published as { upgrades?: Step[] }).upgrades ?? []) as Step[]
	const steps = chainFrom(upgrades, cur, args.to)
	if (!steps) throw new StateRefusal(`There is no upgrade from ${cur} towards ${args.to} in these rules.`)
	const slots = compose(steps)
	const links = await sessionLinks(db, args.sessionId)

	await db.transaction(async (tx) => {
		const t = tx as unknown as Db
		const anchor = await anchorFor(t, { sessionId: args.sessionId, updatedBy: `user:${args.userId}` }, { kind: "session", id: args.sessionId })
		const ctx: WriteContext = { sessionId: args.sessionId, updatedBy: `user:${args.userId}`, userId: args.userId, messageId: anchor, ownAnchor: true }
		const moving = [...Object.keys(slots.renamed), ...slots.removed]
		const order = (r: { validFromMessageId: number | null; id: number }) => [r.validFromMessageId ?? -1, r.id] as const
		const later = (a: Parameters<typeof order>[0], b: Parameters<typeof order>[0]) => {
			const [am, ai] = order(a)
			const [bm, bi] = order(b)
			return am - bm || ai - bi
		}

		// The in-force (latest) row per holder and slot, session layer only.
		const rows = moving.length
			? await t
					.select()
					.from(schema.attributeValues)
					.where(
						and(
							eq(schema.attributeValues.sessionId, args.sessionId),
							inArray(schema.attributeValues.ownerKind, [...SESSION_LAYER]),
							inArray(schema.attributeValues.slotId, [...moving, ...Object.values(slots.renamed)])
						)
					)
			: []
		const latest = new Map<string, (typeof rows)[number]>()
		for (const r of [...rows].sort((a, b) => (a.validFromMessageId ?? -1) - (b.validFromMessageId ?? -1) || a.id - b.id))
			latest.set(`${r.ownerKind}:${r.ownerId}:${r.slotId}`, r)

		/** A cleared row for the old slot — `setValue`'s insert, which may not be asked of a withdrawn slot. */
		const clear = async (owner: StateOwner, slotId: string) => {
			const [version] = rawRows<{ state_version: number | string | null }>(
				await t.execute(sql`
					update ${schema.sessions}
					set state_version = state_version + 1
					where ${schema.sessions.id} = ${args.sessionId}
					returning state_version
				`)
			)
			await t.insert(schema.attributeValues).values({
				ownerKind: owner.kind,
				ownerId: owner.id,
				slotId,
				value: { v: null },
				sessionId: args.sessionId,
				validFromMessageId: anchor,
				updatedBy: ctx.updatedBy,
				note: null,
				stateVersion: version?.state_version == null ? null : Number(version.state_version),
				branchId: null,
				historyEntryId: null,
				sceneId: null,
				sourceSessionId: null,
				sourceMessageId: null
			})
		}

		for (const [old, now] of Object.entries(slots.renamed))
			for (const r of latest.values()) {
				if (r.slotId !== old) continue
				const owner = { kind: r.ownerKind, id: r.ownerId } as StateOwner
				const held = (r.value as { v?: unknown } | null)?.v
				// A value someone wrote under the NEW id after the old id's latest is kept: only values written under the
				// old id are re-keyed (M2b a7).
				const newer = latest.get(`${r.ownerKind}:${r.ownerId}:${now}`)
				const newerHeld = newer ? (newer.value as { v?: unknown } | null)?.v : null
				if (newer && newerHeld != null && later(newer, r) > 0) {
					await clear(owner, old)
					continue
				}
				if (held !== null && held !== undefined) await setValue(t, ctx, { owner, slotId: now, value: held as never, [GIVEN_WRITE_STAMP]: { clock: clockOf(r), writtenAt: r.createdAt } })
				await clear(owner, old)
			}
		for (const gone of slots.removed)
			for (const r of latest.values()) {
				if (r.slotId !== gone) continue
				if ((r.value as { v?: unknown } | null)?.v == null) continue
				await clear({ kind: r.ownerKind, id: r.ownerId } as StateOwner, gone)
			}

		// A renamed slot's configuration goes with it.
		if (Object.keys(slots.renamed).length) {
			const configs = await t
				.select()
				.from(schema.attributeConfigs)
				.where(
					and(
						eq(schema.attributeConfigs.sessionId, args.sessionId),
						inArray(schema.attributeConfigs.ownerKind, [...SESSION_LAYER]),
						inArray(schema.attributeConfigs.slotId, Object.keys(slots.renamed))
					)
				)
			const seen = new Map<string, (typeof configs)[number]>()
			for (const c of [...configs].sort((a, b) => (a.validFromMessageId ?? -1) - (b.validFromMessageId ?? -1) || a.id - b.id))
				seen.set(`${c.ownerKind}:${c.ownerId}:${c.slotId}`, c)
			for (const c of seen.values()) {
				const deviations = (c.config ?? {}) as Record<string, unknown>
				if (!Object.keys(deviations).length || !getAttributeSlot(slots.renamed[c.slotId]!)) continue
				await configure(t, ctx, { owner: { kind: c.ownerKind, id: c.ownerId } as StateOwner, slotId: slots.renamed[c.slotId]!, config: deviations as never })
			}
		}

		// What an added slot gets: its default, on each session-layer owner it applies to.
		for (const [slotId, value] of Object.entries(slots.added)) {
			const decl = getAttributeSlot(slotId)
			if (!decl) continue
			const owners: StateOwner[] = []
			if (decl.appliesTo.includes("world")) owners.push({ kind: "session", id: args.sessionId })
			if (decl.appliesTo.includes("cast")) {
				for (const m of links.cast) owners.push(castOwnerOf(m))
				for (const s of links.playerSeats ?? []) owners.push({ kind: "player_seat", id: s.playerSeatId })
				// 🚧 ⏳ Flip on: each card-less character seat is an owner of its own.
				for (const s of links.seatedMembers ?? [])
					owners.push({ kind: "seated_member", id: s.seatMemberId })
				// 🚧 ⏳ Flip on: a carded player seat is in both lists — one owner each.
				if (memberFormOn()) {
					const seen = new Set<string>()
					for (let i = owners.length - 1; i >= 0; i--) {
						const k = `${owners[i]!.kind}:${owners[i]!.id}`
						if (seen.has(k)) owners.splice(i, 1)
						else seen.add(k)
					}
				}
			}
			if (decl.appliesTo.includes("location")) for (const p of links.locations) owners.push({ kind: "session_location", id: p.entryId })
			for (const owner of owners) await setValue(t, ctx, { owner, slotId, value: value as never, [GIVEN_WRITE_STAMP]: null })
		}

		// Back past the anchor puts the version back: the conversion is a `ruleset-conversion` session imprint (no anchor, none filed).
		await fileSessionImprint(
			t,
			{ sessionId: args.sessionId, messageId: anchor, runId: null },
			{ kind: "ruleset-conversion", key: rulesetId },
			cur,
			args.to
		)
		await t.update(schema.sessions).set({ rulesetVersion: args.to }).where(eq(schema.sessions.id, args.sessionId))
	})
	return { rulesetId, from: cur, to: args.to, slots }
}

export interface RulesetUpgradeOffer {
	from: string
	to: string
	notes: string[]
}

/** What "Update rules" offers this session, or null: pinned, a published version above the pin, and a chain that gets there. */
export async function rulesetUpgradeOffer(db: Db, sessionId: number): Promise<RulesetUpgradeOffer | null> {
	const [session] = await db
		.select({ rulesetId: schema.sessions.primaryRuleset, rulesetVersion: schema.sessions.rulesetVersion })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const cur = session?.rulesetVersion
	if (!session || !cur) return null
	if (!getRuleset(session.rulesetId) && (await rulesetOrigin(db, session.rulesetId)) === "plugin") return null
	const [row] = await db
		.select({ published: schema.rulesets.published, version: schema.rulesets.publishedVersion })
		.from(schema.rulesets)
		.where(eq(schema.rulesets.rulesetId, session.rulesetId))
		.limit(1)
	if (!row?.version || !row.published) return null
	if (compareRulesetVersions(row.version, cur) <= 0) return null
	const upgrades = ((row.published as { upgrades?: Step[] }).upgrades ?? []) as Array<Step & { note?: unknown }>
	const steps = chainFrom(upgrades, cur, row.version) as Array<Step & { note?: unknown }> | null
	if (!steps) return null
	const notes = steps
		.map((s) => (s.note == null ? "" : (i18nText(s.note as I18n) ?? "")).trim())
		.filter((t) => t.length > 0)
	return { from: cur, to: row.version, notes }
}
