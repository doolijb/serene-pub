import { eq, sql } from "drizzle-orm"
import { S } from "@serene-pub/sdk"
import { db } from "."
import * as schema from "./schema"
import { LOCAL_SERVER_SLUG } from "$lib/shared/constants/Tunnels"
import { modalityOfShape } from "$lib/shared/constants/ConnectionTypes"
import { seedCompletionTemplates } from "./seedCompletionTemplates"

import { getAppDataDir } from "./drizzle.config"
import * as path from "path"
import { backfillMissingBindingNames } from "$lib/server/utils/characterBindingSync"
import { backfillRelationshipHistoryEntries } from "$lib/server/utils/graphBackfill"
import { mergeOllamaEmbeddingsType } from "$lib/server/connections/ollamaMultiModality"
import { foldKoboldCppManagedImage } from "$lib/server/connections/koboldCppManagedFold"
import { refreshConnectionCapabilityCaches } from "$lib/server/connections/resolve"

export async function sync() {
	console.log("Syncing database defaults...")

	try {
		// Sampling Configs

		const existingSamplingConfigs =
			await db.query.samplingConfigs.findMany()

		// ── How seeded rows are identified ────────────────────────────────────
		//
		// Every list in this file is matched on `seedKey`, never on `id`.
		//
		// It used to upsert on a hardcoded `id`, which collides with user rows:
		// seeded ids run 1..N and `resyncIdSequences()` at the bottom of this
		// file sets each sequence to MAX(id), so the first row a user creates
		// takes the very next id a newly added seeded row would claim — and the
		// UPDATE branch silently overwrites it. That is not hypothetical: a
		// "Precise (Extraction)" preset added at sampling_configs id 3
		// overwrote a user's own config on their next boot, and `isImmutable`
		// left the wreckage un-editable in the UI.
		//
		// `seedKey` is NULL for anything a user made, so a user row can never be
		// mistaken for a seed.
		//
		// ADDING A NEW DEFAULT: give it a `seedKey` and **no `id`** — let the
		// sequence assign one. The `id` fields below are retained only because
		// those rows already exist in the wild at those ids; migration 0092
		// backfills their seedKey by (id, name) so they keep matching.
		// `values` states only what DIFFERS from the shape's declared defaults
		// (sdk/src/sampling.ts), which are the same numbers the dropped columns
		// carried. A seed that repeated them would be a second place for the
		// default of every sampler to live, and the two would drift. `enabled` is
		// exhaustive, though — an unlisted key is off, so it has to be written out.
		// The image FAMILY presets below are the one deliberate exception, and
		// they say why on themselves.
		const defaultSamplingConfigs: Partial<SelectSamplingConfig>[] = [
			{
				id: 1, // Only include ID because this is a pre-seeded row before seedKey existed.
				seedKey: "sampling-default",
				name: "Default",
				isImmutable: true,
				shape: S.textGen,
				values: {
					// 8192, not the declared default of 4096. This app front-loads
					// the system block — character cards as JSON, world lore,
					// history, the narrative graph, RAG hits — which is routinely
					// 1.5–3k tokens before a single message, so 4096 spends over
					// half the window before the roleplay starts and truncates
					// within a few exchanges.
					//
					// Not higher, because this value does not mean the same thing
					// on every backend (samplerMappings.ts). KoboldCPP treats it as
					// a per-request cap and clamps it further to the server's
					// true_max_context_length, but Ollama maps it to `num_ctx`,
					// which ALLOCATES KV cache with no clamp. The ceiling is
					// therefore set by the weakest machine that can run local RP at
					// all: an 8GB card holding an 8B at Q4 has ~2.5GB spare, and 8k
					// of KV cache on that model is ~1GB. 16k is the better
					// experience and the wrong default.
					contextTokens: 8192
				},
				enabled: ["temperature", "responseTokens", "contextTokens"]
			},
			{
				id: 2, // Only include ID because this is a pre-seeded row before seedKey existed.
				seedKey: "sampling-disabled",
				name: "Disabled",
				isImmutable: true,
				shape: S.textGen,
				// Nothing enabled: every request goes out with whatever the backend
				// itself defaults to. That is the entire point of this row, and it
				// is now a property you can read at a glance rather than three
				// `*Enabled: false` overrides against a table of defaults.
				values: {},
				enabled: []
			},
			{
				// NO `id` — the sequence assigns one. This is the first default
				// added since seedKey landed, and it is precisely the shape that
				// caused the incident described above: an extraction preset
				// appended at a hardcoded id 3, which was a real user's own
				// config.
				seedKey: "sampling-precise-extraction",
				name: "Precise (Extraction)",
				isImmutable: true,
				shape: S.textGen,
				// For structured extraction — graph relationship passes, scene
				// cast, summarisation — not for roleplay. Measured against a
				// roleplay-finetuned 26B on the narrative graph build: with the
				// creative defaults the model answered in prose roughly 45% of
				// the time and 22 of 28 relationships were discarded; with these
				// values plus constrained decoding it was 28-30 kept and 0-1
				// discarded.
				values: {
					temperature: 0.2,
					topP: 0.9,
					topK: 20,
					// Extraction reads a scene and emits a small object; it needs
					// room to read, not to write.
					contextTokens: 8192,
					responseTokens: 1024
				},
				// The creative-writing samplers stay off — and now that is visible
				// as their absence rather than as explicit `false`s. XTC
				// deliberately drops high-probability tokens and DRY penalises
				// repeated strings; both are actively harmful when the wanted
				// output is a rigid, repetitive JSON shape with a fixed key order.
				//
				// `reasoning` is ON and resolves to the shape's declared `off`, per
				// the `values` rule above: a reasoning trace before a structured
				// answer is spent out of the same response budget the answer needs,
				// and a schema on the wire leaves nothing for it to help with.
				enabled: [
					"temperature",
					"topP",
					"topK",
					"contextTokens",
					"responseTokens",
					"reasoning"
				]
			},
			{
				// For stages nobody reads: planning, state keeping, summaries.
				//
				// Precise (Extraction)'s numbers, under a name that says WHEN to
				// reach for it rather than what it does. The two are deliberately
				// separate rows carrying the same values: an extraction pass and a
				// background stage want the same settings today and are not the
				// same decision, so retuning one must not retune the other. There
				// is no `description` column on this table, which is why the
				// sentence is here.
				//
				// NO `id`, per the rule above — the sequence assigns one.
				seedKey: "sampling-background",
				name: "Background",
				isImmutable: true,
				shape: S.textGen,
				values: {
					temperature: 0.2,
					topP: 0.9,
					topK: 20,
					contextTokens: 8192,
					responseTokens: 1024
				},
				// `reasoning` resolves to the declared `off`. It is the whole
				// reason this row exists beside the instance default: a stage
				// whose output is read by the next node and by nobody else pays
				// for a reasoning trace out of the same response budget, and
				// nothing downstream is any better for it.
				enabled: [
					"temperature",
					"topP",
					"topK",
					"contextTokens",
					"responseTokens",
					"reasoning"
				]
			},
			// ── Image presets: one per MODEL FAMILY ───────────────────────────
			//
			// There used to be one image row, "Default (Image)", holding `values:
			// {}` — i.e. the shape's declared defaults of 1024², 25 steps, CFG 5.
			// Those numbers describe SDXL. Most of what this app's own Recommended
			// list offers is SD1.5-class or distilled, and the mismatch does not
			// degrade gracefully: an SD1.5-class model rendered at 1024 duplicates
			// and smears the subject, and a distilled model at CFG 5 burns. A user
			// reported exactly that — melted, duplicated output from
			// sdxs-512-tinySDdistilled, a 512-native distilled model.
			//
			// So one preset per family, and SD 1.5 is the shipped default: 512²
			// avoids the worst failure mode outright, SDXL at 512 is merely soft
			// rather than broken, and CFG 7 is right for the largest share of local
			// models. The reverse — SDXL's numbers as the default — is the state
			// being repaired.
			//
			// ALL FOUR NUMBERS ARE STATED on every preset, including where one
			// happens to equal the shape's declared default. A family preset is a
			// MATCHED SET; leaving a member implicit invites the next reader to
			// half-copy it, and the declared defaults are precisely the values
			// under repair here. This is the one place in this file that
			// deliberately restates a declared default (see the note above about
			// `values` stating only what differs) — do not "tidy" them back out.
			//
			// Sampler and scheduler stay unset on every one of them — the valid
			// names are a property of the connection's checkpoint and build, so the
			// only backend-independent answer is "whatever it already uses".
			//
			// And there is deliberately NO hosted/"DALL·E" sixth row. These are
			// LOCAL-DIFFUSION families. A hosted image service has no sampling
			// knobs to preset — gpt-image-1 takes a `size` enum, `quality`,
			// `background` and `n`, with no steps, CFG, sampler or seed — so what
			// it offers belongs on its CONNECTION as the adapter's `profileSchema`,
			// and what it cannot honour is reported through `applied`/`ignored`.
			// See the SDK's imageSamplingSchema doc comment.
			{
				// Retargeted in place, NOT replaced. This row was "Default
				// (Image)"; it still holds the instance's `text->image` sampling
				// default (resolved by this seedKey near the bottom of this file)
				// and may be named by a pipeline node or a session override. A new
				// seedKey plus a delete would strand every one of those pointers,
				// so the same row simply becomes the SD 1.5 preset — nothing is
				// deleted, no id moves, and the registration code needs no change.
				//
				// The visible cost is accepted: a deliberate SDXL user who left the
				// default selected drops from 1024² to 512² and has to pick the
				// SDXL preset. That is a release note, not a data loss, and it is
				// the direction that protects the user who does not know to look.
				seedKey: "sampling-image-default",
				name: "SD 1.5",
				isImmutable: true,
				shape: S.imageGen,
				values: { steps: 25, cfg: 7, width: 512, height: 512 },
				enabled: ["steps", "cfg", "width", "height", "batch", "seed"]
			},
			{
				// What the old declared defaults were actually describing, now
				// stated as the family it belongs to rather than as "the default".
				seedKey: "sampling-image-sdxl",
				name: "SDXL",
				isImmutable: true,
				shape: S.imageGen,
				values: { steps: 30, cfg: 6, width: 1024, height: 1024 },
				enabled: ["steps", "cfg", "width", "height", "batch", "seed"]
			},
			{
				// SD 3.x wants noticeably less guidance than SDXL; 4.5 is the
				// middle of the range these models are tuned around.
				seedKey: "sampling-image-sd3",
				name: "SD 3.x",
				isImmutable: true,
				shape: S.imageGen,
				values: { steps: 28, cfg: 4.5, width: 1024, height: 1024 },
				enabled: ["steps", "cfg", "width", "height", "batch", "seed"]
			},
			{
				// ⚠ CFG 1 IS CORRECT AND IS NOT A PLACEHOLDER. Flux is
				// guidance-distilled: the guidance signal is baked into the model,
				// so classifier-free guidance is applied on top of it. Raising this
				// to a "normal" 5-7 burns the image out — blown highlights,
				// posterised colour. Leave it at 1.
				seedKey: "sampling-image-flux",
				name: "Flux",
				isImmutable: true,
				shape: S.imageGen,
				values: { steps: 20, cfg: 1, width: 1024, height: 1024 },
				enabled: ["steps", "cfg", "width", "height", "batch", "seed"]
			},
			{
				// SDXS, SD-Turbo, SDXL-Turbo, Lightning and LCM — the step-distilled
				// families, and where the reported bug came from. They are trained
				// to converge in a handful of steps, so 25 is wasted time and, past
				// their trained step count, actively worse.
				//
				// ⚠ CFG 1 IS CORRECT HERE TOO, for the same reason as Flux: these
				// are guidance-distilled, and raising CFG burns them. 512² because
				// this family is overwhelmingly SD1.5-class; the one detail that
				// separates SDXL-Turbo out is handled by picking the SDXL preset and
				// dropping its steps.
				seedKey: "sampling-image-turbo",
				name: "Turbo / Distilled",
				isImmutable: true,
				shape: S.imageGen,
				values: { steps: 4, cfg: 1, width: 512, height: 512 },
				enabled: ["steps", "cfg", "width", "height", "batch", "seed"]
			}
		]

		// ── A seed YIELDS a colliding name to the user ────────────────────────
		//
		// 0179 made `name` unique per modality, and this list is where that
		// constraint is most likely to bite: the five image presets ship under
		// names ("SD 1.5", "Flux") a person may well have already given a config
		// of their own, and "Default" has always been an obvious thing to type.
		//
		// A rejected write here is not a local failure. The insert/update runs
		// inside the one try block above, so a unique violation aborts the rest of
		// it — completion templates and the admin user never seed. That exact
		// cascade is documented a few dozen lines down; this is a second route
		// into it.
		//
		// The SEED moves, never the user's row. Their name is theirs, and a
		// built-in is identified by `seedKey` no matter what it is called — so the
		// cost of yielding is a suffix on a row the app owns, against silently
		// renaming a row the user owns.
		//
		// Computed SERIALLY here, before the queries below are handed to
		// Promise.all: it reads the snapshot taken above, so nothing in it may
		// depend on another seed's write having landed.
		const nameKey = (shape: string | null | undefined, name: string) =>
			// `.trim()` is very slightly wider than SQL `btrim`'s spaces-only
			// default (it also strips tabs and newlines). Wider is the safe
			// direction: it can only make a seed yield a name the database would
			// have accepted, never let a collision through to a raw violation.
			`${modalityOfShape(shape)}/${name.trim().toLowerCase()}`

		// Rows this pass is about to rewrite are excluded: a seed does not have
		// to yield to the name it already holds.
		const seededSamplingKeys = new Set(
			defaultSamplingConfigs.map((d) => d.seedKey)
		)
		const takenSamplingNames = new Set(
			existingSamplingConfigs
				.filter((c) => !seededSamplingKeys.has(c.seedKey))
				.map((c) => nameKey(c.shape, c.name))
		)
		for (const data of defaultSamplingConfigs) {
			const wanted = data.name!
			let name = wanted
			let taken = 0
			while (takenSamplingNames.has(nameKey(data.shape, name))) {
				taken++
				name =
					taken === 1
						? `${wanted} (Built-in)`
						: `${wanted} (Built-in ${taken})`
			}
			data.name = name
			takenSamplingNames.add(nameKey(data.shape, name))
		}

		// This list mixes rows that carry an explicit legacy `id` with rows that
		// let the sequence assign one, and Postgres does NOT advance a sequence
		// when a row is inserted with an explicit id. On a brand-new database
		// the sequence therefore still sits at 1 after "Default" (id 1) and
		// "Disabled" (id 2) are inserted, so the first sequence-assigned row
		// asks for id 1 and dies on the primary key.
		//
		// That failure aborts this entire try block, so nothing after it — the
		// completion templates, the admin user and their settings row — is
		// seeded, and a fresh install comes up broken.
		//
		// GREATEST(...) so this only ever raises the sequence: on an existing
		// install MAX(id) is already past the seeded ids and nothing moves.
		// resyncIdSequences() at the bottom of this file does the same job, but
		// it runs after seeding and so never got the chance.
		const maxSeededSamplingId = defaultSamplingConfigs.reduce(
			(max, c) => (typeof c.id === "number" && c.id > max ? c.id : max),
			0
		)
		if (maxSeededSamplingId > 0) {
			await db.execute(`
				SELECT setval(
					pg_get_serial_sequence('sampling_configs', 'id'),
					GREATEST(
						(SELECT COALESCE(MAX(id), 0) FROM sampling_configs),
						${maxSeededSamplingId}
					)
				);
			`)
		}

		const samplingConfigQueries: Promise<any>[] = []

		defaultSamplingConfigs.forEach((data) => {
			const found = existingSamplingConfigs.find(
				(c) => c.seedKey === data.seedKey
			)

			if (!found) {
				samplingConfigQueries.push(
					db
						.insert(schema.samplingConfigs)
						.values(data as InsertSamplingConfig)
				)
			} else {
				samplingConfigQueries.push(
					db
						.update(schema.samplingConfigs)
						.set({
							...data,
							// @ts-ignore
							id: undefined
						})
						.where(eq(schema.samplingConfigs.id, found.id))
				)
			}
		})

		await Promise.all(samplingConfigQueries)

		// Completion Templates — see ./seedCompletionTemplates.ts.
		await seedCompletionTemplates(db)

		// Users

		const existingUsers = await db.query.users.findMany()

		const defaultUsers: Partial<SelectUser>[] = [
			{
				id: 1,
				seedKey: "user-admin",
				username: "admin",
				isAdmin: true
			}
		]

		const userQueries: Promise<any>[] = []

		defaultUsers.forEach((data) => {
			const found = existingUsers.find((c) => c.seedKey === data.seedKey)

			if (!found) {
				userQueries.push(
					db.insert(schema.users).values(data as InsertUser)
				)
			} else {
				// userQueries.push(
				//     db.update(schema.users).set({
				//         ...data,
				//         // @ts-ignore
				//         id: undefined,
				//     }).where(eq(schema.users.id, found.id))
				// )
			}
		})

		await Promise.all(userQueries)

		// Ensure user 1 has a userSettings row. No connection is set — that's
		// the wizard's job on first run.
		await db
			.insert(schema.userSettings)
			.values({ userId: 1 })
			.onConflictDoNothing()
	} catch (error) {
		console.error("Error syncing database defaults:", error)
	}

	// One-off backfill: bound lorebookBindings rows that never went through
	// characterBindingSync (e.g. lorebook import before that path called it —
	// see restoreBoundEntities) are left with a permanently NULL name,
	// falling through to the raw {{char:N}} token everywhere a binding's
	// name is displayed. Naturally idempotent and cheap after the first
	// run: once the import path syncs on insert, this matches nothing on
	// every subsequent boot.
	//
	// `db` is passed explicitly and MUST stay that way — it is not a
	// redundant argument. sync() runs at module scope of db/index.ts (its
	// `await sync()`), so this executes while that module is still
	// evaluating. Omitting the instance makes characterBindingSync fall back
	// to its `defaultDb()`, which does `await import("$lib/server/db")` —
	// re-entering the very module we are suspended inside. Unbundled ESM
	// tolerates that (it hands back the partial namespace, and `db` is
	// already assigned by then), but Rollup emits the chunk's namespace
	// object as a `const` AFTER the module body, so the same call throws
	// `ReferenceError: Cannot access 'index' before initialization` in a
	// packaged build — silently skipping this repair on every startup.
	// `db` is demonstrably live here: sync() has already queried through it
	// dozens of times above, and does so again immediately below.
	try {
		await backfillMissingBindingNames(db)
	} catch (error) {
		console.error("Error backfilling lorebook binding names:", error)
	}

	try {
		// One Ollama connection per host serves every modality it has (owner
		// ruling 2026-09-25): old `ollama-embeddings` rows are renamed onto
		// `ollama` in place, and every Ollama row's capability cache learns it
		// can embed. Here rather than in a migration because the cache is
		// derived from the manifest in TypeScript — and the 2026-09-06 ruling
		// puts anything that must persist through this sync. Idempotent; a
		// settled install does no writes. `db` passed in, like the two above,
		// for the packaged-build reason given there.
		await mergeOllamaEmbeddingsType(db)
	} catch (error) {
		console.error("Error merging Ollama embeddings connections:", error)
	}

	try {
		// Managed KoboldCPP image connections fold into THE managed endpoint —
		// one process, one row that chats and draws. References are repointed
		// before anything is deleted (see the module header). BEFORE the cache
		// refresh, so a renamed row resolves as the type it now is. `db`
		// passed in for the packaged-build reason given above.
		const { folded, renamed } = await foldKoboldCppManagedImage(db)
		if (folded || renamed)
			console.log(
				`[connections] Folded ${folded} managed KoboldCPP image connection(s) into the managed endpoint; renamed ${renamed} in place.`
			)
	} catch (error) {
		console.error("Error folding managed KoboldCPP image connections:", error)
	}

	try {
		// Every connection's cached capabilities, rebuilt from the CURRENT
		// manifest. Nothing did this on load before, so a capability added to
		// the manifest never reached an existing row in the picker. AFTER the
		// Ollama rename, so a renamed row resolves as the type it now is.
		// Idempotent; a settled install writes nothing.
		const { refreshed } = await refreshConnectionCapabilityCaches(db)
		if (refreshed)
			console.log(
				`[connections] Refreshed ${refreshed} connection capability cache(s) from the manifest.`
			)
	} catch (error) {
		console.error("Error refreshing connection capability caches:", error)
	}

	try {
		await backfillRelationshipHistoryEntries(db)
	} catch (error) {
		console.error("Error backfilling relationship history entries:", error)
	}

	try {
		const res = await db.query.systemSettings.findFirst({
			where: (s, { eq }) => eq(s.id, 1)
		})
		if (!res) {
			// The instance defaults are `connection_defaults` rows, seeded by
			// seedKey at the bottom of this block — never a hardcoded id here.
			await db.insert(schema.systemSettings).values({ id: 1 })
		}
		// ── the instance's seeded sampling defaults ──────────────────────
		//
		// **Sampling defaults may be seeded; connection defaults NEVER.** That is
		// the general rule, and the image block this generalises already argued
		// it for one capability: a sampling config is a shipped row this app
		// wrote and can point at safely, while a connection is a thing only a
		// person can add — so a capability with no connection must read as "not
		// set up" rather than as a pointer to nothing. Seeding one would also
		// re-create the auto-star by the back door, which is the behaviour the
		// no-implicit-pickup ruling exists to delete.
		//
		// By seedKey, never by id, for the reason the whole file is: nothing
		// guarantees a seeded row is at a predictable id on an install that
		// already has user configs of its own. It is also why the image family
		// presets cost this nothing — `sampling-image-default` is now the SD 1.5
		// preset, RETARGETED in place rather than replaced, so the shipped image
		// default follows the seedKey with not a line changing here. Had that row
		// been deleted and a `sampling-image-sd15` added beside the others, the
		// lookup would come back undefined and take the instance's image default
		// with it.
		//
		// Registered on every boot while unset, so an install that arrives after
		// the migration — or one whose default was cleared by its row being
		// deleted (`connection_defaults.sampling_config_id` is ON DELETE SET
		// NULL) — picks the seeded config back up.
		const SEEDED_SAMPLING_DEFAULTS: Record<string, string> = {
			"text->text": "sampling-default",
			"text->image": "sampling-image-default"
		}
		const { capabilityDefault, setCapabilityDefault } = await import(
			"$lib/server/connections/capabilityDefaults"
		)
		for (const [capability, seedKey] of Object.entries(
			SEEDED_SAMPLING_DEFAULTS
		)) {
			const seeded = await db.query.samplingConfigs.findFirst({
				where: (c, { eq }) => eq(c.seedKey, seedKey)
			})
			if (!seeded) continue
			// Only on a TRUE first run — no row for this capability at all.
			//
			// This used to seed whenever the sampling half was null, which cannot
			// tell "the user cleared this deliberately" from "the row it pointed
			// at was deleted and cascaded to NULL". So every boot put the shipped
			// config back, and a person who had deliberately cleared it watched it
			// return each restart with nothing on screen to explain why.
			//
			// Not resurrecting is also what the no-implicit-pickup ruling asks
			// for: nothing is selected unless somebody set it, and a null sampling
			// is not a failure — `resolveSampling(null)` means "let the backend
			// use its own defaults", which is a legitimate thing to want.
			const existing = await capabilityDefault(db, capability)
			if (existing === undefined)
				await setCapabilityDefault(db, capability, {
					samplingConfigId: seeded.id
				})
		}
	} catch (error) {
		console.error("Error syncing system settings:", error)
	}

	try {
		const ollamaRes = await db.query.ollamaSettings.findFirst({
			where: (s, { eq }) => eq(s.id, 1)
		})
		if (!ollamaRes) {
			await db.insert(schema.ollamaSettings).values({ id: 1 })
		}
	} catch (error) {
		console.error("Error syncing ollama settings:", error)
	}

	try {
		// KOBOLDCPP_BINARY_DIR / KOBOLDCPP_BINARY_NAME let a Docker deployment (or
		// any deployment) point managed mode at a binary directory/file without
		// using the in-app downloader — documented in DOCKER.md, but previously
		// never actually read anywhere. Only seed when unset so an already-working
		// setup (downloaded via the manager, or configured before this existed)
		// is never silently overridden by a stray env var.
		const envBinaryDir = process.env.KOBOLDCPP_BINARY_DIR
		const envBinaryName = process.env.KOBOLDCPP_BINARY_NAME

		const kcppRes = await db.query.koboldCppSettings.findFirst({
			where: (s, { eq }) => eq(s.id, 1)
		})
		if (!kcppRes) {
			await db.insert(schema.koboldCppSettings).values({
				id: 1,
				koboldCppManagerModelsDir: path.join(
					getAppDataDir(),
					"models",
					"llm"
				),
				// A sibling of models/llm, seeded on a FRESH install only —
				// Stable-Diffusion models do not belong under "llm", and the
				// layout always had room for this.
				koboldCppImageModelsDir: path.join(
					getAppDataDir(),
					"models",
					"image"
				),
				...(envBinaryDir
					? { koboldCppManagedBinaryDir: envBinaryDir }
					: {}),
				...(envBinaryDir && envBinaryName
					? { koboldCppManagedBinaryVariant: envBinaryName }
					: {})
			})
		} else {
			const patch: Partial<typeof kcppRes> = {}
			if (!kcppRes.koboldCppManagerModelsDir) {
				patch.koboldCppManagerModelsDir = path.join(
					getAppDataDir(),
					"models",
					"llm"
				)
			}
			// koboldCppImageModelsDir is deliberately NOT backfilled here, and
			// this pattern must not be extended to it. NULL means "use the text
			// directory" (modelsDir.ts); filling it in would split a working
			// install in half — new downloads landing in models/image while
			// every model the user actually owns sits in models/llm, and a
			// directory on the Settings tab they never chose.
			if (!kcppRes.koboldCppManagedBinaryDir && envBinaryDir) {
				patch.koboldCppManagedBinaryDir = envBinaryDir
			}
			if (
				!kcppRes.koboldCppManagedBinaryVariant &&
				envBinaryDir &&
				envBinaryName
			) {
				patch.koboldCppManagedBinaryVariant = envBinaryName
			}
			if (Object.keys(patch).length > 0) {
				await db
					.update(schema.koboldCppSettings)
					.set(patch)
					.where(eq(schema.koboldCppSettings.id, 1))
			}
		}
	} catch (error) {
		console.error("Error syncing koboldcpp settings:", error)
	}

	try {
		// Servers (plan 26 §2)
		//
		// The instance's own network identity — a stable anchor for
		// instance-scoped, non-model-service settings (tunnels). Exactly one
		// row, seeded here.
		//
		// Matched on `slug`, never on `id`, per the seedKey rule documented at
		// the top of this file: a hardcoded id collides with whatever the
		// sequence hands the first user-created row. `servers` has no
		// user-created rows today, but the rule holds regardless — it costs
		// nothing here and removes the trap if that ever changes.
		const existingLocalServer = await db.query.servers.findFirst({
			where: eq(schema.servers.slug, LOCAL_SERVER_SLUG)
		})
		if (!existingLocalServer) {
			await db.insert(schema.servers).values({
				slug: LOCAL_SERVER_SLUG,
				name: "This pub",
				isSeeded: true
			})
		} else if (!existingLocalServer.isSeeded) {
			// Repair, not overwrite: isSeeded is what stops the row being
			// deleted, so a row that lost the flag would become deletable and
			// take its tunnels with it (FK cascade). Name stays whatever the
			// admin set.
			await db
				.update(schema.servers)
				.set({ isSeeded: true })
				.where(eq(schema.servers.id, existingLocalServer.id))
		}
	} catch (error) {
		console.error("Error syncing servers:", error)
	}

	const tables = [
		"session_messages",
		"sessions",
		"characters",
		"connections",
		"lorebooks",
		"lorebook_bindings",
		// ⚠ No `personas`: migration 0133 (`merge_personas_into_characters`,
		// the personas → characters lane) folded the table into `characters`,
		// and naming a relation that does not exist fails the sequence reset
		// — and with it every boot and every test database — at this line.
		// That lane's change, kept here because the list is shared.
		"sampling_configs",
		"users"
	]

	const queries: Promise<any>[] = []
	tables.map((table) => {
		queries.push(
			db.execute(`
				SELECT setval(
					pg_get_serial_sequence('${table}', 'id'),
					(SELECT MAX(id) FROM ${table})
				);
			`)
		)
	})

	await Promise.all(queries)
}
