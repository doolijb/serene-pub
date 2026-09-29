/**
 * CRUD for completion templates — the delimiters every prompt this instance
 * sends is wrapped in.
 *
 * ## ⚠ Every handler checks admin, itself
 *
 * The `/admin` layout gate is for the PERSON: it decides which screens are
 * offered. A row written here changes the bytes of every prompt sent through
 * every connection that references it, and a socket event does not go through a
 * layout. So the check that matters is the one in each handler, and there is one
 * in each handler — the same rule `samplingConfigs.ts` and `graphBuildConfigs.ts`
 * state next door.
 *
 * ## Built-ins are refused server-side, and that is what makes the boot safe
 *
 * `db/defaults.ts` re-applies every seeded template's FULL contents on every
 * boot (`set({ ...data, id: undefined })`). That is safe only because an
 * immutable row cannot be edited through here at all — a mutable seeded row
 * would have its user's edits silently reverted at the next restart with
 * nothing anywhere to catch it. Customising a built-in is `clone`, following
 * `/admin/prompts`.
 *
 * ## What a client may not say
 *
 * `id`, `isImmutable` and `seedKey` are stripped from every write payload and
 * forced to `isImmutable: false, seedKey: null` — the established pattern
 * (`graphBuildConfigs.ts`), covered by `configsCreate.seedKeyStrip.int.test.ts`.
 * A created row claiming a `seedKey` would be treated as a seed by the boot sync
 * and have its contents overwritten; one claiming `isImmutable` would make
 * itself uneditable and undeletable.
 *
 * Everything else a payload may say is checked by
 * `validateCompletionTemplate`, which is where the reasoning for each rule
 * lives.
 */
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, ne, and } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { validateCompletionTemplate } from "$lib/shared/utils/completionTemplateValidation"

const DENIED =
	"Access denied. Only admin users can manage completion templates."

function requireAdmin(
	socket: any,
	emitToUser: (event: string, data: any) => void
) {
	if (!socket.user!.isAdmin) {
		emitToUser("error", { error: DENIED })
		throw new Error(DENIED)
	}
}

/** Emit the failure on the event's own channel, then throw. */
function refuse(
	emitToUser: (event: string, data: any) => void,
	event: string,
	error: string
): never {
	emitToUser(`${event}:error`, { error })
	throw new Error(error)
}

/**
 * Every completion template, as one function, so the four write cascades below
 * can be handed the BUILDER rather than the handler.
 *
 * `completionTemplates:list` is gated, so a create, an edit or a clone made from
 * anywhere but the list pays for no re-read at all. Skipping the emit alone
 * would save nothing; the query is the cost.
 *
 * No admin check here — the check belongs to the handler, which is the surface a
 * client can reach. Every cascade below has already made it.
 */
async function buildCompletionTemplatesList(): Promise<Sockets.CompletionTemplates.List.Response> {
	// Built-ins first, then by name — the ordering /admin/sampling uses, so
	// the shipped rows a person is looking to clone are at the top.
	const completionTemplatesList = await db.query.completionTemplates.findMany({
		orderBy: (t, { asc, desc }) => [desc(t.isImmutable), asc(t.name)]
	})
	return { completionTemplatesList }
}

export const completionTemplatesListHandler: Handler<
	Sockets.CompletionTemplates.List.Params,
	Sockets.CompletionTemplates.List.Response
> = {
	event: "completionTemplates:list",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		const res = await buildCompletionTemplatesList()
		emitToUser("completionTemplates:list", res)
		return res
	}
}

export const completionTemplatesGet: Handler<
	Sockets.CompletionTemplates.Get.Params,
	Sockets.CompletionTemplates.Get.Response
> = {
	event: "completionTemplates:get",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		const completionTemplate = await db.query.completionTemplates.findFirst({
			where: (t, { eq }) => eq(t.id, params.id)
		})
		if (!completionTemplate)
			refuse(
				emitToUser,
				"completionTemplates:get",
				"Completion template not found"
			)
		const res: Sockets.CompletionTemplates.Get.Response = {
			completionTemplate
		}
		emitToUser("completionTemplates:get", res)
		return res
	}
}

/**
 * The format picker's options, from the table.
 *
 * ⚠ This replaces `PromptFormats.options` as the picker's source. That was a
 * hand-written array of eight `{value,label}` pairs sitting beside a table
 * anyone can add rows to, with only a test keeping the two equal — so a
 * template an admin authored could be saved, referenced and rendered, and never
 * appear in the control that selects it.
 *
 * `is_selectable` is the filter, which is how `split_chat` stays out: it is a
 * transport bridge, not a text format a person chooses.
 *
 * Admin-only like the rest, because the picker it feeds only ever renders on a
 * connection form, and connections are admin-only end to end.
 */
export const completionTemplatesOptions: Handler<
	Sockets.CompletionTemplates.Options.Params,
	Sockets.CompletionTemplates.Options.Response
> = {
	event: "completionTemplates:options",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		const rows = await db.query.completionTemplates.findMany({
			columns: { key: true, name: true },
			where: (t, { eq }) => eq(t.isSelectable, true),
			orderBy: (t, { asc, desc }) => [desc(t.isImmutable), asc(t.name)]
		})
		const res: Sockets.CompletionTemplates.Options.Response = {
			options: rows.map((r) => ({ value: r.key, label: r.name }))
		}
		emitToUser("completionTemplates:options", res)
		return res
	}
}

/**
 * The fields a client may write, named.
 *
 * ⚠ An ALLOW-list, not a deny-list, and the difference is not stylistic. A
 * deny-list has to be updated every time a column is added, and the failure when
 * it is not is that the new column becomes client-writable in silence —
 * `is_immutable` and `seed_key` are exactly the two that must never be, because
 * one makes a row uneditable and the other makes the boot sync overwrite it. It
 * also keeps a payload carrying keys that are not columns at all out of
 * Drizzle's `.set()`, which does not ignore them.
 *
 * The same posture `import.fieldAllowlist.test.ts` holds for imported entities.
 *
 * `renderMode` is absent on purpose: it is written from a literal at both call
 * sites, never taken from a payload.
 */
const WRITABLE = [
	"key",
	"name",
	"roles",
	"fallbackRole",
	"stopStrings",
	"isSelectable"
] as const

/** The shape a write payload is reduced to before anything looks at it. */
function sanitise(payload: any): Record<string, unknown> {
	const src = (payload ?? {}) as Record<string, unknown>
	const out: Record<string, unknown> = {}
	for (const field of WRITABLE)
		if (src[field] !== undefined) out[field] = src[field]
	return out
}

/**
 * Test seam: the allow-list itself, so a test can assert what it drops rather
 * than infer it from a row that would come out right either way (`is_immutable`
 * already defaults to false, so a written `false` and a dropped `true` are
 * indistinguishable downstream).
 */
export const sanitiseForTest = sanitise

/**
 * The render mode a payload DECLARED — read for validation, never for writing.
 *
 * ⚠ `renderMode` is deliberately outside `WRITABLE`: the column is written from
 * a literal at both call sites. But dropping it silently would turn "you may not
 * author a role-array template" into a silent coercion, and a client that asked
 * for one deserves to be told no. So it is read here, refused by the validator,
 * and still never written.
 */
const declaredRenderMode = (payload: any) =>
	(payload ?? {}).renderMode as string | undefined

/**
 * Is this key already taken?
 *
 * A named refusal rather than letting the UNIQUE index throw: `key` is the
 * foreign-key target every connection stores, so "that name is taken" is a
 * sentence a person can act on and `duplicate key value violates unique
 * constraint` is not.
 */
async function keyTaken(key: string, excludeId?: number) {
	const clash = await db.query.completionTemplates.findFirst({
		where: (t, { eq }) =>
			excludeId == null
				? eq(t.key, key)
				: and(eq(t.key, key), ne(t.id, excludeId))
	})
	return !!clash
}

export const completionTemplatesCreate: Handler<
	Sockets.CompletionTemplates.Create.Params,
	Sockets.CompletionTemplates.Create.Response
> = {
	event: "completionTemplates:create",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		const draft = sanitise(params.completionTemplate)
		const problem = validateCompletionTemplate({
			...draft,
			renderMode: declaredRenderMode(params.completionTemplate)
		})
		if (problem)
			refuse(emitToUser, "completionTemplates:create", problem)

		const key = String(draft.key).trim()
		if (await keyTaken(key))
			refuse(
				emitToUser,
				"completionTemplates:create",
				`A completion template with the key '${key}' already exists. ` +
					`Keys are what connections store, so they have to be unique.`
			)

		const [completionTemplate] = await db
			.insert(schema.completionTemplates)
			.values({
				...draft,
				key,
				// Named rather than left to the spread: the allow-list returns
				// `Record<string, unknown>`, and `name` is the one NOT NULL
				// column with no default. The validator has already established
				// it is a non-empty string.
				name: draft.name as string,
				// Flat, always — never taken from the payload. The validator
				// refuses `role_array` above; this is the second lock, so that a
				// field added to the payload later cannot reach the column by
				// riding the spread.
				renderMode: "flat",
				isImmutable: false,
				seedKey: null
			})
			.returning()
		// Lazy: the admin list this write came from wants the refreshed rows,
		// and nothing else does. See `buildCompletionTemplatesList`.
		await emitToUser("completionTemplates:list", () =>
			buildCompletionTemplatesList()
		)
		const res: Sockets.CompletionTemplates.Create.Response = {
			completionTemplate
		}
		emitToUser("completionTemplates:create", res)
		return res
	}
}

export const completionTemplatesUpdate: Handler<
	Sockets.CompletionTemplates.Update.Params,
	Sockets.CompletionTemplates.Update.Response
> = {
	event: "completionTemplates:update",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		const id = params.completionTemplate.id!
		const patch = sanitise(params.completionTemplate)

		const current = await db.query.completionTemplates.findFirst({
			where: (t, { eq }) => eq(t.id, id)
		})
		if (!current)
			refuse(
				emitToUser,
				"completionTemplates:update",
				"Completion template not found"
			)
		if (current.isImmutable)
			refuse(
				emitToUser,
				"completionTemplates:update",
				"Cannot update a built-in completion template. Clone it to make a variant."
			)

		/**
		 * ⚠ The key does not move.
		 *
		 * It is the target of `connections.prompt_format`'s foreign key, which
		 * is `ON UPDATE no action` — so Postgres refuses the rename outright the
		 * moment one connection references it, and lets it through when none
		 * does. That is a rule whose behaviour depends on who happens to be
		 * pointing at the row, which is the worst kind. Held to "stable" here
		 * instead, in one sentence a person can read.
		 */
		if (patch.key !== undefined && String(patch.key).trim() !== current.key)
			refuse(
				emitToUser,
				"completionTemplates:update",
				`A template's key cannot change once it exists — connections store it, ` +
					`and '${current.key}' is what they are pointing at. Clone this template ` +
					`under the new key and repoint the connections that should follow it.`
			)

		// Validated as the row will BE, not as the patch reads: a save that
		// sends only `roles` must still be checked against the name and key
		// already on the row, or a partial write walks straight past every rule.
		const merged = {
			...current,
			...patch,
			key: current.key,
			renderMode: declaredRenderMode(params.completionTemplate)
		}
		const problem = validateCompletionTemplate(merged)
		if (problem)
			refuse(emitToUser, "completionTemplates:update", problem)

		const [completionTemplate] = await db
			.update(schema.completionTemplates)
			.set({ ...patch, key: current.key, renderMode: "flat" })
			.where(eq(schema.completionTemplates.id, id))
			.returning()
		// Lazy — see `buildCompletionTemplatesList`.
		await emitToUser("completionTemplates:list", () =>
			buildCompletionTemplatesList()
		)
		const res: Sockets.CompletionTemplates.Update.Response = {
			completionTemplate
		}
		emitToUser("completionTemplates:update", res)
		return res
	}
}

export const completionTemplatesDelete: Handler<
	Sockets.CompletionTemplates.Delete.Params,
	Sockets.CompletionTemplates.Delete.Response
> = {
	event: "completionTemplates:delete",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		const current = await db.query.completionTemplates.findFirst({
			where: (t, { eq }) => eq(t.id, params.id)
		})
		if (current?.isImmutable)
			refuse(
				emitToUser,
				"completionTemplates:delete",
				"Cannot delete a built-in completion template."
			)

		/**
		 * Counted BEFORE the delete, because `ON DELETE SET NULL` erases the
		 * evidence — and said out loud, because it is a change to somebody
		 * else's connection. "The template you picked is gone" and "you never
		 * picked one" are different sentences, which is the whole reason the key
		 * nulls rather than cascading.
		 */
		const affected = current
			? await db.query.connections.findMany({
					columns: { id: true },
					where: (c, { eq }) => eq(c.promptFormat, current.key)
				})
			: []

		await db
			.delete(schema.completionTemplates)
			.where(eq(schema.completionTemplates.id, params.id))

		// Lazy — see `buildCompletionTemplatesList`.
		await emitToUser("completionTemplates:list", () =>
			buildCompletionTemplatesList()
		)
		const res: Sockets.CompletionTemplates.Delete.Response = {
			success: affected.length
				? `Completion template deleted. ${affected.length} connection` +
					`${affected.length === 1 ? "" : "s"} had no format left and ` +
					`will render with the default until one is chosen.`
				: "Completion template deleted successfully"
		}
		emitToUser("completionTemplates:delete", res)
		return res
	}
}

export const completionTemplatesClone: Handler<
	Sockets.CompletionTemplates.Clone.Params,
	Sockets.CompletionTemplates.Clone.Response
> = {
	event: "completionTemplates:clone",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		const source = await db.query.completionTemplates.findFirst({
			where: (t, { eq }) => eq(t.id, params.id)
		})
		if (!source)
			refuse(
				emitToUser,
				"completionTemplates:clone",
				"Completion template not found"
			)

		// A free key, derived from the source's so the relationship is legible.
		let key = `${source.key}-copy`
		for (let n = 2; await keyTaken(key); n++) key = `${source.key}-copy-${n}`

		const [completionTemplate] = await db
			.insert(schema.completionTemplates)
			.values({
				key,
				name: `${source.name} (copy)`,
				// The clone is the user's, whatever it was cloned from — this is
				// the whole point of Clone being the way to customise a built-in.
				isImmutable: false,
				seedKey: null,
				/**
				 * ⚠ Flat, even when cloning `split_chat`.
				 *
				 * That row's markers are emitted by hand-written code and its
				 * framing is deliberately EMPTY, so a role-array clone would
				 * carry a mode whose emitter reads nothing from it — and would
				 * be a row an admin could then point a connection at, switching
				 * the whole pipeline to role-array output. It is
				 * `isSelectable: false` and cloning it is not a way around that.
				 */
				renderMode: "flat",
				roles: source.roles,
				fallbackRole: source.fallbackRole,
				stopStrings: source.stopStrings,
				isSelectable: source.isSelectable
			})
			.returning()
		// Lazy — see `buildCompletionTemplatesList`.
		await emitToUser("completionTemplates:list", () =>
			buildCompletionTemplatesList()
		)
		const res: Sockets.CompletionTemplates.Clone.Response = {
			completionTemplate
		}
		emitToUser("completionTemplates:clone", res)
		return res
	}
}

export function registerCompletionTemplateHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, completionTemplatesListHandler, emitToUser)
	register(socket, completionTemplatesGet, emitToUser)
	register(socket, completionTemplatesOptions, emitToUser)
	register(socket, completionTemplatesCreate, emitToUser)
	register(socket, completionTemplatesUpdate, emitToUser)
	register(socket, completionTemplatesDelete, emitToUser)
	register(socket, completionTemplatesClone, emitToUser)
}
