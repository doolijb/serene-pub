import { relations, sql } from "drizzle-orm"
import {
	pgTable,
	integer,
	bigint,
	text,
	real,
	boolean,
	uniqueIndex,
	index,
	json,
	date,
	type AnyPgColumn,
	numeric,
	timestamp,
	varchar,
	uuid,
	check,
	primaryKey
} from "drizzle-orm/pg-core"

// ─── Enumerated value types ───────────────────────────────────────────────────

export type NodeState = "active" | "deceased" | "missing" | "departed"
export type NodeVisibility = "normal" | "legendary" | "hidden"
export type RelationshipVisibility = "secret" | "acknowledged" | "public"
import { GroupReplyStrategies } from "../../shared/constants/GroupReplyStrategies"
import { SessionCharacterVisibility } from "../../shared/constants/SessionCharacterVisibility"
import { SessionTypes } from "../../shared/constants/SessionTypes"
import type {
	TunnelMode,
	TunnelProvider,
	TunnelStatus
} from "../../shared/constants/Tunnels"

export const users = pgTable(
	"users",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** Stable seed identity, e.g. "sampling-default". NULL for user-created
		 *  rows — see db/defaults.ts for why matching on id was unsafe. */
		seedKey: text("seed_key").unique(),
		username: text("username").notNull(),
		displayName: text("display_name"),
		theme: text("theme").notNull().default("hamlindigo"), // Remove next
		darkMode: boolean("dark_mode").notNull().default(true), // Remove next
		isAdmin: boolean("is_admin").notNull().default(false),
		/**
		 * When this account last completed a sign-in. NULL means it never has.
		 *
		 * Load-bearing rather than informational: an account cannot be made an
		 * admin until it has been signed into at least once (27 §5). A
		 * freshly-created or invited account is an unproven claim about who
		 * holds it — granting it admin before anyone has demonstrated they can
		 * actually get in means a mistyped username or an intercepted invite
		 * hands over the instance.
		 */
		lastLoginAt: timestamp("last_login_at"),
		isDeleted: boolean("is_deleted").notNull().default(false),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: date("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => sql`(CURRENT_TIMESTAMP)`)
	},
	(t) => [
		// Without this, a check-then-insert race in users.ts's create handler
		// could let two concurrent signups with the same username both
		// succeed, after which username-keyed lookups (login, auth) resolve
		// nondeterministically.
		uniqueIndex("users_username_unique").on(t.username)
	]
)

export const userRelations = relations(users, ({ many, one }) => ({
	lorebooks: many(lorebooks),
	characters: many(characters),
	sessions: many(sessions),
	sessionGuests: many(sessionGuests),
	tags: many(tags),
	personas: many(personas),
	userSettings: one(userSettings),
	passphrases: many(passphrases)
}))

export const userSettings = pgTable(
	"user_settings",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		activeContextConfigId: integer("active_context_config_id").references(
			() => contextConfigs.id,
			{
				onDelete: "set null"
			}
		),
		activePromptConfigId: integer("active_prompt_config_id").references(
			() => promptConfigs.id,
			{
				onDelete: "set null"
			}
		),
		activeNarratorPromptConfigId: integer(
			"active_narrator_prompt_config_id"
		).references(() => narratorPromptConfigs.id, {
			onDelete: "set null"
		}),
		activeSummarizeWorldConfigId: integer(
			"active_summarize_world_config_id"
		).references(() => worldSummarizeConfigs.id, { onDelete: "set null" }),
		activeSummarizeCharacterConfigId: integer(
			"active_summarize_character_config_id"
		).references(() => characterSummarizeConfigs.id, {
			onDelete: "set null"
		}),
		activeSummarizeSceneConfigId: integer(
			"active_summarize_scene_config_id"
		).references(() => sceneSummarizeConfigs.id, { onDelete: "set null" }),
		theme: text("theme").notNull().default("hamlindigo"),
		darkMode: boolean("dark_mode").notNull().default(true),
		showHomePageBanner: boolean("show_home_page_banner").default(true),
		enableEasyPersonaCreation: boolean("enable_easy_persona_creation")
			.notNull()
			.default(true),
		enableEasyCharacterCreation: boolean("enable_easy_character_creation")
			.notNull()
			.default(true),
		showAllCharacterFields: boolean("show_all_character_fields")
			.notNull()
			.default(false),
		/**
		 * A *shipped* default background — `/backgrounds/defaults/x.webp`, a
		 * static asset, not user data. Survives 28: there is nothing to move
		 * into `media`, because these files ship with the app and belong to no
		 * user.
		 */
		backgroundImagePath: text("background_image_path"),
		/**
		 * An *uploaded* background — a role, expressed as a pointer at `media`.
		 * Plain integer, not an FK: see the note on `media`.
		 *
		 * At most one of this and `backgroundImagePath` is set; this one wins
		 * when both are, and setting either clears the other.
		 */
		backgroundMediaId: integer("background_media_id"),
		backgroundOpacity: integer("background_opacity").notNull().default(75),
		// Personal viewing preference — independent of who owns the underlying
		// CharaVault account (a single admin-configured, instance-wide
		// credential; see systemSettings.charaVaultEmail). Only has any effect
		// when ENABLE_UNSAFE_CHARACTER_BROWSING is set.
		charaVaultIncludeNsfw: boolean("chara_vault_include_nsfw")
			.notNull()
			.default(false),
		/**
		 * Off means never keep a derived form on disk — re-derive on every
		 * request (0182).
		 *
		 * The display form is NOT a derived form for this purpose. It is the
		 * default client-side representation of a file and is never culled; only
		 * `variants.cache` rows answer to this setting.
		 */
		derivedMediaCacheEnabled: boolean("derived_media_cache_enabled")
			.notNull()
			.default(true),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: date("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => sql`(CURRENT_TIMESTAMP)`)
	},
	(table) => [uniqueIndex("user_settings_user_id_unique").on(table.userId)]
)

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
	user: one(users, {
		fields: [userSettings.userId],
		references: [users.id]
	}),
	activeContextConfig: one(contextConfigs, {
		fields: [userSettings.activeContextConfigId],
		references: [contextConfigs.id]
	}),
	activePromptConfig: one(promptConfigs, {
		fields: [userSettings.activePromptConfigId],
		references: [promptConfigs.id]
	}),
	activeNarratorPromptConfig: one(narratorPromptConfigs, {
		fields: [userSettings.activeNarratorPromptConfigId],
		references: [narratorPromptConfigs.id]
	}),
	activeSummarizeWorldConfig: one(worldSummarizeConfigs, {
		fields: [userSettings.activeSummarizeWorldConfigId],
		references: [worldSummarizeConfigs.id]
	}),
	activeSummarizeCharacterConfig: one(characterSummarizeConfigs, {
		fields: [userSettings.activeSummarizeCharacterConfigId],
		references: [characterSummarizeConfigs.id]
	}),
	activeSummarizeSceneConfig: one(sceneSummarizeConfigs, {
		fields: [userSettings.activeSummarizeSceneConfigId],
		references: [sceneSummarizeConfigs.id]
	})
}))

export const passphrases = pgTable(
	"passphrases",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		hash: text("hash").notNull(),
		salt: varchar("salt", { length: 512 }).notNull(),
		iterations: numeric("iterations").notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		invalidatedAt: timestamp("invalidated_at")
	},
	(t) => [uniqueIndex("unique_user_passphrases").on(t.userId)]
)

export const passphrasesRelations = relations(passphrases, ({ one }) => ({
	user: one(users, {
		fields: [passphrases.userId],
		references: [users.id]
	})
}))

export const userTokens = pgTable("user_tokens", {
	id: uuid("id")
		.primaryKey()
		.default(sql`(gen_random_uuid ())`),
	// Nullable: onDelete "set null" on a notNull column is a contradiction
	// Postgres can't actually satisfy — it would throw the moment the
	// cascade fired on a real hard delete. In practice usersDelete deletes
	// these rows outright (see users.ts) rather than relying on this FK, but
	// the constraint itself still needs to be satisfiable.
	userId: integer("user_id").references(() => users.id, {
		onDelete: "set null"
	}),
	token: text("token").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	expiresAt: timestamp("expires_at").notNull(),
	browser: varchar("browser", { length: 256 }).notNull(),
	os: varchar("os", { length: 256 }).notNull(),
	/**
	 * When this session cleared the second factor (26 §10). NULL means it has
	 * not — for a user with TOTP enabled, that is "authenticated by password
	 * but not yet fully authenticated".
	 *
	 * No token reissuance is needed on verification: the PASETO cookie only
	 * ever carried a reference to this row, never session state, so the row is
	 * the single place the fact needs to live.
	 *
	 * A timestamp rather than a boolean on purpose — it is what makes step-up
	 * re-authentication possible later (a sensitive action requiring a *fresh*
	 * verification, not "logged in at some point") without a schema change.
	 */
	mfaVerifiedAt: timestamp("mfa_verified_at")
})

export const usersTokenRelations = relations(userTokens, ({ many, one }) => ({
	user: one(users, {
		fields: [userTokens.userId],
		references: [users.id]
	})
}))

export const samplingConfigs = pgTable(
	"sampling_configs",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** Stable seed identity, e.g. "sampling-default". NULL for user-created
		 *  rows — see db/defaults.ts for why matching on id was unsafe. */
		seedKey: text("seed_key").unique(),
		name: text("name").notNull(), // Name for this sampling config (for selection)
		isImmutable: boolean("is_immutable").notNull().default(false), // Is this the built-in config? Then we don't want to allow mutation/deletion

		/**
		 * Which vocabulary this config speaks — the same shape id the provider that
		 * consumes it declares (`S.textGen`, `S.imageGen`). It is what makes a config
		 * safe to offer for a slot: a picker filters by it, so an image node is never
		 * shown a config full of text samplers.
		 */
		shape: text("shape").notNull().default("core:shape/text-gen@1"),

		/**
		 * The parameters, keyed by the camelCase names the adapters' key maps use.
		 *
		 * Deliberately not typed columns (0171): thirty of them could only ever name
		 * text samplers, so a second modality meant either a second table or a wall of
		 * nulls. Keys the shape does not declare are kept here rather than rejected —
		 * a row written by a newer build, or a UI-only flag like `contextTokensUnlocked`,
		 * round-trips intact. `resolveSamplingValues` is what keeps them off the wire.
		 */
		values: json("values")
			.notNull()
			.default({})
			.$type<Record<string, unknown>>(),

		/**
		 * Which keys are actually in play. A value with its key absent from here is
		 * remembered but not sent, which is what lets a sampler be switched off and
		 * back on without losing what it was set to.
		 */
		enabled: json("enabled").notNull().default([]).$type<string[]>()
	},
	(t) => [
		/**
		 * A name is unique WITHIN A MODALITY, not globally (0179).
		 *
		 * "Default" is a fair name for a text preset and for an image one, and
		 * forcing them apart would make the built-ins read like workarounds. Two
		 * image configs both called "Default (Image)" is the case worth refusing:
		 * every picker in the app shows a config by name alone, so the person
		 * choosing one cannot tell them apart, and users clone configs constantly.
		 *
		 * MODALITY IS PARSED FROM `shape`, not stored. A column would be a second
		 * source of truth on a row that already answers the question, and a CASE
		 * mapping would be a second copy that drifts. `split_part` is the exact
		 * inverse of `shapeOfModality()` (shared/constants/ConnectionTypes.ts),
		 * which builds `core:shape/<modality>@<version>` from a template — so the
		 * grammar this relies on is asserted by the code that writes it. Version
		 * tolerant: `@2` buckets with `@1`. An unknown plugin shape buckets into
		 * its own namespace, which is the safe direction.
		 *
		 * ⚠ Nothing here touches `CapabilityId`. A modality is a coarse filing
		 * category and a capability set is what a connection can do; this codebase
		 * has already been burned making one scalar carry both.
		 *
		 * `lower` because "Default" and "default" are one name to a person.
		 * `btrim` because NewNameModal's zod trims for VALIDATION and then hands
		 * `onConfirm` the untrimmed string, so " Default" reaches the table intact.
		 *
		 * ⚠ These two expressions are duplicated verbatim in the migration's
		 * de-duplication pass. If one is edited, the other must be — a partition
		 * that does not match the index groups rows differently, and CREATE INDEX
		 * then fails on exactly the installs that needed the repair.
		 */
		uniqueIndex("sampling_configs_modality_name_unique").on(
			sql`split_part(split_part(${t.shape}, '/', 2), '@', 1)`,
			sql`lower(btrim(${t.name}))`
		)
	]
)

export const samplingRelations = relations(samplingConfigs, () => ({}))

export const connections = pgTable("connections", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	name: text("name").notNull(), // Connection name (e.g., ollama, llama, sessiongpt)
	type: text("type").notNull(), // Connection type/category (e.g., ollama, sessiongpt, etc)
	/**
	 * What kind of model sits behind this connection (20 §14):
	 * `text-gen | embeddings | image-gen | ner | tts | …` — an open vocabulary
	 * whose contract is the SDK's connection *shapes* (`S.textGen`,
	 * `S.embeddings`). A provider node's declared shape filters the picker and
	 * the binding refuses a mismatch (F17), so a text node can only ever bind
	 * a text connection.
	 */
	modality: text("modality").notNull().default("text-gen"),
	/**
	 * What this connection can actually do (0175).
	 *
	 * `{ resolved, overrides?, probe? }` — see `StoredCapabilities`. `resolved` is
	 * a CACHE: the effective set that `satisfies()` reads, recomputed from the
	 * adapter's declaration, the preset, the last probe and the user's toggles.
	 * It is cached rather than derived on read because that read happens for every
	 * connection against every slot in the config picker, and deriving it would
	 * mean dynamically importing the adapter module — defeating the lazy loading
	 * exactly where it costs most.
	 *
	 * The durable intent is `overrides` and `probe`; `resolved` can always be
	 * rebuilt from those plus the static manifest.
	 *
	 * Its own column rather than a key in `extraJson`, which is the ADAPTER's bag:
	 * that one holds the encrypted apiKey the crypto path walks, and every
	 * connection form spreads it verbatim. Capabilities are core's, cross-cutting,
	 * and read by code that has no business in an adapter's private state.
	 */
	capabilities: json("capabilities")
		.notNull()
		.default({})
		.$type<Record<string, unknown>>(),
	/**
	 * Which named service this was created from — a slug, never the numeric
	 * `value` (an ordering artifact that has already skipped an index).
	 *
	 * Persisted because a preset supplies capability DEFAULTS, and without it
	 * there is no way to recompute them on edit, no source of defaults for a
	 * capability that ships later, and nothing for "reset to preset defaults" to
	 * reset to. NULL means custom, which is the honest answer for every row that
	 * predates this column.
	 */
	preset: text("preset"),
	baseUrl: text("base_url"), // Base URL or endpoint for API
	model: text("model"), // Model name or identifier
	// Ollama-specific options
	extraJson: json("extra_json")
		.notNull()
		.default({})
		.$type<Record<string, any>>(), // Additional JSON options for the connections, api keys, etc.
	tokenCounter: text("token_counter").notNull().default("estimate"),
	promptFormat: text("prompt_format").default("vicuna")
})

/**
 * The instance default connection per capability. The ONLY store for one.
 *
 * A table rather than a pair of columns per capability, because the capability
 * space is open — a plugin may introduce a transform — so columns would mean a
 * migration each time and a schema that grows with the vocabulary.
 *
 * Only TRANSFORMS are ever registered here. There is no such thing as a default
 * tool-calling connection: a feature qualifies a request, it is not something a
 * node goes looking for a connection to provide.
 *
 * ## The key is the transform's two SIDES, not its id (0183)
 *
 * It was one `capability` column holding the whole id, `text+image->text`. That
 * makes the output side — the half every grouping on the admin screen and every
 * sampling-vocabulary lookup actually asks about — reachable only by pattern
 * matching a string. `input` and `output` hold comma-delimited `IoKind` lists
 * instead, so the question is an equality on an indexed column.
 *
 * The id is still what the rest of the app says out loud; see
 * `$lib/shared/capabilities/sides.ts` for the correspondence and for why the
 * order inside a side is not alphabetical.
 *
 * ## Why not a JSON column, which is the other shape this could have taken
 *
 * A blob keyed by capability would hold exactly the same pairs and lose both
 * foreign keys, and those keys are load-bearing three times over. `set null`
 * rather than cascade, deliberately, in each case:
 *
 *   1. Deleting a connection CLEARS the defaults pointing at it. In a blob the
 *      id would simply stay, dangling, and the next run would resolve a default
 *      to a row that is not there.
 *   2. It is what makes "the default was cleared" distinguishable from "no
 *      default was ever set" — a row with a null `connection_id` versus no row.
 *      Those are two different sentences to a person: one says the connection
 *      you picked is gone, the other says you never picked one.
 *   3. Clearing rather than deleting the ROW is why nothing needs an
 *      auto-fallback on delete. The fact that somebody configured this
 *      capability survives; only the target is missing, and it is asked for
 *      by name.
 *
 * ⚠ Until 0181 this docblock said `system_settings.default_connection_id` and
 * `default_sampling_id` were "deliberately still there and still read by the
 * legacy generation path". They are gone. Every star press used to write both
 * spellings, and readers checked the table first and the column only when the
 * row was ABSENT — never when it was merely STALE. Nothing reads a default from
 * anywhere but here now, legacy path included.
 */
export const connectionDefaults = pgTable(
	"connection_defaults",
	{
		/**
		 * What goes IN, comma-delimited: `text`, or `text,image` for vision.
		 *
		 * ⚠ The order is `IO_KINDS` DECLARATION order — text, image, audio,
		 * video, document, embedding — and NOT alphabetical. Vision stores
		 * `"text,image"`, never `"image,text"`. That is the SDK's own rule (see
		 * `side()` in `capabilities.ts`: "text leads, so vision reads
		 * `text+image->text`"), and a row sorted the other way is a perfectly
		 * valid primary key that matches nothing forever.
		 */
		input: text("input").notNull(),
		/** What comes OUT, same rules — `text`, `image`, `embedding`. */
		output: text("output").notNull(),
		connectionId: integer("connection_id").references(
			() => connections.id,
			{
				onDelete: "set null"
			}
		),
		samplingConfigId: integer("sampling_config_id").references(
			() => samplingConfigs.id,
			{ onDelete: "set null" }
		)
	},
	(t) => [
		// The pair, which until 0183 was one `capability` column holding the
		// whole transform id. Splitting it is what makes the output side
		// QUERYABLE: "which defaults produce images" is `WHERE output = 'image'`
		// rather than `LIKE '%->image'` against a string no index helps with.
		//
		// The id remains the canonical IN-MEMORY form — `capabilityDefaults()`
		// is still keyed by it, and so is everything downstream. The conversion
		// lives at the storage boundary in `connections/capabilityDefaults.ts`
		// and in `$lib/shared/capabilities/sides.ts`, and nowhere else.
		primaryKey({ columns: [t.input, t.output] }),
		index("connection_defaults_output_idx").on(t.output),
		// Neither side may be EMPTY (0184).
		//
		// An empty side satisfies the primary key perfectly and matches nothing
		// forever, because nothing ever asks for a capability with an empty side —
		// so the row is unmatchable rather than merely wrong, and an unmatchable
		// row on a lookup table is worse than an absent one: the absent one reads
		// as "not set up" and says where to set it. 0183 deleted the degenerate
		// rows it found and `capabilityDefaults.ts` refuses to write one; this is
		// the same rule at the system of record, so a writer arriving by any other
		// path cannot create one either.
		check(
			"connection_defaults_sides_check",
			sql`${t.input} <> '' AND ${t.output} <> ''`
		)
	]
)

export const connectionDefaultsRelations = relations(
	connectionDefaults,
	({ one }) => ({
		connection: one(connections, {
			fields: [connectionDefaults.connectionId],
			references: [connections.id]
		}),
		samplingConfig: one(samplingConfigs, {
			fields: [connectionDefaults.samplingConfigId],
			references: [samplingConfigs.id]
		})
	})
)

export const connectionsRelations = relations(connections, () => ({}))

/**
 * Stop scripts attached to a connection (18 §4b) — the rides-along pattern.
 *
 * Stop behavior is usually a property of the *model*, not the story: "this
 * endpoint leaks ChatML", "this one echoes the speaker line" travel with the
 * endpoint, and every pipeline that runs against the connection — core's and
 * any extension's — inherits the guards with no wiring. Legal here because
 * stops are order-free (a min-reduction, 18 §5), so merging the connection's
 * set with a pipeline's chain needs no precedence rule.
 *
 * Only `core:script:text/stop@1` rows may attach — the entity layer refuses
 * anything else, because entity attachment is limited to operations whose
 * content actually flows through the entity (18 §4b's scope guard). `position`
 * is display order only; verdicts do not care.
 */
export const connectionScripts = pgTable(
	"connection_scripts",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		connectionId: integer("connection_id")
			.notNull()
			.references(() => connections.id, { onDelete: "cascade" }),
		scriptId: integer("script_id")
			.notNull()
			.references(() => pipelineScripts.id, { onDelete: "cascade" }),
		position: integer("position").notNull().default(0),
		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(t) => [
		uniqueIndex("connection_scripts_pair_idx").on(
			t.connectionId,
			t.scriptId
		),
		index("connection_scripts_script_idx").on(t.scriptId)
	]
)

export const contextConfigs = pgTable("context_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/**
	 * Which template language `template` is written in — a registry id, not a
	 * hardcoded assumption (12 §2a).
	 *
	 * NULL means core's default, which is Handlebars. Stored rather than assumed
	 * so an extension can register its own engine and supply the renderer for
	 * it: the schema describes what the template *is*, and core resolves who can
	 * render it at run time. Without this column, "core renders Handlebars" is a
	 * fact buried in code, and a plugin shipping a different assembler would
	 * have nowhere to say so.
	 */
	engine: text("engine"),
	/** Stable seed identity, e.g. "sampling-default". NULL for user-created
	 *  rows — see db/defaults.ts for why matching on id was unsafe. */
	seedKey: text("seed_key").unique(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	template: text("template") // Sillytavern storyString
})

export const contextConfigsRelations = relations(contextConfigs, () => ({}))

export const promptConfigs = pgTable("prompt_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/** Stable seed identity, e.g. "sampling-default". NULL for user-created
	 *  rows — see db/defaults.ts for why matching on id was unsafe. */
	seedKey: text("seed_key").unique(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	systemPrompt: text("system_prompt").notNull(),
	// Reinforcement inserted right before the model's generation point —
	// after all session history, immediately preceding the seed turn — rather
	// than only at the top of a long prompt alongside systemPrompt. Mirrors
	// narratorPromptConfigs.postHistoryInstructions below.
	postHistoryInstructions: text("post_history_instructions"),
	// Number of messages back from the last message the post-history block
	// is positioned at. 0 = immediately after the last message (default).
	postHistoryDepth: integer("post_history_depth").notNull().default(0),
	// Minimum token count of session history required before
	// postHistoryInstructions is included — lets short sessions skip the
	// reminder since the system prompt is still close by. 0 = always
	// included.
	postHistoryTokenTrigger: integer("post_history_token_trigger")
		.notNull()
		.default(0),
	connectionId: integer("connection_id").references(() => connections.id, {
		onDelete: "set null"
	}),
	samplingConfigId: integer("sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	)
})

export const promptConfigsRelations = relations(promptConfigs, ({ one }) => ({
	connection: one(connections, {
		fields: [promptConfigs.connectionId],
		references: [connections.id]
	}),
	samplingConfig: one(samplingConfigs, {
		fields: [promptConfigs.samplingConfigId],
		references: [samplingConfigs.id]
	})
}))

// "session" prefix is deliberate: this is a prompt config scoped to the
// standard roleplay session type specifically, so a future narrator/environment
// config for a different session type can't collide with it.
export const narratorPromptConfigs = pgTable("narrator_prompt_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/** Stable seed identity, e.g. "sampling-default". NULL for user-created
	 *  rows — see db/defaults.ts for why matching on id was unsafe. */
	seedKey: text("seed_key").unique(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	// Session-facing display name/label shown on messages generated with this
	// config (e.g. "Narrator", "The World", "Fate") — distinct from
	// `name` above, which only identifies the config itself in the sidebar.
	narratorName: text("narrator_name").notNull().default("Narrator"),
	// Reinforcement inserted right before the model's generation point —
	// after all session history, immediately preceding the seed turn — rather
	// than only at the top of a long prompt alongside systemPrompt. Far more
	// effective against a model drifting back into character-dialogue
	// patterns established over many prior turns. See defaults.ts's context
	// template for exactly where this lands relative to the seed.
	postHistoryInstructions: text("post_history_instructions"),
	// Number of messages back from the last message the post-history block
	// is positioned at. 0 = immediately after the last message (default).
	postHistoryDepth: integer("post_history_depth").notNull().default(0),
	// Minimum token count of session history required before
	// postHistoryInstructions is included. 0 = always included — the
	// Narrator's own seed keeps this at 0 so it's always reinforced.
	postHistoryTokenTrigger: integer("post_history_token_trigger")
		.notNull()
		.default(0),
	systemPrompt: text("system_prompt").notNull(),
	connectionId: integer("connection_id").references(() => connections.id, {
		onDelete: "set null"
	}),
	samplingConfigId: integer("sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	)
})

export const narratorPromptConfigsRelations = relations(
	narratorPromptConfigs,
	({ one }) => ({
		connection: one(connections, {
			fields: [narratorPromptConfigs.connectionId],
			references: [connections.id]
		}),
		samplingConfig: one(samplingConfigs, {
			fields: [narratorPromptConfigs.samplingConfigId],
			references: [samplingConfigs.id]
		})
	})
)

export const worldSummarizeConfigs = pgTable("world_summarize_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/** Stable seed identity, e.g. "sampling-default". NULL for user-created
	 *  rows — see db/defaults.ts for why matching on id was unsafe. */
	seedKey: text("seed_key").unique(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	batchSystemPrompt: text("batch_system_prompt").notNull(),
	synthSystemPrompt: text("synth_system_prompt").notNull(),
	nameSystemPrompt: text("name_system_prompt").notNull(),
	batchConnectionId: integer("batch_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	batchSamplingConfigId: integer("batch_sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	),
	synthConnectionId: integer("synth_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	synthSamplingConfigId: integer("synth_sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	),
	nameConnectionId: integer("name_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	nameSamplingConfigId: integer("name_sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	)
})

export const worldSummarizeConfigsRelations = relations(
	worldSummarizeConfigs,
	({ one }) => ({
		batchConnection: one(connections, {
			fields: [worldSummarizeConfigs.batchConnectionId],
			references: [connections.id]
		}),
		batchSamplingConfig: one(samplingConfigs, {
			fields: [worldSummarizeConfigs.batchSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		synthConnection: one(connections, {
			fields: [worldSummarizeConfigs.synthConnectionId],
			references: [connections.id]
		}),
		synthSamplingConfig: one(samplingConfigs, {
			fields: [worldSummarizeConfigs.synthSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		nameConnection: one(connections, {
			fields: [worldSummarizeConfigs.nameConnectionId],
			references: [connections.id]
		}),
		nameSamplingConfig: one(samplingConfigs, {
			fields: [worldSummarizeConfigs.nameSamplingConfigId],
			references: [samplingConfigs.id]
		})
	})
)

export const characterSummarizeConfigs = pgTable(
	"character_summarize_configs",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** Stable seed identity, e.g. "sampling-default". NULL for user-created
		 *  rows — see db/defaults.ts for why matching on id was unsafe. */
		seedKey: text("seed_key").unique(),
		isImmutable: boolean("is_immutable").notNull().default(false),
		name: text("name").notNull(),
		batchSystemPrompt: text("batch_system_prompt").notNull(),
		synthSystemPrompt: text("synth_system_prompt").notNull(),
		nameSystemPrompt: text("name_system_prompt").notNull(),
		batchConnectionId: integer("batch_connection_id").references(
			() => connections.id,
			{ onDelete: "set null" }
		),
		batchSamplingConfigId: integer("batch_sampling_config_id").references(
			() => samplingConfigs.id,
			{ onDelete: "set null" }
		),
		synthConnectionId: integer("synth_connection_id").references(
			() => connections.id,
			{ onDelete: "set null" }
		),
		synthSamplingConfigId: integer("synth_sampling_config_id").references(
			() => samplingConfigs.id,
			{ onDelete: "set null" }
		),
		nameConnectionId: integer("name_connection_id").references(
			() => connections.id,
			{ onDelete: "set null" }
		),
		nameSamplingConfigId: integer("name_sampling_config_id").references(
			() => samplingConfigs.id,
			{ onDelete: "set null" }
		)
	}
)

export const characterSummarizeConfigsRelations = relations(
	characterSummarizeConfigs,
	({ one }) => ({
		batchConnection: one(connections, {
			fields: [characterSummarizeConfigs.batchConnectionId],
			references: [connections.id]
		}),
		batchSamplingConfig: one(samplingConfigs, {
			fields: [characterSummarizeConfigs.batchSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		synthConnection: one(connections, {
			fields: [characterSummarizeConfigs.synthConnectionId],
			references: [connections.id]
		}),
		synthSamplingConfig: one(samplingConfigs, {
			fields: [characterSummarizeConfigs.synthSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		nameConnection: one(connections, {
			fields: [characterSummarizeConfigs.nameConnectionId],
			references: [connections.id]
		}),
		nameSamplingConfig: one(samplingConfigs, {
			fields: [characterSummarizeConfigs.nameSamplingConfigId],
			references: [samplingConfigs.id]
		})
	})
)

export const sceneSummarizeConfigs = pgTable("scene_summarize_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/** Stable seed identity, e.g. "sampling-default". NULL for user-created
	 *  rows — see db/defaults.ts for why matching on id was unsafe. */
	seedKey: text("seed_key").unique(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	batchSystemPrompt: text("batch_system_prompt").notNull(),
	synthSystemPrompt: text("synth_system_prompt").notNull(),
	nameSystemPrompt: text("name_system_prompt").notNull(),
	characterExtractionSystemPrompt: text("character_extraction_system_prompt")
		.notNull()
		.default(""),
	batchConnectionId: integer("batch_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	batchSamplingConfigId: integer("batch_sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	),
	synthConnectionId: integer("synth_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	synthSamplingConfigId: integer("synth_sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	),
	nameConnectionId: integer("name_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	nameSamplingConfigId: integer("name_sampling_config_id").references(
		() => samplingConfigs.id,
		{ onDelete: "set null" }
	),
	characterExtractionConnectionId: integer(
		"character_extraction_connection_id"
	).references(() => connections.id, { onDelete: "set null" }),
	characterExtractionSamplingConfigId: integer(
		"character_extraction_sampling_config_id"
	).references(() => samplingConfigs.id, { onDelete: "set null" })
})

export const sceneSummarizeConfigsRelations = relations(
	sceneSummarizeConfigs,
	({ one }) => ({
		batchConnection: one(connections, {
			fields: [sceneSummarizeConfigs.batchConnectionId],
			references: [connections.id]
		}),
		batchSamplingConfig: one(samplingConfigs, {
			fields: [sceneSummarizeConfigs.batchSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		synthConnection: one(connections, {
			fields: [sceneSummarizeConfigs.synthConnectionId],
			references: [connections.id]
		}),
		synthSamplingConfig: one(samplingConfigs, {
			fields: [sceneSummarizeConfigs.synthSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		nameConnection: one(connections, {
			fields: [sceneSummarizeConfigs.nameConnectionId],
			references: [connections.id]
		}),
		nameSamplingConfig: one(samplingConfigs, {
			fields: [sceneSummarizeConfigs.nameSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		characterExtractionConnection: one(connections, {
			fields: [sceneSummarizeConfigs.characterExtractionConnectionId],
			references: [connections.id]
		}),
		characterExtractionSamplingConfig: one(samplingConfigs, {
			fields: [sceneSummarizeConfigs.characterExtractionSamplingConfigId],
			references: [samplingConfigs.id]
		})
	})
)

export const graphBuildConfigs = pgTable("graph_build_configs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/** Stable seed identity, e.g. "sampling-default". NULL for user-created
	 *  rows — see db/defaults.ts for why matching on id was unsafe. */
	seedKey: text("seed_key").unique(),
	isImmutable: boolean("is_immutable").notNull().default(false),
	name: text("name").notNull(),
	nodeResolutionSystemPrompt: text("node_resolution_system_prompt")
		.notNull()
		.default(""),
	preFilterSystemPrompt: text("pre_filter_system_prompt")
		.notNull()
		.default(""),
	perspectiveSystemPrompt: text("perspective_system_prompt")
		.notNull()
		.default(""),
	nodeResolutionConnectionId: integer(
		"node_resolution_connection_id"
	).references(() => connections.id, { onDelete: "set null" }),
	nodeResolutionSamplingConfigId: integer(
		"node_resolution_sampling_config_id"
	).references(() => samplingConfigs.id, { onDelete: "set null" }),
	preFilterConnectionId: integer("pre_filter_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	preFilterSamplingConfigId: integer(
		"pre_filter_sampling_config_id"
	).references(() => samplingConfigs.id, { onDelete: "set null" }),
	perspectiveConnectionId: integer("perspective_connection_id").references(
		() => connections.id,
		{ onDelete: "set null" }
	),
	perspectiveSamplingConfigId: integer(
		"perspective_sampling_config_id"
	).references(() => samplingConfigs.id, { onDelete: "set null" }),
	/** Prose, not JSON — the two-sentence intro written for a new character. */
	nodeDescriptionSystemPrompt: text("node_description_system_prompt")
		.notNull()
		.default(""),
	nodeDescriptionConnectionId: integer(
		"node_description_connection_id"
	).references(() => connections.id, { onDelete: "set null" }),
	nodeDescriptionSamplingConfigId: integer(
		"node_description_sampling_config_id"
	).references(() => samplingConfigs.id, { onDelete: "set null" }),
	/** Did any present character reach a new lifecycle state this scene? */
	stateDetectionSystemPrompt: text("state_detection_system_prompt")
		.notNull()
		.default(""),
	stateDetectionConnectionId: integer(
		"state_detection_connection_id"
	).references(() => connections.id, { onDelete: "set null" }),
	stateDetectionSamplingConfigId: integer(
		"state_detection_sampling_config_id"
	).references(() => samplingConfigs.id, { onDelete: "set null" })
})

export const graphBuildConfigsRelations = relations(
	graphBuildConfigs,
	({ one }) => ({
		nodeResolutionConnection: one(connections, {
			fields: [graphBuildConfigs.nodeResolutionConnectionId],
			references: [connections.id]
		}),
		nodeResolutionSamplingConfig: one(samplingConfigs, {
			fields: [graphBuildConfigs.nodeResolutionSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		preFilterConnection: one(connections, {
			fields: [graphBuildConfigs.preFilterConnectionId],
			references: [connections.id]
		}),
		preFilterSamplingConfig: one(samplingConfigs, {
			fields: [graphBuildConfigs.preFilterSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		perspectiveConnection: one(connections, {
			fields: [graphBuildConfigs.perspectiveConnectionId],
			references: [connections.id]
		}),
		perspectiveSamplingConfig: one(samplingConfigs, {
			fields: [graphBuildConfigs.perspectiveSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		nodeDescriptionConnection: one(connections, {
			fields: [graphBuildConfigs.nodeDescriptionConnectionId],
			references: [connections.id]
		}),
		nodeDescriptionSamplingConfig: one(samplingConfigs, {
			fields: [graphBuildConfigs.nodeDescriptionSamplingConfigId],
			references: [samplingConfigs.id]
		}),
		stateDetectionConnection: one(connections, {
			fields: [graphBuildConfigs.stateDetectionConnectionId],
			references: [connections.id]
		}),
		stateDetectionSamplingConfig: one(samplingConfigs, {
			fields: [graphBuildConfigs.stateDetectionSamplingConfigId],
			references: [samplingConfigs.id]
		})
	})
)

export const lorebooks = pgTable(
	"lorebooks",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		// Stable, DB-generated identity for export/import dedup — never
		// user-edited or regenerated. Backfills automatically on migration
		// (default value applies to existing rows too), so there's no app-side
		// generation or backfill script anywhere. Matches the existing
		// userTokens.id column's exact pattern.
		uuid: uuid("uuid")
			.notNull()
			.default(sql`(gen_random_uuid ())`),
		name: text("name").notNull(),
		description: text("description").notNull().default(""),
		extraJson: json("extra_json")
			.notNull()
			.default({})
			.$type<Record<string, any>>(),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }), // FK to users.id
		// Monotonic per-lorebook counter for {{char:N}} token numbers — never
		// decrements, even after a binding is deleted, so a number is never
		// reused within a lorebook (same never-reuse guarantee as before,
		// just scoped per lorebook instead of derived from the binding row's
		// own global id). Every binding-creation call site atomically
		// increments this via an UPDATE...RETURNING in the same transaction
		// as the insert — see deriveNextBindingToken() in
		// lorebookBindingToken.ts.
		nextBindingNumber: integer("next_binding_number").notNull().default(1),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: date("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => sql`(CURRENT_TIMESTAMP)`)
	},
	(table) => [
		index("lorebooks_user_id_idx").on(table.userId),
		// Unique per-owner, not globally — two different users legitimately
		// importing the same shared lorebook file must each be able to own a
		// row stamped with that file's uuid.
		uniqueIndex("lorebooks_uuid_idx").on(table.userId, table.uuid)
	]
)

export const lorebooksRelations = relations(lorebooks, ({ many, one }) => ({
	worldLoreEntries: many(worldLoreEntries),
	characterLoreEntries: many(characterLoreEntries),
	historyEntries: many(historyEntries),
	scenes: many(scenes),
	user: one(users, {
		fields: [lorebooks.userId],
		references: [users.id]
	}),
	lorebookBindings: many(lorebookBindings),
	lorebookTags: many(lorebookTags)
}))

export const lorebookBindings = pgTable(
	"lorebook_bindings",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		characterId: integer("character_id").references(() => characters.id, {
			onDelete: "set null"
		}),
		personaId: integer("persona_id").references(() => personas.id, {
			onDelete: "set null"
		}),
		binding: text("binding").notNull(), // e.g. "{{char:1}}" (preferred) or "{char:1}" (deprecated)
		// ── Narrative-graph fields (merged in from the former narrativeNodes
		// table — every binding is also this character's graph presence now;
		// see plan doc for the merge rationale) ──────────────────────────────
		sceneId: integer("scene_id").references(() => scenes.id, {
			onDelete: "set null"
		}),
		historyEntryId: integer("history_entry_id").references(
			() => historyEntries.id,
			{ onDelete: "set null" }
		),
		// Display name — kept in sync with the bound character/persona's own
		// name when characterId/personaId is set (see syncLorebookBindings*
		// helpers); user/LLM-set directly for unbound/background rows.
		name: text("name").notNull().default(""),
		nodeState: text("node_state")
			.notNull()
			.default("active")
			.$type<NodeState>(),
		nodeVisibility: text("node_visibility")
			.notNull()
			.default("normal")
			.$type<NodeVisibility>(),
		// Kept in sync with the bound character/persona's own aliases, same
		// as `name` above.
		aliases: json("aliases").notNull().default([]).$type<string[]>(),
		// Identities absorbed via narrativeGraph:mergeNode ("absorb"), kept
		// deliberately separate from `aliases` — `aliases` is a one-directional
		// sync target from the bound character/persona (see above), a full
		// REPLACE on every entity edit; an absorbed name written directly into
		// `aliases` would silently vanish the next time that sync fires. This
		// column is never touched by the sync helpers, so an absorbed identity
		// survives regardless of how many times the bound entity is edited
		// afterward. Every consumer that reads `aliases` for name-matching or
		// display must union it with this column — see
		// availableSceneCast.ts's collectAliases().
		absorbedAliases: json("absorbed_aliases")
			.notNull()
			.default([])
			.$type<string[]>(),
		summary: text("summary"),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at"),
		// Parent binding — set when this row is an alias/child of another
		// (2-level max), from graph-merge operations.
		parentNodeId: integer("parent_node_id").references(
			(): AnyPgColumn => lorebookBindings.id,
			{ onDelete: "set null" }
		),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(table) => ({
		uniqueBinding: uniqueIndex("lorebook_bindings_unique").on(
			table.lorebookId,
			table.characterId,
			table.personaId
		),
		lorebookIdIdx: index("lorebook_bindings_lorebook_id_idx").on(
			table.lorebookId
		),
		characterIdIdx: index("lorebook_bindings_character_id_idx").on(
			table.characterId
		),
		personaIdIdx: index("lorebook_bindings_persona_id_idx").on(
			table.personaId
		)
	})
)

export const lorebookBindingsRelations = relations(
	lorebookBindings,
	({ one, many }) => ({
		lorebook: one(lorebooks, {
			fields: [lorebookBindings.lorebookId],
			references: [lorebooks.id]
		}),
		character: one(characters, {
			fields: [lorebookBindings.characterId],
			references: [characters.id]
		}),
		persona: one(personas, {
			fields: [lorebookBindings.personaId],
			references: [personas.id]
		}),
		characterLoreEntries: many(characterLoreEntries),
		/** Scenes this binding appears in, via the scene_characters join. */
		sceneAppearances: many(sceneCharacters),
		// ── Narrative-graph relations (merged in from the former
		// narrativeNodes table — see the merge plan) ────────────────────────
		scene: one(scenes, {
			fields: [lorebookBindings.sceneId],
			references: [scenes.id]
		}),
		historyEntry: one(historyEntries, {
			fields: [lorebookBindings.historyEntryId],
			references: [historyEntries.id]
		}),
		parentNode: one(lorebookBindings, {
			fields: [lorebookBindings.parentNodeId],
			references: [lorebookBindings.id],
			relationName: "nodeAliases"
		}),
		aliasChildren: many(lorebookBindings, { relationName: "nodeAliases" }),
		outgoingRelationships: many(narrativeRelationships, {
			relationName: "fromNode"
		}),
		incomingRelationships: many(narrativeRelationships, {
			relationName: "toNode"
		})
	})
)

// Audit log for narrativeGraph:mergeNode ("absorb") — a consolidating,
// destructive operation (deletes the absorbed row, rewrites its
// references onto the survivor). This is what makes that safe: enough of
// the absorbed row's state and every rewrite/deletion performed is
// recorded here to reverse a mistaken absorb via narrativeGraph:undoMerge.
export const bindingMergeLogs = pgTable(
	"binding_merge_logs",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		// Nullable: if the survivor is later itself deleted/absorbed elsewhere,
		// the log entry is kept for history but can no longer be undone.
		survivorId: integer("survivor_id").references(
			() => lorebookBindings.id,
			{
				onDelete: "set null"
			}
		),
		// Full field snapshot of the absorbed row (including its own binding
		// token) — enough to re-INSERT it verbatim on undo.
		absorbedSnapshot: json("absorbed_snapshot")
			.notNull()
			.$type<Record<string, unknown>>(),
		// Relationship rows whose fromNodeId/toNodeId were rewritten from the
		// absorbed id to the survivor's — {id, oldFromNodeId, oldToNodeId} so
		// undo can point them back.
		relationshipRewrites: json("relationship_rewrites")
			.notNull()
			.default([])
			.$type<
				{ id: number; oldFromNodeId: number; oldToNodeId: number }[]
			>(),
		// Full row snapshots of relationships deleted outright (self-loops
		// created by the rewrite, or third-party duplicates) — undo re-inserts
		// these rather than trying to re-derive them.
		deletedRelationships: json("deleted_relationships")
			.notNull()
			.default([])
			.$type<Record<string, unknown>[]>(),
		// Pre-merge participantCharacters/mentionedCharacters for every scene
		// whose arrays referenced the absorbed id — undo restores these
		// recorded values directly rather than reverse-computing the rewrite.
		sceneSnapshots: json("scene_snapshots").notNull().default([]).$type<
			{
				sceneId: number
				participantCharacters: number[]
				mentionedCharacters: number[]
			}[]
		>(),
		// Exact strings appended to the survivor's absorbedAliases by this
		// merge — undo removes precisely these, not a guess.
		absorbedAliasesAdded: json("absorbed_aliases_added")
			.notNull()
			.default([])
			.$type<string[]>(),
		// characterLoreEntries reassigned from the absorbed row to the
		// survivor — undo moves these back to the recreated absorbed row.
		reassignedCharacterLoreEntryIds: json(
			"reassigned_character_lore_entry_ids"
		)
			.notNull()
			.default([])
			.$type<number[]>(),
		// lorebookBindings rows whose parentNodeId pointed at the absorbed row,
		// reassigned to the survivor — without this, those alias-children would
		// otherwise be silently orphaned (parentNodeId SET NULL by the FK) when
		// the absorbed row is deleted, and undo would have no way to restore the
		// link. Undo moves these back to point at the recreated absorbed row.
		reassignedChildNodeIds: json("reassigned_child_node_ids")
			.notNull()
			.default([])
			.$type<number[]>(),
		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(table) => [
		index("binding_merge_logs_lorebook_id_idx").on(table.lorebookId)
	]
)

export const bindingMergeLogsRelations = relations(
	bindingMergeLogs,
	({ one }) => ({
		lorebook: one(lorebooks, {
			fields: [bindingMergeLogs.lorebookId],
			references: [lorebooks.id]
		}),
		user: one(users, {
			fields: [bindingMergeLogs.userId],
			references: [users.id]
		}),
		survivor: one(lorebookBindings, {
			fields: [bindingMergeLogs.survivorId],
			references: [lorebookBindings.id]
		})
	})
)

// Sticky "not a duplicate" dismissals for the proactive duplicate-review
// affordance (see availableSceneCast.ts's findDuplicateCandidates) — a
// dismissed pair is never re-flagged for this lorebook, even across
// future graph builds. Always stored with bindingIdA < bindingIdB so a
// pair is looked up the same way regardless of which order it was found.
export const dismissedDuplicatePairs = pgTable(
	"dismissed_duplicate_pairs",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		bindingIdA: integer("binding_id_a")
			.notNull()
			.references(() => lorebookBindings.id, { onDelete: "cascade" }),
		bindingIdB: integer("binding_id_b")
			.notNull()
			.references(() => lorebookBindings.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(table) => ({
		uniquePair: uniqueIndex("dismissed_duplicate_pairs_unique").on(
			table.lorebookId,
			table.bindingIdA,
			table.bindingIdB
		)
	})
)

export const worldLoreEntries = pgTable(
	"world_lore_entries",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		category: text("category"),
		keys: text("keys").notNull().default(""),
		/**
		 * How this entry may be retrieved (13 §10a / DECOMPOSITION §4).
		 *
		 * `keyword` — only the keyword scan surfaces it.
		 * `rag` — vector search surfaces it, **falling back to keyword when no
		 *   embeddings are available**, because the alternative is retrieving
		 *   nothing and reading as "the bot forgot my lore".
		 * `both` — both arms may surface it and the combined ranker decides.
		 *
		 * NULL means `rag`, the default. Nullable rather than defaulted so an
		 * entry that has never been touched is distinguishable from one a user
		 * deliberately set to the default — which is what makes a future change
		 * of default safe to apply to the first group and not the second.
		 */
		retrievalStrategy: text("retrieval_strategy"),
		/**
		 * How this entry's keys are matched: `substring` (today's behaviour),
		 * `word`, or `regex`.
		 *
		 * NULL falls back to `useRegex`, which is why that column stays. Keys
		 * match by substring today — `art` fires on "hearth" — so the default
		 * cannot change before parity without changing what every existing
		 * lorebook retrieves.
		 */
		matchMode: text("match_mode"),
		useRegex: boolean("use_regex").default(false),
		caseSensitive: boolean("case_sensitive").notNull().default(false),
		/**
		 * The deepest recursion level this entry may still be reached at.
		 *
		 * `0` is the conversation only: never dragged in by another entry.
		 * NULL is no opinion, and the query node's `maxRecursionDepth` decides
		 * — which is what makes turning recursion on for a whole lorebook one
		 * setting rather than several hundred. Nullable for the same reason
		 * `retrievalStrategy` is: an entry nobody has ruled on has to stay
		 * distinguishable from one somebody deliberately set to the default.
		 */
		recursionDepth: integer("recursion_depth"),
		content: text("content").notNull().default(""),
		priority: integer("priority").notNull().default(1),
		constant: boolean("constant").notNull().default(false),
		enabled: boolean("enabled").notNull().default(true),
		extraJson: json("extra_json")
			.notNull()
			.default({})
			.$type<Record<string, any>>(),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => new Date()),
		position: integer("position").notNull().default(0),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at")
	},
	(table) => [
		index("world_lore_entries_lorebook_id_idx").on(table.lorebookId)
	]
)

export const worldLoreEntriesRelations = relations(
	worldLoreEntries,
	({ one }) => ({
		lorebook: one(lorebooks, {
			fields: [worldLoreEntries.lorebookId],
			references: [lorebooks.id]
		})
	})
)

export const characterLoreEntries = pgTable(
	"character_lore_entries",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		lorebookBindingId: integer("character_binding_id").references(
			() => lorebookBindings.id,
			{ onDelete: "set null" }
		),
		name: text("name").notNull(),
		keys: text("keys").notNull().default(""),
		/**
		 * How this entry may be retrieved (13 §10a / DECOMPOSITION §4).
		 *
		 * `keyword` — only the keyword scan surfaces it.
		 * `rag` — vector search surfaces it, **falling back to keyword when no
		 *   embeddings are available**, because the alternative is retrieving
		 *   nothing and reading as "the bot forgot my lore".
		 * `both` — both arms may surface it and the combined ranker decides.
		 *
		 * NULL means `rag`, the default. Nullable rather than defaulted so an
		 * entry that has never been touched is distinguishable from one a user
		 * deliberately set to the default — which is what makes a future change
		 * of default safe to apply to the first group and not the second.
		 */
		retrievalStrategy: text("retrieval_strategy"),
		/**
		 * How this entry's keys are matched: `substring` (today's behaviour),
		 * `word`, or `regex`.
		 *
		 * NULL falls back to `useRegex`, which is why that column stays. Keys
		 * match by substring today — `art` fires on "hearth" — so the default
		 * cannot change before parity without changing what every existing
		 * lorebook retrieves.
		 */
		matchMode: text("match_mode"),
		useRegex: boolean("use_regex").default(false),
		caseSensitive: boolean("case_sensitive").notNull().default(false),
		/**
		 * The deepest recursion level this entry may still be reached at.
		 *
		 * `0` is the conversation only: never dragged in by another entry.
		 * NULL is no opinion, and the query node's `maxRecursionDepth` decides
		 * — which is what makes turning recursion on for a whole lorebook one
		 * setting rather than several hundred. Nullable for the same reason
		 * `retrievalStrategy` is: an entry nobody has ruled on has to stay
		 * distinguishable from one somebody deliberately set to the default.
		 */
		recursionDepth: integer("recursion_depth"),
		content: text("content").notNull().default(""),
		priority: integer("priority").notNull().default(1),
		constant: boolean("constant").notNull().default(false),
		enabled: boolean("enabled").notNull().default(true),
		extraJson: json("extra_json")
			.notNull()
			.default({})
			.$type<Record<string, any>>(),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => new Date()),
		position: integer("position").notNull().default(0),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at")
	},
	(table) => [
		index("character_lore_entries_lorebook_id_idx").on(table.lorebookId)
	]
)

export const characterLoreEntriesRelations = relations(
	characterLoreEntries,
	({ one }) => ({
		lorebook: one(lorebooks, {
			fields: [characterLoreEntries.lorebookId],
			references: [lorebooks.id]
		}),
		lorebookBinding: one(lorebookBindings, {
			fields: [characterLoreEntries.lorebookBindingId],
			references: [lorebookBindings.id]
		})
	})
)

export const historyEntries = pgTable(
	"history_entries",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		year: integer("year").notNull().default(1), // Default to year 1
		month: integer("month"), // Default to January
		day: integer("day"), // Default to 1
		keys: text("keys").notNull().default(""),
		/**
		 * How this entry may be retrieved (13 §10a / DECOMPOSITION §4).
		 *
		 * `keyword` — only the keyword scan surfaces it.
		 * `rag` — vector search surfaces it, **falling back to keyword when no
		 *   embeddings are available**, because the alternative is retrieving
		 *   nothing and reading as "the bot forgot my lore".
		 * `both` — both arms may surface it and the combined ranker decides.
		 *
		 * NULL means `rag`, the default. Nullable rather than defaulted so an
		 * entry that has never been touched is distinguishable from one a user
		 * deliberately set to the default — which is what makes a future change
		 * of default safe to apply to the first group and not the second.
		 */
		retrievalStrategy: text("retrieval_strategy"),
		/**
		 * How this entry's keys are matched: `substring` (today's behaviour),
		 * `word`, or `regex`.
		 *
		 * NULL falls back to `useRegex`, which is why that column stays. Keys
		 * match by substring today — `art` fires on "hearth" — so the default
		 * cannot change before parity without changing what every existing
		 * lorebook retrieves.
		 */
		matchMode: text("match_mode"),
		useRegex: boolean("use_regex").default(false),
		caseSensitive: boolean("case_sensitive").notNull().default(false),
		/**
		 * The deepest recursion level this entry may still be reached at.
		 *
		 * `0` is the conversation only: never dragged in by another entry.
		 * NULL is no opinion, and the query node's `maxRecursionDepth` decides
		 * — which is what makes turning recursion on for a whole lorebook one
		 * setting rather than several hundred. Nullable for the same reason
		 * `retrievalStrategy` is: an entry nobody has ruled on has to stay
		 * distinguishable from one somebody deliberately set to the default.
		 */
		recursionDepth: integer("recursion_depth"),
		content: text("content").notNull().default(""),
		constant: boolean("constant").notNull().default(false),
		enabled: boolean("enabled").notNull().default(true),
		extraJson: json("extra_json")
			.notNull()
			.default({})
			.$type<Record<string, any>>(),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => new Date()),
		position: integer("position").notNull().default(0),
		isCompleted: boolean("is_completed").notNull().default(false),
		graphed: boolean("graphed").notNull().default(false),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at")
	},
	(table) => [index("history_entries_lorebook_id_idx").on(table.lorebookId)]
)

export const historyEntriesRelations = relations(
	historyEntries,
	({ one, many }) => ({
		lorebook: one(lorebooks, {
			fields: [historyEntries.lorebookId],
			references: [lorebooks.id]
		}),
		scenes: many(scenes)
	})
)

export const tags = pgTable(
	"tags",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(), // Tag name (unique per user, case-insensitive)
		description: text("description"),
		colorPreset: text("color_preset")
			.notNull()
			.default("preset-filled-primary-500") // Color preset for the tag
	},
	(table) => [
		index("tags_user_id_idx").on(table.userId),
		uniqueIndex("tags_user_id_name_unique").on(
			table.userId,
			sql`lower(${table.name})`
		)
	]
)

export const tagsRelations = relations(tags, ({ many, one }) => ({
	user: one(users, {
		fields: [tags.userId],
		references: [users.id]
	}),
	characterTags: many(characterTags),
	personaTags: many(personaTags),
	lorebookTags: many(lorebookTags),
	sessionTags: many(sessionTags)
}))

export const characterTags = pgTable(
	"character_tags",
	{
		characterId: integer("character_id")
			.notNull()
			.references(() => characters.id, { onDelete: "cascade" }), // FK to characters.id
		tagId: integer("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }) // FK to tags.id
	},
	(t) => [
		// Without this, nothing stopped the same (characterId, tagId) pair
		// being inserted repeatedly (a double-click/retry), silently
		// duplicating the association and inflating counts anywhere that
		// renders a tag list — matches the composite unique PKs already used
		// on sessionCharacters/sessionPersonas/sessionGuests for the same reason.
		uniqueIndex("character_tags_unique").on(t.characterId, t.tagId)
	]
)

export const characterTagsRelations = relations(characterTags, ({ one }) => ({
	character: one(characters, {
		fields: [characterTags.characterId],
		references: [characters.id]
	}),
	tag: one(tags, {
		fields: [characterTags.tagId],
		references: [tags.id]
	})
}))

export const personaTags = pgTable(
	"persona_tags",
	{
		personaId: integer("persona_id")
			.notNull()
			.references(() => personas.id, { onDelete: "cascade" }), // FK to personas.id
		tagId: integer("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }) // FK to tags.id
	},
	(t) => [uniqueIndex("persona_tags_unique").on(t.personaId, t.tagId)]
)

export const personaTagsRelations = relations(personaTags, ({ one }) => ({
	persona: one(personas, {
		fields: [personaTags.personaId],
		references: [personas.id]
	}),
	tag: one(tags, {
		fields: [personaTags.tagId],
		references: [tags.id]
	})
}))

export const lorebookTags = pgTable(
	"lorebook_tags",
	{
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }), // FK to lorebooks.id
		tagId: integer("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }) // FK to tags.id
	},
	(t) => [uniqueIndex("lorebook_tags_unique").on(t.lorebookId, t.tagId)]
)

export const lorebookTagsRelations = relations(lorebookTags, ({ one }) => ({
	lorebook: one(lorebooks, {
		fields: [lorebookTags.lorebookId],
		references: [lorebooks.id]
	}),
	tag: one(tags, {
		fields: [lorebookTags.tagId],
		references: [tags.id]
	})
}))

export const sessionTags = pgTable(
	"session_tags",
	{
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }), // FK to sessions.id
		tagId: integer("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }) // FK to tags.id
	},
	(t) => [uniqueIndex("session_tags_unique").on(t.sessionId, t.tagId)]
)

export const sessionTagsRelations = relations(sessionTags, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionTags.sessionId],
		references: [sessions.id]
	}),
	tag: one(tags, {
		fields: [sessionTags.tagId],
		references: [tags.id]
	})
}))

export const characters = pgTable(
	"characters",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		// Stable, DB-generated identity for export/import dedup — see lorebooks.uuid.
		uuid: uuid("uuid")
			.notNull()
			.default(sql`(gen_random_uuid ())`),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }), // FK to users.id
		name: text("name").notNull(),
		nickname: text("nickname"), // Optional nickname
		characterVersion: text("character_version").default("1.0"), // Version of the character schema
		description: text("description").notNull(),
		personality: text("personality"), // Persona field
		scenario: text("scenario"),
		firstMessage: text("first_message"),
		alternateGreetings: json("alternate_greetings")
			.notNull()
			.default([])
			.$type<string[]>(), // JSON array of alternate greetings
		exampleDialogues: json("example_dialogues")
			.notNull()
			.default([])
			.$type<string[]>(), // JSON/text
		metadata: json("metadata")
			.notNull()
			.default({})
			.$type<Record<string, any>>(), // JSON/text for extra fields
		/** The character's avatar — a role, expressed as a pointer at `media`
		 *  (28). Plain integer, not an FK: see the note on `media`. */
		avatarMediaId: integer("avatar_media_id"),
		creatorNotes: text("creator_notes"), // Notes from the character creator
		creatorNotesMultilingual: json("creator_notes_multilingual").$type<
			Record<string, string>
		>(),
		groupOnlyGreetings: json("group_only_greetings").$type<string[]>(), // JSON array of greetings for group sessions
		postHistoryInstructions: text("post_history_instructions"), // Instructions for post-history processing
		source: json("source").notNull().default([]).$type<string[]>(), // JSON array of sources (e.g., URLs, books)
		// `assets` (a JSON array of card asset descriptors) was dropped by 28:
		// nothing ever wrote it — buildCharacterCardV3 emits no `assets` field
		// and the card parser never populated it — and nothing ever read it.
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => new Date()),
		lorebookId: integer("lorebook_id").references(() => lorebooks.id, {
			onDelete: "set null"
		}), // Optional FK to lorebooks.id
		extensions: json("extensions")
			.notNull()
			.default({})
			.$type<Record<string, any>>(),
		aliases: json("aliases").notNull().default([]).$type<string[]>(),
		summary: text("summary"),
		creator: text("creator"), // Card creator/author, per Character Card V3 spec
		category: text("category"), // Serene Pub-specific grouping/filter tag
		isFavorite: boolean("is_favorite").notNull().default(false), // 1 if favorite, 0 otherwise
		isDeleted: boolean("is_deleted").notNull().default(false),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at")
	},
	(table) => [
		index("characters_user_id_idx").on(table.userId),
		// Unique per-owner, not globally — see lorebooks_uuid_idx.
		uniqueIndex("characters_uuid_idx").on(table.userId, table.uuid)
	]
)

export const charactersRelations = relations(characters, ({ many, one }) => ({
	user: one(users, {
		fields: [characters.userId],
		references: [users.id]
	}),
	lorebook: one(lorebooks, {
		fields: [characters.lorebookId],
		references: [lorebooks.id]
	}),
	characterTags: many(characterTags),
	sessionCharacters: many(sessionCharacters),
	sessionMessages: many(sessionMessages)
}))

// `character_gallery_images` / `persona_gallery_images` were folded into
// `media` by 28: a gallery image is a media row stamped with the parent's id
// and ordered by `position`. The two tables existed only to hold that
// ordering, and every helper in utils/index.ts was written twice to match.

export const personas = pgTable(
	"personas",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		// Stable, DB-generated identity for export/import dedup — see lorebooks.uuid.
		uuid: uuid("uuid")
			.notNull()
			.default(sql`(gen_random_uuid ())`),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }), // FK to users.id
		isDefault: boolean("is_default").notNull(), // Is this the default persona for the user?
		/** See characters.avatarMediaId. */
		avatarMediaId: integer("avatar_media_id"),
		name: text("name").notNull(), // e.g. 'Warren', 'Master Desir'
		description: text("description").notNull(), // Persona description (long text)
		position: integer("position").default(0),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`), // Created at timestamp
		updatedAt: timestamp("updated_at")
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => new Date()), // Updated at timestamp
		lorebookId: integer("lorebook_id").references(() => lorebooks.id, {
			onDelete: "set null"
		}), // Optional lorebook for this persona
		aliases: json("aliases").notNull().default([]).$type<string[]>(),
		summary: text("summary"),
		creator: text("creator"), // Card creator/author, per Character Card V3 spec
		category: text("category"), // Serene Pub-specific grouping/filter tag
		isDeleted: boolean("is_deleted").notNull().default(false),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at")
	},
	(table) => [
		index("personas_user_id_idx").on(table.userId),
		// Unique per-owner, not globally — see lorebooks_uuid_idx.
		uniqueIndex("personas_uuid_idx").on(table.userId, table.uuid)
	]
)

export const personasRelations = relations(personas, ({ one, many }) => ({
	user: one(users, {
		fields: [personas.userId],
		references: [users.id]
	}),
	lorebook: one(lorebooks, {
		fields: [personas.lorebookId],
		references: [lorebooks.id]
	}),
	personaTags: many(personaTags)
}))

// Sessions (group or 1:1)
export const sessions = pgTable(
	"sessions",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		name: text("name"), // Optional session/group name
		isGroup: boolean("is_group").notNull(), // 1 for group session, 0 for 1:1
		/**
		 * The session's genre (24 §3) — a genre id (`core:genre/chat`), or
		 * transitionally a plugin's shape-bearing input-type id. Every session
		 * has one; the default is the F29 floor, which is also the backfill
		 * for every session created before genres existed. Creation validates
		 * the cast and fields against the genre's declared shape.
		 */
		genreId: text("genre_id").notNull().default("core:genre/chat"),
		/** The session preset this session was born from (23 §9); null = ad-hoc. */
		presetId: integer("preset_id"),
		/**
		 * Values for the genre's declared `fields` (19 §1), keyed by field
		 * name. Rendered in session settings from the shape's SettingsSchema and
		 * supplied back through the input node's published document — the
		 * whole round trip. Keys the genre does not declare are dropped at the
		 * supply side, so a genre switch cannot smuggle stale facts.
		 */
		genreFields: json("genre_fields")
			.notNull()
			.default({})
			.$type<Record<string, unknown>>(),
		sessionType: text("session_type")
			.notNull()
			.default(SessionTypes.ROLEPLAY), // "roleplay" | "summarize"
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: date("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => sql`(CURRENT_TIMESTAMP)`),
		scenario: text("scenario"),
		metadata: json("metadata")
			.notNull()
			.default({})
			.$type<Record<string, any>>(), // JSON for extra settings
		groupReplyStrategy: text("group_reply_strategy").default(
			GroupReplyStrategies.ORDERED
		),
		lorebookId: integer("lorebook_id").references(() => lorebooks.id, {
			onDelete: "set null"
		}),
		connectionId: integer("connection_id").references(
			() => connections.id,
			{ onDelete: "set null" }
		),
		samplingConfigId: integer("sampling_config_id").references(
			() => samplingConfigs.id,
			{ onDelete: "set null" }
		),
		promptConfigId: integer("prompt_config_id").references(
			() => promptConfigs.id,
			{ onDelete: "set null" }
		),
		narratorPromptConfigId: integer("narrator_prompt_config_id").references(
			() => narratorPromptConfigs.id,
			{ onDelete: "set null" }
		),
		drafts: json("drafts")
			.$type<Record<string, string>>()
			.notNull()
			.default({})
	},
	(table) => [index("sessions_user_id_idx").on(table.userId)]
)

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	}),
	sessionMessages: many(sessionMessages),
	sessionPersonas: many(sessionPersonas),
	sessionCharacters: many(sessionCharacters),
	sessionGuests: many(sessionGuests),
	lorebook: one(lorebooks, {
		fields: [sessions.lorebookId],
		references: [lorebooks.id]
	}),
	connection: one(connections, {
		fields: [sessions.connectionId],
		references: [connections.id]
	}),
	samplingConfig: one(samplingConfigs, {
		fields: [sessions.samplingConfigId],
		references: [samplingConfigs.id]
	}),
	promptConfig: one(promptConfigs, {
		fields: [sessions.promptConfigId],
		references: [promptConfigs.id]
	}),
	narratorPromptConfig: one(narratorPromptConfigs, {
		fields: [sessions.narratorPromptConfigId],
		references: [narratorPromptConfigs.id]
	}),
	sessionTags: many(sessionTags),
	scenes: many(scenes)
}))

// Session messages
/**
 * ⚠ LEGACY (20 §1, ruled 2026-08-26). The message model is now `messages` +
 * `message_parts` below; this table is maintained in lockstep by the message
 * store (`server/messages/store.ts`) so readers not yet migrated keep working,
 * and goes read-only once they move. Do not add new writers — every write goes
 * through the store, which mirrors here.
 */
export const sessionMessages = pgTable(
	"session_messages",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		// Nullable + set null (not cascade): this is who SENT the message, not
		// who owns the session it's in — a message can easily belong to a session
		// owned by a different user (a guest's message in someone else's
		// session). Cascading a user delete here would silently wipe messages
		// out of sessions that user doesn't even own; nulling authorship instead
		// (matching characterId/personaId below) preserves the session's history.
		userId: integer("user_id").references(() => users.id, {
			onDelete: "set null"
		}),
		characterId: integer("character_id").references(() => characters.id, {
			onDelete: "set null"
		}), // nullable
		personaId: integer("persona_id").references(() => personas.id, {
			onDelete: "set null"
		}), // nullable
		role: text("role").notNull(), // 'user', 'character', 'system', etc
		// True for a manually-triggered Narrator response (narration/environment
		// flavor, not a character) — characterId/personaId stay null, role stays
		// "assistant" so existing history-building code keeps including it.
		isNarratorResponse: boolean("is_narrator_response")
			.notNull()
			.default(false),
		content: text("content").notNull(),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: timestamp("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => new Date()),
		isEdited: boolean("is_edited").notNull().default(false), // 1 if edited, 0 otherwise
		metadata: json("metadata").notNull().default({}).$type<{
			isGreeting?: boolean
			swipes?: {
				currentIdx: number | null
				history: string[]
				thinkingHistory?: (string | null)[]
			}
			// Native model thinking content (e.g. Ollama `think: true`) for the
			// message's currently-active swipe — mirrors swipes.thinkingHistory[currentIdx],
			// kept denormalized here since that's what SessionMessage.svelte reads.
			thinking?: string | null
			narratorInstructions?: string // Optional extra focus text for a Narrator response generation
			narratorName?: string // Display name resolved at generation time for a Narrator response message (e.g. "Narrator")
		}>(), // JSON for extra info
		isGenerating: boolean("is_generating").notNull().default(false), // 1 if processing, 0 otherwise
		generationStage: text("generation_stage"), // 'queued' | 'loading' | 'generating' | null; only meaningful while isGenerating
		error: json("error").$type<{ message: string; code?: string } | null>(),
		queueItemId: text("queue_item_id"), // UUID of the current llmQueue item, nullable
		isHidden: boolean("is_hidden").notNull().default(false), // Whether this message is processed or not
		debugMeta: json("debug_meta").$type<Record<string, any>>(),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at")
	},
	// The single hottest query in the app — every session load filters by this.
	(table) => [index("session_messages_session_id_idx").on(table.sessionId)]
)

export const sessionMessagesRelations = relations(
	sessionMessages,
	({ one }) => ({
		session: one(sessions, {
			fields: [sessionMessages.sessionId],
			references: [sessions.id]
		}),
		user: one(users, {
			fields: [sessionMessages.userId],
			references: [users.id]
		}),
		character: one(characters, {
			fields: [sessionMessages.characterId],
			references: [characters.id]
		}),
		persona: one(personas, {
			fields: [sessionMessages.personaId],
			references: [personas.id]
		})
	})
)

/**
 * The message model (20 §1, ruled 2026-08-26): a message is a *folder* —
 * identity, position, lane — and its content lives in `message_parts`,
 * addressed by (step, revision, ordinal).
 *
 *  - **step accumulates**: phases of a stepped activity render side by side.
 *  - **revision excludes**: alternatives of one step; exactly one shows.
 *  - Today's swipes are revisions of step 0 — the degenerate coordinates,
 *    not a different mode.
 *
 * **The freeze rule:** only the latest step is swipeable; generating step N+1
 * freezes step N's selection at the revision that produced it. Step-back is
 * destructive to later steps, confirmed.
 *
 * **The map invariant:** `active_revisions` ⇄ parts stay in sync because the
 * message store is the single writer; a key with no matching parts is a bug
 * the store's tests pin, never a state to tolerate.
 */
export const messages = pgTable(
	"messages",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		/** Filter lane within a session; the mode declares the set (20 §7). */
		channel: text("channel").notNull().default("main"),
		/** Namespaced activity kind — `core:chat`, `core:narration`, a plugin's. */
		kind: text("kind").notNull().default("core:chat"),
		/**
		 * Row-shape version. Nullable with NO database default, written "1.0"
		 * by every creating code path (migration included) — the null/value
		 * split is the upgrade hook for a future shape change.
		 */
		version: text("version"),
		userId: integer("user_id").references(() => users.id, {
			onDelete: "set null"
		}),
		characterId: integer("character_id").references(() => characters.id, {
			onDelete: "set null"
		}),
		personaId: integer("persona_id").references(() => personas.id, {
			onDelete: "set null"
		}),
		/** Resolved-at-write display name — retires `isNarratorResponse`. */
		speakerLabel: text("speaker_label"),
		/** Prompt-side role: user | assistant | system. */
		role: text("role").notNull(),
		/** Lifecycle of the *latest* step; earlier steps are frozen-settled. */
		status: text("status").notNull().default("settled"),
		error: json("error").$type<{ message: string; code?: string } | null>(),
		/** Which revision shows, per step — `{"0": 1}`. See the freeze rule. */
		activeRevisions: json("active_revisions")
			.notNull()
			.default({ "0": 0 })
			.$type<Record<string, number>>(),
		/** Namespaced per-plugin data — the surface/`match` key (20 §1). */
		extras: json("extras")
			.notNull()
			.default({})
			.$type<Record<string, unknown>>(),
		isHidden: boolean("is_hidden").notNull().default(false),
		isEdited: boolean("is_edited").notNull().default(false),
		debugMeta: json("debug_meta").$type<Record<string, any>>(),
		queueItemId: text("queue_item_id"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [
		index("messages_session_id_idx").on(t.sessionId),
		index("messages_session_channel_idx").on(t.sessionId, t.channel)
	]
)

/**
 * Everything renderable. Self-ordering: (step, revision, ordinal) lives on the
 * row, so render order is reconstructible from parts alone. `content` is the
 * text for textual types; `data` carries structure (block trees, field
 * schemas, asset refs). An unknown `type` (plugin absent) renders as a
 * collapsed labeled section — uninstalling strands nothing (20 §2).
 */
export const messageParts = pgTable(
	"message_parts",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		messageId: integer("message_id")
			.notNull()
			.references(() => messages.id, { onDelete: "cascade" }),
		step: integer("step").notNull().default(0),
		revision: integer("revision").notNull().default(0),
		ordinal: integer("ordinal").notNull().default(0),
		/** `core:markdown | core:thinking | core:section | core:image | …` */
		type: text("type").notNull(),
		content: text("content"),
		data: json("data").$type<Record<string, unknown> | null>()
	},
	(t) => [
		uniqueIndex("message_parts_addr_idx").on(
			t.messageId,
			t.step,
			t.revision,
			t.ordinal
		)
	]
)

/**
 * A logical file and its metadata (0182).
 *
 * **THE ONLY TABLE READ TO BUILD A CLIENT PAYLOAD.** One row per logical file,
 * one uuid shared by every representation of it; the bytes live in `variants`.
 * A render site loads this row, builds a URL, and stops — the HTTP handler
 * works out which variant that means and derives it if it is missing. Putting a
 * variant lookup back on that path is the one change this split exists to
 * prevent.
 *
 * **Why the split.** One row per representation could not answer the question a
 * render site actually asks. A payload needed the original row AND a second
 * query for its thumbnail; a thumbnail had to leave all four provenance columns
 * NULL so `mediaFor(character)` would not return it; and `visibility` had to be
 * written twice to keep a derivative in step. Three symptoms of one table doing
 * two jobs.
 *
 * **Provenance, not role.** The `userId`/`characterId`/`personaId`/`sessionId`/
 * `messageId` columns say what a file *belongs to*; they never say what it is
 * *for*. Roles are read off inbound relations instead — a character's avatar is
 * `characters.avatarMediaId` pointing at a row here, an emotion sprite will be
 * whatever the emotions row points at. That inverse is deliberate: the number
 * of roles grows over time, the number of parent kinds does not, so a new role
 * costs a column on the thing that owns it and never a migration here.
 *
 * **No foreign keys, no cascade, no set null** (28 §2, ruled). Deleting a
 * character leaves its files behind, still stamped with that character's id —
 * which is the whole point. A stale id keeps an orphan *groupable*, so "these
 * 34 files belonged to a character you deleted" stays an answerable question
 * and deleting them stays a safe operation. Under cascade the rows vanish and
 * the files become an unattributable pile.
 *
 * The cost, stated so it is not a surprise: the database enforces nothing about
 * file references. A dangling `avatarMediaId` is possible and renders as a
 * missing image. Integrity lives in the application and in the cleanup tool.
 *
 * A path is NEVER serialised to a non-admin client — and since 0182 a path only
 * exists on a `variants` row that no payload builder ever loads, so that is now
 * structural rather than a rule someone has to remember.
 */
export const files = pgTable(
	"files",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

		/**
		 * The public address — `/media/{uuid}`. ONE uuid per logical file now,
		 * shared across variants, and it no longer rotates: `rev` below carries
		 * cache invalidation instead. A uuid that rotated per-variant could not
		 * be shared, and sharing it is what lets a render site address the
		 * thumbnail of a file it holds without a second query.
		 */
		uuid: uuid("uuid")
			.notNull()
			.unique()
			.default(sql`(gen_random_uuid ())`),

		/**
		 * Cache token. `/media/{uuid}?v=…&r={rev}` is immutable for a year, so
		 * the URL string has to change whenever the bytes behind it do.
		 *
		 * Bumped ONLY when an EXISTING variant's bytes change, or when
		 * `display_variant_id` is re-pointed. Deriving a variant that did not
		 * exist does not bump (nothing already served changed) and neither does
		 * culling one (the others' bytes are untouched).
		 *
		 * The handler IGNORES the value it is sent. `rev`'s job is to make the
		 * string differ, not to be validated — rejecting a stale `r` would turn
		 * a client holding an old URL into a broken image instead of a stale
		 * one.
		 */
		rev: integer("rev").notNull().default(0),

		/**
		 * Which variant a bare `/media/{uuid}` serves — a STORED POINTER, never
		 * a request-time comparison.
		 *
		 * Smallest-wins among equal-fidelity representations has to be decided
		 * once and remembered: if the handler compared sizes live, deriving a
		 * smaller variant would change what an already-cached immutable URL
		 * serves without changing the URL. Re-pointing this IS such a change,
		 * so it bumps `rev` — the one deliberate exception to "deriving does not
		 * bump", and consistent with the rule, because served bytes changed.
		 *
		 * MAY POINT AT THE ORIGINAL ROW. When the upload is already web-safe
		 * (png/jpeg/webp/gif) it IS the display form and no second copy exists;
		 * the two roles are not mutually exclusive.
		 *
		 * Plain integer, not an FK — the same ruling as the provenance columns,
		 * and here it also avoids a cycle: `variants.file_id` points back, so a
		 * real FK in both directions would make the first insert of either row
		 * impossible without a deferred constraint. `cullVariant` is what keeps
		 * this pointing at something that exists.
		 */
		displayVariantId: integer("display_variant_id"),

		/**
		 * The display variant's mime and byte length, denormalised.
		 *
		 * Written in the same statement as `display_variant_id`, never apart.
		 * They exist ONLY because a payload must be one row: mime and bytes are
		 * variant-level facts that six client consumers read, and either joining
		 * for them or dropping them were both worse. Do not "clean up" this
		 * duplication — doing so puts a query back on the render path.
		 */
		displayMime: text("display_mime"),
		displayBytes: integer("display_bytes"),

		// ---- Provenance. Plain integers by ruling; no FKs, no cascade, so a
		// stale id keeps an orphan groupable. A VARIANT HAS NONE OF THESE — that
		// is what makes a variant structurally unreachable by a provenance
		// query, and it replaces the old trick of leaving a thumbnail's four
		// columns NULL so `mediaFor(character)` would not match it.
		userId: integer("user_id").notNull(),
		characterId: integer("character_id"),
		personaId: integer("persona_id"),
		sessionId: integer("session_id"),
		messageId: integer("message_id"),

		/** scoped | private — see MEDIA_VISIBILITY. Lives here and only here, so
		 *  there is no per-variant copy to fall out of step. */
		visibility: text("visibility").notNull().default("scoped"),

		/** image | document | audio | video | other. Derived from the original's
		 *  mime at insert and stored, so "every document" is an index scan
		 *  rather than a string parse. */
		kind: text("kind").notNull(),

		/**
		 * sha256 of the ORIGINAL bytes, hex. FILE IDENTITY — this is what a
		 * re-upload matches on. Each variant row carries its own hash for its
		 * own bytes; the duplication with the original variant's hash is
		 * deliberate, because identity and an ETag are different questions.
		 */
		hash: text("hash").notNull(),

		/** The uploader's filename. Display metadata — never resolved, never any
		 *  part of a path. */
		filename: text("filename"),

		width: integer("width"),
		height: integer("height"),
		/**
		 * Milliseconds, when the source has a time dimension. Integer ms rather
		 * than float seconds because GIF frame delays are centiseconds and an
		 * exact comparison is the point; the SDK's `MediaRef.duration` is
		 * seconds, so the boundary divides.
		 *
		 * NON-NULL IS THE SIGNAL THAT TIME EXISTS, and that is what makes a
		 * silent flatten detectable. Populated for an animated GIF at upload;
		 * NULL for audio/video, which need a probe this project has no codec
		 * for.
		 */
		durationMs: integer("duration_ms"),

		/** Ordering within its group — replaces the gallery tables' only real
		 *  function (drag-to-reorder). */
		position: integer("position").notNull().default(0),

		/**
		 * How this was made, when something made it (0173).
		 *
		 * The columns above record provenance as *relationships*, because that
		 * is what access and cleanup are decided by — and none of them can say
		 * "SDXL, 25 steps, CFG 5, seed 819442027, this prompt", which is the
		 * whole question a person asks about a generated image afterwards: they
		 * got one they liked and want another like it.
		 *
		 * Opaque on purpose. The fields worth keeping differ per backend and
		 * will keep changing, and nothing branches on any of it — written once
		 * at generation, read back for display. NOT authoritative for anything;
		 * access is decided above, and NULL (an image somebody uploaded) is the
		 * common case.
		 *
		 * On the FILE, not a variant: it describes how the logical image came to
		 * exist, which no re-encode of it changes.
		 */
		meta: json("meta").$type<Record<string, unknown> | null>(),
		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(t) => [
		// Dedupe is per-user, not per-instance: instance-wide would make one
		// user's upload observable to another by hash timing, and would put a
		// blob's lifetime under an account that no longer references it. No
		// `variant` in the key any more — a variant is not a file.
		uniqueIndex("files_user_hash_unique").on(t.userId, t.hash),
		index("files_character_idx").on(t.characterId),
		index("files_persona_idx").on(t.personaId),
		index("files_session_idx").on(t.sessionId),
		index("files_message_idx").on(t.messageId),
		check(
			"files_visibility_check",
			sql`${t.visibility} IN ('scoped', 'private')`
		)
	]
)

/**
 * The bytes actually on disk (0182). Never queried to build a payload.
 *
 * `is_original` and `cache` are separate questions and one row can answer both
 * in the combination that matters: a web-safe upload is the original AND the
 * display form, so `is_original` true with `cache` false. The display form is
 * NOT a cache entry — it is the default client-side representation of the file,
 * and the derived-form cleanup must never touch it.
 *
 * ## Culling, which is the one place this can destroy user data
 *
 * Three risk classes, and note which of them is not cache:
 *
 *   - the DISPLAY form — `cache` FALSE, whether it is a converted WebP or the
 *     original itself. Never touched by the derived-form sweep.
 *   - the ORIGINAL (`is_original`, `cache` false) — cullable, but only by the
 *     explicit destructive action, and IRREPLACEABLE once gone. A request for
 *     it afterwards falls back to the display form rather than 404ing.
 *   - derived forms — `cache` TRUE. Freely cullable, always re-derivable.
 *
 * **NEVER CULL THE LAST SURVIVING REPRESENTATION OF A FILE, and that is
 * enforced in `cullVariant` rather than in the UI.** Lazy derivation is what
 * makes the general form necessary: on a freshly uploaded file that has never
 * been requested, the original is the ONLY row *and* the display target, so
 * culling it would leave the file with nothing. A UI-only guard cannot hold
 * that, because "cull originals" and "cull cache" are two clicks and an admin
 * may make them in either order — checked per call, in code, the order stops
 * mattering. Culling the display target additionally requires another
 * full-fidelity row to re-point at, and re-pointing bumps `files.rev`, because
 * the bare URL's bytes just changed.
 */
export const variants = pgTable(
	"variants",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

		/** Its file. No FK, matching the provenance ruling above — deletion is
		 *  explicit in `deleteFile`, which is the only thing allowed to leave a
		 *  file with no variants. */
		fileId: integer("file_id").notNull(),

		/**
		 * A CLOSED enum — see `MediaVariant`. It reaches a path builder, so free
		 * text here is a path-traversal surface; the CHECK below is the backstop
		 * for the validation the route does at the boundary.
		 */
		variant: text("variant").notNull(),

		mime: text("mime").notNull(),
		bytes: integer("bytes").notNull(),
		/** Relative to the data dir. THE ONLY PLACE A PATH LIVES — never
		 *  serialised to a non-admin client. Never spread this row into a
		 *  response. */
		path: text("path").notNull(),
		/** sha256 of THESE bytes. The ETag the route serves. */
		hash: text("hash").notNull(),
		width: integer("width"),
		height: integer("height"),

		/** The bytes the user or the backend actually gave us. Irreplaceable. */
		isOriginal: boolean("is_original").notNull().default(false),
		/** Safe to cull, because it can be re-derived. FALSE on an original and
		 *  FALSE on a converted display form. */
		cache: boolean("cache").notNull().default(false),

		/**
		 * full | reduced. Only `full` rows compete for the display pointer.
		 *
		 * Everything stored today is lossless or an untouched original, so
		 * smallest-wins is free — but the moment somebody adds a lossy payload
		 * transcode, "serve the smallest" would start shipping degraded images
		 * to every user, and it would read as a caching bug rather than a
		 * selection bug. This column is what stops that.
		 */
		fidelity: text("fidelity").notNull().default("full"),

		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(t) => [
		// One row per (file, variant): the race backstop for concurrent
		// derivation, and what makes `onConflictDoNothing` correct.
		uniqueIndex("variants_file_variant_unique").on(t.fileId, t.variant),
		index("variants_file_idx").on(t.fileId),
		// The cleanup sweep's whole query is "every cullable row".
		index("variants_cache_idx").on(t.cache),
		check(
			"variants_variant_check",
			sql`${t.variant} IN ('original', 'display', 'thumb')`
		),
		check(
			"variants_fidelity_check",
			sql`${t.fidelity} IN ('full', 'reduced')`
		)
	]
)

// `session_assets` was folded into `media` by 28 — a session attachment is a
// file stamped with a `sessionId` — and `media` became `files` + `variants` by
// 0182. `$lib/server/messages/assets.ts` keeps the old function names as thin
// wrappers so message code did not have to move either time.

export const messagesRelations = relations(messages, ({ one, many }) => ({
	session: one(sessions, {
		fields: [messages.sessionId],
		references: [sessions.id]
	}),
	parts: many(messageParts)
}))

export const messagePartsRelations = relations(messageParts, ({ one }) => ({
	message: one(messages, {
		fields: [messageParts.messageId],
		references: [messages.id]
	})
}))

// Many-to-many: sessions <-> personas
export const sessionPersonas = pgTable(
	"session_personas",
	{
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		personaId: integer("persona_id").references(() => personas.id, {
			onDelete: "set null"
		}),
		position: integer("position").default(0), // Position in the session
		// Soft-delete: set when this participant is removed from the session so
		// past messages can still resolve a speaker name. Null = active.
		removedAt: timestamp("removed_at"),
		// Snapshot of the persona's name at removal time, for the case where
		// the persona is later deleted globally (personaId nulls out via
		// onDelete: "set null") and no live name is available anymore.
		removedName: text("removed_name")
	},
	(table) => [
		uniqueIndex("session_personas_pk").on(table.sessionId, table.personaId),
		// canViewPersona() looks up sessionPersonas by personaId alone.
		index("session_personas_persona_id_idx").on(table.personaId)
	]
)

export const sessionPersonasRelations = relations(
	sessionPersonas,
	({ one }) => ({
		session: one(sessions, {
			fields: [sessionPersonas.sessionId],
			references: [sessions.id]
		}),
		persona: one(personas, {
			fields: [sessionPersonas.personaId],
			references: [personas.id]
		})
	})
)

// Many-to-many: sessions <-> characters
export const sessionCharacters = pgTable(
	"session_characters",
	{
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		characterId: integer("character_id").references(() => characters.id, {
			onDelete: "set null"
		}),
		position: integer("position").default(0), // Position in the session
		isActive: boolean("is_active").notNull().default(true), // 1 if active in session, 0 if not
		// Character visibility optimization setting
		visibility: text("visibility")
			.notNull()
			.default(SessionCharacterVisibility.VISIBLE), // Controls how much character info is shown when not responding
		// Soft-delete: set when this participant is removed from the session so
		// past messages can still resolve a speaker name. Null = active.
		removedAt: timestamp("removed_at"),
		// Snapshot of the character's name at removal time, for the case where
		// the character is later deleted globally (characterId nulls out via
		// onDelete: "set null") and no live name is available anymore.
		removedName: text("removed_name")
	},
	(table) => [
		uniqueIndex("session_characters_pk").on(
			table.sessionId,
			table.characterId
		),
		// canViewCharacter() looks up sessionCharacters by characterId alone.
		index("session_characters_character_id_idx").on(table.characterId)
	]
)

export const sessionCharactersRelations = relations(
	sessionCharacters,
	({ one }) => ({
		session: one(sessions, {
			fields: [sessionCharacters.sessionId],
			references: [sessions.id]
		}),
		character: one(characters, {
			fields: [sessionCharacters.characterId],
			references: [characters.id]
		})
	})
)

// Many-to-many: sessions <-> lorebooks
export const sessionLorebooks = pgTable(
	"session_lorebooks",
	{
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		position: integer("position").default(0) // Optional: position/order in the session
	},
	(table) => ({})
)

export const sessionLorebooksRelations = relations(
	sessionLorebooks,
	({ one }) => ({
		session: one(sessions, {
			fields: [sessionLorebooks.sessionId],
			references: [sessions.id]
		}),
		lorebook: one(lorebooks, {
			fields: [sessionLorebooks.lorebookId],
			references: [lorebooks.id]
		})
	})
)

// Many-to-many: sessions <-> users (guests)
export const sessionGuests = pgTable(
	"session_guests",
	{
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		isPlayer: boolean("is_player").notNull().default(true)
	},
	(table) => ({
		pk: uniqueIndex("session_guests_pk").on(table.sessionId, table.userId)
	})
)

export const sessionGuestsRelations = relations(sessionGuests, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionGuests.sessionId],
		references: [sessions.id]
	}),
	user: one(users, {
		fields: [sessionGuests.userId],
		references: [users.id]
	})
}))

/**
 * Singleton table for system-wide settings
 */
export const systemSettings = pgTable("system_settings", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/**
	 * The one active embedding connection, site-wide (20 §14) — embeddings are
	 * an instance property, not a per-session choice, because every stored
	 * vector must come from one model to be comparable. Changing it triggers
	 * the 13 §8 re-embed (background, resumable), never a refusal or a silent
	 * orphaning.
	 *
	 * ⚠ Not folded into `connection_defaults` alongside the two columns 0181
	 * dropped, and that is a decision rather than an oversight. It is written
	 * once by `migrateEmbeddingConnection` and read by nothing at runtime, so it
	 * is not a second spelling anybody can trip over — while folding it needs a
	 * setter that carries the re-embed above, and no such setter exists. It
	 * moves when the embedding path reads a capability default and that setter
	 * is written; until then, dropping it would silently discard a user's
	 * embedding model choice mid-upgrade.
	 */
	activeEmbeddingConnectionId: integer(
		"active_embedding_connection_id"
	).references(() => connections.id, { onDelete: "set null" }),
	lockConnection: boolean("lock_connection").notNull().default(false),
	// The instance default connection and sampling config lived here as
	// `default_connection_id` / `default_sampling_id`, and the per-modality
	// image pair joined them in 0172. All of it is in `connection_defaults` now,
	// keyed by capability (0181): a column pair per capability does not scale to
	// an open capability space, every new one would have been a migration, and
	// while both spellings existed every star press had to write both.
	lockSamplingConfig: boolean("lock_sampling_config")
		.notNull()
		.default(false),
	/**
	 * ⚠ Superseded by `pipeline_config_selections` at instance scope.
	 *
	 * One column per namespace is the shape that cannot survive an extension
	 * shipping its own pipeline — there is no column for a namespace core did not
	 * know about, and adding one is a core migration. A selection row keys on the
	 * spec, so every namespace works including a plugin's, and the same table
	 * covers user and session scope instead of only this one.
	 *
	 * Kept, not dropped: the legacy run path still reads these, and they are what
	 * the config migration reads *from*. Remove them once nothing does.
	 */
	defaultContextConfigId: integer("default_context_config_id").references(
		() => contextConfigs.id,
		{
			onDelete: "set null"
		}
	),
	lockContextConfig: boolean("lock_context_config").notNull().default(false),
	/**
	 * ⚠ Superseded by `pipeline_config_selections` at instance scope.
	 *
	 * One column per namespace is the shape that cannot survive an extension
	 * shipping its own pipeline — there is no column for a namespace core did not
	 * know about, and adding one is a core migration. A selection row keys on the
	 * spec, so every namespace works including a plugin's, and the same table
	 * covers user and session scope instead of only this one.
	 *
	 * Kept, not dropped: the legacy run path still reads these, and they are what
	 * the config migration reads *from*. Remove them once nothing does.
	 */
	defaultPromptConfigId: integer("default_prompt_config_id").references(
		() => promptConfigs.id,
		{
			onDelete: "set null"
		}
	),
	lockPromptConfig: boolean("lock_prompt_config").notNull().default(false),
	/**
	 * ⚠ Superseded by `pipeline_config_selections` at instance scope.
	 *
	 * One column per namespace is the shape that cannot survive an extension
	 * shipping its own pipeline — there is no column for a namespace core did not
	 * know about, and adding one is a core migration. A selection row keys on the
	 * spec, so every namespace works including a plugin's, and the same table
	 * covers user and session scope instead of only this one.
	 *
	 * Kept, not dropped: the legacy run path still reads these, and they are what
	 * the config migration reads *from*. Remove them once nothing does.
	 */
	defaultNarratorPromptConfigId: integer(
		"default_narrator_prompt_config_id"
	).references(() => narratorPromptConfigs.id, { onDelete: "set null" }),
	isAccountsEnabled: boolean("is_accounts_enabled").notNull().default(false),
	/**
	 * Every account must carry a second factor (27 §4). Enforced through the
	 * setup gate, so a user without one is walked through enrolment rather
	 * than locked out.
	 */
	requireTwoFactor: boolean("require_two_factor").notNull().default(false),
	/**
	 * SHA-256 of the last `SERENE_PUB_RECOVERY_KEY` that was applied (26 §10,
	 * tier 3). One column is the entire one-time-use mechanism: on boot, a key
	 * whose hash differs from this is applied and recorded; a key that matches
	 * has already been used and is ignored, so the variables can sit in `.env`
	 * inertly instead of reverting the user's password on every restart.
	 *
	 * A hash, not the key: it is an operator-chosen secret and there is no
	 * reason to keep it readable at rest.
	 */
	recoveryKeyHash: text("recovery_key_hash"),
	vectorizationEnabled: boolean("vectorization_enabled")
		.notNull()
		.default(false),
	embeddingModelName: text("embedding_model_name"),
	embeddingModelDimensions: integer("embedding_model_dimensions"),
	summarizationEnabled: boolean("summarization_enabled")
		.notNull()
		.default(false),
	/**
	 * The scripts kill switch (18 §10, §13.3 — ruled: default **on**). Unlike
	 * plugins, nothing executes until an admin authors or imports a script, so
	 * this is a recovery lever rather than a gate: off returns every run to
	 * vanilla instantly, with every chain and attachment kept in place.
	 */
	scriptsEnabled: boolean("scripts_enabled").notNull().default(true),
	contextDebuggingEnabled: boolean("context_debugging_enabled")
		.notNull()
		.default(false),
	/**
	 * Compile prompts through the pipeline instead of `PromptBuilder`.
	 *
	 * Off by default and deliberately so: the two paths are byte-identical
	 * across the parity corpus, which is a strong claim about the cases someone
	 * wrote fixtures for and says nothing about a lorebook nobody imagined.
	 * `npm run pipeline:compare` answers that for a given instance, and this
	 * flag is what an admin flips once it has.
	 *
	 * Only the *prompt* changes hands. Queueing, streaming, persistence, swipes
	 * and thinking extraction stay with the code that already handles them —
	 * the pipeline hands over a compiled payload at the one seam every adapter
	 * funnels through, so everything downstream is untouched legacy code.
	 */
	/**
	 * ⚠ Transitional, and **not a long-term choice an admin makes**.
	 *
	 * There is no legacy-versus-pipeline switch in the destination: pipelines
	 * become the only path that compiles a reply. This gates the changeover
	 * while the remaining specs are built, and comes out with the last of them.
	 * Nothing new should branch on it.
	 */
	pipelinesEnabled: boolean("pipelines_enabled").notNull().default(false),
	/**
	 * Show the legacy Prompt Configs sidebar, read-only.
	 *
	 * The one toggle that survives the changeover. Configuration moves to the
	 * pipeline view, but a user who spent a year tuning prompt configs needs to
	 * be able to *read* what they had — during the migration to check it landed,
	 * and afterwards to consult a wording they have not re-created yet.
	 *
	 * Defaults on, because the alternative is that upgrading hides a year of
	 * someone's work behind a setting they do not know exists. The legacy tables
	 * themselves go in 0.8.0; this is what keeps them legible until then.
	 */
	legacyPromptConfigsVisible: boolean("legacy_prompt_configs_visible")
		.notNull()
		.default(true),
	/**
	 * ⚠ Superseded by `pipeline_config_selections` at instance scope.
	 *
	 * One column per namespace is the shape that cannot survive an extension
	 * shipping its own pipeline — there is no column for a namespace core did not
	 * know about, and adding one is a core migration. A selection row keys on the
	 * spec, so every namespace works including a plugin's, and the same table
	 * covers user and session scope instead of only this one.
	 *
	 * Kept, not dropped: the legacy run path still reads these, and they are what
	 * the config migration reads *from*. Remove them once nothing does.
	 */
	defaultSummarizeWorldConfigId: integer(
		"default_summarize_world_config_id"
	).references(() => worldSummarizeConfigs.id, { onDelete: "set null" }),
	/**
	 * ⚠ Superseded by `pipeline_config_selections` at instance scope.
	 *
	 * One column per namespace is the shape that cannot survive an extension
	 * shipping its own pipeline — there is no column for a namespace core did not
	 * know about, and adding one is a core migration. A selection row keys on the
	 * spec, so every namespace works including a plugin's, and the same table
	 * covers user and session scope instead of only this one.
	 *
	 * Kept, not dropped: the legacy run path still reads these, and they are what
	 * the config migration reads *from*. Remove them once nothing does.
	 */
	defaultSummarizeCharacterConfigId: integer(
		"default_summarize_character_config_id"
	).references(() => characterSummarizeConfigs.id, { onDelete: "set null" }),
	/**
	 * ⚠ Superseded by `pipeline_config_selections` at instance scope.
	 *
	 * One column per namespace is the shape that cannot survive an extension
	 * shipping its own pipeline — there is no column for a namespace core did not
	 * know about, and adding one is a core migration. A selection row keys on the
	 * spec, so every namespace works including a plugin's, and the same table
	 * covers user and session scope instead of only this one.
	 *
	 * Kept, not dropped: the legacy run path still reads these, and they are what
	 * the config migration reads *from*. Remove them once nothing does.
	 */
	defaultSummarizeSceneConfigId: integer(
		"default_summarize_scene_config_id"
	).references(() => sceneSummarizeConfigs.id, { onDelete: "set null" }),
	/**
	 * ⚠ Superseded by `pipeline_config_selections` at instance scope.
	 *
	 * One column per namespace is the shape that cannot survive an extension
	 * shipping its own pipeline — there is no column for a namespace core did not
	 * know about, and adding one is a core migration. A selection row keys on the
	 * spec, so every namespace works including a plugin's, and the same table
	 * covers user and session scope instead of only this one.
	 *
	 * Kept, not dropped: the legacy run path still reads these, and they are what
	 * the config migration reads *from*. Remove them once nothing does.
	 */
	defaultGraphBuildConfigId: integer(
		"default_graph_build_config_id"
	).references(() => graphBuildConfigs.id, { onDelete: "set null" }),
	// Admin-configured CharaVault account, shared instance-wide across all
	// users (not a per-user credential). Never sent to the client — see
	// systemSettingsGet's column exclusions.
	charaVaultEmail: text("chara_vault_email"),
	charaVaultEncryptedToken: text("chara_vault_encrypted_token"),
	charaVaultTokenIv: text("chara_vault_token_iv"),
	charaVaultTokenAuthTag: text("chara_vault_token_auth_tag"),
	/**
	 * Whether `migrateContextTemplates` has run.
	 *
	 * A ledger flag rather than a re-derived condition, and that distinction is
	 * the whole reason the column exists. That migration carries each scope's
	 * context config into `pipeline_context_templates` and, where the template
	 * is one somebody wrote, pins that scope's variable layouts to the bare
	 * rows so the heading is not written twice.
	 *
	 * Both halves have to happen once. The obvious alternative — re-checking
	 * each boot whether the selected template is core's — quietly re-pins
	 * anyone who resets that setting on purpose, so the panel would keep
	 * reverting with nothing on screen saying why. A migration that has run is
	 * a fact about the database, and this is where that fact lives.
	 */
	contextTemplatesMigrated: boolean("context_templates_migrated")
		.notNull()
		.default(false)
})

export const systemSettingsRelations = relations(systemSettings, ({ one }) => ({
	// `defaultConnection` and `defaultSamplingConfig` were here. Their columns
	// are gone (0181); the relation to walk is `connectionDefaults`, whose row
	// is keyed by capability rather than assumed to be the text one.
	defaultContextConfig: one(contextConfigs, {
		fields: [systemSettings.defaultContextConfigId],
		references: [contextConfigs.id]
	}),
	defaultPromptConfig: one(promptConfigs, {
		fields: [systemSettings.defaultPromptConfigId],
		references: [promptConfigs.id]
	}),
	defaultNarratorPromptConfig: one(narratorPromptConfigs, {
		fields: [systemSettings.defaultNarratorPromptConfigId],
		references: [narratorPromptConfigs.id]
	}),
	defaultSummarizeWorldConfig: one(worldSummarizeConfigs, {
		fields: [systemSettings.defaultSummarizeWorldConfigId],
		references: [worldSummarizeConfigs.id]
	}),
	defaultSummarizeCharacterConfig: one(characterSummarizeConfigs, {
		fields: [systemSettings.defaultSummarizeCharacterConfigId],
		references: [characterSummarizeConfigs.id]
	}),
	defaultSummarizeSceneConfig: one(sceneSummarizeConfigs, {
		fields: [systemSettings.defaultSummarizeSceneConfigId],
		references: [sceneSummarizeConfigs.id]
	}),
	defaultGraphBuildConfig: one(graphBuildConfigs, {
		fields: [systemSettings.defaultGraphBuildConfigId],
		references: [graphBuildConfigs.id]
	})
}))

export const ollamaSettings = pgTable("ollama_settings", {
	id: integer("id").primaryKey().default(1),
	ollamaManagerEnabled: boolean("ollama_manager_enabled")
		.notNull()
		.default(false),
	ollamaManagerBaseUrl: text("ollama_base_url")
		.notNull()
		.default("http://localhost:11434/")
})

export const koboldCppSettings = pgTable("koboldcpp_settings", {
	id: integer("id").primaryKey().default(1),
	koboldCppManagerEnabled: boolean("koboldcpp_manager_enabled")
		.notNull()
		.default(false),
	koboldCppManagerBaseUrl: text("koboldcpp_base_url")
		.notNull()
		.default("http://localhost:5001"),
	koboldCppManagerModelsDir: text("koboldcpp_models_dir"),
	/**
	 * Where image models live, or NULL to use `koboldcpp_models_dir`.
	 *
	 * NULL is the upgrade contract, not a missing value: an install that has one
	 * flat directory today keeps finding every model it already has, in place,
	 * with nothing moved. Fresh installs are seeded <appdata>/models/image beside
	 * the existing models/llm; an existing row is deliberately left NULL and never
	 * backfilled, because backfilling would point new downloads somewhere the
	 * user's existing models are not.
	 *
	 * Reads fall back across both directories (modelsDir.ts). Writes never do.
	 */
	koboldCppImageModelsDir: text("koboldcpp_image_models_dir"),
	koboldCppManagedMode: text("koboldcpp_managed_mode"), // null | "managed" | "external"
	koboldCppManagedBinaryVariant: text("koboldcpp_managed_binary_variant"),
	koboldCppManagedBinaryDir: text("koboldcpp_managed_binary_dir"),
	koboldCppManagedPort: integer("koboldcpp_managed_port")
		.notNull()
		.default(5001),
	koboldCppManagedAdminPassword: text("koboldcpp_managed_admin_password"),
	koboldCppManagedModelTtlSecs: integer("koboldcpp_managed_model_ttl_secs")
		.notNull()
		.default(300),
	koboldCppManagedSubprocessTimeoutSecs: integer(
		"koboldcpp_managed_subprocess_timeout_secs"
	)
		.notNull()
		.default(1800),
	koboldCppManagedReleaseTag: text("koboldcpp_managed_release_tag")
})

// Tracks the model files in the KoboldCPP models directories — .gguf and
// .safetensors, of two kinds (a text LLM or a Stable-Diffusion image model) —
// whether downloaded through the UI or placed there manually. Rows for
// manually-placed files are created on discovery during a koboldcpp:listModels
// scan. Models with status != "complete" (still downloading, or errored) are
// excluded from the available models list.
//
// `filename` stays UNIQUE now that there are two directories to scan, so one
// file named `foo.gguf` in EACH of them is a single row whose kind/size/
// description are whichever directory the scan wrote last. Accepted rather than
// fixed: a composite key would ripple into ~10 `eq(filename)` queries, every
// socket param, and `connections.model` — which stores a bare filename. The
// damage is bounded to metadata, because `resolveModelPath` tries the kind's
// own directory FIRST: the text connection still loads llm/foo.gguf and the
// image connection still loads image/foo.gguf. Renaming one fixes the display.
export const koboldCppModels = pgTable("koboldcpp_models", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	filename: text("filename").notNull().unique(),
	modelName: text("model_name").notNull(),
	modelUrl: text("model_url"),
	downloadUrl: text("download_url"),
	description: text("description"),
	quantization: text("quantization"),
	sizeBytes: bigint("size_bytes", { mode: "number" }),
	status: text("status").notNull().default("downloading"), // "downloading" | "complete" | "error"
	errorMessage: text("error_message"),
	/**
	 * "text" | "image" | "unknown". Never inferred from the extension: the
	 * curated image models at huggingface.co/koboldcpp/imgmodel are every one
	 * of them .gguf.
	 */
	kind: text("kind")
		.notNull()
		.default("text")
		.$type<"text" | "image" | "unknown">(),
	/**
	 * "user" | "detected" | "declared" | "assumed", in descending trust. A scan
	 * may overwrite anything below "user"; nothing automatic overwrites "user".
	 */
	kindSource: text("kind_source")
		.notNull()
		.default("assumed")
		.$type<"user" | "detected" | "declared" | "assumed">(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at")
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
})

export type SelectKoboldCppModel = typeof koboldCppModels.$inferSelect
export type InsertKoboldCppModel = typeof koboldCppModels.$inferInsert

/**
 * Scenes: discrete story moments within a session, used as the foundation for
 * vectorization and causal graph construction.
 */
export const scenes = pgTable(
	"scenes",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		// Session is nullable — session deletion sets this to null; scenes persist until lorebook is deleted
		sessionId: integer("session_id").references(() => sessions.id, {
			onDelete: "set null"
		}),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		// History entry this scene contributes to — cascade so scenes don't outlive their entry
		historyEntryId: integer("history_entry_id")
			.notNull()
			.references(() => historyEntries.id, { onDelete: "cascade" }),
		name: text("name"),
		// The IDs of sessionMessages included in this scene
		selectedMessageIds: json("selected_message_ids")
			.notNull()
			.default([])
			.$type<number[]>(),
		summary: text("summary"),
		// Scene cast lives in the `scene_characters` join table now — see it
		// for why the old participant_characters/mentioned_characters JSON
		// arrays had to go. Read/write them through
		// src/lib/server/utils/sceneCast.ts, which projects the join rows back
		// into the `number[]` shape the socket payloads and client still use.
		//
		// When this scene's cast was last genuinely resolved to binding ids.
		// NULL means "never resolved" — which is NOT the same as "resolved and
		// nobody was in it", and that distinction is the whole point: without
		// it, a legitimately castless scene is indistinguishable from an
		// unprocessed one and would be re-extracted on every single build.
		// Written by scene create/update (only when the payload actually
		// carries cast — a rename must not mark a scene resolved) and by
		// graph-build apply. Used for cost disclosure, never as a gate.
		castResolvedAt: timestamp("cast_resolved_at"),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		// Whether this scene has been processed into the causal graph
		graphed: boolean("graphed").notNull().default(false),
		createdAt: date("created_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`),
		updatedAt: date("updated_at")
			.notNull()
			.default(sql`(CURRENT_TIMESTAMP)`)
			.$onUpdate(() => sql`(CURRENT_TIMESTAMP)`)
	},
	(table) => [
		index("scenes_lorebook_id_idx").on(table.lorebookId),
		index("scenes_session_id_idx").on(table.sessionId),
		index("scenes_history_entry_id_idx").on(table.historyEntryId)
	]
)

export const scenesRelations = relations(scenes, ({ one, many }) => ({
	session: one(sessions, {
		fields: [scenes.sessionId],
		references: [sessions.id]
	}),
	lorebook: one(lorebooks, {
		fields: [scenes.lorebookId],
		references: [lorebooks.id]
	}),
	historyEntry: one(historyEntries, {
		fields: [scenes.historyEntryId],
		references: [historyEntries.id]
	}),
	lorebookBindings: many(lorebookBindings),
	characters: many(sceneCharacters)
}))

export type SceneCharacterRole = "participant" | "mentioned"

/**
 * Which characters are in a scene, and how — replacing the untyped
 * `participant_characters` / `mentioned_characters` JSON arrays.
 *
 * Those arrays had no FK, no type constraint and no index, and every one of
 * those gaps produced a real bug:
 *   - No FK → a deleted binding left a dangling id, which graphBuilder had to
 *     silently warn-and-skip, and which deleteNode had to hand-clean by
 *     loading every scene in the lorebook. ON DELETE cascade does both.
 *   - No type constraint → the column physically held ids OR pre-merge name
 *     strings OR nothing, so "is this scene's cast resolved?" was answered by
 *     sniffing array shapes at runtime. `binding_id integer` cannot hold a
 *     name.
 *   - No index → "which scenes feature X" meant loading every scene and
 *     filtering in JS, in four separate places.
 *
 * UNIQUE is (scene, binding, ROLE) and the role component is load-bearing: a
 * character legitimately appears as both participant and mentioned (absorb
 * remaps each array independently, and narrativeGraph.absorb's tests assert
 * the survivor lands in both), so a role-less constraint would reject real
 * data at migration time.
 *
 * `ordinal` preserves the arrays' observable order. Export serialization
 * writes the cast in stored order, and lorebook import compares exported
 * bytes to detect "unchanged vs conflict" — reordering would silently mark
 * every lorebook conflicted on re-import.
 */
export const sceneCharacters = pgTable(
	"scene_characters",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		sceneId: integer("scene_id")
			.notNull()
			.references(() => scenes.id, { onDelete: "cascade" }),
		bindingId: integer("binding_id")
			.notNull()
			.references(() => lorebookBindings.id, { onDelete: "cascade" }),
		role: text("role").notNull().$type<SceneCharacterRole>(),
		ordinal: integer("ordinal").notNull().default(0)
	},
	(table) => [
		uniqueIndex("scene_characters_unique").on(
			table.sceneId,
			table.bindingId,
			table.role
		),
		index("scene_characters_scene_id_idx").on(table.sceneId),
		index("scene_characters_binding_id_idx").on(table.bindingId)
	]
)

export const sceneCharactersRelations = relations(
	sceneCharacters,
	({ one }) => ({
		scene: one(scenes, {
			fields: [sceneCharacters.sceneId],
			references: [scenes.id]
		}),
		binding: one(lorebookBindings, {
			fields: [sceneCharacters.bindingId],
			references: [lorebookBindings.id]
		})
	})
)

/**
 * Narrative relationships: versioned, typed connections between narrative nodes.
 * Multiple rows between the same pair of nodes record how the relationship evolved over time.
 *
 * Examples:
 *   Year 1: Aria → Kael  (neutral)       "just met"
 *   Year 2: Aria → Kael  (life_debt)     "Aria saved Kael from burning building"
 *   Year 5: Aria → Kael  (ally)          "Kael repaid the debt; now genuine friends"
 */
export const narrativeRelationships = pgTable(
	"narrative_relationships",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		lorebookId: integer("lorebook_id")
			.notNull()
			.references(() => lorebooks.id, { onDelete: "cascade" }),
		// Post-merge: references lorebookBindings.id (formerly narrativeNodes.id
		// — see the lorebookBindings/narrativeNodes merge plan). Column names
		// kept as-is; only the FK target changed.
		fromNodeId: integer("from_node_id")
			.notNull()
			.references(() => lorebookBindings.id, { onDelete: "cascade" }),
		toNodeId: integer("to_node_id")
			.notNull()
			.references(() => lorebookBindings.id, { onDelete: "cascade" }),
		// History entry this relationship state was established in (optional)
		historyEntryId: integer("history_entry_id").references(
			() => historyEntries.id,
			{
				onDelete: "set null"
			}
		),
		// Scene that establishes/changes this relationship (optional)
		sceneId: integer("scene_id").references(() => scenes.id, {
			onDelete: "set null"
		}),
		// Relationship type: ally | enemy | rival | mentor | family | romantic | neutral | complicated | life_debt | etc.
		relationshipType: text("relationship_type")
			.notNull()
			.default("neutral"),
		// Description of the relationship at this point in time
		description: text("description").notNull().default(""),
		// Who can see this relationship — see RelationshipVisibility type
		visibility: text("visibility")
			.notNull()
			.default("acknowledged")
			.$type<RelationshipVisibility>(),
		// Current state: active | resolved | broken | evolved
		status: text("status").notNull().default("active"),
		// Why this relationship changed (for non-initial entries)
		reason: text("reason"),
		embedding: real("embedding").array(),
		embeddingModel: text("embedding_model"),
		vectorizedAt: timestamp("vectorized_at"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(table) => [
		index("narrative_relationships_from_node_id_idx").on(table.fromNodeId),
		index("narrative_relationships_to_node_id_idx").on(table.toNodeId),
		index("narrative_relationships_lorebook_id_idx").on(table.lorebookId)
	]
)

export const narrativeRelationshipsRelations = relations(
	narrativeRelationships,
	({ one }) => ({
		lorebook: one(lorebooks, {
			fields: [narrativeRelationships.lorebookId],
			references: [lorebooks.id]
		}),
		fromNode: one(lorebookBindings, {
			fields: [narrativeRelationships.fromNodeId],
			references: [lorebookBindings.id],
			relationName: "fromNode"
		}),
		toNode: one(lorebookBindings, {
			fields: [narrativeRelationships.toNodeId],
			references: [lorebookBindings.id],
			relationName: "toNode"
		}),
		historyEntry: one(historyEntries, {
			fields: [narrativeRelationships.historyEntryId],
			references: [historyEntries.id]
		}),
		scene: one(scenes, {
			fields: [narrativeRelationships.sceneId],
			references: [scenes.id]
		})
	})
)

export const setup = pgTable("setup", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	userId: integer("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" })
		.unique(),
	summarizationStepComplete: boolean("summarization_step_complete")
		.notNull()
		.default(false),
	ragStepComplete: boolean("rag_step_complete").notNull().default(false)
})

export const setupRelations = relations(setup, ({ one }) => ({
	user: one(users, {
		fields: [setup.userId],
		references: [users.id]
	})
}))

export const vectorizationConfigs = pgTable("vectorization_configs", {
	id: integer("id").primaryKey().default(1),
	embeddingModelTtlMinutes: integer("embedding_model_ttl_minutes")
		.notNull()
		.default(5),
	// "local" (in-process ONNX model) or "api" (external OpenAI-compatible
	// embeddings endpoint). Only one is ever active, so this singleton table
	// holds both configs rather than a dedicated multi-row connections table.
	mode: text("mode").notNull().default("local"),
	apiBaseUrl: text("api_base_url"),
	// Encrypted at rest (AES-256-GCM via tokenCrypto.ts, VECTORIZATION_API_KEY_INFO)
	// — apiKey holds the ciphertext, apiKeyIv/apiKeyAuthTag the companion
	// values needed to decrypt it. Never echoed back to the client in
	// plaintext (vectorization:listModels returns apiKeySet instead).
	apiKey: text("api_key"),
	apiKeyIv: text("api_key_iv"),
	apiKeyAuthTag: text("api_key_auth_tag"),
	apiModel: text("api_model"),
	apiDimensions: integer("api_dimensions")
})

export const customThemes = pgTable("custom_themes", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	name: text("name").notNull().unique(),
	label: text("label").notNull(),
	css: text("css").notNull(),
	cssKey: text("css_key").notNull().default(""),
	uploadedBy: integer("uploaded_by").references(() => users.id, {
		onDelete: "set null"
	}),
	isInstanceTheme: boolean("is_instance_theme").notNull().default(false),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at")
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
})

export const customThemesRelations = relations(customThemes, ({ one }) => ({
	uploader: one(users, {
		fields: [customThemes.uploadedBy],
		references: [users.id]
	})
}))

// ─── Pipelines (0.6) ──────────────────────────────────────────────────────────
//
// Storage for the pipeline system described in the extensibility docs (02 §2).
// These tables run *beside* the existing prompt/context config tables through
// 0.7–0.8; nothing here replaces or reads them yet. Retained means frozen: the
// old path keeps working and stops changing (08 §5a).
//
// The governing idea is that **rows are the system of record** and a pipeline
// document is a deterministic projection of them (F3). Import writes rows,
// export reads rows, and `import(export(rows))` has to be the identity — which
// is why the shape here mirrors the document's shape closely enough to be
// checked rather than argued about.
//
// Anything the constitution names is a column; anything a node type defines
// stays in jsonb. That line is what keeps a plugin's config out of the schema
// while leaving every law queryable.

/** A pipeline's stable identity. Versions hang off it; "replace" moves a pointer. */
export const pipelineSpecs = pgTable("pipeline_specs", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/** `ns:name` — the authored id, unique per instance and PK-agnostic across them. */
	slug: text("slug").notNull().unique(),
	name: text("name").notNull(),
	/** NULL for core specs; the owning plugin otherwise (12 §3b). */
	sourcePluginId: integer("source_plugin_id"),
	/**
	 * Publishing is a pointer move, never an overwrite (02 §3). A run in flight
	 * keeps the version it started on, and a receipt's claim to describe a
	 * specific version stays true.
	 */
	activeVersionId: integer("active_version_id"),
	createdAt: timestamp("created_at").notNull().defaultNow()
})

export const pipelineSpecVersions = pgTable(
	"pipeline_spec_versions",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specId: integer("spec_id")
			.notNull()
			.references(() => pipelineSpecs.id, { onDelete: "cascade" }),
		semver: text("semver").notNull(),
		engineRange: text("engine_range"),
		status: text("status").notNull().default("draft"), // draft | published | retired
		/**
		 * The document hash. Two instances that compiled the same authoring
		 * source land on the same string, which is what makes an import
		 * verifiable rather than trusted.
		 */
		canonicalHash: text("canonical_hash").notNull(),
		schemaVersion: integer("schema_version").notNull().default(1),
		/** Clones remember their origin, so an upstream diff is possible later. */
		derivedFromSpecVersionId: integer("derived_from_spec_version_id"),
		migratedFrom: text("migrated_from"),
		/** The genre declaration a create pipeline carries (24 §3; renamed from `mode`). */
		genre: json("genre").$type<Record<string, any> | null>(),
		/**
		 * The usage lock (24 §4), as columns so dispatch by (genre, event) is
		 * a SELECT: the input node's declared { genre, event }.
		 */
		inputGenre: text("input_genre"),
		inputEvent: text("input_event"),
		/**
		 * Contributed surfaces (19 §3–§4) — the version's `contributes` block,
		 * stored like `mode` so function routing and the trigger UI are
		 * SELECTs over rows, never document loads.
		 */
		contributes: json("contributes").$type<Record<string, any> | null>(),
		/**
		 * Catalogue claims (23 §2) — {zone?, role?, mode?}, stored like `mode`
		 * and `contributes` so the admin's sorting is a SELECT, never a
		 * document load. Claims, not identity: they may change on republish.
		 */
		taxonomy: json("taxonomy").$type<Record<string, any> | null>(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		publishedAt: timestamp("published_at")
	},
	(t) => [
		uniqueIndex("pipeline_spec_versions_spec_semver_idx").on(
			t.specId,
			t.semver
		)
	]
)

/**
 * Blocks — `async`, `map` and `loop`.
 *
 * ⚠ Not in 02 §2, which carries `block_*` columns on the node row only. That
 * predates the loop ruling (13 §1): a loop has a `max` and a predicate port
 * reference of its own, and neither belongs on any one of its member nodes.
 * Blocks also nest, so a block needs a parent. Filed as a docs finding rather
 * than left as a silent divergence.
 */
export const pipelineBlocks = pgTable(
	"pipeline_blocks",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specVersionId: integer("spec_version_id")
			.notNull()
			.references(() => pipelineSpecVersions.id, { onDelete: "cascade" }),
		blockId: text("block_id").notNull(),
		kind: text("kind").notNull(), // async | map | loop
		/** Nesting: a block inside a block. NULL at the spine. */
		parentBlockId: text("parent_block_id"),
		mode: text("mode"), // parallel | sequential, for async
		/** Mandatory for map and loop — repetition without a bound is not expressible (F9). */
		max: integer("max"),
		/** For map: where the items come from. For loop: the predicate port. */
		overRef: json("over_ref").$type<Record<string, any> | null>(),
		repeatWhile: json("repeat_while").$type<Record<string, any> | null>(),
		/** route only — the routed value, a stored port reference (20 §10). */
		onRef: json("on_ref").$type<Record<string, any> | null>(),
		/** route only — each chain's declared predicate, keyed by chain name. */
		routes: json("routes").$type<Record<string, any> | null>(),
		position: integer("position").notNull().default(0)
	},
	(t) => [
		uniqueIndex("pipeline_blocks_version_block_idx").on(
			t.specVersionId,
			t.blockId
		),
		check(
			"pipeline_blocks_kind_check",
			sql`${t.kind} IN ('async', 'map', 'loop', 'route')`
		),
		// Repetition without a bound is not expressible (F9, 13 §1). Enforced
		// here as well as at publish, because the row is the system of record
		// and an unbounded loop reaching it through any other path is the one
		// failure the whole design refuses to allow. Async and route are
		// exempt because neither repeats: a fan-out runs each lane once, a
		// route fires a subset of its branches once (20 §10) — the constraint
		// predated route blocks and refused every routed spec at the row.
		check(
			"pipeline_blocks_bounded_check",
			sql`${t.kind} IN ('async', 'route') OR ${t.max} IS NOT NULL`
		)
	]
)

export const pipelineNodes = pgTable(
	"pipeline_nodes",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specVersionId: integer("spec_version_id")
			.notNull()
			.references(() => pipelineSpecVersions.id, { onDelete: "cascade" }),
		/**
		 * Explicit and unique per version. Overrides, receipts, lenses and
		 * `ctx.state` all key on it — generating it from position would orphan
		 * every user's tuning the first time a node is inserted above (F21).
		 */
		nodeKey: text("node_key").notNull(),
		/** The closed taxonomy, enforced by the database rather than by review (F1). */
		kind: text("kind").notNull(),
		typeId: text("type_id").notNull(),
		typeVersion: integer("type_version").notNull().default(1),
		config: json("config")
			.notNull()
			.default({})
			.$type<Record<string, any>>(),
		/** Resolved at publish and stored, so a reference is readable off the row (16 §5b-i). */
		resolvedRefs: json("resolved_refs").$type<Record<
			string,
			string
		> | null>(),
		blockId: text("block_id"),
		blockKind: text("block_kind"),
		blockChain: text("block_chain"),
		toggleable: boolean("toggleable").notNull().default(false),
		enabledDefault: boolean("enabled_default").notNull().default(true),
		budgetTokens: integer("budget_tokens"),
		budgetCalls: integer("budget_calls"),
		position: integer("position").notNull()
	},
	(t) => [
		uniqueIndex("pipeline_nodes_version_key_idx").on(
			t.specVersionId,
			t.nodeKey
		),
		// F1 in the database. The five kinds are closed; a sixth is a schema
		// change and a constitutional argument, not a row somebody inserts.
		check(
			"pipeline_nodes_kind_check",
			sql`${t.kind} IN ('input', 'query', 'task', 'provider', 'consumer')`
		)
	]
)

/**
 * Edges FK to nodes, so a dangling edge is structurally impossible rather than
 * a lint finding somebody has to run.
 */
export const pipelineEdges = pgTable(
	"pipeline_edges",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specVersionId: integer("spec_version_id")
			.notNull()
			.references(() => pipelineSpecVersions.id, { onDelete: "cascade" }),
		/**
		 * The node an edge leaves, where it leaves a node.
		 *
		 * Nullable since blocks became referenceable. A `map` or `async` block
		 * publishes an aggregate result (`branch-results@1`), and a spec that
		 * consumes it — a summarize pipeline merging its drafts, for instance —
		 * writes an edge whose source is the **block**, not any node inside it. The
		 * document model always allowed that; this table could not store it, so the
		 * first spec to consume a map output failed at publish with a message about
		 * a node that does not exist. See `from_block_id`.
		 */
		fromNodeId: integer("from_node_id").references(() => pipelineNodes.id, {
			onDelete: "cascade"
		}),
		/**
		 * The block an edge leaves, for a block's aggregate output.
		 *
		 * The block *id* rather than a row id, matching how `pipeline_nodes` and
		 * every other block reference key on the authored id (F21): blocks belong to
		 * a spec version, and an edge is re-resolved from the document on publish.
		 */
		fromBlockId: text("from_block_id"),
		fromPort: text("from_port").notNull(),
		toNodeId: integer("to_node_id")
			.notNull()
			.references(() => pipelineNodes.id, { onDelete: "cascade" }),
		toPort: text("to_port").notNull(),
		edgeShape: text("edge_shape"),
		/**
		 * Nullable rather than `NOT NULL DEFAULT false`, and that is not fussiness:
		 * the document distinguishes "this edge does not stream" from "streaming was
		 * never decided for this edge", and collapsing the two makes
		 * `import(export(rows))` stop being the identity. Caught by C1 against real
		 * rows, which is the only place it shows up.
		 */
		streaming: boolean("streaming"),
		/** True when derived from chain order rather than an explicit reference. */
		implicit: boolean("implicit")
	},
	(t) => [
		// Exactly one source. Both set would give the resolver two answers for
		// one edge; neither set is an edge from nothing, which is the state the
		// old `NOT NULL` was there to prevent and which must stay prevented now
		// that the column is nullable.
		check(
			"pipeline_edges_one_source_check",
			sql`(${t.fromNodeId} IS NULL) <> (${t.fromBlockId} IS NULL)`
		)
	]
)

/** Compile-time fragment includes, expanded at publish into namespaced rows (16 §3a). */
export const pipelineIncludes = pgTable("pipeline_includes", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	specVersionId: integer("spec_version_id")
		.notNull()
		.references(() => pipelineSpecVersions.id, { onDelete: "cascade" }),
	key: text("key").notNull(),
	fragmentId: text("fragment_id").notNull()
})

/**
 * Author-shipped presets. Execution-affecting, so they round-trip with the
 * document (F4) — a preset that survives export but not import is a pipeline
 * that behaves differently on the far side for reasons nobody can see.
 */
export const pipelinePresets = pgTable(
	"pipeline_presets",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specVersionId: integer("spec_version_id")
			.notNull()
			.references(() => pipelineSpecVersions.id, { onDelete: "cascade" }),
		/** Referenced programmatically by extension sync and core defaults (12 §3b). */
		slug: text("slug").notNull(),
		label: text("label").notNull(),
		description: text("description"),
		/**
		 * Who owns it, so an update replaces the right rows and uninstalling a
		 * preset pack leaves the pipeline alone (12 §3b). The slug is the
		 * authored identity; the FK is resolved locally where one exists.
		 */
		ownerSlug: text("owner_slug"),
		ownerPluginId: integer("owner_plugin_id"),
		isDefault: boolean("is_default").notNull().default(false)
	},
	(t) => [
		uniqueIndex("pipeline_presets_version_slug_idx").on(
			t.specVersionId,
			t.slug
		)
	]
)

export const pipelinePresetValues = pgTable("pipeline_preset_values", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	presetId: integer("preset_id")
		.notNull()
		.references(() => pipelinePresets.id, { onDelete: "cascade" }),
	nodeKey: text("node_key").notNull(),
	/** params | prompts | template | sampling | settings — never `connection` (12 §3a, F20). */
	slot: text("slot").notNull(),
	path: text("path"),
	value: json("value").$type<any>()
})

/**
 * The session's overrides, per pipeline (12 §2 as simplified 2026-08-24).
 *
 * Three layers remain: the pipeline's author defaults, the selected config's
 * values, and this table — **session scope only**. The instance's tuning lives in
 * the config itself (edited as a thing with a name, duplicated when shipped),
 * and the per-user layer no longer exists; migration 0140 folded instance rows
 * into configs and removed the rest. A session's overrides stay a separate table
 * because they are arguably the session's content, and must never travel with an
 * exported document.
 *
 * **The reason is export.** A preset is execution-affecting and round-trips (F4);
 * a user's overrides are their configuration and, at session scope, arguably their
 * content. One table means every export is a `WHERE scope_kind <> …` away from
 * shipping somebody's tuning — or, on the day someone forgets the predicate, their
 * session-scoped prompt edits — to whoever they sent a pipeline to. Two tables make
 * *"does this travel with the document"* a structural fact rather than a clause
 * somebody has to remember. Resolution reads both and projects preset rows in at
 * `scopeKind: 'preset'`, so the five-layer chain is still one ordered walk (see
 * `pipelines/config.ts`).
 *
 * **Keyed on the spec, not the spec version.** F21 makes node keys explicit and
 * stable precisely so a user's tuning survives the pipeline being edited above it;
 * hanging overrides off a version would throw all of it away on every publish,
 * which is the failure F21 exists to prevent.
 */
export const pipelineNodeOverrides = pgTable(
	"pipeline_node_overrides",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specId: integer("spec_id")
			.notNull()
			.references(() => pipelineSpecs.id, { onDelete: "cascade" }),
		/**
		 * Always `session` (ruled 2026-08-24). Kept as a column rather than dropped
		 * because the address index and every reader key on it, and because the
		 * closed set is enforced by the CHECK below — a second scope arriving in
		 * a later design lands as data, not as a schema rewrite.
		 */
		scopeKind: text("scope_kind").notNull(),
		/**
		 * The user or session. Zero at instance scope rather than NULL: this column is
		 * half of the uniqueness rule, and under Postgres' default NULL handling two
		 * instance-scope rows for the same path would both be accepted — so "there is
		 * one instance value for this path" would stop being true exactly where it
		 * matters most.
		 */
		scopeId: integer("scope_id").notNull().default(0),
		nodeKey: text("node_key").notNull(),
		/** connection | sampling | template | prompts | params | settings (12 §2). */
		slot: text("slot").notNull(),
		/** The field within the slot. Empty string for whole-slot values. */
		path: text("path").notNull().default(""),
		value: json("value").$type<any>(),
		/** Who wrote it — for the audit trail, never for resolution. */
		updatedBy: integer("updated_by").references(() => users.id, {
			onDelete: "set null"
		}),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		uniqueIndex("pipeline_node_overrides_addr_idx").on(
			t.specId,
			t.scopeKind,
			t.scopeId,
			t.nodeKey,
			t.slot,
			t.path
		),
		index("pipeline_node_overrides_scope_idx").on(
			t.specId,
			t.scopeKind,
			t.scopeId
		),
		// The closed set, in the database. `preset` and `author` reaching this
		// table through any path would give the resolver two answers for one layer.
		check(
			"pipeline_node_overrides_scope_check",
			sql`${t.scopeKind} = 'session'`
		)
	]
)

/**
 * Which preset a scope has selected (12 §3).
 *
 * **The selection stores a slug, not a preset id**, and that is the whole point of
 * 12 §3b. Presets hang off a *spec version*; a selection that pointed at a row id
 * would dangle the moment the pipeline published 1.1.0, and every user who had
 * chosen "Lore-heavy" would silently land back on the default — on an upgrade,
 * which is when they are least able to tell what changed. A slug is the identity
 * that survives, so the same name resolves against whichever version is live.
 *
 * A slug that no longer exists resolves to nothing rather than to an error: 12 §3b
 * retires presets instead of deleting them, and a selection pointing at a retired
 * one keeps working. Falling back is what happens when it is genuinely gone.
 */
export const pipelineConfigSelections = pgTable(
	"pipeline_config_selections",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specId: integer("spec_id")
			.notNull()
			.references(() => pipelineSpecs.id, { onDelete: "cascade" }),
		scopeKind: text("scope_kind").notNull(), // instance | session (ruled 2026-08-24: no user layer)
		scopeId: integer("scope_id").notNull().default(0),
		/**
		 * The author preset a scope selected, where it selected one.
		 *
		 * Nullable since configs landed: a scope now selects a *config*, and
		 * the two are different choices that can both be absent. Kept rather
		 * than dropped because author presets still ship with documents and a
		 * scope that had chosen one has not stopped choosing it.
		 */
		presetSlug: text("preset_slug"),
		/**
		 * The selected **config**, which is what a scope actually picks now.
		 *
		 * A row id here where `presetSlug` deliberately avoids one, and the
		 * difference is not an inconsistency — it is the reason the slug rule
		 * existed. Presets hang off a spec *version*, so an id would dangle the
		 * moment a pipeline republished. Configs hang off the **spec**, survive
		 * republishing by construction, and are renameable by their owner — which
		 * makes a name the unstable identifier here and the id the stable one.
		 *
		 * `ON DELETE SET NULL` is load-bearing rather than tidy. NULL is defined
		 * to mean *"fall back to the shipped default"*, so deleting a config a
		 * scope had selected returns that scope to core's default automatically.
		 * The alternative — a code path that checks whether the referenced row
		 * still exists — is a check every read has to remember, and the first
		 * read that forgets resolves a session against nothing.
		 */
		configId: integer("config_id").references(() => pipelineConfigs.id, {
			onDelete: "set null"
		}),
		updatedBy: integer("updated_by").references(() => users.id, {
			onDelete: "set null"
		}),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		uniqueIndex("pipeline_config_selections_addr_idx").on(
			t.specId,
			t.scopeKind,
			t.scopeId
		),
		check(
			"pipeline_config_selections_scope_check",
			sql`${t.scopeKind} IN ('instance', 'session')`
		)
	]
)

/**
 * A **named, swappable configuration for one pipeline** (12 §3).
 *
 * Many per pipeline, one selected per scope. This is what the Prompt Configs
 * sidebar becomes: "Session Prompts", "Session Prompts: Narrator", "Summarize: World"
 * stop being six hand-written tables and become six *namespaces*, each holding
 * as many configs as a user cares to keep.
 *
 * ## Why this is one generic pair and not seven concrete tables
 *
 * The tables it replaces store their steps as **flat columns** —
 * `batch_system_prompt`, `synth_connection_id`,
 * `perspective_sampling_config_id`. That shape enumerates a pipeline's nodes by
 * hand, so adding a graph step is a migration, and an extension shipping its own
 * pipeline cannot add columns to core's tables at all. A plugin namespace is
 * therefore unreachable by construction, not merely unimplemented.
 *
 * Keyed per node instead, the same rows describe core's five graph steps and a
 * plugin's three, with no schema change for either.
 *
 * ## Keyed on the spec, never on the spec version
 *
 * The natural instinct is a foreign key to `pipeline_nodes`, since that is where
 * a node "is". It would be wrong, and expensively: node rows belong to a spec
 * *version*, publishing is a pointer move to a new version (02 §3), and every
 * config would therefore be orphaned by the next release. F21 makes node keys
 * explicit and stable for exactly this reason — so a user's tuning survives the
 * pipeline being edited above it. `pipeline_node_overrides` already keys this
 * way, and the two must agree or the resolver reads one of them wrongly.
 */
export const pipelineConfigs = pgTable(
	"pipeline_configs",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specId: integer("spec_id")
			.notNull()
			.references(() => pipelineSpecs.id, { onDelete: "cascade" }),
		/**
		 * Stable seed identity for the rows core ships, NULL for anything a user
		 * made — the same rule `db/defaults.ts` runs under, and for the same
		 * reason: matching a seeded row on `id` overwrote a user's config once
		 * already.
		 */
		seedKey: text("seed_key").unique(),
		name: text("name").notNull(),
		/** Core's shipped config: selectable and copyable, never edited in place. */
		isImmutable: boolean("is_immutable").notNull().default(false),
		/** The one a scope falls back to when it has selected nothing. */
		isDefault: boolean("is_default").notNull().default(false),
		/**
		 * Whether this preset may be chosen, site-wide. Admin's switch.
		 *
		 * A pipeline has no enabled state — it is present or it is not — but a
		 * preset does, because presets are what a non-admin picks from and an
		 * instance owner decides what that list contains. Disabling one leaves
		 * every session already on it running: it stops being *offered*, which is
		 * a different thing from being withdrawn, and withdrawing a preset out
		 * from under a live session is not something a checkbox should do.
		 */
		enabled: boolean("enabled").notNull().default(true),
		/**
		 * Which of the mode's actions sessions on this preset include (19 §3).
		 *
		 * An array of function keys. **NULL is not the empty array** and the
		 * difference is load-bearing: NULL means this preset states nothing
		 * and the companion rule decides (mode-owner's namespace on, foreign
		 * off), so a companion arriving in a later update reaches every session
		 * whose preset never had a view. `[]` means somebody said *none*.
		 *
		 * The preset decides what is *included*; a session decides which of its
		 * included actions are switched on, and an admin may additionally turn
		 * on something outside the set for one session. Three layers, resolved in
		 * that order — the same shape as every other setting here.
		 */
		includedActions: json("included_actions").$type<string[] | null>(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		index("pipeline_configs_spec_idx").on(t.specId),
		uniqueIndex("pipeline_configs_spec_name_idx").on(t.specId, t.name)
	]
)

/**
 * Which of a mode's functions a session actually has (19 §3).
 *
 * §3 rules that a contribution from the **mode owner's own namespace** is a
 * *companion* — present by default, toggleable — and a foreign one is an
 * *attachment*, per-user opt-in. Both halves of that were design until this
 * table: every session of a mode rendered every trigger contributed to it, with
 * no way to say otherwise. This is the "otherwise".
 *
 * ## Rows are exceptions, absence is the rule
 *
 * A row exists only where somebody's choice **differs from the default** for
 * that function, and turning a function back to its default deletes the row
 * (reset-is-delete, the same discipline as the config layer and session presets).
 * So a session with no rows behaves exactly as it did before this table existed,
 * and — more usefully — a contributor changing sides later, or a new companion
 * arriving in an update, reaches every session that never had an opinion.
 *
 * ## Keyed by mode, deliberately
 *
 * A choice about `narrate` was made about *this mode's* narrate. Mode upgrades
 * move along the same bare type (`crawl@1 → crawl@2`, 19 §6), and a version
 * that retires a function should not leave a stale row deciding anything —
 * while a version that keeps it should keep the user's answer. Storing the
 * full mode id and matching on it gives the first for free; carrying answers
 * across an upgrade is a deliberate step in `upgradeSessionMode`, not an
 * accident of the key.
 *
 * `enabled` is `notNull` because a row *is* a stated position. "No opinion" is
 * spelled by having no row, and a nullable third state would make two
 * spellings for it.
 */
export const sessionFunctions = pgTable(
	"session_functions",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		/** The full genre id the choice was made under. */
		genreId: text("genre_id").notNull(),
		/** The function key — `narrate`, `summarize-scene`, … (19 §3). */
		functionKey: text("function_key").notNull(),
		enabled: boolean("enabled").notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		uniqueIndex("session_functions_session_mode_fn_idx").on(
			t.sessionId,
			t.genreId,
			t.functionKey
		)
	]
)

/**
 * "Same key, several contributors → the binding selects" (19 §3), as rows.
 *
 * A scope's choice of which spec serves a function for sessions of a mode —
 * `respond` selected among the bucket, a contributed key selected among its
 * contributors. Resolution is session > user > instance, then the default rule
 * (companion namespace first); a row is only ever a *choice among the
 * eligible*, so `resolveFunctionSpec` re-checks eligibility at read and a
 * binding whose spec left the bucket falls through rather than routing wrong.
 *
 * `specId` rather than slug, cascading: a deleted spec deletes its bindings,
 * and the scope falls back to default resolution automatically — the same
 * "NULL means inherit" posture `pipeline_config_selections.configId` records,
 * spelled as row-absence because the whole row is the choice.
 */
export const pipelineFunctionBindings = pgTable(
	"pipeline_function_bindings",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		scopeKind: text("scope_kind").notNull(), // instance | user | session
		/** Zero at instance scope — half of the uniqueness rule (see node overrides). */
		scopeId: integer("scope_id").notNull().default(0),
		/** Which sessions this binding shapes — bindings are genre-scoped like presets. */
		genreId: text("genre_id").notNull(),
		functionKey: text("function_key").notNull(),
		specId: integer("spec_id")
			.notNull()
			.references(() => pipelineSpecs.id, { onDelete: "cascade" }),
		updatedBy: integer("updated_by").references(() => users.id, {
			onDelete: "set null"
		}),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		uniqueIndex("pipeline_function_bindings_addr_idx").on(
			t.scopeKind,
			t.scopeId,
			t.genreId,
			t.functionKey
		),
		check(
			"pipeline_function_bindings_scope_check",
			sql`${t.scopeKind} IN ('instance', 'session')`
		)
	]
)

/**
 * "The session scope may swap it" (19 §5): a node-type rebind.
 *
 * A scope's substitution of which **type** fills a node position in a spec —
 * the next-speaker strategy swap is the first use: the respond spec pins
 * `turn-manual`, and a session that wants round-robin rebinds the `speaker`
 * node. Applied when the document is loaded for a run, guarded by shape
 * compatibility (the substitute must publish the same `main` shape as the
 * pinned type — the swap-list membership rule made a load-time check), so a
 * stale rebind degrades to the pinned type rather than mis-wiring the run.
 *
 * `typeId` carries the full pin (`ns:kind/name@N`) as text rather than a
 * registry-row FK: the registry re-projects pre-1.0 (rows are deleted and
 * re-inserted at boot), and a rebind must survive that the way spec pins do.
 */
export const pipelineNodeRebinds = pgTable(
	"pipeline_node_rebinds",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		specId: integer("spec_id")
			.notNull()
			.references(() => pipelineSpecs.id, { onDelete: "cascade" }),
		scopeKind: text("scope_kind").notNull(), // instance | user | session
		scopeId: integer("scope_id").notNull().default(0),
		nodeKey: text("node_key").notNull(),
		/** The substitute's pinned type id, e.g. `core:task/turn-round-robin@1`. */
		typeId: text("type_id").notNull(),
		updatedBy: integer("updated_by").references(() => users.id, {
			onDelete: "set null"
		}),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		uniqueIndex("pipeline_node_rebinds_addr_idx").on(
			t.specId,
			t.scopeKind,
			t.scopeId,
			t.nodeKey
		),
		check(
			"pipeline_node_rebinds_scope_check",
			sql`${t.scopeKind} IN ('instance', 'session')`
		)
	]
)

/**
 * One tuned value inside a config, addressed exactly like every other layer.
 *
 * `(node_key, slot, path)` is the same address `pipeline_node_overrides` uses,
 * which is what lets a config be projected into the five-layer chain as the
 * `preset` layer rather than resolved by a second, parallel walk (12 §2).
 *
 * ## What does *not* live here
 *
 * Connections and sampling configs are separate entities with their own rules,
 * referenced per provider node — never copied in. A row at `slot='connection'`
 * or `slot='sampling'` holds the *id of* a `connections` / `sampling_configs`
 * row, so choosing "my precise preset" once changes every pipeline that points
 * at it, and an admin moving the instance connection still reaches everyone
 * (12 §4, 17 §1a). Inlining either would fork it silently on the day it is
 * edited somewhere else, and inlining a connection would additionally copy
 * credentials into a table that is not the credentials table.
 */
export const pipelineConfigValues = pgTable(
	"pipeline_config_values",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		configId: integer("config_id")
			.notNull()
			.references(() => pipelineConfigs.id, { onDelete: "cascade" }),
		/** The stable node key, not a row id — see the note above on F21. */
		nodeKey: text("node_key").notNull(),
		/** connection | sampling | template | prompts | params | settings (12 §2). */
		slot: text("slot").notNull(),
		/** The field within the slot. Empty string for a whole-slot value. */
		path: text("path").notNull().default(""),
		value: json("value").$type<any>()
		// Deliberately NO `engine` column. Which language a template is written
		// in is a fact about the TEMPLATE ROW, and it lives there — on
		// `pipeline_context_templates` / `pipeline_variable_templates`, NOT
		// NULL, and delivered to the renderer from there. A denormalized third
		// copy here was written by a dead branch and read by nothing but its own
		// copy-forward; re-adding it just gives a future reader two answers.
	},
	(t) => [
		uniqueIndex("pipeline_config_values_addr_idx").on(
			t.configId,
			t.nodeKey,
			t.slot,
			t.path
		),
		index("pipeline_config_values_config_idx").on(t.configId)
	]
)

/**
 * An authored prompt — text, and nothing else.
 *
 * A swappable entity like a connection or a sampling config, selected **per
 * provider node, per config**. A config row at `slot='prompts'` holds this
 * row's id, never a copy of its text, so renaming or rewriting a prompt reaches
 * every node pointing at it and an admin's edit is not silently forked.
 *
 * ## What it deliberately no longer carries
 *
 * `prompt_configs` — the table this succeeds — is a bundle: system text,
 * post-history text, `post_history_depth`, `post_history_token_trigger`, a
 * connection and a sampling config. Six unrelated decisions travelling as one,
 * so choosing a different wording also changed which model ran and how the
 * reminder was positioned. Here a prompt is text. The numbers are params
 * (per node, per config), and the connection and sampling config are their own
 * swappable entities selected the same way this one is.
 *
 * ## Pooled by the NODE that consumes it, not by the pipeline
 *
 * A prompt follows the node. When a node is reused from one pipeline in
 * another it serves the same purpose somewhere else, so everything scoped to
 * that node travels with it: an action that reuses the reply pipeline's
 * context node inherits its twelve prompts for free, with no seed, no copy and
 * no code. A pipeline built from other nodes has a different pool key and is
 * correctly offered none of them.
 *
 * This reverses the earlier rule, which namespaced a prompt to its spec on the
 * reasoning that a reply's wording has no business in a summarizer's picker.
 * That conclusion was right and the mechanism was wrong: the separation it
 * wanted falls out of the node type by construction — `build-template-context`
 * and `summarize-batch` are different types, so reply wording can never reach a
 * summarizer — while spec scoping *also* severed the reuse the tier exists for,
 * and forced a shipped prompt to be a per-pipeline BUNDLE whose fields belonged
 * to four different node types.
 *
 * The pool is `(node_type_id, slot)`. Selection refuses across it, and
 * `created_for_spec_id` sorts the picker without ever refusing — the same split
 * `pipeline_context_templates` makes, for the same reason.
 *
 * ## Why `fields` is JSON
 *
 * A prompts slot declares its own named text fields — core's are `system` and
 * `postHistory` on one node, `systemPrompt` / `postHistoryInstructions` /
 * `narratorName` on another, and a plugin's are whatever it declares. Columns
 * would enumerate a set that is open by construction. The declaration is the
 * schema; this is the value.
 */
export const pipelinePrompts = pgTable(
	"pipeline_prompts",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/**
		 * The pool, and the point of this table. Unversioned — which fields the
		 * slot declares is a property of the version and belongs to the
		 * fit-check in `assertSelectable`; fragmenting on every @1 → @2 would
		 * strand every prompt a user wrote. Normalize through `poolKeyFor` on
		 * every write.
		 */
		nodeTypeId: text("node_type_id").notNull(),
		/**
		 * In the key because a type may declare more than one prompts slot,
		 * each with its own field set. One pool for both would offer each the
		 * other's fields, and a prompt missing a field renders a blank — which
		 * reads as the model ignoring an instruction, not as a bad selection.
		 */
		slot: text("slot").notNull(),
		/**
		 * Where it was authored. GROUPING ONLY, never a permission — same
		 * column, same rule, as `pipeline_context_templates`. `set null` rather
		 * than cascade: deleting a pipeline must not delete somebody's prompt.
		 */
		createdForSpecId: integer("created_for_spec_id").references(
			() => pipelineSpecs.id,
			{ onDelete: "set null" }
		),
		/**
		 * Spec slugs whose shipped config starts on this row.
		 *
		 * A list, not a boolean, and not `created_for_spec_id`: one pool now
		 * serves four summarize specs, and the scene/history drafting prompt is
		 * ONE row (their text is byte-identical) belonging to two of them. A
		 * single owning column cannot say that; "lowest id in the pool" would
		 * hand summarize-character the world summarizer's wording.
		 */
		defaultForSpecs: json("default_for_specs")
			.notNull()
			.default([])
			.$type<string[]>(),
		/** Stable identity for the prompts core ships; NULL for a user's own. */
		seedKey: text("seed_key").unique(),
		name: text("name").notNull(),
		/** Core's shipped prompt: selectable and copyable, never edited in place. */
		isImmutable: boolean("is_immutable").notNull().default(false),
		/** field name → authored text, matching the slot's declared `fields`. */
		fields: json("fields")
			.notNull()
			.default({})
			.$type<Record<string, string>>(),
		/**
		 * Text for a field the slot no longer declares, moved here by the boot
		 * sweep. Left in `fields` it is invisible: the panel renders one box per
		 * DECLARED field, so a prompt someone spent an afternoon on becomes
		 * unfindable. On the ROW so a duplicate carries it to another pipeline —
		 * "recover/archive so the user can reference/copy it later", by a person.
		 */
		archivedFields: json("archived_fields")
			.notNull()
			.default({})
			.$type<Record<string, string>>(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		index("pipeline_prompts_pool_idx").on(t.nodeTypeId, t.slot),
		index("pipeline_prompts_spec_idx").on(t.createdForSpecId),
		uniqueIndex("pipeline_prompts_pool_name_idx").on(
			t.nodeTypeId,
			t.slot,
			t.name
		)
	]
)

export const pipelinePromptsRelations = relations(
	pipelinePrompts,
	({ one }) => ({
		createdForSpec: one(pipelineSpecs, {
			fields: [pipelinePrompts.createdForSpecId],
			references: [pipelineSpecs.id]
		})
	})
)

/**
 * User-authored scripts — the fourth paradigm's rows (18 §2).
 *
 * A script is typed text: the row holds the source and the *type* holds the
 * contract, projected into `pipeline_type_registry` with `kind: 'script'`. The
 * same entity pattern as prompts — a chain stores this row's id, never a copy
 * of its text — with one deliberate difference: **keyed by the script type,
 * not by a spec.** A slop filter is a statement about text, not about which
 * pipeline runs it, and the whole point of the tier is that one script serves
 * the reply pipeline, the summarizers, and any extension's hook that accepts
 * its type (18 §4a).
 *
 * `varsIn` / `varsOut` are the declared variable I/O (18 §6a): what the script
 * reads and what it may rewrite, as subsets of its hook's variable space.
 * In-but-not-out is read-only — enforcement is the executor's job, but the
 * declaration lives here so the editor, the import review and the receipt can
 * all say what a script touches without reading its source.
 */
export const pipelineScripts = pgTable(
	"pipeline_scripts",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** Pinned script type id — `core:script:text/transform@1`. */
		typeId: text("type_id").notNull(),
		/** Stable identity for anything core ships; NULL for a user's own. */
		seedKey: text("seed_key").unique(),
		name: text("name").notNull(),
		/** Core's shipped script: selectable and copyable, never edited in place. */
		isImmutable: boolean("is_immutable").notNull().default(false),
		/** A disabled script keeps its place in every chain and does nothing. */
		enabled: boolean("enabled").notNull().default(true),
		/** The function body. The sandbox contract is 18 §6. */
		source: text("source").notNull().default(""),
		varsIn: json("vars_in").notNull().default([]).$type<string[]>(),
		varsOut: json("vars_out").notNull().default([]).$type<string[]>(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		index("pipeline_scripts_type_idx").on(t.typeId),
		uniqueIndex("pipeline_scripts_type_name_idx").on(t.typeId, t.name)
	]
)

/**
 * How a context variable is *presented* — the swappable half of `{{{characters}}}`.
 *
 * Same entity pattern as `pipeline_prompts` above: the config stores a
 * reference, this row holds the content, and rewording reaches every node
 * pointing at it instead of forking at the first edit.
 *
 * ## Keyed by the variable, deliberately not by the spec
 *
 * This is the one place the prompt pattern is *not* copied, and the difference
 * is the entire feature. A prompt is namespaced to a pipeline because a session
 * reply's wording has no business in a summarizer's picker. A *rendering* is the
 * opposite: "characters as prose instead of JSON" is a statement about
 * characters, not about which pipeline asked for them. So the row names the
 * variable it renders, and any pipeline that renders `core:var/characters@1`
 * may select it — write one prose template, use it in reply and narration both.
 *
 * Selection is checked against `variable_id`, never against a spec. A
 * spec-ownership check copied from `prompts.ts` would compile, pass, and quietly
 * remove the reason this table exists.
 *
 * ## Why `engine` is NOT nullable
 *
 * It used to be, on the reading that NULL meant "core's default". But the
 * column's own argument — a stored value keeps whatever it was authored in
 * rather than inheriting whatever core happens to render with later — is an
 * argument FOR a concrete value and AGAINST NULL: a NULL is precisely a row
 * that inherits later. The seed already wrote the id explicitly and said so.
 *
 * And here it is load-bearing rather than decorative: this table's engine
 * genuinely reaches `renderTemplate` (`variableLayouts.ts`), so a NULL was a
 * live coercion into Handlebars, not a hypothetical one. A default of core's
 * engine keeps every existing row saying exactly what it already meant.
 *
 * The engine is also part of the unique key. "Default" once per language is
 * what a person expects, and without it a Jinja layout can be selected into a
 * Handlebars slot: it stores cleanly and renders as raw `{% %}` markup.
 */
export const pipelineVariableTemplates = pgTable(
	"pipeline_variable_templates",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** The registered variable this renders, e.g. `core:var/characters@1`. */
		variableId: text("variable_id").notNull(),
		/**
		 * Registered template engine id — the language `source` is written in.
		 * Defaults to core's Handlebars; the literal rather than an import
		 * because this module is the schema and pulls in no pipeline code.
		 */
		engine: text("engine").notNull().default("core:template/handlebars@1"),
		name: text("name").notNull(),
		/** The template source, in whatever `engine` says it is written in. */
		source: text("source").notNull().default(""),
		/** Stable identity for the templates core ships; NULL for a user's own. */
		seedKey: text("seed_key").unique(),
		/** Core's shipped rendering: selectable and copyable, never edited in place. */
		isImmutable: boolean("is_immutable").notNull().default(false),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		index("pipeline_variable_templates_variable_idx").on(t.variableId),
		// The engine is in the key: one "Default" per language, and a layout
		// written in one language can no longer be selected into a slot that
		// renders another.
		uniqueIndex("pipeline_variable_templates_variable_name_idx").on(
			t.variableId,
			t.engine,
			t.name
		)
	]
)

/**
 * The story string — the layout of a whole finished prompt.
 *
 * Supersedes `context_configs`, which stays as data only. This is the table the
 * pipeline reads; the legacy one is kept so a template somebody spent a year on
 * survives the upgrade, and is dropped once nothing needs to read it.
 *
 * ## What it owns, and what it no longer owns
 *
 * Structure: message blocks, placement, `{{#if}}`, `{{#each}}`. It has no
 * opinion on how the data inside is *presented* — the headings, fences and JSON
 * shape live in `pipeline_variable_templates`, one row per variable. The two
 * tables are the two halves of that split, which is why they are named as a
 * pair: this renders the whole context, that renders one value inside it.
 *
 * ## Keyed by the node whose context it renders, not by the pipeline
 *
 * `node_type_id` is the compatibility rule, and it is the same move
 * `pipeline_variable_templates` makes with `variable_id`: a row is keyed by
 * *what it renders against*, never by who happened to be rendering. Session reply
 * and the narrator both run `core:task/assemble`, so one template genuinely
 * serves both — which is how `context_configs` has always behaved, and
 * namespacing to a spec would turn that into two copies to keep in sync. A
 * pipeline with no such node offers no picker at all, so a summarizer's
 * settings cannot fill up with templates written for session.
 *
 * **Unversioned on purpose.** `core:task/assemble`, not `@2`. Which variables
 * exist is a property of the version and belongs to the lint; fragmenting the
 * pool on every version bump would strand every template a user wrote.
 *
 * ## `created_for_spec_id` sorts, and never refuses
 *
 * Which pipeline's panel a row was written in. The picker groups on it — used
 * here, then shipped, then everything else that fits — because "compatible" and
 * "the one I want" stop being the same answer at about ten rows. It is
 * deliberately not a permission: a template written while editing session replies
 * is still one scroll away in the narrator, because the whole reason this is not
 * spec-scoped is that it genuinely works there.
 *
 * ## The engine is half the pool key, and NOT NULL
 *
 * A node type is not enough to say "this template fits". `core:task/assemble`
 * has a Handlebars template slot; a plugin's assembler may declare a Jinja one
 * on the same type. Keyed by node type alone, the picker offers each the
 * other's rows — the selection stores cleanly and the model receives a prompt
 * full of raw `{% %}` markup, which reads as a bad model rather than a bad
 * pick. So the pool is `(node_type_id, engine)` and there is deliberately NO
 * cross-engine fallback: an empty pool offers nothing, never a source in the
 * wrong language.
 *
 * NULL is gone for the reason `pipeline_variable_templates` gives above: the
 * column exists so a row keeps what it was authored in, and a NULL is exactly
 * the row that does not. It was also masking a live bug — the engine never
 * reached the renderer at all, so every template rendered as Handlebars
 * whatever it declared.
 */
export const pipelineContextTemplates = pgTable(
	"pipeline_context_templates",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/**
		 * The node type whose context this renders, unversioned — e.g.
		 * `core:task/assemble`. The hard compatibility rule.
		 */
		nodeTypeId: text("node_type_id").notNull(),
		/**
		 * Where it was authored, for grouping only. NULL for core's own and for
		 * anything migrated across, neither of which belongs to one pipeline.
		 * `set null` rather than cascade: deleting a pipeline must not delete
		 * somebody's template, which would be data loss wearing a tidy-up's
		 * costume.
		 */
		createdForSpecId: integer("created_for_spec_id").references(
			() => pipelineSpecs.id,
			{ onDelete: "set null" }
		),
		/**
		 * Registered template engine id — half the pool key, and the language
		 * `source` is written in. Defaults to core's Handlebars; the literal
		 * rather than an import because this module is the schema and pulls in
		 * no pipeline code.
		 */
		engine: text("engine").notNull().default("core:template/handlebars@1"),
		name: text("name").notNull(),
		/** The template source, in whatever `engine` says it is written in. */
		source: text("source").notNull().default(""),
		/** Stable identity for the templates core ships; NULL for a user's own. */
		seedKey: text("seed_key").unique(),
		/** Core's shipped layout: selectable and copyable, never edited in place. */
		isImmutable: boolean("is_immutable").notNull().default(false),
		/**
		 * The `context_configs` row this was copied from, if it was.
		 *
		 * Not a foreign key and not used for resolution — the copy is
		 * independent the moment it exists. It is here so the migration can be
		 * idempotent without a ledger, and so "where did this come from" has an
		 * answer while both tables are still present.
		 */
		migratedFromContextConfigId: integer("migrated_from_context_config_id"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		index("pipeline_context_templates_node_type_idx").on(t.nodeTypeId),
		index("pipeline_context_templates_spec_idx").on(t.createdForSpecId),
		/** The pool the picker reads: node type AND language. */
		index("pipeline_context_templates_pool_idx").on(t.nodeTypeId, t.engine),
		uniqueIndex("pipeline_context_templates_node_type_name_idx").on(
			t.nodeTypeId,
			t.engine,
			t.name
		),
		uniqueIndex("pipeline_context_templates_migrated_from_idx").on(
			t.migratedFromContextConfigId
		)
	]
)

/**
 * What a version change did to somebody's config, kept until they have seen it.
 *
 * A pipeline's tuneable surface is declared by its nodes, so publishing a new
 * version can *remove* an option a user had set. Silently dropping the value
 * would be the worst of the three available behaviours: the setting stops
 * applying, the panel stops showing it, and nothing anywhere says why the
 * pipeline started behaving differently. Silently keeping it is no better — it
 * is a row addressing a field that no longer exists, which resolves to nothing
 * and reads as corruption the first time anyone looks.
 *
 * So the value is culled and the cull is recorded. The notice is the part that
 * makes the cull honest.
 *
 * Back-fills are recorded too, under their own kind. They need no warning — a
 * new parameter arriving at its author default is the correct outcome — but
 * they answer the same question a cull does ("why is this different today"),
 * and a reader who has to consult two places to reconstruct one upgrade will
 * consult neither.
 */
export const pipelineConfigNotices = pgTable(
	"pipeline_config_notices",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		configId: integer("config_id")
			.notNull()
			.references(() => pipelineConfigs.id, { onDelete: "cascade" }),
		/** culled | backfilled. */
		kind: text("kind").notNull(),
		nodeKey: text("node_key").notNull(),
		slot: text("slot").notNull(),
		path: text("path").notNull().default(""),
		/** The label the option carried when it was culled — the panel has none now. */
		label: text("label"),
		/**
		 * What the user had set, for a cull.
		 *
		 * Kept rather than discarded: a notice that says "your value was removed"
		 * without saying what it was asks the user to remember something they
		 * configured months ago. Also makes an undo possible later without
		 * another migration.
		 */
		previousValue: json("previous_value").$type<any>(),
		/** Which version made the change, so a notice can name it. */
		specVersionId: integer("spec_version_id"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		/** NULL until the person has actually been shown it. */
		acknowledgedAt: timestamp("acknowledged_at")
	},
	(t) => [
		index("pipeline_config_notices_config_idx").on(t.configId),
		check(
			"pipeline_config_notices_kind_check",
			sql`${t.kind} IN ('culled', 'backfilled')`
		)
	]
)

export const pipelineConfigsRelations = relations(
	pipelineConfigs,
	({ one, many }) => ({
		spec: one(pipelineSpecs, {
			fields: [pipelineConfigs.specId],
			references: [pipelineSpecs.id]
		}),
		values: many(pipelineConfigValues),
		notices: many(pipelineConfigNotices)
	})
)

export const pipelineConfigNoticesRelations = relations(
	pipelineConfigNotices,
	({ one }) => ({
		config: one(pipelineConfigs, {
			fields: [pipelineConfigNotices.configId],
			references: [pipelineConfigs.id]
		})
	})
)

export const pipelineConfigValuesRelations = relations(
	pipelineConfigValues,
	({ one }) => ({
		config: one(pipelineConfigs, {
			fields: [pipelineConfigValues.configId],
			references: [pipelineConfigs.id]
		})
	})
)

/**
 * Materialized host knowledge about node types (02 §2).
 *
 * As rows rather than a module, every pin in every spec becomes joinable — and
 * more importantly, install-time validation can decide whether a plugin fits
 * this release **without executing it** (F6, 13 §10c).
 */
/**
 * What a run did, kept.
 *
 * Until this existed, a receipt was returned in memory and discarded — so the
 * first question anyone asks after a turn ("did that use the pipeline, and what
 * did it decide?") had no answer once the request was over. F3 says rows are the
 * system of record; that was true for specs and types and false for runs, which
 * is the one place a user actually looks.
 *
 * Deliberately **not** cascade-deleted with the spec version. A run happened; a
 * spec being retired later does not unhappen it, and a receipt whose spec was
 * deleted is still evidence about a message that is still in someone's session.
 * The reference is recorded as plain columns rather than a foreign key for the
 * same reason.
 */
export const pipelineRuns = pgTable(
	"pipeline_runs",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** The SDK's own run id — stable across the receipt and its node rows. */
		runId: text("run_id").notNull().unique(),
		specSlug: text("spec_slug").notNull(),
		specVersion: text("spec_version").notNull(),
		/** Nullable on purpose: see the note above about retired specs. */
		specVersionId: integer("spec_version_id"),
		sessionId: integer("session_id").references(() => sessions.id, {
			onDelete: "set null"
		}),
		userId: integer("user_id").references(() => users.id, {
			onDelete: "set null"
		}),
		/** The message this run produced, when it produced one. */
		messageId: integer("message_id").references(() => sessionMessages.id, {
			onDelete: "set null"
		}),
		outcome: text("outcome").notNull(), // ok | halt | err | cancelled
		haltNodeKey: text("halt_node_key"),
		haltReason: text("halt_reason"),
		triggerSource: text("trigger_source").notNull(),
		/**
		 * What made this run reproducible.
		 *
		 * Stored because a receipt that cannot be replayed is a story about a
		 * run rather than a record of one — the seed is what lets the same
		 * inputs produce the same prompt again.
		 */
		seed: text("seed").notNull(),
		/** A preview stopped before the provider call and sent nothing. */
		isPreview: boolean("is_preview").notNull().default(false),
		startedAt: timestamp("started_at").notNull(),
		endedAt: timestamp("ended_at").notNull(),
		elapsedMs: integer("elapsed_ms").notNull().default(0),
		tokensSpent: integer("tokens_spent").notNull().default(0),
		/** The receipt verbatim, for anything the columns above do not answer. */
		receipt: json("receipt").notNull().$type<Record<string, any>>(),
		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(t) => [
		index("pipeline_runs_session_idx").on(t.sessionId, t.id),
		index("pipeline_runs_message_idx").on(t.messageId)
	]
)

/**
 * One row per node, so "why did this turn include that lore" is a query.
 *
 * Split out of the receipt JSON rather than left inside it because the trail is
 * the thing a user reads, and reading it should not mean loading and walking a
 * blob for every run in a session. The blob stays on the run row as the source of
 * truth; these are the parts worth indexing.
 */
export const pipelineRunNodes = pgTable(
	"pipeline_run_nodes",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		runId: integer("run_id")
			.notNull()
			.references(() => pipelineRuns.id, { onDelete: "cascade" }),
		seq: integer("seq").notNull(),
		nodeKey: text("node_key").notNull(),
		kind: text("kind").notNull(),
		typeId: text("type_id").notNull(),
		result: text("result").notNull(), // ok | halt | err
		reason: text("reason"),
		elapsedMs: integer("elapsed_ms").notNull().default(0),
		tokens: integer("tokens"),
		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(t) => [index("pipeline_run_nodes_run_idx").on(t.runId, t.seq)]
)

/**
 * Installed plugins / extensions. Built and persisted on this branch behind the
 * `SP_PLUGINS_ENABLED` gate so a proper SDK preview can ship in 0.6.0 with an
 * almost-frozen shape; the whole surface is inert until that flag is set.
 *
 * A plugin's executable code is *only* its reviewed, `bundleHash`-pinned bundle
 * — never a file it writes at runtime. `backends` is the set the conformance
 * harness certified (it must run identically on each); `backend` is the active
 * one, the security/speed dial (quickjs = strong/slow default, ses = fast
 * fallback). `manifest` is the compiled declaration: hooks, components,
 * pipelines, and the fine-grained permissions the plugin requests.
 */
export const plugins = pgTable(
	"plugins",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** Stable manifest id (namespace/name) — the address everything uses. */
		pluginId: text("plugin_id").notNull().unique(),
		name: text("name").notNull(),
		version: text("version").notNull().default("0.0.0"),
		/** The compiled, self-contained bundle (deps baked in). */
		bundleSource: text("bundle_source").notNull(),
		/** SHA-256 of the bundle bytes; permission grants bind to this exact value. */
		bundleHash: text("bundle_hash").notNull(),
		/** Backends the conformance harness certified: ['quickjs'] | ['quickjs','ses'] | ['ses']. */
		backends: json("backends")
			.notNull()
			.default(["quickjs"])
			.$type<("quickjs" | "ses")[]>(),
		/** The active backend — the dial. Must be one of `backends`. */
		backend: text("backend").notNull().default("quickjs"), // quickjs | ses
		/** Sequential-only: manifest-declared, or admin-forced. Concurrent otherwise. */
		sequential: boolean("sequential").notNull().default(false),
		enabled: boolean("enabled").notNull().default(false),
		/** The compiled manifest — hooks, components, pipelines, declared permissions. */
		manifest: json("manifest")
			.notNull()
			.default({})
			.$type<Record<string, any>>(),
		/**
		 * Permission keys an admin has denied at the plugin level. The effective
		 * grant is (manifest-declared − this); every capability the runtime hands
		 * out derives from the effective set, never the raw manifest.
		 */
		adminDenied: json("admin_denied")
			.notNull()
			.default([])
			.$type<string[]>(),
		/**
		 * An admin's per-plugin storage-quota override, in bytes (null = none). A
		 * deliberate, trusted admin act that supersedes the manifest-declared quota,
		 * so it may exceed the 256 MB author ceiling — clamped at grant-derivation to
		 * a sane admin band [1 KB … 2 GB]. Denying the `storage` permission still wins:
		 * an override can raise/lower a *granted* quota, never revive a denied one.
		 */
		storageQuotaOverride: bigint("storage_quota_override", {
			mode: "number"
		}),
		/**
		 * Stored values for the manifest-declared settings schema (12 §6,
		 * 13 §6). Values only — the schema lives in the manifest. A `secret`
		 * field's value is stored as `{$secret: true, value}` with `value`
		 * AES-256-GCM ciphertext under the app secret (settingsHost.ts):
		 * typed, so core mechanically masks it to the client, excludes it
		 * from export, and decrypts it only into the declaring plugin's own
		 * hook invocations. Fields the current schema no longer declares are
		 * kept, never deleted — the SDK's `reconcile` reports them as
		 * orphaned diagnostics (an update must stay reversible).
		 */
		settings: json("settings")
			.notNull()
			.default({})
			.$type<Record<string, unknown>>(),
		installedAt: timestamp("installed_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow()
	},
	(t) => [
		check("plugins_backend_check", sql`${t.backend} IN ('quickjs', 'ses')`)
	]
)

/**
 * The hook-execution log — every invocation, for the admin observability view.
 *
 * Identity is **denormalized** (name + hash as text, no FK to `plugins`) so a
 * row stays meaningful after the plugin is uninstalled or upgraded: this is a
 * historical record, not a live reference. Pipeline logs *reference* this table
 * via `runId` (the SDK run id, matching `pipeline_runs.run_id`) rather than
 * re-storing hook timing/identity — a soft link on purpose, so pruning a run
 * never deletes the hook history.
 */
/**
 * A plugin's client-side files (20 §12) — the documents and assets its frame
 * surfaces load. Stored at install beside the server bundle, served by the
 * `/plugin-ui/<pluginId>/<path>` route under a CSP composed from the plugin's
 * grants, and mounted only ever inside `sandbox="allow-scripts"` frames:
 * opaque origin, no cookies, no DOM reach — isolation by attribute, not
 * infrastructure. Content is base64 so one column carries text and binaries
 * alike; `hash` is per-file for immutable caching.
 */
export const pluginFiles = pgTable(
	"plugin_files",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		pluginId: text("plugin_id").notNull(),
		/** Relative, slash-separated, no traversal — validated at install. */
		path: text("path").notNull(),
		mime: text("mime").notNull(),
		/** Base64 of the file bytes. */
		content: text("content").notNull(),
		hash: text("hash").notNull(),
		bytes: integer("bytes").notNull()
	},
	(t) => [uniqueIndex("plugin_files_plugin_path_idx").on(t.pluginId, t.path)]
)

export const pluginHookInvocations = pgTable(
	"plugin_hook_invocations",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		pluginId: text("plugin_id").notNull(),
		pluginName: text("plugin_name").notNull(),
		bundleHash: text("bundle_hash").notNull(),
		hookName: text("hook_name").notNull(),
		backend: text("backend").notNull(), // quickjs | ses
		mode: text("mode").notNull(), // concurrent | sequential | lifecycle
		/** Who triggered it (user id as text) — feeds the account-visibility view. */
		triggeredBy: text("triggered_by"),
		/** Soft link to the pipeline run that fired this hook, if any. */
		runId: text("run_id"),
		queuedAt: timestamp("queued_at").notNull(),
		startedAt: timestamp("started_at").notNull(),
		finishedAt: timestamp("finished_at").notNull(),
		durationMs: integer("duration_ms").notNull(),
		ok: boolean("ok").notNull(),
		outcome: text("outcome").notNull(), // ok | error | timeout | killed | load | missing
		reason: text("reason")
	},
	(t) => [
		index("plugin_hook_invocations_plugin_idx").on(
			t.pluginId,
			t.finishedAt
		),
		index("plugin_hook_invocations_run_idx").on(t.runId)
	]
)

export const pipelineTypeRegistry = pgTable(
	"pipeline_type_registry",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		typeId: text("type_id").notNull(),
		version: integer("version").notNull().default(1),
		kind: text("kind").notNull(),
		ownerPluginId: integer("owner_plugin_id"),
		status: text("status").notNull().default("live"), // live | deprecated | removed
		transport: text("transport").notNull().default("node"), // node | process
		ports: json("ports").notNull().default({}).$type<Record<string, any>>(),
		slots: json("slots").notNull().default({}).$type<Record<string, any>>(),
		configSchema: json("config_schema").$type<Record<string, any> | null>(),
		effects: text("effects"),
		/**
		 * Whether a failure here is absorbed as an empty result — and so
		 * whether the node may be switched off at all.
		 *
		 * It was in the content hash from the start but stored nowhere, which
		 * meant the panel could not read it: the only other source is the
		 * in-process descriptor, which does not exist for a `transport:
		 * 'process'` plugin type and is the exact thing F6 forbids reaching
		 * for. A property the hash protects but no reader can see is a
		 * declaration that only the executor honours.
		 */
		optional: boolean("optional").notNull().default(false),
		/**
		 * Script types only: how a chain of this operation treats what its
		 * links return — `transform` folds into the flowing variable bag,
		 * `verdict` is consumed by the hook and reduced (18 §5).
		 *
		 * NULL on every node type, which is not a default standing in for a
		 * value: a node type has no chain semantics to have. Stored rather than
		 * read off the descriptor for the reason `slots` is — the panel renders
		 * from rows and never loads the plugin that owns a type (F6), and a
		 * `transport: 'process'` script type has no descriptor in this process
		 * at all.
		 */
		semantics: text("semantics"),
		/**
		 * Interior script points (18 §4e), for node types that declare them.
		 * Stored for the reason `slots` is — the panel offers one chain option
		 * per point and renders from rows, never from an in-process descriptor
		 * (F6). Keys are hashed contract; labels refresh like slot text.
		 */
		scriptPoints: json("script_points").$type<Array<
			Record<string, unknown>
		> | null>(),
		/**
		 * The session-shape contract (19 §1) — present only on mode-bearing input
		 * types. Stored for the reason `slots` is: the mode picker and session
		 * settings render from rows (F6). Hashed contract; display stripped.
		 */
		sessionShape: json("session_shape").$type<Record<
			string,
			unknown
		> | null>(),
		causesEvent: text("causes_event"),
		isPublic: boolean("is_public").notNull().default(false),
		declaresRandomness: boolean("declares_randomness")
			.notNull()
			.default(false),
		earlyExit: boolean("early_exit").notNull().default(false),
		timeoutMsDefault: integer("timeout_ms_default"),
		timeoutKind: text("timeout_kind").default("wall"), // wall | idle
		connectionKind: text("connection_kind"),
		usageExtractor: text("usage_extractor"),
		i18n: json("i18n").$type<Record<string, any> | null>(),
		/** Which release seeded the row — what a drift diagnostic reports against. */
		release: text("release"),
		contentHash: text("content_hash")
	},
	(t) => [
		uniqueIndex("pipeline_type_registry_type_version_idx").on(
			t.typeId,
			t.version
		)
	]
)

/**
 * Core-defined events. Plugins cannot define events in 0.6 (F8, 13 §7g), and
 * the column is reserved rather than absent so reopening that is a permission
 * rather than a migration.
 */
export const pipelineEventRegistry = pgTable("pipeline_event_registry", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	slug: text("slug").notNull().unique(),
	version: integer("version").notNull().default(1),
	/**
	 * DATA events describe a change and carry write-target mappings, so they
	 * participate in the cycle check. ACTION events (`ui-action`,
	 * `schedule-tick`) have no write targets and drop out of it by
	 * construction, rather than needing an exception (13 §7g).
	 */
	family: text("family").notNull().default("data"), // data | action
	payloadShape: json("payload_shape").$type<Record<string, any> | null>(),
	ownerPluginId: integer("owner_plugin_id"),
	/** What makes consent enforceable without hand-classifying each event (11 §4). */
	affectsUser: boolean("affects_user").notNull().default(false),
	descriptionI18n: json("description_i18n").$type<Record<
		string,
		any
	> | null>()
})

export const pipelineEventSubscriptions = pgTable(
	"pipeline_event_subscriptions",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/**
		 * The reference exactly as the document wrote it, `core:event/x@1`. Stored
		 * verbatim because a subscription is a pin, and re-deriving the string from
		 * its parts silently rewrites a document on the way back out — the version
		 * suffix was the first thing C1 caught.
		 */
		eventRef: text("event_ref").notNull(),
		/** Split out for joins and the cycle check; never used to rebuild `eventRef`. */
		eventSlug: text("event_slug").notNull(),
		eventVersion: integer("event_version").notNull().default(1),
		specVersionId: integer("spec_version_id")
			.notNull()
			.references(() => pipelineSpecVersions.id, { onDelete: "cascade" }),
		presetId: integer("preset_id").references(() => pipelinePresets.id, {
			onDelete: "set null"
		}),
		depthBound: integer("depth_bound"),
		enabled: boolean("enabled").notNull().default(true),
		createdBy: integer("created_by").references(() => users.id, {
			onDelete: "set null"
		})
	}
)

export const pipelineSpecsRelations = relations(pipelineSpecs, ({ many }) => ({
	versions: many(pipelineSpecVersions)
}))

export const pipelineSpecVersionsRelations = relations(
	pipelineSpecVersions,
	({ one, many }) => ({
		spec: one(pipelineSpecs, {
			fields: [pipelineSpecVersions.specId],
			references: [pipelineSpecs.id]
		}),
		nodes: many(pipelineNodes),
		edges: many(pipelineEdges),
		blocks: many(pipelineBlocks),
		includes: many(pipelineIncludes),
		presets: many(pipelinePresets)
	})
)

export const pipelineNodesRelations = relations(pipelineNodes, ({ one }) => ({
	specVersion: one(pipelineSpecVersions, {
		fields: [pipelineNodes.specVersionId],
		references: [pipelineSpecVersions.id]
	})
}))

export const pipelineEdgesRelations = relations(pipelineEdges, ({ one }) => ({
	specVersion: one(pipelineSpecVersions, {
		fields: [pipelineEdges.specVersionId],
		references: [pipelineSpecVersions.id]
	}),
	fromNode: one(pipelineNodes, {
		fields: [pipelineEdges.fromNodeId],
		references: [pipelineNodes.id],
		relationName: "edgeFrom"
	}),
	toNode: one(pipelineNodes, {
		fields: [pipelineEdges.toNodeId],
		references: [pipelineNodes.id],
		relationName: "edgeTo"
	})
}))

export const pipelinePresetsRelations = relations(
	pipelinePresets,
	({ one, many }) => ({
		specVersion: one(pipelineSpecVersions, {
			fields: [pipelinePresets.specVersionId],
			references: [pipelineSpecVersions.id]
		}),
		values: many(pipelinePresetValues)
	})
)

export const pipelinePresetValuesRelations = relations(
	pipelinePresetValues,
	({ one }) => ({
		preset: one(pipelinePresets, {
			fields: [pipelinePresetValues.presetId],
			references: [pipelinePresets.id]
		})
	})
)

/**
 * Per-user, per-session surface-grid layout (21 §10). Availability is
 * declaration (the mode's `SessionShape.panels` + plugin `surfaces.panels[]`),
 * recomputed and never stored; only *activation + placement* live here, and
 * only for the panels a user has actually touched or that a `surface:open`
 * intent activated for them. No row → the client derives defaults from the
 * mode's declared panels. One row per (user, session).
 *
 * `layout` stores **relative** order/priority + sparse per-tier size overrides,
 * never absolute grid columns, so a hand-tuned wide layout degrades sanely when
 * the content box narrows a tier (21 §5).
 */
export const sessionPanelLayouts = pgTable(
	"session_panel_layouts",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		sessionId: integer("session_id")
			.notNull()
			.references(() => sessions.id, { onDelete: "cascade" }),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		/**
		 * `{ active: [{ id, order, span, collapsed, drawered }],
		 *    tierSizeOverrides: { [tier]: { [panelId]: fr } } }`.
		 * Shape owned by the client surface manager (21); the server stores it
		 * verbatim and never interprets it — a forward-compatible blob.
		 */
		layout: json("layout")
			.notNull()
			.default({})
			.$type<Record<string, unknown>>(),
		/**
		 * The user's ACTIVE layout selection for this session (PLAN 25 redesign,
		 * 2026-08-30): which saved preset they've applied. NULL = the genre
		 * default. The preset DEFINITION lives in `session_layout_presets`; this
		 * row holds only the reference + the per-widget settings below — the
		 * active selection, never the preset itself.
		 */
		layoutPresetId: integer("layout_preset_id").references(
			() => sessionLayoutPresets.id,
			{ onDelete: "set null" }
		),
		/**
		 * Per-widget settings that are the USER's, not the preset's — arbitrary
		 * per-component config a preset shouldn't carry (a background-image
		 * reference, etc.), keyed by widget id. Stored verbatim.
		 */
		layoutSettings: json("layout_settings")
			.notNull()
			.default({})
			.$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [
		uniqueIndex("session_panel_layouts_user_session_idx").on(
			t.userId,
			t.sessionId
		)
	]
)

/**
 * Saved layout presets (PLAN 25 redesign, ruled 2026-08-30). A preset is a
 * reusable layout DEFINITION scoped to a session type (genre); `authorUserId`
 * NULL = a system/default preset seeded per genre, set = a user-authored one.
 * The user's ACTIVE choice and their per-widget settings ride the per-user
 * `session_panel_layouts` row (layoutPresetId / layoutSettings) — this table is
 * only the definitions, never the active selection.
 */
export const sessionLayoutPresets = pgTable(
	"session_layout_presets",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** Seeded system defaults match on this (seed rule); NULL for user presets. */
		seedKey: text("seed_key").unique(),
		/** The parent session type — a genre id (e.g. `core:genre/chat`). */
		genreId: text("genre_id").notNull(),
		/** NULL = system/default; set = the user who authored this preset. */
		authorUserId: integer("author_user_id").references(() => users.id, {
			onDelete: "cascade"
		}),
		name: text("name").notNull(),
		/**
		 * The arrangement, stored verbatim: `{ zoneLayout?, widgetGrid?,
		 * arrangedGrid? }` — the same blob the client layout editor produces.
		 */
		layout: json("layout")
			.notNull()
			.default({})
			.$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [
		index("session_layout_presets_genre_idx").on(t.genreId),
		index("session_layout_presets_author_idx").on(t.authorUserId)
	]
)

/**
 * Widget styles (PLAN 25, ruled 2026-08-30) — the skins a session widget wears.
 * One table for both the presets a widget ships (`source: "system"`) and the
 * styles users create (`source: "user"`), told apart by `source`/`ownerUserId`.
 *
 * `slug` is the stable reference target a saved layout pins with its id+slug
 * `WidgetStyleRef`. For system rows it is the reseed-stable `systemStyleSlug`
 * (`<widgetId>:<presetSlug>`); the seed reconciler upserts and prunes system
 * rows by matching on it, NEVER on a numeric id (the codified seed rule) — and
 * every write it makes is scoped `source = 'system'`, so a user row can never be
 * overwritten or pruned by a reseed even if it shared a slug.
 *
 * Visibility governs who may SEE/USE a row (management is owner + admin):
 *   system  → everyone; managed only by the reconciler.
 *   private → the owner only.
 *   shared  → everyone on the instance; managed by owner + admin.
 */
export const widgetStyles = pgTable(
	"widget_styles",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** Stable, reseed-safe reference target for a layout's style pin. */
		slug: text("slug").notNull().unique(),
		/** The widget this styles (WidgetDecl/PanelDecl id). */
		widgetSlug: text("widget_slug").notNull(),
		/** 'system' = shipped+seeded (reconciler-managed); 'user' = hand-made. */
		source: text("source").notNull().default("user"),
		/** null for system rows; the creator for user rows. */
		ownerUserId: integer("owner_user_id").references(() => users.id, {
			onDelete: "cascade"
		}),
		/** 'system' | 'private' | 'shared' — who may see/use it. */
		visibility: text("visibility").notNull().default("private"),
		title: text("title").notNull(),
		/** Scoped skin CSS injected into the widget container / frame document. */
		css: text("css").notNull().default(""),
		/** Design-token overrides (CSS custom properties). */
		vars: json("vars")
			.notNull()
			.default({})
			.$type<Record<string, string>>(),
		/** Provenance: the app/plugin version that last seeded a system row. */
		seededByVersion: text("seeded_by_version"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [
		index("widget_styles_widget_idx").on(t.widgetSlug),
		index("widget_styles_owner_idx").on(t.ownerUserId),
		check(
			"widget_styles_source_check",
			sql`${t.source} IN ('system', 'user')`
		),
		check(
			"widget_styles_visibility_check",
			sql`${t.visibility} IN ('system', 'private', 'shared')`
		)
	]
)

/**
 * Session presets (23 §9) — the bundle a person actually chooses to start a
 * session: which type (create spec), optionally which primary variant, which
 * pipeline configurations, which actions. The preset semantics that used to
 * squat on `pipeline_configs` (`enabled`, `includedActions`) live here now;
 * pipeline configs go back to being value-sets against one spec.
 */
export const sessionPresets = pgTable(
	"session_presets",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** Never a fixed id (seed rule): seeds match on this key. */
		seedKey: text("seed_key").unique(),
		name: text("name").notNull(),
		description: text("description"),
		/** The session genre — a genre id (24 §3). */
		genreId: text("genre_id").notNull(),
		/** Variant primary's slug; null = the type's default primary. */
		primarySlug: text("primary_slug"),
		/**
		 * The event bindings (24 §1): event → {spec, config?}. The preset
		 * editor's model — required slots must be bound for the preset to be
		 * enabled; validated against the input locks at write.
		 */
		bindings: json("bindings")
			.notNull()
			.default({})
			.$type<Record<string, { spec: string; config?: number }>>(),
		/** specSlug → pipeline_configs.id, per involved pipeline. */
		configSelections: json("config_selections")
			.notNull()
			.default({})
			.$type<Record<string, number>>(),
		/** The curation formerly on pipeline_configs. Null = the companion rule. */
		includedActions: json("included_actions").$type<string[] | null>(),
		/** Optional pre-fill for creation (fields, lorebook policy…). */
		defaults: json("defaults").$type<Record<string, unknown> | null>(),
		/** May users pick it? Disabled presets stay for admins and history. */
		enabled: boolean("enabled").notNull().default(true),
		isDefault: boolean("is_default").notNull().default(false),
		isImmutable: boolean("is_immutable").notNull().default(false),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [index("session_presets_genre_idx").on(t.genreId)]
)

/**
 * Per-genre administration (23 §9, renamed 24 §2): may users start sessions
 * of this genre, and which preset a bare "new session" of it uses. One row
 * per genre id, absent row = enabled with no declared default.
 */
export const sessionGenreSettings = pgTable("session_genre_settings", {
	genreId: text("genre_id").primaryKey(),
	enabled: boolean("enabled").notNull().default(true),
	defaultPresetId: integer("default_preset_id"),
	updatedAt: timestamp("updated_at")
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
})

export const sessionPanelLayoutsRelations = relations(
	sessionPanelLayouts,
	({ one }) => ({
		session: one(sessions, {
			fields: [sessionPanelLayouts.sessionId],
			references: [sessions.id]
		}),
		user: one(users, {
			fields: [sessionPanelLayouts.userId],
			references: [users.id]
		})
	})
)

// ─── Remote access (plan 26) ─────────────────────────────────────────────────

/**
 * Instance-level network identity (26 §2). Deliberately thin: a stable anchor
 * for instance-scoped, non-model-provider settings — tunnels today — and NOT a
 * home for Ollama/KoboldCPP, which stay exactly where they are. Whether those
 * ever migrate here is a separate decision plan 26 explicitly does not make.
 *
 * Exactly one row exists today: the seeded `local` server. Matched on `slug`,
 * never on `id` — see db/defaults.ts for why matching on id was unsafe.
 */
export const servers = pgTable("servers", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	/** Stable seed identity; the seeded row is "local". */
	slug: text("slug").notNull().unique(),
	name: text("name").notNull(),
	/** True only for "local". App code refuses deletion of a seeded server. */
	isSeeded: boolean("is_seeded").notNull().default(false),
	createdAt: timestamp("created_at").notNull().defaultNow()
})

/**
 * How the local server becomes reachable from outside (26 §3).
 *
 * **Its own table, not a row shape under `connections`, on purpose.** A
 * connection credential gates what a model says; a tunnel credential gates
 * whether this entire instance is reachable from the public internet. Nothing
 * in the script/hook/plugin broker may ever read, write, enable, or attach to a
 * tunnel row — not as a revocable permission grant, but as a surface the broker
 * never exposes at all. That isolation is enforced at four layers: this table,
 * its own encryption keyInfo (TUNNEL_CREDENTIAL_KEY_INFO), its own socket
 * namespace (sockets/tunnels.ts), and never being wired into contrib/ dispatch.
 * If a later refactor is tempted to fold this into `connections` for
 * convenience, don't — that convenience is the mistake this table prevents.
 */
export const tunnels = pgTable(
	"tunnels",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		serverId: integer("server_id")
			.notNull()
			.references(() => servers.id, { onDelete: "cascade" }),
		/**
		 * Open text, not a pg enum (26 §7), so adding a provider later is a data
		 * change rather than a migration. See shared/constants/Tunnels.ts.
		 */
		provider: text("provider").notNull().$type<TunnelProvider>(),
		/**
		 * Redundant with `provider` while only Cloudflare is implemented, and kept
		 * separate anyway: most UI/supervisor logic branches on mode, not provider,
		 * and that split shouldn't need a schema change to introduce.
		 */
		mode: text("mode").notNull().$type<TunnelMode>(),
		/**
		 * EncryptedToken envelope (AES-256-GCM via tokenCrypto.ts, keyed with
		 * TUNNEL_CREDENTIAL_KEY_INFO). Null for ephemeral providers, which have no
		 * credential at all. Write-only: never redisplayed to the client, same
		 * convention as every other API-key field in the app.
		 */
		credential: json("credential").$type<{
			ciphertext: string
			iv: string
			authTag: string
		} | null>(),
		/** The custom domain, or the last-observed ephemeral URL's hostname. */
		hostname: text("hostname"),
		enabled: boolean("enabled").notNull().default(false),
		/**
		 * Start this tunnel on app boot (26 §4). Defaults to false, and that
		 * default is load-bearing: an instance that silently republishes itself to
		 * the internet after a restart or a `docker compose up` is exactly the
		 * surprise this feature exists to avoid. Only an explicit admin action sets
		 * it. Auto-start is not a privileged path — it re-checks every gate
		 * `tunnels:enable` checks, and runs *after* TTL reconciliation.
		 */
		autoStart: boolean("auto_start").notNull().default(false),
		/** Supervisor-written, not admin-editable. */
		status: text("status")
			.notNull()
			.default("stopped")
			.$type<TunnelStatus>(),
		lastError: text("last_error"),
		/**
		 * The admin's saved preference, which persists across enable/disable
		 * cycles. Null = no expiry. Distinct from `expiresAt` on purpose.
		 */
		ttlSeconds: integer("ttl_seconds"),
		/**
		 * The computed deadline for the *current* run — recomputed as
		 * now() + ttlSeconds on every off -> on transition (including auto-start),
		 * so re-enabling never inherits a stale deadline.
		 */
		expiresAt: timestamp("expires_at"),
		startedAt: timestamp("started_at"),
		stoppedAt: timestamp("stopped_at"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [
		/**
		 * At most one enabled tunnel per server (26 §3). A partial unique index
		 * rather than an app-level check because the failure it prevents is real
		 * and physical: two tunnel processes fighting over the same local port.
		 * Partial (WHERE enabled) so any number of disabled rows can coexist.
		 */
		uniqueIndex("tunnels_one_enabled_per_server")
			.on(t.serverId)
			.where(sql`${t.enabled}`)
	]
)

export const serversRelations = relations(servers, ({ many }) => ({
	tunnels: many(tunnels)
}))

export const tunnelsRelations = relations(tunnels, ({ one }) => ({
	server: one(servers, {
		fields: [tunnels.serverId],
		references: [servers.id]
	})
}))

// ─── Two-factor authentication (plan 26 §10) ─────────────────────────────────

/**
 * One TOTP enrolment per user.
 *
 * `enabledAt` stays NULL between generating a secret and the user proving they
 * can produce a code from it. That gap is the whole reason the column exists:
 * an enrolment that took effect before it was verified would lock a user out of
 * their own account using a secret they never successfully scanned.
 */
export const userTotp = pgTable("user_totp", {
	userId: integer("user_id")
		.primaryKey()
		.references(() => users.id, { onDelete: "cascade" }),
	/** EncryptedToken envelope, keyed with TOTP_SECRET_KEY_INFO. */
	secret: json("secret")
		.notNull()
		.$type<{ ciphertext: string; iv: string; authTag: string }>(),
	/** NULL until the first live code is confirmed. */
	enabledAt: timestamp("enabled_at"),
	/**
	 * Anti-replay. A TOTP code stays valid for its 30-second step plus the
	 * drift window either side, so an intercepted code has a ~90s life unless
	 * the step it belongs to is burned on first use.
	 */
	lastUsedStep: integer("last_used_step"),
	createdAt: timestamp("created_at").notNull().defaultNow()
})

/**
 * Single-use recovery codes.
 *
 * Hashed, never encrypted: this is a verify-by-compare secret, and nothing
 * needs to read the original back. Rows are kept after use rather than deleted
 * so "how many are left" stays answerable and a used code can never silently
 * become valid again.
 */
export const userTotpRecoveryCodes = pgTable(
	"user_totp_recovery_codes",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		userId: integer("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		codeHash: text("code_hash").notNull(),
		usedAt: timestamp("used_at"),
		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(t) => [index("user_totp_recovery_codes_user_idx").on(t.userId)]
)

export const userTotpRelations = relations(userTotp, ({ one }) => ({
	user: one(users, {
		fields: [userTotp.userId],
		references: [users.id]
	})
}))

export const userTotpRecoveryCodesRelations = relations(
	userTotpRecoveryCodes,
	({ one }) => ({
		user: one(users, {
			fields: [userTotpRecoveryCodes.userId],
			references: [users.id]
		})
	})
)

/**
 * One-time invitations (plan 27 §3).
 *
 * Two kinds, and the difference is whether an account exists yet:
 *
 * - `register` — no account behind it. The recipient chooses their own username
 *   and password, and the account is created on redemption. This is what lets
 *   an admin add people without hand-delivering credentials, while the invite
 *   itself remains the authorisation.
 * - `account` — bound to an existing user. Redeeming replaces their password
 *   and deletes their two-factor credentials, which makes it the polished form
 *   of the tier-2 recovery in 26 §10: a link, instead of an admin reading a
 *   temporary password down the phone.
 *
 * The token is stored only as a hash. It is a bearer credential — whoever holds
 * it becomes the account — so it gets the same treatment as a recovery code,
 * plus a deliberately tight two-hour expiry.
 */
export const accountInvites = pgTable(
	"account_invites",
	{
		id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
		/** SHA-256 of the token. The token itself is shown once and never stored. */
		tokenHash: text("token_hash").notNull().unique(),
		kind: text("kind").notNull().$type<"register" | "account">(),
		/** Set for `account` invites; NULL for `register`, which has no user yet. */
		userId: integer("user_id").references(() => users.id, {
			onDelete: "cascade"
		}),
		createdBy: integer("created_by").references(() => users.id, {
			onDelete: "set null"
		}),
		expiresAt: timestamp("expires_at").notNull(),
		/** Set atomically on claim, which is what makes it single-use. */
		usedAt: timestamp("used_at"),
		revokedAt: timestamp("revoked_at"),
		createdAt: timestamp("created_at").notNull().defaultNow()
	},
	(t) => [index("account_invites_user_idx").on(t.userId)]
)

export const accountInvitesRelations = relations(accountInvites, ({ one }) => ({
	user: one(users, {
		fields: [accountInvites.userId],
		references: [users.id]
	})
}))
