// @ts-nocheck — a build artifact, not source: this is `serene-pub build`
// output, checked in so the install has a real package to read.
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// ../serene-pub-sdk/sdk-tests/fixtures/unified-plugin/src/index.ts
var src_exports = {};
__export(src_exports, {
  CREATE_SPEC_ID: () => CREATE_SPEC_ID,
  PLUGIN_SLUG: () => PLUGIN_SLUG,
  RESPOND_SPEC_ID: () => RESPOND_SPEC_ID,
  TALLY_PANEL_ID: () => TALLY_PANEL_ID,
  default: () => src_default,
  extension: () => extension,
  tallyDefinition: () => tallyDefinition,
  tallyGenre: () => tallyGenre,
  tallyHandler: () => tallyHandler
});

// ../serene-pub-sdk/sdk/src/shapes.ts
var registry = /* @__PURE__ */ new Map();
function defineShape(def) {
  registry.set(def.id, def);
  return def.id;
}
var S = {
  text: defineShape({ id: "core:shape/text@1" }),
  textStream: defineShape({
    id: "core:shape/text-stream@1",
    assignableTo: ["core:shape/text@1"],
    streaming: true
  }),
  sessionScope: defineShape({ id: "core:shape/session-scope@1" }),
  /**
   * Transcript rows — what `session-history@1` publishes on `main` and
   * `messages` and what `process-messages@1` / `prose-transcript@1` read
   * (declared so since 2026-09-17, U5d review W9; the port had said
   * `context-candidates@1` since the SDK was vendored while the value was
   * always rows, and `validate()` never ran over the catalog to say so).
   *
   * **Not assignable to `context-candidates@1`** (U5d review R-a, the same
   * day; W9 had declared it one way). A transcript wired into a candidates
   * port is a wiring the host silently drops: `concat-candidates` keys a
   * row that is not a candidate as `undefined:<id>`, the ranker's `select`
   * excludes it as `excluded_unknown_source`, and `assemble` handed rows
   * as candidates halts on "no ranking decisions". The transcript's place
   * in the window rides the **`band`** port — one intent element, which a
   * spec concatenates in with the lore so the ranker reserves the
   * conversation's slice — and the rows themselves go to
   * `process-messages`. `validate()` says so (a warning naming the fix)
   * rather than refusing, so a document built from the older corpus still
   * compiles. The reverse was never declared either: a ranked candidates
   * list is not a transcript, and a port that reads rows is handed rows.
   */
  messages: defineShape({ id: "core:shape/messages@1" }),
  candidates: defineShape({ id: "core:shape/context-candidates@1" }),
  renderedBlocks: defineShape({ id: "core:shape/rendered-blocks@1" }),
  assembled: defineShape({ id: "core:shape/assembled-context@1" }),
  /**
   * What Assemble publishes after the allocation/formatting split (16 §7): ordered
   * **blocks** with role, source, token count and a `why` trail — not prose. The
   * Provider's `wire` slot turns it into whatever its connection actually wants.
   *
   * Assignable to `assembled-context@1` so existing specs keep connecting while core
   * migrates; the reverse is not assignable, because a rendered string has already
   * thrown away everything the panel and the budget need.
   */
  allocated: defineShape({
    id: "core:shape/allocated-context@1",
    assignableTo: ["core:shape/assembled-context@1"]
  }),
  /**
   * The object a context template renders against: characters, personas,
   * scenario, the prompt texts, the resolved names.
   *
   * Its own shape rather than `json@1` so that a plugin supplying an alternative
   * context builder has something to publish, and so a spec that wires the wrong
   * node into Assemble's context port fails at publish rather than rendering a
   * template full of blanks — which reads as a broken template, and sends the
   * user to the wrong screen.
   */
  /**
   * The chat's cast and prompt config, as rows — before any decision about who
   * is shown or named. The input to the context builder, kept distinct from the
   * built context so the two can be replaced independently.
   */
  sessionCast: defineShape({ id: "core:shape/session-cast@1" }),
  /**
   * The MCP connection kind (14 §1). A connection whose shape is `mcp` is a
   * Model Context Protocol server core talks to — foreign code SP speaks
   * JSON-RPC with, never code SP loads. The shape doubles as the connection
   * kind (F17), so only MCP connections are offerable on an MCP provider's
   * connection slot.
   */
  mcp: defineShape({ id: "core:shape/mcp@1" }),
  templateContext: defineShape({ id: "core:shape/template-context@1" }),
  vector: defineShape({ id: "core:shape/vector@1" }),
  budget: defineShape({ id: "core:shape/context-budget@1" }),
  rowIds: defineShape({ id: "core:shape/row-ids@1" }),
  /**
   * The output of an async block or a map (01 §1, 13 §1). An ordered list in
   * **declaration order**, one entry per branch — never a merged object, because
   * merging needs a field-collision policy and every such policy is wrong for
   * somebody. `async` and `map` produce the same shape, so one equivalence
   * harness covers both (F26).
   */
  branchResults: defineShape({ id: "core:shape/branch-results@1" }),
  /**
   * What a **gate-eligible** Consumer publishes (13 §7j-b). Discriminated, because
   * a write may in principle land as a proposal rather than a row — and a
   * proposal id in a shared id space is indistinguishable from a real row id
   * right up until the foreign key dangles.
   *
   * **Assignable to `row-ids@1`** since the 2026-09-15 rulings (09-B B4, R-17).
   * It was deliberately not, and the reason was the `async` review position:
   * a row proposed under it might never exist. That position is gone
   * (`review.ts` — on or off, nothing between): `on` parks the run until the
   * decision and a rejection halts it, so by the time any downstream node
   * runs, the ids a committed result carries ARE row ids. That is what makes
   * a create → update pair on one row inside one run legal, and it is how a
   * pipeline owns its reply: a placeholder outlet straight after the inlet,
   * and an `update-message` at the end that fills it.
   */
  writeResult: defineShape({
    id: "core:shape/write-result@1",
    assignableTo: ["core:shape/row-ids@1"]
  }),
  /**
   * A request to summarize something into a lore entry.
   *
   * Its own shape rather than `json@1` because it is what the summarize
   * pipelines take as *input*, and 11 §2 matches an event's payload against a
   * pipeline's Input contract by shape. A request typed as bare json would make
   * every pipeline compatible with every event.
   */
  summarizeRequest: defineShape({ id: "core:shape/summarize-request@1" }),
  /**
   * The ordered batch drafts phase 1 produces, before synthesis merges them.
   *
   * Ordered, and the order is load-bearing: the drafts are chronological
   * slices of a conversation and synthesis reads them as a sequence. A shape
   * that permitted reordering would turn a narrative into a pile of events.
   */
  drafts: defineShape({ id: "core:shape/drafts@1" }),
  /** Scenes with their messages, as the graph builder walks them. */
  graphScenes: defineShape({ id: "core:shape/graph-scenes@1" }),
  /**
   * A proposed set of graph nodes and relationships, before a person approves it.
   *
   * Distinct from anything holding row ids, for the reason `write-result@1`
   * exists: a proposal is not yet a row, and a downstream node that treated it
   * as one would wire a foreign key to something a reviewer may still reject.
   */
  graphProposal: defineShape({ id: "core:shape/graph-proposal@1" }),
  /**
   * Who speaks next, and how that was decided (19 §5).
   *
   * Its own shape rather than `row-ids@1` because it is the swap-list
   * membership test: a task whose `main` publishes this shape *is* a
   * next-speaker strategy, and the dropdown is a SELECT over such rows — an
   * extension's strategy appears beside core's by existing, the same way a
   * chat mode does. The bundle carries `{speaker, characterId, strategy, via}`
   * — the speaker as a participant reference beside the bare id (R-18 (3)) —
   * and each rides its own port for wiring.
   */
  speakerSelection: defineShape({ id: "core:shape/speaker-selection@1" }),
  /**
   * A participant reference (R-15, R-18 (3)): `character:<id>`,
   * `envoy:<slug>`, `user:<id>`, or a role — see `participants.ts`.
   *
   * The inlet's `speaker` port and a turn strategy's carry this, so one
   * port answers "who is speaking" for a library character and a genre's
   * envoy alike. Not assignable to `row-ids@1` on purpose: a reference is a
   * name, and a node that wants the bare character id keeps reading
   * `characterId` until every reader speaks references.
   */
  participantRef: defineShape({ id: "core:shape/participant-ref@1" }),
  /**
   * An ordered list of participant references, no duplicates (lair pass R3,
   * 2026-09-28): the inlet's `recipients` — the cast members a press
   * collected (`CollectedRecipients`). Its own id rather than `json@1` so a
   * port that wants people is not handed any list. Consumed by
   * `core:query/resolve-state-changes@1`'s `owners` (R10): the Whisper's
   * one change, made on each recipient.
   */
  participantRefs: defineShape({ id: "core:shape/participant-refs@1" }),
  /**
   * One **session change** (R-15, built 2026-09-16): the payload every
   * built-in write's event carries — `{ event, sessionId, messageId, at,
   * … }` plus what was lost or replaced (`lost` on a delete, `previous` on
   * an edit or a swipe). The next reply's inlet publishes the changes since
   * the last one as a list on its `sessionChanges` port, so a pipeline knows the
   * history it sees has moved. See `SessionChangePayload` in events.ts.
   *
   * Its own id rather than `json@1`, for the reason `summarize-request@1`
   * gives: `pipeline_event_registry.payload_shape` names it, and an event
   * whose payload was bare json would match every inlet.
   */
  sessionChange: defineShape({ id: "core:shape/session-change@1" }),
  /**
   * A **form addressed** to a participant the AI portrays (R-15 *Forms*;
   * 30 §U5d): the payload of `core:event/form-addressed@1` — `{ sessionId,
   * messageId, blockId, action, addressee }` (`FormAddressedPayload`,
   * events.ts) — and what `core:inlet/form-addressed@1` publishes, port by
   * port, with the block itself beside them. Its own id for the reason
   * `session-change@1` has: the registry's `payload_shape` names it.
   */
  formAddressed: defineShape({ id: "core:shape/form-addressed@1" }),
  /**
   * A **cast change** (PLAN-turn-order §4.1): the payload of
   * `core:event/cast-changed@1` — `{ event, sessionId, at, cause, ref,
   * change, value }` (`CastChangePayload`, events.ts). A seated
   * participant was switched on or off, or its `position` or portrayal moved;
   * a seat added or removed is `member-added` / `member-removed`, not
   * this. Its own id for the reason `session-change@1` has.
   */
  castChange: defineShape({ id: "core:shape/cast-change@1" }),
  /**
   * **Annex changed** (PLAN-turn-order §4.14, R30): the payload of
   * `core:event/annex-changed@1` — `{ event, sessionId, at, cause, owner }`
   * (`AnnexChangePayload`, events.ts). Names whose entry moved, never the
   * value.
   */
  annexChange: defineShape({ id: "core:shape/annex-change@1" }),
  /** What a listener receives for an event a pipeline recorded: the envelope, the author's payload inside. */
  recordedEvent: defineShape({ id: "core:shape/recorded-event@1" }),
  /**
   * **Turn order changed** (§4.1): the payload of
   * `core:event/turn-order-changed@1` — `{ event, sessionId, at, cause,
   * runId, turnOrder }` (`TurnOrderChangedPayload`, events.ts), the
   * document as `core:outlet/set-turn-order@1` wrote it. Core-internal:
   * the auto-advance listener and the `sessions:turnOrder` push read it;
   * a genre may not bind a spec to it.
   */
  turnOrderChanged: defineShape({ id: "core:shape/turn-order-changed@1" }),
  /**
   * The session's **turn order** as state (§4.2): `TurnOrderV1` —
   * `{ v, order, candidates, basedOnAt, computedAt, runId, event,
   * strategy }`, stored at `sessions.metadata.turnOrder` and written by
   * `core:outlet/set-turn-order@1` alone. Not the entries alone and not
   * the candidates alone: the whole answer, with what it answered.
   */
  turnOrder: defineShape({ id: "core:shape/turn-order@1" }),
  /**
   * **Turn candidates** (§4.2): `TurnCandidateV1[]` — the participants the
   * pool admitted this run, in pool order. What `core:task/turn-pool@1`
   * publishes, an orderer rewrites, and a strategy reads. Open objects:
   * an orderer or a plugin may add keys and core passes them through.
   */
  turnCandidates: defineShape({ id: "core:shape/turn-candidates@1" }),
  /**
   * **Turn entries** (§4.2): `TurnEntryV1[]` — prepared turns, each
   * `{ ref, channel?, subject?, via }`. What a strategy publishes on
   * `main` and `order`; the shape-based swap list keys a strategy on it,
   * as it keyed one on `speaker-selection@1` before (that shape stays
   * until the strategies are re-ported).
   */
  turnEntries: defineShape({ id: "core:shape/turn-entries@1" }),
  /**
   * **Sprite choices** (DESIGN-sprites §5.2): what a line's speaker can show
   * — `{ characterId, set, defaultSet, labels, last, recent, decidedBy }`.
   * `set` is the sprite set in force for the line (a session override, the
   * cast member's amendment, or the card's default — `decidedBy` says
   * which); `labels` are that set's sprite labels with an image; `last` is
   * the speaker's previous shown sprite, for stickiness. What
   * `core:oracle/pick-sprite@1` publishes beside its pick, for the receipt.
   */
  spriteChoices: defineShape({ id: "core:shape/sprite-choices@1" }),
  /**
   * **A sprite pick**: `{ set, label, score?, runnerUp?, held? } | null` — the
   * sprite a picker chose for a line, or null for none. What the sprite
   * picker publishes on `main` and `core:outlet/show-sprite@1` records.
   */
  spritePick: defineShape({ id: "core:shape/sprite-pick@1" }),
  /**
   * The **settings document** (§4.12): `SessionSettingsV1` — every
   * setting a person can see in session settings, resolved once per run
   * with the cascade applied (session > genre > core), and handed to the
   * inlet as `session`. A spec reads `$.input.session.fields.tone` and
   * never learns which table it came from.
   */
  sessionSettings: defineShape({ id: "core:shape/session-settings@1" }),
  /**
   * A reference to stored media of any kind — the general port type.
   *
   * `image@1` and `audio@1` stay, and are assignable **to** this, so every
   * spec wired to them keeps connecting while the general ports arrive. The
   * reverse is not assignable: a port that accepts any media cannot be handed
   * to one that has declared it only understands images. Same rule, and the
   * same reason, as `allocated-context` → `assembled-context`.
   */
  media: defineShape({ id: "core:shape/media-ref@1" }),
  /** An ordered list of media references — what a multimodal request carries
   *  as its attachments. */
  mediaList: defineShape({ id: "core:shape/media-refs@1" }),
  /**
   * 🚧 **A transcript's attachments, by message** (PLAN-composer-attachments
   * §3.5): `Record<messageId, HistoryAttachmentV1[]>` (media.ts) — each
   * message's `core:image` / `core:file` parts, in part order. What
   * `core:query/history-attachments@1` publishes and
   * `core:task/place-attachments@1` reads, so each line's files travel with
   * that line's own turn rather than with the request as a whole.
   */
  mediaByMessage: defineShape({ id: "core:shape/media-by-message@1" }),
  /**
   * A reply's **folded sections** (B4; D5, 2026-09-27): `FoldedSectionV1[]`
   * (widgets.ts) — each `{ kind, label, content }` or `{ kind, label, items }`,
   * shown collapsed beside the body and never read into the prompt. What the
   * message outlets' `sections` in-port takes.
   */
  foldedSections: defineShape({ id: "core:shape/folded-sections@1" }),
  audio: defineShape({
    id: "core:shape/audio@1",
    assignableTo: ["core:shape/media-ref@1"]
  }),
  image: defineShape({
    id: "core:shape/image@1",
    assignableTo: ["core:shape/media-ref@1"]
  }),
  json: defineShape({ id: "core:shape/json@1" }),
  /**
   * What a ranker judged (PLAN-sdk-1.0 §3.9, R64): one `RankingDecisionV1`
   * per candidate. A node whose out-port carries this shape is RECORDED by
   * the host — core's rankers and a plugin's alike — into the ranking store.
   * Reviewed with L1 (PLAN-sdk-1.0 §4 ✓); it carries `S`'s own tag.
   */
  decisions: defineShape({ id: "core:shape/decisions@1" }),
  // connection / sampling kinds — the same ids, which is the point (F17)
  /**
   * A model reply as an ordered list of typed parts (text, reasoning, media,
   * tool calls) rather than a string — see `OutputPart` in media.ts for why
   * that is now the honest shape of a completion.
   *
   * Assignable **to** `text-stream@1`, so a provider may start emitting parts
   * without breaking a single spec wired to its text output: the degrade
   * concatenates the prose and drops the rest. Not assignable in reverse,
   * because by then the ordering and the media are gone — the same
   * richer-to-poorer rule the allocated/assembled pair established.
   */
  partStream: defineShape({
    id: "core:shape/part-stream@1",
    assignableTo: ["core:shape/text-stream@1"],
    streaming: true
  }),
  textGen: defineShape({ id: "core:shape/text-gen@1" }),
  /**
   * Vector embedding — the connection kind, and deliberately **not** a
   * sampling vocabulary (yet).
   *
   * It is absent from `SAMPLING_SCHEMAS` on purpose, and the reason is
   * structural rather than unfinished work: every parameter an embedding call
   * would take — input truncation, pooling, normalisation, output dimensions,
   * the asymmetric query/passage prefixes E5/BGE/GTE want — changes what a
   * *stored* vector means, and nothing records which setting produced the
   * vectors already in the table. A text sampler affects one reply; an
   * embedding parameter silently re-defines a whole persistent index against
   * rows that will never be recomputed. That is the same re-index story the
   * prefixes are held back for, so none of them ship until it is decided.
   *
   * What is left after removing those is either not per-invocation at all
   * (model identity, transport, residency TTL — those belong to the
   * connection) or has no consumer (nothing chunks a batch). An empty
   * vocabulary is worse than no vocabulary here: `isKnownSamplingShape` in
   * core admits any shape this record has a key for, so registering `{}`
   * would let the write path accept a config that exists, looks saved, and
   * can never send anything — the exact state that guard was written to
   * refuse.
   */
  embeddings: defineShape({ id: "core:shape/embeddings@1" }),
  /**
   * Named-entity recognition — the connection kind for a mention detector.
   *
   * Declared ahead of its adapter so the model side has a stable noun to
   * name; core's extractor is dictionary-based and model-free today
   * (`core:extract/entities-heuristic@1`), and takes no parameters at all
   * beyond the text and the gazetteer.
   *
   * Like `embeddings`, and for the same two reasons, it has no entry in
   * `SAMPLING_SCHEMAS`: its one real knob (how much of a passage the
   * extractor is handed) is part of the annotation freshness triple, and an
   * empty vocabulary would defeat core's do-nothing-config guard.
   */
  ner: defineShape({ id: "core:shape/ner@1" }),
  tts: defineShape({ id: "core:shape/tts@1" }),
  imageGen: defineShape({ id: "core:shape/image-gen@1" })
};

// ../serene-pub-sdk/sdk/src/i18n.ts
var blank = (s) => s.trim().length === 0;
var isLocaleMap = (v2) => !!v2 && typeof v2 === "object" && !Array.isArray(v2) && typeof v2.en === "string";
var isI18n = (v2) => typeof v2 === "string" ? !blank(v2) : isLocaleMap(v2) && !blank(v2.en);
var localeMapOf = (v2) => typeof v2 === "string" ? { en: v2 } : v2;
var describe = (v2) => {
  if (v2 === null) return "null";
  if (Array.isArray(v2)) return "an array";
  if (typeof v2 === "object") return "an object without 'en'";
  return `a ${typeof v2}`;
};
function i18nFindings(v2, where, opts = {}) {
  if (v2 === void 0) {
    return opts.required ? [
      `${where} is required \u2014 display text, a string ('Title') or a locale map with 'en' ({ en: 'Title', fr: 'Titre' }) (R-20)`
    ] : [];
  }
  if (typeof v2 === "string") {
    return blank(v2) ? [`${where} is empty \u2014 give it text a person reads, 'Title' or { en: 'Title' } (R-20)`] : [];
  }
  if (isLocaleMap(v2)) {
    return blank(v2.en) ? [
      `${where}.en is empty \u2014 'en' is the text every other locale falls back to; write { en: 'Title' } (R-20)`
    ] : [];
  }
  return [
    `${where}: a locale map with a required 'en' (R-20) \u2014 got ${describe(v2)}; write 'Title' or { en: 'Title', fr: 'Titre' }`
  ];
}
function i18nText(v2, language = "en") {
  if (typeof v2 === "string") return v2;
  if (!isLocaleMap(v2)) return void 0;
  const wanted = v2[language];
  return typeof wanted === "string" && !blank(wanted) ? wanted : v2.en;
}

// ../serene-pub-sdk/sdk/src/hash.ts
var sortDeep = (v2) => {
  if (Array.isArray(v2)) return v2.map(sortDeep);
  if (v2 && typeof v2 === "object") {
    return Object.fromEntries(
      Object.entries(v2).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, sortDeep(val)])
    );
  }
  return v2;
};
function canonicalize(v2) {
  return JSON.stringify(sortDeep(v2));
}
function contentHash(v2) {
  const s = canonicalize(v2);
  let h1 = 3735928559;
  let h2 = 1103547991;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
var UNIVERSAL_DISPLAY = ["i18n", "description"];
var stripDisplay = (v2, display, functions = "source") => {
  if (typeof v2 === "function") return functions === "source" ? `[fn] ${String(v2)}` : void 0;
  if (Array.isArray(v2)) return v2.map((e) => stripDisplay(e, display, functions));
  if (v2 && typeof v2 === "object") {
    return Object.fromEntries(
      Object.entries(v2).filter(([k, val]) => !display.has(k) && !(functions === "omit" && typeof val === "function")).map(([k, val]) => [k, stripDisplay(val, display, functions)])
    );
  }
  return v2;
};
var DEFAULT_DISPLAY = new Set(UNIVERSAL_DISPLAY);
var displaySet = (opts) => opts?.display?.length ? /* @__PURE__ */ new Set([...UNIVERSAL_DISPLAY, ...opts.display]) : DEFAULT_DISPLAY;
function declarationData(v2, opts) {
  return stripDisplay(v2, displaySet(opts), "omit");
}
function declarationHash(v2, opts) {
  return contentHash(stripDisplay(v2, displaySet(opts)));
}
function refuseUnlessIdentical(existing, next, why, opts) {
  refuseUnlessSameHash(declarationHash(existing, opts), declarationHash(next, opts), why);
}
function refuseUnlessSameHash(registered, redeclared, why) {
  if (registered === redeclared) return;
  throw new Error(`${why} (registered ${registered}, redeclared ${redeclared})`);
}

// ../serene-pub-sdk/sdk/src/predicates.ts
var truthy = (v2) => !!v2 && !(Array.isArray(v2) && v2.length === 0);
function readPath(value, path) {
  if (!path) return value;
  let cur = value;
  for (const seg of path.split(".")) {
    if (cur == null) return void 0;
    cur = cur[seg];
  }
  return cur;
}
var PREDICATE_CONDITION_KEYS = ["equals", "equalsPath", "truthy"];
function predicateHolds(pred, value, scope) {
  if (pred.equals !== void 0) return value === pred.equals;
  if (pred.equalsPath !== void 0) {
    if (typeof pred.equalsPath !== "string" || !pred.equalsPath) return false;
    if (value === void 0) return false;
    const other = readPath(scope, pred.equalsPath);
    return other !== void 0 && value === other;
  }
  if (pred.truthy) return truthy(value);
  return false;
}
var ENABLED_WHEN_KEYS = [
  "on",
  ...PREDICATE_CONDITION_KEYS,
  "reason"
];
var FORBIDDEN_SEGMENTS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var isPrimitive = (v2) => v2 === null || ["string", "number", "boolean"].includes(typeof v2);
var isEnabledWhenShaped = (p) => !!p && typeof p === "object" && !Array.isArray(p) && typeof p.on === "string";
function normalizeEnabledWhen(x) {
  if (x == null) return [];
  const list = Array.isArray(x) ? x : [x];
  return list.filter(isEnabledWhenShaped).map((p) => ({
    ...p,
    reason: p.reason === void 0 ? p.reason : localeMapOf(p.reason)
  }));
}
function evaluateEnabledWhen(preds, doc) {
  for (const pred of normalizeEnabledWhen(preds)) {
    if (predicateHolds(pred, readPath(doc, pred.on), doc)) continue;
    return { enabled: false, reason: localeMapOf(pred.reason), failed: pred };
  }
  return { enabled: true };
}
function enabledWhenFindings(raw, at = "enabledWhen") {
  if (raw === void 0 || raw === null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  list.forEach((p, i) => {
    const where = Array.isArray(raw) ? `${at}[${i}]` : at;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      out.push(
        `${where}: an enabled-when is { on, equals | truthy, reason } \u2014 a predicate over the session's published values, such as { on: 'state.world.location', truthy: true, reason: { en: 'Set a location first' } }`
      );
      return;
    }
    const e = p;
    if (typeof e.on !== "string" || !e.on)
      out.push(
        `${where}: 'on' is required \u2014 a published-values path such as 'state.world.location' or 'session.generating' (never a port reference: actions live outside a run)`
      );
    else if (e.on.startsWith("$"))
      out.push(
        `${where}: 'on' is '${e.on}', which reads as a port reference \u2014 an enabled-when names a published-values path such as 'state.world.location'; actions live outside a run and have no ports to read`
      );
    else {
      const walked = e.on.split(".").find((seg) => FORBIDDEN_SEGMENTS.has(seg));
      if (walked)
        out.push(
          `${where}: 'on' walks '${walked}' \u2014 a published-values path names data ('state.world.location', 'item.hidden'), never a prototype`
        );
    }
    const stated = PREDICATE_CONDITION_KEYS.filter((k) => e[k] !== void 0);
    if (stated.length !== 1)
      out.push(
        `${where}: states ${stated.length || "no"} conditions \u2014 exactly one of ${PREDICATE_CONDITION_KEYS.join(" / ")} per predicate (the junction rule, 20 \xA710); a richer decision belongs in a value the pipeline publishes`
      );
    if (e.truthy !== void 0 && typeof e.truthy !== "boolean")
      out.push(`${where}: 'truthy' is a boolean \u2014 write truthy: true`);
    else if (e.truthy === false)
      out.push(
        `${where}: 'truthy: false' states nothing \u2014 write truthy: true to require a value, or equals: false to require a false one`
      );
    if (e.equals !== void 0 && !isPrimitive(e.equals))
      out.push(
        `${where}: 'equals' is a primitive \u2014 a string, number, boolean or null; a structured comparison belongs in a value the pipeline publishes as one`
      );
    if (e.equalsPath !== void 0) {
      if (typeof e.equalsPath !== "string" || !e.equalsPath)
        out.push(
          `${where}: 'equalsPath' is a path, not a value \u2014 the OTHER side of the comparison, read from the same document as 'on' (e.g. 'state.world.culprit'); to compare against a literal, write equals:`
        );
      else if (e.equalsPath.startsWith("$"))
        out.push(
          `${where}: 'equalsPath' is '${e.equalsPath}', which reads as a port reference \u2014 it names a published-values path exactly as 'on' does; actions live outside a run and have no ports to read`
        );
      else {
        const walkedOther = e.equalsPath.split(".").find((seg) => FORBIDDEN_SEGMENTS.has(seg));
        if (walkedOther)
          out.push(
            `${where}: 'equalsPath' walks '${walkedOther}' \u2014 a published-values path names data ('state.world.location', 'item.hidden'), never a prototype`
          );
      }
    }
    if (e.reason === void 0)
      out.push(
        `${where}: 'reason' is required \u2014 why the control is grey when the predicate does not hold, a locale map with 'en' (R-20)`
      );
    else out.push(...i18nFindings(e.reason, `${where}.reason`));
    for (const k of Object.keys(e))
      if (!ENABLED_WHEN_KEYS.includes(k))
        out.push(
          `${where}: '${k}' is not part of an enabled-when \u2014 one of ${ENABLED_WHEN_KEYS.join(", ")}`
        );
  });
  return out;
}

// ../serene-pub-sdk/sdk/src/participants.ts
var PARTICIPANT_ROLES = ["owner", "admin", "participant", "person", "ai", "item", "run-owner"];
function audienceHolds(refs, portrayals, viewer, item) {
  for (const ref of refs) {
    if (ref === "item") {
      if (item === void 0 || item) return true;
      continue;
    }
    const p = portrayals[ref];
    if (p?.by === "person" && p.userId === String(viewer.userId)) return true;
  }
  return false;
}
function dataAudienceFindings(raw) {
  if (raw === void 0) return void 0;
  if (!Array.isArray(raw)) return "an audience is a list of participant references";
  for (const ref of raw) {
    try {
      parseParticipantRef(ref);
    } catch (e) {
      return e.message;
    }
    if (ref === "item" || ref === "run-owner")
      return `'${ref}' is not an audience for a stored value \u2014 it names a message or a run, and the value outlives both`;
  }
  return void 0;
}
var ID = /^[^\s:]+$/;
var SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
var roles = new Set(PARTICIPANT_ROLES);
function parseParticipantRef(raw) {
  if (typeof raw !== "string")
    throw new Error(
      `a participant reference is a string \u2014 got ${raw === null ? "null" : typeof raw}`
    );
  const text = raw.trim();
  if (roles.has(text)) return { kind: text };
  const cut = text.indexOf(":");
  if (cut === -1)
    throw new Error(
      `'${raw}' is not a participant reference \u2014 expected one of ${PARTICIPANT_ROLES.join(", ")}, or user:<id>, character:<id>, envoy:<slug>`
    );
  const kind = text.slice(0, cut);
  const rest = text.slice(cut + 1);
  switch (kind) {
    case "user":
    case "character":
      if (!ID.test(rest))
        throw new Error(
          `'${raw}' names a ${kind} with no readable id \u2014 a ${kind} reference is '${kind}:<id>'`
        );
      return { kind, id: rest };
    case "envoy":
      if (!SLUG.test(rest))
        throw new Error(
          `'${raw}' names an envoy with no readable slug \u2014 an envoy reference is 'envoy:<slug>', the slug a letter or digit followed by letters, digits, '.', '_' or '-'`
        );
      return { kind, slug: rest };
    default:
      throw new Error(
        `'${raw}' is not a participant reference \u2014 '${kind}:' is not a kind (user, character, envoy)`
      );
  }
}
function isParticipantRef(raw) {
  try {
    parseParticipantRef(raw);
    return true;
  } catch {
    return false;
  }
}

// ../serene-pub-sdk/sdk/src/pluginRuleRef.ts
var PLUGIN_PERMISSIONS_GUIDE = "guides/plugin-permissions.md";
var pluginRuleRef = (anchor) => ` (see ${PLUGIN_PERMISSIONS_GUIDE}#${anchor})`;

// ../serene-pub-sdk/sdk/src/settings.ts
var isSecret = (v2) => !!v2 && typeof v2 === "object" && v2.$secret === true;
function settingsSchemaFindings(schema, where) {
  if (schema === void 0) return [];
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    return [`${where}: a settings schema is an object keyed by field name \u2014 { depth: { type: 'integer', label: 'Depth' } }`];
  const out = [];
  for (const [key, raw] of Object.entries(schema)) {
    const at = `${where}.${key}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      out.push(`${at}: a field declaration is an object \u2014 { type: 'string', label: 'Name' }`);
      continue;
    }
    const f = raw;
    out.push(...i18nFindings(f.label, `${at}.label`));
    out.push(...i18nFindings(f.description, `${at}.description`));
    if (f.members !== void 0) {
      if (!Array.isArray(f.members))
        out.push(`${at}.members: the bands are an array \u2014 [{ key: 'lore', label: 'Lore' }]`);
      else
        f.members.forEach((m, i) => {
          const band = `${at}.members[${typeof m?.key === "string" ? m.key : i}]`;
          if (!m || typeof m !== "object") {
            out.push(`${band}: a band is an object \u2014 { key: 'lore', label: 'Lore' }`);
            return;
          }
          out.push(...i18nFindings(m.label, `${band}.label`));
          out.push(...i18nFindings(m.description, `${band}.description`));
        });
    }
    if (f.item !== void 0) out.push(...settingsSchemaFindings({ item: f.item }, at));
    if (f.fields !== void 0) out.push(...settingsSchemaFindings(f.fields, `${at}.fields`));
  }
  return out;
}
function checkNested(decl2, path) {
  const f = [];
  if (decl2.type === "secret")
    f.push({
      field: path,
      severity: "error",
      message: `'${path}' is a secret nested inside a list or object`,
      fix: "declare it as a top-level field \u2014 redaction, export and receipts read the schema flat, so a nested secret would leak"
    });
  if (decl2.type === "list") {
    if (!decl2.item)
      f.push({
        field: path,
        severity: "error",
        message: `'${path}' is a list with no element declaration`,
        fix: "declare `item: { type: 'string' }` \u2014 a list whose elements are undeclared cannot be rendered or checked"
      });
    else f.push(...checkNested(decl2.item, `${path}[]`));
  }
  if (decl2.type === "object") {
    if (!decl2.fields || !Object.keys(decl2.fields).length)
      f.push({
        field: path,
        severity: "error",
        message: `'${path}' is an object with no member declarations`,
        fix: 'declare `fields: { \u2026 }` \u2014 a free-form map is `text` with `format: "json"`'
      });
    else
      for (const [k, member] of Object.entries(decl2.fields))
        f.push(...checkNested(member, `${path}.${k}`));
  }
  if (decl2.type === "enum" && !decl2.of?.length && !decl2.members?.length && !decl2.from)
    f.push({
      field: path,
      severity: "error",
      message: `'${path}' is an enum with no options`,
      fix: "declare `of: ['a','b'] as const`, or source them from the connection with `from`"
    });
  return f;
}
function checkSchema(schema) {
  const f = [];
  for (const [key, d] of Object.entries(schema)) {
    if (d.type === "list" || d.type === "object") f.push(...checkNested(d, key));
    if (d.lend !== void 0 && d.type !== "secret")
      f.push({
        field: key,
        severity: "error",
        message: `'${key}' says 'lend', which only a secret has`,
        fix: "remove 'lend' \u2014 only a secret is withheld from other packages' pipelines, so only a secret can be lent" + pluginRuleRef("secrets")
      });
    if (d.type === "secret") {
      if (!SECRET_KEY.test(key))
        f.push({
          field: key,
          severity: "error",
          message: `'${key}' is a secret whose name a handle cannot carry`,
          fix: 'name it with letters, digits, "_", "." and "-" only'
        });
      if (d.side === "component") {
        f.push({
          field: key,
          severity: "error",
          message: `'${key}' is a secret declared component-side`,
          fix: "a component runs in the browser, so the value would be delivered to the client \u2014 declare it extension-side"
        });
      }
      if (d.default !== void 0) {
        f.push({
          field: key,
          severity: "error",
          message: `'${key}' is a secret with a default`,
          fix: "remove it \u2014 a shipped default credential is not a credential"
        });
      }
    }
    if (d.type === "enum" && !d.of?.length && !d.from) {
      f.push({
        field: key,
        severity: "error",
        message: `'${key}' is an enum with no options`,
        fix: "declare `of: ['a','b'] as const`, or source them from the connection with `from`"
      });
    }
    if (d.required && d.default !== void 0) {
      f.push({
        field: key,
        severity: "warning",
        message: `'${key}' is required and has a default, so it can never be unset`,
        fix: "drop `required`, or drop the default if the admin genuinely has to choose"
      });
    }
    if (d.showIf && !schema[d.showIf.field]) {
      f.push({
        field: key,
        severity: "error",
        message: `'${key}' is shown conditionally on '${d.showIf.field}', which is not a field`,
        fix: `name a field this schema declares (${Object.keys(schema).join(", ")})`
      });
    }
  }
  return f;
}
function checkOne(decl2, value, path) {
  const f = [];
  const bad = (why, fix) => f.push({ field: path, severity: "error", message: `'${path}' ${why}`, fix });
  switch (decl2.type) {
    case "secret":
      if (!isSecret(value)) bad("is not a secret value", "write it through the settings form; secrets are never set as plain strings");
      break;
    case "boolean":
      if (typeof value !== "boolean") bad(`should be a boolean, got ${typeof value}`, "store true or false");
      break;
    case "integer":
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        bad(`should be a number, got ${typeof value}`, "store a number");
        break;
      }
      if (decl2.type === "integer" && !Number.isInteger(value)) bad("should be a whole number", "round it, or declare the field as `number`");
      if (decl2.min !== void 0 && value < decl2.min) bad(`is below the minimum ${decl2.min}`, `use a value \u2265 ${decl2.min}`);
      if (decl2.max !== void 0 && value > decl2.max) bad(`is above the maximum ${decl2.max}`, `use a value \u2264 ${decl2.max}`);
      break;
    }
    case "enum":
      if (decl2.of && !decl2.of.includes(value)) bad(`is not one of ${decl2.of.join(", ")}`, `use one of: ${decl2.of.join(", ")}`);
      break;
    case "string[]":
      if (!Array.isArray(value)) bad("should be a list of strings", "store an array");
      break;
    case "list": {
      if (!Array.isArray(value)) {
        bad("should be a list", "store an array \u2014 the order is part of the value");
        break;
      }
      if (decl2.min !== void 0 && value.length < decl2.min) bad(`has fewer than ${decl2.min} entries`, `keep at least ${decl2.min}`);
      if (decl2.max !== void 0 && value.length > decl2.max) bad(`has more than ${decl2.max} entries`, `keep at most ${decl2.max}`);
      if (decl2.item) for (let i = 0; i < value.length; i++) f.push(...checkOne(decl2.item, value[i], `${path}[${i}]`));
      break;
    }
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        bad("should be an object", "store a record of the declared members");
        break;
      }
      const row = value;
      for (const [k, member] of Object.entries(decl2.fields ?? {})) {
        const mv = row[k];
        if (mv === void 0 || mv === null) {
          if (member.required && member.default === void 0)
            f.push({
              field: `${path}.${k}`,
              severity: "error",
              message: `'${path}.${k}' is required and not set`,
              fix: "fill it in \u2014 the row is incomplete without it"
            });
          continue;
        }
        f.push(...checkOne(member, mv, `${path}.${k}`));
      }
      break;
    }
    default:
      if (typeof value !== "string") bad(`should be a string, got ${typeof value}`, "store a string");
  }
  return f;
}
function checkValues(schema, values) {
  const f = [];
  for (const [key, d] of Object.entries(schema)) {
    const v2 = values[key];
    if (v2 === void 0 || v2 === null) {
      if (d.required && d.default === void 0) {
        f.push({
          field: key,
          severity: "error",
          message: `'${key}' is required and not set`,
          fix: `set it in plugin settings \u2014 the plugin stays installed and listed until then, it is not broken`
        });
      }
      continue;
    }
    f.push(...checkOne(d, v2, key));
  }
  return f;
}
var SECRET_KEY = /^[A-Za-z0-9_.-]+$/;

// ../serene-pub-sdk/sdk/src/settingsSlot.ts
var SETTINGS_SLOT = "settings";
var ENABLED_FIELD = Object.freeze({
  type: "boolean",
  default: true,
  quick: true,
  label: { en: "Use this source" },
  description: {
    en: "Off skips the step entirely rather than fetching and discarding it \u2014 cheaper than starving it with a zero share."
  }
});
var ENABLED_STEP_FIELD = Object.freeze({
  type: "boolean",
  default: true,
  quick: true,
  label: { en: "Run this step" },
  description: {
    en: "Off skips the step entirely: nothing is called or charged, and the steps after it go on without what it would have made."
  }
});
function authoredSlots(slots) {
  if (!slots || !(SETTINGS_SLOT in slots)) return slots ?? {};
  const { [SETTINGS_SLOT]: _substrate, ...authored } = slots;
  return authored;
}

// ../serene-pub-sdk/sdk/src/verdicts.ts
var DOORS = [
  "construction",
  "registry",
  "validate",
  "publish",
  "run",
  "fire",
  "write",
  "list"
];
var VERDICT_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*:verdict\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
var registry2 = /* @__PURE__ */ new Map();
var doorSet = new Set(DOORS);
function defineVerdict(decl2) {
  if (typeof decl2.id !== "string" || !VERDICT_ID.test(decl2.id))
    throw new Error(
      `'${String(decl2.id)}' is not a verdict id \u2014 one is '<owner>:verdict/<slug>', the slug lowercase letters, digits and hyphens: core:verdict/effects-line`
    );
  if (typeof decl2.law !== "string" || !decl2.law.trim())
    throw new Error(
      `${decl2.id} names no law \u2014 'law' is the label a Finding carries for this rule ('F39', 'R-20')`
    );
  if (!Array.isArray(decl2.doors) || decl2.doors.length === 0)
    throw new Error(
      `${decl2.id} declares no door \u2014 list every place the rule is heard, one of ${DOORS.join(", ")}`
    );
  const unknown = decl2.doors.find((d) => !doorSet.has(d));
  if (unknown !== void 0)
    throw new Error(
      `${decl2.id} declares the door '${String(unknown)}', which is not one \u2014 a door is one of ${DOORS.join(", ")}`
    );
  if (typeof decl2.judge !== "function" || typeof decl2.failing !== "function")
    throw new Error(`${decl2.id} declares no judge or no failing input \u2014 a verdict is { id, law, doors, judge, failing }`);
  const existing = registry2.get(decl2.id);
  if (existing) refuseUnlessIdentical(existing, decl2, `duplicate verdict id: ${decl2.id}`);
  const verdict = Object.freeze({ ...decl2, doors: Object.freeze([...decl2.doors]) });
  registry2.set(decl2.id, verdict);
  return verdict;
}
function refusalText(r) {
  const sentence = i18nText(r.sentence) ?? "";
  return r.fix === void 0 ? sentence : `${sentence} \u2014 ${i18nText(r.fix) ?? ""}`;
}
var i18nVerdict = defineVerdict({
  id: "core:verdict/i18n",
  law: "R-20",
  doors: ["construction", "registry", "validate", "publish", "run"],
  judge({ value, where, required }) {
    const [sentence] = i18nFindings(value, where, { required });
    return sentence === void 0 ? { ok: true } : { ok: false, sentence };
  },
  // The field each door is asked about — the sentence names it, so the
  // door's own address has to be the one the kit expects to hear back: a
  // definition's name at the registry, a preset's label where a document
  // is built, validated or published, a status's text at the run.
  failing: (door) => ({
    value: { fr: "Titre" },
    where: door === "registry" ? "i18n.name" : door === "run" ? "status.i18n" : "presets[lore].label",
    required: true
  })
});
var enablementVerdict = defineVerdict({
  id: "core:verdict/enablement",
  law: "U5e",
  doors: ["list", "fire"],
  judge({ preds, doc }) {
    const heard = evaluateEnabledWhen(preds, doc);
    return heard.enabled ? { ok: true } : { ok: false, sentence: heard.reason };
  },
  failing: () => ({
    preds: [
      {
        on: "state.world.conformance",
        truthy: true,
        reason: { en: "conformance: the enabled-when predicate refused this press" }
      }
    ],
    doc: { state: { world: { conformance: false } } }
  })
});
var audienceVerdict = defineVerdict({
  id: "core:verdict/audience",
  law: "R-15",
  doors: ["list", "fire"],
  judge({ name, refs, portrayals, viewer, item }) {
    if (audienceHolds(refs, portrayals, viewer, item)) return { ok: true };
    return {
      ok: false,
      sentence: `'${name}' is not yours to use here \u2014 its audience is ${refs.length ? refs.join(", ") : "nobody"}.`
    };
  },
  failing: () => ({
    name: "grant",
    refs: ["owner"],
    portrayals: { owner: { by: "person", userId: "1" } },
    viewer: { userId: 2 }
  })
});
var isSettingsAddress = (name) => typeof name === "string" && (name === SETTINGS_SLOT || name.startsWith(`${SETTINGS_SLOT}.`));
var settingsTravelVerdict = defineVerdict({
  id: "core:verdict/settings-travel",
  law: "F39",
  doors: ["registry", "validate", "run"],
  judge(input) {
    switch (input.kind) {
      case "edge": {
        if (!isSettingsAddress(input.fromPort)) return { ok: true };
        const { from, fromPort, to, toPort } = input;
        return {
          ok: false,
          sentence: `'${to}.${toPort}' reads '${from}.${fromPort}' \u2014 a setting, not a port; settings never travel, only data does`,
          fix: `wire a port '${from}' publishes (what it DID with the setting), or declare the value '${to}' needs on its own params and share the owner's with slot.params({ node: '${from}' }) \u2014 the substrate's switches (enabled, review, mode) are read at their owner by the executor and are never a value`
        };
      }
      case "reference": {
        if (!isSettingsAddress(input.slot)) return { ok: true };
        const { node, key, target } = input;
        return {
          ok: false,
          sentence: `'${node}.${key}' references '${target}.${SETTINGS_SLOT}' \u2014 the substrate's switches, read at their owner by the executor and never a value; settings never travel, only data does`,
          fix: `read a port '${target}' publishes, or declare the value '${node}' needs on its own params and share the owner's with slot.params({ node: '${target}' }) \u2014 a switch (enabled, review, mode) belongs to no reference`
        };
      }
      case "port": {
        if (!isSettingsAddress(input.port)) return { ok: true };
        const { definitionId, port } = input;
        return {
          ok: false,
          sentence: `${definitionId} declares an out-port named '${port}'. '<node>.${SETTINGS_SLOT}' (and paths under it) is the address of the substrate's own switches \u2014 \`enabled\`, \`review\`, \`mode\` \u2014 which the executor reads at the node and hands to nobody (F39: settings never travel), so an edge from a port of that name would be refused as a setting`,
          fix: `name the port for what it publishes ('result', 'applied', 'chosen')`
        };
      }
      default:
        return {
          ok: false,
          sentence: `'${String(input.kind)}' is not a shape this verdict judges \u2014 one of 'edge', 'reference', 'port'.`
        };
    }
  },
  failing: (door) => door === "registry" ? { kind: "port", definitionId: "conformance:task/claims-settings-port@1", port: "settings.review" } : door === "run" ? { kind: "reference", node: "probe", key: "main", slot: SETTINGS_SLOT, target: "save" } : { kind: "edge", from: "save", fromPort: `${SETTINGS_SLOT}.review`, to: "probe", toPort: "main" }
});
var provisionalVerdict = defineVerdict({
  id: "core:verdict/provisional",
  law: "R-2",
  doors: ["validate", "run", "registry"],
  judge(input) {
    switch (input.kind) {
      case "placement": {
        if (!input.provisional) return { ok: true };
        const { nodeKey, definitionId, definitionVersion } = input;
        return {
          ok: false,
          sentence: `'${nodeKey}' places ${definitionId}@${definitionVersion}, which is provisional \u2014 declared, not bound: no handler runs it in this release (R-2)`,
          fix: "bind it or remove the node"
        };
      }
      case "publication": {
        if (input.provisional || input.bound) return { ok: true };
        return {
          ok: false,
          sentence: `${input.definitionId} is published with no handler behind it and no plan claiming it \u2014 declared, not bound (R-2)`,
          fix: "bind it in bindings.ts, mark it `provisional: true` under the plan that owns it, or cull it"
        };
      }
      default:
        return {
          ok: false,
          sentence: `'${String(input.kind)}' is not a shape this verdict judges \u2014 one of 'placement', 'publication'.`
        };
    }
  },
  failing: (door) => door === "registry" ? { kind: "publication", definitionId: "core:task/stray-unbound@1", provisional: false, bound: false } : {
    kind: "placement",
    nodeKey: "pending",
    definitionId: "conformance:oracle/pending",
    definitionVersion: 1,
    provisional: true
  }
});

// ../serene-pub-sdk/sdk/src/variables.ts
var variables = /* @__PURE__ */ new Map();
function defineVariable(decl2) {
  const existing = variables.get(decl2.id);
  if (existing) refuseUnlessIdentical(existing, decl2, `duplicate variable id: ${decl2.id}`);
  variables.set(decl2.id, decl2);
  return decl2;
}
var getVariable = (id) => variables.get(id);
var allVariables = () => [...variables.values()];
function pluginVariableFindings(slug, raw, at = "variables") {
  if (raw === void 0) return [];
  if (!Array.isArray(raw)) return [`'${at}' is not a list of variable declarations`];
  const out = [];
  const seen = /* @__PURE__ */ new Map();
  for (const [i, v2] of raw.entries()) {
    const d = v2;
    const id = typeof d?.id === "string" ? d.id : "";
    if (!id) {
      out.push(`${at}[${i}] has no id \u2014 a variable is '<slug>:var/<name>@<major>'`);
      continue;
    }
    const ns = id.includes(":") ? id.slice(0, id.indexOf(":")) : "";
    if (ns === "core")
      out.push(
        `variable '${id}': the 'core:' namespace is reserved. Declare it as '${slug}:${id.slice(id.indexOf(":") + 1)}'.`
      );
    else if (ns !== slug)
      out.push(
        `variable '${id}' is not in this package's namespace \u2014 declare it under '${slug}:var/\u2026'. A variable two packages can define renders differently by install order.`
      );
    if (!d?.scope || typeof d.scope !== "object" || Array.isArray(d.scope))
      out.push(`variable '${id}' has no scope \u2014 what a template rendering it can name`);
    const sig = JSON.stringify(d);
    const prior = seen.get(id);
    if (prior !== void 0 && prior !== sig)
      out.push(`variable '${id}' is declared twice with different content \u2014 an id means one thing`);
    seen.set(id, sig);
  }
  return out;
}
var CHARACTER_CARD = {
  type: "object",
  fields: {
    name: { type: "string", description: { en: "What the character is called in the prompt." } },
    nickname: {
      type: "string",
      optional: true,
      description: { en: "Their short name, when they have one." }
    },
    description: {
      type: "string",
      optional: true,
      description: { en: "Who they are." }
    },
    personality: {
      type: "string",
      optional: true,
      description: { en: "How they behave. Absent for a non-speaker when the session shows brief character detail." }
    }
  }
};
var ash = {
  name: "Ash",
  nickname: "Ash",
  description: "A rider who patrols the ash wastes.",
  personality: "Terse, loyal, slow to trust."
};
var brannoc = {
  name: "Brannoc",
  description: "A caravan master who has crossed the wastes eleven times.",
  personality: "Genial, and counting."
};
var varInstructions = defineVariable({
  id: "core:var/instructions@1",
  i18n: { name: { en: "Instructions" } },
  description: {
    en: "The system instructions for the reply, after macros are substituted."
  },
  scope: { instructions: { type: "string" } },
  // Already interpolated, because that is how it arrives: macros expand
  // upstream, and a sample still carrying `{{char}}` would read as a preview
  // showing that macros do not work.
  sample: "You are Ash. Stay in character and never speak for Rell."
});
var varCharacters = defineVariable({
  id: "core:var/characters@1",
  i18n: { name: { en: "Characters" } },
  description: {
    en: "Everyone in the scene except the user, with their descriptions."
  },
  scope: { characters: { type: "list", of: CHARACTER_CARD } },
  sample: [ash, brannoc]
});
var varPersonas = defineVariable({
  id: "core:var/personas@1",
  i18n: { name: { en: "Personas" } },
  // Two fields. A persona's private lore is Assemble's `characterLore`, like
  // every cast member's, never a field of this card.
  //
  // `description` is optional for a different reason than a character's is:
  // personas are built by hand in `resolveContextInput` and never go through
  // `compileCharacter`, so nothing strips a null. The key is always present
  // and its value can be null, which a template cannot tell from absent.
  description: { en: "Who the user is playing, as the prompt sees them." },
  scope: {
    personas: {
      type: "list",
      of: {
        type: "object",
        fields: {
          name: { type: "string" },
          description: { type: "string", optional: true }
        }
      }
    }
  },
  sample: [{ name: "Rell", description: "A cartographer looking for a way north." }]
});
var varScenario = defineVariable({
  id: "core:var/scenario@1",
  i18n: { name: { en: "Scenario" } },
  description: { en: "The situation the scene opens in." },
  scope: { scenario: { type: "string" } },
  sample: "The caravan has stopped at the edge of the wastes."
});
var varExampleDialogue = defineVariable({
  id: "core:var/example-dialogue@1",
  i18n: { name: { en: "Example dialogue" } },
  description: { en: "Sample exchanges that show the model how the characters speak." },
  scope: { exampleDialogue: { type: "string" } },
  // Interpolated, like `instructions` — the speaker's name is already
  // substituted by the time a layout sees this.
  sample: 'Ash: "Ash in the water again."'
});
var varPostHistoryInstructions = defineVariable({
  id: "core:var/post-history-instructions@1",
  i18n: { name: { en: "Post-history instructions" } },
  description: {
    en: "The reminder placed next to the generation point, after the conversation."
  },
  scope: { postHistoryInstructions: { type: "string" } },
  sample: "Stay in character and write one paragraph."
});
var varCharacterNames = defineVariable({
  id: "core:var/character-names@1",
  i18n: { name: { en: "Character names" } },
  description: { en: "Just the names of the characters in the scene." },
  // A **string**, not a list. `joinWithAnd` runs upstream, so what a layout
  // receives is already "Ash and Brannoc" — and declaring it as a list would
  // be the same class of lie the hand-written preview data used to tell about
  // `worldLore`: a template written against it looks right in the editor and
  // renders wrong in a chat. Saying `type: 'string'` is the first time the
  // declaration has been able to state this rather than leave it to a comment.
  scope: { characterNames: { type: "string" } },
  sample: "Ash and Brannoc"
});
var varPersonaNames = defineVariable({
  id: "core:var/persona-names@1",
  i18n: { name: { en: "Persona names" } },
  description: { en: "Just the names of the user's personas in the scene." },
  scope: { personaNames: { type: "string" } },
  sample: "Rell"
});
var varWorldLore = defineVariable({
  id: "core:var/world-lore@1",
  i18n: { name: { en: "World lore" } },
  description: {
    en: "Lorebook entries about the world that fit the budget, keyed by entry name."
  },
  // `'any'` could not say this, and the shape it could not say is exactly the
  // one a hand-written preview got wrong once already.
  scope: { worldLore: { type: "record", of: { type: "string" } } },
  sample: {
    "The Ashguard": "Riders who patrol the ash wastes.",
    "The Long Winter": "Nine years without a thaw."
  }
});
var varHistory = defineVariable({
  id: "core:var/history@1",
  // "Story history" until 0.6. It is a *list of dated history entries*, and
  // calling it a story invited people to look for the story — the summary of
  // the chat so far, which is a different feature that does not exist here.
  i18n: { name: { en: "History entries" } },
  description: {
    en: "Earlier events from the chat that fit the budget, newest first, keyed by date."
  },
  scope: { history: { type: "record", of: { type: "string" } } },
  sample: {
    "Year 412, Month 3": "The caravan reached the wastes.",
    "Year 412, Month 1": "Ash left the Ashguard."
  }
});
var varDocsExcerpts = defineVariable({
  id: "core:var/docs-excerpts@1",
  i18n: { name: { en: "Documentation excerpts" } },
  description: {
    en: "Documentation sections that match the latest question and fit the budget, keyed by page and section; each starts with the page path."
  },
  scope: { docsExcerpts: { type: "record", of: { type: "string" } } },
  sample: {
    "Connections \u203A Adding and removing by hand": "Path: /docs/connections#adding-and-removing-by-hand\nOpen Connections and choose Add\u2026"
  }
});
var varRecalledLines = defineVariable({
  id: "core:var/recalled-lines@1",
  i18n: { name: { en: "Recalled lines" } },
  description: {
    en: "Earlier lines of the conversation that name what the scene is naming now and fit the budget, oldest first \u2014 each with its speaker, turn and text."
  },
  scope: {
    recalledLines: {
      type: "list",
      of: {
        type: "object",
        fields: {
          speaker: { type: "string", description: { en: "Who said it." } },
          turn: {
            type: "number",
            description: {
              en: "The line's position in its channel's conversation, counting from 1."
            }
          },
          text: { type: "string", description: { en: "What was said." } }
        }
      }
    }
  },
  sample: [
    { speaker: "Mira", turn: 12, text: "I hid the brass key under the chapel floor." },
    { speaker: "Ada", turn: 31, text: "The chapel? Mira, the chapel burned." }
  ]
});
var CHARACTER_LORE_ENTRY = {
  type: "object",
  fields: {
    title: { type: "string", description: { en: "The entry\u2019s title." } },
    castMember: {
      type: "string",
      optional: true,
      description: { en: "Whose lore it is. Absent when the entry is bound to nobody." }
    },
    content: { type: "string", description: { en: "What the entry says." } }
  }
};
var varCharacterLore = defineVariable({
  id: "core:var/character-lore@1",
  i18n: { name: { en: "Character lore" } },
  description: {
    en: "Lore bound to a cast member that fit the budget: each entry\u2019s title, whose it is, and its text."
  },
  scope: { characterLore: { type: "list", of: CHARACTER_LORE_ENTRY } },
  sample: [
    { title: "The Ashguard brand", castMember: "Ash", content: "Carries a brand from the Ashguard." }
  ]
});
var RELATIONSHIP = {
  type: "object",
  fields: {
    type: { type: "string", description: { en: "What the relationship is." } },
    secrecy: {
      type: "string",
      description: { en: 'Who knows about it \u2014 "Only I know", "We both know", and so on.' }
    },
    status: {
      type: "string",
      optional: true,
      description: { en: "Only present when it is something other than active." }
    },
    theirState: {
      type: "string",
      optional: true,
      description: { en: "The other party's node state, when it is not active." }
    },
    note: { type: "string", optional: true, description: { en: "The written detail." } }
  }
};
var BY_OTHER = { type: "record", of: { type: "list", of: RELATIONSHIP } };
var varRelationshipsPerspectives = defineVariable({
  id: "core:var/relationships-perspectives@1",
  i18n: { name: { en: "Relationships: their perspective" } },
  description: {
    en: "How the speaking character regards each of the others, from the narrative graph."
  },
  scope: {
    relationshipsPerspectives: {
      ...BY_OTHER,
      description: { en: "How the speaker regards each other character." }
    }
  },
  sample: {
    Brannoc: [
      {
        type: "wary respect",
        secrecy: "Only I know",
        note: "Ash has never forgotten who opened the lower gate."
      }
    ]
  }
});
var varRelationshipsKnown = defineVariable({
  id: "core:var/relationships-known@1",
  i18n: { name: { en: "Relationships: how others see them" } },
  description: {
    en: "How the others regard the speaking character, plus any figures the world knows of."
  },
  scope: {
    relationshipsKnown: {
      type: "object",
      fields: {
        howOthersRegardYou: {
          ...BY_OTHER,
          optional: true,
          description: { en: "How each other character regards the speaker." }
        },
        legendaryFigures: {
          type: "record",
          optional: true,
          description: { en: "Figures the world knows of, and their public relationships." },
          of: {
            type: "object",
            fields: {
              summary: { type: "string", optional: true },
              state: { type: "string", optional: true },
              relationships: { ...BY_OTHER, optional: true }
            }
          }
        }
      }
    }
  },
  sample: {
    howOthersRegardYou: {
      Rell: [
        {
          type: "debt",
          secrecy: "We both know",
          status: "evolved",
          note: "Rell owes Ash for the crossing."
        }
      ]
    }
  }
});
var varCurrentDate = defineVariable({
  id: "core:var/current-date@1",
  i18n: { name: { en: "Current date" } },
  description: {
    en: "The story's present date: the lorebook's clock when it is set, else the most recent history entry."
  },
  /**
   * ⚠ Was `{ currentDate: { type: 'string' } }` with the sample
   * `'Year 412, Month 3'`, and the sample was **wrong** — the value arrived
   * pre-formatted by `formatDate` as `412-03`, so the preview showed a
   * rendering the prompt never contained. That is the failure mode a sample
   * exists to prevent, and it happened because the shape was a finished
   * string: nothing could disagree with the formatting, so nothing did.
   *
   * The parts travel separately now and the layout joins them, which is what
   * makes "state the date differently" a setting rather than a code change.
   * `month` and `day` are absent rather than null when the entry has no such
   * precision — `{{#if (isSet …)}}` is what a layout tests.
   */
  scope: {
    currentDate: {
      type: "object",
      fields: {
        year: { type: "number", description: { en: "The story year." } },
        month: {
          type: "number",
          optional: true,
          description: { en: "Absent when the entry is only dated to a year." }
        },
        day: {
          type: "number",
          optional: true,
          description: { en: "Absent when the entry is only dated to a month." }
        },
        hour: {
          type: "number",
          optional: true,
          description: { en: "The clock's hour (0\u201323), when the present has a time of day." }
        },
        minute: {
          type: "number",
          optional: true,
          description: { en: "The clock's minute, when the present has a time of day." }
        },
        label: {
          type: "string",
          optional: true,
          description: {
            en: "The date spelled through the lorebook's calendar; absent when the book is free-form."
          }
        }
      }
    }
  },
  sample: { year: 412, month: 3, day: 5 }
});

// ../serene-pub-sdk/sdk/src/bands.ts
var IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
var isBandKey = (key) => IDENTIFIER.test(key);
function bandKeySuggestion(key) {
  const camel = key.replace(/[^A-Za-z0-9_]+(.)?/g, (_, c) => c ? c.toUpperCase() : "").replace(/^[^A-Za-z_]+/, "");
  return camel || "band";
}
var ASSEMBLE_OWN_TEMPLATE_NAMES = [
  "sessionMessages",
  "injectionsByIndex",
  "budget",
  "postHistory",
  "blocks",
  "prompts"
];
var variableIdOf = (v2) => typeof v2 === "string" ? v2 : v2?.id;
var otherVariableRendering = (key, id) => allVariables().find(
  (v2) => v2.id !== id && v2.id.startsWith("core:") && Object.prototype.hasOwnProperty.call(v2.scope, key)
);
function checkBandDeclarations(d, others) {
  const bands = d.bands;
  for (const key of Object.keys(d.bandPorts ?? {}))
    if (!bands || !Object.prototype.hasOwnProperty.call(bands, key))
      throw new Error(
        `'${d.id}' names band '${key}' in bandPorts but does not declare it in bands. Declare it (bands: { ${key}: varMyBand }), or drop it from bandPorts.`
      );
  if (!bands) return;
  for (const [key, decl2] of Object.entries(bands)) {
    if (!isBandKey(key))
      throw new Error(
        `'${d.id}' declares band '${key}': a band key is a top-level template name, so it must be an identifier \u2014 letters, digits and '_', not starting with a digit. Rename it '${bandKeySuggestion(key)}', and emit that same key from bandIntent() and as each candidate's source.`
      );
    const id = variableIdOf(decl2);
    if (!id || !decl2 || typeof decl2 !== "object")
      throw new Error(
        `'${d.id}' declares band '${key}' without a variable. Declare one with definePluginVariable() (defineVariable() in core) whose scope names '${key}', and pass the declaration: bands: { ${key}: varMyBand }.`
      );
    const registered = getVariable(id);
    if (!registered)
      throw new Error(
        `'${d.id}' declares band '${key}' with variable '${id}', which is not registered. Declare it with definePluginVariable() (defineVariable() in core) before the definition that names it \u2014 the layout picker and the template editor read it from the registry.`
      );
    if (!Object.prototype.hasOwnProperty.call(registered.scope, key))
      throw new Error(
        `'${d.id}' declares band '${key}' with variable '${id}', whose scope does not declare '${key}' (it declares ${Object.keys(registered.scope).map((k) => `'${k}'`).join(", ") || "nothing"}). A layout renders the band as {{{${key}}}}, so add '${key}' to the variable's scope \u2014 or rename the band to the key the variable declares.`
      );
    if (ASSEMBLE_OWN_TEMPLATE_NAMES.includes(key))
      throw new Error(
        `'${d.id}' declares band '${key}', which collides with Assemble's own '${key}' \u2014 a template reading {{{${key}}}} would get one or the other depending on order. Rename the band.`
      );
    const core = otherVariableRendering(key, id);
    if (core)
      throw new Error(
        `'${d.id}' declares band '${key}' as '${id}', which collides with '${core.id}' \u2014 that variable already renders the top-level name '${key}'. A band key means one thing; rename the band.`
      );
    const ports = d.bandPorts?.[key];
    if (ports !== void 0) {
      const out = Object.keys(d.ports?.out ?? {});
      const unknown = ports.filter((p) => !out.includes(p));
      if (!ports.length || unknown.length)
        throw new Error(
          `'${d.id}' says band '${key}' is carried on ` + (ports.length ? `${unknown.map((p) => `'${p}'`).join(", ")}, which ${unknown.length === 1 ? "is not an out-port" : "are not out-ports"} it declares` : "no out-port at all") + ` (it declares ${out.map((p) => `'${p}'`).join(", ") || "none"}). Name the out-ports that publish the band's candidates in bandPorts, or leave '${key}' out of bandPorts if every out-port may carry it.`
        );
    }
    for (const other of others) {
      if (other.id === d.id) continue;
      const theirs = variableIdOf(other.bands?.[key]);
      if (theirs && theirs !== id)
        throw new Error(
          `'${d.id}' declares band '${key}' as '${id}', but '${other.id}' already declares '${key}' as '${theirs}'. A band key is a top-level template name and means one thing \u2014 rename one of the two bands.`
        );
    }
  }
}

// ../serene-pub-sdk/sdk/src/events.ts
var bySlug = /* @__PURE__ */ new Map();
var nextId = 1;
function defineEvent(def) {
  const existing = bySlug.get(def.slug);
  const e = { ...def, id: existing?.id ?? nextId, ownerPluginId: null };
  if (existing)
    refuseUnlessIdentical(
      existing,
      e,
      `duplicate event slug '${def.slug}' \u2014 slugs are unique because they are the reference used to sync seeded rows across pubs (13 \xA77g)`
    );
  if (def.family === "action" && def.causedBy?.length) {
    throw new Error(
      `action event '${def.slug}' declares causedBy. Action events are requests, not consequences of a write \u2014 that is what keeps them out of the cycle graph (13 \xA77)`
    );
  }
  if (def.declaredRoot && def.causedBy?.length) {
    throw new Error(
      `event '${def.slug}' is a declared root and declares causedBy \u2014 a root starts outside every pipeline, so nothing writes it. Drop one of the two`
    );
  }
  if (!existing) nextId++;
  bySlug.set(def.slug, e);
  return e;
}
function eventById(id) {
  const m = /^core:event\/([a-z0-9]+(?:-[a-z0-9]+)*)@(\d+)$/.exec(id);
  if (!m) return packageEventViews.get(id);
  const e = bySlug.get(m[1]);
  return e && String(e.version) === m[2] ? e : void 0;
}
var notADeclaredEvent = (id) => `'${id}' is not a declared event \u2014 core defines its own, and a package declares one with defineSessionEvent({ id, payload, \u2026 }) and names it in defineExtension({ events }).`;
var EVENT_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*:event\/[a-z0-9]+(?:-[a-z0-9]+)*@\d+$/;
var isEventId = (id) => EVENT_ID.test(id);
var packageEvents = /* @__PURE__ */ new Map();
var packageEventViews = /* @__PURE__ */ new Map();
var MAX_RECORDED_PAYLOAD_BYTES = 64 * 1024;
var packageEventById = (id) => packageEvents.get(id);
var isSessionEventDecl = (v2) => !!v2 && typeof v2 === "object" && v2.__decl === "session-event";
var CORE_EVENTS = {
  messageCreated: defineEvent({
    slug: "message-created",
    name: { en: "Message written" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/create-message", "core:outlet/seed-greetings"],
    description: "A message was written into a session."
  }),
  /**
   * A row was finished or rewritten by a pipeline's own write. A regenerate,
   * a swipe's fresh alternative and an extend are THIS event with `verb`
   * on the payload — `regenerate` · `swipe` · `extend` — rather than three
   * events of their own (R-15, 2026-09-16): each is the genre's pipeline
   * producing text plus core's rewrite of the row, and the rewrite is one
   * outlet. A plain reply's finishing write carries no `verb`.
   */
  messageUpdated: defineEvent({
    slug: "message-updated",
    name: { en: "Message changed" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/update-message", "core:outlet/attach-image", "core:outlet/attach-audio"],
    payload: S.sessionChange,
    description: "An existing message was changed."
  }),
  // ── The built-in writes (R-15, 2026-09-16) — DATA family, each caused ──
  // by the core outlet that performs it. Every one carries what changed
  // and what was lost, lands on the receipt as `emitted`, and is written to
  // the session's changes so the next reply's inlet publishes it.
  messageDeleted: defineEvent({
    slug: "message-deleted",
    name: { en: "Message deleted" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/delete-message"],
    payload: S.sessionChange,
    description: "A message was deleted. The payload carries what was lost \u2014 its content, role, speaker and metadata."
  }),
  messageHidden: defineEvent({
    slug: "message-hidden",
    name: { en: "Message hidden or shown" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/hide-message"],
    payload: S.sessionChange,
    description: "A message was hidden from the prompt, or shown again. The payload says which."
  }),
  messageEdited: defineEvent({
    slug: "message-edited",
    name: { en: "Message edited" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/edit-message"],
    payload: S.sessionChange,
    description: "A person rewrote a settled message. The payload carries the previous content."
  }),
  messageSwiped: defineEvent({
    slug: "message-swiped",
    name: { en: "Message swiped" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/swipe-message"],
    payload: S.sessionChange,
    description: "A different alternative of a message was selected, or a new one recorded. The payload carries the alternative that was showing and the index now selected."
  }),
  /**
   * A line's **shown sprite** changed (DESIGN-sprites §5.2): a sprite picker
   * chose one after a reply, or a person changed it from the message menu.
   * The payload names the line, the speaker, the `{ set, label }` now shown
   * (null for none) and `source` — `picker` or `person`. What TTS line
   * direction and any face-driven widget listen for.
   */
  spriteShown: defineEvent({
    slug: "sprite-shown",
    name: { en: "Sprite shown" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/show-sprite"],
    payload: S.sessionChange,
    description: "A line's sprite changed \u2014 chosen by a sprite picker after a reply, or by a person. The payload carries the set and label now shown and who chose it."
  }),
  /**
   * Stop is not a write outlet: it is the run-level guarantee (R-17) —
   * core finalises the row a cancelled run was filling — so it has no
   * `causedBy`. Emitted by the host from that finalisation, and from the
   * message's own Stop when it releases the row first.
   */
  messageStopped: defineEvent({
    slug: "message-stopped",
    name: { en: "Reply stopped" },
    version: 1,
    family: "data",
    affectsUser: true,
    payload: S.sessionChange,
    description: "A reply was stopped while it was being written. The payload carries how much text had arrived."
  }),
  sessionBranched: defineEvent({
    slug: "session-branched",
    name: { en: "Session branched" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/branch-session"],
    payload: S.sessionChange,
    description: "A session was branched at a message into a new session. The payload names the new session and the message it forked from."
  }),
  // ── Turn order as event-driven state (PLAN-turn-order §4.1, 2026-09-21) ──
  // The four events the turn-order spec answers or causes. Every session
  // event's payload carries a `cause` (`EventCause`): who or what fired
  // it, which is what the auto-advance listener keys on.
  /**
   * A row that is **not generating** landed: a user send, a seeded
   * greeting, a finalised reply, a stopped reply. Never for a placeholder
   * or a generating row — the reply's *completion* is the fact, not its
   * opening. Distinct from `message-created` (which fires at the write,
   * placeholder included) and `message-updated` (which also fires on an
   * attach): this is the one event that means "there is a new settled
   * turn to answer".
   */
  messageCompleted: defineEvent({
    slug: "message-completed",
    name: { en: "Message completed" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: [
      "core:outlet/create-message",
      "core:outlet/seed-greetings",
      "core:outlet/update-message"
    ],
    payload: S.sessionChange,
    description: "A message finished landing \u2014 a send, a seeded greeting, a finished or stopped reply. Never a placeholder or a row still being written."
  }),
  /**
   * A seated participant's row changed — switched on or off (`active`),
   * `position` or portrayal. Not add or remove: those stay
   * `member-added` / `member-removed`. No `causedBy`: the cast toggles are
   * socket writes, not an outlet's.
   */
  castChanged: defineEvent({
    slug: "cast-changed",
    declaredRoot: true,
    name: { en: "Cast changed" },
    version: 1,
    family: "data",
    affectsUser: true,
    payload: S.castChange,
    description: "A session character, persona or envoy row changed \u2014 switched on or off, position or portrayal. The payload names the participant and what moved."
  }),
  /**
   * The session row changed. Two origins: a person's settings write
   * (`sessions:update` and the other settings sockets — name, scenario,
   * lorebook, genre fields, preset, channels, tags; cause `settings`), and
   * `core:outlet/advance-story-clock`, which moves the session's story
   * clock (`changed: ['storyClock']`, cause `run`). The payload's `changed`
   * lists the fields by name. `causedBy` names the outlet, so the event map
   * draws the edge a spec bound here that advances the clock would loop
   * on; it is therefore not a declared root, though a person's write also
   * starts it (as the auto-advance listener also causes `message-respond`).
   * ⚠ Never emitted by `writeTurnOrder`, which is raw SQL for exactly this
   * reason (§3).
   */
  sessionUpdated: defineEvent({
    slug: "session-updated",
    name: { en: "Session updated" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/advance-story-clock"],
    payload: S.sessionChange,
    description: "The session's settings changed \u2014 name, scenario, lorebook, genre fields, preset, channels or tags \u2014 or a pipeline moved its story clock. The payload lists which."
  }),
  /**
   * `metadata.turnOrder` was written by `core:outlet/set-turn-order@1`.
   * **Core-internal**: the auto-advance listener and the
   * `sessions:turnOrder` push read it; `genre()` refuses it in a genre's
   * `events`, so no preset can bind a spec to it and the recompute cannot
   * feed itself.
   */
  turnOrderChanged: defineEvent({
    slug: "turn-order-changed",
    name: { en: "Turn order changed" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/set-turn-order"],
    payload: S.turnOrderChanged,
    description: "The session's turn order was recomputed and written. The payload carries the order as written and the cause that led to it."
  }),
  /**
   * A pipeline's annex entry changed: "my state changed", for any genre.
   * A package writes its annex through `core:outlet/set-session-annex@1`
   * and binds this; for a named happening of its own it declares an event
   * and records it. Emitted only
   * when the merged value differs from the stored one, so a spec that
   * rewrites the same value cannot feed itself; the lineage caps stop the
   * rest.
   */
  annexChanged: defineEvent({
    slug: "annex-changed",
    name: { en: "Annex changed" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/set-session-annex", "core:outlet/set-annex-field"],
    payload: S.annexChange,
    description: "A pipeline's own session state changed \u2014 its annex entry. The payload names the owner whose entry moved."
  }),
  /**
   * Not a write's event: the marker the `sessionChanges` list ends with when
   * more than fifty changes waited between two replies (U5b review S1). The
   * newest fifty are delivered and this one entry says how many older ones
   * were not, so a pipeline can tell a full list from a truncated one. Never
   * written to `session_changes` and never on a receipt's `emitted` — no
   * `causedBy`, because no outlet causes it.
   */
  sessionChangesTruncated: defineEvent({
    slug: "session-changes-truncated",
    name: { en: "Session changes truncated" },
    version: 1,
    family: "data",
    affectsUser: false,
    payload: S.sessionChange,
    description: "More session changes waited than one reply is handed. The newest fifty were delivered; the payload says how many older ones were dropped."
  }),
  /**
   * A **form** — a `choices` or `form` block a message carries — was
   * addressed to a participant the AI portrays this turn (R-15 *Forms*;
   * R-21 (5); 30 §U5d). Caused by the write that carried the block, and
   * dispatched through the same path as the lifecycle events, so every
   * answer run is a child of the run that asked (`parentRunId`,
   * `rootRunId`, `depth`) and 01 §8's cycle caps hold: a form whose answer
   * asks another form stops at the depth cap, receipted. A form addressed
   * to a person is no event: the block waits for the click.
   */
  formAddressed: defineEvent({
    slug: "form-addressed",
    name: { en: "Form addressed" },
    version: 1,
    family: "data",
    affectsUser: false,
    causedBy: ["core:outlet/create-message", "core:outlet/update-message"],
    payload: S.formAddressed,
    description: "A question or form in a message was addressed to a participant the AI portrays this turn \u2014 the genre's answer pipeline answers it. The payload names the message, the block, the action and the addressee."
  }),
  /**
   * A form was **answered** — by a click, or by the answer pipeline's
   * outlet committing an oracle's answer exactly as a click would. Lands in
   * the session's changes so the next reply's inlet sees it (`answer`,
   * `addressee`, `blockId`, `action` on the payload).
   */
  formAnswered: defineEvent({
    slug: "form-answered",
    name: { en: "Form answered" },
    version: 1,
    family: "data",
    affectsUser: false,
    causedBy: ["core:outlet/answer-form"],
    payload: S.sessionChange,
    description: "A question or form in a message was answered. The payload carries the answer, who answered as whom, and the action it fired."
  }),
  /**
   * A form was **superseded** (plans/29 R-15 *Staleness and order*; 30
   * §U5f): the channel head moved past the turn it was issued at before it
   * was answered, and a press on it reached the door. Recorded ONCE per
   * block, the first time the door sees it stale, so the next reply's
   * inlet learns the question lapsed — not on every render, and never by a
   * render. No outlet causes it: the door does, like the truncation marker.
   */
  formSuperseded: defineEvent({
    slug: "form-superseded",
    name: { en: "Form superseded" },
    version: 1,
    family: "data",
    affectsUser: false,
    payload: S.sessionChange,
    description: "A question or form in a message was overtaken \u2014 the conversation moved on before it was answered, and a press on it was refused. The payload names the message and the block."
  }),
  loreEntryCreated: defineEvent({
    slug: "lore-entry-created",
    name: { en: "Lore entry written" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/create-lore-entry"],
    description: "A lorebook entry was written."
  }),
  /**
   * Two lore entries were linked (L2, 2026-09-17) — a room's exit, who keeps
   * what, what stands near what.
   *
   * Its own event rather than `lore-entry-created`: a link is not an entry,
   * nothing about it is created or changed, and a subscriber that wants to
   * redraw a map wants exactly this and none of the writes that make rows.
   *
   * ⚠ It declares no payload shape — it rides the run's receipt as caused by
   * the outlet, and the link itself (its name, its words both ways) is the
   * outlet's `linkId` row, read where it is needed (places plan B2,
   * 2026-09-29). An idempotent repeat that found the standing row wrote
   * nothing, and causes no event (`written: false`).
   */
  loreLinkCreated: defineEvent({
    slug: "lore-link-created",
    name: { en: "Lore entries linked" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/link-lore-entries"],
    description: "Two lorebook entries were linked."
  }),
  graphProposalCreated: defineEvent({
    slug: "graph-proposal-created",
    name: { en: "Graph proposal filed" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/graph-proposal"],
    description: "A narrative-graph proposal was filed for review."
  }),
  // ── The session lifecycle (24 §5) — ACTION family: a person did it ──────
  /** The create slot — required; exactly one pipeline per genre answers it. */
  sessionCreated: defineEvent({
    slug: "session-created",
    declaredRoot: true,
    name: { en: "Session created" },
    version: 1,
    family: "action",
    affectsUser: false,
    description: "A session was created \u2014 the genre's create pipeline answers this."
  }),
  /** The primary turn. A swipe is this pipeline re-run, not a new event. */
  messageRespond: defineEvent({
    slug: "message-respond",
    declaredRoot: true,
    name: { en: "Reply" },
    version: 1,
    family: "action",
    affectsUser: true,
    description: "A reply was asked for \u2014 the primary turn of a session."
  }),
  /** Arbitrary buttons/triggers — the contributed functions surface (19 §3). */
  sessionAction: defineEvent({
    slug: "session-action",
    declaredRoot: true,
    name: { en: "Action" },
    version: 1,
    family: "action",
    affectsUser: true,
    description: "A person triggered a contributed action in a session."
  }),
  memberAdded: defineEvent({
    slug: "member-added",
    declaredRoot: true,
    name: { en: "Member joined" },
    version: 1,
    family: "action",
    affectsUser: false,
    // A seat is a cast change (R31): `change: 'added'`, `ref` the member.
    payload: S.castChange,
    description: "A character, persona or envoy joined a session; the payload carries which."
  }),
  memberRemoved: defineEvent({
    slug: "member-removed",
    declaredRoot: true,
    name: { en: "Member left" },
    version: 1,
    family: "action",
    affectsUser: false,
    // An unseat is a cast change (R31): `change: 'removed'`, `ref` the member.
    payload: S.castChange,
    description: "A character, persona or envoy left a session; the payload carries which."
  }),
  /**
   * A UI action asked for a run (13 §7). Carrying both users is what answers the
   * budget-owner question without a separate rule: **budget and quota attach to the
   * owner; the receipt's attribution records the trigger.** Group sessions need no
   * special case.
   *
   * ⏳ Overlaps `session-action` since the fold (a contributed action IS a UI
   * action). Kept because ruling 49 (`UiActionPayload`, the owner/trigger
   * split) has no other home yet; nothing subscribes to it. Retire when the
   * action model (30 §U5) gives the payload one.
   */
  uiAction: defineEvent({
    slug: "ui-action",
    name: { en: "Interface action" },
    version: 1,
    family: "action",
    affectsUser: true,
    description: "Someone asked for a run from the interface \u2014 a composer action, a message action, a re-roll. Payload: sessionId, ownerUserId, actorUserId, action, modeId, input."
  }),
  /**
   * The path for scheduled model work (13 §7c). No callable may call an oracle
   * (F32), and lifecycle callbacks may not trigger pipelines, so nightly
   * summarization subscribes here instead — which also puts it on the consent
   * screen, where a lifecycle callback doing the same work would have been
   * invisible. Serene Pub emits it hourly (`cadence: 'hourly'`, `scheduledFor`
   * the ISO instant it was due, `scope: 'pub'`), only to subscribed,
   * granted listeners; `SCHEDULED_WORK_PATH` names it.
   */
  scheduleTick: defineEvent({
    slug: "schedule-tick",
    name: { en: "Schedule tick" },
    version: 1,
    family: "action",
    affectsUser: false,
    description: "A declared cadence elapsed. Payload: cadence, scheduledFor, scope."
  })
};

// ../serene-pub-sdk/sdk/src/widgets.ts
var MESSAGE_HOST_FIELDS = Object.freeze([
  "userId",
  "queueItemId",
  "debugMeta",
  "embedding",
  "embeddingModel",
  "embeddingSourceHash",
  "embedTextHash",
  "vectorizedAt",
  "version"
]);
var HOST_FIELD_SET = new Set(MESSAGE_HOST_FIELDS);
var WIDGET_SCOPED_SECTIONS = Object.freeze({
  "session:full": "session_full",
  "session:state": "session_state",
  persona: "persona",
  characters: "characters",
  lore: "lore"
});
var SCOPED_SECTION_NAMES = new Set(Object.values(WIDGET_SCOPED_SECTIONS));
var isWidgetScopedSectionName = (name) => typeof name === "string" && SCOPED_SECTION_NAMES.has(name);
var BASE_SECTIONS = {
  layout: true,
  session: true,
  channels: true,
  messages: true,
  props: true,
  actions: true,
  settings: true,
  annex: true,
  locale: true,
  viewer: true,
  turnOrder: true
};
var WIDGET_BASE_SECTIONS = Object.freeze(
  Object.keys(BASE_SECTIONS)
);
var WIDGET_REQUEST_ASKERS = Object.freeze({
  messages: "any",
  "open-character": "any",
  "view-avatar": "any",
  "view-image": "any",
  "open-lore": "any",
  "prompt-details": "any",
  "inspect-run": "any",
  "pick-turn": "any",
  "change-sprite": "any",
  "actions-seen": "core",
  summarize: "core",
  send: "core",
  "attach-files": "core",
  "remove-tray-item": "core",
  "remove-attachment": "core",
  draft: "core",
  "switch-persona": "core",
  "add-persona": "core",
  "fire-turn": "core",
  "decide-proposal": "core",
  "set-attribute-value": "core",
  "set-sprite-set": "core",
  "clear-scene-image": "core",
  "session-entries": Object.freeze({ scope: "lore" }),
  "set-entry-marks": "core",
  "authors-note": "core",
  "set-authors-note": "core"
});
var WIDGET_REQUEST_KINDS = Object.freeze(
  Object.keys(WIDGET_REQUEST_ASKERS)
);
var WIDGET_EVENT_SCOPES = Object.freeze({
  "lore:ranked": "lore",
  "lore:marked": "lore"
});

// ../serene-pub-sdk/sdk/src/surfaces.ts
var SAFE_PLUGIN_ID = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
function parsePluginWidgetId(id) {
  const cut = id.indexOf(":");
  if (cut <= 0) return null;
  const pluginId = id.slice(0, cut);
  const panelId = id.slice(cut + 1);
  if (!SAFE_PLUGIN_ID.test(pluginId) || !isServablePanelId(panelId)) return null;
  return { pluginId, panelId };
}
var SAFE_ENTRY = /^[a-zA-Z0-9_\-][a-zA-Z0-9._\-]*(\/[a-zA-Z0-9._\-]+)*$/;
var SAFE_PANEL_ID = /^[a-z0-9_-]+$/;
var isServableEntry = (path) => SAFE_ENTRY.test(path) && !path.split("/").some((seg) => seg === "." || seg === "..");
var isServablePanelId = (id) => SAFE_PANEL_ID.test(id);

// ../serene-pub-sdk/sdk/src/sessionLayout.ts
var ZONE_IDS = ["left", "middle", "right"];
var INSTANCE_NAME_SEPARATOR = "#";
var INSTANCE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
var CORE_WIDGET_ID = /^[a-z][a-z0-9-]*$/;
function widgetOfInstance(instanceId) {
  const at = instanceId.indexOf(INSTANCE_NAME_SEPARATOR);
  return at > 0 ? instanceId.slice(0, at) : instanceId;
}
function isWidgetInstanceId(id) {
  if (typeof id !== "string" || !id) return false;
  const at = id.indexOf(INSTANCE_NAME_SEPARATOR);
  const widget2 = at < 0 ? id : id.slice(0, at);
  if (at >= 0 && !INSTANCE_NAME.test(id.slice(at + 1))) return false;
  return CORE_WIDGET_ID.test(widget2) || parsePluginWidgetId(widget2) !== null;
}
var RETIRED_WIDGET_IDS = /* @__PURE__ */ new Set(["composer", "inventory"]);
var isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
var strings = (x) => Array.isArray(x) ? x.filter((s) => typeof s === "string") : [];
function gridIn(layout, zone) {
  const widgets = isObj(layout.widgetGrid) && Array.isArray(layout.widgetGrid.widgets) ? layout.widgetGrid.widgets : [];
  return widgets.filter((w) => isObj(w) && w.zone === zone && typeof w.id === "string").map((w, n) => ({ id: w.id, order: typeof w.order === "number" ? w.order : n })).sort((a, b) => a.order - b.order).map((w) => w.id);
}
function arrangedIn(layout, zone) {
  const frame = isObj(layout.arrangedGrid) ? layout.arrangedGrid[zone] : void 0;
  if (!isObj(frame) || !Array.isArray(frame.items)) return null;
  return frame.items.filter((i) => isObj(i) && typeof i.id === "string").map((i) => ({ id: i.id, x: Number(i.x) || 0, y: Number(i.y) || 0 })).sort((a, b) => a.y - b.y || a.x - b.x).map((i) => i.id);
}
function zoneDefs(layout) {
  const zones = isObj(layout.zoneLayout) ? layout.zoneLayout.zones : void 0;
  return isObj(zones) ? Object.values(zones).filter(isObj) : [];
}
function zoneDrawnAt(def) {
  if (def.kind === "strip") return def.area === "bottom" ? "bottom" : "top";
  return def.side === "left" ? "left" : "right";
}
function layoutWidgetIds(layout) {
  const out = /* @__PURE__ */ new Set();
  for (const z of zoneDefs(layout)) for (const id of strings(z.widgets)) out.add(id);
  const grid = isObj(layout.widgetGrid) && Array.isArray(layout.widgetGrid.widgets) ? layout.widgetGrid.widgets : [];
  for (const w of grid) if (isObj(w) && typeof w.id === "string") out.add(w.id);
  for (const zone of ZONE_IDS) for (const id of arrangedIn(layout, zone) ?? []) out.add(id);
  return [...out];
}
function drawnWidgetIds(layout) {
  const out = [];
  const add = (id) => {
    if (!RETIRED_WIDGET_IDS.has(id) && !out.includes(id)) out.push(id);
  };
  (arrangedIn(layout, "middle") ?? gridIn(layout, "middle")).forEach(add);
  const defs = zoneDefs(layout);
  for (const side of ["left", "right"]) {
    const frame = arrangedIn(layout, side);
    if (frame?.length) {
      frame.forEach(add);
      continue;
    }
    const zones = defs.filter((z) => zoneDrawnAt(z) === side);
    for (const z of zones) strings(z.widgets).forEach(add);
    if (zones.length) gridIn(layout, side).forEach(add);
  }
  for (const z of defs) if (z.kind === "strip") strings(z.widgets).forEach(add);
  return out;
}
var isInt = (x) => typeof x === "number" && Number.isInteger(x);
var SLOTS = ["zoneLayout", "widgetGrid", "arrangedGrid", "widgetSettings", "widgetStyles"];
var RETIRED_DOCUMENT_KEYS = ["layout", "version", "zones", "variants", "look"];
function isSizeSpec(x) {
  if (x === "grow" || x === "fixed") return true;
  if (!isObj(x)) return false;
  const keys = ["minCells", "maxCells", "cells"].filter((k) => x[k] !== void 0);
  return keys.length > 0 && keys.every((k) => typeof x[k] === "number" && x[k] > 0);
}
function isAnchor(x) {
  return isObj(x) && Object.entries(x).every(([k, v2]) => ["top", "bottom", "left", "right"].includes(k) && typeof v2 === "boolean");
}
function validateSessionLayout(layout, opts = {}) {
  const errors = [];
  const warnings = [];
  if (!isObj(layout)) return { ok: false, errors: ["a session layout is an object"], warnings };
  if (RETIRED_DOCUMENT_KEYS.some((k) => k in layout))
    errors.push(
      `a retired layout document (LayoutDoc v2: ${RETIRED_DOCUMENT_KEYS.filter((k) => k in layout).join(", ")}) \u2014 declare a session layout: { zoneLayout?, widgetGrid?, arrangedGrid?, widgetSettings?, widgetStyles? }`
    );
  for (const k of Object.keys(layout))
    if (!SLOTS.includes(k) && !RETIRED_DOCUMENT_KEYS.includes(k))
      warnings.push(`'${k}' is not a slot of the session layout \u2014 readers ignore it`);
  const placedIn = /* @__PURE__ */ new Map();
  const isInstanceId = (id, where) => {
    if (isWidgetInstanceId(id)) return true;
    errors.push(
      `${where}: '${String(id)}' is not a widget instance id \u2014 a widget id, or '<widget id>#<instance name>' (${INSTANCE_NAME})`
    );
    return false;
  };
  const place = (id, zone, where, seen) => {
    if (!isInstanceId(id, where)) return;
    if (seen.has(id)) errors.push(`${where}: '${id}' is listed twice \u2014 a widget instance is placed once`);
    seen.add(id);
    const held = placedIn.get(id);
    if (held && held.zone !== zone)
      errors.push(`${where}: '${id}' is also placed in ${held.zone} (${held.where}) \u2014 a widget instance lives in one zone`);
    else if (!held) placedIn.set(id, { zone, where });
  };
  const zoneKey = (k, where) => {
    if (ZONE_IDS.includes(k)) return true;
    errors.push(`${where}: '${k}' is not a zone \u2014 one of ${ZONE_IDS.join(", ")}`);
    return false;
  };
  const zl = layout.zoneLayout;
  if (zl !== void 0) {
    if (!isObj(zl) || zl.version !== 1 || !isObj(zl.zones))
      errors.push("zoneLayout: { version: 1, zones: { \u2026 } }");
    else {
      for (const [key, def] of Object.entries(zl.zones)) {
        const at = `zoneLayout.zones.${key}`;
        if (!isObj(def)) {
          errors.push(`${at}: a zone is an object`);
          continue;
        }
        if (def.kind !== "side" && def.kind !== "strip") errors.push(`${at}.kind: 'side' or 'strip'`);
        if (def.side !== void 0 && def.side !== "left" && def.side !== "right")
          errors.push(`${at}.side: 'left' or 'right'`);
        if (def.area !== void 0 && def.area !== "top" && def.area !== "bottom")
          errors.push(`${at}.area: 'top' or 'bottom'`);
        if (def.pinned !== void 0 && typeof def.pinned !== "boolean") errors.push(`${at}.pinned: a boolean`);
        if (def.rules !== void 0 && (!Array.isArray(def.rules) || def.rules.some((r) => !isObj(r) || typeof r.min !== "number")))
          errors.push(`${at}.rules: a list of { min, mode?, width?, columns? }`);
        const drawnAt = zoneDrawnAt(def);
        if (key !== drawnAt) {
          const strip = def.kind === "strip";
          const field = strip ? "area" : "side";
          const unstated = def[field] === void 0 ? ` (it states no ${field}, and ${strip ? "a strip with none is the top" : "a side zone with none is the right"})` : "";
          const fixes = (strip ? ["top", "bottom"] : ["left", "right"]).includes(key) ? `key it '${drawnAt}', or set ${field}: '${key}'` : `key it '${drawnAt}'`;
          errors.push(
            `${at}: the page draws this ${strip ? "strip" : "side zone"} at the ${drawnAt}${unstated} \u2014 a zone is keyed by where it is drawn (a side by its side, a strip by its area${key === "middle" ? "; the middle's membership is the widget grid's" : ""}): ${fixes}`
          );
        }
        if (!Array.isArray(def.widgets)) {
          errors.push(`${at}.widgets: a list of widget instance ids`);
          continue;
        }
        const seen = /* @__PURE__ */ new Set();
        for (const id of def.widgets) place(id, drawnAt, `${at}.widgets`, seen);
      }
      if (zl.styles !== void 0 && (!isObj(zl.styles) || zl.styles.chat !== void 0 && typeof zl.styles.chat !== "string"))
        errors.push("zoneLayout.styles: { chat?: string }");
    }
  }
  const wg = layout.widgetGrid;
  if (wg !== void 0) {
    if (!isObj(wg) || wg.version !== 1 || !Array.isArray(wg.widgets))
      errors.push("widgetGrid: { version: 1, cell, widgets: [ \u2026 ] }");
    else {
      if (typeof wg.cell !== "number" || !(wg.cell > 0)) errors.push("widgetGrid.cell: a positive number of px");
      const seen = /* @__PURE__ */ new Set();
      wg.widgets.forEach((w, n) => {
        const at = `widgetGrid.widgets[${n}]`;
        if (!isObj(w)) {
          errors.push(`${at}: a grid widget is an object`);
          return;
        }
        const zone = typeof w.zone === "string" ? w.zone : void 0;
        const zoned = zone === void 0 ? (errors.push(`${at}.zone: one of ${ZONE_IDS.join(", ")}`), false) : zoneKey(zone, `${at}.zone`);
        if (typeof w.order !== "number" || !Number.isFinite(w.order)) errors.push(`${at}.order: a number`);
        if (!isObj(w.size) || !isSizeSpec(w.size.w) || !isSizeSpec(w.size.h))
          errors.push(`${at}.size: { w, h }, each 'grow', 'fixed' or { cells | minCells | maxCells }`);
        if (!isAnchor(w.anchor)) errors.push(`${at}.anchor: { top?, bottom?, left?, right? } of booleans`);
        if (w.colSpan !== void 0 && !(isInt(w.colSpan) && w.colSpan > 0)) errors.push(`${at}.colSpan: a positive integer`);
        if (w.group !== void 0 && typeof w.group !== "string") errors.push(`${at}.group: a string`);
        if (zoned) place(w.id, zone, "widgetGrid.widgets", seen);
        else isInstanceId(w.id, "widgetGrid.widgets");
      });
    }
  }
  const ag = layout.arrangedGrid;
  if (ag !== void 0) {
    if (!isObj(ag)) errors.push("arrangedGrid: { left?, middle?, right? }");
    else
      for (const [key, frame] of Object.entries(ag)) {
        const at = `arrangedGrid.${key}`;
        if (!zoneKey(key, at)) continue;
        if (!isObj(frame) || !(isInt(frame.cols) && frame.cols > 0) || !(isInt(frame.rows) && frame.rows > 0) || !Array.isArray(frame.items)) {
          errors.push(`${at}: { cols, rows, items } \u2014 whole, positive cols and rows`);
          continue;
        }
        const { cols, rows } = frame;
        const seen = /* @__PURE__ */ new Set();
        const boxes = [];
        frame.items.forEach((item, n) => {
          const where = `${at}.items[${n}]`;
          if (!isObj(item)) {
            errors.push(`${where}: an arranged item is an object`);
            return;
          }
          const { x, y, w, h } = item;
          if (!isInt(x) || !isInt(y) || !isInt(w) || !isInt(h) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > cols || y + h > rows)
            errors.push(`${where}: whole cells inside ${cols} \xD7 ${rows} (x, y \u2265 0; w, h \u2265 1)`);
          else if (typeof item.id === "string") boxes.push({ id: item.id, x, y, w, h });
          if (item.anchor !== void 0 && !isAnchor(item.anchor)) errors.push(`${where}.anchor: { top?, bottom?, left?, right? } of booleans`);
          if (item.group !== void 0 && typeof item.group !== "string") errors.push(`${where}.group: a string`);
          if (item.pinned !== void 0 && typeof item.pinned !== "boolean") errors.push(`${where}.pinned: a boolean`);
          place(item.id, key, `${at}.items`, seen);
        });
        boxes.forEach((a, i) => {
          for (const b of boxes.slice(i + 1))
            if (a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
              warnings.push(`${at}: '${a.id}' and '${b.id}' share cells \u2014 one draws over the other`);
        });
      }
  }
  const ws = layout.widgetSettings;
  if (ws !== void 0) {
    if (!isObj(ws)) errors.push("widgetSettings: { [widget instance id]: { \u2026 } }");
    else
      for (const [id, v2] of Object.entries(ws)) {
        if (!isWidgetInstanceId(id)) errors.push(`widgetSettings: '${id}' is not a widget instance id`);
        if (!isObj(v2)) errors.push(`widgetSettings.${id}: the widget's settings, an object`);
      }
  }
  const pins = layout.widgetStyles;
  if (pins !== void 0) {
    if (!isObj(pins)) errors.push("widgetStyles: { [widget instance id]: { slug, id? } }");
    else
      for (const [id, v2] of Object.entries(pins)) {
        if (!isWidgetInstanceId(id)) errors.push(`widgetStyles: '${id}' is not a widget instance id`);
        if (!isObj(v2) || typeof v2.slug !== "string" || !v2.slug || v2.id !== void 0 && !(isInt(v2.id) && v2.id > 0))
          errors.push(`widgetStyles.${id}: a style pin, { slug, id? }`);
      }
  }
  const drawn = new Set(drawnWidgetIds(layout));
  const framed = (zone) => {
    const frame = isObj(ag) ? ag[zone] : void 0;
    return isObj(frame) && Array.isArray(frame.items) && (zone === "middle" || frame.items.length > 0);
  };
  for (const [id, { zone }] of placedIn) {
    if (RETIRED_WIDGET_IDS.has(widgetOfInstance(id))) {
      warnings.push(`'${id}' names a retired widget \u2014 no reader draws it`);
      continue;
    }
    if (drawn.has(id)) continue;
    const why = framed(zone) ? `the ${zone}'s arrangement draws there, and it does not place '${id}'` : `the grid puts it on the ${zone}, where the layout has no side zone to draw it in`;
    warnings.push(`'${id}' is placed in the ${zone} but never drawn \u2014 ${why}`);
  }
  if (opts.widgets) {
    const decls = new Map(opts.widgets.map((w) => [w.id, w]));
    const counts = /* @__PURE__ */ new Map();
    for (const id of placedIn.keys()) {
      const widget2 = widgetOfInstance(id);
      counts.set(widget2, (counts.get(widget2) ?? 0) + 1);
      if (opts.unknownWidgets === "warn" && !decls.has(widget2) && !RETIRED_WIDGET_IDS.has(widget2))
        warnings.push(`'${id}' names a widget this pub does not know \u2014 it draws as a placeholder`);
    }
    for (const [widget2, n] of counts) {
      const cap = decls.get(widget2)?.maxInstances;
      if (typeof cap === "number" && n > cap)
        warnings.push(`'${widget2}' is placed ${n} times, over its maxInstances (${cap}) \u2014 readers draw the first ${cap}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

// ../serene-pub-sdk/sdk/src/widgetDecls.ts
var REGISTRY = globalThis[/* @__PURE__ */ Symbol.for("serene-pub.widget-owners")] ??= {
  owners: /* @__PURE__ */ new WeakMap(),
  coreIds: /* @__PURE__ */ new Set()
};
var OWNERS = REGISTRY.owners;
function ownWidgets(owner, widgets) {
  for (const w of widgets) {
    const held = OWNERS.get(w);
    if (held && held !== owner)
      throw new Error(`widget '${w.id}' is already ${held}'s \u2014 a widget belongs to the one package that declares it`);
    OWNERS.set(w, owner);
    if (owner === "core") REGISTRY.coreIds.add(w.id);
  }
}
var coreWidgetIds = () => REGISTRY.coreIds;
function widgetRef(w) {
  const owner = OWNERS.get(w);
  if (!owner)
    throw new Error(
      `widget '${w?.id}' belongs to no package yet \u2014 name a widget value from core (\`coreWidgets\`) or from a package's \`defineExtension({ widgets })\``
    );
  return owner === "core" ? w.id : `${owner}:${w.id}`;
}
var WIDGET_ID = /^[a-z][a-z0-9-]*$/;
function widgetReadsFindings(reads, at) {
  if (reads === void 0) return [];
  const names = WIDGET_BASE_SECTIONS.map((s) => `'${s}'`).join(", ");
  if (!Array.isArray(reads)) return [`${at}: a list of base section names \u2014 any of ${names}`];
  const out = [];
  for (const name of reads) {
    if (WIDGET_BASE_SECTIONS.includes(name)) continue;
    out.push(
      isWidgetScopedSectionName(name) ? `${at}: '${name}' is a scoped section \u2014 ask for it in \`scopes\`, never in \`reads\`` : `${at}: '${String(name)}' is not a base section \u2014 one of ${names}`
    );
  }
  return out;
}
function widget(d) {
  const problems = [];
  if (!WIDGET_ID.test(d.id ?? ""))
    problems.push(`'${d.id}' is not a widget id \u2014 lowercase letters, digits and '-' (the package supplies the namespace)`);
  problems.push(...i18nFindings(d.title, `widget '${d.id}' title`, { required: true }));
  if (typeof d.component !== "string" || !d.component)
    problems.push(`widget '${d.id}' names no component \u2014 give \`component\`, the slug of a component this package declares`);
  if (d.surface !== void 0)
    problems.push(`widget '${d.id}': \`surface\` is gone \u2014 name a component, and place an \`sp-frame\` inside it for a document`);
  problems.push(...widgetReadsFindings(d.reads, `widget '${d.id}' reads`));
  if (d.maxInstances !== void 0 && !(Number.isInteger(d.maxInstances) && d.maxInstances > 0))
    problems.push(`widget '${d.id}' maxInstances: a positive whole number, or leave it out for no cap`);
  const genres = d.genres?.map((g) => g?.id);
  if (genres?.some((g) => typeof g !== "string" || !g))
    problems.push(`widget '${d.id}' genres: each is a genre value (or use('<id>')), never a bare string`);
  if (problems.length) throw new Error(problems.join("\n"));
  const { genres: _g, ...rest } = d;
  return Object.freeze({ ...rest, ...genres?.length ? { genres: [...new Set(genres)] } : {} });
}

// ../serene-pub-sdk/sdk/src/channels.ts
var DEFAULT_CHANNEL = "main";

// ../serene-pub-sdk/sdk/src/descriptors.ts
function scriptPointsOf(d) {
  return (d.scriptPoints ?? []).map((p) => ({
    ...p,
    key: String(p.key),
    accepts: Array.isArray(p.accepts) ? [...p.accepts] : []
  }));
}
var MESSAGE_VERB_FLOORS = ["stop", "branch", "edit"];
var MESSAGE_VERB_BUILT_INS = ["delete", "hide", "swipe"];
var MESSAGE_VERB_CONTENT = ["retry", "extend", "stepBack"];
var MESSAGE_VERBS = [...MESSAGE_VERB_CONTENT, ...MESSAGE_VERB_BUILT_INS];
var TURN_CONTROLS = ["advance", "pick", "narrate", "retake"];
function plainObject(v2) {
  return v2 && typeof v2 === "object" && !Array.isArray(v2) ? v2 : void 0;
}
function assertTurnControls(shape, who) {
  const raw = shape?.turnControls;
  if (raw === void 0) return;
  const problems = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    problems.push(`turnControls is { ${TURN_CONTROLS.map((t) => `${t}?`).join(", ")} }`);
  } else {
    for (const [k, v2] of Object.entries(raw)) {
      if (!TURN_CONTROLS.includes(k)) {
        problems.push(`turnControls.${k}: not a turn control \u2014 one of ${TURN_CONTROLS.join(", ")}`);
        continue;
      }
      if (typeof v2 === "boolean") continue;
      if (!v2 || typeof v2 !== "object" || Array.isArray(v2) || !("presentWhen" in v2)) {
        problems.push(
          `turnControls.${k}: true, false, or { presentWhen } \u2014 enabled-when predicates over the published values, such as { on: 'session.fields.<field>', equals: '<value>', reason: { en: '<why it is absent>' } }`
        );
        continue;
      }
      const pw = v2.presentWhen;
      problems.push(...enabledWhenFindings(pw, `turnControls.${k}.presentWhen`));
      normalizeEnabledWhen(pw).forEach((p, i) => {
        if (p.on === "item" || p.on.startsWith("item."))
          problems.push(
            `turnControls.${k}.presentWhen[${i}]: reads '${p.on}' \u2014 a turn control acts on no row, so it cannot read one`
          );
      });
    }
  }
  if (problems.length) throw new Error(`${who}: ${problems.join("\n")}`);
}
var SESSION_WRITES = ["lore", "scenes"];
function assertSessionWrites(shape, who) {
  const writes = shape?.writes;
  if (writes === void 0) return;
  if (!writes || typeof writes !== "object" || Array.isArray(writes))
    throw new Error(
      `${who} declares a 'writes' that is not an object. A genre's writes are { lore?: boolean; scenes?: boolean } \u2014 absent means both on, and only an explicit false takes one away (R-B).`
    );
  const bad = SESSION_WRITES.filter(
    (w) => writes[w] !== void 0 && typeof writes[w] !== "boolean"
  );
  if (!bad.length) return;
  throw new Error(
    `${who} declares writes { ${bad.map((w) => `${w}: ${JSON.stringify(writes[w])}`).join(", ")} }. Each write is a boolean or absent \u2014 absent means on, and only an explicit false takes the write away (R-B).`
  );
}
var BUILTIN_SPEC_IDS = Object.freeze({
  delete: "core:spec/builtin-delete",
  hide: "core:spec/builtin-hide",
  edit: "core:spec/builtin-edit",
  swipe: "core:spec/builtin-swipe",
  branch: "core:spec/builtin-branch"
});
var BUILTIN_OUTLET_IDS = Object.freeze({
  delete: "core:outlet/delete-message@1",
  hide: "core:outlet/hide-message@1",
  edit: "core:outlet/edit-message@1",
  swipe: "core:outlet/swipe-message@1",
  branch: "core:outlet/branch-session@1"
});
function reviewFieldsFinding(d) {
  if (d.effects !== "write" && d.effects !== "external") return null;
  if (d.review && Array.isArray(d.review.fields)) return null;
  return `${d.id} declares effects: '${d.effects}' and no review.fields. An effectful definition says which of its in-ports a reviewer may edit at the gate \u2014 review: { fields: ['text'] }, or review: { fields: [] } when the gate is approve-or-refuse. Until it does, the form is inferred from the whole payload and every field is editable, including any row id.`;
}
var registrationFindings = /* @__PURE__ */ new Map();
function assertMessageVerbFloors(shape, who) {
  const verbs = shape?.messageVerbs;
  if (!verbs || typeof verbs !== "object") return;
  const forbidden = MESSAGE_VERB_FLOORS.filter((floor) => verbs[floor] === false);
  if (!forbidden.length) return;
  throw new Error(
    `${who} declares messageVerbs { ${forbidden.map((f) => `${f}: false`).join(", ")} }. Stop, branch and edit are floors \u2014 present in every genre, never switched off (R-15). A genre may switch off delete, hide or swipe, and may forbid retry, extend or stepBack; drop the floor from the declaration.`
  );
}
var CHANNEL_ROLES = ["conversation", "folio"];
var CHANNEL_VOICES = ["character", "narrator", "none"];
function channelDecls(shape) {
  const s = shape && typeof shape === "object" ? shape : {};
  const genreVoice = typeof s.voice === "string" ? s.voice : void 0;
  const genreVerbs = s.messageVerbs;
  const genreControls = plainObject(s.turnControls);
  const resolve = (raw) => {
    const decl2 = typeof raw === "string" ? { slug: raw.trim() } : raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const slug = typeof decl2.slug === "string" ? decl2.slug.trim() : "";
    if (!slug) return void 0;
    const verbs = decl2.messageVerbs || genreVerbs ? { ...genreVerbs, ...decl2.messageVerbs } : void 0;
    const ownControls = plainObject(decl2.turnControls);
    const controls = ownControls || genreControls ? { ...genreControls, ...ownControls } : void 0;
    return {
      slug,
      role: decl2.role ?? "conversation",
      ...decl2.voice ?? genreVoice ? { voice: decl2.voice ?? genreVoice } : {},
      ...verbs ? { messageVerbs: verbs } : {},
      ...isI18n(decl2.label) ? { label: localeMapOf(decl2.label) } : {},
      ...controls ? { turnControls: controls } : {}
    };
  };
  const declared2 = (Array.isArray(s.channels) ? s.channels : []).map(resolve).filter((d) => d !== void 0);
  const main = declared2.find((d) => d.slug === DEFAULT_CHANNEL);
  return [main ?? resolve(DEFAULT_CHANNEL), ...declared2.filter((d) => d !== main)];
}
function assertChannelDecls(shape, who) {
  const channels = shape?.channels;
  if (channels === void 0) return;
  if (!Array.isArray(channels))
    throw new Error(
      `${who} declares a 'channels' that is not an array. A genre's channels are a list of slugs, each a bare string or a { slug, role?, voice?, messageVerbs?, label?, turnControls? } (R-C).`
    );
  for (const raw of channels) {
    const isString = typeof raw === "string";
    if (!isString && (!raw || typeof raw !== "object" || Array.isArray(raw)))
      throw new Error(
        `${who} declares a channel that is neither a slug nor a declaration: ${JSON.stringify(raw)}. Each channel is a bare string or a { slug, role?, voice?, messageVerbs?, label?, turnControls? } (R-C).`
      );
    const decl2 = isString ? { slug: raw } : raw;
    const slug = typeof decl2.slug === "string" ? decl2.slug.trim() : "";
    if (!slug)
      throw new Error(
        `${who} declares a channel with no slug. A channel is named by the slug it is referenced and stored under (R-C).`
      );
    if (slug.includes(":"))
      throw new Error(
        `${who} declares the channel '${slug}'. A channel is declared by its slug alone \u2014 lanes under it are runtime and open-ended, allocated by this genre's pipelines, and no lane count is declared anywhere (ruling 2026-09-09).`
      );
    const at = `${who} channel '${slug}'`;
    if (decl2.role !== void 0 && !CHANNEL_ROLES.includes(decl2.role))
      throw new Error(
        `${at} declares role '${decl2.role}'. A channel's role is ${CHANNEL_ROLES.map((r) => `'${r}'`).join(" or ")} \u2014 how its messages enter a prompt, turns with speakers or one block of text (R-C).`
      );
    if (decl2.voice !== void 0 && !CHANNEL_VOICES.includes(decl2.voice))
      throw new Error(
        `${at} declares voice '${decl2.voice}'. A channel's voice is ${CHANNEL_VOICES.map((v2) => `'${v2}'`).join(", ")} \u2014 whose name a turn triggered here seeds under, or none for no seed row at all (R-C).`
      );
    assertMessageVerbFloors({ messageVerbs: decl2.messageVerbs }, at);
    const label = i18nFindings(decl2.label, `${at} label`);
    if (label.length) throw new Error(label.join("\n"));
    assertTurnControls({ turnControls: decl2.turnControls }, at);
    if (slug === DEFAULT_CHANNEL && (decl2.role ?? "conversation") !== "conversation")
      throw new Error(
        `${at} is declared role '${decl2.role}'. '${DEFAULT_CHANNEL}' is the channel every session has and the one a turn lands on by default, so it is always a conversation; declare another channel for the folio (R-C).`
      );
  }
}
var types = /* @__PURE__ */ new Map();
var DESCRIPTOR_DISPLAY_KEYS = { display: ["label"] };
function bandsMaterial(bands) {
  if (!bands || !Object.keys(bands).length) return void 0;
  return Object.fromEntries(
    Object.entries(bands).map(([k, v2]) => [k, typeof v2 === "string" ? v2 : v2.id]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  );
}
function bandPortsMaterial(bandPorts) {
  if (!bandPorts || !Object.keys(bandPorts).length) return void 0;
  return Object.fromEntries(
    Object.entries(bandPorts).map(([k, ports]) => [k, [...ports].sort()]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  );
}
function portSchemasMaterial(p) {
  if (!p?.out || !Object.keys(p.out).length) return void 0;
  return contractData({ out: p.out });
}
var contractData = (v2) => declarationData(v2, DESCRIPTOR_DISPLAY_KEYS);
var flag = (v2) => v2 === true ? true : void 0;
var portShapes = (ports) => Object.fromEntries(
  Object.entries(ports ?? {}).map(([k, v2]) => [
    k,
    typeof v2 === "string" ? v2 : v2?.id ?? void 0
  ])
);
function definitionContract(source) {
  const at = source.id.lastIndexOf("@");
  const pinned = at > 0 && /^\d+$/.test(source.id.slice(at + 1));
  const entryShape = source.entryShape && typeof source.entryShape === "object" ? {
    ...source.entryShape,
    ...source.configSchema !== void 0 ? { fields: source.configSchema } : {}
  } : void 0;
  return {
    id: pinned ? source.id.slice(0, at) : source.id,
    version: source.version ?? (pinned ? Number(source.id.slice(at + 1)) : 1),
    kind: source.kind,
    ports: { in: portShapes(source.ports?.in), out: portShapes(source.ports?.out) },
    slots: contractData(authoredSlots(source.slots)),
    effects: source.effects,
    review: source.review ? { fields: [...source.review.fields] } : void 0,
    shape: source.shape,
    optional: flag(source.optional),
    declaresRandomness: flag(source.declaresRandomness),
    scriptPoints: source.scriptPoints ? contractData(scriptPointsOf(source)) : void 0,
    sessionShape: contractData(source.sessionShape),
    earlyExit: flag(source.earlyExit),
    causesEvent: source.causesEvent,
    causesEventFrom: source.causesEventFrom,
    // Sorted: which payloads an inlet reads is a set, not a sequence.
    payloads: source.payloads?.length ? [...source.payloads].sort() : void 0,
    liveRow: flag(source.liveRow),
    media: contractData(source.media),
    entryShape: contractData(entryShape),
    // Contract that rides the row's policy (owner ruling 2026-09-27): a
    // descriptor's own field, else the row's policy spelling — one hash.
    bands: bandsMaterial(source.bands ?? source.policy?.bands ?? void 0),
    bandPorts: bandPortsMaterial(source.bandPorts ?? source.policy?.bandPorts ?? void 0),
    portSchemas: portSchemasMaterial(source.portSchemas ?? source.policy?.portSchemas ?? void 0),
    semantics: source.semantics
  };
}
function definitionContractHash(source) {
  return contentHash(definitionContract(source));
}
function register(d) {
  const existing = types.get(d.id);
  if (existing)
    refuseUnlessSameHash(
      definitionContractHash(existing),
      definitionContractHash(d),
      `duplicate type id: ${d.id}`
    );
  checkWritePublishes(d);
  checkNoAuthoredSettings(d);
  checkNoSettingsPort(d);
  checkScriptPointsAccept(d);
  checkCausesEvent(d);
  checkNoAmbientExtras(d);
  checkModeTitled(d);
  checkDisplayText(d);
  checkBandDeclarations(d, types.values());
  assertMessageVerbFloors(d.sessionShape, d.id);
  assertSessionWrites(d.sessionShape, d.id);
  assertTurnControls(d.sessionShape, d.id);
  assertChannelDecls(d.sessionShape, d.id);
  const reviewFinding = reviewFieldsFinding(d);
  if (reviewFinding) registrationFindings.set(d.id, [reviewFinding]);
  else registrationFindings.delete(d.id);
  types.set(d.id, d);
  return d;
}
var AMBIENT_SCRIPT_EXTRAS = ["session"];
function checkNoAmbientExtras(d) {
  for (const [name, slot] of Object.entries(d.slots ?? {})) {
    const listed = slot.extras ?? [];
    const ambient = listed.filter((e) => AMBIENT_SCRIPT_EXTRAS.includes(e));
    if (ambient.length)
      throw new Error(
        `${d.id}: slot '${name}' lists ${ambient.map((e) => `'${e}'`).join(", ")} in its extras \u2014 every script site is handed ${AMBIENT_SCRIPT_EXTRAS.map((e) => `'${e}'`).join(", ")} already (R32); drop it from the list`
      );
  }
}
var portLine = (ports) => Object.entries(ports ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v2]) => `${k}: ${String(v2)}`).join(", ");
var slotLine = (slots) => Object.keys(authoredSlots(slots) ?? {}).sort().join(", ");
function swapFitFinding(key, pinned, swap) {
  if (swap.provisional)
    return `'${swap.id}' cannot stand in for '${key}': it is provisional \u2014 declared, with no handler to run`;
  const usesConnection = Object.values(pinned.slots ?? {}).some(
    (slot) => slot?.kind === "connection"
  );
  if (usesConnection && !swap.id.startsWith("core:"))
    return `'${swap.id}' cannot stand in for '${key}': that node uses a connection, and a plugin's code never touches connection data or calls a model (R53) \u2014 shape the core node with prompts or a config instead` + pluginRuleRef("connections");
  const want = `a ${pinned.kind} with in { ${portLine(pinned.ports?.in)} } \u2192 out { ${portLine(pinned.ports?.out)} } and slots [${slotLine(pinned.slots)}]`;
  const got = `a ${swap.kind} with in { ${portLine(swap.ports?.in)} } \u2192 out { ${portLine(swap.ports?.out)} } and slots [${slotLine(swap.slots)}]`;
  return want === got ? void 0 : `'${swap.id}' cannot stand in for '${key}': a swap must match the pin's kind, ports and slots \u2014 ${want}; it is ${got}`;
}
function eventsLockFindings(inlet, events) {
  const reads = inlet.payloads ?? [];
  if (!reads.length)
    return [
      `'${inlet.id}' declares no payloads, so it answers one event: { genre, event }. A spec answering several events uses an inlet that reads them all \u2014 core:inlet/session-event@1 (PLAN-turn-order \xA74.14)`
    ];
  const out = [];
  for (const e of events) {
    const shape = eventById(e)?.payload;
    if (!eventById(e)) continue;
    if (!shape)
      out.push(
        `'${e}' carries no payload, so it cannot share an inlet with other events \u2014 lock it alone: { genre, event }`
      );
    else if (!reads.includes(shape))
      out.push(
        `'${inlet.id}' does not read '${shape}', the payload of '${e}' \u2014 it reads ${reads.map((r) => `'${r}'`).join(", ")}`
      );
  }
  return out;
}
function checkCausesEvent(d) {
  if (d.causesEventFrom !== void 0) {
    if (d.kind !== "outlet" || d.effects !== "write")
      throw new Error(`'${d.id}' declares causesEventFrom \u2014 only a write outlet causes an event`);
    if (d.causesEvent)
      throw new Error(`'${d.id}' declares both causesEvent and causesEventFrom \u2014 one says which event, not both`);
    if (!d.ports.in?.[d.causesEventFrom])
      throw new Error(`'${d.id}' names causesEventFrom '${d.causesEventFrom}', which is not one of its in-ports`);
    return;
  }
  if (!d.causesEvent) return;
  const event = eventById(d.causesEvent);
  if (!event) throw new Error(`${d.id}: ${notADeclaredEvent(d.causesEvent)}`);
  const base = d.id.replace(/@\d+$/, "");
  if (!event.causedBy?.includes(base))
    throw new Error(
      `'${d.id}' causes '${d.causesEvent}', but that event's causedBy does not name '${base}'. causedBy is the one statement of what causes what \u2014 add '${base}' there, or drop causesEvent (R33)`
    );
}
function checkWritePublishes(d) {
  if (d.effects !== "write") return;
  const bad = Object.entries(d.ports?.out ?? {}).filter(
    ([, s]) => shapeIdOf(s) === "core:shape/row-ids@1"
  );
  if (!bad.length) return;
  throw new Error(
    `${d.id} declares effects: 'write' but publishes core:shape/row-ids@1 on ${bad.map(([k]) => `'${k}'`).join(", ")}. A gate-eligible write publishes core:shape/write-result@1 \u2014 pending under async review, committed otherwise \u2014 so a downstream port wanting raw ids fails at publish instead of writing a foreign key that dangles when the reviewer rejects (13 \xA77j-b).`
  );
}
function checkNoAuthoredSettings(d) {
  if (!d.slots) return;
  if ("settings" in d.slots)
    throw new Error(
      `${d.id} declares a slot named 'settings'. That name is reserved for the substrate's own slot \u2014 \`enabled\` on an optional node, \`review\` on a gated one \u2014 which the registry projection declares and the executor reads. Name the slot for what it holds ('parameters' for tunables).`
    );
  const byKind = Object.entries(d.slots).find(([, decl2]) => decl2?.kind === "settings");
  if (byKind)
    throw new Error(
      `${d.id} declares slot '${byKind[0]}' with kind 'settings'. That kind is the substrate's \u2014 derived from \`optional\` and \`effects\`, never authored. Declare 'parameters' for tunables.`
    );
}
function checkNoSettingsPort(d) {
  for (const port of Object.keys(d.ports?.out ?? {})) {
    const heard = settingsTravelVerdict.judge({ kind: "port", definitionId: d.id, port });
    if (!heard.ok) throw new Error(refusalText(heard));
  }
}
function checkScriptPointsAccept(d) {
  for (const p of d.scriptPoints ?? []) {
    const point = p;
    const key = typeof point === "string" ? point : String(point?.key);
    const accepts = typeof point === "string" ? void 0 : point?.accepts;
    if (!Array.isArray(accepts) || accepts.length === 0)
      throw new Error(
        `${d.id} declares script point '${key}' accepting no script kind. A point is { key, accepts, label } \u2014 list the kinds it takes (e.g. ['core:script:text/transform@1']); a point that accepts nothing is a hook nothing can attach to.`
      );
  }
}
var shapeIdOf = (s) => typeof s === "string" ? s : s?.id ?? void 0;
var hasDisplayText = (v2) => isI18n(v2);
function checkModeTitled(d) {
  if (d.kind !== "inlet" || !d.sessionShape) return;
  if (hasDisplayText(d.i18n?.name)) return;
  throw new Error(
    `${d.id} declares a sessionShape but no i18n.name. A shape-bearing input type is a session mode, and the New Session picker renders every mode as a card \u2014 give it a title: i18n: { name: { en: '\u2026' } }. Add a description there too; the packager warns when a mode ships without one.`
  );
}
function checkDisplayText(d) {
  const findings = [];
  findings.push(...i18nFindings(d.i18n?.name, `${d.id} i18n.name`));
  findings.push(...i18nFindings(d.i18n?.description, `${d.id} i18n.description`));
  for (const [slotName, slot] of Object.entries(d.slots ?? {})) {
    if (!slot) continue;
    const at = `${d.id} slots.${slotName}`;
    findings.push(...i18nFindings(slot.description, `${at}.description`));
    for (const [field, decl2] of Object.entries(slot.fields ?? {}))
      findings.push(...i18nFindings(decl2?.i18n, `${at}.fields.${field}.i18n`));
    findings.push(...settingsSchemaFindings(slot.schema, `${at}.schema`));
  }
  for (const p of d.scriptPoints ?? []) {
    const at = `${d.id} scriptPoints[${String(p.key)}]`;
    findings.push(...i18nFindings(p.label, `${at}.label`));
    findings.push(...i18nFindings(p.description, `${at}.description`));
  }
  if (d.sessionShape) {
    findings.push(...settingsSchemaFindings(d.sessionShape.fields, `${d.id} sessionShape.fields`));
    findings.push(...widgetDeclsFindings(d.sessionShape.panels, `${d.id} sessionShape.panels`));
  }
  if (d.entryShape)
    findings.push(...settingsSchemaFindings(d.entryShape.fields, `${d.id} entryShape.fields`));
  if (findings.length)
    throw new Error(
      `${d.id} declares display text a publish refuses (R-20):
 \xB7 ${findings.join("\n \xB7 ")}`
    );
}
function widgetDeclsFindings(raw, where) {
  if (raw === void 0) return [];
  if (!Array.isArray(raw)) return [`${where}: the widgets are an array of declarations`];
  const out = [];
  raw.forEach((w, i) => {
    const decl2 = w;
    const at = `${where}[${typeof decl2?.id === "string" ? decl2.id : i}]`;
    if (!decl2 || typeof decl2 !== "object") {
      out.push(`${at}: a widget declaration is an object \u2014 { id, title, component }`);
      return;
    }
    out.push(...i18nFindings(decl2.title, `${at}.title`, { required: true }));
    out.push(...settingsSchemaFindings(decl2.settings, `${at}.settings`));
    out.push(...widgetReadsFindings(decl2.reads, `${at}.reads`));
    if (decl2.surface !== void 0)
      out.push(`${at}.surface: gone \u2014 give \`component\`, and place an \`sp-frame\` inside it for a document`);
    else if (decl2.component === void 0)
      out.push(`${at}: names nothing to render \u2014 give \`component\`, a component's slug`);
    else if (typeof decl2.component !== "string" || !decl2.component)
      out.push(`${at}.component: a component's slug`);
  });
  return out;
}
function getDefinition(id) {
  return types.get(id);
}
var describeTaskDefinition = (d) => register({ ...d, kind: "task" });
function pin(descriptor) {
  const version = /@(\d+)$/.exec(descriptor.id)?.[1] ?? "1";
  const ctor = (config2 = {}) => ({
    __node: true,
    descriptor,
    config: config2
  });
  return { [`v${version}`]: ctor, id: descriptor.id, descriptor };
}

// ../serene-pub-sdk/sdk/src/refs.ts
function $ref(node, port = "main") {
  return { __ref: "data", node, port };
}
var isDataRef = (v2) => typeof v2 === "object" && v2 !== null && v2.__ref === "data";
var isSlotRef = (v2) => typeof v2 === "object" && v2 !== null && v2.__ref === "slot";

// ../serene-pub-sdk/sdk/src/scope.ts
var REF_KEYS = /* @__PURE__ */ new Set(["__ref", "node", "port"]);
function refAccessor(node, port = "main") {
  const target = $ref(node, port);
  return new Proxy(target, {
    get(t, prop, recv) {
      if (typeof prop !== "string") return Reflect.get(t, prop, recv);
      if (REF_KEYS.has(prop) || prop === "toJSON" || prop === "then")
        return Reflect.get(t, prop, recv);
      if (prop in Object.prototype) return Reflect.get(t, prop, recv);
      if (port !== "main") {
        throw new Error(
          `'${node}.${port}.${prop}' \u2014 ports are flat, so a ref cannot be refined twice. Reference the port you want directly, or reach inside the payload in the node's own hook.`
        );
      }
      return refAccessor(node, prop);
    }
  });
}
function makeScope(knownKeys, localPrefix, clauseId) {
  const resolveKey = (joined) => {
    if (localPrefix && knownKeys.has(`${localPrefix}.${joined}`))
      return `${localPrefix}.${joined}`;
    return knownKeys.has(joined) ? joined : void 0;
  };
  const isPrefix = (joined) => [...knownKeys].some(
    (k) => k.startsWith(`${joined}.`) || !!localPrefix && k.startsWith(`${localPrefix}.${joined}.`)
  );
  const walk = (path) => {
    const joined = path.join(".");
    const selfKey = joined ? resolveKey(joined) : void 0;
    const itemKey = !selfKey && clauseId && joined === `${clauseId}.item` ? `${clauseId}.${ITEM}` : void 0;
    const target = selfKey ? $ref(selfKey, "main") : itemKey ? $ref(itemKey, "main") : /* @__PURE__ */ Object.create(null);
    return new Proxy(target, {
      get(t, prop, recv) {
        if (typeof prop !== "string") return Reflect.get(t, prop, recv);
        if (REF_KEYS.has(prop) || prop === "toJSON" || prop === "then")
          return Reflect.get(t, prop, recv);
        if (prop in Object.prototype) return Reflect.get(t, prop, recv);
        if (prop === ITEM && clauseId && path.length === 0)
          return refAccessor(`${clauseId}.${ITEM}`);
        const next = [...path, prop];
        const nextJoined = next.join(".");
        if (resolveKey(nextJoined) || isPrefix(nextJoined) || clauseId && nextJoined === `${clauseId}.item`)
          return walk(next);
        if (selfKey) return refAccessor(selfKey, prop);
        throw new Error(
          `'${nextJoined}' is not a node declared before this point.` + (knownKeys.size ? ` Available: ${[...knownKeys].join(", ")}.` : " No nodes are declared yet \u2014 the Input comes first (01 \xA72).") + ` Pipelines have no back-edges (F9), so a node cannot reference one declared later.`
        );
      }
    });
  };
  return walk([]);
}
var ITEM = "$item";

// ../serene-pub-sdk/sdk/src/identity.ts
var SLUG_PART = /^[a-z0-9]+([./-][a-z0-9]+)*$/;
function parseSpecId(id) {
  const withoutPin = id.replace(/@\d+$/, "");
  const i = withoutPin.indexOf(":");
  if (i === -1) return { slug: withoutPin };
  return { owner: withoutPin.slice(0, i), slug: withoutPin.slice(i + 1) };
}
function assertSpecId(id) {
  const { owner, slug } = parseSpecId(id);
  if (!SLUG_PART.test(slug) || owner !== void 0 && !SLUG_PART.test(owner)) {
    throw new Error(
      `'${id}' is not a valid spec id. Use 'owner:slug' \u2014 'chariot.rp:chat', 'core:chat-turn' \u2014 or a bare slug for a hand-imported document. Lowercase, digits, hyphens and dots only. The **semver** goes in meta.version, never in the id: a spec upgrades by version, and an id that carries one cannot be matched across upgrades.`
    );
  }
}
var CORE_ACTION_SPEC_ID = "core";
var ACTION_IDENTITY = /^[a-z0-9:./-]+#[a-z0-9-]+$/;
var ACTION_IDENTITY_MAX_LENGTH = 200;
function isActionIdentity(v2) {
  return typeof v2 === "string" && v2.length <= ACTION_IDENTITY_MAX_LENGTH && ACTION_IDENTITY.test(v2);
}

// ../serene-pub-sdk/sdk/src/attributes.ts
var SLOT_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*:slot\/[a-z0-9]+(?:-[a-z0-9]+)*@\d+$/;
function assertSlotId(id) {
  if (!SLOT_ID.test(id))
    throw new Error(
      `'${id}' is not a valid attribute slot id. Use 'owner:slot/name@N' \u2014 'core:slot/hp@1', 'acme.rp:slot/tension@1'. The id is what a stored value is filed under for the life of the card that carries it; the display name lives in the declaration.`
    );
}
var derivations = Object.freeze({
  /**
   * How old someone is: a `birthdate` value on the same owner, against the
   * session's story date. Absent — not zero — when either is missing, which
   * is the whole reason age is derived and not typed in.
   */
  age: Object.freeze({
    id: "core:derive/age@1",
    requiresFrom: true,
    description: "A birthdate slot on the same owner, read against the session's story date."
  }),
  /**
   * A LiquidJS expression written on the declaration itself (`derive`),
   * evaluated over the state pinned at run start.
   *
   * It earns an id even though the *text* is the author's, because a derived
   * slot always names the computation behind it: a receipt says which one
   * produced a number, and "an expression" is an answer only if it is one
   * declared thing rather than a hole in the set. What the author supplies is
   * the expression; the evaluator is still core's.
   *
   * `requiresFrom: false` — the expression names whatever it reads, which is
   * exactly the reason it is not `age`.
   */
  liquid: Object.freeze({
    id: "core:derive/liquid@1",
    requiresFrom: false,
    description: "A LiquidJS expression on the declaration, evaluated over the state pinned at run start."
  })
});
var SLOT_EARSHOTS = Object.freeze(["all", "holder"]);

// ../serene-pub-sdk/sdk/src/genres.ts
var GENRE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*:genre\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
function assertGenreId(id) {
  if (!GENRE_ID.test(id))
    throw new Error(
      `'${id}' is not a valid genre id. Use 'owner:genre/name' \u2014 'core:genre/chat', 'acme.rp:genre/mystery'. The id is an address sessions hold for their lifetime; the display name lives in the declaration.`
    );
}
var sessionEvents = Object.freeze({
  /** The create slot — required; exactly one pipeline per genre declares it. */
  sessionCreated: "core:event/session-created@1",
  /** The primary turn. A swipe is this pipeline re-run, not a new event. */
  messageRespond: "core:event/message-respond@1",
  /** Arbitrary buttons/triggers — the existing functions surface (19 §3). */
  sessionAction: "core:event/session-action@1",
  /** A character or persona joined; payload carries the kind. */
  memberAdded: "core:event/member-added@1",
  /** A character or persona left; payload carries the kind. */
  memberRemoved: "core:event/member-removed@1",
  /**
   * A form in a message was addressed to a participant the AI portrays
   * (R-15 *Forms*; U5d). Optional in every genre's surface: a genre that
   * binds nothing leaves such a form waiting, as it would for a person.
   */
  formAddressed: "core:event/form-addressed@1",
  // ── Turn order as event-driven state (PLAN-turn-order §4.1, 2026-09-21) ──
  // The events a genre may bind its turn-order spec to. A genre that
  // binds the spec lists every event it binds it to, all optional (`{}`).
  /** A row that is not generating landed — a send, a greeting, a finished or stopped reply. */
  messageCompleted: "core:event/message-completed@1",
  /** A person rewrote a settled message. */
  messageEdited: "core:event/message-edited@1",
  /** A message was deleted. */
  messageDeleted: "core:event/message-deleted@1",
  /** A message was hidden from the prompt, or shown again. */
  messageHidden: "core:event/message-hidden@1",
  /** A line's shown sprite changed — a picker's choice or a person's (DESIGN-sprites). */
  spriteShown: "core:event/sprite-shown@1",
  /** A seated participant's row changed — active, position, visibility or portrayal. */
  castChanged: "core:event/cast-changed@1",
  /** `sessions:update` landed — name, scenario, lorebook, genre fields, preset, channels, tags. */
  sessionUpdated: "core:event/session-updated@1",
  /** A session was branched at a message into a new session; recorded on the branch. */
  sessionBranched: "core:event/session-branched@1",
  /**
   * A pipeline's annex entry changed — "my state changed". Caused by
   * `core:outlet/set-session-annex@1`; the payload names the owner.
   */
  annexChanged: "core:event/annex-changed@1",
  /**
   * `metadata.turnOrder` was written. **For typing only**: core-internal,
   * read by the auto-advance listener and the `sessions:turnOrder` push;
   * `genre()` refuses it in `events`, so no preset can bind it.
   */
  turnOrderChanged: "core:event/turn-order-changed@1"
});
var TURN_ORDER_CHANGED_IS_INTERNAL = `'${sessionEvents.turnOrderChanged}' is core-internal \u2014 the auto-advance listener and the turn-order push read it, and a pipeline bound to it would recompute the order it was told about. Bind '${sessionEvents.messageCompleted}' and the other session events instead.`;
var UNCLAIMED_LINE_NAME = Object.freeze({ en: "Narrator" });
var ENVOY_KEY = /^[a-z][a-z0-9-]*$/;
var ENVOY_IMAGE = /^(?:https?:\/\/\S+|data:image\/[a-z0-9.+-]+(?:;[^,]*)?,.+)$/i;
var ENVOY_SPEAKS = /* @__PURE__ */ new Set(["in-turn", "on-action"]);
function envoyFindings(raw, at, owner = "genre") {
  const out = [];
  if (!raw || typeof raw !== "object") return [`${at}: an envoy is an object \u2014 got ${typeof raw}`];
  const e = raw;
  const where = `${at}[${typeof e.key === "string" ? e.key : "?"}]`;
  if (typeof e.key !== "string" || !ENVOY_KEY.test(e.key))
    out.push(
      `${where}: 'key' is required \u2014 a lowercase kebab token (${ENVOY_KEY.source}); an action's envoy is namespaced by the host, never by the key`
    );
  out.push(...i18nFindings(e.name, `${where}.name`, { required: true }));
  out.push(...i18nFindings(e.description, `${where}.description`));
  if (e.image !== void 0 && (typeof e.image !== "string" || !ENVOY_IMAGE.test(e.image)))
    out.push(
      `${where}: 'image' is an http(s):// URL or a data:image/\u2026 URI \u2014 an <img> source and nothing else`
    );
  if (e.prompts !== void 0) {
    if (!e.prompts || typeof e.prompts !== "object")
      out.push(`${where}: 'prompts' is { systemPrompt?, postHistoryInstructions? }`);
    else
      for (const [k, v2] of Object.entries(e.prompts))
        if (typeof v2 !== "string")
          out.push(`${where}: prompts.${k} is a string \u2014 the authored text`);
  }
  if (e.default !== void 0 && typeof e.default !== "boolean")
    out.push(`${where}: 'default' is a boolean`);
  if (e.fallback !== void 0) {
    if (typeof e.fallback !== "boolean") out.push(`${where}: 'fallback' is a boolean`);
    else if (owner === "action" && e.fallback)
      out.push(
        `${where}: an action's envoy cannot be the fallback \u2014 it speaks for its action only; declare the fallback on the genre's envoys`
      );
  }
  if (e.greeting !== void 0) {
    const g = e.greeting;
    if (owner === "action")
      out.push(
        `${where}: an action's envoy cannot declare a greeting \u2014 it speaks for its action only; declare the greeting on the genre's envoy (R6)`
      );
    else if (!g || typeof g !== "object" || Array.isArray(g))
      out.push(`${where}: 'greeting' is { text, channel? } \u2014 the line this envoy opens a new session with`);
    else {
      out.push(...i18nFindings(g.text, `${where}.greeting.text`, { required: true }));
      if (g.channel !== void 0 && (typeof g.channel !== "string" || !g.channel.trim()))
        out.push(`${where}: greeting.channel is a channel slug the genre declares \u2014 'main' when absent`);
    }
  }
  if (e.speaks !== void 0) {
    if (!ENVOY_SPEAKS.has(e.speaks))
      out.push(`${where}: 'speaks' is 'in-turn' or 'on-action' (R-21 (6))`);
    else if (owner === "action" && e.speaks !== "on-action")
      out.push(
        `${where}: an action's envoy speaks 'on-action' only \u2014 it is the speaker the action's results post as, never a turn-taking candidate (R-21 (6))`
      );
  }
  return out;
}
function envoysFindings(raw, at = "envoys", channels) {
  if (raw === void 0) return [];
  if (!Array.isArray(raw)) return [`${at}: a genre's envoys are an array`];
  const out = [];
  const keys = /* @__PURE__ */ new Map();
  let defaults = 0;
  const fallbacks = [];
  raw.forEach((e, i) => {
    out.push(...envoyFindings(e, at, "genre"));
    const key = e?.key;
    if (typeof key === "string") keys.set(key, (keys.get(key) ?? 0) + 1);
    if (e?.default === true) defaults++;
    if (e?.fallback === true) fallbacks.push(typeof key === "string" ? key : "?");
    const lands = e?.greeting?.channel;
    if (channels && typeof lands === "string" && lands.trim() && !channels.includes(lands.trim()))
      out.push(
        `${at}[${typeof key === "string" ? key : "?"}]: greeting.channel '${lands}' is not a channel this genre declares \u2014 it declares ${channels.map((c) => `'${c}'`).join(", ")} (R6)`
      );
    void i;
  });
  if (fallbacks.length > 1)
    out.push(
      `${at}: ${fallbacks.map((k) => `'${k}'`).join(", ")} are all 'fallback: true' \u2014 a line nobody claims posts as one envoy; mark one`
    );
  for (const [key, n] of keys)
    if (n > 1) out.push(`${at}: the key '${key}' is declared ${n} times \u2014 an envoy's key is unique within its genre`);
  if (defaults > 1)
    out.push(
      `${at}: ${defaults} envoys are 'default: true' \u2014 at most one is seated with no choice; the rest are offered`
    );
  return out;
}
function normalizeEnvoy(raw, speaks) {
  return Object.freeze({ ...raw, speaks });
}
function genreEnabledWhenFindings(raw, at = "enabledWhen") {
  if (raw === void 0) return [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return [
      `${at}: a genre's enabled-when defaults are an object keyed by action identity \u2014 { 'core:spec/look#look': { on: 'state.world.location', truthy: true, reason: { en: '\u2026' } } }`
    ];
  const out = [];
  for (const [id, decl2] of Object.entries(raw)) {
    if (!isActionIdentity(id))
      out.push(
        `${at}: a default is keyed by the identity of the action it applies to \u2014 '<spec slug>#<key>', or 'core#<verb>' for a message verb \u2014 got '${id}'`
      );
    out.push(...enabledWhenFindings(decl2, `${at}[${id}]`));
  }
  return out;
}
function assertEnabledWhen(decl2, genreId) {
  if (!decl2) return void 0;
  const findings = genreEnabledWhenFindings(decl2, `${genreId}.enabledWhen`);
  if (findings.length) throw new Error(findings.join("\n"));
  const out = {};
  for (const [fn, v2] of Object.entries(decl2)) out[fn] = Object.freeze(normalizeEnabledWhen(v2));
  return Object.freeze(out);
}
function genreDisplayTextFindings(props, at) {
  const out = [];
  out.push(...i18nFindings(props.name, `${at}.name`, { required: true }));
  out.push(...i18nFindings(props.description, `${at}.description`));
  if (props.shape) {
    out.push(...settingsSchemaFindings(props.shape.fields, `${at}.shape.fields`));
    out.push(...widgetDeclsFindings(props.shape.panels, `${at}.shape.panels`));
  }
  for (const slot of props.slots ?? []) {
    out.push(...i18nFindings(slot.label, `${at}.slots[${slot.id}].label`));
    out.push(...i18nFindings(slot.description, `${at}.slots[${slot.id}].description`));
  }
  for (const sheet of props.sheets ?? []) {
    out.push(...i18nFindings(sheet.label, `${at}.sheets[${sheet.id}].label`, { required: true }));
    out.push(...i18nFindings(sheet.description, `${at}.sheets[${sheet.id}].description`));
  }
  return out;
}
function assertDisplayText(props, genreId) {
  const findings = genreDisplayTextFindings(props, genreId);
  if (findings.length) throw new Error(findings.join("\n"));
}
function assertPlayerLabel(props, genreId) {
  if (props.playerLabel === void 0) return void 0;
  const findings = i18nFindings(props.playerLabel, `${genreId}.playerLabel`);
  if (findings.length) throw new Error(findings.join("\n"));
  if ((props.shape?.personas?.min ?? 0) >= 1)
    throw new Error(
      `${genreId}.playerLabel: this genre requires a persona (shape.personas.min \u2265 1), so a persona always names the person's line and no line would ever carry the label \u2014 drop playerLabel, or let the genre run without a persona`
    );
  return Object.freeze({ ...localeMapOf(props.playerLabel) });
}
function assertEnvoys(envoys, genreId, shape) {
  if (!envoys) return [];
  const findings = envoysFindings(
    envoys,
    `${genreId}.envoys`,
    channelDecls(shape).map((c) => c.slug)
  );
  if (findings.length) throw new Error(findings.join("\n"));
  return envoys.map((e) => normalizeEnvoy(e, e.speaks ?? "in-turn"));
}
var CONVERSATION_WIDGET_ID = "messages";
function assertGenreWidgets(props, id) {
  const problems = [];
  const omitWidgets = [];
  for (const w of props.omitWidgets ?? []) {
    if (typeof w === "string") {
      problems.push(`${id} omitWidgets: '${w}' is a string \u2014 name the widget value (coreWidgets.x, or the package's widget)`);
      continue;
    }
    try {
      omitWidgets.push(widgetRef(w));
    } catch (e) {
      problems.push(`${id} omitWidgets: ${e.message}`);
    }
  }
  const layouts = [...props.layouts ?? []];
  if (layouts.length && layouts[0].slug !== "default")
    problems.push(`${id} layouts: the first is the genre's default \u2014 give it slug 'default' (it is '${layouts[0].slug}')`);
  const slugs = /* @__PURE__ */ new Set();
  for (const l of layouts) {
    if (slugs.has(l.slug)) problems.push(`${id} layouts: two layouts are '${l.slug}' \u2014 a slug names one`);
    slugs.add(l.slug);
    for (const w of layoutWidgetIds(l.preset))
      if (omitWidgets.includes(widgetOfInstance(w)))
        problems.push(`${id} layout '${l.slug}' places '${w}', which the genre omits`);
  }
  if (omitWidgets.includes(CONVERSATION_WIDGET_ID)) {
    const first = layouts[0];
    if (!first || !drawnWidgetIds(first.preset).length)
      problems.push(
        `${id} omits the conversation \u2014 ship a layout (layouts: [layout({ \u2026 })]) that places the widget that takes its place (its role: 'primary' widget), in any zone`
      );
  }
  if (problems.length) throw new Error(problems.join("\n"));
  return { omitWidgets: [...new Set(omitWidgets)], layouts };
}
function genre(id, props) {
  assertGenreId(id);
  assertMessageVerbFloors(props.shape, id);
  assertSessionWrites(props.shape, id);
  assertTurnControls(props.shape, id);
  assertChannelDecls(props.shape, id);
  const events = { ...props.events ?? {} };
  if (sessionEvents.turnOrderChanged in events)
    throw new Error(`${id} lists it in its events: ${TURN_ORDER_CHANGED_IS_INTERNAL}`);
  for (const event of Object.keys(events)) {
    if (!eventById(event)) throw new Error(`${id}: ${notADeclaredEvent(event)}`);
    if (!event.startsWith("core:"))
      throw new Error(
        `${id} lists '${event}', a package's event \u2014 add it to the genre from defineExtension({ events: [{ event, genre, recordedBy }] }), which also says who may record it`
      );
  }
  events[sessionEvents.sessionCreated] = {
    ...events[sessionEvents.sessionCreated] ?? {},
    required: true
  };
  assertDisplayText(props, id);
  const envoys = assertEnvoys(props.envoys, id, props.shape);
  const enabledWhen = assertEnabledWhen(props.enabledWhen, id);
  const { omitWidgets, layouts } = assertGenreWidgets(props, id);
  if (props.customAttributes !== void 0 && props.customAttributes !== "allow" && props.customAttributes !== "deny")
    throw new Error(`${id}.customAttributes: 'allow' or 'deny' \u2014 not ${JSON.stringify(props.customAttributes)}`);
  const playerLabel = assertPlayerLabel(props, id);
  const decl2 = Object.freeze({
    id,
    name: props.name,
    family: props.family,
    description: props.description,
    shape: props.shape,
    events: Object.freeze(events),
    slots: props.slots ? Object.freeze([...props.slots]) : void 0,
    sheets: props.sheets ? Object.freeze([...props.sheets]) : void 0,
    // Absent unless allowed, so a genre that denies (or says nothing) hashes as it did.
    ...props.customAttributes === "allow" ? { customAttributes: "allow" } : {},
    ...envoys.length ? { envoys: Object.freeze(envoys) } : {},
    // R4: absent when unstated, so a genre that says nothing hashes as it did.
    ...playerLabel ? { playerLabel } : {},
    ...enabledWhen && Object.keys(enabledWhen).length ? { enabledWhen } : {},
    // The pinned settings (§4.13): copied when stated, frozen like the
    // rest, absent otherwise — so an unpinned genre hashes as it did.
    ...props.settings && Object.keys(props.settings).length ? { settings: Object.freeze({ ...props.settings }) } : {},
    // R71: absent when unstated, so a genre that says nothing hashes as it did.
    ...omitWidgets.length ? { omitWidgets: Object.freeze(omitWidgets) } : {},
    ...layouts.length ? { layouts: Object.freeze(layouts) } : {}
  });
  const existing = registry3.get(id);
  if (existing)
    refuseUnlessIdentical(existing, decl2, `duplicate genre id: ${id}`, GENRE_DISPLAY_KEYS);
  registry3.set(id, decl2);
  return decl2;
}
var registry3 = /* @__PURE__ */ new Map();
var GENRE_DISPLAY_KEYS = { display: ["name", "description"] };
var genreIdOf = (g) => {
  const id = typeof g === "string" ? g : g.id;
  assertGenreId(id);
  return id;
};

// ../serene-pub-sdk/sdk/src/actions.ts
var ACTION_EFFECTS = ["fiction", "world"];
var TEXT_NEEDS = ["required", "optional"];
var COLLECTS_KEYS = ["text", "recipients"];
var COLLECTED_TEXT_KEYS = ["need", "label", "placeholder", "ifEmpty"];
var COLLECTED_RECIPIENTS_KEYS = ["label", "min", "max", "overwrites"];
var WORLD_ACTION_VENUES = ["composer", "message", "session-settings", "admin", "review"];
var WORLD_ACTION_ACTORS = ["owner", "admin"];
var VENUE_KINDS = [
  "composer",
  "message",
  "extra",
  "widget",
  "session-settings",
  "pipelines",
  "admin",
  "review",
  "form"
];
var LISTED_VENUE_KINDS = VENUE_KINDS.filter(
  (k) => k !== "form"
);
var DEFAULT_ACTION_AUDIENCE = Object.freeze({
  see: ["participant"],
  act: ["owner"]
});
var ITEM_AUDIENCE = Object.freeze({
  see: ["participant"],
  act: ["item"]
});
var BARE_SLASH = /^[a-z][a-z0-9-]*$/;
var NAMESPACED_SLASH = /^([a-z0-9]+(?:[.-][a-z0-9]+)*)\.([a-z][a-z0-9-]*)$/;
function specNamespace(specId) {
  const i = specId.indexOf(":");
  return i === -1 ? "" : specId.slice(0, i);
}
var isCoreNamespace = (ns) => ns === "core";
function slashNameOf(action, specId) {
  if (action.slash) return action.slash;
  const ns = specNamespace(specId);
  return isCoreNamespace(ns) || !ns ? action.key : `${ns}.${action.key}`;
}
var KEY = /^[a-z][a-z0-9-]*$/;
var EFFECTS_LINE_FIX = `move the action to a venue on the owner's side of the line (${WORLD_ACTION_VENUES.join(", ")}) and keep audience.act to ${WORLD_ACTION_ACTORS.join(" and/or ")} \u2014 or declare effects: 'fiction' if its result stays inside the story`;
function worldActionCrossing(input) {
  if (input.effects !== "world") return { ok: true };
  if (input.kind === "venue") {
    const kind = input.venue;
    if (typeof kind !== "string" || WORLD_ACTION_VENUES.includes(kind)) return { ok: true };
    return {
      ok: false,
      sentence: `${input.where}: a 'world' action may not appear in the '${kind}' venue \u2014 its result reaches outside the fiction (cards, lore, settings, permissions), so it belongs in ${WORLD_ACTION_VENUES.join(", ")} and never where a character could be asked to answer it (the effects line, R-15)`,
      fix: EFFECTS_LINE_FIX
    };
  }
  if (WORLD_ACTION_ACTORS.includes(String(input.ref))) return { ok: true };
  return {
    ok: false,
    sentence: `${input.where}: a 'world' action's audience.act names '${String(input.ref)}' \u2014 an out-of-fiction effect is the owner's (or an administrator's) to invoke, never a participant's or a character's (the effects line, R-15)`,
    fix: EFFECTS_LINE_FIX
  };
}
function collectsFindings(raw, where) {
  const out = [];
  const unknownKeys = (o, known, at) => {
    for (const k of Object.keys(o))
      if (!known.includes(k))
        out.push(`${at}: '${k}' is not something an action collects here \u2014 one of ${known.join(", ")}`);
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return [`${where} is { text?, recipients? } \u2014 what the press asks for before it fires`];
  const c = raw;
  unknownKeys(c, COLLECTS_KEYS, where);
  if (c.text !== void 0) {
    const at = `${where}.text`;
    const t = c.text;
    if (!t || typeof t !== "object" || Array.isArray(t))
      out.push(`${at} is { need, label, placeholder?, ifEmpty? } \u2014 the text the modal asks for`);
    else {
      unknownKeys(t, COLLECTED_TEXT_KEYS, at);
      if (!TEXT_NEEDS.includes(t.need))
        out.push(
          `${at}.need is one of ${TEXT_NEEDS.join(", ")} \u2014 whether the press fires without any text`
        );
      out.push(...i18nFindings(t.label, `${at}.label`, { required: true }));
      out.push(...i18nFindings(t.placeholder, `${at}.placeholder`));
      if (t.need === "optional" && t.ifEmpty === void 0)
        out.push(
          `${at}.ifEmpty is required when need is 'optional' \u2014 one sentence saying what an empty submit does ('The room decides.')`
        );
      else out.push(...i18nFindings(t.ifEmpty, `${at}.ifEmpty`));
    }
  }
  if (c.recipients !== void 0) {
    const at = `${where}.recipients`;
    const r = c.recipients;
    if (!r || typeof r !== "object" || Array.isArray(r))
      out.push(`${at} is { label, min?, max?, overwrites? } \u2014 the cast members the modal asks for`);
    else {
      unknownKeys(r, COLLECTED_RECIPIENTS_KEYS, at);
      out.push(...i18nFindings(r.label, `${at}.label`, { required: true }));
      const count = (v2) => typeof v2 === "number" && Number.isInteger(v2);
      if (r.min !== void 0 && (!count(r.min) || r.min < 1))
        out.push(`${at}.min is a whole number, 1 or more \u2014 the fewest who may be picked`);
      if (r.max !== void 0) {
        const min = count(r.min) ? r.min : 1;
        if (!count(r.max) || r.max < min)
          out.push(`${at}.max is a whole number no smaller than min (${min}) \u2014 the most who may be picked`);
      }
      if (r.overwrites !== void 0) {
        try {
          if (typeof r.overwrites !== "string") throw new Error("not a string");
          assertSlotId(r.overwrites);
        } catch {
          out.push(
            `${at}.overwrites is a slot id ('core:slot/whisper@1') \u2014 the per-cast slot the action writes on each recipient`
          );
        }
      }
    }
  }
  if (c.text === void 0 && c.recipients === void 0 && !out.length)
    out.push(`${where} collects nothing \u2014 declare text, recipients, or leave collects out`);
  return out;
}
function actionFindings(raw, specId, at = "contributes.actions") {
  return actionFindingsByLaw(raw, specId, at).map((f) => f.message);
}
function actionFindingsByLaw(raw, specId, at = "contributes.actions") {
  const out = [];
  const shape = (...messages) => {
    for (const message of messages) out.push({ law: "R-15", message });
  };
  const line = (heard) => {
    if (!heard.ok) out.push({ law: "F41", message: i18nText(heard.sentence), fix: i18nText(heard.fix) });
  };
  if (!raw || typeof raw !== "object")
    return [{ law: "R-15", message: `${at}: an action is an object \u2014 got ${typeof raw}` }];
  const a = raw;
  const where = `${at}[${typeof a.key === "string" ? a.key : "?"}]`;
  if (typeof a.key !== "string" || !KEY.test(a.key))
    shape(`${where}: 'key' is required \u2014 a lowercase kebab token (${KEY.source})`);
  if (typeof a.genre !== "string" || !a.genre)
    shape(
      `${where}: 'genre' is required \u2014 the genre id this action is offered to (24 \xA73), such as core:genre/chat`
    );
  const venues = Array.isArray(a.venue) ? a.venue : a.venue === void 0 ? [] : [a.venue];
  if (!venues.length) shape(`${where}: 'venue' is required \u2014 where the action appears (R-15)`);
  for (const v2 of venues) {
    if (!v2 || typeof v2 !== "object") {
      shape(`${where}: a venue is { kind, channel? } \u2014 got ${typeof v2}`);
      continue;
    }
    const kind = v2.kind;
    if (!VENUE_KINDS.includes(kind))
      shape(
        `${where}: venue kind '${String(kind)}' is not one core offers \u2014 one of ${VENUE_KINDS.join(", ")}`
      );
    const channel = v2.channel;
    if (channel !== void 0 && (typeof channel !== "string" || !channel))
      shape(`${where}: a venue's 'channel' is a channel slug`);
  }
  if (a.audience !== void 0) {
    const aud = a.audience;
    if (!aud || typeof aud !== "object") shape(`${where}: 'audience' is { see, act }`);
    else
      for (const half of ["see", "act"]) {
        const refs = aud[half];
        if (!Array.isArray(refs))
          shape(`${where}: audience.${half} is a list of participant references`);
        else
          for (const r of refs)
            if (!isParticipantRef(r))
              shape(
                `${where}: audience.${half} names '${String(r)}', which is not a participant reference \u2014 one of ${PARTICIPANT_ROLES.join(", ")}, or user:<id>, character:<id>, envoy:<slug>`
              );
      }
  }
  if (a.quick !== void 0 && typeof a.quick !== "boolean")
    shape(`${where}: 'quick' is a boolean \u2014 the one prominence flag`);
  if (a.collects !== void 0) shape(...collectsFindings(a.collects, `${where}.collects`));
  if (a.effects !== void 0 && !ACTION_EFFECTS.includes(a.effects))
    shape(
      `${where}: 'effects' is one of ${ACTION_EFFECTS.join(", ")} \u2014 what the result touches (the effects line, R-15)`
    );
  for (const v2 of venues)
    line(
      worldActionCrossing({
        kind: "venue",
        where,
        effects: a.effects,
        venue: v2?.kind
      })
    );
  const act = a.audience?.act;
  if (Array.isArray(act))
    for (const r of act) line(worldActionCrossing({ kind: "actor", where, effects: a.effects, ref: r }));
  shape(...i18nFindings(a.label, `${where}.label`, { required: true }));
  if (a.description === void 0)
    shape(
      `${where}: 'description' is required \u2014 one plain sentence saying what the action does, shown in the session's action legend and as the control's tooltip ({ en: 'Roll the dice and post the result.' })`
    );
  else shape(...i18nFindings(a.description, `${where}.description`));
  if (a.iconAlt !== void 0) {
    shape(...i18nFindings(a.iconAlt, `${where}.iconAlt`));
    if (a.icon === void 0)
      shape(
        `${where}: 'iconAlt' needs an 'icon' \u2014 it is what the icon says when it stands alone; drop it, or declare the icon`
      );
  }
  if (a.slash !== void 0) {
    if (typeof a.slash !== "string") shape(`${where}: 'slash' is a string`);
    else shape(...slashFindings(a.slash, specId, where));
  }
  if (a.envoy !== void 0) shape(...envoyFindings(a.envoy, `${where}.envoy`, "action"));
  shape(...enabledWhenFindings(a.enabledWhen, `${where}.enabledWhen`));
  const onMessage = venues.some((v2) => {
    const kind = v2?.kind;
    return kind === "message" || kind === "form";
  });
  if (!onMessage)
    normalizeEnabledWhen(a.enabledWhen).forEach((p, i) => {
      if (p.on === "item" || p.on.startsWith("item."))
        shape(
          `${where}.enabledWhen[${i}]: reads '${p.on}', which only a press on a message can answer \u2014 add a { kind: 'message' } venue, or read a session value ('state.world.\u2026', 'session.generating') instead`
        );
    });
  shape(...enabledWhenFindings(a.presentWhen, `${where}.presentWhen`));
  normalizeEnabledWhen(a.presentWhen).forEach((p, i) => {
    if (p.on === "item" || p.on.startsWith("item."))
      shape(
        `${where}.presentWhen[${i}]: reads '${p.on}' \u2014 whether an action is present is decided for a listing, which has no message to read; read a session value ('state.world.\u2026', 'session.openForm.action') instead, or grey it per row with enabledWhen`
      );
  });
  return out;
}
function slashFindings(slash, specId, where = "slash") {
  const ns = specNamespace(specId);
  if (isCoreNamespace(ns)) {
    if (BARE_SLASH.test(slash)) return [];
    return [
      NAMESPACED_SLASH.test(slash) ? `${where}: a core spec may not claim the namespaced slash name '/${slash}' \u2014 core's actions take bare names (/${slash.slice(slash.lastIndexOf(".") + 1)})` : `${where}: '/${slash}' is not a slash name \u2014 lowercase, digits and hyphens, starting with a letter`
    ];
  }
  const m = NAMESPACED_SLASH.exec(slash);
  if (!m)
    return [
      BARE_SLASH.test(slash) ? `${where}: a plugin spec may not claim the bare slash name '/${slash}' \u2014 third-party actions are '/<plugin>.<action>' (/${ns}.${slash}), so a collision with core's is impossible` : `${where}: '/${slash}' is not a slash name \u2014 '<plugin>.<action>', lowercase, digits and hyphens`
    ];
  if (m[1] !== ns)
    return [
      `${where}: '/${slash}' claims the namespace '${m[1]}' \u2014 a spec under '${ns}' names its actions '/${ns}.<action>'`
    ];
  return [];
}
function normalizeAction(raw) {
  const a = { ...raw };
  if (a.venue && !Array.isArray(a.venue)) a.venue = [a.venue];
  else if (!Array.isArray(a.venue)) a.venue = [];
  if (a.envoy && typeof a.envoy === "object")
    a.envoy = { ...a.envoy, speaks: "on-action" };
  if (a.enabledWhen !== void 0 && a.enabledWhen !== null) {
    const list = Array.isArray(a.enabledWhen) ? a.enabledWhen : [a.enabledWhen];
    if (list.every(isEnabledWhenShaped)) a.enabledWhen = normalizeEnabledWhen(a.enabledWhen);
  }
  if (a.presentWhen !== void 0 && a.presentWhen !== null) {
    const list = Array.isArray(a.presentWhen) ? a.presentWhen : [a.presentWhen];
    if (list.every(isEnabledWhenShaped)) a.presentWhen = normalizeEnabledWhen(a.presentWhen);
  }
  return a;
}
function normalizeContributes(contributes) {
  if (!contributes) return contributes;
  const { actions, ...rest } = contributes;
  if (!actions?.length) return rest;
  return { ...rest, actions: actions.map(normalizeAction) };
}
function actionsOf(doc) {
  const c = doc.contributes;
  const normalized = normalizeContributes(c);
  return (normalized?.actions ?? []).map((a) => ({ ...a, specId: doc.id }));
}
function slashCollisions(actions) {
  const seen = /* @__PURE__ */ new Map();
  const out = [];
  for (const genre2 of new Set(actions.map((a) => a.genre ?? "")))
    for (const c of CORE_ACTIONS) {
      const slash = slashNameOf(c, CORE_ACTION_SPEC_ID);
      seen.set(`${genre2}#${slash}`, {
        identity: `${CORE_ACTION_SPEC_ID}#${c.key}`,
        specId: CORE_ACTION_SPEC_ID,
        key: c.key,
        slash
      });
    }
  for (const a of actions) {
    const slash = slashNameOf(a, a.specId);
    const identity = `${a.specId}#${a.key}`;
    const key = `${a.genre ?? ""}#${slash}`;
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, { identity, specId: a.specId, key: a.key, slash });
      continue;
    }
    if (prior.identity === identity) continue;
    out.push(
      `'/${slash}' is claimed twice for genre '${a.genre ?? "(none)"}': by '${prior.specId}' for '${prior.key}' and by '${a.specId}' for '${a.key}' \u2014 one slash name means one action; rename one of them`
    );
  }
  return out;
}
function actionDocumentFindings(doc) {
  return actionDocumentFindingsByLaw(doc).map((f) => f.message);
}
function actionDocumentFindingsByLaw(doc) {
  const c = doc.contributes;
  if (!c) return [];
  const out = [];
  for (const entry of c.actions ?? []) {
    const a = normalizeAction(entry);
    out.push(...actionFindingsByLaw(a, doc.id));
  }
  if (out.length) return out;
  return slashCollisions(actionsOf(doc)).map((message) => ({ law: "R-15", message }));
}
var CORE_VERB_REASONS = Object.freeze({
  generating: { en: "wait for the reply to finish" },
  hidden: { en: "unhide it first" },
  notNewest: { en: "only the newest reply can be regenerated" },
  noSwipe: { en: "nothing to swipe to" },
  greeting: { en: "a greeting is swiped, not regenerated" },
  ownLine: { en: "your own line is edited, not regenerated" },
  nobodySeated: { en: "nobody is seated to pick" }
});
var NOT_GENERATING = {
  on: "session.generating",
  equals: false,
  reason: CORE_VERB_REASONS.generating
};
var NEWEST = { on: "item.isNewest", truthy: true, reason: CORE_VERB_REASONS.notNewest };
var REPLY = { on: "item.role", equals: "assistant", reason: CORE_VERB_REASONS.ownLine };
var CORE_ACTIONS = Object.freeze([
  {
    key: "stop",
    venue: [{ kind: "message" }],
    audience: { see: ["participant"], act: ["participant"] },
    quick: true,
    label: { en: "Stop generating" },
    description: { en: "Stop the reply being written now; what it wrote so far is kept." },
    icon: "square",
    floor: true
  },
  {
    key: "edit",
    venue: [{ kind: "message" }],
    audience: ITEM_AUDIENCE,
    quick: true,
    label: { en: "Edit" },
    description: { en: "Change the text of this message." },
    icon: "pencil",
    enabledWhen: [
      { on: "item.hidden", equals: false, reason: CORE_VERB_REASONS.hidden },
      NOT_GENERATING
    ],
    floor: true
  },
  {
    key: "branch",
    venue: [{ kind: "message" }],
    audience: { see: ["participant"], act: ["owner"] },
    label: { en: "Branch from here" },
    description: { en: "Start a copy of the session from this message, leaving this one as it is." },
    icon: "git-branch",
    enabledWhen: [NOT_GENERATING],
    floor: true
  },
  {
    key: "retry",
    venue: [{ kind: "message" }, { kind: "extra" }],
    audience: ITEM_AUDIENCE,
    quick: true,
    slash: "retry",
    label: { en: "Regenerate" },
    description: { en: "Write the newest reply again, in place of the one there." },
    icon: "refresh-cw",
    enabledWhen: [
      NEWEST,
      REPLY,
      { on: "item.greeting", equals: false, reason: CORE_VERB_REASONS.greeting },
      { on: "item.hidden", equals: false, reason: CORE_VERB_REASONS.hidden },
      NOT_GENERATING
    ],
    floor: false
  },
  {
    // The prefill extend: carry this reply on (ruling 2026-09-08; renamed
    // from `continue` 2026-09-28). A message verb only — the composer's
    // Continue is `advance` below.
    key: "extend",
    venue: [{ kind: "message" }],
    audience: ITEM_AUDIENCE,
    label: { en: "Extend" },
    description: { en: "Carry on writing this reply from where it stopped." },
    icon: "arrow-down",
    enabledWhen: [NEWEST, REPLY, NOT_GENERATING],
    floor: false
  },
  {
    // The composer's Continue (lair pass B7): fire the turn order's head.
    // A turn control, not a message verb — no row, so no `item.*`
    // predicate; who may fire which entry is the fire's own rule.
    key: "advance",
    venue: [{ kind: "extra" }],
    audience: { see: ["participant"], act: ["participant"] },
    slash: "advance",
    label: { en: "Continue" },
    description: { en: "Let whoever is next in the turn order speak." },
    icon: "message-square-more",
    enabledWhen: [NOT_GENERATING],
    floor: false
  },
  {
    // Pick who speaks (lair pass B8): fire a character the person names.
    // A turn control — present where the genre's `turnControls.pick`
    // says it applies; greyed here while busy or with nobody to pick.
    key: "pick",
    venue: [{ kind: "extra" }],
    audience: { see: ["participant"], act: ["participant"] },
    // Not `/pick`: too plain a word to take from every plugin's palette.
    slash: "pick-speaker",
    label: { en: "Pick who speaks" },
    description: { en: "Choose which character speaks next." },
    icon: "message-square-plus",
    enabledWhen: [
      NOT_GENERATING,
      { on: "state.who.active", truthy: true, reason: CORE_VERB_REASONS.nobodySeated }
    ],
    floor: false
  },
  {
    // The genre's own voice narrates (lair pass B8, D3; R8): fire it with
    // no new direction — Adventure's narrator, the Lair's Castellan (the
    // host stamps the fire `via: 'narrate'`). Opt-in — only a `voice:
    // 'narrator'` genre has one (`turnControls.narrate`). The owner's, as
    // a pick out of order is.
    key: "narrate",
    venue: [{ kind: "extra" }],
    audience: { see: ["participant"], act: ["owner"] },
    // Not `/narrate`: Chat's narrate spec claims that name, and one
    // slash name means one action (`slashCollisions`).
    slash: "narrator",
    label: { en: "Narrate" },
    // Voice-neutral (lair pass R8, 2026-09-28): whose voice narrates is
    // the genre's — Adventure's narrator, the Lair's Castellan.
    description: { en: "Describe what happens next, with no new direction." },
    icon: "cloud-sun",
    enabledWhen: [NOT_GENERATING],
    floor: false
  },
  {
    // Regenerate the last turn, as a whole (lair pass R2, owner
    // 2026-09-28): delete the newest turn's yield — every row its run
    // created, on every channel, never a person's own line — and take
    // the same turn again. Opt-in (`turnControls.retake`), for a genre
    // whose turn writes more than one row; where it is offered, `retry`
    // leaves the extra venue so one genre never shows two _Regenerate_
    // chips. The owner's: it deletes what everybody at the table saw.
    key: "retake",
    venue: [{ kind: "extra" }],
    audience: { see: ["participant"], act: ["owner"] },
    slash: "retake",
    label: { en: "Regenerate" },
    description: {
      en: "Delete the last turn's messages and take the same turn again. Your own lines stay."
    },
    icon: "refresh-cw",
    enabledWhen: [NOT_GENERATING],
    floor: false
  },
  {
    key: "swipe",
    venue: [{ kind: "message" }],
    audience: ITEM_AUDIENCE,
    label: { en: "Swipe" },
    description: { en: "Step between the other versions of this reply." },
    icon: "chevrons-left-right",
    enabledWhen: [
      NEWEST,
      REPLY,
      { on: "item.hasSwipes", truthy: true, reason: CORE_VERB_REASONS.noSwipe },
      NOT_GENERATING
    ],
    floor: false
  },
  {
    key: "hide",
    venue: [{ kind: "message" }],
    audience: ITEM_AUDIENCE,
    label: { en: "Hide" },
    description: { en: "Leave this message out of what the characters remember; it stays on the page." },
    icon: "ghost",
    enabledWhen: [NOT_GENERATING],
    floor: false
  },
  {
    key: "delete",
    venue: [{ kind: "message" }],
    audience: ITEM_AUDIENCE,
    label: { en: "Delete" },
    description: { en: "Remove this message from the session." },
    icon: "trash-2",
    enabledWhen: [NOT_GENERATING],
    floor: false
  }
]);

// ../serene-pub-sdk/sdk/src/builder.ts
function exposeOf(key, pinned, expose) {
  if (expose.session === false && expose.swaps?.length)
    throw new Error(
      `node '${key}': expose.swaps offers a choice in session settings, so it cannot be combined with session: false`
    );
  const swaps = swapIds(key, pinned, expose.swaps);
  for (const field of ["status", "label", "purpose"]) {
    if (expose[field] === void 0) continue;
    const bad = i18nFindings(expose[field], `node '${key}': expose.${field}`);
    if (bad.length) throw new Error(bad[0]);
  }
  if (expose.purpose !== void 0 && !isModelCall(pinned))
    throw new Error(stepPurposeRefusal(key, pinned.id));
  const shown = {
    ...expose.stream === true ? { stream: true } : {},
    ...expose.status !== void 0 ? { status: expose.status } : {},
    ...expose.label !== void 0 ? { label: expose.label } : {},
    ...expose.purpose !== void 0 ? { purpose: expose.purpose } : {}
  };
  if (swaps.length) return { session: true, swaps, ...shown };
  if (expose.session === true) return { session: true, ...shown };
  return Object.keys(shown).length ? shown : void 0;
}
function isModelCall(def) {
  return def.kind === "oracle" && Object.values(def.slots ?? {}).some((s) => s.kind === "connection");
}
var stepPurposeRefusal = (key, definitionId) => `node '${key}': expose.purpose says what a model call is for, but ${definitionId} calls no model \u2014 put the purpose on the oracle that does, or give this step a label instead`;
function swapIds(key, pinned, swaps) {
  const out = [];
  for (const s of swaps ?? []) {
    if (!s?.descriptor)
      throw new Error(
        `node '${key}': expose.swaps takes pins (C.turnRandom), not ids \u2014 got ${JSON.stringify(s)}`
      );
    const id = s.descriptor.id;
    if (id === pinned.id)
      throw new Error(
        `node '${key}': '${id}' is the pin \u2014 it is always offered first, so it is never listed in expose.swaps`
      );
    if (out.includes(id)) throw new Error(`node '${key}': expose.swaps lists '${id}' twice`);
    const misfit = swapFitFinding(key, pinned, s.descriptor);
    if (misfit) throw new Error(misfit);
    out.push(id);
  }
  return out;
}
var SLUG2 = /^[a-z0-9]+(-[a-z0-9]+)*$/;
var parseId = (definitionId) => {
  const m = /^(.*)@(\d+)$/.exec(definitionId);
  return m ? { base: m[1], version: Number(m[2]) } : { base: definitionId, version: 1 };
};
var ChainBuilder = class _ChainBuilder {
  constructor(spec2, clauseCtx) {
    __publicField(this, "spec", spec2);
    __publicField(this, "clauseCtx", clauseCtx);
  }
  /** Resolve the callback form against the nodes declared so far. */
  resolve(arg) {
    if (typeof arg !== "function") return arg;
    const known = new Set(this.spec.nodes.map((n) => n.key));
    for (const b of this.spec.clauses) known.add(b.id);
    if (this.clauseCtx) known.add(`${this.clauseCtx.clauseId}.${ITEM}`);
    const localPrefix = this.clauseCtx ? `${this.clauseCtx.clauseId}.${this.clauseCtx.chain}` : void 0;
    const scope = makeScope(known, localPrefix, this.clauseCtx?.clauseId);
    return arg(scope);
  }
  add(kind, key, arg, opts) {
    const node = this.resolve(arg);
    if (node?.descriptor?.kind !== kind) {
      throw new Error(
        `.${kind}('${key}', \u2026) was given a ${node?.descriptor?.kind ?? "non-node"} ('${node?.descriptor?.id ?? "?"}'). The method names the kind; use .${node?.descriptor?.kind}() instead.`
      );
    }
    if (key.includes(":")) {
      throw new Error(
        `node key '${key}' contains ':' \u2014 a colon marks a synthetic config address (\`envoy:<key>\`), which a node key must never be mistaken for`
      );
    }
    if (this.spec.nodes.some((n) => n.key === this.qualify(key))) {
      throw new Error(
        `duplicate node key '${this.qualify(key)}' \u2014 keys are explicit and unique (F21)`
      );
    }
    if (this.spec.clauses.some((c) => c.id === this.qualify(key))) {
      throw new Error(
        `node key '${this.qualify(key)}' is already a clause id \u2014 nodes and clauses share one address space`
      );
    }
    const { base, version } = parseId(node.descriptor.id);
    this.spec.nodes.push({
      key: this.qualify(key),
      kind,
      definitionId: base,
      definitionVersion: version,
      // A declaration value given as a literal (an event you declared)
      // is written as its id: the document is JSON, the source is typed.
      config: Object.fromEntries(
        Object.entries(node.config ?? {}).map(([k, v2]) => [
          k,
          // A ref is a proxy that refuses any other property: test it first.
          !isDataRef(v2) && !isSlotRef(v2) && isSessionEventDecl(v2) ? v2.id : v2
        ])
      ),
      clauseId: this.clauseCtx?.clauseId,
      clauseKind: this.clauseCtx ? this.spec.clauses.find((b) => b.id === this.clauseCtx.clauseId)?.kind ?? "gather" : void 0,
      clauseChain: this.clauseCtx?.chain,
      position: this.spec.nodes.length,
      // Only when stated: a document written before the mark existed
      // hashes exactly as it did, and a node nobody marked carries no key.
      ...(() => {
        const expose = opts?.expose ? exposeOf(key, node.descriptor, opts.expose) : void 0;
        return expose ? { expose } : {};
      })()
    });
    return this;
  }
  qualify(key) {
    return this.clauseCtx ? `${this.clauseCtx.clauseId}.${this.clauseCtx.chain}.${key}` : key;
  }
  /** Where a clause declared here sits, so clauses nest exactly as nodes do. */
  declareClause(b) {
    if (this.spec.nodes.some((n) => n.key === b.id) || this.spec.clauses.some((c) => c.id === b.id))
      throw new Error(
        `clause id '${b.id}' is already a node key or clause id \u2014 nodes and clauses share one address space`
      );
    const clause = {
      ...b,
      clauseId: this.clauseCtx?.clauseId,
      clauseChain: this.clauseCtx?.chain,
      position: this.spec.nodes.length
    };
    this.spec.clauses.push(clause);
    return clause;
  }
  /**
   * A **gather** clause: several chains collected and awaited together (01 §4).
   * `mode` is a setting — by the equivalence law (C8) parallel and sequential
   * are unobservable, which is why the construct is named for what it does
   * (gather) and not for how (was `.async()`).
   */
  gather(id, opts, fn) {
    const qualified = this.qualify(id);
    this.declareClause({
      id: qualified,
      kind: "gather",
      mode: opts.mode ?? "parallel",
      chains: []
    });
    fn(new GatherBuilder(this.spec, qualified));
    return this;
  }
  /** An **each** clause: one contained chain, once per item of a list (01 §4). Was `.map()`. */
  each(id, opts, fn) {
    const qualified = this.qualify(id);
    this.declareClause({
      id: qualified,
      kind: "each",
      mode: opts.mode ?? "parallel",
      over: typeof opts.over === "function" ? this.resolve(opts.over) : opts.over,
      max: opts.max,
      chains: ["item"]
    });
    fn(new _ChainBuilder(this.spec, { clauseId: qualified, chain: "item" }));
    return this;
  }
  /**
   * One contained chain, repeated while a declared port stays truthy — bounded by a
   * mandatory `max` (01 §4a).
   *
   * This is the construct that makes tool-calling expressible on the spine. It is **not
   * a back-edge**: like `each`, the repetition lives in the clause's declaration rather
   * than in an edge that points backwards, and the executor already knew how to run a
   * chain more than once. A loop is an each whose iteration count comes from a predicate
   * instead of a list length.
   *
   * Always sequential — each iteration depends on the last, so `mode` would be a lie.
   */
  loop(id, opts, fn) {
    const qualified = this.qualify(id);
    const clause = this.declareClause({
      id: qualified,
      kind: "loop",
      mode: "sequential",
      max: opts.max,
      chains: ["item"]
    });
    fn(new _ChainBuilder(this.spec, { clauseId: qualified, chain: "item" }));
    clause.repeatWhile = typeof opts.repeatWhile === "function" ? new _ChainBuilder(this.spec, {
      clauseId: qualified,
      chain: "item"
    }).resolvePublic(opts.repeatWhile) : opts.repeatWhile;
    return this;
  }
  /** Internal: the callback resolver, reachable from `loop` after the body is built. */
  resolvePublic(arg) {
    return this.resolve(arg);
  }
  /**
   * A **junction** clause (was `.route()`): branches selected by declared
   * predicates over a value on the spine (20 §10). Any subset fires — one,
   * several, or none — plus an optional `otherwise` that fires exactly when
   * nothing else did. The decision is *data a task computed* (the value the
   * junction is `on`); the branching is declaration; the receipt records
   * every predicate's evaluation, fired and skipped alike. Not a back-edge
   * and not code in the executor — the loop clause's whole argument, applied
   * to fan-out. 01 §4 amended: branching exists as a declared junction; no
   * back-edges.
   *
   * Skipped branches publish `halt('not selected')` results marked
   * `fired: false`; the union's `ok`/`values` read the *fired* branches, so
   * downstream folds see what ran, in declaration order (13 §1).
   */
  junction(id, opts, fn) {
    const qualified = this.qualify(id);
    const clause = this.declareClause({
      id: qualified,
      kind: "junction",
      mode: opts.mode ?? "parallel",
      on: typeof opts.on === "function" ? this.resolve(opts.on) : opts.on,
      branches: {},
      chains: []
    });
    fn(new JunctionBuilder(this.spec, qualified, clause));
    return this;
  }
  query(key, node, opts) {
    return this.add("query", key, node, opts);
  }
  task(key, node, opts) {
    return this.add("task", key, node, opts);
  }
  oracle(key, node, opts) {
    return this.add("oracle", key, node, opts);
  }
  outlet(key, node, opts) {
    return this.add("outlet", key, node, opts);
  }
};
var GatherBuilder = class {
  constructor(spec2, clauseId) {
    __publicField(this, "spec", spec2);
    __publicField(this, "clauseId", clauseId);
  }
  /**
   * Each chain's nodes accumulate into the clause's type, so by the time `.gather()`
   * returns, the spine's scope contains every node the clause declared — under the
   * qualified key it actually has.
   */
  chain(name, fn) {
    const clause = this.spec.clauses.find((b) => b.id === this.clauseId);
    clause.chains.push(name);
    fn(
      new ChainBuilder(this.spec, {
        clauseId: this.clauseId,
        chain: name
      })
    );
    return this;
  }
};
var JunctionBuilder = class {
  constructor(spec2, clauseId, clause) {
    __publicField(this, "spec", spec2);
    __publicField(this, "clauseId", clauseId);
    __publicField(this, "clause", clause);
  }
  /** A branch that fires when its predicate matches the junction's value. */
  when(name, predicate, fn) {
    this.clause.chains.push(name);
    this.clause.branches[name] = { ...predicate };
    fn(
      new ChainBuilder(this.spec, {
        clauseId: this.clauseId,
        chain: name
      })
    );
    return this;
  }
  /** The branch that fires exactly when nothing else did. At most one. */
  otherwise(name, fn) {
    this.clause.chains.push(name);
    this.clause.branches[name] = { default: true };
    fn(
      new ChainBuilder(this.spec, {
        clauseId: this.clauseId,
        chain: name
      })
    );
    return this;
  }
};
var PresetBuilder = class {
  constructor(preset2) {
    __publicField(this, "preset", preset2);
  }
  set(nodeKey, slot, value) {
    this.preset.values.push({ nodeKey, slot, value });
    return this;
  }
  /** Node behaviour knobs — retrieval `weight`, `minInclude`, `topK` (12 §2). */
  params(nodeKey, value) {
    return this.set(nodeKey, "params", value);
  }
  /** Authored text fields the node declares. */
  prompts(nodeKey, value) {
    return this.set(nodeKey, "prompts", value);
  }
  /** A template **and its engine** — the engine travels on the value (src/engines.ts). */
  template(nodeKey, value) {
    return this.set(nodeKey, "template", value);
  }
  /** Generation parameters: a reference to a named config, or field overrides on top. */
  sampling(nodeKey, value) {
    return this.set(nodeKey, "sampling", value);
  }
  /** Node toggles and the review position. */
  settings(nodeKey, value) {
    return this.set(nodeKey, "settings", value);
  }
  /**
   * Deliberately absent: `connection`.
   *
   * An admin preset may set one (12 §4); an author preset may not. The author does not
   * know what hardware or credentials the user has, and 12 §4's admin cascade works
   * *because* connection has no writable scope below instance — an author preset
   * pinning compute would put a layer underneath the admin and break the one guarantee
   * the write matrix exists to make.
   */
};
var SpecBuilder = class extends ChainBuilder {
  constructor(rawId, meta) {
    assertSpecId(rawId);
    const parsed = parseSpecId(rawId);
    const id = rawId.replace(/@\d+$/, "");
    const normalized = { ...meta };
    if (normalized.taxonomy) {
      const t = { ...normalized.taxonomy };
      if (t.genre !== void 0)
        throw new Error(
          `spec '${id}' states taxonomy.genre \u2014 drop it: the genre comes from the inlet lock (.inlet(key, node, { genre, event })), and taxonomy is filled from there`
        );
      normalized.taxonomy = t;
    }
    if (normalized.contributes) {
      const stated = (normalized.contributes.actions ?? []).find(
        (a) => a.genre !== void 0
      );
      if (stated)
        throw new Error(
          `spec '${id}' action '${stated.key ?? "?"}' states a genre \u2014 drop it: an action is offered to the genre of the spec's inlet lock`
        );
      normalized.contributes = normalizeContributes(normalized.contributes);
      const actions = normalized.contributes?.actions ?? [];
      const faults = actions.flatMap((a) => actionFindings({ ...a, genre: PENDING_GENRE }, id));
      if (faults.length)
        throw new Error(`spec '${id}' declares an action core cannot offer:
 \xB7 ${faults.join("\n \xB7 ")}`);
    }
    super({
      id,
      meta: { ...normalized, owner: normalized.owner ?? parsed.owner },
      nodes: [],
      clauses: [],
      includes: [],
      presets: []
    });
    __publicField(this, "inletDone", false);
  }
  // The four node methods are re-declared here purely so the spine keeps offering
  // .gather(), .each(), .include() and .build(). Same implementation, narrower return.
  query(key, node, opts) {
    return this.add("query", key, node, opts);
  }
  task(key, node, opts) {
    return this.add("task", key, node, opts);
  }
  oracle(key, node, opts) {
    return this.add("oracle", key, node, opts);
  }
  outlet(key, node, opts) {
    return this.add("outlet", key, node, opts);
  }
  /**
   * A named configuration the spec ships with (12 §3a). Declared **after** the nodes,
   * so the node keys it addresses are the ones that exist — same accumulation the
   * scope uses, so a typo is a compile error rather than a dead override row.
   *
   * ```ts
   * .preset('lore-heavy', { label: 'Lore-heavy' }, p => p
   *   .params  ('lore',     { weight: 0.5, minInclude: 3 })
   *   .prompts ('generate', { system: LORE_SYSTEM })
   *   .template('prompt',   jinja(LORE_ASSEMBLY)))
   * ```
   */
  preset(slug, meta, fn) {
    if (!SLUG2.test(slug)) {
      throw new Error(
        `'${slug}' is not a valid preset slug. Use lowercase letters, digits and hyphens (e.g. 'lore-heavy'). The slug is a stable database reference an update matches on, not display text \u2014 put the pretty name in \`label\` (12 \xA73a).`
      );
    }
    const display = [
      ...i18nFindings(meta.label, `presets[${slug}].label`, { required: true }),
      ...i18nFindings(meta.description, `presets[${slug}].description`)
    ];
    if (display.length)
      throw new Error(
        `preset '${slug}' declares display text a publish refuses (R-20):
 \xB7 ${display.join("\n \xB7 ")}`
      );
    if (this.spec.presets.some((p) => p.slug === slug)) {
      throw new Error(
        `duplicate preset slug '${slug}' \u2014 slugs are unique per spec, because they are the sync key (12 \xA73a)`
      );
    }
    if (meta.default && this.spec.presets.some((p) => p.default)) {
      throw new Error(
        `'${slug}' is a second default preset. A spec ships at most one default; an admin chooses among the rest (12 \xA73a)`
      );
    }
    const built = {
      slug,
      ...meta,
      owner: meta.owner ?? this.spec.meta.owner,
      values: []
    };
    fn(new PresetBuilder(built));
    this.spec.presets.push(built);
    return this;
  }
  /**
   * Exactly one **inlet**, positionally first (01 §2). Enforced here rather than
   * by the validator, so it is a throw at authoring time.
   *
   * The optional third argument is the **usage lock** (24 §4): the session
   * event this inlet answers and the genre it serves. A session-event spec
   * without it does not compile — required for now, and relaxing later
   * (`genre: string[]`, `"*"`) is additive, never breaking. **The lock is the
   * only subscription** (R-4, 09-B B5): `.on()` and `subscribes` were deleted
   * 2026-09-16 — nothing read them at dispatch.
   */
  inlet(key, node, binding) {
    if (binding) {
      const idOf = (e) => isSessionEventDecl(e) ? e.id : e;
      binding = "events" in binding ? { ...binding, events: binding.events?.map(idOf) } : { ...binding, event: idOf(binding.event) };
    }
    if (this.inletDone)
      throw new Error("a spec has exactly one inlet (01 \xA72) \u2014 .inlet() may be called once");
    if (this.spec.nodes.length > 0) throw new Error("the inlet must be the first node (01 \xA72)");
    if (binding) {
      const many = "events" in binding ? binding.events : void 0;
      const one = "event" in binding ? binding.event : void 0;
      if (many !== void 0) {
        if (!Array.isArray(many) || many.length === 0)
          throw new Error(
            "an inlet binding over several events lists them \u2014 { genre, events: [ \u2026 ] } (PLAN-turn-order \xA74.1)"
          );
        if (many.some((e) => typeof e !== "string" || !e))
          throw new Error("an inlet binding lists event ids \u2014 every entry of `events` is a string");
        if (new Set(many).size !== many.length)
          throw new Error(
            `an inlet binding lists each event once \u2014 { genre, events: [${many.map((e) => `'${e}'`).join(", ")}] } repeats one`
          );
      } else if (!one)
        throw new Error("an inlet binding names its event \u2014 { genre, event } (24 \xA74)");
      for (const e of many ?? [one]) {
        if (!eventById(e)) throw new Error(notADeclaredEvent(e));
        if (e === sessionEvents.turnOrderChanged) throw new Error(TURN_ORDER_CHANGED_IS_INTERNAL);
      }
      if (many === void 0 && one && packageEventById(one)) {
        const d = node?.descriptor;
        const [first] = eventsLockFindings(d, [one]);
        if (first) throw new Error(first);
      }
      if (many !== void 0) {
        const d = node?.descriptor;
        const [first] = eventsLockFindings(d, many);
        if (first) throw new Error(first);
      }
      if (typeof binding.genre === "string")
        throw new Error(
          `the inlet lock names its genre as the string '${binding.genre}' \u2014 pass the genre value (import it), or use('${binding.genre}') for one you cannot import`
        );
      if (!binding.genre)
        throw new Error(
          `a spec answering '${one ?? many.join(", ")}' must declare the genre it serves \u2014 { genre, event } (24 \xA74). Required for now; multi-genre opens later without breaking this declaration.`
        );
      const genre2 = genreIdOf(binding.genre);
      this.spec.input = many !== void 0 ? { genre: genre2, events: [...many] } : { genre: genre2, event: one };
      const actions = this.spec.meta.contributes?.actions;
      if (actions?.length) {
        const collisions = slashCollisions(
          actions.map((a) => ({ ...a, genre: genre2, specId: this.spec.id }))
        );
        if (collisions.length)
          throw new Error(
            `spec '${this.spec.id}' declares an action core cannot offer:
 \xB7 ${collisions.join("\n \xB7 ")}`
          );
      }
      this.spec.meta = {
        ...this.spec.meta,
        ...this.spec.meta.taxonomy ? { taxonomy: { ...this.spec.meta.taxonomy, genre: genre2 } } : {},
        ...this.spec.meta.contributes?.actions ? {
          contributes: {
            ...this.spec.meta.contributes,
            actions: this.spec.meta.contributes.actions.map((a) => ({ ...a, genre: genre2 }))
          }
        } : {}
      };
    }
    this.inletDone = true;
    return this.add("inlet", key, node);
  }
  // Clauses are inherited from ChainBuilder so they nest; re-declared here only so the
  // spine keeps offering .include() and .build() afterwards.
  gather(id, opts, fn) {
    return super.gather(id, opts, fn);
  }
  each(id, opts, fn) {
    return super.each(id, opts, fn);
  }
  loop(id, opts, fn) {
    return super.loop(id, opts, fn);
  }
  junction(id, opts, fn) {
    return super.junction(id, opts, fn);
  }
  /** Compile-time include — expanded here, so rows hold the flat chain (16 §3a). */
  include(key, fragment) {
    this.spec.includes.push({ key, fragmentId: fragment.id });
    for (const n of fragment.nodes) {
      this.spec.nodes.push({
        ...n,
        key: `${key}.${n.key}`,
        clauseId: n.clauseId ? `${key}.${n.clauseId}` : void 0,
        position: this.spec.nodes.length
      });
    }
    for (const b of fragment.clauses) {
      this.spec.clauses.push({
        ...b,
        id: `${key}.${b.id}`,
        clauseId: b.clauseId ? `${key}.${b.clauseId}` : void 0,
        position: this.spec.nodes.length
      });
    }
    return this;
  }
  build() {
    const orphan = this.spec.meta.contributes?.actions?.find((a) => !a.genre);
    if (orphan)
      throw new Error(
        `spec '${this.spec.id}' contributes action '${orphan.key}' but has no inlet lock \u2014 an action is offered to the genre of the lock: .inlet(key, node, { genre, event })`
      );
    return this.spec;
  }
};
var PENDING_GENRE = "pending:genre/lock";
function spec(id, meta) {
  return new SpecBuilder(id, meta);
}

// ../serene-pub-sdk/sdk/src/templateIds.ts
var TEMPLATE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*:template\/[a-z0-9]+(?:-[a-z0-9]+)*@\d+$/;
function isTemplateId(value) {
  return typeof value === "string" && TEMPLATE_ID.test(value);
}
function parseTemplateId(value) {
  if (!isTemplateId(value)) return null;
  const [owner, rest] = value.split(":");
  const [name, major] = rest.slice("template/".length).split("@");
  return { owner, name, major: Number(major) };
}
function templateSeedProblems(t, owner) {
  const problems = [];
  const parts = parseTemplateId(t.id);
  if (!parts) {
    problems.push(
      `template id '${t.id}' is not a template id \u2014 it must read '${owner}:template/<kebab-name>@<major>' (e.g. '${owner}:template/table-narration@1').`
    );
  } else if (parts.owner === "core") {
    problems.push(
      `template '${t.id}' claims the 'core' namespace, which is reserved. Name it '${owner}:template/${parts.name}@${parts.major}'.`
    );
  } else if (parts.owner !== owner) {
    problems.push(
      `template '${t.id}' sits under namespace '${parts.owner}', not '${owner}'. Ownership is what lets an update replace your rows and leave everyone else's alone.`
    );
  }
  const isFields = !!t.body && typeof t.body === "object" && !Array.isArray(t.body);
  const isSource = typeof t.body === "string";
  if (t.kind === "prompts") {
    if (!t.nodeDefinitionId)
      problems.push(
        `template '${t.id}' is a prompts row and names no nodeDefinitionId \u2014 a prompt follows the node it was written for, and the node is half its pool key.`
      );
    if (!t.slot)
      problems.push(
        `template '${t.id}' is a prompts row and names no slot \u2014 a definition may declare more than one prompts slot, each with its own fields, so the slot is the other half.`
      );
    if (!isFields)
      problems.push(
        `template '${t.id}' is a prompts row, so 'body' is field name \u2192 prose ({ systemPrompt: '\u2026' }), not a single string.`
      );
    if (t.engine)
      problems.push(
        `template '${t.id}' is a prompts row and declares an engine. Prompts are authored text fields, not a rendered document \u2014 drop 'engine'.`
      );
    if (t.variableId)
      problems.push(`template '${t.id}' is a prompts row and declares a variableId.`);
  } else if (t.kind === "template") {
    if (!t.nodeDefinitionId)
      problems.push(
        `template '${t.id}' is a context template and names no nodeDefinitionId \u2014 the node whose context it renders is half its pool key.`
      );
    if (!isSource)
      problems.push(`template '${t.id}' is a context template, so 'body' is the source string.`);
    if (!t.engine)
      problems.push(
        `template '${t.id}' is a context template and declares no engine. The engine travels on the value: a source with none would be rendered in whatever core ships instead of what you wrote it in.`
      );
    if (t.variableId)
      problems.push(`template '${t.id}' is a context template and declares a variableId.`);
  } else if (t.kind === "variables") {
    if (!t.variableId)
      problems.push(
        `template '${t.id}' is a variable layout and names no variableId \u2014 a layout is keyed by what it renders, never by a node or a spec.`
      );
    if (!isSource)
      problems.push(`template '${t.id}' is a variable layout, so 'body' is the source string.`);
    if (!t.engine)
      problems.push(
        `template '${t.id}' is a variable layout and declares no engine. A layout written in one language and selected into a slot that renders another stores cleanly and renders as raw markup.`
      );
    if (t.nodeDefinitionId || t.slot)
      problems.push(
        `template '${t.id}' is a variable layout and names a node \u2014 layouts are keyed by the variable they render, so that any pipeline rendering it may select this row.`
      );
  } else {
    problems.push(
      `template '${t.id}' has kind '${t.kind}'. A shipped template fills a 'prompts', 'template' or 'variables' slot.`
    );
  }
  return problems;
}

// ../serene-pub-sdk/sdk/src/values.ts
var VALUE_TYPE_ID = /^([a-z0-9]+(?:[.-][a-z0-9]+)*:)?[a-z0-9]+(?:-[a-z0-9]+)*@\d+$/;
function assertValueTypeId(id) {
  if (!VALUE_TYPE_ID.test(id))
    throw new Error(
      `'${id}' is not a valid value-type id. Use 'name@N' for core kinds or 'owner:name@N' for package-minted ones \u2014 the version lives in the key ('integer@2' is a new key, never a mutated 'integer@1').`
    );
}
var freeze = (o) => Object.freeze(o);
function decl(definitionId, props) {
  assertValueTypeId(definitionId);
  const clean = {};
  for (const [k, val] of Object.entries(props)) if (val !== void 0) clean[k] = val;
  return freeze({ [definitionId]: freeze(clean) });
}
function declared(definitionId, props) {
  const findings = [
    ...i18nFindings(props.label, `${definitionId} label`),
    ...i18nFindings(props.description, `${definitionId} description`)
  ];
  if (Array.isArray(props.options))
    props.options.forEach((o, i) => {
      if (!o || typeof o !== "object") return;
      const at = `${definitionId} options[${typeof o.value === "string" ? o.value : i}]`;
      findings.push(...i18nFindings(o.label, `${at}.label`));
      findings.push(...i18nFindings(o.description, `${at}.description`));
    });
  if (findings.length)
    throw new Error(
      `${definitionId} declares display text a publish refuses (R-20):
 \xB7 ${findings.join("\n \xB7 ")}`
    );
  return decl(definitionId, props);
}
function makeValueToolkit(ns) {
  return freeze({
    integer: (p = {}) => declared("integer@1", { ...p }),
    number: (p = {}) => declared("number@1", { ...p }),
    fraction: (p = {}) => declared("number@1", { min: 0, max: 1, step: p.step ?? 0.01, ...p }),
    weights: (p) => {
      validateWeightsProps(p);
      return declared("weights@1", { ...p });
    },
    stackedBar: (p) => {
      validateWeightsProps(p);
      return declared("weights@1", { ...p, control: "stacked-bar" });
    },
    select: (options, props) => {
      const p = Array.isArray(options) ? { options, ...props } : options;
      if (!p.options?.length) throw new Error("select needs at least one option");
      return declared("select@1", { ...p });
    },
    ranking: (options, props) => {
      if (!options?.length) throw new Error("ranking needs at least one option");
      return declared("ranking@1", { options, ...props });
    },
    text: (p = {}) => {
      if (p.pattern !== void 0) new RegExp(p.pattern);
      return declared("text@1", { ...p });
    },
    boolean: (p = {}) => declared("boolean@1", { ...p }),
    prompt: (p = {}) => declared("prompt-ref@1", { ...p }),
    custom: (kind, version, props) => {
      if (!ns)
        throw new Error(
          `custom value kinds need a package context \u2014 mint them with makeValueToolkit('<your slug>'), so '${kind}' serializes namespaced ('yourpkg:${kind}@${version}') and cannot shadow a core kind.`
        );
      return declared(`${ns}:${kind}@${version}`, props);
    }
  });
}
function validateWeightsProps(p) {
  const parts = Object.entries(p.parts ?? {});
  if (!parts.length) throw new Error("weights needs at least one part");
  if (p.total !== void 0) {
    const sum = parts.reduce((a, [, w]) => a + w, 0);
    if (Math.abs(sum - p.total) > 1e-9)
      throw new Error(
        `weights parts sum to ${sum}, but total is pinned to ${p.total} \u2014 the author defaults must satisfy the constraint they declare`
      );
  }
  for (const [name, w] of parts) {
    if (p.min !== void 0 && w < p.min)
      throw new Error(`part '${name}' is below min ${p.min}`);
    if (p.max !== void 0 && w > p.max)
      throw new Error(`part '${name}' is above max ${p.max}`);
  }
}
var v = makeValueToolkit();
var num = (x) => typeof x === "number" && Number.isFinite(x);
var numberValidator = (integer) => (s, value) => {
  const errors = [];
  if (!num(value)) return [`expected a number, got ${typeof value}`];
  if (integer && !Number.isInteger(value)) errors.push("expected an integer");
  if (num(s.min) && value < s.min) errors.push(`below min ${s.min}`);
  if (num(s.max) && value > s.max) errors.push(`above max ${s.max}`);
  return errors;
};
var valueValidators = {
  "integer@1": numberValidator(true),
  "number@1": numberValidator(false),
  "weights@1": (s, value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return ["expected an object of part \u2192 weight"];
    const errors = [];
    const declared2 = Object.keys(s.parts ?? {});
    const got = value;
    for (const k of Object.keys(got))
      if (!declared2.includes(k)) errors.push(`unknown part '${k}'`);
    for (const k of declared2) {
      const w = got[k];
      if (!num(w)) {
        errors.push(`part '${k}' is not a number`);
        continue;
      }
      if (num(s.min) && w < s.min) errors.push(`part '${k}' below min ${s.min}`);
      if (num(s.max) && w > s.max) errors.push(`part '${k}' above max ${s.max}`);
    }
    if (num(s.total)) {
      const sum = declared2.reduce((a, k) => a + (num(got[k]) ? got[k] : 0), 0);
      if (Math.abs(sum - s.total) > 1e-9)
        errors.push(`parts sum to ${sum}, expected ${s.total}`);
    }
    return errors;
  },
  "select@1": (s, value) => {
    const opts = (s.options ?? []).map(
      (o) => typeof o === "string" ? o : o.value
    );
    return typeof value === "string" && opts.includes(value) ? [] : [`expected one of [${opts.join(", ")}]`];
  },
  "ranking@1": (s, value) => {
    const opts = s.options ?? [];
    if (!Array.isArray(value)) return ["expected an array"];
    const sorted = [...value].sort();
    const expected = [...opts].sort();
    return JSON.stringify(sorted) === JSON.stringify(expected) ? [] : [`expected a permutation of [${opts.join(", ")}]`];
  },
  "text@1": (s, value) => {
    if (typeof value !== "string") return ["expected a string"];
    const errors = [];
    if (num(s.minLength) && value.length < s.minLength)
      errors.push(`shorter than minLength ${s.minLength}`);
    if (num(s.maxLength) && value.length > s.maxLength)
      errors.push(`longer than maxLength ${s.maxLength}`);
    if (typeof s.pattern === "string" && !new RegExp(s.pattern).test(value))
      errors.push(`does not match pattern ${s.pattern}`);
    return errors;
  },
  "boolean@1": (_s, value) => typeof value === "boolean" ? [] : ["expected a boolean"],
  "prompt-ref@1": (_s, value) => typeof value === "string" || typeof value === "number" ? [] : ["expected a prompt reference"],
  // A media value is the blob's public address — the uuid, never a path and
  // never bytes. Validated by shape rather than by looking it up: whether it
  // still exists is the host's question at read time, not the schema's.
  "media-ref@1": (_s, value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? [] : ["expected a media uuid"]
};
var isTodo = (value) => typeof value === "object" && value !== null && Object.keys(value).length === 1 && "todo@1" in value;
var shippedValueKinds = Object.freeze(Object.keys(valueValidators));

// ../serene-pub-sdk/sdk/src/annexFields.ts
var ANNEX_FIELD_KEY = /^[a-z][a-z0-9-]*$/;
var NOT_A_PRESSER = /* @__PURE__ */ new Set(["ai", "item", "run-owner"]);
function holdsSecret(shape) {
  if (!shape || typeof shape !== "object") return false;
  if (shape.type === "secret") return true;
  if (shape.type === "list") return holdsSecret(shape.item);
  if (shape.type === "object") return Object.values(shape.fields ?? {}).some((f) => holdsSecret(f));
  return false;
}
function annexFieldFindings(raw, at = "annexFields") {
  if (!raw || typeof raw !== "object") return [`${at}: an annex field is annexField({ key, shape, see?, act? })`];
  const f = raw;
  const where = `${at}[${typeof f.key === "string" ? f.key : "?"}]`;
  const out = [];
  if (typeof f.key !== "string" || !ANNEX_FIELD_KEY.test(f.key))
    out.push(
      `${where}: 'key' is a lowercase kebab token (${ANNEX_FIELD_KEY.source}) \u2014 the field sits in your own package's annex document, so it never names an owner`
    );
  const shape = f.shape;
  if (!shape || typeof shape !== "object" || typeof shape.type !== "string")
    out.push(`${where}: 'shape' is a field declaration \u2014 { type: 'integer', min: 1, max: 20 }`);
  else if (holdsSecret(shape))
    out.push(
      `${where}: the shape holds a secret \u2014 the annex never keeps credentials or personal data (R61); keep a secret in plugin settings`
    );
  else
    for (const finding of checkSchema({ [String(f.key)]: shape }))
      if (finding.severity === "error") out.push(`${where}: ${finding.message} \u2014 ${finding.fix}`);
  const see = dataAudienceFindings(f.see);
  if (see) out.push(`${where}.see: ${see}`);
  if (f.act !== void 0) {
    if (!Array.isArray(f.act) || !f.act.length)
      out.push(`${where}.act: a non-empty list of participant references \u2014 who may set the value`);
    else
      for (const r of f.act) {
        if (!isParticipantRef(r))
          out.push(`${where}.act: '${String(r)}' is not a participant reference`);
        else if (NOT_A_PRESSER.has(String(r).trim()))
          out.push(`${where}.act: '${String(r)}' cannot press anything \u2014 name who sets the value`);
      }
  }
  if (f.genre !== void 0) {
    const g = typeof f.genre === "string" ? f.genre : f.genre?.id;
    if (typeof g !== "string" || !/^[a-z0-9.-]+:genre\/[a-z0-9.-]+/.test(g))
      out.push(`${where}.genre: a genre \u2014 the value genre() returned, or its id ('acme.dice:genre/table')`);
  }
  out.push(...i18nFindings(f.label, `${where}.label`));
  out.push(...i18nFindings(f.description, `${where}.description`));
  return out;
}
function annexFieldListFindings(raw, at = "annexFields") {
  if (raw === void 0) return [];
  if (!Array.isArray(raw)) return [`${at}: a list of annexField(\u2026) values`];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const f of raw) {
    out.push(...annexFieldFindings(f, at));
    const key = f?.key;
    if (typeof key === "string") {
      if (seen.has(key)) out.push(`${at}: '${key}' is declared twice \u2014 a key has one shape and one audience`);
      seen.add(key);
    }
  }
  return out;
}
function annexFieldValueRefusal(field, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("value" in payload))
    return `'${field.key}' is set with { payload: { value } }`;
  const value = payload.value;
  if (value === void 0) return `'${field.key}' is set with { payload: { value } }`;
  if (holdsSecret(field.shape)) return `'${field.key}' holds a secret, which the annex never keeps (R61)`;
  const faults = checkValues({ [field.key]: field.shape }, { [field.key]: value }).filter(
    (f) => f.severity === "error"
  );
  return faults.length ? faults.map((f) => f.message).join("; ") : null;
}
var declarations = /* @__PURE__ */ new Map();
var annexDeclarationOf = (owner) => declarations.get(owner);
function annexFieldsInGenre(fields, genre2) {
  return fields.filter((f) => f.genre === void 0 || genre2 === void 0 || f.genre === genre2);
}
var annexOwnerOfSpec = (specId) => {
  if (!specId) return "core";
  const at = specId.indexOf(":");
  return at > 0 ? specId.slice(0, at) : specId;
};
function annexWriteKeysOf(config2, edgesIntoValue = []) {
  if (edgesIntoValue.includes("value")) return null;
  const value = config2?.value;
  const fromEdges = edgesIntoValue.filter((p) => p.startsWith("value.")).map((p) => p.split(".")[1]);
  if (value === void 0) return [...new Set(fromEdges)];
  if (isDataRef(value) || !value || typeof value !== "object" || Array.isArray(value)) return null;
  return [.../* @__PURE__ */ new Set([...Object.keys(value), ...fromEdges])];
}
function annexWriteRefusals(fields, w) {
  const out = [];
  const inForce = annexFieldsInGenre(fields ?? [], w.genre);
  for (const key of w.keys) {
    const decl2 = inForce.find((f) => f.key === key);
    if (!decl2) {
      const elsewhere = (fields ?? []).find((f) => f.key === key);
      out.push(
        `'${key}' is not a key '${w.owner}' declares in its annex` + (elsewhere?.genre ? ` for this genre (it is declared for '${elsewhere.genre}')` : "") + ` \u2014 declare it once, with annexField({ key: '${key}', shape, see }) on the owner's annexFields`
      );
      continue;
    }
    if (w.values && Object.hasOwn(w.values, key)) {
      const value = w.values[key];
      if (value !== null && value !== void 0) {
        const fault = annexFieldValueRefusal(decl2, { value });
        if (fault) out.push(fault);
      }
    }
  }
  return out;
}
function annexStepFindings(spec2, fieldsOf) {
  const out = [];
  const specOwner = annexOwnerOfSpec(spec2.id);
  for (const n of spec2.nodes) {
    if (n.definitionId !== "core:outlet/set-session-annex") continue;
    const params = n.config?.params ?? {};
    const named = typeof params.owner === "string" && params.owner.trim() ? params.owner.trim() : null;
    const owner = named && params.sharedAnnex === true ? named : specOwner;
    const fields = fieldsOf(owner);
    if (fields === void 0) continue;
    const into = (spec2.edges ?? []).filter((e) => e.to === n.key).map((e) => e.toPort);
    const keys = annexWriteKeysOf(n.config, into.filter((p) => p === "value" || p.startsWith("value.")));
    const refusals = annexWriteRefusals(fields, {
      owner,
      keys: keys ?? [],
      genre: spec2.input?.genre,
      values: keys && n.config?.value && typeof n.config.value === "object" && !isDataRef(n.config.value) ? Object.fromEntries(
        Object.entries(n.config.value).filter(([, v2]) => !collectsRef(v2))
      ) : void 0
    });
    if (refusals.length) out.push({ nodeKey: n.key, owner, refusals });
  }
  return out;
}
function collectsRef(v2) {
  if (isDataRef(v2)) return true;
  if (Array.isArray(v2)) return v2.some(collectsRef);
  if (v2 && typeof v2 === "object") return Object.values(v2).some(collectsRef);
  return false;
}

// ../serene-pub-sdk/sdk/src/declarations.ts
var storedSwap = (c) => ({
  // Read defensively: a JS modder's entry may name nothing at all, and the
  // checks below say so in a sentence rather than a TypeError.
  spec: typeof c?.spec === "string" ? c.spec : c?.spec?.id ?? "",
  node: c?.node,
  definition: typeof c?.definition === "string" ? c.definition : c?.definition?.id ?? ""
});
function swapInputFindings(swaps) {
  const out = [];
  for (const c of swaps) {
    const { spec: spec2, node, definition } = storedSwap(c);
    if (typeof c?.spec === "string")
      out.push(
        `swap names the spec '${spec2}' as a string \u2014 pass the spec value, or use('${spec2}') for one you cannot import`
      );
    if (typeof c?.definition === "string")
      out.push(`swap onto '${spec2}#${node}' names the definition '${definition}' as a string \u2014 pass its pin`);
    const known = c?.spec && typeof c.spec === "object" && "nodes" in c.spec ? c.spec : void 0;
    const target = known ? known.nodes.find(
      (n) => n.key === node
    ) : void 0;
    if (known && node && !target) out.push(`swap names node '${node}', which '${spec2}' does not have`);
    const pinned = definitionOfNode(target);
    const offered = definition ? getDefinition(definition) : void 0;
    const misfit = pinned && offered && swapFitFinding(node, pinned, offered);
    if (misfit) out.push(misfit);
  }
  return out;
}
var DEFINITION_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*:[a-z]+\/[a-z0-9]+(?:-[a-z0-9]+)*@\d+$/;
function swapContributionFindings(swaps, ns, declaredSpecs) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const c of swaps) {
    const { spec: spec2, node, definition } = storedSwap(c);
    if (!spec2?.includes(":spec/")) out.push(`swap names spec '${spec2}', which is not a spec id`);
    if (!node) out.push(`swap onto '${spec2}' names no node`);
    if (!DEFINITION_ID.test(definition)) {
      out.push(
        `swap onto '${spec2}#${node}' names definition '${definition}', which is not a pinned id ('ns:kind/name@N') \u2014 pass the pin`
      );
      continue;
    }
    const owner = definition.slice(0, definition.indexOf(":"));
    if (owner !== ns)
      out.push(
        `swap '${definition}' is owned by '${owner}' \u2014 a package contributes its own definitions`
      );
    if (declaredSpecs.has(spec2) || spec2.startsWith(`${ns}:`))
      out.push(
        `'${spec2}' is this package's own spec \u2014 list the swap on its node with expose.swaps, not as a contribution`
      );
    const key = `${spec2}#${node}#${definition}`;
    if (seen.has(key)) out.push(`contributes '${definition}' to '${spec2}#${node}' twice`);
    seen.add(key);
  }
  return out;
}
function labelFindings(at, meta) {
  return [
    ...i18nFindings(meta.label, `${at}.label`, { required: true }),
    ...i18nFindings(meta.description, `${at}.description`)
  ];
}
function genreOwnershipFindings(genres, ns) {
  const out = [];
  for (const decl2 of genres) {
    const owner = decl2.id.slice(0, decl2.id.indexOf(":"));
    if (owner !== ns)
      out.push(
        `genre '${decl2.id}' is owned by '${owner}' \u2014 a package declares only its own genres; referencing another's is done from a spec's input binding`
      );
  }
  return out;
}
var nodesOf = (s) => s.nodes;
var definitionOfNode = (n) => n ? getDefinition(`${n.definitionId}@${n.definitionVersion}`) : void 0;
function exposeSwapFindings(pipelines) {
  const out = [];
  for (const s of pipelines)
    for (const n of nodesOf(s)) {
      const pinned = definitionOfNode(n);
      if (!pinned || !n.expose?.swaps?.length) continue;
      for (const id of n.expose.swaps) {
        const swap = getDefinition(id);
        const misfit = swap && swapFitFinding(n.key, pinned, swap);
        if (misfit) out.push(`pipeline '${s.id}': ${misfit}`);
      }
    }
  return out;
}
function inputLockFindings(pipelines, declaredGenres, ns, requires) {
  const out = [];
  for (const s of pipelines) {
    const locked = lockedEvents(s.input);
    if (!locked.length) continue;
    const genreId = s.input?.genre;
    if (!genreId) {
      out.push(`pipeline '${s.id}' answers '${locked.join(", ")}' with no genre (24 \xA74)`);
      continue;
    }
    if (!declaredGenres.has(genreId)) requires.add(genreId);
    for (const event of locked) {
      if (!eventById(event)) out.push(`pipeline '${s.id}': ${notADeclaredEvent(event)}`);
      else if (event === sessionEvents.turnOrderChanged)
        out.push(`pipeline '${s.id}': ${TURN_ORDER_CHANGED_IS_INTERNAL}`);
    }
    if (s.input?.events?.length) {
      const inlet = definitionOfNode(nodesOf(s)[0]);
      if (inlet) for (const f of eventsLockFindings(inlet, s.input.events)) out.push(`pipeline '${s.id}': ${f}`);
    }
  }
  return out;
}
function lockedEvents(input) {
  if (!input) return [];
  if (input.events?.length) return [...input.events];
  return input.event ? [input.event] : [];
}
var lockAnswers = (input, event) => lockedEvents(input).includes(event);
function createPipelineFindings(genres, pipelines) {
  const out = [];
  for (const g of genres) {
    const creates = pipelines.filter(
      (s) => s.input?.genre === g.id && s.input?.event === sessionEvents.sessionCreated
    );
    if (creates.length === 0)
      out.push(
        `genre '${g.id}' has no create pipeline \u2014 every genre needs exactly one spec answering '${sessionEvents.sessionCreated}' (24 \xA73)`
      );
    if (creates.length > 1)
      out.push(
        `genre '${g.id}' has ${creates.length} create pipelines (${creates.map((s) => s.id).join(", ")}) \u2014 exactly one (24 \xA73)`
      );
  }
  return out;
}
function genrePresetFindings(genres, presets) {
  const out = [];
  for (const g of genres) {
    if (presets.some((p) => p.genre === g.id)) continue;
    out.push(
      `genre '${g.id}' has no preset \u2014 a custom pipeline must include a default preset: declare a preset() for this genre binding its pipelines, so sessions can start on it and the Pipelines view lists them under it (the first one is the genre's default)`
    );
  }
  return out;
}
function contributedActionFindings(pipelines) {
  const out = [];
  const packageActions = [];
  for (const s of pipelines) {
    const contributed = { id: s.id, contributes: "meta" in s ? s.meta.contributes : s.contributes };
    for (const finding of actionDocumentFindings(contributed))
      out.push(`pipeline '${s.id}': ${finding}`);
    packageActions.push(...actionsOf(contributed));
  }
  out.push(...slashCollisions(packageActions));
  return out;
}
function promptFindings(prompts) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const pr of prompts) {
    out.push(...i18nFindings(pr.label, `prompt '${pr.slug}'.label`, { required: true }));
    const pool = `${pr.nodeType}#${pr.slot}`;
    const key = `${pool}#${pr.slug}`;
    if (seen.has(key)) out.push(`duplicate prompt '${pr.slug}' for '${pool}'`);
    seen.add(key);
  }
  return out;
}
function configFindings(configs, declaredSpecs, requires) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const c of configs) {
    out.push(...labelFindings(`config '${c.slug}'`, c));
    const key = `${c.spec}#${c.slug}`;
    if (seen.has(key)) out.push(`duplicate config '${c.slug}' for '${c.spec}'`);
    seen.add(key);
    const target = declaredSpecs.get(c.spec);
    if (!target) {
      requires.add(c.spec);
      continue;
    }
    for (const nodeKey of Object.keys(c.values))
      if (!target.nodes.some((n) => n.key === nodeKey))
        out.push(`config '${c.slug}' for '${c.spec}' addresses unknown node '${nodeKey}'`);
  }
  return out;
}
function presetFindings(presets, declaredGenres, declaredSpecs, configs, requires) {
  const errors = [];
  const coverage = [];
  for (const p of presets) {
    errors.push(...labelFindings(`preset '${p.slug}'`, p));
    const g = declaredGenres.get(p.genre);
    if (!g) requires.add(p.genre);
    const surface = g ? { ...g.events } : {};
    const slots = [];
    const events = /* @__PURE__ */ new Set([...Object.keys(surface), ...Object.keys(p.bindings)]);
    for (const event of events) {
      const declared2 = surface[event];
      const binding = p.bindings[event];
      if (binding && isEventId(event) && !eventById(event)) {
        errors.push(`preset '${p.slug}': ${notADeclaredEvent(event)}`);
        continue;
      }
      if (binding && !isEventId(event)) {
        errors.push(
          `preset '${p.slug}' binds '${event}', which is not an event id \u2014 bindings are keyed 'owner:event/name@N' (sessionEvents.messageRespond is '${sessionEvents.messageRespond}'), never by bare name (R-4)`
        );
        continue;
      }
      if (g && !declared2 && binding) {
        errors.push(
          `preset '${p.slug}' binds '${event}', which genre '${p.genre}' does not declare`
        );
        continue;
      }
      if (!binding) {
        const required = !!declared2?.required;
        if (required)
          errors.push(
            `preset '${p.slug}' leaves required slot '${event}' of '${p.genre}' unbound`
          );
        slots.push({
          event,
          required,
          status: required ? "MISSING" : "unbound"
        });
        continue;
      }
      const bound = declaredSpecs.get(binding.spec);
      if (!bound) {
        requires.add(binding.spec);
        slots.push({
          event,
          required: !!declared2?.required,
          binding,
          status: "bound-external"
        });
      } else {
        if (!lockAnswers(bound.input, event))
          errors.push(
            `preset '${p.slug}' binds '${bound.id}' to '${event}', but that spec answers '${lockedEvents(bound.input).join(", ") || "nothing"}' (24 \xA74)`
          );
        if (bound.input?.genre !== p.genre)
          errors.push(
            `preset '${p.slug}' (genre '${p.genre}') binds '${bound.id}', which serves '${bound.input?.genre ?? "no genre"}' (24 \xA74)`
          );
        if (binding.config && !configs.some((c) => c.spec === binding.spec && c.slug === binding.config))
          errors.push(
            `preset '${p.slug}' names config '${binding.config}' of '${binding.spec}', which this package does not declare`
          );
        slots.push({
          event,
          required: !!declared2?.required,
          binding,
          status: "bound"
        });
      }
    }
    for (const c of p.defaults?.swaps ?? []) {
      const { spec: spec2, node, definition } = storedSwap(c);
      if (!spec2?.includes(":spec/"))
        errors.push(`preset '${p.slug}' seeds a swap on '${spec2}', which is not a spec id`);
      if (!node) errors.push(`preset '${p.slug}' seeds a swap onto '${spec2}' that names no node`);
      if (!DEFINITION_ID.test(definition))
        errors.push(
          `preset '${p.slug}' seeds a swap onto '${spec2}#${node}' naming '${definition}', which is not a pinned id \u2014 pass the pin`
        );
      const own = declaredSpecs.get(spec2);
      if (own && node) {
        if (own.input?.genre && own.input.genre !== p.genre)
          errors.push(
            `preset '${p.slug}' (genre '${p.genre}') seeds a swap on '${spec2}', which serves '${own.input.genre}'`
          );
        const n = own.nodes.find((x) => x.key === node);
        const offered = n ? [`${n.definitionId}@${n.definitionVersion}`, ...n.expose?.swaps ?? []] : [];
        if (!n) errors.push(`preset '${p.slug}' seeds a swap onto '${spec2}#${node}', which has no such node`);
        else if (!n.expose?.session)
          errors.push(`preset '${p.slug}' seeds a swap onto '${spec2}#${node}', which is not in session settings (expose)`);
        else if (!offered.includes(definition))
          errors.push(
            `preset '${p.slug}' seeds '${definition}' onto '${spec2}#${node}', which offers ${offered.map((o) => `'${o}'`).join(", ")}`
          );
      }
    }
    for (const a of p.actions?.include ?? []) {
      const hash = a.lastIndexOf("#");
      const specId = hash === -1 ? a : a.slice(0, hash);
      if (!declaredSpecs.has(specId)) requires.add(specId);
    }
    coverage.push({ preset: p.slug, genre: p.genre, slots });
  }
  return { errors, coverage };
}
function surfaceFindings(surfaces) {
  const out = [];
  if (surfaces?.panels !== void 0)
    out.push(
      "surfaces.panels is gone \u2014 declare each panel as a widget in `widgets` naming a component, and place an `sp-frame` inside the component for the document"
    );
  for (const [where, decl2] of [
    ["session-view", surfaces?.["session-view"]],
    ["page", surfaces?.page]
  ]) {
    if (decl2 && !decl2.entry) out.push(`surfaces.${where} has no entry document`);
    else if (decl2?.entry && !isServableEntry(decl2.entry))
      out.push(`surfaces.${where} entry '${decl2.entry}' is not a path a pub will serve`);
    if (decl2?.settings !== void 0)
      out.push(
        `surfaces.${where}.settings is gone \u2014 a ${where} frame is handed no declared values; declare settings on a widget, which its component reads as \`ctx.settings\``
      );
  }
  return out;
}
var COMPONENT_SLUG = /^[a-z][a-z0-9-]*$/;
var SOURCE_HASH = /^[0-9a-f]{64}$/;
function componentFindings(components) {
  const out = [];
  const slugs = /* @__PURE__ */ new Set();
  for (const [i, c] of components.entries()) {
    const at = `component '${c?.slug ?? `components[${i}]`}'`;
    if (!c?.slug) out.push(`components[${i}] has no slug \u2014 a widget's component names it`);
    else if (!COMPONENT_SLUG.test(c.slug))
      out.push(`component slug '${c.slug}' is lowercase letters, digits and '-' \u2014 it names the built module's file`);
    else if (slugs.has(c.slug)) out.push(`duplicate component slug '${c.slug}' \u2014 a widget's component names it`);
    else slugs.add(c.slug);
    out.push(...i18nFindings(c?.label, `${at}.label`, { required: true }));
    if (!c?.entry) out.push(`${at} has no entry`);
    else if (!isServableEntry(c.entry.replace(/^\.\//, "")))
      out.push(`${at} entry '${c.entry}' is not a path a pub will serve`);
    if (c?.surface !== void 0)
      out.push(
        `${at} names a surface point \u2014 a component has none now; declare a widget whose \`component\` is '${c.slug}' (R25)`
      );
    if (c?.basedOn && (typeof c.basedOn.component !== "string" || typeof c.basedOn.version !== "string"))
      out.push(`${at}.basedOn is { component, version, sourceHash? } \u2014 the upstream a clone was made from`);
    else if (c?.basedOn?.sourceHash !== void 0 && !SOURCE_HASH.test(String(c.basedOn.sourceHash)))
      out.push(`${at}.basedOn.sourceHash is the upstream source's SHA-256, 64 lowercase hex digits`);
    if (c?.framework && !COMPONENT_FRAMEWORKS.includes(c.framework))
      out.push(
        ["react", "preact"].includes(c.framework) ? `component '${c.slug}' declares framework '${c.framework}', which arrives after SDK 1.0 \u2014 use ${COMPONENT_FRAMEWORKS.map((f) => `'${f}'`).join(" or ")}` : `component '${c.slug}' declares framework '${c.framework}', which is not a component framework \u2014 SDK 1.0 ships ${COMPONENT_FRAMEWORKS.map((f) => `'${f}'`).join(" and ")}`
      );
  }
  return out;
}
function widgetComponentFindings(genres, components) {
  const declared2 = new Set(components.map((c) => c?.slug).filter(Boolean));
  const out = [];
  for (const g of genres)
    for (const w of g.shape?.panels ?? []) {
      if (typeof w?.component !== "string") continue;
      if (!declared2.has(w.component))
        out.push(
          `${g.id} panel '${w.id}' names component '${w.component}', which this package does not declare \u2014 add it to \`components\``
        );
    }
  return out;
}
function packageWidgetFindings(widgets, components) {
  const declared2 = new Set(components.map((c) => c?.slug).filter(Boolean));
  const out = [];
  const ids = /* @__PURE__ */ new Set();
  for (const w of widgets) {
    if (ids.has(w?.id)) out.push(`two widgets are '${w?.id}' \u2014 a widget id names one`);
    ids.add(w?.id);
    if (coreWidgetIds().has(w?.id))
      out.push(`widget '${w.id}' is core's widget's id \u2014 a layout names core's and yours by bare id, so choose another`);
    if (typeof w?.component === "string" && !declared2.has(w.component))
      out.push(`widget '${w.id}' names component '${w.component}', which this package does not declare \u2014 add it to \`components\``);
    if (!w?.component) out.push(`widget '${w?.id}' names no component`);
    if (w?.surface !== void 0)
      out.push(`widget '${w.id}': \`surface\` is gone \u2014 name a component, and place an \`sp-frame\` inside it for a document`);
    out.push(...widgetReadsFindings(w?.reads, `widget '${w?.id}' reads`));
  }
  return out;
}
function genreLayoutFindings(genres, widgets, ns) {
  const errors = [];
  const warnings = [];
  const own = (id) => {
    const widget2 = widgetOfInstance(id);
    const bare = widget2.startsWith(`${ns}:`) ? widget2.slice(ns.length + 1) : widget2;
    return widgets?.find((w) => w?.id === bare);
  };
  const capped = (widgets ?? []).filter((w) => typeof w?.maxInstances === "number").flatMap((w) => [w, { id: `${ns}:${w.id}`, maxInstances: w.maxInstances }]);
  for (const g of genres) {
    const layouts = g.layouts ?? [];
    for (const l of layouts)
      for (const w of validateSessionLayout(l.preset, { widgets: capped }).warnings)
        warnings.push(`${g.id} layout '${l.slug}': ${w}`);
    if (!widgets || !layouts[0] || !(g.omitWidgets ?? []).includes(CONVERSATION_WIDGET_ID)) continue;
    const drawn = drawnWidgetIds(layouts[0].preset);
    const standsIn = drawn.some((id) => {
      const decl2 = own(id);
      if (decl2) return decl2.role === "primary";
      const widget2 = widgetOfInstance(id);
      return widget2.includes(":") && !widget2.startsWith(`${ns}:`);
    });
    if (!standsIn)
      errors.push(
        `${g.id} omits the conversation, and its layout '${layouts[0].slug}' draws none of this package's role: 'primary' widgets${drawn.length ? ` (it draws ${drawn.map((id) => `'${id}'`).join(", ")})` : ""} \u2014 declare the widget that stands in its place role: 'primary', and place it (any zone)`
      );
  }
  return { errors, warnings };
}
function todoHoles(configs) {
  const out = [];
  for (const c of configs)
    for (const [nodeKey, slots] of Object.entries(c.values))
      for (const [slot, value] of Object.entries(slots))
        if (isTodo(value))
          out.push({
            path: `${c.spec}#${c.slug} \u2192 ${nodeKey}.${slot}`,
            note: value["todo@1"].note
          });
  return out;
}
function declarationFindings(p) {
  const genres = p.genres ?? [];
  const pipelines = p.pipelines ?? [];
  const configs = p.configs ?? [];
  const requires = /* @__PURE__ */ new Set();
  const declaredGenres = new Map(genres.map((g) => [g.id, g]));
  const declaredSpecs = new Map(pipelines.map((s) => [s.id, s]));
  const errors = [
    ...genreOwnershipFindings(genres, p.ns),
    ...inputLockFindings(pipelines, new Set(declaredGenres.keys()), p.ns, requires),
    ...createPipelineFindings(genres, pipelines),
    ...genrePresetFindings(genres, p.presets ?? []),
    ...contributedActionFindings(pipelines),
    ...exposeSwapFindings(pipelines),
    ...swapContributionFindings(p.swaps ?? [], p.ns, declaredSpecs),
    ...promptFindings(p.prompts ?? []),
    ...configFindings(configs, declaredSpecs, requires),
    ...eventDeclarationFindings(p.events ?? [], p.ns, pipelines, declaredGenres, requires, p.presets ?? []),
    ...annexDeclarationFindings(p.ns, pipelines, p.annexFields)
  ];
  const withEvents = new Map(
    [...declaredGenres].map(([id, g]) => {
      const own = (p.events ?? []).filter((e) => e.genre === id);
      if (!own.length) return [id, g];
      return [id, { ...g, events: { ...g.events, ...Object.fromEntries(own.map((e) => [e.event, {}])) } }];
    })
  );
  const presets = presetFindings(
    p.presets ?? [],
    withEvents,
    declaredSpecs,
    configs,
    requires
  );
  errors.push(
    ...presets.errors,
    ...surfaceFindings(p.surfaces),
    ...componentFindings(p.components ?? []),
    ...widgetComponentFindings(genres, p.components ?? []),
    ...packageWidgetFindings(p.widgets ?? [], p.components ?? [])
  );
  const layouts = genreLayoutFindings(genres, p.widgets, p.ns);
  errors.push(...layouts.errors);
  return {
    errors,
    warnings: layouts.warnings,
    coverage: { presets: presets.coverage, todos: todoHoles(configs) },
    requires: [...requires].sort()
  };
}
var subjectsOf = (spec2) => {
  const lock = spec2.input;
  const locked = lock?.events ? [...lock.events] : lock?.event ? [lock.event] : [];
  if (!locked.includes(sessionEvents.sessionAction)) return locked;
  const contributes = "meta" in spec2 ? spec2.meta.contributes : spec2.contributes;
  const keys = actionsOf({ id: spec2.id, contributes }).map((a) => a.key);
  return [...locked.filter((e) => e !== sessionEvents.sessionAction), ...keys.map((k) => `${spec2.id}#${k}`)];
};
function eventDeclarationFindings(events, ns, pipelines, declaredGenres, requires, presets = []) {
  const out = [];
  const keyOf = (event, genre2) => `${event} ${genre2}`;
  const byKey = /* @__PURE__ */ new Map();
  const genresOf = /* @__PURE__ */ new Map();
  for (const e of events) {
    const owner = e.event.slice(0, e.event.indexOf(":"));
    if (owner !== ns) out.push(`event '${e.event}' is declared by '${ns}' but sits under '${owner}' \u2014 a package declares its own`);
    if (!declaredGenres.has(e.genre)) requires.add(e.genre);
    if (e.recordedBy !== "any" && !e.recordedBy.length)
      out.push(`event '${e.event}' names nothing that may record it`);
    if (byKey.has(keyOf(e.event, e.genre)))
      out.push(`event '${e.event}' is declared twice for genre '${e.genre}'`);
    byKey.set(keyOf(e.event, e.genre), e);
    genresOf.set(e.event, /* @__PURE__ */ new Set([...genresOf.get(e.event) ?? [], e.genre]));
  }
  const isOwn = (id) => id.slice(0, id.indexOf(":")) === ns;
  const unlisted = (id, where) => `${where} names '${id}', this package's own event, but defineExtension({ events }) does not list it \u2014 add { event, genre, recordedBy } so it has a genre and a scope`;
  for (const spec2 of pipelines) {
    const lock = spec2.input;
    const lockGenre = lock?.genre;
    for (const heard of lock?.events ?? (lock?.event ? [lock.event] : [])) {
      if (heard.startsWith("core:") || !isOwn(heard)) continue;
      const genres = genresOf.get(heard);
      if (!genres) out.push(unlisted(heard, `pipeline '${spec2.id}'`));
      else if (lockGenre && !genres.has(lockGenre))
        out.push(
          `pipeline '${spec2.id}' listens for '${heard}' on '${lockGenre}', but it is declared for ${[...genres].join(", ")}`
        );
    }
    const nodes = spec2.nodes;
    for (const n of nodes) {
      const from = getDefinition(`${n.definitionId}@${n.definitionVersion}`)?.causesEventFrom;
      const recorded = from ? n.config?.[from] : void 0;
      if (typeof recorded !== "string") continue;
      const genres = genresOf.get(recorded);
      if (!genres) {
        if (isOwn(recorded)) out.push(unlisted(recorded, `pipeline '${spec2.id}' at '${n.key}'`));
        else requires.add(recorded);
        continue;
      }
      const decl2 = lockGenre ? byKey.get(keyOf(recorded, lockGenre)) : void 0;
      if (!decl2) {
        out.push(
          `pipeline '${spec2.id}' records '${recorded}' at '${n.key}' for genre '${lockGenre ?? "none"}', but it is declared for ${[...genres].join(", ")}`
        );
        continue;
      }
      if (decl2.recordedBy === "any") continue;
      const subjects = subjectsOf(spec2);
      if (!subjects.some((sub) => decl2.recordedBy.includes(sub)))
        out.push(
          `pipeline '${spec2.id}' records '${recorded}' at '${n.key}', but serves none of the subjects that may record it (${decl2.recordedBy.join(", ")}) \u2014 add one of its subjects to recordedBy, or declare your own event`
        );
    }
  }
  for (const p of presets)
    for (const event of Object.keys(p.bindings ?? {})) {
      if (event.startsWith("core:") || !isOwn(event)) continue;
      const genres = genresOf.get(event);
      if (!genres) out.push(unlisted(event, `preset '${p.slug}'`));
      else if (!genres.has(p.genre))
        out.push(`preset '${p.slug}' binds '${event}' on '${p.genre}', but it is declared for ${[...genres].join(", ")}`);
    }
  return out;
}
function annexDeclarationFindings(ns, pipelines, fields) {
  if (fields === void 0) return [];
  const out = [];
  for (const spec2 of pipelines) {
    const s = spec2;
    for (const hit of annexStepFindings(s, (owner) => owner === ns ? fields : annexDeclarationOf(owner)))
      for (const r of hit.refusals) out.push(`pipeline '${spec2.id}' at '${hit.nodeKey}': ${r}`);
  }
  return out;
}

// ../serene-pub-sdk/sdk/src/announce.ts
function use(ref) {
  const m = /^(.*?)@([~^]?\d[^@]*)$/.exec(ref);
  return Object.freeze(
    m ? { kind: "external-ref", id: m[1], range: m[2] } : { kind: "external-ref", id: ref }
  );
}
var isExternalRef = (v2) => !!v2 && typeof v2 === "object" && v2.kind === "external-ref";
function specIdOf(v2, where) {
  if (typeof v2 === "string")
    throw new Error(
      `${where} names the spec '${v2}' as a string \u2014 pass the spec value you built, or use('${v2}') for another package's`
    );
  if (!v2 || typeof v2 !== "object" || typeof v2.id !== "string")
    throw new Error(
      `${where} names no spec \u2014 pass the spec value you built, or use('<spec id>') for another package's`
    );
  return v2.id;
}
var lockEventsOf = (v2) => {
  if (isExternalRef(v2)) return void 0;
  const lock = v2.input;
  return lock?.events ? [...lock.events] : lock?.event ? [lock.event] : [];
};
var actionKeysOf = (v2) => {
  if (isExternalRef(v2)) return void 0;
  const contributes = "meta" in v2 ? v2.meta.contributes : v2.contributes;
  return actionsOf({ id: v2.id, contributes }).map((a) => a.key);
};
function config(spec2, slug, meta, values) {
  assertDisplayText2(`config '${slug}'`, meta);
  specIdOf(spec2, `config '${slug}'`);
  return { spec: spec2, slug, label: meta.label, description: meta.description, values };
}
function storedConfig(c) {
  return {
    spec: specIdOf(c?.spec, `config '${c?.slug}'`),
    slug: c.slug,
    label: c.label,
    ...c.description !== void 0 ? { description: c.description } : {},
    values: c.values
  };
}
function assertDisplayText2(at, meta) {
  const findings = labelFindings(at, meta);
  if (findings.length)
    throw new Error(`${at} declares display text a publish refuses (R-20):
 \xB7 ${findings.join("\n \xB7 ")}`);
}
function storedEventDeclaration(d) {
  const where = `event '${d?.event?.id ?? "?"}'`;
  if (!isSessionEventDecl(d?.event))
    throw new Error(`${where}: 'event' is the value defineSessionEvent() returned, not an id`);
  if (typeof d.genre === "string")
    throw new Error(`${where} names its genre as a string \u2014 pass the genre value, or use('${d.genre}')`);
  const genre2 = isExternalRef(d.genre) ? d.genre.id : genreIdOf(d.genre);
  let recordedBy;
  if (d.recordedBy === "any") recordedBy = "any";
  else {
    if (!Array.isArray(d.recordedBy) || !d.recordedBy.length)
      throw new Error(
        `${where} names nothing that may record it \u2014 list the subjects whose pipelines record it, or 'any'`
      );
    recordedBy = d.recordedBy.flatMap((entry, n) => {
      const at = `${where} recordedBy ${n + 1}`;
      if (typeof entry === "string") {
        if (!isEventId(entry) || !eventById(entry))
          throw new Error(`${at}: '${entry}' is not a declared event id \u2014 pass an event of the genre, a spec, or { spec, key }`);
        if (entry === sessionEvents.sessionAction)
          throw new Error(
            `${at}: the action event serves each action on its own \u2014 pick the action: { spec, key }, or pass the spec`
          );
        return [entry];
      }
      if (isBindingObject(entry)) {
        const { spec: ref, key } = entry;
        const id = specIdOf(ref, at);
        if (typeof key !== "string") throw new Error(`${at} picks from '${id}' without a key \u2014 { spec, key }`);
        const keys = actionKeysOf(ref);
        if (keys && !keys.includes(key))
          throw new Error(`${at} picks '${key}' from '${id}', which contributes ${keys.map((k) => `'${k}'`).join(", ") || "no actions"}`);
        return [`${id}#${key}`];
      }
      specIdOf(entry, at);
      const subjects = subjectsOf(entry);
      if (!subjects.length) throw new Error(`${at}: '${entry.id}' has no inlet lock \u2014 it serves no subject`);
      return subjects;
    });
  }
  return {
    event: d.event.id,
    payload: d.event.payload,
    name: d.event.name,
    description: d.event.description,
    domain: d.event.domain,
    genre: genre2,
    recordedBy
  };
}
var isBindingObject = (v2) => !!v2 && typeof v2 === "object" && "spec" in v2;
function preset(input) {
  const where = `preset '${input?.slug}'`;
  assertDisplayText2(where, input);
  if (typeof input.genre === "string")
    throw new Error(
      `${where} names its genre as a string \u2014 pass the genre value (import it), or use('${input.genre}')`
    );
  const genre2 = isExternalRef(input.genre) ? input.genre.id : genreIdOf(input.genre);
  const bindings = {};
  if (!Array.isArray(input.bindings))
    throw new Error(
      `${where}: bindings is a list of specs \u2014 [createSession, { spec: respond, config: tuned }]; each is bound on the events its inlet lock answers`
    );
  for (const [i, raw] of input.bindings.entries()) {
    const entry = isBindingObject(raw) ? raw : { spec: raw };
    const at = `${where} binding ${i + 1}`;
    const id = specIdOf(entry.spec, at);
    const locked = lockEventsOf(entry.spec);
    let events = entry.events;
    if (events === void 0) {
      if (!locked)
        throw new Error(
          `${at} binds '${id}', another package's spec \u2014 name the events it answers: { spec: use('${id}'), events: [ \u2026 ] }`
        );
      if (!locked.length)
        throw new Error(
          `${at} binds '${id}', which has no inlet lock \u2014 a preset binds a spec on the events its lock answers`
        );
      events = locked;
    } else if (!events.length) {
      throw new Error(`${at} binds '${id}' on no events \u2014 drop \`events\` to bind every event its lock answers`);
    } else if (locked) {
      const outside = events.filter((e) => !locked.includes(e));
      if (outside.length)
        throw new Error(
          `${at} binds '${id}' on ${outside.map((e) => `'${e}'`).join(", ")}, which its inlet lock does not answer (${locked.join(", ") || "no lock"})`
        );
    }
    let configSlug;
    if (entry.config !== void 0) {
      const configured = specIdOf(entry.config?.spec, `${at} config`);
      if (configured !== id)
        throw new Error(
          `${at} binds '${id}' with config '${entry.config.slug}', which was made for '${configured}'`
        );
      configSlug = entry.config.slug;
    }
    for (const event of events) {
      if (bindings[event])
        throw new Error(`${where} binds '${event}' twice \u2014 to '${bindings[event].spec}' and to '${id}'`);
      bindings[event] = { spec: id, ...configSlug !== void 0 ? { config: configSlug } : {} };
    }
  }
  const include = (pick, n) => {
    const at = `${where} action ${n + 1}`;
    if (typeof pick === "string")
      throw new Error(
        `${at} names '${pick}' as a string \u2014 pass the spec value (every action it contributes) or { spec, key } for one`
      );
    if (isBindingObject(pick)) {
      const { spec: ref, key } = pick;
      const id2 = specIdOf(ref, at);
      if (typeof key !== "string" || !ACTION_IDENTITY.test(`${id2}#${key}`))
        throw new Error(`${at} picks from '${id2}' without a valid key \u2014 { spec, key: '<action key>' }`);
      const keys2 = actionKeysOf(ref);
      if (keys2 && !keys2.includes(key))
        throw new Error(
          `${at} picks '${key}' from '${id2}', which contributes ${keys2.length ? keys2.map((k) => `'${k}'`).join(", ") : "no actions"}`
        );
      return [`${id2}#${key}`];
    }
    const id = specIdOf(pick, at);
    const keys = actionKeysOf(pick);
    if (!keys)
      throw new Error(
        `${at} includes '${id}', another package's spec \u2014 name the action: { spec: use('${id}'), key: '<action key>' }`
      );
    if (!keys.length)
      throw new Error(`${at} includes '${id}', which contributes no actions \u2014 nothing to bring along`);
    return keys.map((k) => `${id}#${k}`);
  };
  const swapsOf = (swaps) => {
    const faults = swapInputFindings(swaps);
    if (faults.length) throw new Error(`${where} defaults.swaps: ${faults.join("; ")}`);
    return swaps.map((c) => storedSwap(c));
  };
  return {
    slug: input.slug,
    genre: genre2,
    label: input.label,
    description: input.description,
    bindings,
    ...input.actions ? { actions: { include: input.actions.include.flatMap(include) } } : {},
    ...input.defaults ? {
      defaults: {
        ...input.defaults,
        ...input.defaults.swaps ? { swaps: swapsOf(input.defaults.swaps) } : {}
      }
    } : {},
    // Omitted rather than defaulted to `false`, so a declaration that says
    // nothing hashes as it always did — the announcement is content-hashed
    // like every other declaration here.
    ...input.enabled === void 0 ? {} : { enabled: input.enabled }
  };
}

// ../serene-pub-sdk/sdk/src/extension.ts
function handler(definition, fn, opts = {}) {
  const descriptor = "descriptor" in definition ? definition.descriptor : definition;
  return {
    __decl: "handler",
    type: descriptor,
    // The one knob (R62): a node is as public as its handler, private
    // unless its author says otherwise here.
    visibility: opts.visibility ?? "private",
    handler: fn,
    // Not configurable. See the note on the field.
    runtime: "process"
  };
}
var COMPONENT_FRAMEWORKS = ["svelte", "vanilla"];
var component = (d) => ({
  __decl: "component",
  ...d
});
var MIN_STORAGE_QUOTA = 1024;
var MAX_STORAGE_QUOTA = 256 * 1024 * 1024;
var HOSTNAME = /^(?:\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::\d+)?$/i;
function permissionFindings(p) {
  const out = [];
  if (!p) return out;
  if (p.storage) {
    const q = p.storage.quotaBytes;
    if (q !== void 0 && (typeof q !== "number" || !Number.isFinite(q) || q < MIN_STORAGE_QUOTA || q > MAX_STORAGE_QUOTA))
      out.push(
        `permissions.storage.quotaBytes must be ${MIN_STORAGE_QUOTA}\u2026${MAX_STORAGE_QUOTA}. A pub clamps whatever it is handed, so a number outside the band is not a bigger grant \u2014 it is a declaration that says something other than what you get.`
      );
  }
  if (p.network) {
    const hosts = p.network.hosts ?? [];
    if (!Array.isArray(hosts) || hosts.length === 0)
      out.push(
        `permissions.network requires a non-empty hosts allowlist \u2014 name the hosts you reach ('api.example.com', '*.example.com'). A network request naming none reaches nothing.`
      );
    else
      for (const host of hosts)
        if (typeof host !== "string" || !HOSTNAME.test(host))
          out.push(
            `permissions.network host '${String(host)}' is not a valid host, wildcard, or host:port.`
          );
  }
  return out;
}
var TEMPLATE_ENGINE_ID = /^([a-z0-9][a-z0-9.-]*):template\/([a-z0-9][a-z0-9-]*)@(\d+)$/;
var ExtensionError = class extends Error {
};
var SLUG3 = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
function defineExtension(d) {
  const problems = [];
  if (!SLUG3.test(d.slug)) {
    problems.push(
      `'${d.slug}' is not a valid plugin slug \u2014 lowercase letters, digits, dots and hyphens (e.g. 'chariot.dice-tray'). It is the namespace every id you register must sit under.`
    );
  }
  if (!/^\d+\.\d+\.\d+/.test(d.version)) {
    problems.push(
      `'${d.version}' is not semver. A plugin upgrades by version comparison (12 \xA73b).`
    );
  }
  problems.push(...i18nFindings(d.name, "name", { required: true }));
  problems.push(...i18nFindings(d.description, "description"));
  for (const key of Object.keys(d.engines ?? {}))
    if (key.includes(":"))
      problems.push(
        `engines['${key}'] is a template engine id \u2014 'engines' holds Serene Pub version ranges only. Declare it under templateEngines: { '${key}': renderFn }.`
      );
  for (const [id, fn] of Object.entries(d.templateEngines ?? {})) {
    const m = TEMPLATE_ENGINE_ID.exec(id);
    if (!m)
      problems.push(
        `templateEngines['${id}'] is not a template engine id. The grammar is '<slug>:template/<name>@<major>' \u2014 '${d.slug}:template/mustache@1'.`
      );
    else if (m[1] !== d.slug)
      problems.push(
        `templateEngines['${id}'] is not in this plugin's namespace \u2014 declare it as '${d.slug}:template/${m[2]}@${m[3]}'.`
      );
    if (typeof fn !== "function")
      problems.push(`templateEngines['${id}'] must be the function that renders it.`);
  }
  if (Array.isArray(d.hooks))
    problems.push(
      `'hooks' is a list \u2014 the code a plugin runs is declared under 'handlers' now: rename hooks: [handler(\u2026), \u2026] to handlers: [handler(\u2026), \u2026]. 'hooks' declares the points your package defines, by key.`
    );
  for (const h of d.handlers ?? []) {
    if (h.__decl !== "handler") continue;
    const ns = h.type.id.split(":")[0];
    if (ns !== d.slug) {
      problems.push(
        `type '${h.type.id}' is registered by plugin '${d.slug}' but sits under namespace '${ns}'. Rename it to '${d.slug}:\u2026' \u2014 ownership is what lets an update replace your rows and leave everyone else's alone.`
      );
    }
  }
  for (const p of d.pipelines ?? []) {
    const ns = p.id.split(":")[0];
    if (p.id.includes(":") && ns !== d.slug) {
      problems.push(`pipeline '${p.id}' sits under namespace '${ns}', not '${d.slug}'.`);
    }
  }
  const templateIds = /* @__PURE__ */ new Set();
  for (const t of d.templates ?? []) {
    problems.push(...templateSeedProblems(t, d.slug));
    if (templateIds.has(t.id))
      problems.push(`duplicate template id '${t.id}' \u2014 the id is the sync key (12 \xA73b).`);
    templateIds.add(t.id);
  }
  problems.push(...permissionFindings(d.permissions));
  problems.push(...annexFieldListFindings(d.annexFields));
  problems.push(...pluginVariableFindings(d.slug, variablesOf(d)));
  try {
    ownWidgets(d.slug, d.widgets ?? []);
  } catch (e) {
    problems.push(e.message);
  }
  const stored = (list, fn) => {
    if (!list) return void 0;
    const out = [];
    for (const item of list) {
      try {
        out.push(fn(item));
      } catch (e) {
        problems.push(e.message);
      }
    }
    return out;
  };
  problems.push(...swapInputFindings(d.swaps ?? []));
  for (const c of d.swaps ?? []) {
    const id = typeof c?.definition === "string" ? c.definition : c?.definition?.id;
    const impl = (d.handlers ?? []).find(
      (h) => h.__decl === "handler" && h.type?.id === id
    );
    if (impl && impl.visibility !== "public")
      problems.push(
        `swap contributes '${id}', whose handler is private \u2014 a swap runs your node in another package's pipeline; write handler(definition, fn, { visibility: 'public' })` + pluginRuleRef("private-nodes")
      );
  }
  const configs = stored(d.configs, storedConfig);
  const presets = stored(d.presets, preset);
  const events = stored(d.events, storedEventDeclaration);
  problems.push(
    ...declarationFindings({
      ns: d.slug,
      genres: d.genres,
      pipelines: d.pipelines,
      prompts: d.prompts,
      configs,
      presets,
      surfaces: d.surfaces,
      components: d.components,
      widgets: d.widgets,
      swaps: d.swaps,
      events,
      // Declared nothing is `[]`: every key a pipeline of this package
      // writes to its own annex must be declared (ruling 2026-09-26).
      annexFields: d.annexFields ?? []
    }).errors
  );
  if (problems.length) {
    throw new ExtensionError(
      `invalid extension '${d.slug}':
` + problems.map((p) => `  \u2022 ${p}`).join("\n")
    );
  }
  return {
    __extension: true,
    ...d,
    ...configs ? { configs } : {},
    ...presets ? { presets } : {},
    ...events ? { events } : {},
    ...d.swaps ? { swaps: d.swaps.map(storedSwap) } : {}
  };
}
function variablesOf(e) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (v2) => {
    if (!v2 || typeof v2 !== "object") return;
    const sig = JSON.stringify(v2);
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(v2);
  };
  for (const v2 of e.variables ?? []) add(v2);
  for (const h of e.handlers ?? []) {
    if (h.__decl !== "handler") continue;
    const bands = h.type?.bands;
    for (const v2 of Object.values(bands ?? {})) add(v2);
  }
  return out;
}

// ../serene-pub-sdk/sdk/src/executor.ts
var ok = (value) => ({ kind: "ok", value });

// ../serene-pub-sdk/sdk/dist/shapes.js
var registry4 = /* @__PURE__ */ new Map();
function defineShape2(def) {
  registry4.set(def.id, def);
  return def.id;
}
var S2 = {
  text: defineShape2({ id: "core:shape/text@1" }),
  textStream: defineShape2({
    id: "core:shape/text-stream@1",
    assignableTo: ["core:shape/text@1"],
    streaming: true
  }),
  sessionScope: defineShape2({ id: "core:shape/session-scope@1" }),
  /**
   * Transcript rows — what `session-history@1` publishes on `main` and
   * `messages` and what `process-messages@1` / `prose-transcript@1` read
   * (declared so since 2026-09-17, U5d review W9; the port had said
   * `context-candidates@1` since the SDK was vendored while the value was
   * always rows, and `validate()` never ran over the catalog to say so).
   *
   * **Not assignable to `context-candidates@1`** (U5d review R-a, the same
   * day; W9 had declared it one way). A transcript wired into a candidates
   * port is a wiring the host silently drops: `concat-candidates` keys a
   * row that is not a candidate as `undefined:<id>`, the ranker's `select`
   * excludes it as `excluded_unknown_source`, and `assemble` handed rows
   * as candidates halts on "no ranking decisions". The transcript's place
   * in the window rides the **`band`** port — one intent element, which a
   * spec concatenates in with the lore so the ranker reserves the
   * conversation's slice — and the rows themselves go to
   * `process-messages`. `validate()` says so (a warning naming the fix)
   * rather than refusing, so a document built from the older corpus still
   * compiles. The reverse was never declared either: a ranked candidates
   * list is not a transcript, and a port that reads rows is handed rows.
   */
  messages: defineShape2({ id: "core:shape/messages@1" }),
  candidates: defineShape2({ id: "core:shape/context-candidates@1" }),
  renderedBlocks: defineShape2({ id: "core:shape/rendered-blocks@1" }),
  assembled: defineShape2({ id: "core:shape/assembled-context@1" }),
  /**
   * What Assemble publishes after the allocation/formatting split (16 §7): ordered
   * **blocks** with role, source, token count and a `why` trail — not prose. The
   * Provider's `wire` slot turns it into whatever its connection actually wants.
   *
   * Assignable to `assembled-context@1` so existing specs keep connecting while core
   * migrates; the reverse is not assignable, because a rendered string has already
   * thrown away everything the panel and the budget need.
   */
  allocated: defineShape2({
    id: "core:shape/allocated-context@1",
    assignableTo: ["core:shape/assembled-context@1"]
  }),
  /**
   * The object a context template renders against: characters, personas,
   * scenario, the prompt texts, the resolved names.
   *
   * Its own shape rather than `json@1` so that a plugin supplying an alternative
   * context builder has something to publish, and so a spec that wires the wrong
   * node into Assemble's context port fails at publish rather than rendering a
   * template full of blanks — which reads as a broken template, and sends the
   * user to the wrong screen.
   */
  /**
   * The chat's cast and prompt config, as rows — before any decision about who
   * is shown or named. The input to the context builder, kept distinct from the
   * built context so the two can be replaced independently.
   */
  sessionCast: defineShape2({ id: "core:shape/session-cast@1" }),
  /**
   * The MCP connection kind (14 §1). A connection whose shape is `mcp` is a
   * Model Context Protocol server core talks to — foreign code SP speaks
   * JSON-RPC with, never code SP loads. The shape doubles as the connection
   * kind (F17), so only MCP connections are offerable on an MCP provider's
   * connection slot.
   */
  mcp: defineShape2({ id: "core:shape/mcp@1" }),
  templateContext: defineShape2({ id: "core:shape/template-context@1" }),
  vector: defineShape2({ id: "core:shape/vector@1" }),
  budget: defineShape2({ id: "core:shape/context-budget@1" }),
  rowIds: defineShape2({ id: "core:shape/row-ids@1" }),
  /**
   * The output of an async block or a map (01 §1, 13 §1). An ordered list in
   * **declaration order**, one entry per branch — never a merged object, because
   * merging needs a field-collision policy and every such policy is wrong for
   * somebody. `async` and `map` produce the same shape, so one equivalence
   * harness covers both (F26).
   */
  branchResults: defineShape2({ id: "core:shape/branch-results@1" }),
  /**
   * What a **gate-eligible** Consumer publishes (13 §7j-b). Discriminated, because
   * a write may in principle land as a proposal rather than a row — and a
   * proposal id in a shared id space is indistinguishable from a real row id
   * right up until the foreign key dangles.
   *
   * **Assignable to `row-ids@1`** since the 2026-09-15 rulings (09-B B4, R-17).
   * It was deliberately not, and the reason was the `async` review position:
   * a row proposed under it might never exist. That position is gone
   * (`review.ts` — on or off, nothing between): `on` parks the run until the
   * decision and a rejection halts it, so by the time any downstream node
   * runs, the ids a committed result carries ARE row ids. That is what makes
   * a create → update pair on one row inside one run legal, and it is how a
   * pipeline owns its reply: a placeholder outlet straight after the inlet,
   * and an `update-message` at the end that fills it.
   */
  writeResult: defineShape2({
    id: "core:shape/write-result@1",
    assignableTo: ["core:shape/row-ids@1"]
  }),
  /**
   * A request to summarize something into a lore entry.
   *
   * Its own shape rather than `json@1` because it is what the summarize
   * pipelines take as *input*, and 11 §2 matches an event's payload against a
   * pipeline's Input contract by shape. A request typed as bare json would make
   * every pipeline compatible with every event.
   */
  summarizeRequest: defineShape2({ id: "core:shape/summarize-request@1" }),
  /**
   * The ordered batch drafts phase 1 produces, before synthesis merges them.
   *
   * Ordered, and the order is load-bearing: the drafts are chronological
   * slices of a conversation and synthesis reads them as a sequence. A shape
   * that permitted reordering would turn a narrative into a pile of events.
   */
  drafts: defineShape2({ id: "core:shape/drafts@1" }),
  /** Scenes with their messages, as the graph builder walks them. */
  graphScenes: defineShape2({ id: "core:shape/graph-scenes@1" }),
  /**
   * A proposed set of graph nodes and relationships, before a person approves it.
   *
   * Distinct from anything holding row ids, for the reason `write-result@1`
   * exists: a proposal is not yet a row, and a downstream node that treated it
   * as one would wire a foreign key to something a reviewer may still reject.
   */
  graphProposal: defineShape2({ id: "core:shape/graph-proposal@1" }),
  /**
   * Who speaks next, and how that was decided (19 §5).
   *
   * Its own shape rather than `row-ids@1` because it is the swap-list
   * membership test: a task whose `main` publishes this shape *is* a
   * next-speaker strategy, and the dropdown is a SELECT over such rows — an
   * extension's strategy appears beside core's by existing, the same way a
   * chat mode does. The bundle carries `{speaker, characterId, strategy, via}`
   * — the speaker as a participant reference beside the bare id (R-18 (3)) —
   * and each rides its own port for wiring.
   */
  speakerSelection: defineShape2({ id: "core:shape/speaker-selection@1" }),
  /**
   * A participant reference (R-15, R-18 (3)): `character:<id>`,
   * `envoy:<slug>`, `user:<id>`, or a role — see `participants.ts`.
   *
   * The inlet's `speaker` port and a turn strategy's carry this, so one
   * port answers "who is speaking" for a library character and a genre's
   * envoy alike. Not assignable to `row-ids@1` on purpose: a reference is a
   * name, and a node that wants the bare character id keeps reading
   * `characterId` until every reader speaks references.
   */
  participantRef: defineShape2({ id: "core:shape/participant-ref@1" }),
  /**
   * An ordered list of participant references, no duplicates (lair pass R3,
   * 2026-09-28): the inlet's `recipients` — the cast members a press
   * collected (`CollectedRecipients`). Its own id rather than `json@1` so a
   * port that wants people is not handed any list. Consumed by
   * `core:query/resolve-state-changes@1`'s `owners` (R10): the Whisper's
   * one change, made on each recipient.
   */
  participantRefs: defineShape2({ id: "core:shape/participant-refs@1" }),
  /**
   * One **session change** (R-15, built 2026-09-16): the payload every
   * built-in write's event carries — `{ event, sessionId, messageId, at,
   * … }` plus what was lost or replaced (`lost` on a delete, `previous` on
   * an edit or a swipe). The next reply's inlet publishes the changes since
   * the last one as a list on its `sessionChanges` port, so a pipeline knows the
   * history it sees has moved. See `SessionChangePayload` in events.ts.
   *
   * Its own id rather than `json@1`, for the reason `summarize-request@1`
   * gives: `pipeline_event_registry.payload_shape` names it, and an event
   * whose payload was bare json would match every inlet.
   */
  sessionChange: defineShape2({ id: "core:shape/session-change@1" }),
  /**
   * A **form addressed** to a participant the AI portrays (R-15 *Forms*;
   * 30 §U5d): the payload of `core:event/form-addressed@1` — `{ sessionId,
   * messageId, blockId, action, addressee }` (`FormAddressedPayload`,
   * events.ts) — and what `core:inlet/form-addressed@1` publishes, port by
   * port, with the block itself beside them. Its own id for the reason
   * `session-change@1` has: the registry's `payload_shape` names it.
   */
  formAddressed: defineShape2({ id: "core:shape/form-addressed@1" }),
  /**
   * A **cast change** (PLAN-turn-order §4.1): the payload of
   * `core:event/cast-changed@1` — `{ event, sessionId, at, cause, ref,
   * change, value }` (`CastChangePayload`, events.ts). A seated
   * participant was switched on or off, or its `position` or portrayal moved;
   * a seat added or removed is `member-added` / `member-removed`, not
   * this. Its own id for the reason `session-change@1` has.
   */
  castChange: defineShape2({ id: "core:shape/cast-change@1" }),
  /**
   * **Annex changed** (PLAN-turn-order §4.14, R30): the payload of
   * `core:event/annex-changed@1` — `{ event, sessionId, at, cause, owner }`
   * (`AnnexChangePayload`, events.ts). Names whose entry moved, never the
   * value.
   */
  annexChange: defineShape2({ id: "core:shape/annex-change@1" }),
  /** What a listener receives for an event a pipeline recorded: the envelope, the author's payload inside. */
  recordedEvent: defineShape2({ id: "core:shape/recorded-event@1" }),
  /**
   * **Turn order changed** (§4.1): the payload of
   * `core:event/turn-order-changed@1` — `{ event, sessionId, at, cause,
   * runId, turnOrder }` (`TurnOrderChangedPayload`, events.ts), the
   * document as `core:outlet/set-turn-order@1` wrote it. Core-internal:
   * the auto-advance listener and the `sessions:turnOrder` push read it;
   * a genre may not bind a spec to it.
   */
  turnOrderChanged: defineShape2({ id: "core:shape/turn-order-changed@1" }),
  /**
   * The session's **turn order** as state (§4.2): `TurnOrderV1` —
   * `{ v, order, candidates, basedOnAt, computedAt, runId, event,
   * strategy }`, stored at `sessions.metadata.turnOrder` and written by
   * `core:outlet/set-turn-order@1` alone. Not the entries alone and not
   * the candidates alone: the whole answer, with what it answered.
   */
  turnOrder: defineShape2({ id: "core:shape/turn-order@1" }),
  /**
   * **Turn candidates** (§4.2): `TurnCandidateV1[]` — the participants the
   * pool admitted this run, in pool order. What `core:task/turn-pool@1`
   * publishes, an orderer rewrites, and a strategy reads. Open objects:
   * an orderer or a plugin may add keys and core passes them through.
   */
  turnCandidates: defineShape2({ id: "core:shape/turn-candidates@1" }),
  /**
   * **Turn entries** (§4.2): `TurnEntryV1[]` — prepared turns, each
   * `{ ref, channel?, subject?, via }`. What a strategy publishes on
   * `main` and `order`; the shape-based swap list keys a strategy on it,
   * as it keyed one on `speaker-selection@1` before (that shape stays
   * until the strategies are re-ported).
   */
  turnEntries: defineShape2({ id: "core:shape/turn-entries@1" }),
  /**
   * **Sprite choices** (DESIGN-sprites §5.2): what a line's speaker can show
   * — `{ characterId, set, defaultSet, labels, last, recent, decidedBy }`.
   * `set` is the sprite set in force for the line (a session override, the
   * cast member's amendment, or the card's default — `decidedBy` says
   * which); `labels` are that set's sprite labels with an image; `last` is
   * the speaker's previous shown sprite, for stickiness. What
   * `core:oracle/pick-sprite@1` publishes beside its pick, for the receipt.
   */
  spriteChoices: defineShape2({ id: "core:shape/sprite-choices@1" }),
  /**
   * **A sprite pick**: `{ set, label, score?, runnerUp?, held? } | null` — the
   * sprite a picker chose for a line, or null for none. What the sprite
   * picker publishes on `main` and `core:outlet/show-sprite@1` records.
   */
  spritePick: defineShape2({ id: "core:shape/sprite-pick@1" }),
  /**
   * The **settings document** (§4.12): `SessionSettingsV1` — every
   * setting a person can see in session settings, resolved once per run
   * with the cascade applied (session > genre > core), and handed to the
   * inlet as `session`. A spec reads `$.input.session.fields.tone` and
   * never learns which table it came from.
   */
  sessionSettings: defineShape2({ id: "core:shape/session-settings@1" }),
  /**
   * A reference to stored media of any kind — the general port type.
   *
   * `image@1` and `audio@1` stay, and are assignable **to** this, so every
   * spec wired to them keeps connecting while the general ports arrive. The
   * reverse is not assignable: a port that accepts any media cannot be handed
   * to one that has declared it only understands images. Same rule, and the
   * same reason, as `allocated-context` → `assembled-context`.
   */
  media: defineShape2({ id: "core:shape/media-ref@1" }),
  /** An ordered list of media references — what a multimodal request carries
   *  as its attachments. */
  mediaList: defineShape2({ id: "core:shape/media-refs@1" }),
  /**
   * 🚧 **A transcript's attachments, by message** (PLAN-composer-attachments
   * §3.5): `Record<messageId, HistoryAttachmentV1[]>` (media.ts) — each
   * message's `core:image` / `core:file` parts, in part order. What
   * `core:query/history-attachments@1` publishes and
   * `core:task/place-attachments@1` reads, so each line's files travel with
   * that line's own turn rather than with the request as a whole.
   */
  mediaByMessage: defineShape2({ id: "core:shape/media-by-message@1" }),
  /**
   * A reply's **folded sections** (B4; D5, 2026-09-27): `FoldedSectionV1[]`
   * (widgets.ts) — each `{ kind, label, content }` or `{ kind, label, items }`,
   * shown collapsed beside the body and never read into the prompt. What the
   * message outlets' `sections` in-port takes.
   */
  foldedSections: defineShape2({ id: "core:shape/folded-sections@1" }),
  audio: defineShape2({
    id: "core:shape/audio@1",
    assignableTo: ["core:shape/media-ref@1"]
  }),
  image: defineShape2({
    id: "core:shape/image@1",
    assignableTo: ["core:shape/media-ref@1"]
  }),
  json: defineShape2({ id: "core:shape/json@1" }),
  /**
   * What a ranker judged (PLAN-sdk-1.0 §3.9, R64): one `RankingDecisionV1`
   * per candidate. A node whose out-port carries this shape is RECORDED by
   * the host — core's rankers and a plugin's alike — into the ranking store.
   * Reviewed with L1 (PLAN-sdk-1.0 §4 ✓); it carries `S`'s own tag.
   */
  decisions: defineShape2({ id: "core:shape/decisions@1" }),
  // connection / sampling kinds — the same ids, which is the point (F17)
  /**
   * A model reply as an ordered list of typed parts (text, reasoning, media,
   * tool calls) rather than a string — see `OutputPart` in media.ts for why
   * that is now the honest shape of a completion.
   *
   * Assignable **to** `text-stream@1`, so a provider may start emitting parts
   * without breaking a single spec wired to its text output: the degrade
   * concatenates the prose and drops the rest. Not assignable in reverse,
   * because by then the ordering and the media are gone — the same
   * richer-to-poorer rule the allocated/assembled pair established.
   */
  partStream: defineShape2({
    id: "core:shape/part-stream@1",
    assignableTo: ["core:shape/text-stream@1"],
    streaming: true
  }),
  textGen: defineShape2({ id: "core:shape/text-gen@1" }),
  /**
   * Vector embedding — the connection kind, and deliberately **not** a
   * sampling vocabulary (yet).
   *
   * It is absent from `SAMPLING_SCHEMAS` on purpose, and the reason is
   * structural rather than unfinished work: every parameter an embedding call
   * would take — input truncation, pooling, normalisation, output dimensions,
   * the asymmetric query/passage prefixes E5/BGE/GTE want — changes what a
   * *stored* vector means, and nothing records which setting produced the
   * vectors already in the table. A text sampler affects one reply; an
   * embedding parameter silently re-defines a whole persistent index against
   * rows that will never be recomputed. That is the same re-index story the
   * prefixes are held back for, so none of them ship until it is decided.
   *
   * What is left after removing those is either not per-invocation at all
   * (model identity, transport, residency TTL — those belong to the
   * connection) or has no consumer (nothing chunks a batch). An empty
   * vocabulary is worse than no vocabulary here: `isKnownSamplingShape` in
   * core admits any shape this record has a key for, so registering `{}`
   * would let the write path accept a config that exists, looks saved, and
   * can never send anything — the exact state that guard was written to
   * refuse.
   */
  embeddings: defineShape2({ id: "core:shape/embeddings@1" }),
  /**
   * Named-entity recognition — the connection kind for a mention detector.
   *
   * Declared ahead of its adapter so the model side has a stable noun to
   * name; core's extractor is dictionary-based and model-free today
   * (`core:extract/entities-heuristic@1`), and takes no parameters at all
   * beyond the text and the gazetteer.
   *
   * Like `embeddings`, and for the same two reasons, it has no entry in
   * `SAMPLING_SCHEMAS`: its one real knob (how much of a passage the
   * extractor is handed) is part of the annotation freshness triple, and an
   * empty vocabulary would defeat core's do-nothing-config guard.
   */
  ner: defineShape2({ id: "core:shape/ner@1" }),
  tts: defineShape2({ id: "core:shape/tts@1" }),
  imageGen: defineShape2({ id: "core:shape/image-gen@1" })
};

// ../serene-pub-sdk/sdk/dist/i18n.js
var blank2 = (s) => s.trim().length === 0;
var isLocaleMap2 = (v2) => !!v2 && typeof v2 === "object" && !Array.isArray(v2) && typeof v2.en === "string";
var isI18n2 = (v2) => typeof v2 === "string" ? !blank2(v2) : isLocaleMap2(v2) && !blank2(v2.en);
var localeMapOf2 = (v2) => typeof v2 === "string" ? { en: v2 } : v2;
var describe2 = (v2) => {
  if (v2 === null)
    return "null";
  if (Array.isArray(v2))
    return "an array";
  if (typeof v2 === "object")
    return "an object without 'en'";
  return `a ${typeof v2}`;
};
function i18nFindings2(v2, where, opts = {}) {
  if (v2 === void 0) {
    return opts.required ? [
      `${where} is required \u2014 display text, a string ('Title') or a locale map with 'en' ({ en: 'Title', fr: 'Titre' }) (R-20)`
    ] : [];
  }
  if (typeof v2 === "string") {
    return blank2(v2) ? [`${where} is empty \u2014 give it text a person reads, 'Title' or { en: 'Title' } (R-20)`] : [];
  }
  if (isLocaleMap2(v2)) {
    return blank2(v2.en) ? [
      `${where}.en is empty \u2014 'en' is the text every other locale falls back to; write { en: 'Title' } (R-20)`
    ] : [];
  }
  return [
    `${where}: a locale map with a required 'en' (R-20) \u2014 got ${describe2(v2)}; write 'Title' or { en: 'Title', fr: 'Titre' }`
  ];
}
function i18nText2(v2, language = "en") {
  if (typeof v2 === "string")
    return v2;
  if (!isLocaleMap2(v2))
    return void 0;
  const wanted = v2[language];
  return typeof wanted === "string" && !blank2(wanted) ? wanted : v2.en;
}

// ../serene-pub-sdk/sdk/dist/hash.js
var sortDeep2 = (v2) => {
  if (Array.isArray(v2))
    return v2.map(sortDeep2);
  if (v2 && typeof v2 === "object") {
    return Object.fromEntries(Object.entries(v2).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, sortDeep2(val)]));
  }
  return v2;
};
function canonicalize2(v2) {
  return JSON.stringify(sortDeep2(v2));
}
function contentHash2(v2) {
  const s = canonicalize2(v2);
  let h1 = 3735928559;
  let h2 = 1103547991;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
var UNIVERSAL_DISPLAY2 = ["i18n", "description"];
var stripDisplay2 = (v2, display, functions = "source") => {
  if (typeof v2 === "function")
    return functions === "source" ? `[fn] ${String(v2)}` : void 0;
  if (Array.isArray(v2))
    return v2.map((e) => stripDisplay2(e, display, functions));
  if (v2 && typeof v2 === "object") {
    return Object.fromEntries(Object.entries(v2).filter(([k, val]) => !display.has(k) && !(functions === "omit" && typeof val === "function")).map(([k, val]) => [k, stripDisplay2(val, display, functions)]));
  }
  return v2;
};
var DEFAULT_DISPLAY2 = new Set(UNIVERSAL_DISPLAY2);
var displaySet2 = (opts) => opts?.display?.length ? /* @__PURE__ */ new Set([...UNIVERSAL_DISPLAY2, ...opts.display]) : DEFAULT_DISPLAY2;
function declarationData2(v2, opts) {
  return stripDisplay2(v2, displaySet2(opts), "omit");
}
function declarationHash2(v2, opts) {
  return contentHash2(stripDisplay2(v2, displaySet2(opts)));
}
function refuseUnlessIdentical2(existing, next, why, opts) {
  refuseUnlessSameHash2(declarationHash2(existing, opts), declarationHash2(next, opts), why);
}
function refuseUnlessSameHash2(registered, redeclared, why) {
  if (registered === redeclared)
    return;
  throw new Error(`${why} (registered ${registered}, redeclared ${redeclared})`);
}

// ../serene-pub-sdk/sdk/dist/predicates.js
var truthy2 = (v2) => !!v2 && !(Array.isArray(v2) && v2.length === 0);
function readPath2(value, path) {
  if (!path)
    return value;
  let cur = value;
  for (const seg of path.split(".")) {
    if (cur == null)
      return void 0;
    cur = cur[seg];
  }
  return cur;
}
var PREDICATE_CONDITION_KEYS2 = ["equals", "equalsPath", "truthy"];
function predicateHolds2(pred, value, scope) {
  if (pred.equals !== void 0)
    return value === pred.equals;
  if (pred.equalsPath !== void 0) {
    if (typeof pred.equalsPath !== "string" || !pred.equalsPath)
      return false;
    if (value === void 0)
      return false;
    const other = readPath2(scope, pred.equalsPath);
    return other !== void 0 && value === other;
  }
  if (pred.truthy)
    return truthy2(value);
  return false;
}
var ENABLED_WHEN_KEYS2 = [
  "on",
  ...PREDICATE_CONDITION_KEYS2,
  "reason"
];
var FORBIDDEN_SEGMENTS2 = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var isPrimitive2 = (v2) => v2 === null || ["string", "number", "boolean"].includes(typeof v2);
var isEnabledWhenShaped2 = (p) => !!p && typeof p === "object" && !Array.isArray(p) && typeof p.on === "string";
function normalizeEnabledWhen2(x) {
  if (x == null)
    return [];
  const list = Array.isArray(x) ? x : [x];
  return list.filter(isEnabledWhenShaped2).map((p) => ({
    ...p,
    reason: p.reason === void 0 ? p.reason : localeMapOf2(p.reason)
  }));
}
function evaluateEnabledWhen2(preds, doc) {
  for (const pred of normalizeEnabledWhen2(preds)) {
    if (predicateHolds2(pred, readPath2(doc, pred.on), doc))
      continue;
    return { enabled: false, reason: localeMapOf2(pred.reason), failed: pred };
  }
  return { enabled: true };
}
function enabledWhenFindings2(raw, at = "enabledWhen") {
  if (raw === void 0 || raw === null)
    return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  list.forEach((p, i) => {
    const where = Array.isArray(raw) ? `${at}[${i}]` : at;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      out.push(`${where}: an enabled-when is { on, equals | truthy, reason } \u2014 a predicate over the session's published values, such as { on: 'state.world.location', truthy: true, reason: { en: 'Set a location first' } }`);
      return;
    }
    const e = p;
    if (typeof e.on !== "string" || !e.on)
      out.push(`${where}: 'on' is required \u2014 a published-values path such as 'state.world.location' or 'session.generating' (never a port reference: actions live outside a run)`);
    else if (e.on.startsWith("$"))
      out.push(`${where}: 'on' is '${e.on}', which reads as a port reference \u2014 an enabled-when names a published-values path such as 'state.world.location'; actions live outside a run and have no ports to read`);
    else {
      const walked = e.on.split(".").find((seg) => FORBIDDEN_SEGMENTS2.has(seg));
      if (walked)
        out.push(`${where}: 'on' walks '${walked}' \u2014 a published-values path names data ('state.world.location', 'item.hidden'), never a prototype`);
    }
    const stated = PREDICATE_CONDITION_KEYS2.filter((k) => e[k] !== void 0);
    if (stated.length !== 1)
      out.push(`${where}: states ${stated.length || "no"} conditions \u2014 exactly one of ${PREDICATE_CONDITION_KEYS2.join(" / ")} per predicate (the junction rule, 20 \xA710); a richer decision belongs in a value the pipeline publishes`);
    if (e.truthy !== void 0 && typeof e.truthy !== "boolean")
      out.push(`${where}: 'truthy' is a boolean \u2014 write truthy: true`);
    else if (e.truthy === false)
      out.push(`${where}: 'truthy: false' states nothing \u2014 write truthy: true to require a value, or equals: false to require a false one`);
    if (e.equals !== void 0 && !isPrimitive2(e.equals))
      out.push(`${where}: 'equals' is a primitive \u2014 a string, number, boolean or null; a structured comparison belongs in a value the pipeline publishes as one`);
    if (e.equalsPath !== void 0) {
      if (typeof e.equalsPath !== "string" || !e.equalsPath)
        out.push(`${where}: 'equalsPath' is a path, not a value \u2014 the OTHER side of the comparison, read from the same document as 'on' (e.g. 'state.world.culprit'); to compare against a literal, write equals:`);
      else if (e.equalsPath.startsWith("$"))
        out.push(`${where}: 'equalsPath' is '${e.equalsPath}', which reads as a port reference \u2014 it names a published-values path exactly as 'on' does; actions live outside a run and have no ports to read`);
      else {
        const walkedOther = e.equalsPath.split(".").find((seg) => FORBIDDEN_SEGMENTS2.has(seg));
        if (walkedOther)
          out.push(`${where}: 'equalsPath' walks '${walkedOther}' \u2014 a published-values path names data ('state.world.location', 'item.hidden'), never a prototype`);
      }
    }
    if (e.reason === void 0)
      out.push(`${where}: 'reason' is required \u2014 why the control is grey when the predicate does not hold, a locale map with 'en' (R-20)`);
    else
      out.push(...i18nFindings2(e.reason, `${where}.reason`));
    for (const k of Object.keys(e))
      if (!ENABLED_WHEN_KEYS2.includes(k))
        out.push(`${where}: '${k}' is not part of an enabled-when \u2014 one of ${ENABLED_WHEN_KEYS2.join(", ")}`);
  });
  return out;
}

// ../serene-pub-sdk/sdk/dist/participants.js
var PARTICIPANT_ROLES2 = ["owner", "admin", "participant", "person", "ai", "item", "run-owner"];
function audienceHolds2(refs, portrayals, viewer, item) {
  for (const ref of refs) {
    if (ref === "item") {
      if (item === void 0 || item)
        return true;
      continue;
    }
    const p = portrayals[ref];
    if (p?.by === "person" && p.userId === String(viewer.userId))
      return true;
  }
  return false;
}
var roles2 = new Set(PARTICIPANT_ROLES2);

// ../serene-pub-sdk/sdk/dist/settings.js
function settingsSchemaFindings2(schema, where) {
  if (schema === void 0)
    return [];
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    return [`${where}: a settings schema is an object keyed by field name \u2014 { depth: { type: 'integer', label: 'Depth' } }`];
  const out = [];
  for (const [key, raw] of Object.entries(schema)) {
    const at = `${where}.${key}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      out.push(`${at}: a field declaration is an object \u2014 { type: 'string', label: 'Name' }`);
      continue;
    }
    const f = raw;
    out.push(...i18nFindings2(f.label, `${at}.label`));
    out.push(...i18nFindings2(f.description, `${at}.description`));
    if (f.members !== void 0) {
      if (!Array.isArray(f.members))
        out.push(`${at}.members: the bands are an array \u2014 [{ key: 'lore', label: 'Lore' }]`);
      else
        f.members.forEach((m, i) => {
          const band = `${at}.members[${typeof m?.key === "string" ? m.key : i}]`;
          if (!m || typeof m !== "object") {
            out.push(`${band}: a band is an object \u2014 { key: 'lore', label: 'Lore' }`);
            return;
          }
          out.push(...i18nFindings2(m.label, `${band}.label`));
          out.push(...i18nFindings2(m.description, `${band}.description`));
        });
    }
    if (f.item !== void 0)
      out.push(...settingsSchemaFindings2({ item: f.item }, at));
    if (f.fields !== void 0)
      out.push(...settingsSchemaFindings2(f.fields, `${at}.fields`));
  }
  return out;
}

// ../serene-pub-sdk/sdk/dist/settingsSlot.js
var SETTINGS_SLOT2 = "settings";
var ENABLED_FIELD2 = Object.freeze({
  type: "boolean",
  default: true,
  quick: true,
  label: { en: "Use this source" },
  description: {
    en: "Off skips the step entirely rather than fetching and discarding it \u2014 cheaper than starving it with a zero share."
  }
});
var ENABLED_STEP_FIELD2 = Object.freeze({
  type: "boolean",
  default: true,
  quick: true,
  label: { en: "Run this step" },
  description: {
    en: "Off skips the step entirely: nothing is called or charged, and the steps after it go on without what it would have made."
  }
});
function authoredSlots2(slots) {
  if (!slots || !(SETTINGS_SLOT2 in slots))
    return slots ?? {};
  const { [SETTINGS_SLOT2]: _substrate, ...authored } = slots;
  return authored;
}

// ../serene-pub-sdk/sdk/dist/verdicts.js
var DOORS2 = [
  "construction",
  "registry",
  "validate",
  "publish",
  "run",
  "fire",
  "write",
  "list"
];
var VERDICT_ID2 = /^[a-z0-9]+(?:[.-][a-z0-9]+)*:verdict\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
var registry5 = /* @__PURE__ */ new Map();
var doorSet2 = new Set(DOORS2);
function defineVerdict2(decl2) {
  if (typeof decl2.id !== "string" || !VERDICT_ID2.test(decl2.id))
    throw new Error(`'${String(decl2.id)}' is not a verdict id \u2014 one is '<owner>:verdict/<slug>', the slug lowercase letters, digits and hyphens: core:verdict/effects-line`);
  if (typeof decl2.law !== "string" || !decl2.law.trim())
    throw new Error(`${decl2.id} names no law \u2014 'law' is the label a Finding carries for this rule ('F39', 'R-20')`);
  if (!Array.isArray(decl2.doors) || decl2.doors.length === 0)
    throw new Error(`${decl2.id} declares no door \u2014 list every place the rule is heard, one of ${DOORS2.join(", ")}`);
  const unknown = decl2.doors.find((d) => !doorSet2.has(d));
  if (unknown !== void 0)
    throw new Error(`${decl2.id} declares the door '${String(unknown)}', which is not one \u2014 a door is one of ${DOORS2.join(", ")}`);
  if (typeof decl2.judge !== "function" || typeof decl2.failing !== "function")
    throw new Error(`${decl2.id} declares no judge or no failing input \u2014 a verdict is { id, law, doors, judge, failing }`);
  const existing = registry5.get(decl2.id);
  if (existing)
    refuseUnlessIdentical2(existing, decl2, `duplicate verdict id: ${decl2.id}`);
  const verdict = Object.freeze({ ...decl2, doors: Object.freeze([...decl2.doors]) });
  registry5.set(decl2.id, verdict);
  return verdict;
}
function refusalText2(r) {
  const sentence = i18nText2(r.sentence) ?? "";
  return r.fix === void 0 ? sentence : `${sentence} \u2014 ${i18nText2(r.fix) ?? ""}`;
}
var i18nVerdict2 = defineVerdict2({
  id: "core:verdict/i18n",
  law: "R-20",
  doors: ["construction", "registry", "validate", "publish", "run"],
  judge({ value, where, required }) {
    const [sentence] = i18nFindings2(value, where, { required });
    return sentence === void 0 ? { ok: true } : { ok: false, sentence };
  },
  // The field each door is asked about — the sentence names it, so the
  // door's own address has to be the one the kit expects to hear back: a
  // definition's name at the registry, a preset's label where a document
  // is built, validated or published, a status's text at the run.
  failing: (door) => ({
    value: { fr: "Titre" },
    where: door === "registry" ? "i18n.name" : door === "run" ? "status.i18n" : "presets[lore].label",
    required: true
  })
});
var enablementVerdict2 = defineVerdict2({
  id: "core:verdict/enablement",
  law: "U5e",
  doors: ["list", "fire"],
  judge({ preds, doc }) {
    const heard = evaluateEnabledWhen2(preds, doc);
    return heard.enabled ? { ok: true } : { ok: false, sentence: heard.reason };
  },
  failing: () => ({
    preds: [
      {
        on: "state.world.conformance",
        truthy: true,
        reason: { en: "conformance: the enabled-when predicate refused this press" }
      }
    ],
    doc: { state: { world: { conformance: false } } }
  })
});
var audienceVerdict2 = defineVerdict2({
  id: "core:verdict/audience",
  law: "R-15",
  doors: ["list", "fire"],
  judge({ name, refs, portrayals, viewer, item }) {
    if (audienceHolds2(refs, portrayals, viewer, item))
      return { ok: true };
    return {
      ok: false,
      sentence: `'${name}' is not yours to use here \u2014 its audience is ${refs.length ? refs.join(", ") : "nobody"}.`
    };
  },
  failing: () => ({
    name: "grant",
    refs: ["owner"],
    portrayals: { owner: { by: "person", userId: "1" } },
    viewer: { userId: 2 }
  })
});
var isSettingsAddress2 = (name) => typeof name === "string" && (name === SETTINGS_SLOT2 || name.startsWith(`${SETTINGS_SLOT2}.`));
var settingsTravelVerdict2 = defineVerdict2({
  id: "core:verdict/settings-travel",
  law: "F39",
  doors: ["registry", "validate", "run"],
  judge(input) {
    switch (input.kind) {
      case "edge": {
        if (!isSettingsAddress2(input.fromPort))
          return { ok: true };
        const { from, fromPort, to, toPort } = input;
        return {
          ok: false,
          sentence: `'${to}.${toPort}' reads '${from}.${fromPort}' \u2014 a setting, not a port; settings never travel, only data does`,
          fix: `wire a port '${from}' publishes (what it DID with the setting), or declare the value '${to}' needs on its own params and share the owner's with slot.params({ node: '${from}' }) \u2014 the substrate's switches (enabled, review, mode) are read at their owner by the executor and are never a value`
        };
      }
      case "reference": {
        if (!isSettingsAddress2(input.slot))
          return { ok: true };
        const { node, key, target } = input;
        return {
          ok: false,
          sentence: `'${node}.${key}' references '${target}.${SETTINGS_SLOT2}' \u2014 the substrate's switches, read at their owner by the executor and never a value; settings never travel, only data does`,
          fix: `read a port '${target}' publishes, or declare the value '${node}' needs on its own params and share the owner's with slot.params({ node: '${target}' }) \u2014 a switch (enabled, review, mode) belongs to no reference`
        };
      }
      case "port": {
        if (!isSettingsAddress2(input.port))
          return { ok: true };
        const { definitionId, port } = input;
        return {
          ok: false,
          sentence: `${definitionId} declares an out-port named '${port}'. '<node>.${SETTINGS_SLOT2}' (and paths under it) is the address of the substrate's own switches \u2014 \`enabled\`, \`review\`, \`mode\` \u2014 which the executor reads at the node and hands to nobody (F39: settings never travel), so an edge from a port of that name would be refused as a setting`,
          fix: `name the port for what it publishes ('result', 'applied', 'chosen')`
        };
      }
      default:
        return {
          ok: false,
          sentence: `'${String(input.kind)}' is not a shape this verdict judges \u2014 one of 'edge', 'reference', 'port'.`
        };
    }
  },
  failing: (door) => door === "registry" ? { kind: "port", definitionId: "conformance:task/claims-settings-port@1", port: "settings.review" } : door === "run" ? { kind: "reference", node: "probe", key: "main", slot: SETTINGS_SLOT2, target: "save" } : { kind: "edge", from: "save", fromPort: `${SETTINGS_SLOT2}.review`, to: "probe", toPort: "main" }
});
var provisionalVerdict2 = defineVerdict2({
  id: "core:verdict/provisional",
  law: "R-2",
  doors: ["validate", "run", "registry"],
  judge(input) {
    switch (input.kind) {
      case "placement": {
        if (!input.provisional)
          return { ok: true };
        const { nodeKey, definitionId, definitionVersion } = input;
        return {
          ok: false,
          sentence: `'${nodeKey}' places ${definitionId}@${definitionVersion}, which is provisional \u2014 declared, not bound: no handler runs it in this release (R-2)`,
          fix: "bind it or remove the node"
        };
      }
      case "publication": {
        if (input.provisional || input.bound)
          return { ok: true };
        return {
          ok: false,
          sentence: `${input.definitionId} is published with no handler behind it and no plan claiming it \u2014 declared, not bound (R-2)`,
          fix: "bind it in bindings.ts, mark it `provisional: true` under the plan that owns it, or cull it"
        };
      }
      default:
        return {
          ok: false,
          sentence: `'${String(input.kind)}' is not a shape this verdict judges \u2014 one of 'placement', 'publication'.`
        };
    }
  },
  failing: (door) => door === "registry" ? { kind: "publication", definitionId: "core:task/stray-unbound@1", provisional: false, bound: false } : {
    kind: "placement",
    nodeKey: "pending",
    definitionId: "conformance:oracle/pending",
    definitionVersion: 1,
    provisional: true
  }
});

// ../serene-pub-sdk/sdk/dist/variables.js
var variables2 = /* @__PURE__ */ new Map();
function defineVariable2(decl2) {
  const existing = variables2.get(decl2.id);
  if (existing)
    refuseUnlessIdentical2(existing, decl2, `duplicate variable id: ${decl2.id}`);
  variables2.set(decl2.id, decl2);
  return decl2;
}
var getVariable2 = (id) => variables2.get(id);
var allVariables2 = () => [...variables2.values()];
var CHARACTER_CARD2 = {
  type: "object",
  fields: {
    name: { type: "string", description: { en: "What the character is called in the prompt." } },
    nickname: {
      type: "string",
      optional: true,
      description: { en: "Their short name, when they have one." }
    },
    description: {
      type: "string",
      optional: true,
      description: { en: "Who they are." }
    },
    personality: {
      type: "string",
      optional: true,
      description: { en: "How they behave. Absent for a non-speaker when the session shows brief character detail." }
    }
  }
};
var ash2 = {
  name: "Ash",
  nickname: "Ash",
  description: "A rider who patrols the ash wastes.",
  personality: "Terse, loyal, slow to trust."
};
var brannoc2 = {
  name: "Brannoc",
  description: "A caravan master who has crossed the wastes eleven times.",
  personality: "Genial, and counting."
};
var varInstructions2 = defineVariable2({
  id: "core:var/instructions@1",
  i18n: { name: { en: "Instructions" } },
  description: {
    en: "The system instructions for the reply, after macros are substituted."
  },
  scope: { instructions: { type: "string" } },
  // Already interpolated, because that is how it arrives: macros expand
  // upstream, and a sample still carrying `{{char}}` would read as a preview
  // showing that macros do not work.
  sample: "You are Ash. Stay in character and never speak for Rell."
});
var varCharacters2 = defineVariable2({
  id: "core:var/characters@1",
  i18n: { name: { en: "Characters" } },
  description: {
    en: "Everyone in the scene except the user, with their descriptions."
  },
  scope: { characters: { type: "list", of: CHARACTER_CARD2 } },
  sample: [ash2, brannoc2]
});
var varPersonas2 = defineVariable2({
  id: "core:var/personas@1",
  i18n: { name: { en: "Personas" } },
  // Two fields. A persona's private lore is Assemble's `characterLore`, like
  // every cast member's, never a field of this card.
  //
  // `description` is optional for a different reason than a character's is:
  // personas are built by hand in `resolveContextInput` and never go through
  // `compileCharacter`, so nothing strips a null. The key is always present
  // and its value can be null, which a template cannot tell from absent.
  description: { en: "Who the user is playing, as the prompt sees them." },
  scope: {
    personas: {
      type: "list",
      of: {
        type: "object",
        fields: {
          name: { type: "string" },
          description: { type: "string", optional: true }
        }
      }
    }
  },
  sample: [{ name: "Rell", description: "A cartographer looking for a way north." }]
});
var varScenario2 = defineVariable2({
  id: "core:var/scenario@1",
  i18n: { name: { en: "Scenario" } },
  description: { en: "The situation the scene opens in." },
  scope: { scenario: { type: "string" } },
  sample: "The caravan has stopped at the edge of the wastes."
});
var varExampleDialogue2 = defineVariable2({
  id: "core:var/example-dialogue@1",
  i18n: { name: { en: "Example dialogue" } },
  description: { en: "Sample exchanges that show the model how the characters speak." },
  scope: { exampleDialogue: { type: "string" } },
  // Interpolated, like `instructions` — the speaker's name is already
  // substituted by the time a layout sees this.
  sample: 'Ash: "Ash in the water again."'
});
var varPostHistoryInstructions2 = defineVariable2({
  id: "core:var/post-history-instructions@1",
  i18n: { name: { en: "Post-history instructions" } },
  description: {
    en: "The reminder placed next to the generation point, after the conversation."
  },
  scope: { postHistoryInstructions: { type: "string" } },
  sample: "Stay in character and write one paragraph."
});
var varCharacterNames2 = defineVariable2({
  id: "core:var/character-names@1",
  i18n: { name: { en: "Character names" } },
  description: { en: "Just the names of the characters in the scene." },
  // A **string**, not a list. `joinWithAnd` runs upstream, so what a layout
  // receives is already "Ash and Brannoc" — and declaring it as a list would
  // be the same class of lie the hand-written preview data used to tell about
  // `worldLore`: a template written against it looks right in the editor and
  // renders wrong in a chat. Saying `type: 'string'` is the first time the
  // declaration has been able to state this rather than leave it to a comment.
  scope: { characterNames: { type: "string" } },
  sample: "Ash and Brannoc"
});
var varPersonaNames2 = defineVariable2({
  id: "core:var/persona-names@1",
  i18n: { name: { en: "Persona names" } },
  description: { en: "Just the names of the user's personas in the scene." },
  scope: { personaNames: { type: "string" } },
  sample: "Rell"
});
var varWorldLore2 = defineVariable2({
  id: "core:var/world-lore@1",
  i18n: { name: { en: "World lore" } },
  description: {
    en: "Lorebook entries about the world that fit the budget, keyed by entry name."
  },
  // `'any'` could not say this, and the shape it could not say is exactly the
  // one a hand-written preview got wrong once already.
  scope: { worldLore: { type: "record", of: { type: "string" } } },
  sample: {
    "The Ashguard": "Riders who patrol the ash wastes.",
    "The Long Winter": "Nine years without a thaw."
  }
});
var varHistory2 = defineVariable2({
  id: "core:var/history@1",
  // "Story history" until 0.6. It is a *list of dated history entries*, and
  // calling it a story invited people to look for the story — the summary of
  // the chat so far, which is a different feature that does not exist here.
  i18n: { name: { en: "History entries" } },
  description: {
    en: "Earlier events from the chat that fit the budget, newest first, keyed by date."
  },
  scope: { history: { type: "record", of: { type: "string" } } },
  sample: {
    "Year 412, Month 3": "The caravan reached the wastes.",
    "Year 412, Month 1": "Ash left the Ashguard."
  }
});
var varDocsExcerpts2 = defineVariable2({
  id: "core:var/docs-excerpts@1",
  i18n: { name: { en: "Documentation excerpts" } },
  description: {
    en: "Documentation sections that match the latest question and fit the budget, keyed by page and section; each starts with the page path."
  },
  scope: { docsExcerpts: { type: "record", of: { type: "string" } } },
  sample: {
    "Connections \u203A Adding and removing by hand": "Path: /docs/connections#adding-and-removing-by-hand\nOpen Connections and choose Add\u2026"
  }
});
var varRecalledLines2 = defineVariable2({
  id: "core:var/recalled-lines@1",
  i18n: { name: { en: "Recalled lines" } },
  description: {
    en: "Earlier lines of the conversation that name what the scene is naming now and fit the budget, oldest first \u2014 each with its speaker, turn and text."
  },
  scope: {
    recalledLines: {
      type: "list",
      of: {
        type: "object",
        fields: {
          speaker: { type: "string", description: { en: "Who said it." } },
          turn: {
            type: "number",
            description: {
              en: "The line's position in its channel's conversation, counting from 1."
            }
          },
          text: { type: "string", description: { en: "What was said." } }
        }
      }
    }
  },
  sample: [
    { speaker: "Mira", turn: 12, text: "I hid the brass key under the chapel floor." },
    { speaker: "Ada", turn: 31, text: "The chapel? Mira, the chapel burned." }
  ]
});
var CHARACTER_LORE_ENTRY2 = {
  type: "object",
  fields: {
    title: { type: "string", description: { en: "The entry\u2019s title." } },
    castMember: {
      type: "string",
      optional: true,
      description: { en: "Whose lore it is. Absent when the entry is bound to nobody." }
    },
    content: { type: "string", description: { en: "What the entry says." } }
  }
};
var varCharacterLore2 = defineVariable2({
  id: "core:var/character-lore@1",
  i18n: { name: { en: "Character lore" } },
  description: {
    en: "Lore bound to a cast member that fit the budget: each entry\u2019s title, whose it is, and its text."
  },
  scope: { characterLore: { type: "list", of: CHARACTER_LORE_ENTRY2 } },
  sample: [
    { title: "The Ashguard brand", castMember: "Ash", content: "Carries a brand from the Ashguard." }
  ]
});
var RELATIONSHIP2 = {
  type: "object",
  fields: {
    type: { type: "string", description: { en: "What the relationship is." } },
    secrecy: {
      type: "string",
      description: { en: 'Who knows about it \u2014 "Only I know", "We both know", and so on.' }
    },
    status: {
      type: "string",
      optional: true,
      description: { en: "Only present when it is something other than active." }
    },
    theirState: {
      type: "string",
      optional: true,
      description: { en: "The other party's node state, when it is not active." }
    },
    note: { type: "string", optional: true, description: { en: "The written detail." } }
  }
};
var BY_OTHER2 = { type: "record", of: { type: "list", of: RELATIONSHIP2 } };
var varRelationshipsPerspectives2 = defineVariable2({
  id: "core:var/relationships-perspectives@1",
  i18n: { name: { en: "Relationships: their perspective" } },
  description: {
    en: "How the speaking character regards each of the others, from the narrative graph."
  },
  scope: {
    relationshipsPerspectives: {
      ...BY_OTHER2,
      description: { en: "How the speaker regards each other character." }
    }
  },
  sample: {
    Brannoc: [
      {
        type: "wary respect",
        secrecy: "Only I know",
        note: "Ash has never forgotten who opened the lower gate."
      }
    ]
  }
});
var varRelationshipsKnown2 = defineVariable2({
  id: "core:var/relationships-known@1",
  i18n: { name: { en: "Relationships: how others see them" } },
  description: {
    en: "How the others regard the speaking character, plus any figures the world knows of."
  },
  scope: {
    relationshipsKnown: {
      type: "object",
      fields: {
        howOthersRegardYou: {
          ...BY_OTHER2,
          optional: true,
          description: { en: "How each other character regards the speaker." }
        },
        legendaryFigures: {
          type: "record",
          optional: true,
          description: { en: "Figures the world knows of, and their public relationships." },
          of: {
            type: "object",
            fields: {
              summary: { type: "string", optional: true },
              state: { type: "string", optional: true },
              relationships: { ...BY_OTHER2, optional: true }
            }
          }
        }
      }
    }
  },
  sample: {
    howOthersRegardYou: {
      Rell: [
        {
          type: "debt",
          secrecy: "We both know",
          status: "evolved",
          note: "Rell owes Ash for the crossing."
        }
      ]
    }
  }
});
var varCurrentDate2 = defineVariable2({
  id: "core:var/current-date@1",
  i18n: { name: { en: "Current date" } },
  description: {
    en: "The story's present date: the lorebook's clock when it is set, else the most recent history entry."
  },
  /**
   * ⚠ Was `{ currentDate: { type: 'string' } }` with the sample
   * `'Year 412, Month 3'`, and the sample was **wrong** — the value arrived
   * pre-formatted by `formatDate` as `412-03`, so the preview showed a
   * rendering the prompt never contained. That is the failure mode a sample
   * exists to prevent, and it happened because the shape was a finished
   * string: nothing could disagree with the formatting, so nothing did.
   *
   * The parts travel separately now and the layout joins them, which is what
   * makes "state the date differently" a setting rather than a code change.
   * `month` and `day` are absent rather than null when the entry has no such
   * precision — `{{#if (isSet …)}}` is what a layout tests.
   */
  scope: {
    currentDate: {
      type: "object",
      fields: {
        year: { type: "number", description: { en: "The story year." } },
        month: {
          type: "number",
          optional: true,
          description: { en: "Absent when the entry is only dated to a year." }
        },
        day: {
          type: "number",
          optional: true,
          description: { en: "Absent when the entry is only dated to a month." }
        },
        hour: {
          type: "number",
          optional: true,
          description: { en: "The clock's hour (0\u201323), when the present has a time of day." }
        },
        minute: {
          type: "number",
          optional: true,
          description: { en: "The clock's minute, when the present has a time of day." }
        },
        label: {
          type: "string",
          optional: true,
          description: {
            en: "The date spelled through the lorebook's calendar; absent when the book is free-form."
          }
        }
      }
    }
  },
  sample: { year: 412, month: 3, day: 5 }
});

// ../serene-pub-sdk/sdk/dist/bands.js
var IDENTIFIER2 = /^[A-Za-z_][A-Za-z0-9_]*$/;
var isBandKey2 = (key) => IDENTIFIER2.test(key);
function bandKeySuggestion2(key) {
  const camel = key.replace(/[^A-Za-z0-9_]+(.)?/g, (_, c) => c ? c.toUpperCase() : "").replace(/^[^A-Za-z_]+/, "");
  return camel || "band";
}
var ASSEMBLE_OWN_TEMPLATE_NAMES2 = [
  "sessionMessages",
  "injectionsByIndex",
  "budget",
  "postHistory",
  "blocks",
  "prompts"
];
var variableIdOf2 = (v2) => typeof v2 === "string" ? v2 : v2?.id;
var otherVariableRendering2 = (key, id) => allVariables2().find((v2) => v2.id !== id && v2.id.startsWith("core:") && Object.prototype.hasOwnProperty.call(v2.scope, key));
function checkBandDeclarations2(d, others) {
  const bands = d.bands;
  for (const key of Object.keys(d.bandPorts ?? {}))
    if (!bands || !Object.prototype.hasOwnProperty.call(bands, key))
      throw new Error(`'${d.id}' names band '${key}' in bandPorts but does not declare it in bands. Declare it (bands: { ${key}: varMyBand }), or drop it from bandPorts.`);
  if (!bands)
    return;
  for (const [key, decl2] of Object.entries(bands)) {
    if (!isBandKey2(key))
      throw new Error(`'${d.id}' declares band '${key}': a band key is a top-level template name, so it must be an identifier \u2014 letters, digits and '_', not starting with a digit. Rename it '${bandKeySuggestion2(key)}', and emit that same key from bandIntent() and as each candidate's source.`);
    const id = variableIdOf2(decl2);
    if (!id || !decl2 || typeof decl2 !== "object")
      throw new Error(`'${d.id}' declares band '${key}' without a variable. Declare one with definePluginVariable() (defineVariable() in core) whose scope names '${key}', and pass the declaration: bands: { ${key}: varMyBand }.`);
    const registered = getVariable2(id);
    if (!registered)
      throw new Error(`'${d.id}' declares band '${key}' with variable '${id}', which is not registered. Declare it with definePluginVariable() (defineVariable() in core) before the definition that names it \u2014 the layout picker and the template editor read it from the registry.`);
    if (!Object.prototype.hasOwnProperty.call(registered.scope, key))
      throw new Error(`'${d.id}' declares band '${key}' with variable '${id}', whose scope does not declare '${key}' (it declares ${Object.keys(registered.scope).map((k) => `'${k}'`).join(", ") || "nothing"}). A layout renders the band as {{{${key}}}}, so add '${key}' to the variable's scope \u2014 or rename the band to the key the variable declares.`);
    if (ASSEMBLE_OWN_TEMPLATE_NAMES2.includes(key))
      throw new Error(`'${d.id}' declares band '${key}', which collides with Assemble's own '${key}' \u2014 a template reading {{{${key}}}} would get one or the other depending on order. Rename the band.`);
    const core = otherVariableRendering2(key, id);
    if (core)
      throw new Error(`'${d.id}' declares band '${key}' as '${id}', which collides with '${core.id}' \u2014 that variable already renders the top-level name '${key}'. A band key means one thing; rename the band.`);
    const ports = d.bandPorts?.[key];
    if (ports !== void 0) {
      const out = Object.keys(d.ports?.out ?? {});
      const unknown = ports.filter((p) => !out.includes(p));
      if (!ports.length || unknown.length)
        throw new Error(`'${d.id}' says band '${key}' is carried on ` + (ports.length ? `${unknown.map((p) => `'${p}'`).join(", ")}, which ${unknown.length === 1 ? "is not an out-port" : "are not out-ports"} it declares` : "no out-port at all") + ` (it declares ${out.map((p) => `'${p}'`).join(", ") || "none"}). Name the out-ports that publish the band's candidates in bandPorts, or leave '${key}' out of bandPorts if every out-port may carry it.`);
    }
    for (const other of others) {
      if (other.id === d.id)
        continue;
      const theirs = variableIdOf2(other.bands?.[key]);
      if (theirs && theirs !== id)
        throw new Error(`'${d.id}' declares band '${key}' as '${id}', but '${other.id}' already declares '${key}' as '${theirs}'. A band key is a top-level template name and means one thing \u2014 rename one of the two bands.`);
    }
  }
}

// ../serene-pub-sdk/sdk/dist/events.js
var bySlug2 = /* @__PURE__ */ new Map();
var nextId2 = 1;
function defineEvent2(def) {
  const existing = bySlug2.get(def.slug);
  const e = { ...def, id: existing?.id ?? nextId2, ownerPluginId: null };
  if (existing)
    refuseUnlessIdentical2(existing, e, `duplicate event slug '${def.slug}' \u2014 slugs are unique because they are the reference used to sync seeded rows across pubs (13 \xA77g)`);
  if (def.family === "action" && def.causedBy?.length) {
    throw new Error(`action event '${def.slug}' declares causedBy. Action events are requests, not consequences of a write \u2014 that is what keeps them out of the cycle graph (13 \xA77)`);
  }
  if (def.declaredRoot && def.causedBy?.length) {
    throw new Error(`event '${def.slug}' is a declared root and declares causedBy \u2014 a root starts outside every pipeline, so nothing writes it. Drop one of the two`);
  }
  if (!existing)
    nextId2++;
  bySlug2.set(def.slug, e);
  return e;
}
function eventById2(id) {
  const m = /^core:event\/([a-z0-9]+(?:-[a-z0-9]+)*)@(\d+)$/.exec(id);
  if (!m)
    return packageEventViews2.get(id);
  const e = bySlug2.get(m[1]);
  return e && String(e.version) === m[2] ? e : void 0;
}
var notADeclaredEvent2 = (id) => `'${id}' is not a declared event \u2014 core defines its own, and a package declares one with defineSessionEvent({ id, payload, \u2026 }) and names it in defineExtension({ events }).`;
var packageEventViews2 = /* @__PURE__ */ new Map();
var MAX_RECORDED_PAYLOAD_BYTES2 = 64 * 1024;
var CORE_EVENTS2 = {
  messageCreated: defineEvent2({
    slug: "message-created",
    name: { en: "Message written" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/create-message", "core:outlet/seed-greetings"],
    description: "A message was written into a session."
  }),
  /**
   * A row was finished or rewritten by a pipeline's own write. A regenerate,
   * a swipe's fresh alternative and an extend are THIS event with `verb`
   * on the payload — `regenerate` · `swipe` · `extend` — rather than three
   * events of their own (R-15, 2026-09-16): each is the genre's pipeline
   * producing text plus core's rewrite of the row, and the rewrite is one
   * outlet. A plain reply's finishing write carries no `verb`.
   */
  messageUpdated: defineEvent2({
    slug: "message-updated",
    name: { en: "Message changed" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/update-message", "core:outlet/attach-image", "core:outlet/attach-audio"],
    payload: S2.sessionChange,
    description: "An existing message was changed."
  }),
  // ── The built-in writes (R-15, 2026-09-16) — DATA family, each caused ──
  // by the core outlet that performs it. Every one carries what changed
  // and what was lost, lands on the receipt as `emitted`, and is written to
  // the session's changes so the next reply's inlet publishes it.
  messageDeleted: defineEvent2({
    slug: "message-deleted",
    name: { en: "Message deleted" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/delete-message"],
    payload: S2.sessionChange,
    description: "A message was deleted. The payload carries what was lost \u2014 its content, role, speaker and metadata."
  }),
  messageHidden: defineEvent2({
    slug: "message-hidden",
    name: { en: "Message hidden or shown" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/hide-message"],
    payload: S2.sessionChange,
    description: "A message was hidden from the prompt, or shown again. The payload says which."
  }),
  messageEdited: defineEvent2({
    slug: "message-edited",
    name: { en: "Message edited" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/edit-message"],
    payload: S2.sessionChange,
    description: "A person rewrote a settled message. The payload carries the previous content."
  }),
  messageSwiped: defineEvent2({
    slug: "message-swiped",
    name: { en: "Message swiped" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/swipe-message"],
    payload: S2.sessionChange,
    description: "A different alternative of a message was selected, or a new one recorded. The payload carries the alternative that was showing and the index now selected."
  }),
  /**
   * A line's **shown sprite** changed (DESIGN-sprites §5.2): a sprite picker
   * chose one after a reply, or a person changed it from the message menu.
   * The payload names the line, the speaker, the `{ set, label }` now shown
   * (null for none) and `source` — `picker` or `person`. What TTS line
   * direction and any face-driven widget listen for.
   */
  spriteShown: defineEvent2({
    slug: "sprite-shown",
    name: { en: "Sprite shown" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/show-sprite"],
    payload: S2.sessionChange,
    description: "A line's sprite changed \u2014 chosen by a sprite picker after a reply, or by a person. The payload carries the set and label now shown and who chose it."
  }),
  /**
   * Stop is not a write outlet: it is the run-level guarantee (R-17) —
   * core finalises the row a cancelled run was filling — so it has no
   * `causedBy`. Emitted by the host from that finalisation, and from the
   * message's own Stop when it releases the row first.
   */
  messageStopped: defineEvent2({
    slug: "message-stopped",
    name: { en: "Reply stopped" },
    version: 1,
    family: "data",
    affectsUser: true,
    payload: S2.sessionChange,
    description: "A reply was stopped while it was being written. The payload carries how much text had arrived."
  }),
  sessionBranched: defineEvent2({
    slug: "session-branched",
    name: { en: "Session branched" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/branch-session"],
    payload: S2.sessionChange,
    description: "A session was branched at a message into a new session. The payload names the new session and the message it forked from."
  }),
  // ── Turn order as event-driven state (PLAN-turn-order §4.1, 2026-09-21) ──
  // The four events the turn-order spec answers or causes. Every session
  // event's payload carries a `cause` (`EventCause`): who or what fired
  // it, which is what the auto-advance listener keys on.
  /**
   * A row that is **not generating** landed: a user send, a seeded
   * greeting, a finalised reply, a stopped reply. Never for a placeholder
   * or a generating row — the reply's *completion* is the fact, not its
   * opening. Distinct from `message-created` (which fires at the write,
   * placeholder included) and `message-updated` (which also fires on an
   * attach): this is the one event that means "there is a new settled
   * turn to answer".
   */
  messageCompleted: defineEvent2({
    slug: "message-completed",
    name: { en: "Message completed" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: [
      "core:outlet/create-message",
      "core:outlet/seed-greetings",
      "core:outlet/update-message"
    ],
    payload: S2.sessionChange,
    description: "A message finished landing \u2014 a send, a seeded greeting, a finished or stopped reply. Never a placeholder or a row still being written."
  }),
  /**
   * A seated participant's row changed — switched on or off (`active`),
   * `position` or portrayal. Not add or remove: those stay
   * `member-added` / `member-removed`. No `causedBy`: the cast toggles are
   * socket writes, not an outlet's.
   */
  castChanged: defineEvent2({
    slug: "cast-changed",
    declaredRoot: true,
    name: { en: "Cast changed" },
    version: 1,
    family: "data",
    affectsUser: true,
    payload: S2.castChange,
    description: "A session character, persona or envoy row changed \u2014 switched on or off, position or portrayal. The payload names the participant and what moved."
  }),
  /**
   * The session row changed. Two origins: a person's settings write
   * (`sessions:update` and the other settings sockets — name, scenario,
   * lorebook, genre fields, preset, channels, tags; cause `settings`), and
   * `core:outlet/advance-story-clock`, which moves the session's story
   * clock (`changed: ['storyClock']`, cause `run`). The payload's `changed`
   * lists the fields by name. `causedBy` names the outlet, so the event map
   * draws the edge a spec bound here that advances the clock would loop
   * on; it is therefore not a declared root, though a person's write also
   * starts it (as the auto-advance listener also causes `message-respond`).
   * ⚠ Never emitted by `writeTurnOrder`, which is raw SQL for exactly this
   * reason (§3).
   */
  sessionUpdated: defineEvent2({
    slug: "session-updated",
    name: { en: "Session updated" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/advance-story-clock"],
    payload: S2.sessionChange,
    description: "The session's settings changed \u2014 name, scenario, lorebook, genre fields, preset, channels or tags \u2014 or a pipeline moved its story clock. The payload lists which."
  }),
  /**
   * `metadata.turnOrder` was written by `core:outlet/set-turn-order@1`.
   * **Core-internal**: the auto-advance listener and the
   * `sessions:turnOrder` push read it; `genre()` refuses it in a genre's
   * `events`, so no preset can bind a spec to it and the recompute cannot
   * feed itself.
   */
  turnOrderChanged: defineEvent2({
    slug: "turn-order-changed",
    name: { en: "Turn order changed" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/set-turn-order"],
    payload: S2.turnOrderChanged,
    description: "The session's turn order was recomputed and written. The payload carries the order as written and the cause that led to it."
  }),
  /**
   * A pipeline's annex entry changed: "my state changed", for any genre.
   * A package writes its annex through `core:outlet/set-session-annex@1`
   * and binds this; for a named happening of its own it declares an event
   * and records it. Emitted only
   * when the merged value differs from the stored one, so a spec that
   * rewrites the same value cannot feed itself; the lineage caps stop the
   * rest.
   */
  annexChanged: defineEvent2({
    slug: "annex-changed",
    name: { en: "Annex changed" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/set-session-annex", "core:outlet/set-annex-field"],
    payload: S2.annexChange,
    description: "A pipeline's own session state changed \u2014 its annex entry. The payload names the owner whose entry moved."
  }),
  /**
   * Not a write's event: the marker the `sessionChanges` list ends with when
   * more than fifty changes waited between two replies (U5b review S1). The
   * newest fifty are delivered and this one entry says how many older ones
   * were not, so a pipeline can tell a full list from a truncated one. Never
   * written to `session_changes` and never on a receipt's `emitted` — no
   * `causedBy`, because no outlet causes it.
   */
  sessionChangesTruncated: defineEvent2({
    slug: "session-changes-truncated",
    name: { en: "Session changes truncated" },
    version: 1,
    family: "data",
    affectsUser: false,
    payload: S2.sessionChange,
    description: "More session changes waited than one reply is handed. The newest fifty were delivered; the payload says how many older ones were dropped."
  }),
  /**
   * A **form** — a `choices` or `form` block a message carries — was
   * addressed to a participant the AI portrays this turn (R-15 *Forms*;
   * R-21 (5); 30 §U5d). Caused by the write that carried the block, and
   * dispatched through the same path as the lifecycle events, so every
   * answer run is a child of the run that asked (`parentRunId`,
   * `rootRunId`, `depth`) and 01 §8's cycle caps hold: a form whose answer
   * asks another form stops at the depth cap, receipted. A form addressed
   * to a person is no event: the block waits for the click.
   */
  formAddressed: defineEvent2({
    slug: "form-addressed",
    name: { en: "Form addressed" },
    version: 1,
    family: "data",
    affectsUser: false,
    causedBy: ["core:outlet/create-message", "core:outlet/update-message"],
    payload: S2.formAddressed,
    description: "A question or form in a message was addressed to a participant the AI portrays this turn \u2014 the genre's answer pipeline answers it. The payload names the message, the block, the action and the addressee."
  }),
  /**
   * A form was **answered** — by a click, or by the answer pipeline's
   * outlet committing an oracle's answer exactly as a click would. Lands in
   * the session's changes so the next reply's inlet sees it (`answer`,
   * `addressee`, `blockId`, `action` on the payload).
   */
  formAnswered: defineEvent2({
    slug: "form-answered",
    name: { en: "Form answered" },
    version: 1,
    family: "data",
    affectsUser: false,
    causedBy: ["core:outlet/answer-form"],
    payload: S2.sessionChange,
    description: "A question or form in a message was answered. The payload carries the answer, who answered as whom, and the action it fired."
  }),
  /**
   * A form was **superseded** (plans/29 R-15 *Staleness and order*; 30
   * §U5f): the channel head moved past the turn it was issued at before it
   * was answered, and a press on it reached the door. Recorded ONCE per
   * block, the first time the door sees it stale, so the next reply's
   * inlet learns the question lapsed — not on every render, and never by a
   * render. No outlet causes it: the door does, like the truncation marker.
   */
  formSuperseded: defineEvent2({
    slug: "form-superseded",
    name: { en: "Form superseded" },
    version: 1,
    family: "data",
    affectsUser: false,
    payload: S2.sessionChange,
    description: "A question or form in a message was overtaken \u2014 the conversation moved on before it was answered, and a press on it was refused. The payload names the message and the block."
  }),
  loreEntryCreated: defineEvent2({
    slug: "lore-entry-created",
    name: { en: "Lore entry written" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/create-lore-entry"],
    description: "A lorebook entry was written."
  }),
  /**
   * Two lore entries were linked (L2, 2026-09-17) — a room's exit, who keeps
   * what, what stands near what.
   *
   * Its own event rather than `lore-entry-created`: a link is not an entry,
   * nothing about it is created or changed, and a subscriber that wants to
   * redraw a map wants exactly this and none of the writes that make rows.
   *
   * ⚠ It declares no payload shape — it rides the run's receipt as caused by
   * the outlet, and the link itself (its name, its words both ways) is the
   * outlet's `linkId` row, read where it is needed (places plan B2,
   * 2026-09-29). An idempotent repeat that found the standing row wrote
   * nothing, and causes no event (`written: false`).
   */
  loreLinkCreated: defineEvent2({
    slug: "lore-link-created",
    name: { en: "Lore entries linked" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/link-lore-entries"],
    description: "Two lorebook entries were linked."
  }),
  graphProposalCreated: defineEvent2({
    slug: "graph-proposal-created",
    name: { en: "Graph proposal filed" },
    version: 1,
    family: "data",
    affectsUser: true,
    causedBy: ["core:outlet/graph-proposal"],
    description: "A narrative-graph proposal was filed for review."
  }),
  // ── The session lifecycle (24 §5) — ACTION family: a person did it ──────
  /** The create slot — required; exactly one pipeline per genre answers it. */
  sessionCreated: defineEvent2({
    slug: "session-created",
    declaredRoot: true,
    name: { en: "Session created" },
    version: 1,
    family: "action",
    affectsUser: false,
    description: "A session was created \u2014 the genre's create pipeline answers this."
  }),
  /** The primary turn. A swipe is this pipeline re-run, not a new event. */
  messageRespond: defineEvent2({
    slug: "message-respond",
    declaredRoot: true,
    name: { en: "Reply" },
    version: 1,
    family: "action",
    affectsUser: true,
    description: "A reply was asked for \u2014 the primary turn of a session."
  }),
  /** Arbitrary buttons/triggers — the contributed functions surface (19 §3). */
  sessionAction: defineEvent2({
    slug: "session-action",
    declaredRoot: true,
    name: { en: "Action" },
    version: 1,
    family: "action",
    affectsUser: true,
    description: "A person triggered a contributed action in a session."
  }),
  memberAdded: defineEvent2({
    slug: "member-added",
    declaredRoot: true,
    name: { en: "Member joined" },
    version: 1,
    family: "action",
    affectsUser: false,
    // A seat is a cast change (R31): `change: 'added'`, `ref` the member.
    payload: S2.castChange,
    description: "A character, persona or envoy joined a session; the payload carries which."
  }),
  memberRemoved: defineEvent2({
    slug: "member-removed",
    declaredRoot: true,
    name: { en: "Member left" },
    version: 1,
    family: "action",
    affectsUser: false,
    // An unseat is a cast change (R31): `change: 'removed'`, `ref` the member.
    payload: S2.castChange,
    description: "A character, persona or envoy left a session; the payload carries which."
  }),
  /**
   * A UI action asked for a run (13 §7). Carrying both users is what answers the
   * budget-owner question without a separate rule: **budget and quota attach to the
   * owner; the receipt's attribution records the trigger.** Group sessions need no
   * special case.
   *
   * ⏳ Overlaps `session-action` since the fold (a contributed action IS a UI
   * action). Kept because ruling 49 (`UiActionPayload`, the owner/trigger
   * split) has no other home yet; nothing subscribes to it. Retire when the
   * action model (30 §U5) gives the payload one.
   */
  uiAction: defineEvent2({
    slug: "ui-action",
    name: { en: "Interface action" },
    version: 1,
    family: "action",
    affectsUser: true,
    description: "Someone asked for a run from the interface \u2014 a composer action, a message action, a re-roll. Payload: sessionId, ownerUserId, actorUserId, action, modeId, input."
  }),
  /**
   * The path for scheduled model work (13 §7c). No callable may call an oracle
   * (F32), and lifecycle callbacks may not trigger pipelines, so nightly
   * summarization subscribes here instead — which also puts it on the consent
   * screen, where a lifecycle callback doing the same work would have been
   * invisible. Serene Pub emits it hourly (`cadence: 'hourly'`, `scheduledFor`
   * the ISO instant it was due, `scope: 'pub'`), only to subscribed,
   * granted listeners; `SCHEDULED_WORK_PATH` names it.
   */
  scheduleTick: defineEvent2({
    slug: "schedule-tick",
    name: { en: "Schedule tick" },
    version: 1,
    family: "action",
    affectsUser: false,
    description: "A declared cadence elapsed. Payload: cadence, scheduledFor, scope."
  })
};

// ../serene-pub-sdk/sdk/dist/widgets.js
var MESSAGE_HOST_FIELDS2 = Object.freeze([
  "userId",
  "queueItemId",
  "debugMeta",
  "embedding",
  "embeddingModel",
  "embeddingSourceHash",
  "embedTextHash",
  "vectorizedAt",
  "version"
]);
var HOST_FIELD_SET2 = new Set(MESSAGE_HOST_FIELDS2);
var WIDGET_SCOPED_SECTIONS2 = Object.freeze({
  "session:full": "session_full",
  "session:state": "session_state",
  persona: "persona",
  characters: "characters",
  lore: "lore"
});
var SCOPED_SECTION_NAMES2 = new Set(Object.values(WIDGET_SCOPED_SECTIONS2));
var isWidgetScopedSectionName2 = (name) => typeof name === "string" && SCOPED_SECTION_NAMES2.has(name);
var BASE_SECTIONS2 = {
  layout: true,
  session: true,
  channels: true,
  messages: true,
  props: true,
  actions: true,
  settings: true,
  annex: true,
  locale: true,
  viewer: true,
  turnOrder: true
};
var WIDGET_BASE_SECTIONS2 = Object.freeze(Object.keys(BASE_SECTIONS2));
var WIDGET_REQUEST_ASKERS2 = Object.freeze({
  messages: "any",
  "open-character": "any",
  "view-avatar": "any",
  "view-image": "any",
  "open-lore": "any",
  "prompt-details": "any",
  "inspect-run": "any",
  "pick-turn": "any",
  "change-sprite": "any",
  "actions-seen": "core",
  summarize: "core",
  send: "core",
  "attach-files": "core",
  "remove-tray-item": "core",
  "remove-attachment": "core",
  draft: "core",
  "switch-persona": "core",
  "add-persona": "core",
  "fire-turn": "core",
  "decide-proposal": "core",
  "set-attribute-value": "core",
  "set-sprite-set": "core",
  "clear-scene-image": "core",
  "session-entries": Object.freeze({ scope: "lore" }),
  "set-entry-marks": "core",
  "authors-note": "core",
  "set-authors-note": "core"
});
var WIDGET_REQUEST_KINDS2 = Object.freeze(Object.keys(WIDGET_REQUEST_ASKERS2));
var WIDGET_EVENT_SCOPES2 = Object.freeze({
  "lore:ranked": "lore",
  "lore:marked": "lore"
});

// ../serene-pub-sdk/sdk/dist/widgetDecls.js
var REGISTRY2 = globalThis[/* @__PURE__ */ Symbol.for("serene-pub.widget-owners")] ??= {
  owners: /* @__PURE__ */ new WeakMap(),
  coreIds: /* @__PURE__ */ new Set()
};
var OWNERS2 = REGISTRY2.owners;
function widgetReadsFindings2(reads, at) {
  if (reads === void 0)
    return [];
  const names = WIDGET_BASE_SECTIONS2.map((s) => `'${s}'`).join(", ");
  if (!Array.isArray(reads))
    return [`${at}: a list of base section names \u2014 any of ${names}`];
  const out = [];
  for (const name of reads) {
    if (WIDGET_BASE_SECTIONS2.includes(name))
      continue;
    out.push(isWidgetScopedSectionName2(name) ? `${at}: '${name}' is a scoped section \u2014 ask for it in \`scopes\`, never in \`reads\`` : `${at}: '${String(name)}' is not a base section \u2014 one of ${names}`);
  }
  return out;
}

// ../serene-pub-sdk/sdk/dist/channels.js
var DEFAULT_CHANNEL2 = "main";

// ../serene-pub-sdk/sdk/dist/descriptors.js
function scriptPointsOf2(d) {
  return (d.scriptPoints ?? []).map((p) => ({
    ...p,
    key: String(p.key),
    accepts: Array.isArray(p.accepts) ? [...p.accepts] : []
  }));
}
var MESSAGE_VERB_FLOORS2 = ["stop", "branch", "edit"];
var MESSAGE_VERB_BUILT_INS2 = ["delete", "hide", "swipe"];
var MESSAGE_VERB_CONTENT2 = ["retry", "extend", "stepBack"];
var MESSAGE_VERBS2 = [...MESSAGE_VERB_CONTENT2, ...MESSAGE_VERB_BUILT_INS2];
var TURN_CONTROLS2 = ["advance", "pick", "narrate", "retake"];
function assertTurnControls2(shape, who) {
  const raw = shape?.turnControls;
  if (raw === void 0)
    return;
  const problems = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    problems.push(`turnControls is { ${TURN_CONTROLS2.map((t) => `${t}?`).join(", ")} }`);
  } else {
    for (const [k, v2] of Object.entries(raw)) {
      if (!TURN_CONTROLS2.includes(k)) {
        problems.push(`turnControls.${k}: not a turn control \u2014 one of ${TURN_CONTROLS2.join(", ")}`);
        continue;
      }
      if (typeof v2 === "boolean")
        continue;
      if (!v2 || typeof v2 !== "object" || Array.isArray(v2) || !("presentWhen" in v2)) {
        problems.push(`turnControls.${k}: true, false, or { presentWhen } \u2014 enabled-when predicates over the published values, such as { on: 'session.fields.<field>', equals: '<value>', reason: { en: '<why it is absent>' } }`);
        continue;
      }
      const pw = v2.presentWhen;
      problems.push(...enabledWhenFindings2(pw, `turnControls.${k}.presentWhen`));
      normalizeEnabledWhen2(pw).forEach((p, i) => {
        if (p.on === "item" || p.on.startsWith("item."))
          problems.push(`turnControls.${k}.presentWhen[${i}]: reads '${p.on}' \u2014 a turn control acts on no row, so it cannot read one`);
      });
    }
  }
  if (problems.length)
    throw new Error(`${who}: ${problems.join("\n")}`);
}
var SESSION_WRITES2 = ["lore", "scenes"];
function assertSessionWrites2(shape, who) {
  const writes = shape?.writes;
  if (writes === void 0)
    return;
  if (!writes || typeof writes !== "object" || Array.isArray(writes))
    throw new Error(`${who} declares a 'writes' that is not an object. A genre's writes are { lore?: boolean; scenes?: boolean } \u2014 absent means both on, and only an explicit false takes one away (R-B).`);
  const bad = SESSION_WRITES2.filter((w) => writes[w] !== void 0 && typeof writes[w] !== "boolean");
  if (!bad.length)
    return;
  throw new Error(`${who} declares writes { ${bad.map((w) => `${w}: ${JSON.stringify(writes[w])}`).join(", ")} }. Each write is a boolean or absent \u2014 absent means on, and only an explicit false takes the write away (R-B).`);
}
var BUILTIN_SPEC_IDS2 = Object.freeze({
  delete: "core:spec/builtin-delete",
  hide: "core:spec/builtin-hide",
  edit: "core:spec/builtin-edit",
  swipe: "core:spec/builtin-swipe",
  branch: "core:spec/builtin-branch"
});
var BUILTIN_OUTLET_IDS2 = Object.freeze({
  delete: "core:outlet/delete-message@1",
  hide: "core:outlet/hide-message@1",
  edit: "core:outlet/edit-message@1",
  swipe: "core:outlet/swipe-message@1",
  branch: "core:outlet/branch-session@1"
});
function reviewFieldsFinding2(d) {
  if (d.effects !== "write" && d.effects !== "external")
    return null;
  if (d.review && Array.isArray(d.review.fields))
    return null;
  return `${d.id} declares effects: '${d.effects}' and no review.fields. An effectful definition says which of its in-ports a reviewer may edit at the gate \u2014 review: { fields: ['text'] }, or review: { fields: [] } when the gate is approve-or-refuse. Until it does, the form is inferred from the whole payload and every field is editable, including any row id.`;
}
var registrationFindings2 = /* @__PURE__ */ new Map();
function assertMessageVerbFloors2(shape, who) {
  const verbs = shape?.messageVerbs;
  if (!verbs || typeof verbs !== "object")
    return;
  const forbidden = MESSAGE_VERB_FLOORS2.filter((floor) => verbs[floor] === false);
  if (!forbidden.length)
    return;
  throw new Error(`${who} declares messageVerbs { ${forbidden.map((f) => `${f}: false`).join(", ")} }. Stop, branch and edit are floors \u2014 present in every genre, never switched off (R-15). A genre may switch off delete, hide or swipe, and may forbid retry, extend or stepBack; drop the floor from the declaration.`);
}
var CHANNEL_ROLES2 = ["conversation", "folio"];
var CHANNEL_VOICES2 = ["character", "narrator", "none"];
function assertChannelDecls2(shape, who) {
  const channels = shape?.channels;
  if (channels === void 0)
    return;
  if (!Array.isArray(channels))
    throw new Error(`${who} declares a 'channels' that is not an array. A genre's channels are a list of slugs, each a bare string or a { slug, role?, voice?, messageVerbs?, label?, turnControls? } (R-C).`);
  for (const raw of channels) {
    const isString = typeof raw === "string";
    if (!isString && (!raw || typeof raw !== "object" || Array.isArray(raw)))
      throw new Error(`${who} declares a channel that is neither a slug nor a declaration: ${JSON.stringify(raw)}. Each channel is a bare string or a { slug, role?, voice?, messageVerbs?, label?, turnControls? } (R-C).`);
    const decl2 = isString ? { slug: raw } : raw;
    const slug = typeof decl2.slug === "string" ? decl2.slug.trim() : "";
    if (!slug)
      throw new Error(`${who} declares a channel with no slug. A channel is named by the slug it is referenced and stored under (R-C).`);
    if (slug.includes(":"))
      throw new Error(`${who} declares the channel '${slug}'. A channel is declared by its slug alone \u2014 lanes under it are runtime and open-ended, allocated by this genre's pipelines, and no lane count is declared anywhere (ruling 2026-09-09).`);
    const at = `${who} channel '${slug}'`;
    if (decl2.role !== void 0 && !CHANNEL_ROLES2.includes(decl2.role))
      throw new Error(`${at} declares role '${decl2.role}'. A channel's role is ${CHANNEL_ROLES2.map((r) => `'${r}'`).join(" or ")} \u2014 how its messages enter a prompt, turns with speakers or one block of text (R-C).`);
    if (decl2.voice !== void 0 && !CHANNEL_VOICES2.includes(decl2.voice))
      throw new Error(`${at} declares voice '${decl2.voice}'. A channel's voice is ${CHANNEL_VOICES2.map((v2) => `'${v2}'`).join(", ")} \u2014 whose name a turn triggered here seeds under, or none for no seed row at all (R-C).`);
    assertMessageVerbFloors2({ messageVerbs: decl2.messageVerbs }, at);
    const label = i18nFindings2(decl2.label, `${at} label`);
    if (label.length)
      throw new Error(label.join("\n"));
    assertTurnControls2({ turnControls: decl2.turnControls }, at);
    if (slug === DEFAULT_CHANNEL2 && (decl2.role ?? "conversation") !== "conversation")
      throw new Error(`${at} is declared role '${decl2.role}'. '${DEFAULT_CHANNEL2}' is the channel every session has and the one a turn lands on by default, so it is always a conversation; declare another channel for the folio (R-C).`);
  }
}
var types2 = /* @__PURE__ */ new Map();
var DESCRIPTOR_DISPLAY_KEYS2 = { display: ["label"] };
function bandsMaterial2(bands) {
  if (!bands || !Object.keys(bands).length)
    return void 0;
  return Object.fromEntries(Object.entries(bands).map(([k, v2]) => [k, typeof v2 === "string" ? v2 : v2.id]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
function bandPortsMaterial2(bandPorts) {
  if (!bandPorts || !Object.keys(bandPorts).length)
    return void 0;
  return Object.fromEntries(Object.entries(bandPorts).map(([k, ports]) => [k, [...ports].sort()]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
function portSchemasMaterial2(p) {
  if (!p?.out || !Object.keys(p.out).length)
    return void 0;
  return contractData2({ out: p.out });
}
var contractData2 = (v2) => declarationData2(v2, DESCRIPTOR_DISPLAY_KEYS2);
var flag2 = (v2) => v2 === true ? true : void 0;
var portShapes2 = (ports) => Object.fromEntries(Object.entries(ports ?? {}).map(([k, v2]) => [
  k,
  typeof v2 === "string" ? v2 : v2?.id ?? void 0
]));
function definitionContract2(source) {
  const at = source.id.lastIndexOf("@");
  const pinned = at > 0 && /^\d+$/.test(source.id.slice(at + 1));
  const entryShape = source.entryShape && typeof source.entryShape === "object" ? {
    ...source.entryShape,
    ...source.configSchema !== void 0 ? { fields: source.configSchema } : {}
  } : void 0;
  return {
    id: pinned ? source.id.slice(0, at) : source.id,
    version: source.version ?? (pinned ? Number(source.id.slice(at + 1)) : 1),
    kind: source.kind,
    ports: { in: portShapes2(source.ports?.in), out: portShapes2(source.ports?.out) },
    slots: contractData2(authoredSlots2(source.slots)),
    effects: source.effects,
    review: source.review ? { fields: [...source.review.fields] } : void 0,
    shape: source.shape,
    optional: flag2(source.optional),
    declaresRandomness: flag2(source.declaresRandomness),
    scriptPoints: source.scriptPoints ? contractData2(scriptPointsOf2(source)) : void 0,
    sessionShape: contractData2(source.sessionShape),
    earlyExit: flag2(source.earlyExit),
    causesEvent: source.causesEvent,
    causesEventFrom: source.causesEventFrom,
    // Sorted: which payloads an inlet reads is a set, not a sequence.
    payloads: source.payloads?.length ? [...source.payloads].sort() : void 0,
    liveRow: flag2(source.liveRow),
    media: contractData2(source.media),
    entryShape: contractData2(entryShape),
    // Contract that rides the row's policy (owner ruling 2026-09-27): a
    // descriptor's own field, else the row's policy spelling — one hash.
    bands: bandsMaterial2(source.bands ?? source.policy?.bands ?? void 0),
    bandPorts: bandPortsMaterial2(source.bandPorts ?? source.policy?.bandPorts ?? void 0),
    portSchemas: portSchemasMaterial2(source.portSchemas ?? source.policy?.portSchemas ?? void 0),
    semantics: source.semantics
  };
}
function definitionContractHash2(source) {
  return contentHash2(definitionContract2(source));
}
function register2(d) {
  const existing = types2.get(d.id);
  if (existing)
    refuseUnlessSameHash2(definitionContractHash2(existing), definitionContractHash2(d), `duplicate type id: ${d.id}`);
  checkWritePublishes2(d);
  checkNoAuthoredSettings2(d);
  checkNoSettingsPort2(d);
  checkScriptPointsAccept2(d);
  checkCausesEvent2(d);
  checkNoAmbientExtras2(d);
  checkModeTitled2(d);
  checkDisplayText2(d);
  checkBandDeclarations2(d, types2.values());
  assertMessageVerbFloors2(d.sessionShape, d.id);
  assertSessionWrites2(d.sessionShape, d.id);
  assertTurnControls2(d.sessionShape, d.id);
  assertChannelDecls2(d.sessionShape, d.id);
  const reviewFinding = reviewFieldsFinding2(d);
  if (reviewFinding)
    registrationFindings2.set(d.id, [reviewFinding]);
  else
    registrationFindings2.delete(d.id);
  types2.set(d.id, d);
  return d;
}
var AMBIENT_SCRIPT_EXTRAS2 = ["session"];
function checkNoAmbientExtras2(d) {
  for (const [name, slot] of Object.entries(d.slots ?? {})) {
    const listed = slot.extras ?? [];
    const ambient = listed.filter((e) => AMBIENT_SCRIPT_EXTRAS2.includes(e));
    if (ambient.length)
      throw new Error(`${d.id}: slot '${name}' lists ${ambient.map((e) => `'${e}'`).join(", ")} in its extras \u2014 every script site is handed ${AMBIENT_SCRIPT_EXTRAS2.map((e) => `'${e}'`).join(", ")} already (R32); drop it from the list`);
  }
}
function checkCausesEvent2(d) {
  if (d.causesEventFrom !== void 0) {
    if (d.kind !== "outlet" || d.effects !== "write")
      throw new Error(`'${d.id}' declares causesEventFrom \u2014 only a write outlet causes an event`);
    if (d.causesEvent)
      throw new Error(`'${d.id}' declares both causesEvent and causesEventFrom \u2014 one says which event, not both`);
    if (!d.ports.in?.[d.causesEventFrom])
      throw new Error(`'${d.id}' names causesEventFrom '${d.causesEventFrom}', which is not one of its in-ports`);
    return;
  }
  if (!d.causesEvent)
    return;
  const event = eventById2(d.causesEvent);
  if (!event)
    throw new Error(`${d.id}: ${notADeclaredEvent2(d.causesEvent)}`);
  const base = d.id.replace(/@\d+$/, "");
  if (!event.causedBy?.includes(base))
    throw new Error(`'${d.id}' causes '${d.causesEvent}', but that event's causedBy does not name '${base}'. causedBy is the one statement of what causes what \u2014 add '${base}' there, or drop causesEvent (R33)`);
}
function checkWritePublishes2(d) {
  if (d.effects !== "write")
    return;
  const bad = Object.entries(d.ports?.out ?? {}).filter(([, s]) => shapeIdOf2(s) === "core:shape/row-ids@1");
  if (!bad.length)
    return;
  throw new Error(`${d.id} declares effects: 'write' but publishes core:shape/row-ids@1 on ${bad.map(([k]) => `'${k}'`).join(", ")}. A gate-eligible write publishes core:shape/write-result@1 \u2014 pending under async review, committed otherwise \u2014 so a downstream port wanting raw ids fails at publish instead of writing a foreign key that dangles when the reviewer rejects (13 \xA77j-b).`);
}
function checkNoAuthoredSettings2(d) {
  if (!d.slots)
    return;
  if ("settings" in d.slots)
    throw new Error(`${d.id} declares a slot named 'settings'. That name is reserved for the substrate's own slot \u2014 \`enabled\` on an optional node, \`review\` on a gated one \u2014 which the registry projection declares and the executor reads. Name the slot for what it holds ('parameters' for tunables).`);
  const byKind = Object.entries(d.slots).find(([, decl2]) => decl2?.kind === "settings");
  if (byKind)
    throw new Error(`${d.id} declares slot '${byKind[0]}' with kind 'settings'. That kind is the substrate's \u2014 derived from \`optional\` and \`effects\`, never authored. Declare 'parameters' for tunables.`);
}
function checkNoSettingsPort2(d) {
  for (const port of Object.keys(d.ports?.out ?? {})) {
    const heard = settingsTravelVerdict2.judge({ kind: "port", definitionId: d.id, port });
    if (!heard.ok)
      throw new Error(refusalText2(heard));
  }
}
function checkScriptPointsAccept2(d) {
  for (const p of d.scriptPoints ?? []) {
    const point = p;
    const key = typeof point === "string" ? point : String(point?.key);
    const accepts = typeof point === "string" ? void 0 : point?.accepts;
    if (!Array.isArray(accepts) || accepts.length === 0)
      throw new Error(`${d.id} declares script point '${key}' accepting no script kind. A point is { key, accepts, label } \u2014 list the kinds it takes (e.g. ['core:script:text/transform@1']); a point that accepts nothing is a hook nothing can attach to.`);
  }
}
var shapeIdOf2 = (s) => typeof s === "string" ? s : s?.id ?? void 0;
var hasDisplayText2 = (v2) => isI18n2(v2);
function checkModeTitled2(d) {
  if (d.kind !== "inlet" || !d.sessionShape)
    return;
  if (hasDisplayText2(d.i18n?.name))
    return;
  throw new Error(`${d.id} declares a sessionShape but no i18n.name. A shape-bearing input type is a session mode, and the New Session picker renders every mode as a card \u2014 give it a title: i18n: { name: { en: '\u2026' } }. Add a description there too; the packager warns when a mode ships without one.`);
}
function checkDisplayText2(d) {
  const findings = [];
  findings.push(...i18nFindings2(d.i18n?.name, `${d.id} i18n.name`));
  findings.push(...i18nFindings2(d.i18n?.description, `${d.id} i18n.description`));
  for (const [slotName, slot] of Object.entries(d.slots ?? {})) {
    if (!slot)
      continue;
    const at = `${d.id} slots.${slotName}`;
    findings.push(...i18nFindings2(slot.description, `${at}.description`));
    for (const [field, decl2] of Object.entries(slot.fields ?? {}))
      findings.push(...i18nFindings2(decl2?.i18n, `${at}.fields.${field}.i18n`));
    findings.push(...settingsSchemaFindings2(slot.schema, `${at}.schema`));
  }
  for (const p of d.scriptPoints ?? []) {
    const at = `${d.id} scriptPoints[${String(p.key)}]`;
    findings.push(...i18nFindings2(p.label, `${at}.label`));
    findings.push(...i18nFindings2(p.description, `${at}.description`));
  }
  if (d.sessionShape) {
    findings.push(...settingsSchemaFindings2(d.sessionShape.fields, `${d.id} sessionShape.fields`));
    findings.push(...widgetDeclsFindings2(d.sessionShape.panels, `${d.id} sessionShape.panels`));
  }
  if (d.entryShape)
    findings.push(...settingsSchemaFindings2(d.entryShape.fields, `${d.id} entryShape.fields`));
  if (findings.length)
    throw new Error(`${d.id} declares display text a publish refuses (R-20):
 \xB7 ${findings.join("\n \xB7 ")}`);
}
function widgetDeclsFindings2(raw, where) {
  if (raw === void 0)
    return [];
  if (!Array.isArray(raw))
    return [`${where}: the widgets are an array of declarations`];
  const out = [];
  raw.forEach((w, i) => {
    const decl2 = w;
    const at = `${where}[${typeof decl2?.id === "string" ? decl2.id : i}]`;
    if (!decl2 || typeof decl2 !== "object") {
      out.push(`${at}: a widget declaration is an object \u2014 { id, title, component }`);
      return;
    }
    out.push(...i18nFindings2(decl2.title, `${at}.title`, { required: true }));
    out.push(...settingsSchemaFindings2(decl2.settings, `${at}.settings`));
    out.push(...widgetReadsFindings2(decl2.reads, `${at}.reads`));
    if (decl2.surface !== void 0)
      out.push(`${at}.surface: gone \u2014 give \`component\`, and place an \`sp-frame\` inside it for a document`);
    else if (decl2.component === void 0)
      out.push(`${at}: names nothing to render \u2014 give \`component\`, a component's slug`);
    else if (typeof decl2.component !== "string" || !decl2.component)
      out.push(`${at}.component: a component's slug`);
  });
  return out;
}
var describeInletDefinition = (d) => register2({ ...d, kind: "inlet" });
function pin2(descriptor) {
  const version = /@(\d+)$/.exec(descriptor.id)?.[1] ?? "1";
  const ctor = (config2 = {}) => ({
    __node: true,
    descriptor,
    config: config2
  });
  return { [`v${version}`]: ctor, id: descriptor.id, descriptor };
}

// ../serene-pub-sdk/contracts/src/inlets.ts
var userMessage = pin2(
  describeInletDefinition({
    id: "core:inlet/user-message@1",
    // Display only, both keys: stripped from the content hash, refreshed on
    // existing rows by the boot sync — so copyediting this is never a bump.
    i18n: {
      name: { en: "Chat" },
      description: {
        en: "The standard roleplay chat \u2014 bring characters and personas in any mix, attach a lorebook if you like, and type to talk."
      }
    },
    /**
     * The standard chat's shape (19 §1) — today's behaviour, *stated*.
     * This block is what makes the input type a **chat mode** (the F29
     * floor: always present, special in availability and nothing else).
     * Both participant systems are optional and unbounded above, lorebooks
     * attach when wanted, the composer is a text box, and the seed line
     * carries the speaking character's name. Duties and triggers are not
     * here on purpose: the shape is owner-only, and the narrate button is
     * the narrate spec's contribution, not this type's knowledge (19 §3).
     */
    sessionShape: {
      characters: { min: 0 },
      personas: { min: 0 },
      lorebook: "optional",
      composer: "text",
      voice: "character",
      // Stated rather than assumed (20): a new chat seeds the cast's
      // greetings on `main`. It is the default for any input node, so a
      // custom mode reuses it for free; core declares it so the reusable
      // case reads at a glance.
      greeting: { enabled: true, channel: "main" }
    },
    slots: {
      /**
       * The input hook (18 §4a): user chains over the triggering text,
       * phase `after` on what this node publishes — which is what
       * lorebook scanning and the prompt's seed see. The stored user
       * message was written before the turn began and stays untouched
       * by construction; the slot description says so because that is
       * the question the control raises.
       */
      scripts: {
        kind: "scripts",
        accepts: ["core:script:text/transform@1"],
        port: "text",
        phase: "after",
        description: "Scripts over the message that triggered this turn \u2014 expand shorthand, resolve dice notation \u2014 as retrieval and the prompt will see it. The stored message is not changed."
      }
    },
    ports: {
      out: {
        main: S2.json,
        text: S2.text,
        sessionScope: S2.sessionScope,
        sessionId: S2.rowIds,
        /**
         * Whose turn it is, as a **participant reference** (R-18 (3)):
         * `character:<id>` for a library character, `envoy:<slug>` for
         * a speaker the genre brings with it. Null on a narrator turn —
         * nobody in particular is speaking. One port answers "who is
         * speaking" for both kinds, so nothing downstream branches on
         * which it received; who *portrays* them this turn is the
         * host's resolver's answer, pinned on the receipt (R-21 (4)).
         */
        speaker: S2.participantRef,
        /**
         * @deprecated The same speaker as a bare character id (one
         * release, from 2026-09-16). Null on a narrator turn, and null
         * for an envoy — which is why it cannot stay the port: a
         * reader keyed on it sees a genre's speaker as nobody. Read
         * `speaker`; the turn strategies publish both meanwhile.
         */
        characterId: S2.rowIds,
        /**
         * Who **pressed** — the reference of whoever sent the message
         * or fired the action this run answers (G9, 2026-09-17).
         *
         * `user:<id>` for a person with no presence in the session,
         * `character:<id>` when they hold a persona here — their
         * persona is a character (0132), so a line written as them is
         * written as that character — and, when an answer pipeline
         * pressed on a participant's behalf, that participant's own
         * reference, so the AI-portrayed presser is named rather than
         * the machinery that spoke for them.
         *
         * ⚠ **Not `speaker`.** `speaker` is whose turn it is — who the
         * reply comes out as — and on nearly every turn the two differ:
         * a person types and a character answers. This is the other
         * end of that sentence, and the port a spec wires into
         * `core:outlet/create-message@1`'s `speaker` when it wants to
         * write a line AS the person who pressed: the host already had
         * the path (`speaker: 'user:<id>'` writes a user-role row) and
         * no inlet carried the reference to put in it, so a plugin that
         * wanted the player's own line had to ride it on the model's
         * reply as a block (Battleship, plan §12).
         *
         * Never null on a turn or a fire: a run has an owner, and the
         * owner is a person. Absent only where the inlet is resolved
         * without one, which no shipped path does.
         */
        presser: S2.participantRef,
        /**
         * The cast members a press collected (lair pass R3,
         * 2026-09-28): `character:<id>` references, for an action
         * declaring `collects.recipients` — picked in the collect
         * modal, and validated by the host (seated and enabled, no
         * duplicates, within the declared `min` and `max`) before
         * the run starts. Absent on a turn and on every press of an
         * action that collects none.
         */
        recipients: S2.participantRefs,
        /**
         * Values for the mode's declared `fields` (19 §1), filtered to
         * the declared schema keys — the supply side of the round
         * trip: declaration → chat settings → chat row → this port →
         * every downstream node.
         */
        fields: S2.json,
        /**
         * Text an in-progress reply has already produced, when this turn
         * is an **extend** (ruling 2026-09-08, D-2; the verb was `continue`
         * until 2026-09-28).
         *
         * Empty on every other turn, which is nearly all of them. It is
         * here rather than on an `extend`-only input type because an
         * extend is the standard chat's own verb — it answers the same
         * event, in the same session, from the same cast — and a second
         * input type would restate this one's `sessionShape`, which is
         * the thing `side-character-turn@1`'s note says a shape-bearing
         * mode must never have copied.
         *
         * ⚠ It is not the triggering text and it is not a message. `text`
         * stays what it would be on an ordinary turn, the row carrying
         * this is excluded from every message read while it generates,
         * and only `core:task/process-messages@1` consumes it — as the
         * body of the seed line the model continues from.
         */
        continuationPrefill: S2.text,
        /**
         * The reply row this turn re-drives, when it is a regenerate, a
         * swipe or an extend of a message that already exists. Null on
         * a fresh turn, which is nearly all of them.
         *
         * The pipeline owns its reply row (R-17): a fresh turn's row is
         * created by the spec's own placeholder outlet, and a verb that
         * re-drives an existing message hands that message to the same
         * outlet through this port — so the outlet claims it as the
         * run's live row instead of inserting a second one. It is data,
         * recorded on the receipt, and never a scope read: "which row
         * did this turn write" is answerable from the run afterwards.
         */
        messageId: S2.rowIds,
        /**
         * What the built-ins did to this session since the last reply
         * (R-15, 2026-09-16): a list of session changes — `[{ event:
         * 'core:event/message-deleted@1', messageId, at, lost }, …]`,
         * oldest first, capped at the newest fifty — so a pipeline
         * knows the history it is about to read has moved: a line
         * deleted with its content, a rewrite with the previous text,
         * an alternative swiped in, a reply stopped short. Read once:
         * the run that receives them consumes them — marked read
         * after the run, and only when it produced a reply, so a run
         * that fails leaves them for the next — and a preview sees
         * them without consuming. Empty when nothing changed, which
         * is nearly every turn. Past fifty, the newest fifty arrive
         * and a last entry `{ event:
         * 'core:event/session-changes-truncated@1', dropped }` says
         * how many older ones did not.
         *
         * Was `changes` until 2026-09-16 (U5b review S4): that word is
         * the state ledger's on `resolve-state-changes@1` and
         * `set-state@1` — a list of value changes — and a session
         * change is about a message, never a value (R1).
         */
        sessionChanges: S2.json,
        /**
         * What an action's fire sent along (R-15 *Forms*; U5d,
         * 2026-09-17): a form's answer — `{ choice }` for a choices
         * block, the entered values for a form block — or a widget's
         * `invoke(key, args)` arguments. Absent on a turn and on a
         * bare press. A press on an **addressed** block arrives with
         * `form` beside it (`core:task/read-answer@1` takes both and
         * publishes the answer port by port). The host always
         * supplied this under `payload`; declared 2026-09-17 so a
         * spec can wire it.
         */
        payload: S2.json,
        /**
         * The form a press answered, when it answered one — the block
         * itself as stored, its id, the message and the addressee,
         * read off the row by the host (never off the client):
         * `{ blockId, messageId, kind, question, addressee, characterId,
         * choice?, label? }`. Absent on every other fire.
         */
        form: S2.json,
        /**
         * Which channel the message that triggered this turn is on
         * (R-C, 2026-09-17) — the stored string, lane included:
         * `main`, `manuscript`, `phone:3`.
         *
         * `main` when the trigger named none, which is every session
         * whose genre declares no channel of its own. It is never a
         * selector: `*` spans every channel for a *read* and is not
         * somewhere a message can be, so it never appears here.
         *
         * ⚠ The run had no way to ask this before, and that is what
         * kept a channel's declared `voice` half-wired: `voice: 'none'`
         * could be read off the newest row, but `voice: 'narrator'`
         * needs the channel the turn was triggered on even when that
         * channel has no rows yet. It is a port rather than a scope
         * read for the other half of the same reason — a genre that
         * answers the manuscript differently from the conversation
         * branches on it at a junction, and a junction can only read
         * what a port carries.
         */
        /**
         * The session's **settings document** (PLAN-turn-order §4.12,
         * R13): every setting a person can see in session settings,
         * resolved once per run by the host and handed in here —
         * title, guests, genre fields (cascade applied, §4.13),
         * scenario, lorebook, tags, channels, the cast with its
         * envoys, the session-scope rebinds and param overrides per
         * bound spec, the turn-order state, `metadata` (read-only)
         * and the annex. `$.input.session.fields.tone` reads in any
         * spec, and no node re-queries a table for a setting.
         */
        session: S2.sessionSettings,
        channel: S2.text,
        /**
         * **How this turn was reached** (lair pass R8, 2026-09-28) —
         * the fired turn entry's `via`: `strategy`, `script` or
         * `voice` for a prepared turn, `pick` for one a person chose,
         * and **`narrate`** when the press was the `core#narrate` turn
         * control (the genre's own voice asked to narrate what happens
         * next). A verb re-driving a row carries the `via` of the run
         * that created it, so a regenerated narration narrates again.
         * Empty when nothing says (an action's fire). A genre routes
         * on it at a junction — the Lair narrates on `narrate` ahead
         * of every other branch.
         */
        via: S2.text
      }
    }
  })
);
var builtInRequest = pin2(
  describeInletDefinition({
    id: "core:inlet/built-in-request@1",
    ports: {
      out: {
        main: S2.json,
        sessionScope: S2.sessionScope,
        sessionId: S2.rowIds,
        /** The message the write is about. Absent on a branch. */
        target: S2.rowIds,
        /** An edit's new text; a swipe's alternative to record. */
        text: S2.text,
        /** A hide's direction: hidden, or shown again. */
        hidden: S2.json,
        /** A swipe's alternative to select, by index. */
        index: S2.json,
        /** A branch's fork point — the last message the copy keeps. */
        fromMessage: S2.rowIds,
        /**
         * The session's **settings document** (PLAN-turn-order §4.12,
         * R13): every setting a person can see in session settings,
         * resolved once per run by the host and handed in here —
         * title, guests, genre fields (cascade applied, §4.13),
         * scenario, lorebook, tags, channels, the cast with its
         * envoys, the session-scope rebinds and param overrides per
         * bound spec, the turn-order state, `metadata` (read-only)
         * and the annex. `$.input.session.fields.tone` reads in any
         * spec, and no node re-queries a table for a setting.
         */
        session: S2.sessionSettings,
        /** A branch's name. */
        title: S2.text,
        /**
         * A person's sprite for the line: `{ set, label }`, or null to
         * clear it (DESIGN-sprites §6) — a `sprite-pick@1`, the shape a
         * picker publishes, so `core:outlet/show-sprite@1` takes one
         * shape from both. Read by `core:spec/show-sprite`.
         */
        sprite: S2.spritePick
      }
    }
  })
);
var sessionCreated = pin2(
  describeInletDefinition({
    id: "core:inlet/session-created@1",
    i18n: {
      name: { en: "Session created" },
      description: {
        en: "Fires once, when a session of this genre is created \u2014 the pipeline that answers it seeds greetings, channels and initial state."
      }
    },
    ports: {
      out: {
        main: S2.json,
        sessionScope: S2.sessionScope,
        sessionId: S2.rowIds,
        /**
         * The create request: genre id, preset id, participant ids,
         * lorebook, initial field values — everything the person chose
         * before the session existed.
         */
        request: S2.json,
        /**
         * The session's **settings document** (PLAN-turn-order §4.12,
         * R13): every setting a person can see in session settings,
         * resolved once per run by the host and handed in here —
         * title, guests, genre fields (cascade applied, §4.13),
         * scenario, lorebook, tags, channels, the cast with its
         * envoys, the session-scope rebinds and param overrides per
         * bound spec, the turn-order state, `metadata` (read-only)
         * and the annex. `$.input.session.fields.tone` reads in any
         * spec, and no node re-queries a table for a setting.
         */
        session: S2.sessionSettings,
        /** Values for the genre's declared fields, filtered to the schema. */
        fields: S2.json
      }
    }
  })
);
var sessionEvent = pin2(
  describeInletDefinition({
    id: "core:inlet/session-event@1",
    i18n: {
      name: { en: "Session event" },
      description: {
        en: "Fires whenever something happens in a session \u2014 a message lands, the cast changes, a setting moves. The pipeline that answers it reads what happened and why."
      }
    },
    /**
     * The event payloads this inlet reads: a spec may lock it to several
     * events only when every one carries one of these. A session change, a
     * cast change (member-added/-removed included), an annex change, and
     * the envelope every event a package declared arrives in — its own
     * payload is the envelope's `payload`.
     */
    payloads: [S2.sessionChange, S2.castChange, S2.annexChange, S2.recordedEvent],
    ports: {
      out: {
        /** The event id that fired — `core:event/message-completed@1`. */
        event: S2.text,
        sessionId: S2.rowIds,
        /** The event's own payload, as its registry entry's shape declares it. */
        payload: S2.json,
        /** Why it fired (`EventCause`). Carried through to the write. */
        cause: S2.json,
        /** When, as epoch milliseconds — what an order `basedOnAt` answers. */
        at: S2.json,
        sessionScope: S2.sessionScope,
        /**
         * The session's **settings document** (§4.12, R13), resolved
         * once per run by the host after the write that caused this
         * event — so the cast below is the cast as it is now, and no
         * node needs a cast read of its own.
         */
        session: S2.sessionSettings,
        /**
         * The settings document's **cast**, on its own port (PLAN
         * §8 (17)): what `core:query/session-cast@1` publishes,
         * envoys included, projected from `session` by the host.
         *
         * A port rather than a path, because an edge is `{ node,
         * port }` and nothing in the graph addresses a field inside
         * a port's value. §4.5 wires the pool's `cast` from the
         * document; this is that wire, with the shape the pool's
         * in-port declares.
         */
        cast: S2.sessionCast
      }
    }
  })
);
var sideCharacterTurn = pin2(
  describeInletDefinition({
    id: "core:inlet/side-character-turn@1",
    // Display only, both keys: stripped from the content hash, refreshed on
    // existing rows by the boot sync — so copyediting this is never a bump.
    i18n: {
      name: { en: "Side character" },
      description: {
        en: "A turn spoken by somebody who is not in the cast \u2014 pick a character, or type a name. They speak once; they do not join the rotation."
      }
    },
    slots: {
      /**
       * The input hook (18 §4a), on the same terms as `user-message@1`:
       * user chains over the triggering text, phase `after` on what this
       * node publishes, which is what retrieval and the prompt see.
       *
       * ⚠ `extras` is what makes this the **new-name hook**. The three
       * names below are read-only context supplied by the host at the
       * hook (18 §6a) and are part of the fixed choice set the script
       * editor offers — so "this name is new" is a declared read rather
       * than a name typed on faith. `speakerIsKnown` is `false` exactly
       * when a free-form name matched nothing in the session's lorebook.
       */
      scripts: {
        kind: "scripts",
        accepts: ["core:script:text/transform@1"],
        port: "text",
        phase: "after",
        extras: ["speakerName", "speakerCharacterId", "speakerIsKnown", "castNames"],
        description: "Scripts over the instructions this turn was triggered with, as retrieval and the prompt will see them. The speaker rides along read-only \u2014 including whether the lorebook already knows them, so a script can offer to add somebody new."
      }
    },
    ports: {
      out: {
        main: S2.json,
        text: S2.text,
        sessionScope: S2.sessionScope,
        sessionId: S2.rowIds,
        /**
         * Who is speaking, as a **participant reference** (R-18 (3)):
         * `character:<id>` when the pick was a library character, null
         * for a free-form name — a name is not a participant reference,
         * and the fact below is where the name lives. On the same
         * terms as `user-message@1`'s port of this name.
         */
        speaker: S2.participantRef,
        /**
         * @deprecated The chosen character as a bare id, or null for a
         * free-form name (one release, from 2026-09-16) — read
         * `speaker`.
         *
         * ⚠ It is **not** a turn slot. It reaches character lore's
         * visibility rule (an entry bound to this character becomes
         * readable for this turn) and the prompt's perspective, and
         * nothing else — round-robin selection reads the session's
         * cast and its messages, neither of which this touches.
         */
        characterId: S2.rowIds,
        /**
         * The side character as a whole fact: `{ name, characterId,
         * known, character }`.
         *
         * A port rather than only an extra, because it is what the
         * context builder is wired to and what the receipt records —
         * "why did this turn sound like Vell" is answerable from the
         * run afterwards rather than from the trigger that started it.
         *
         * Was `speaker` until 2026-09-16: that name is the participant
         * reference now (R-18 (3), one word one meaning), and a fact
         * carrying a free-form name is not a reference to anybody.
         */
        sideCharacter: S2.json,
        /**
         * The session's **settings document** (PLAN-turn-order §4.12,
         * R13): every setting a person can see in session settings,
         * resolved once per run by the host and handed in here —
         * title, guests, genre fields (cascade applied, §4.13),
         * scenario, lorebook, tags, channels, the cast with its
         * envoys, the session-scope rebinds and param overrides per
         * bound spec, the turn-order state, `metadata` (read-only)
         * and the annex. `$.input.session.fields.tone` reads in any
         * spec, and no node re-queries a table for a setting.
         */
        session: S2.sessionSettings,
        /** Values for the genre's declared fields, filtered to the schema. */
        fields: S2.json,
        /**
         * The row this turn re-drives, on the same terms as
         * `user-message@1`'s port of the same name: a regenerate, swipe
         * or extend of a side character's line routes back to the
         * narrate-character spec, and its placeholder claims the verb's
         * row through this instead of inserting a second one. Null on
         * a fresh turn.
         */
        messageId: S2.rowIds,
        /**
         * The built-ins' session changes since the last reply, on the
         * same terms as `user-message@1`'s port of this name (was
         * `changes` until 2026-09-16, U5b review S4).
         */
        sessionChanges: S2.json
      }
    }
  })
);
var formAddressed = pin2(
  describeInletDefinition({
    id: "core:inlet/form-addressed@1",
    i18n: {
      name: { en: "Form addressed" },
      description: {
        en: "A question or form in a message was put to a participant the AI portrays this turn \u2014 the pipeline that answers it reads the addressee's card and the conversation, and answers against the form's schema."
      }
    },
    ports: {
      out: {
        main: S2.formAddressed,
        sessionScope: S2.sessionScope,
        sessionId: S2.rowIds,
        /**
         * The session's **settings document** (PLAN-turn-order §4.12,
         * R13): every setting a person can see in session settings,
         * resolved once per run by the host and handed in here —
         * title, guests, genre fields (cascade applied, §4.13),
         * scenario, lorebook, tags, channels, the cast with its
         * envoys, the session-scope rebinds and param overrides per
         * bound spec, the turn-order state, `metadata` (read-only)
         * and the annex. `$.input.session.fields.tone` reads in any
         * spec, and no node re-queries a table for a setting.
         */
        session: S2.sessionSettings,
        /** The message carrying the block. */
        messageId: S2.rowIds,
        /** The block's id within the message. */
        blockId: S2.text,
        /** The block itself — a `choices` or `form` `MessageBlock`, as stored. */
        form: S2.json,
        /** The identity of the action the form answers with — `<spec slug>#<key>`. */
        action: S2.text,
        /** Who the form is put to, as a participant reference the resolver answered `ai` for. */
        addressee: S2.participantRef,
        /** The addressee's character row, for the context builder; null for an envoy. */
        characterId: S2.rowIds,
        /** Values for the genre's declared fields, as on a turn. */
        fields: S2.json
      }
    }
  })
);
var summarizeRequest = pin2(
  describeInletDefinition({
    id: "core:inlet/summarize-request@1",
    ports: {
      out: {
        main: S2.summarizeRequest,
        scope: S2.sessionScope,
        /**
         * The session's **settings document** (PLAN-turn-order §4.12,
         * R13): every setting a person can see in session settings,
         * resolved once per run by the host and handed in here —
         * title, guests, genre fields (cascade applied, §4.13),
         * scenario, lorebook, tags, channels, the cast with its
         * envoys, the session-scope rebinds and param overrides per
         * bound spec, the turn-order state, `metadata` (read-only)
         * and the annex. `$.input.session.fields.tone` reads in any
         * spec, and no node re-queries a table for a setting.
         */
        session: S2.sessionSettings,
        request: S2.summarizeRequest
      }
    }
  })
);

// ../serene-pub-sdk/sdk-tests/fixtures/unified-plugin/src/index.ts
var PLUGIN_SLUG = "demo.unified";
var TALLY_PANEL_ID = "tally";
var tallyGenre = genre(`${PLUGIN_SLUG}:genre/tally`, {
  name: { en: "Tally" },
  family: "game",
  description: { en: "Somebody is counting." },
  events: {
    [sessionEvents.messageRespond]: { required: true }
  }
});
var tallyDefinition = pin(
  describeTaskDefinition({
    id: `${PLUGIN_SLUG}:task/tally@1`,
    i18n: { name: { en: "Tally" } },
    timeoutMs: 500,
    ports: { in: { text: S.text }, out: { main: S.json } }
  })
);
var tallyHandler = async (input) => ok({ main: { words: (input.text ?? "").split(/\s+/).filter(Boolean).length } });
var CREATE_SPEC_ID = `${PLUGIN_SLUG}:spec/create-session`;
var RESPOND_SPEC_ID = `${PLUGIN_SLUG}:spec/respond`;
var createSession = spec(CREATE_SPEC_ID, { version: "1.0.0" }).inlet("input", userMessage.v1(), {
  genre: tallyGenre,
  event: sessionEvents.sessionCreated
}).build();
var respond = spec(RESPOND_SPEC_ID, { version: "1.0.0" }).inlet("input", userMessage.v1(), {
  genre: tallyGenre,
  event: sessionEvents.messageRespond
}).task("tally", ($) => tallyDefinition.v1({ text: $.input.text })).build();
var tallyDefault = config(
  respond,
  "tally-default",
  { label: "Tally", description: "As shipped." },
  { tally: { params: { trim: true } } }
);
var extension = defineExtension({
  slug: PLUGIN_SLUG,
  name: "Tally",
  version: "1.0.0",
  description: "Counts words and says so.",
  engines: { "serene-pub": ">=0.7 <0.8" },
  handlers: [handler(tallyDefinition, tallyHandler)],
  pipelines: [createSession, respond],
  genres: [tallyGenre],
  widgets: [
    widget({
      id: TALLY_PANEL_ID,
      title: "Tally",
      component: TALLY_PANEL_ID,
      channels: ["main"]
    })
  ],
  components: [component({ slug: TALLY_PANEL_ID, label: "Tally", entry: "components/tally.ts", framework: "vanilla" })],
  configs: [
    tallyDefault,
    // A config over somebody else's spec: legitimate, and the one thing in
    // this package that has to land in `requires`.
    config(use("core:spec/chat-respond"), "tally-flavoured", { label: "Tally flavoured" }, {})
  ],
  prompts: [
    {
      nodeType: "core:task/build-template-context",
      slot: "prompts",
      slug: "tally-referee",
      label: "Tally referee",
      fields: { systemPrompt: "Count, and say the number." }
    }
  ],
  presets: [
    {
      slug: "tally",
      genre: tallyGenre,
      label: "Tally",
      description: "Counts what you say.",
      bindings: [createSession, { spec: respond, config: tallyDefault }]
    }
  ],
  permissions: { storage: { quotaBytes: 4 * 1024 * 1024 } }
});
var src_default = extension;

// <stdin>
var __ext = src_exports && (src_default || extension) || src_exports;
var __hooks = __ext && __ext.handlers || [];
function __pick(want, decl2, nth) {
  let n = 0;
  for (const h of __hooks) {
    if (!h || h.__decl !== decl2) continue;
    if (!want(h)) continue;
    if (n++ !== nth) continue;
    if (typeof h.handler !== "function")
      throw new Error("the declaration is bound to something that is not a function");
    return h.handler;
  }
  throw new Error("this bundle declares no such hook \u2014 the manifest and the code disagree");
}
var __handler = (id) => __pick((h) => h.type && h.type.id === id, "handler", 0);
module.exports = {
  hooks: {
    "tallyHandler": __handler("demo.unified:task/tally@1")
  }
};
