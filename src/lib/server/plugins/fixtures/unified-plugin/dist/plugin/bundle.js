// @ts-nocheck — a build artifact, not source: this is `serene-pub build`
// output, checked in so the install has a real package to read.
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// sdk-tests/fixtures/unified-plugin/src/index.ts
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

// sdk/src/shapes.ts
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
  audio: defineShape({
    id: "core:shape/audio@1",
    assignableTo: ["core:shape/media-ref@1"]
  }),
  image: defineShape({
    id: "core:shape/image@1",
    assignableTo: ["core:shape/media-ref@1"]
  }),
  json: defineShape({ id: "core:shape/json@1" }),
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

// sdk/src/i18n.ts
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

// sdk/src/settings.ts
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
    out.push(...i18nFindings(f.i18n, `${at}.i18n`));
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
          out.push(...i18nFindings(m.i18n, `${band}.i18n`));
          out.push(...i18nFindings(m.description, `${band}.description`));
        });
    }
    if (f.item !== void 0) out.push(...settingsSchemaFindings({ item: f.item }, at));
    if (f.fields !== void 0) out.push(...settingsSchemaFindings(f.fields, `${at}.fields`));
  }
  return out;
}

// sdk/src/hash.ts
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
var stripDisplay = (v2, display) => {
  if (typeof v2 === "function") return `[fn] ${String(v2)}`;
  if (Array.isArray(v2)) return v2.map((e) => stripDisplay(e, display));
  if (v2 && typeof v2 === "object") {
    return Object.fromEntries(
      Object.entries(v2).filter(([k]) => !display.has(k)).map(([k, val]) => [k, stripDisplay(val, display)])
    );
  }
  return v2;
};
var DEFAULT_DISPLAY = new Set(UNIVERSAL_DISPLAY);
var displaySet = (opts) => opts?.display?.length ? /* @__PURE__ */ new Set([...UNIVERSAL_DISPLAY, ...opts.display]) : DEFAULT_DISPLAY;
function declarationHash(v2, opts) {
  return contentHash(stripDisplay(v2, displaySet(opts)));
}
function refuseUnlessIdentical(existing, next, why, opts) {
  const registered = declarationHash(existing, opts);
  const redeclared = declarationHash(next, opts);
  if (registered === redeclared) return;
  throw new Error(`${why} (registered ${registered}, redeclared ${redeclared})`);
}

// sdk/src/channels.ts
var DEFAULT_CHANNEL = "main";

// sdk/src/descriptors.ts
var TEXT_TRANSFORM_KIND = "core:script:text/transform@1";
var MESSAGE_VERB_FLOORS = ["stop", "branch", "edit"];
var MESSAGE_VERB_BUILT_INS = ["delete", "hide", "swipe"];
var MESSAGE_VERB_CONTENT = ["retry", "continue", "stepBack"];
var MESSAGE_VERBS = [...MESSAGE_VERB_CONTENT, ...MESSAGE_VERB_BUILT_INS];
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
    `${who} declares messageVerbs { ${forbidden.map((f) => `${f}: false`).join(", ")} }. Stop, branch and edit are floors \u2014 present in every genre, never switched off (R-15). A genre may switch off delete, hide or swipe, and may forbid retry, continue or stepBack; drop the floor from the declaration.`
  );
}
var CHANNEL_ROLES = ["conversation", "folio"];
var CHANNEL_VOICES = ["character", "narrator", "none"];
function assertChannelDecls(shape, who) {
  const channels = shape?.channels;
  if (channels === void 0) return;
  if (!Array.isArray(channels))
    throw new Error(
      `${who} declares a 'channels' that is not an array. A genre's channels are a list of slugs, each a bare string or a { slug, role?, voice?, messageVerbs? } (R-C).`
    );
  for (const raw of channels) {
    const isString = typeof raw === "string";
    if (!isString && (!raw || typeof raw !== "object" || Array.isArray(raw)))
      throw new Error(
        `${who} declares a channel that is neither a slug nor a declaration: ${JSON.stringify(raw)}. Each channel is a bare string or a { slug, role?, voice?, messageVerbs? } (R-C).`
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
    if (slug === DEFAULT_CHANNEL && (decl2.role ?? "conversation") !== "conversation")
      throw new Error(
        `${at} is declared role '${decl2.role}'. '${DEFAULT_CHANNEL}' is the channel every session has and the one a turn lands on by default, so it is always a conversation; declare another channel for the folio (R-C).`
      );
  }
}
var types = /* @__PURE__ */ new Map();
var DESCRIPTOR_DISPLAY_KEYS = { display: ["label"] };
function register(d) {
  const existing = types.get(d.id);
  if (existing)
    refuseUnlessIdentical(existing, d, `duplicate type id: ${d.id}`, DESCRIPTOR_DISPLAY_KEYS);
  checkWritePublishes(d);
  checkNoAuthoredSettings(d);
  checkNoSettingsPort(d);
  checkScriptPointsAccept(d);
  checkModeTitled(d);
  checkDisplayText(d);
  assertMessageVerbFloors(d.sessionShape, d.id);
  assertSessionWrites(d.sessionShape, d.id);
  assertChannelDecls(d.sessionShape, d.id);
  const reviewFinding = reviewFieldsFinding(d);
  if (reviewFinding) registrationFindings.set(d.id, [reviewFinding]);
  else registrationFindings.delete(d.id);
  types.set(d.id, d);
  return d;
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
  const port = Object.keys(d.ports?.out ?? {}).find(
    (k) => k === "settings" || k.startsWith("settings.")
  );
  if (port === void 0) return;
  throw new Error(
    `${d.id} declares an out-port named '${port}'. '<node>.settings' (and paths under it) is the address of the substrate's own switches \u2014 \`enabled\`, \`review\`, \`mode\` \u2014 which the executor reads at the node and hands to nobody (F39: settings never travel), so an edge from a port of that name would be refused as a setting. Name the port for what it publishes ('result', 'applied', 'chosen').`
  );
}
function checkScriptPointsAccept(d) {
  for (const p of d.scriptPoints ?? []) {
    if (typeof p === "string") continue;
    const accepts = p.accepts;
    if (Array.isArray(accepts) && accepts.length === 0)
      throw new Error(
        `${d.id} declares script point '${String(p.key)}' with accepts: []. A point that accepts no script kind is a hook nothing can attach to \u2014 list the kinds it takes (e.g. ['${TEXT_TRANSFORM_KIND}']), or omit \`accepts\` for the text-transform default.`
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
    if (typeof p === "string") continue;
    const at = `${d.id} scriptPoints[${String(p.key)}]`;
    findings.push(...i18nFindings(p.label, `${at}.label`));
    findings.push(...i18nFindings(p.description, `${at}.description`));
    findings.push(...i18nFindings(p.i18n, `${at}.i18n`));
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
      out.push(`${at}: a widget declaration is an object \u2014 { id, title, surface }`);
      return;
    }
    out.push(...i18nFindings(decl2.title, `${at}.title`, { required: true }));
    out.push(...settingsSchemaFindings(decl2.settings, `${at}.settings`));
  });
  return out;
}
var describeTaskDefinition = (d) => register({ ...d, kind: "task" });
function pin(descriptor) {
  const version = /@(\d+)$/.exec(descriptor.id)?.[1] ?? "1";
  const ctor = (config = {}) => ({
    __node: true,
    descriptor,
    config
  });
  return { [`v${version}`]: ctor, id: descriptor.id, descriptor };
}

// sdk/src/refs.ts
function $ref(node, port = "main") {
  return { __ref: "data", node, port };
}

// sdk/src/scope.ts
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

// sdk/src/identity.ts
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

// sdk/src/predicates.ts
var PREDICATE_CONDITION_KEYS = ["equals", "equalsPath", "truthy"];
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
    else if (typeof e.reason === "string" || isLocaleMap(e.reason)) {
      if (!i18nText(e.reason)?.trim())
        out.push(
          `${where}: 'reason' is empty \u2014 say why the control is grey, in a sentence a person can act on ('Set a location first')`
        );
    } else out.push(...i18nFindings(e.reason, `${where}.reason`));
    for (const k of Object.keys(e))
      if (!ENABLED_WHEN_KEYS.includes(k))
        out.push(
          `${where}: '${k}' is not part of an enabled-when \u2014 one of ${ENABLED_WHEN_KEYS.join(", ")}`
        );
  });
  return out;
}

// sdk/src/genres.ts
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
  formAddressed: "core:event/form-addressed@1"
});
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
function envoysFindings(raw, at = "envoys") {
  if (raw === void 0) return [];
  if (!Array.isArray(raw)) return [`${at}: a genre's envoys are an array`];
  const out = [];
  const keys = /* @__PURE__ */ new Map();
  let defaults = 0;
  raw.forEach((e, i) => {
    out.push(...envoyFindings(e, at, "genre"));
    const key = e?.key;
    if (typeof key === "string") keys.set(key, (keys.get(key) ?? 0) + 1);
    if (e?.default === true) defaults++;
    void i;
  });
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
      `${at}: a genre's enabled-when defaults are an object keyed by function key \u2014 { look: { on: 'state.world.location', truthy: true, reason: { en: '\u2026' } } }`
    ];
  const out = [];
  for (const [fn, decl2] of Object.entries(raw)) {
    if (!fn) out.push(`${at}: a default is keyed by the function key it applies to \u2014 got ''`);
    out.push(...enabledWhenFindings(decl2, `${at}[${fn}]`));
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
function assertEnvoys(envoys, genreId) {
  if (!envoys) return [];
  const findings = envoysFindings(envoys, `${genreId}.envoys`);
  if (findings.length) throw new Error(findings.join("\n"));
  return envoys.map((e) => normalizeEnvoy(e, e.speaks ?? "in-turn"));
}
function genre(id, props) {
  assertGenreId(id);
  assertMessageVerbFloors(props.shape, id);
  assertSessionWrites(props.shape, id);
  assertChannelDecls(props.shape, id);
  const events = { ...props.events ?? {} };
  events[sessionEvents.sessionCreated] = {
    ...events[sessionEvents.sessionCreated] ?? {},
    required: true
  };
  assertDisplayText(props, id);
  const envoys = assertEnvoys(props.envoys, id);
  const enabledWhen = assertEnabledWhen(props.enabledWhen, id);
  const decl2 = Object.freeze({
    id,
    name: props.name,
    family: props.family,
    description: props.description,
    shape: props.shape,
    events: Object.freeze(events),
    slots: props.slots ? Object.freeze([...props.slots]) : void 0,
    sheets: props.sheets ? Object.freeze([...props.sheets]) : void 0,
    ...envoys.length ? { envoys: Object.freeze(envoys) } : {},
    ...enabledWhen && Object.keys(enabledWhen).length ? { enabledWhen } : {}
  });
  const existing = registry2.get(id);
  if (existing)
    refuseUnlessIdentical(existing, decl2, `duplicate genre id: ${id}`, GENRE_DISPLAY_KEYS);
  registry2.set(id, decl2);
  return decl2;
}
var registry2 = /* @__PURE__ */ new Map();
var GENRE_DISPLAY_KEYS = { display: ["name", "description"] };
var genreIdOf = (g) => {
  const id = typeof g === "string" ? g : g.id;
  assertGenreId(id);
  return id;
};

// sdk/src/participants.ts
var PARTICIPANT_ROLES = ["owner", "admin", "participant", "item", "run-owner"];
var ID = /^[^\s:]+$/;
var SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
var roles = new Set(PARTICIPANT_ROLES);
function parseParticipantRef(raw) {
  if (typeof raw !== "string")
    throw new Error(
      `a participant reference is a string \u2014 got ${raw === null ? "null" : typeof raw}`
    );
  const text2 = raw.trim();
  if (roles.has(text2)) return { kind: text2 };
  const cut = text2.indexOf(":");
  if (cut === -1)
    throw new Error(
      `'${raw}' is not a participant reference \u2014 expected one of ${PARTICIPANT_ROLES.join(", ")}, or user:<id>, character:<id>, envoy:<slug>`
    );
  const kind = text2.slice(0, cut);
  const rest = text2.slice(cut + 1);
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

// sdk/src/actions.ts
var ACTION_EFFECTS = ["fiction", "world"];
var WORLD_ACTION_VENUES = ["composer", "session-settings", "admin", "review"];
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
function actionFindings(raw, specId, at = "contributes.actions") {
  return actionFindingsByLaw(raw, specId, at).map((f) => f.message);
}
function actionFindingsByLaw(raw, specId, at = "contributes.actions") {
  const out = [];
  const shape = (...messages) => {
    for (const message of messages) out.push({ law: "R-15", message });
  };
  const line = (message) => out.push({ law: "F41", message });
  if (!raw || typeof raw !== "object")
    return [{ law: "R-15", message: `${at}: an action is an object \u2014 got ${typeof raw}` }];
  const a = raw;
  const where = `${at}[${typeof a.key === "string" ? a.key : "?"}]`;
  if (typeof a.key !== "string" || !KEY.test(a.key))
    shape(`${where}: 'key' is required \u2014 a lowercase kebab token (${KEY.source})`);
  if (typeof a.function !== "string" || !a.function)
    shape(`${where}: 'function' is required \u2014 the function key the fire routes (19 \xA73)`);
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
  if (a.effects !== void 0 && !ACTION_EFFECTS.includes(a.effects))
    shape(
      `${where}: 'effects' is one of ${ACTION_EFFECTS.join(", ")} \u2014 what the result touches (the effects line, R-15)`
    );
  if (a.effects === "world") {
    for (const v2 of venues) {
      const kind = v2?.kind;
      if (typeof kind === "string" && !WORLD_ACTION_VENUES.includes(kind))
        line(
          `${where}: a 'world' action may not appear in the '${kind}' venue \u2014 its result reaches outside the fiction (cards, lore, settings, permissions), so it belongs in ${WORLD_ACTION_VENUES.join(", ")} and never where a character could be asked to answer it (the effects line, R-15)`
        );
    }
    const act = a.audience?.act;
    if (Array.isArray(act)) {
      for (const r of act)
        if (!WORLD_ACTION_ACTORS.includes(String(r)))
          line(
            `${where}: a 'world' action's audience.act names '${String(r)}' \u2014 an out-of-fiction effect is the owner's (or an administrator's) to invoke, never a participant's or a character's (the effects line, R-15)`
          );
    }
  }
  shape(...i18nFindings(a.label, `${where}.label`, { required: true }));
  if (a.description !== void 0) shape(...i18nFindings(a.description, `${where}.description`));
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
  if (a.mode && !a.genre) a.genre = a.mode;
  delete a.mode;
  if (a.i18n !== void 0 && a.label === void 0) a.label = a.i18n;
  delete a.i18n;
  if (typeof a.venue === "string") a.venue = [{ kind: a.venue }];
  else if (a.venue && !Array.isArray(a.venue)) a.venue = [a.venue];
  else if (!Array.isArray(a.venue)) a.venue = [];
  if (typeof a.key !== "string" && typeof a.function === "string") {
    a.key = a.function;
    if (a.label === void 0) a.label = { en: a.function };
  }
  if (a.envoy && typeof a.envoy === "object")
    a.envoy = { ...a.envoy, speaks: "on-action" };
  if (a.enabledWhen !== void 0 && a.enabledWhen !== null) {
    const list = Array.isArray(a.enabledWhen) ? a.enabledWhen : [a.enabledWhen];
    if (list.every(isEnabledWhenShaped)) a.enabledWhen = normalizeEnabledWhen(a.enabledWhen);
  }
  return a;
}
function normalizeContributes(contributes) {
  if (!contributes) return contributes;
  const { triggers, actions, ...rest } = contributes;
  const merged = [...actions ?? [], ...triggers ?? []];
  if (!merged.length) return rest;
  return { ...rest, actions: merged.map(normalizeAction) };
}
function actionsOf(doc) {
  const c = doc.contributes;
  const normalized = normalizeContributes(c);
  return (normalized?.actions ?? []).map((a) => ({ ...a, specId: doc.id }));
}
var CORE_ACTION_SPEC_ID = "core";
function slashCollisions(actions) {
  const seen = /* @__PURE__ */ new Map();
  const out = [];
  for (const genre2 of new Set(actions.map((a) => a.genre ?? "")))
    for (const c of CORE_ACTIONS) {
      const slash = slashNameOf(c, CORE_ACTION_SPEC_ID);
      seen.set(`${genre2}#${slash}`, { function: c.function, specId: CORE_ACTION_SPEC_ID, slash });
    }
  for (const a of actions) {
    const slash = slashNameOf(a, a.specId);
    const key = `${a.genre ?? ""}#${slash}`;
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, { function: a.function, specId: a.specId, slash });
      continue;
    }
    if (prior.function === a.function) continue;
    out.push(
      `'/${slash}' is claimed twice for genre '${a.genre ?? "(none)"}': by '${prior.specId}' for '${prior.function}' and by '${a.specId}' for '${a.function}' \u2014 one slash name means one function; rename one of them`
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
  const raw = [...c.actions ?? [], ...c.triggers ?? []];
  const out = [];
  for (const entry of raw) {
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
  greeting: { en: "a greeting is swiped, not regenerated" }
});
var NOT_GENERATING = {
  on: "session.generating",
  equals: false,
  reason: CORE_VERB_REASONS.generating
};
var NEWEST = { on: "item.isNewest", truthy: true, reason: CORE_VERB_REASONS.notNewest };
var CORE_ACTIONS = Object.freeze([
  {
    key: "stop",
    function: "stop",
    venue: [{ kind: "message" }],
    audience: { see: ["participant"], act: ["participant"] },
    quick: true,
    label: { en: "Stop generating" },
    icon: "square",
    floor: true
  },
  {
    key: "edit",
    function: "edit",
    venue: [{ kind: "message" }],
    audience: ITEM_AUDIENCE,
    quick: true,
    label: { en: "Edit" },
    icon: "pencil",
    enabledWhen: [
      { on: "item.hidden", equals: false, reason: CORE_VERB_REASONS.hidden },
      NOT_GENERATING
    ],
    floor: true
  },
  {
    key: "branch",
    function: "branch",
    venue: [{ kind: "message" }],
    audience: { see: ["participant"], act: ["owner"] },
    label: { en: "Branch from here" },
    icon: "git-branch",
    enabledWhen: [NOT_GENERATING],
    floor: true
  },
  {
    key: "retry",
    function: "retry",
    venue: [{ kind: "message" }, { kind: "extra" }],
    audience: ITEM_AUDIENCE,
    quick: true,
    slash: "retry",
    label: { en: "Regenerate" },
    icon: "refresh-cw",
    enabledWhen: [
      NEWEST,
      { on: "item.greeting", equals: false, reason: CORE_VERB_REASONS.greeting },
      { on: "item.hidden", equals: false, reason: CORE_VERB_REASONS.hidden },
      NOT_GENERATING
    ],
    floor: false
  },
  {
    key: "continue",
    function: "continue",
    venue: [{ kind: "message" }, { kind: "extra" }],
    audience: ITEM_AUDIENCE,
    slash: "continue",
    label: { en: "Continue" },
    icon: "arrow-down",
    enabledWhen: [NEWEST, NOT_GENERATING],
    floor: false
  },
  {
    key: "swipe",
    function: "swipe",
    venue: [{ kind: "message" }],
    audience: ITEM_AUDIENCE,
    label: { en: "Swipe" },
    icon: "chevrons-left-right",
    enabledWhen: [
      NEWEST,
      { on: "item.hasSwipes", truthy: true, reason: CORE_VERB_REASONS.noSwipe },
      NOT_GENERATING
    ],
    floor: false
  },
  {
    key: "hide",
    function: "hide",
    venue: [{ kind: "message" }],
    audience: ITEM_AUDIENCE,
    label: { en: "Hide" },
    icon: "ghost",
    enabledWhen: [NOT_GENERATING],
    floor: false
  },
  {
    key: "delete",
    function: "delete",
    venue: [{ kind: "message" }],
    audience: ITEM_AUDIENCE,
    label: { en: "Delete" },
    icon: "trash-2",
    enabledWhen: [NOT_GENERATING],
    floor: false
  }
]);

// sdk/src/builder.ts
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
  add(kind, key, arg) {
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
      config: node.config,
      clauseId: this.clauseCtx?.clauseId,
      clauseKind: this.clauseCtx ? this.spec.clauses.find((b) => b.id === this.clauseCtx.clauseId)?.kind ?? "gather" : void 0,
      clauseChain: this.clauseCtx?.chain,
      position: this.spec.nodes.length
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
  query(key, node) {
    return this.add("query", key, node);
  }
  task(key, node) {
    return this.add("task", key, node);
  }
  oracle(key, node) {
    return this.add("oracle", key, node);
  }
  outlet(key, node) {
    return this.add("outlet", key, node);
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
  constructor(preset) {
    __publicField(this, "preset", preset);
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
    if (normalized.mode && !normalized.genre) normalized.genre = normalized.mode;
    delete normalized.mode;
    if (normalized.taxonomy) {
      const t = { ...normalized.taxonomy };
      if (t.mode && !t.genre) t.genre = t.mode;
      delete t.mode;
      normalized.taxonomy = t;
    }
    if (normalized.contributes) {
      normalized.contributes = normalizeContributes(normalized.contributes);
      const actions = normalized.contributes?.actions ?? [];
      const faults = actions.flatMap((a) => actionFindings(a, id));
      if (!faults.length)
        faults.push(
          ...slashCollisions(actions.map((a) => ({ ...a, specId: id })))
        );
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
  query(key, node) {
    return this.add("query", key, node);
  }
  task(key, node) {
    return this.add("task", key, node);
  }
  oracle(key, node) {
    return this.add("oracle", key, node);
  }
  outlet(key, node) {
    return this.add("outlet", key, node);
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
    if (this.inletDone)
      throw new Error("a spec has exactly one inlet (01 \xA72) \u2014 .inlet() may be called once");
    if (this.spec.nodes.length > 0) throw new Error("the inlet must be the first node (01 \xA72)");
    if (binding) {
      if (!binding.event)
        throw new Error("an inlet binding names its event \u2014 { genre, event } (24 \xA74)");
      if (!binding.genre)
        throw new Error(
          `a spec answering '${binding.event}' must declare the genre it serves \u2014 { genre, event } (24 \xA74). Required for now; multi-genre opens later without breaking this declaration.`
        );
      this.spec.input = { genre: genreIdOf(binding.genre), event: binding.event };
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
    return this.spec;
  }
};
function spec(id, meta) {
  return new SpecBuilder(id, meta);
}

// sdk/src/templateIds.ts
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

// sdk/src/events.ts
var bySlug = /* @__PURE__ */ new Map();
var nextId = 1;
function defineEvent(def) {
  const existing = bySlug.get(def.slug);
  const e = { ...def, id: existing?.id ?? nextId, ownerPluginId: null };
  if (existing)
    refuseUnlessIdentical(
      existing,
      e,
      `duplicate event slug '${def.slug}' \u2014 slugs are unique because they are the reference used to sync seeded rows across instances (13 \xA77g)`
    );
  if (def.family === "action" && def.causedBy?.length) {
    throw new Error(
      `action event '${def.slug}' declares causedBy. Action events are requests, not consequences of a write \u2014 that is what keeps them out of the cycle graph (13 \xA77)`
    );
  }
  if (!existing) nextId++;
  bySlug.set(def.slug, e);
  return e;
}
var EVENT_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*:event\/[a-z0-9]+(?:-[a-z0-9]+)*@\d+$/;
var isEventId = (id) => EVENT_ID.test(id);
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
   * a swipe's fresh alternative and a continue are THIS event with `verb`
   * on the payload — `regenerate` · `swipe` · `continue` — rather than three
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
    name: { en: "Session created" },
    version: 1,
    family: "action",
    affectsUser: false,
    description: "A session was created \u2014 the genre's create pipeline answers this."
  }),
  /** The primary turn. A swipe is this pipeline re-run, not a new event. */
  messageRespond: defineEvent({
    slug: "message-respond",
    name: { en: "Reply" },
    version: 1,
    family: "action",
    affectsUser: true,
    description: "A reply was asked for \u2014 the primary turn of a session."
  }),
  /** Arbitrary buttons/triggers — the contributed functions surface (19 §3). */
  sessionAction: defineEvent({
    slug: "session-action",
    name: { en: "Action" },
    version: 1,
    family: "action",
    affectsUser: true,
    description: "A person triggered a contributed action in a session."
  }),
  memberAdded: defineEvent({
    slug: "member-added",
    name: { en: "Member joined" },
    version: 1,
    family: "action",
    affectsUser: false,
    description: "A character or persona joined a session; the payload carries which."
  }),
  memberRemoved: defineEvent({
    slug: "member-removed",
    name: { en: "Member left" },
    version: 1,
    family: "action",
    affectsUser: false,
    description: "A character or persona left a session; the payload carries which."
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
    description: "Someone asked for a run from the interface \u2014 a composer action, a message action, a re-roll. Payload: sessionId, ownerUserId, triggeringUserId, action, modeId, input."
  }),
  /**
   * The path for scheduled model work (13 §7c). No callable may call an oracle
   * (F32), and lifecycle callbacks may not trigger pipelines, so nightly
   * summarization subscribes here instead — which also puts it on the consent
   * screen, where a lifecycle callback doing the same work would have been
   * invisible. ⏳ Nothing emits it yet; `SCHEDULED_WORK_PATH` names it.
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

// sdk/src/values.ts
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
          `custom value kinds need a package context \u2014 use the toolkit announce() hands you, so '${kind}' serializes namespaced ('yourpkg:${kind}@${version}') and cannot shadow a core kind.`
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

// sdk/src/surfaces.ts
var SAFE_ENTRY = /^[a-zA-Z0-9_\-][a-zA-Z0-9._\-]*(\/[a-zA-Z0-9._\-]+)*$/;
var SAFE_PANEL_ID = /^[a-z0-9_-]+$/;
var isServableEntry = (path) => SAFE_ENTRY.test(path) && !path.split("/").some((seg) => seg === "." || seg === "..");
var isServablePanelId = (id) => SAFE_PANEL_ID.test(id);

// sdk/src/declarations.ts
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
function inputLockFindings(pipelines, declaredGenres, ns, requires) {
  const out = [];
  const sessionEventSet = new Set(Object.values(sessionEvents));
  for (const s of pipelines) {
    if (!s.input?.event) continue;
    const genreId = s.input.genre;
    if (!genreId) {
      out.push(`pipeline '${s.id}' answers '${s.input.event}' with no genre (24 \xA74)`);
      continue;
    }
    if (!declaredGenres.has(genreId)) requires.add(genreId);
    if (!sessionEventSet.has(s.input.event) && !s.input.event.includes(":"))
      out.push(
        `pipeline '${s.id}' answers unknown event '${s.input.event}' \u2014 core events come from sessionEvents; custom ones are namespaced ('${ns}:your-event')`
      );
  }
  return out;
}
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
        if (bound.input?.event !== event)
          errors.push(
            `preset '${p.slug}' binds '${bound.id}' to '${event}', but that spec answers '${bound.input?.event ?? "nothing"}' (24 \xA74)`
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
  const panelIds = /* @__PURE__ */ new Set();
  for (const [i, p] of (surfaces?.panels ?? []).entries()) {
    if (!p?.id) out.push(`surfaces.panels[${i}] has no id \u2014 a layout row keys on it`);
    else if (panelIds.has(p.id))
      out.push(`duplicate panel id '${p.id}' \u2014 ids are the layout key (21 \xA76)`);
    else {
      panelIds.add(p.id);
      if (!isServablePanelId(p.id))
        out.push(
          `panel id '${p.id}' is not one an instance accepts (lowercase letters, digits, '-' and '_') \u2014 it would be dropped silently at install`
        );
    }
    if (!p?.entry) out.push(`surfaces.panels[${i}] has no entry document`);
    else if (!isServableEntry(p.entry))
      out.push(
        `surfaces.panels[${i}] entry '${p.entry}' is not a path an instance will serve \u2014 it would be dropped silently at install`
      );
  }
  for (const [where, decl2] of [
    ["session-view", surfaces?.["session-view"]],
    ["page", surfaces?.page]
  ]) {
    if (decl2 && !decl2.entry) out.push(`surfaces.${where} has no entry document`);
    else if (decl2?.entry && !isServableEntry(decl2.entry))
      out.push(`surfaces.${where} entry '${decl2.entry}' is not a path an instance will serve`);
  }
  return out;
}
function componentFindings(components) {
  const out = [];
  const slugs = /* @__PURE__ */ new Set();
  for (const [i, c] of components.entries()) {
    if (!c?.slug) out.push(`components[${i}] has no slug \u2014 slugs are the sync key (12 \xA73b)`);
    else if (slugs.has(c.slug))
      out.push(`duplicate component slug '${c.slug}' \u2014 slugs are the sync key (12 \xA73b).`);
    else slugs.add(c.slug);
    if (!c?.entry) out.push(`components[${i}] ('${c?.slug ?? "?"}') has no entry`);
    if (!c?.surface) out.push(`components[${i}] ('${c?.slug ?? "?"}') names no surface point`);
  }
  return out;
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
    ...contributedActionFindings(pipelines),
    ...promptFindings(p.prompts ?? []),
    ...configFindings(configs, declaredSpecs, requires)
  ];
  const presets = presetFindings(
    p.presets ?? [],
    declaredGenres,
    declaredSpecs,
    configs,
    requires
  );
  errors.push(
    ...presets.errors,
    ...surfaceFindings(p.surfaces),
    ...componentFindings(p.components ?? [])
  );
  return {
    errors,
    coverage: { presets: presets.coverage, todos: todoHoles(configs) },
    requires: [...requires].sort()
  };
}

// sdk/src/extension.ts
function handler(definition, fn, opts = {}) {
  const descriptor = "descriptor" in definition ? definition.descriptor : definition;
  return {
    __decl: "handler",
    type: descriptor,
    visibility: opts.visibility ?? (descriptor.public ? "public" : "private"),
    handler: fn,
    // Not configurable. See the note on the field.
    runtime: "process"
  };
}
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
        `permissions.storage.quotaBytes must be ${MIN_STORAGE_QUOTA}\u2026${MAX_STORAGE_QUOTA}. An instance clamps whatever it is handed, so a number outside the band is not a bigger grant \u2014 it is a declaration that says something other than what you get.`
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
  for (const h of d.hooks ?? []) {
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
  problems.push(
    ...declarationFindings({
      ns: d.slug,
      genres: d.genres,
      pipelines: d.pipelines,
      prompts: d.prompts,
      configs: d.configs,
      presets: d.presets,
      surfaces: d.surfaces,
      components: d.components
    }).errors
  );
  if (problems.length) {
    throw new ExtensionError(
      `invalid extension '${d.slug}':
` + problems.map((p) => `  \u2022 ${p}`).join("\n")
    );
  }
  return { __extension: true, ...d };
}

// sdk/src/executor.ts
var ok = (value) => ({ kind: "ok", value });

// sdk/dist/shapes.js
var registry3 = /* @__PURE__ */ new Map();
function defineShape2(def) {
  registry3.set(def.id, def);
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
  audio: defineShape2({
    id: "core:shape/audio@1",
    assignableTo: ["core:shape/media-ref@1"]
  }),
  image: defineShape2({
    id: "core:shape/image@1",
    assignableTo: ["core:shape/media-ref@1"]
  }),
  json: defineShape2({ id: "core:shape/json@1" }),
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

// sdk/dist/candidates.js
var BAND_PRIORITIES = ["low", "normal", "high", "always"];

// sdk/dist/i18n.js
var blank2 = (s) => s.trim().length === 0;
var isLocaleMap2 = (v2) => !!v2 && typeof v2 === "object" && !Array.isArray(v2) && typeof v2.en === "string";
var isI18n2 = (v2) => typeof v2 === "string" ? !blank2(v2) : isLocaleMap2(v2) && !blank2(v2.en);
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

// sdk/dist/settings.js
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
    out.push(...i18nFindings2(f.i18n, `${at}.i18n`));
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
          out.push(...i18nFindings2(m.i18n, `${band}.i18n`));
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

// sdk/dist/hash.js
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
var stripDisplay2 = (v2, display) => {
  if (typeof v2 === "function")
    return `[fn] ${String(v2)}`;
  if (Array.isArray(v2))
    return v2.map((e) => stripDisplay2(e, display));
  if (v2 && typeof v2 === "object") {
    return Object.fromEntries(Object.entries(v2).filter(([k]) => !display.has(k)).map(([k, val]) => [k, stripDisplay2(val, display)]));
  }
  return v2;
};
var DEFAULT_DISPLAY2 = new Set(UNIVERSAL_DISPLAY2);
var displaySet2 = (opts) => opts?.display?.length ? /* @__PURE__ */ new Set([...UNIVERSAL_DISPLAY2, ...opts.display]) : DEFAULT_DISPLAY2;
function declarationHash2(v2, opts) {
  return contentHash2(stripDisplay2(v2, displaySet2(opts)));
}
function refuseUnlessIdentical2(existing, next, why, opts) {
  const registered = declarationHash2(existing, opts);
  const redeclared = declarationHash2(next, opts);
  if (registered === redeclared)
    return;
  throw new Error(`${why} (registered ${registered}, redeclared ${redeclared})`);
}

// sdk/dist/channels.js
var DEFAULT_CHANNEL2 = "main";

// sdk/dist/descriptors.js
var TEXT_TRANSFORM_KIND2 = "core:script:text/transform@1";
var MESSAGE_VERB_FLOORS2 = ["stop", "branch", "edit"];
var MESSAGE_VERB_BUILT_INS2 = ["delete", "hide", "swipe"];
var MESSAGE_VERB_CONTENT2 = ["retry", "continue", "stepBack"];
var MESSAGE_VERBS2 = [...MESSAGE_VERB_CONTENT2, ...MESSAGE_VERB_BUILT_INS2];
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
  throw new Error(`${who} declares messageVerbs { ${forbidden.map((f) => `${f}: false`).join(", ")} }. Stop, branch and edit are floors \u2014 present in every genre, never switched off (R-15). A genre may switch off delete, hide or swipe, and may forbid retry, continue or stepBack; drop the floor from the declaration.`);
}
var CHANNEL_ROLES2 = ["conversation", "folio"];
var CHANNEL_VOICES2 = ["character", "narrator", "none"];
function assertChannelDecls2(shape, who) {
  const channels = shape?.channels;
  if (channels === void 0)
    return;
  if (!Array.isArray(channels))
    throw new Error(`${who} declares a 'channels' that is not an array. A genre's channels are a list of slugs, each a bare string or a { slug, role?, voice?, messageVerbs? } (R-C).`);
  for (const raw of channels) {
    const isString = typeof raw === "string";
    if (!isString && (!raw || typeof raw !== "object" || Array.isArray(raw)))
      throw new Error(`${who} declares a channel that is neither a slug nor a declaration: ${JSON.stringify(raw)}. Each channel is a bare string or a { slug, role?, voice?, messageVerbs? } (R-C).`);
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
    if (slug === DEFAULT_CHANNEL2 && (decl2.role ?? "conversation") !== "conversation")
      throw new Error(`${at} is declared role '${decl2.role}'. '${DEFAULT_CHANNEL2}' is the channel every session has and the one a turn lands on by default, so it is always a conversation; declare another channel for the folio (R-C).`);
  }
}
var types2 = /* @__PURE__ */ new Map();
var DESCRIPTOR_DISPLAY_KEYS2 = { display: ["label"] };
function register2(d) {
  const existing = types2.get(d.id);
  if (existing)
    refuseUnlessIdentical2(existing, d, `duplicate type id: ${d.id}`, DESCRIPTOR_DISPLAY_KEYS2);
  checkWritePublishes2(d);
  checkNoAuthoredSettings2(d);
  checkNoSettingsPort2(d);
  checkScriptPointsAccept2(d);
  checkModeTitled2(d);
  checkDisplayText2(d);
  assertMessageVerbFloors2(d.sessionShape, d.id);
  assertSessionWrites2(d.sessionShape, d.id);
  assertChannelDecls2(d.sessionShape, d.id);
  const reviewFinding = reviewFieldsFinding2(d);
  if (reviewFinding)
    registrationFindings2.set(d.id, [reviewFinding]);
  else
    registrationFindings2.delete(d.id);
  types2.set(d.id, d);
  return d;
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
  const port = Object.keys(d.ports?.out ?? {}).find((k) => k === "settings" || k.startsWith("settings."));
  if (port === void 0)
    return;
  throw new Error(`${d.id} declares an out-port named '${port}'. '<node>.settings' (and paths under it) is the address of the substrate's own switches \u2014 \`enabled\`, \`review\`, \`mode\` \u2014 which the executor reads at the node and hands to nobody (F39: settings never travel), so an edge from a port of that name would be refused as a setting. Name the port for what it publishes ('result', 'applied', 'chosen').`);
}
function checkScriptPointsAccept2(d) {
  for (const p of d.scriptPoints ?? []) {
    if (typeof p === "string")
      continue;
    const accepts = p.accepts;
    if (Array.isArray(accepts) && accepts.length === 0)
      throw new Error(`${d.id} declares script point '${String(p.key)}' with accepts: []. A point that accepts no script kind is a hook nothing can attach to \u2014 list the kinds it takes (e.g. ['${TEXT_TRANSFORM_KIND2}']), or omit \`accepts\` for the text-transform default.`);
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
    if (typeof p === "string")
      continue;
    const at = `${d.id} scriptPoints[${String(p.key)}]`;
    findings.push(...i18nFindings2(p.label, `${at}.label`));
    findings.push(...i18nFindings2(p.description, `${at}.description`));
    findings.push(...i18nFindings2(p.i18n, `${at}.i18n`));
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
      out.push(`${at}: a widget declaration is an object \u2014 { id, title, surface }`);
      return;
    }
    out.push(...i18nFindings2(decl2.title, `${at}.title`, { required: true }));
    out.push(...settingsSchemaFindings2(decl2.settings, `${at}.settings`));
  });
  return out;
}
var describeInletDefinition = (d) => register2({ ...d, kind: "inlet" });
var describeQueryDefinition = (d) => register2({ ...d, kind: "query" });
var describeTaskDefinition2 = (d) => register2({ ...d, kind: "task" });
var describeOracleDefinition = (d) => register2({ ...d, kind: "oracle" });
var describeOutletDefinition = (d) => register2({ ...d, kind: "outlet" });
function pin2(descriptor) {
  const version = /@(\d+)$/.exec(descriptor.id)?.[1] ?? "1";
  const ctor = (config = {}) => ({
    __node: true,
    descriptor,
    config
  });
  return { [`v${version}`]: ctor, id: descriptor.id, descriptor };
}

// sdk/dist/media.js
var MEDIA_KINDS = ["image", "audio", "video", "document"];

// sdk/dist/capabilities.js
var IO_KINDS = ["text", ...MEDIA_KINDS, "embedding", "entities"];
var KIND_ORDER = new Map(IO_KINDS.map((k, i) => [k, i]));
var side = (kinds) => [...new Set(kinds)].sort((a, b) => (KIND_ORDER.get(a) ?? 99) - (KIND_ORDER.get(b) ?? 99)).join("+");
var IoKinds = {
  text: "text",
  image: "image",
  audio: "audio",
  video: "video",
  document: "document",
  embedding: "embedding",
  entities: "entities"
};
function tf(t) {
  return build(t);
}
var build = (t) => `${side(t.in)}->${side(t.out)}`;
var BAND = {
  none: "none",
  emulated: "emulated",
  native: "native"
};
var BAND_ORDER = [BAND.none, BAND.emulated, BAND.native];
var BANDS = {
  json_object: [BAND.none, BAND.emulated, BAND.native],
  json_schema: [BAND.none, BAND.emulated, BAND.native],
  tools: [BAND.none, BAND.emulated, BAND.native]
};
var DEFAULT_BANDS = [BAND.none, BAND.native];

// sdk/dist/promptBlocks.js
var SHIPPED_PROMPT_BLOCK_IDS = [
  "currentDate",
  "instructions",
  "characters",
  "personas",
  "scenario",
  "worldLore",
  "history",
  "relationshipsPerspectives",
  "relationshipsKnown"
];
var BLOCK_LABELS = {
  currentDate: "Current date",
  instructions: "Instructions",
  characters: "Characters",
  personas: "Personas",
  scenario: "Scenario",
  worldLore: "World lore",
  history: "History",
  relationshipsPerspectives: "Relationships \u2014 their view",
  relationshipsKnown: "Relationships \u2014 how others see them"
};
var BLOCK_MEMBERS = SHIPPED_PROMPT_BLOCK_IDS.map((key) => ({
  key,
  label: { en: BLOCK_LABELS[key] }
}));
var SHIPPED_PROMPT_BLOCKS = SHIPPED_PROMPT_BLOCK_IDS.map((id) => ({ id, enabled: true }));
var PROMPT_BLOCKS_DECL = {
  type: "list",
  label: { en: "Prompt blocks" },
  description: {
    en: "Which sections the prompt is built from, and in what order. Blocks the selected context template does not render are ignored."
  },
  default: SHIPPED_PROMPT_BLOCKS,
  item: {
    type: "object",
    fields: {
      id: {
        type: "enum",
        label: { en: "Block" },
        of: SHIPPED_PROMPT_BLOCK_IDS,
        members: BLOCK_MEMBERS
      },
      enabled: {
        type: "boolean",
        label: { en: "In the prompt" },
        default: true
      }
    }
  }
};

// sdk/dist/template.js
var EXPR = /\{\{\s*([^}]+?)\s*\}\}/g;
var FOR = /\{%\s*for\s+(\w+)\s+in\s+([\w.]+)\s*%\}/g;
function extractRefs(src) {
  const bound = /* @__PURE__ */ new Set();
  const loopSources = [];
  for (const m of src.matchAll(FOR))
    bound.add(m[1]);
  for (const m of src.matchAll(FOR)) {
    const parts = m[2].split(".");
    loopSources.push({
      root: parts[0],
      path: parts.slice(1),
      bound: bound.has(parts[0]),
      dynamic: false
    });
  }
  const refs = [...loopSources];
  for (const m of src.matchAll(EXPR)) {
    const expr = m[1].trim();
    const dynamic = /[\[\(]/.test(expr);
    const parts = expr.split(".");
    refs.push({
      root: parts[0].replace(/[\[\(].*$/, ""),
      path: parts.slice(1),
      bound: bound.has(parts[0].replace(/[\[\(].*$/, "")),
      dynamic
    });
  }
  return refs;
}
function render(src, baseScope) {
  let out = src;
  let prev;
  const scope = { ...baseScope };
  {
    const { masked, blocks } = maskLoops(out);
    out = masked;
    out = out.replace(/\{%\s*set\s+(\w+)\s*=\s*([^%]+?)\s*%\}/g, (_m, name, expr) => {
      const raw = expr.trim();
      scope[name] = /^-?\d+$/.test(raw) ? Number(raw) : /^['"].*['"]$/.test(raw) ? raw.slice(1, -1) : get(scope, raw.split("."));
      return "";
    });
    out = out.replace(/\u0000(\d+)\u0000/g, (_m, i) => blocks[Number(i)]);
  }
  out = renderLoops(out, scope);
  do {
    prev = out;
    out = out.replace(/\{%\s*if\s+([^%]+?)\s*%\}((?:(?!\{%\s*if\s)[\s\S])*?)\{%\s*endif\s*%\}/g, (_m, cond, body) => evaluate(cond, scope) ? body : "");
  } while (out !== prev);
  return out.replace(EXPR, (_m, expr) => {
    const v2 = get(scope, expr.trim().split("."));
    return v2 === void 0 || v2 === null ? "" : String(v2);
  });
}
function evaluate(cond, scope) {
  const cmp = /^(.+?)\s*(==|!=)\s*(.+)$/.exec(cond.trim());
  if (!cmp)
    return Boolean(get(scope, cond.trim().split(".")));
  const left = get(scope, cmp[1].trim().split("."));
  const rightRaw = cmp[3].trim();
  const right = /^-?\d+$/.test(rightRaw) ? Number(rightRaw) : /^['"].*['"]$/.test(rightRaw) ? rightRaw.slice(1, -1) : get(scope, rightRaw.split("."));
  return cmp[2] === "==" ? left === right : left !== right;
}
function get(scope, path) {
  let cur = scope;
  for (const k of path) {
    if (cur === void 0 || cur === null)
      return void 0;
    cur = cur[k];
  }
  return cur;
}
function checkTemplate(src, scope) {
  const known = Object.keys(scope);
  const bindings = loopBindings(src);
  const out = [];
  const report = (r, base) => out.push({
    severity: "error",
    message: r.message ?? `'${base}' does not exist`,
    fix: r.available?.length ? `'${base}' has: ${r.available.join(", ")}` : "check the shape this template declares \u2014 the path does not exist on it"
  });
  for (const ref of extractRefs(src)) {
    if (ref.dynamic) {
      out.push({
        severity: "warning",
        message: `'${ref.root}' is accessed dynamically and cannot be checked`,
        fix: "this is allowed \u2014 a computed key is not knowable here, so confirm this one yourself"
      });
      continue;
    }
    if (ref.bound) {
      const element = boundType(ref.root, bindings, scope, /* @__PURE__ */ new Set());
      if (!element)
        continue;
      const r2 = resolvePath(element, ref.path, ref.root);
      if (!r2.ok)
        report(r2, ref.root);
      continue;
    }
    if (!known.includes(ref.root)) {
      out.push({
        severity: "error",
        message: `'${ref.root}' is not available to this template`,
        fix: known.length ? `available here: ${known.join(", ")}` : "this template slot declares no variables \u2014 check the node type"
      });
      continue;
    }
    const r = resolvePath(scope[ref.root], ref.path, ref.root);
    if (!r.ok)
      report(r, ref.root);
  }
  return out;
}
function loopBindings(src) {
  const out = /* @__PURE__ */ new Map();
  for (const m of src.matchAll(FOR))
    out.set(m[1], m[2].split("."));
  return out;
}
function boundType(name, bindings, scope, seen) {
  const source = bindings.get(name);
  if (!source || seen.has(name))
    return void 0;
  seen.add(name);
  const [root, ...rest] = source;
  const decl2 = bindings.has(root) ? boundType(root, bindings, scope, seen) : scope[root];
  const r = resolvePath(decl2, rest);
  return r.ok ? elementOf(r.field) : void 0;
}
var UNCHECKED = { ok: true, checked: false };
var INTRINSIC = "length";
function resolvePath(decl2, path, base = "") {
  if (decl2 === void 0 || decl2 === "any")
    return UNCHECKED;
  if (Array.isArray(decl2)) {
    if (!path.length)
      return UNCHECKED;
    if (decl2.includes(path[0]))
      return UNCHECKED;
    return {
      ok: false,
      checked: true,
      at: path[0],
      available: decl2,
      message: `'${label(base, [path[0]])}' does not exist`
    };
  }
  let cur = decl2;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    const where = label(base, path.slice(0, i + 1));
    switch (cur.type) {
      case "object": {
        const fields = cur.fields;
        if (!fields)
          return UNCHECKED;
        const next = fields[seg];
        if (!next)
          return {
            ok: false,
            checked: true,
            at: seg,
            available: Object.keys(fields),
            message: `'${where}' does not exist`
          };
        cur = next;
        break;
      }
      case "record": {
        if (!cur.of)
          return UNCHECKED;
        cur = cur.of;
        break;
      }
      case "list": {
        if (seg === INTRINSIC)
          return { ok: true, checked: true, field: { type: "number" } };
        if (!/^\d+$/.test(seg))
          return {
            ok: false,
            checked: true,
            at: seg,
            message: `'${where}' does not exist \u2014 '${label(base, path.slice(0, i)) || "this"}' is a list, so it is reached by position. Loop over it and read '${seg}' from each entry instead.`
          };
        if (!cur.of)
          return UNCHECKED;
        cur = cur.of;
        break;
      }
      default: {
        if (seg === INTRINSIC && cur.type === "string")
          return { ok: true, checked: true, field: { type: "number" } };
        return {
          ok: false,
          checked: true,
          at: seg,
          message: `'${where}' does not exist \u2014 '${label(base, path.slice(0, i)) || "this"}' is a ${cur.type}.`
        };
      }
    }
  }
  return { ok: true, checked: true, field: cur };
}
function label(base, path) {
  return [base, ...path].filter(Boolean).join(".");
}
function elementOf(decl2) {
  if (!decl2 || decl2 === "any" || Array.isArray(decl2))
    return void 0;
  if (decl2.type === "list" || decl2.type === "record")
    return decl2.of;
  return void 0;
}
function maskLoops(src) {
  const blocks = [];
  let out = "";
  let i = 0;
  const FOR_OPEN = /\{%\s*for\s/g;
  const TAG = /\{%\s*(for|endfor)\b[^%]*%\}/g;
  while (i < src.length) {
    FOR_OPEN.lastIndex = i;
    const open = FOR_OPEN.exec(src);
    if (!open) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, open.index);
    let depth = 0;
    TAG.lastIndex = open.index;
    let m;
    let end = -1;
    while (m = TAG.exec(src)) {
      if (m[1] === "for")
        depth++;
      else if (--depth === 0) {
        end = m.index + m[0].length;
        break;
      }
    }
    if (end === -1) {
      out += src.slice(open.index);
      break;
    }
    out += `\0${blocks.push(src.slice(open.index, end)) - 1}\0`;
    i = end;
  }
  return { masked: out, blocks };
}
function renderLoops(src, scope) {
  const { masked, blocks } = maskLoops(src);
  if (!blocks.length)
    return src;
  return masked.replace(/\u0000(\d+)\u0000/g, (_m, idx) => {
    const block = blocks[Number(idx)];
    const head = /^\{%\s*for\s+(\w+)\s+in\s+([\w.]+)\s*%\}/.exec(block);
    if (!head)
      return block;
    const body = block.slice(head[0].length, block.lastIndexOf("{%"));
    const items = get(scope, head[2].split("."));
    if (!Array.isArray(items))
      return "";
    return items.map((item, i) => render(body, {
      ...scope,
      [head[1]]: item,
      loop: { index: i + 1, index0: i, revindex: items.length - i, length: items.length }
    })).join("");
  });
}

// sdk/dist/engines.js
var engines = /* @__PURE__ */ new Map();
function defineEngine(e) {
  const existing = engines.get(e.id);
  if (existing)
    refuseUnlessIdentical2(existing, e, `duplicate template engine id: ${e.id}`, {
      display: ["label"]
    });
  engines.set(e.id, e);
  return e;
}
function jinjaCost(source, count) {
  const loops = [
    ...source.matchAll(/\{%\s*for\s+\w+\s+in\s+(\w+)\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/g)
  ];
  const perIteration = {};
  let body = source;
  for (const m of loops) {
    const literal = m[2].replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, "");
    perIteration[m[1]] = (perIteration[m[1]] ?? 0) + count(literal);
    body = body.replace(m[0], "");
  }
  const fixedLiteral = body.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, "");
  return { fixed: count(fixedLiteral), perIteration, exact: true };
}
var jinja2 = defineEngine({
  id: "core:template/jinja2@1",
  label: "Jinja2",
  render,
  extract: (s) => [...new Set(extractRefs(s).map((r) => r.path.join(".")))],
  check: checkTemplate,
  costProfile: jinjaCost
});
var plain = defineEngine({
  id: "core:template/plain@1",
  label: "Plain text",
  render: (s) => s,
  extract: () => [],
  check: () => [],
  costProfile: (s, count) => ({
    fixed: count(s),
    perIteration: {},
    exact: true
  })
});
var handlebars = defineEngine({
  id: "core:template/handlebars@1",
  label: "Handlebars",
  render: () => {
    throw new Error("the Handlebars engine is host-supplied: core renders with its own registered helper set, and a second implementation here would differ in ways that read as template bugs");
  },
  // `{{a.b}}`, `{{#each xs}}`, `{{#if x}}` — enough to answer "what does this template
  // reference", which is what variable-awareness needs (16 §4).
  // Two patterns, not one: a single pattern with an optional keyword backtracks on
  // `{{/each}}` and reports `each` as a variable, and a diagnostics list with helper
  // names in it teaches a user to distrust the panel.
  // One pass, in source order. The lookahead skips closing tags outright —
  // without it, `{{/each}}` backtracks into reporting `each` as a variable.
  extract: (s) => {
    const found = /* @__PURE__ */ new Set();
    for (const m of s.matchAll(/\{\{(?!\/)#?\s*(?:each|if|unless|with)?\s*([\w.]+)/g))
      if (m[1] && m[1] !== "this")
        found.add(m[1]);
    return [...found];
  },
  check: () => [],
  // Not exact: the helper set can expand a reference into arbitrary text, so a
  // character count is an estimate and says so (16 §7a).
  costProfile: (s, count) => ({
    fixed: count(s),
    perIteration: {},
    exact: false
  })
});
var liquid = defineEngine({
  id: "core:template/liquid@1",
  label: "Liquid",
  render: () => {
    throw new Error("the Liquid engine is host-supplied: core renders with its own registered tag and filter set, and a second implementation here would differ in ways that read as template bugs");
  },
  // `{{ a.b }}`, `{% for x in xs %}`, `{% if x %}` — enough to answer "what does this
  // template reference", which is what variable-awareness needs (16 §4). Filters,
  // literals and the loop's own binding are excluded: a diagnostics list with
  // `upcase` or `"quoted"` in it teaches a user to distrust the panel.
  extract: (s) => {
    const found = /* @__PURE__ */ new Set();
    for (const m of s.matchAll(/\{\{-?\s*([A-Za-z_][\w.]*)/g))
      found.add(m[1]);
    for (const m of s.matchAll(/\{%-?\s*(?:if|elsif|unless|case|when|assign\s+\w+\s*=|echo)\s+([A-Za-z_][\w.]*)/g))
      found.add(m[1]);
    for (const m of s.matchAll(/\{%-?\s*(?:for|tablerow)\s+\w+\s+in\s+([A-Za-z_][\w.]*)/g))
      found.add(m[1]);
    return [...found];
  },
  check: () => [],
  // Not exact, for the same reason Handlebars is not: a filter or a custom tag can
  // expand a reference into arbitrary text (16 §7a).
  costProfile: (s, count) => ({
    fixed: count(s),
    perIteration: {},
    exact: false
  })
});
var templateOf = (engine) => (source) => ({ engine: engine.id, source });
var jinja = templateOf(jinja2);
var text = templateOf(plain);

// contracts/src/index.ts
var streamingParam = () => ({
  type: "enum",
  of: ["auto", "off"],
  default: "auto",
  description: "auto streams when a reader is listening; off sends one request and waits, which is cheaper for background stages."
});
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
         * Values for the mode's declared `fields` (19 §1), filtered to
         * the declared schema keys — the supply side of the round
         * trip: declaration → chat settings → chat row → this port →
         * every downstream node.
         */
        fields: S2.json,
        /**
         * Text an in-progress reply has already produced, when this turn
         * is a **continue** (ruling 2026-09-08, D-2).
         *
         * Empty on every other turn, which is nearly all of them. It is
         * here rather than on a `continue`-only input type because a
         * continue is the standard chat's own verb — it answers the same
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
         * swipe or a continue of a message that already exists. Null on
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
        channel: S2.text
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
        /** A branch's name. */
        title: S2.text
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
        /** Values for the genre's declared fields, filtered to the schema. */
        fields: S2.json
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
        /** Values for the genre's declared fields, filtered to the schema. */
        fields: S2.json,
        /**
         * The row this turn re-drives, on the same terms as
         * `user-message@1`'s port of the same name: a regenerate, swipe
         * or continue of a side character's line routes back to the
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
var sessionHistory = pin2(
  describeQueryDefinition({
    id: "core:query/session-history@1",
    i18n: { name: { en: "Session history" } },
    timeoutMs: 2e3,
    slots: {
      /**
       * ⚠ No `template` slot, and there was one.
       *
       * It declared "how each chat message is written into the context",
       * and three things were true of it: no binding ever read it, no row
       * was ever seeded for its pool, and so the panel rendered a picker
       * with **nothing in it** on every pipeline that used this node. A
       * control that cannot be given a value and would not be used if it
       * could is worse than the absence of the feature — the same
       * judgement `variableLayouts.ts` records about a layout for
       * `characterLore`.
       *
       * If per-message wording becomes configurable, it belongs on
       * `core:task/process-messages@1`, which is what actually formats a
       * line. This node fetches rows.
       */
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          /**
           * ⚠ The default is **100 because 100 is what every install
           * has been getting**, not because 100 was chosen.
           *
           * It read 40 here and nothing read it: the binding took
           * `input.limit`, a key nothing supplies, and fell through to
           * a literal 100 on every run. Wiring the control while
           * leaving the declared number at 40 would have moved the
           * transcript window from 100 to 40 on every install at
           * defaults — a retrieval change smuggled in behind a typing
           * fix. So the declaration is corrected to the effective
           * value first; changing the number is a separate decision,
           * made against the measure corpus.
           *
           * Exactly the ruling `topK` got (2026-09-07), for exactly
           * the same defect.
           */
          limit: {
            type: "integer",
            default: 100,
            description: "How many recent messages are considered for the context."
          },
          /**
           * The channel this history reads (20 §7). A session's
           * lanes are the mode's declaration; a pipeline chooses
           * which one builds its context — the map narrator reads
           * `map`, the chat pipeline reads `main`, and a custom
           * spec may do otherwise on purpose.
           */
          channel: {
            type: "string",
            default: "main",
            description: "Which of the session's channels this history reads. The chat log is 'main'."
          },
          /**
           * The transcript's intent, on the node that produces the
           * transcript (R-7 P5, built 2026-09-16 — see
           * `bandIntentFields`). `weight: 0.4` and `minInclude: 6`
           * were here once, moved to the ranker's per-source map as
           * `share.messages` and `minEntries.messages`, and are back
           * where 16 §5a always said they belonged, at the numbers
           * the map held: half the window is `MESSAGE_FILL_FRACTION`,
           * and six is the minimum the map carried for the one band
           * R6 allows one.
           *
           * ⚠ This node ranks **no candidates** in any shipped spec
           * — `main` carries the transcript rows for
           * `process-messages`, and `assemble` builds the transcript
           * from those, never from ranked candidates. Its intent
           * still reaches the ranker, on the `band` out-port a spec
           * concatenates in with the lore, and its `share` is what
           * halves the pool the lore sources divide: the
           * conversation's slice is reserved and whatever it does
           * not spend is swept to the others, exactly as the map's
           * `messages: 0.5` did. `maxEntries` and `minEntries` bind
           * only when a spec does rank message candidates (an
           * `entity-search` `messages` port, a compression region);
           * they are declared at the map's values so that spec
           * inherits what every install has stored, not so a person
           * moving them today sees a prompt change — they will not.
           */
          share: {
            type: "number",
            min: 0,
            default: 0.5,
            quick: true,
            i18n: { en: "Share \u2014 conversation" },
            description: {
              en: "How much of the context window the conversation may take, relative to every other source. What it does not spend is handed to the lore. Set to zero to give the whole window to the other sources."
            }
          },
          maxEntries: {
            type: "integer",
            min: 0,
            default: 50,
            i18n: { en: "Most entries \u2014 conversation" },
            description: {
              en: "A ceiling on how many retrieved messages may reach the prompt as ranked entries, whatever the share. The transcript itself is sized by the window, not by this."
            }
          },
          minEntries: {
            type: "integer",
            min: 0,
            default: 6,
            i18n: { en: "Always keep at least" },
            description: {
              en: "Recent messages kept as ranked entries whatever the shares say, so a lore-heavy chat stays readable. Dropped when there is no room. Lore has no minimum \u2014 it competes on score (R6)."
            }
          },
          /**
           * Read, at last (R-7 P5; it was declared and read by nothing
           * from the day it was written, allow-listed in the
           * declared-reads guard until this landed). `normal` is no
           * ordering at all; see `BAND_PRIORITIES` in the SDK for
           * what the other three do to the ranker's sweep.
           */
          priority: {
            type: "enum",
            of: BAND_PRIORITIES,
            default: "normal",
            i18n: { en: "Priority \u2014 conversation" },
            description: {
              en: "How strongly the conversation resists being trimmed once the shares are spent \u2014 'always' keeps every message the window can hold."
            }
          }
        }
      }
    },
    ports: {
      /**
       * ⚠ No `budget` in-port, and there was one (culled 2026-09-16,
       * R-12). It was declared and read by nothing: the window this
       * node fetches is `params.limit`, a count of messages, and a
       * token budget arriving here had no reader and no spec wiring it.
       * Fitting history to a budget is `core:task/rank-hybrid@1`'s job,
       * on ITS `budget` port.
       */
      in: { scope: S2.sessionScope },
      out: {
        /**
         * Transcript rows, on both — `messages@1` (was
         * `context-candidates@1` until 2026-09-17, U5d review W9: the
         * value had always been rows, for `process-messages` and
         * `prose-transcript`, and the intent rides `band` alone).
         * Neither is a candidates list (R-a, the same day): a spec that
         * wires either into a merge, a concat or `assemble`'s
         * `candidates` gets a `validate()` warning naming `band` — the
         * host drops rows handed as candidates rather than ranking them.
         */
        main: S2.messages,
        messages: S2.messages,
        /**
         * The conversation's **band intent**, alone — a candidates
         * list holding one element and no items (`BandIntent`), for a
         * spec to concatenate in with the lore so the ranker reserves
         * the transcript's slice. Its own port because `main` and
         * `messages` carry transcript rows for `process-messages`, and
         * an intent element ahead of them would be read as a message.
         * Opens with a band-intent element (and holds nothing else)
         * — readers call `splitCandidates()`.
         */
        band: S2.candidates
      }
    }
  })
);
var LEXICAL_SCORING = {
  type: "enum",
  default: "overlap",
  i18n: { en: "Relevance balance" },
  members: [
    {
      key: "overlap",
      i18n: { en: "Raw overlap" },
      description: {
        en: "Every repeat of a word counts again, so a longer entry has more chances to score."
      }
    },
    {
      key: "balanced",
      i18n: { en: "Length-aware" },
      description: {
        en: "A repeated word stops adding as much, and an entry is judged against how long lorebook entries usually are. Better when entries differ a lot in length."
      }
    }
  ],
  description: {
    en: "How an entry's own wording is weighed when deciding how relevant it is to what is being said."
  }
};
var TRIGRAM_FOLDING = {
  type: "number",
  default: 0,
  min: 0,
  max: 1,
  i18n: { en: "Match near-misses" },
  description: {
    en: "How much a keyword that is nearly present counts \u2014 a different ending, a typo, or a language that does not put spaces between words. 0 requires an exact match; try 0.5 to turn it on."
  }
};
var TITLE_WEIGHT = {
  type: "number",
  default: 1,
  min: 0,
  max: 5,
  i18n: { en: "Title counts extra" },
  description: {
    en: "How much more a word in an entry's title counts than the same word among its keywords. 1 treats them alike."
  }
};
var GUARANTEED_MESSAGES = {
  type: "integer",
  default: 10,
  min: 1,
  i18n: { en: 'Messages that count as "now"' },
  description: "How much of the recent conversation counts as the current moment when judging relevance \u2014 which characters are present, and which words the scene is actually using. Separate from how far back a keyword may fire from."
};
var ADMIT_THRESHOLD = {
  type: "number",
  default: 0,
  min: 0,
  max: 1,
  quick: true,
  i18n: { en: "Find without keywords" },
  description: {
    en: "How readily an entry is brought in on relevance alone when none of its keywords matched \u2014 the names the conversation is using, and the distinctive words it shares with the entry. 0 keeps keywords the only way in; try 0.3 to turn it on."
  }
};
var bandIntentFields = (band, defaults) => ({
  share: {
    type: "number",
    min: 0,
    default: defaults.share,
    quick: true,
    i18n: { en: `Share \u2014 ${band.label}` },
    description: {
      en: `How much of the context window ${band.noun} may take, relative to every other source. The ranker normalises the shares it is handed; set this to zero to leave ${band.noun} out.`
    }
  },
  maxEntries: {
    type: "integer",
    min: 0,
    ...defaults.maxEntries === void 0 ? {} : { default: defaults.maxEntries },
    i18n: { en: `Most entries \u2014 ${band.label}` },
    description: {
      en: `A ceiling on how many entries ${band.noun} may contribute, whatever its share.`
    }
  },
  priority: {
    type: "enum",
    of: BAND_PRIORITIES,
    default: "normal",
    i18n: { en: `Priority \u2014 ${band.label}` },
    description: {
      en: `How strongly ${band.noun} resists being trimmed once the shares are spent \u2014 'high' and 'low' sort its entries ahead of or behind the others when leftover room is handed out; 'always' keeps every entry the window can hold.`
    }
  }
});
var LORE_BANDS = {
  worldLore: {
    band: { label: "world lore", noun: "world lore" },
    defaults: { share: 0.1667, maxEntries: 20 }
  },
  characterLore: {
    band: { label: "character lore", noun: "character lore" },
    defaults: { share: 0.1667, maxEntries: 15 }
  },
  history: {
    band: { label: "history", noun: "history entries" },
    defaults: { share: 0.1666, maxEntries: 10 }
  }
};
var bandIntentFieldsOf = (band) => {
  const f = bandIntentFields(LORE_BANDS[band].band, LORE_BANDS[band].defaults);
  return {
    [`${band}Share`]: f.share,
    [`${band}MaxEntries`]: f.maxEntries,
    [`${band}Priority`]: f.priority
  };
};
var lorebookTriggers = pin2(
  describeQueryDefinition({
    id: "core:query/lorebook-triggers@1",
    i18n: { name: { en: "Lorebook triggers" } },
    timeoutMs: 2e3,
    slots: {
      /**
       * ⚠ No `template` slot, and there was one — a *source* template for
       * "how one triggered entry is written into the context".
       *
       * Nothing read it and nothing seeded a row for it, so it rendered as
       * an empty picker. A source template belongs on the node whose job
       * is the rendering — a `render-entries` task, when one is bound
       * (culled unbound, plans/29 R-2); two declarations of one idea, one
       * of them inert, is how they drift.
       */
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          /**
           * The three bands' intents, first, as on the lanes (R-7
           * P5; U3b review W1, 2026-09-16). This node produces world
           * lore, character lore AND history through one port, so it
           * declares all three — namespaced, `worldLoreShare` … —
           * and publishes three band intents at the head of its
           * candidates. Same defaults and labels as the three lanes,
           * from `LORE_BANDS`, so the narrator's split is the reply's
           * split until somebody moves one. Before this the node
           * declared no intent at all and the ranker fell back to its
           * own table for every lore band — the same numbers, but a
           * tuned share on `narrate`'s ranker had nowhere to move to
           * (0135 culled it) and nothing on this node could be tuned.
           */
          ...bandIntentFieldsOf("worldLore"),
          ...bandIntentFieldsOf("characterLore"),
          ...bandIntentFieldsOf("history"),
          /**
           * 10, matching `DEFAULT_RETRIEVAL.scanDepth` — the value the
           * scan actually ran on while this declaration said 3 and
           * nothing read it.
           *
           * Round-sized on purpose. A group session with five
           * characters takes five messages to come back round, so a
           * depth of 3 cannot see the turn it belongs to: the window
           * has already slid past where the round began. Scan depth
           * has to be at least a round, and a round grows with the
           * cast.
           */
          scanDepth: {
            type: "integer",
            default: 10,
            i18n: { en: "Messages scanned for keywords" },
            description: "How many recent messages are scanned for lorebook keywords."
          },
          /**
           * On this type as well as on `loreSlots`, for the reason its
           * three siblings below give: the narrator runs its lore
           * through this type, and this number reaches the same
           * `keywordQuery` from the same `retrievalParamsFrom` seam —
           * so a control that exists on the reply pipeline and not on
           * the narrator is a difference no user could discover a
           * reason for.
           */
          guaranteedMessages: GUARANTEED_MESSAGES,
          /**
           * The ceiling, spelled the way its three siblings spell it.
           *
           * ⚠ This was `recursionDepth`, and the one letter of
           * difference is why it looked wired and was not:
           * `retrievalParamsFrom` reads `maxRecursionDepth`, so the
           * number this node stored was handed to nothing and the
           * narrator ran on `DEFAULT_RETRIEVAL` whatever anybody
           * typed. `narrate@1.10.0`'s own note says "Scan Depth and
           * Max Recursion Depth rendered, validated and saved here
           * without ever being read" — half of that was fixed by
           * wiring the slot, and this is the other half, because the
           * control it names was never called that here.
           *
           * Renamed rather than read under both spellings: two names
           * for one ceiling is how the four lore types drift apart
           * again, and `loreSlots` below has the older claim on the
           * name. Migration 0195 carries the stored values across so
           * a number somebody typed keeps its meaning — it simply
           * starts working, which is the 0186 rule.
           *
           * Same default and same words as `loreSlots`': the narrator
           * runs its lore through this type, and a ceiling that
           * exists on the reply pipeline and not on the narrator is a
           * difference no user could discover a reason for.
           */
          maxRecursionDepth: {
            type: "integer",
            default: 0,
            i18n: { en: "Follow keyword chains this deep" },
            description: "A ceiling on how far entries may trigger further entries via keywords found in their text, however deep an individual entry asks to go. It never follows links between entries."
          },
          /**
           * ⚠ `caseSensitive`, `useRegex`, `weight` and `minInclude`
           * were here, and are gone rather than wired. All four
           * rendered, validated, stored a row and resolved through
           * every scope layer while `retrievalParamsFrom` read none
           * of them — plan bug 15, and the last of the dead-control
           * clusters bug 12 found the first of.
           *
           * They divide cleanly in two, and neither half is a control
           * this node should own:
           *
           *   · `caseSensitive` and `useRegex` describe how an *entry*
           *     matches. `loreSlots` below already states the rule —
           *     the entry is what somebody is looking at when they
           *     want to change that — and the entry is where they
           *     live: `signals.ts` reads `entry.caseSensitive` and
           *     folds `entry.useRegex` into `entry.matchMode`, both
           *     columns with their own editor control. A node-level
           *     copy could only ever be a second answer to a question
           *     the row already answers.
           *   · `weight` and `minInclude` are the ranker's, and this
           *     is the same pair `core:query/session-history@1` lost
           *     for the same reason: they ask how one source fares
           *     against everything else, and a node that fetches rows
           *     cannot see everything else to answer it. They are
           *     `share` / `signal*` and `minEntries` on
           *     `core:task/rank-hybrid@1` now, beside their peers,
           *     where a share is normalised against the others rather
           *     than free to disagree with them.
           *
           * Deleting an address culls it: `reconcileConfigs` removes
           * the stored value and writes a notice carrying what it
           * was, which the admin workspace renders. That is the
           * whole reason a cull is allowed to be the answer here —
           * before the notices surface had a reader, "delete it" and
           * "lose it silently" were the same act.
           */
          admitThreshold: ADMIT_THRESHOLD,
          /**
           * The three lexical-quality controls, on this type as well
           * as on `loreSlots` and for `admitThreshold`'s reason: the
           * narrator runs its lore through this type, and a control
           * that exists on the reply pipeline and not on the narrator
           * is a difference no user could discover a reason for.
           */
          lexicalScoring: LEXICAL_SCORING,
          trigramFolding: TRIGRAM_FOLDING,
          titleWeight: TITLE_WEIGHT
        }
      }
    },
    ports: {
      /**
       * ⚠ No `text` in-port, and this and the three lore lanes had one
       * (culled 2026-09-16, R-12). It was filled by no spec and read by
       * no handler — the scan derives its window from `scope`, which is
       * where it actually comes from — and each of the four carried a
       * standing excuse in `wiring.test.ts` saying so.
       */
      in: {
        scope: S2.sessionScope,
        /**
         * **Whose private lore this read is for** — a participant
         * reference (`character:<id>`), additive, 2026-09-17 (W1).
         *
         * Character-lore visibility is decided at the host read against
         * ONE subject, and until this port existed that subject was the
         * run's scope — so every voice of a multi-agent turn was handed
         * every character's private lore, because one gather ran once for
         * all of them. Wired inside a repeating clause
         * (`speaker: $.voices.item.context.speaker`) it names the speaker
         * THIS iteration is writing as, and the host applies the same
         * binding-visibility gate for that character instead of the
         * scope's.
         *
         * Unwired, absent, or a reference naming nobody the host can
         * resolve to a character row, the scope decides exactly as it
         * always did — including `null`, which is the omniscient
         * narrator's read. A reference is never *widened* here: the port
         * chooses whose secrets are readable, never whether the gate runs.
         */
        speaker: S2.participantRef
      },
      // Both open with band-intent elements — three, one per lore band
      // — ahead of the items; readers call `splitCandidates()`.
      out: { main: S2.candidates, hits: S2.candidates }
    }
  })
);
var loreScanFields = () => ({
  /**
   * 10, matching `DEFAULT_RETRIEVAL.scanDepth` — the value every scan
   * has actually run on. This said 3 for as long as the three lore
   * lanes shipped without a wired `params` slot, so the number was
   * never handed to anything and the two could not be seen to
   * disagree.
   *
   * Round-sized on purpose. A group session with five characters
   * takes five messages to come back round, so a depth of 3 cannot
   * see the turn it belongs to: the window has already slid past
   * where the round began. Scan depth has to be at least a round,
   * and a round grows with the cast.
   */
  scanDepth: {
    type: "integer",
    default: 10,
    quick: true,
    shared: true,
    i18n: { en: "Messages scanned for lore triggers" },
    description: "How many recent messages are scanned for lore triggers in the conversation. One setting for the three lore lanes \u2014 it applies to world lore, character lore and history. An entry is not reached through its links to other entries."
  },
  /**
   * Beside `scanDepth` because the pair is only legible together:
   * one is how far back a key may fire from, the other is how much
   * conversation counts as the present moment. See
   * `GUARANTEED_MESSAGES`.
   */
  guaranteedMessages: { ...GUARANTEED_MESSAGES, shared: true },
  maxRecursionDepth: {
    type: "integer",
    default: 0,
    shared: true,
    i18n: { en: "Follow keyword chains this deep" },
    description: "A ceiling on how far entries may trigger further entries via keywords found in their text, however deep an individual entry asks to go. It never follows links between entries."
  },
  /**
   * Declared on all three lanes, held by one: since R-7 P2 a spec
   * names ONE owner for the seven knobs and the other lanes read the
   * owner's slot, so this is one row governing world lore, character
   * lore and history alike — not one row per lane. World lore
   * without keys is the case it exists for; the other two sources
   * take the same answer. A per-source answer is a weight, and
   * weights live on the source (`bandIntentFields`), not here.
   */
  admitThreshold: { ...ADMIT_THRESHOLD, shared: true },
  /**
   * One row for the three lanes, like `admitThreshold`: the owner's
   * value reaches world lore, where entry lengths differ most,
   * character lore, already narrowed to whoever is speaking, and
   * dated history — which has no title at all, so the value reaches
   * it and moves nothing. That is the honest state rather than a
   * fourth declaration.
   */
  lexicalScoring: { ...LEXICAL_SCORING, shared: true },
  trigramFolding: { ...TRIGRAM_FOLDING, shared: true },
  titleWeight: { ...TITLE_WEIGHT, shared: true }
});
var loreSlots = (band, defaults) => ({
  params: {
    kind: "parameters",
    facet: "weights",
    schema: {
      // The lane's own intent first: `share` is the knob a person
      // reaches for, and on a lane that reads the scan knobs through
      // the owner it is all the panel shows.
      ...bandIntentFields(band, defaults),
      ...loreScanFields()
    }
  }
});
var worldLore = pin2(
  describeQueryDefinition({
    id: "core:query/world-lore@1",
    i18n: { name: { en: "World lore" } },
    timeoutMs: 2e3,
    /**
     * A chat with no world lore is an ordinary chat, so nothing downstream
     * needs this to have produced anything — which is also what makes it
     * safe to switch off entirely. The template guards the block and the
     * ranker simply has one fewer source.
     */
    optional: true,
    slots: loreSlots(LORE_BANDS.worldLore.band, LORE_BANDS.worldLore.defaults),
    ports: {
      // No `text` in-port — see `lorebookTriggers`: the scan reads its
      // window through `scope` (culled 2026-09-16, R-12).
      in: { scope: S2.sessionScope },
      // Both open with a band-intent element — this lane's own — ahead
      // of the items; readers call `splitCandidates()`.
      out: { main: S2.candidates, hits: S2.candidates }
    }
  })
);
var characterLore = pin2(
  describeQueryDefinition({
    id: "core:query/character-lore@1",
    i18n: { name: { en: "Character lore" } },
    timeoutMs: 2e3,
    /** As `worldLore`: absent is a normal state, so off is a safe state. */
    optional: true,
    slots: loreSlots(LORE_BANDS.characterLore.band, LORE_BANDS.characterLore.defaults),
    ports: {
      // No `text` in-port — see `lorebookTriggers`: the scan reads its
      // window through `scope` (culled 2026-09-16, R-12).
      in: {
        scope: S2.sessionScope,
        /**
         * **Whose private lore this read is for** — a participant
         * reference (`character:<id>`), additive, 2026-09-17 (W1).
         *
         * Character-lore visibility is decided at the host read against
         * ONE subject, and until this port existed that subject was the
         * run's scope — so every voice of a multi-agent turn was handed
         * every character's private lore, because one gather ran once for
         * all of them. Wired inside a repeating clause
         * (`speaker: $.voices.item.context.speaker`) it names the speaker
         * THIS iteration is writing as, and the host applies the same
         * binding-visibility gate for that character instead of the
         * scope's.
         *
         * Unwired, absent, or a reference naming nobody the host can
         * resolve to a character row, the scope decides exactly as it
         * always did — including `null`, which is the omniscient
         * narrator's read. A reference is never *widened* here: the port
         * chooses whose secrets are readable, never whether the gate runs.
         */
        speaker: S2.participantRef
      },
      // Both open with a band-intent element — this lane's own — ahead
      // of the items; readers call `splitCandidates()`.
      out: { main: S2.candidates, hits: S2.candidates }
    }
  })
);
var historyEntries = pin2(
  describeQueryDefinition({
    id: "core:query/history-entries@1",
    i18n: { name: { en: "History entries" } },
    timeoutMs: 2e3,
    /** As the lore queries: a chat with no history is an ordinary chat. */
    optional: true,
    // 0.1666, not 0.1667 — see `LORE_BANDS`.
    slots: loreSlots(LORE_BANDS.history.band, LORE_BANDS.history.defaults),
    ports: {
      // No `text` in-port — see `lorebookTriggers`: the scan reads its
      // window through `scope` (culled 2026-09-16, R-12).
      in: { scope: S2.sessionScope },
      // Both open with a band-intent element — this lane's own — ahead
      // of the items; readers call `splitCandidates()`.
      out: { main: S2.candidates, hits: S2.candidates }
    }
  })
);
var vectorSearch = pin2(
  describeQueryDefinition({
    id: "core:query/vector-search@1",
    i18n: { name: { en: "Semantic search" } },
    timeoutMs: 3e3,
    /**
     * A session whose install has no embedding model is an ordinary
     * session, so producing nothing is a normal outcome and the mechanism can be
     * switched off entirely — exactly as the lore queries and the entity
     * mechanism are.
     */
    optional: true,
    slots: {
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          /**
           * ⚠ **0 is off, and is the shipped default** — the
           * convention `maxRecursionDepth`, `admitThreshold` and
           * `entity-search`'s own caps use, for their reason: this
           * changes what reaches the model, so it is turned on rather
           * than arrived at on upgrade.
           *
           * A **cap on what this mechanism contributes**, not a cap on what
           * it looks at — `topK` is that, one field down. The two are
           * different questions and only this one decides whether the
           * mechanism is running at all.
           */
          maxEntries: {
            type: "integer",
            default: 0,
            min: 0,
            quick: true,
            i18n: { en: "Entries found by meaning" },
            description: "How many lorebook entries this may bring in for being about what the conversation is about, rather than for matching a keyword. Needs an embedding model; 0 turns the whole arm off, try 5. A pipeline that ranks this arm separately reads its per-query lists instead, which this does not cut."
          },
          /**
           * ⚠ **40, and it was 12.** The number never reached the
           * host: the binding read `input?.topK` — an *in-port* name
           * this node does not declare — and fell through to a
           * literal `?? 40` on every run since the mechanism was
           * written. So 40 is the value every install has actually
           * been searching at, and 12 is a number that was rendered,
           * validated, saved and resolved through the whole scope
           * chain without ever being handed to anything.
           *
           * Defaulted to the effective behaviour rather than to the
           * declared one on purpose. Wiring a control is not a licence
           * to re-tune every install that never touched it: the fix is
           * that the number now *means* something, and it means what
           * it has been doing.
           *
           * A cap on what each query *looks at*, which is a different
           * question from `maxEntries` one field up — that one caps
           * what the mechanism *contributes*. Raising this widens the
           * pool the ranker's other signals get to score; raising
           * `maxEntries` is what decides whether the mechanism runs at
           * all.
           */
          topK: {
            type: "integer",
            default: 40,
            min: 1,
            i18n: { en: "Closest matches per query" },
            description: "How many of the closest matches each retrieval query returns. A wider pool for the ranker to score, not a cap on what this arm contributes."
          },
          /**
           * How sharply a weak resemblance is discounted — and
           * emphatically **not** a minimum.
           *
           * ⚠ **This replaced `minScore: 0.35`, and the replacement is
           * a ruling rather than a rename.** A minimum similarity
           * removes a row from the pool outright, and a row that is not
           * in the pool can no longer be found by keyword, by name or
           * by proximity either — one mechanism's opinion silently
           * disabling four others. The governing rule is that a weak or
           * unavailable mechanism *subtracts a signal* and never
           * removes a candidate, so the cutoff could not stay whatever
           * number it was set to. (It was never read either; nothing
           * anywhere consumed `minScore`.)
           *
           * What replaces it shapes the **contribution** instead:
           *
           *     semantic = cos ** similarityFalloff
           *
           * 1 is the raw cosine and is the off position. Above 1 the
           * curve is convex, fixed at both ends (0→0, 1→1), so a
           * near-miss loses most of its contribution while a strong
           * match keeps nearly all of its own — and the row stays in
           * the pool at every value, which is the whole point.
           *
           * ⚠ **Chosen as a shape because a threshold is not
           * portable.** Cosine distributions are not comparable across
           * embedding models: one model puts unrelated text at 0.1 and
           * another at 0.6, so `0.35` means "almost everything" on the
           * first and "almost nothing" on the second, and an install
           * that swaps models silently changes what its lorebook
           * retrieves. An exponent has no cliff to move. It is
           * strictly monotonic, so it can never reorder this
           * mechanism's own hits or turn one off — it only decides how
           * much the semantic signal is allowed to outweigh a keyword
           * that actually fired.
           */
          similarityFalloff: {
            type: "number",
            default: 1,
            min: 1,
            max: 8,
            i18n: { en: "Discount weak matches" },
            description: "How sharply a loose resemblance counts for less than a close one. 1 takes the similarity as it comes; higher pushes vague matches down without ever removing them, so they can still be found by a keyword or a name."
          }
        }
      }
    },
    ports: {
      in: {
        /**
         * Several query vectors, one ranked list each — a list, so
         * `json@1` (was `vector@1` until 2026-09-17, U5d review W9):
         * what `embed-text@1`'s `vectors` publishes and what the
         * host's search reads.
         */
        vectors: S2.json,
        scope: S2.sessionScope
      },
      out: {
        main: S2.candidates,
        hits: S2.candidates,
        /** One ranked list per query vector, in the order they were given. */
        lists: S2.json,
        /**
         * `cos(i, j)` over `hits`, by index. What MMR needs, without any
         * embedding leaving the host.
         */
        similarity: S2.json
      }
    }
  })
);
var entitySearch = pin2(
  describeQueryDefinition({
    id: "core:query/entity-search@1",
    i18n: { name: { en: "Entity search" } },
    timeoutMs: 2e3,
    /**
     * Off by default, so a session with nothing to find is a normal session
     * and the mechanism can be switched off entirely without anything downstream
     * noticing — exactly as the two lore queries are.
     */
    optional: true,
    slots: {
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          /**
           * ⚠ **0 is off, and is the shipped default** — the
           * convention `maxRecursionDepth` and `admitThreshold` use,
           * and for the same reason: this changes what reaches the
           * model, so it is turned on rather than arrived at on
           * upgrade.
           */
          maxEntries: {
            type: "integer",
            default: 0,
            min: 0,
            quick: true,
            i18n: { en: "Entries found by name" },
            description: "How many lorebook entries this may bring in because the conversation is naming the same people, places and things they do. 0 turns it off; try 5."
          },
          /**
           * Separate from `maxEntries`, because the two answer
           * different questions and only one of them has somewhere to
           * go today.
           */
          maxMessages: {
            type: "integer",
            default: 0,
            min: 0,
            i18n: { en: "Earlier messages found by name" },
            description: "How many earlier messages this may return for naming what the scene is naming. The shipped pipelines do not place retrieved messages into the prompt yet \u2014 the conversation reaches the prompt as the verbatim recent window \u2014 so this returns them for a pipeline that wires them somewhere, and is off by default."
          },
          scanDepth: {
            type: "integer",
            default: 10,
            i18n: { en: "Messages read for names" },
            description: "How many recent messages are read to decide what the scene is currently about."
          },
          /**
           * The mechanism's strength, and it is declared rather than
           * constant because the graded overlap *compresses* what it
           * measures: one strongly-shared name saturates around 0.63
           * and two around 0.86, so a weight sized for a 0/1 signal
           * would leave the improvement invisible.
           *
           * The default is deliberately the keyword weight: one thing
           * the conversation is naming that not every entry names is
           * worth about as much as one of an entry's own keys firing,
           * and the saturation then keeps it strictly below a full
           * keyword match — so authored keys still win, and this only
           * ever adds.
           */
          entityWeight: {
            type: "number",
            default: 0.35,
            min: 0,
            max: 1,
            i18n: { en: "Strength" },
            description: "How much weight a shared name carries against the other ways an entry can be found. 0 leaves the arm finding things and ranking them last."
          }
        }
      }
    },
    ports: {
      /**
       * ⚠ **No `text` in-port.** The four lore queries declared one that
       * nothing filled and nothing read — `loreFor` derives its window
       * from `scope` — and this declaration refused to ship a fifth with
       * the same standing excuse written for it. Theirs are culled now
       * (2026-09-16, R-12); the window comes from `scope`, which is where
       * it actually comes from.
       */
      in: { scope: S2.sessionScope },
      out: {
        main: S2.candidates,
        hits: S2.candidates,
        /**
         * Earlier messages, as candidates in the `messages` band.
         *
         * A port of its own rather than part of `main`, because the two
         * are budgeted separately and a pipeline that wants lore found
         * by name almost certainly does not want half its context
         * window spent on retrieved transcript by accident.
         */
        messages: S2.candidates
      }
    }
  })
);
var docsSearch = pin2(
  describeQueryDefinition({
    id: "core:query/docs-search@1",
    i18n: {
      name: { en: "Docs search" },
      description: {
        en: "Finds the documentation sections that share the most words with the recent conversation, so the guide can ground its answer in them."
      }
    },
    timeoutMs: 2e3,
    optional: true,
    slots: {
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          ...bandIntentFields(
            { label: "documentation", noun: "documentation excerpts" },
            { share: 0.25, maxEntries: 6 }
          ),
          scanDepth: {
            type: "integer",
            min: 1,
            default: 4,
            quick: true,
            i18n: { en: "Messages searched" },
            description: {
              en: "How many of the most recent messages the documentation is matched against. The newest message counts most."
            }
          }
        }
      }
    },
    ports: {
      // The scope, like the lore lanes: the newest rows are read through
      // the host's one message seam (hidden and generating rows excluded
      // there), so this can sit beside `history` in a parallel gather
      // rather than after it.
      in: { scope: S2.sessionScope },
      out: { main: S2.candidates, candidates: S2.candidates }
    }
  })
);
var mentionSpans = pin2(
  describeQueryDefinition({
    id: "core:query/mention-spans@1",
    i18n: { name: { en: "Descriptive mentions" } },
    timeoutMs: 1e3,
    /**
     * Producing nothing is the ordinary outcome — most windows describe
     * nothing — and an install that has not switched the mechanism on must not
     * be able to lose a turn to it.
     */
    optional: true,
    slots: {
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          /**
           * ⚠ **0 is off, and is the shipped default** — the
           * `maxRecursionDepth` / `admitThreshold` convention.
           *
           * **This is the entity-vector mechanism's one switch**, and it is
           * on the first node of the chain on purpose: switched off,
           * this returns before reading anything, `embed-text` is
           * handed no texts and makes no model call, and `entity-link`
           * returns before its own read. The mechanism costs literally
           * nothing until somebody asks for it — not a message read,
           * not an embedding.
           *
           * `entity-link.maxLinks` is therefore a ceiling rather than
           * a second switch and ships non-zero: a feature whose two
           * controls both default to off is one where turning the
           * first one up appears to do nothing.
           */
          maxMentions: {
            type: "integer",
            default: 0,
            min: 0,
            quick: true,
            i18n: { en: "Descriptions to follow up" },
            description: 'How many descriptive references in the recent messages \u2014 "the captain", "the order" \u2014 are matched against what your entries are called, for entries no keyword reached. Needs an embedding model; 0 turns the whole arm off, try 4.'
          },
          scanDepth: {
            type: "integer",
            default: 10,
            i18n: { en: "Messages read for descriptions" },
            description: "How many recent messages are read for descriptions. A description points at what is being discussed now, so this is deliberately short."
          }
        }
      }
    },
    ports: {
      /** The window comes from `scope`, like the entity mechanism's. */
      in: { scope: S2.sessionScope },
      out: {
        main: S2.json,
        /** The mentions with their offsets, for a receipt to point at. */
        mentions: S2.json,
        /** The same strings in the same order, for the embed Provider. */
        texts: S2.json
      }
    }
  })
);
var entityLink = pin2(
  describeQueryDefinition({
    id: "core:query/entity-link@1",
    i18n: { name: { en: "Entries called by a description" } },
    /**
     * `embed-text`'s budget rather than `vector-search`'s, because this node
     * can *embed*: it brings a bounded slice of the name index up to date
     * before it reads. Being cut short costs the remainder of that pass and
     * nothing else — each entry is written before the next is embedded, so
     * progress survives and the mechanism links whatever is already indexed.
     */
    timeoutMs: 5e3,
    /**
     * Empty from this node means *the ranker sees the candidate list
     * unchanged*, never *the ranker sees nothing*: it is wired as the first
     * source of a concatenation whose second source is the unenriched list.
     * So every way it can produce nothing — off, no model, an error the
     * executor recovered as empty — lands on exactly what the ranker would
     * have seen without it.
     */
    optional: true,
    slots: {
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          /**
           * A **ceiling, not the mechanism's switch** — see
           * `mention-spans.maxMentions`, which is. Non-zero so that
           * turning the mechanism on with one control does something.
           */
          maxLinks: {
            type: "integer",
            default: 5,
            min: 0,
            i18n: { en: "Most entries linked" },
            description: "A ceiling on how many entries one turn may have matched to a description. The best matches are kept; this never brings in an entry nothing else found, it only changes where one comes in the order."
          }
        }
      }
    },
    ports: {
      in: {
        scope: S2.sessionScope,
        /**
         * ⚠ **The pool, and the reason this mechanism cannot admit.** It
         * scores what arrives here and returns it; an entry no other
         * mechanism produced is not in this list and therefore cannot
         * be in the output.
         */
        candidates: S2.candidates,
        /** The descriptions, from `core:query/mention-spans@1`. */
        mentions: S2.json,
        /** Their embeddings, in the same order. Index alignment is the contract. */
        vectors: S2.json
      },
      out: {
        main: S2.candidates,
        candidates: S2.candidates,
        /** Each link as text — *matched "the captain" → Captain Vell*. */
        links: S2.json
      }
    }
  })
);
var network = pin2(
  describeQueryDefinition({
    id: "test:query/network@1",
    timeoutMs: 1e3,
    ports: { out: { main: S2.json } }
  })
);
var contextBudget = pin2(
  describeTaskDefinition2({
    id: "core:task/context-budget@1",
    timeoutMs: 500,
    slots: {
      /**
       * Where the window comes from.
       *
       * The context window belongs to the sampling config, never to a knob
       * on a node (17 §1a) — and the executor resolves a `sampling` slot to
       * the config's switched-on *values*, so this stays a pure Task reading
       * data it was handed rather than a Query looking one up.
       *
       * ⚠ Point this at the same config the generating step uses. A budget
       * computed against one window and a prompt sent against another is
       * wrong in the direction that truncates, silently.
       */
      sampling: { kind: "sampling", quick: true },
      /**
       * The connection the reply is sent on — for the model's own
       * context window (0114), which caps the sampling config's when
       * the model states one.
       *
       * Shared with the generating step in every shipped spec
       * (`slot.connectionOf('generate')`), on the same terms as
       * `sampling` above: the budget has to be sized to the window the
       * request is actually sent against, and the ONE computation of
       * that window (R-8) reads both halves off the same resolved pair.
       */
      connection: { kind: "connection" },
      params: {
        kind: "parameters",
        schema: {
          /**
           * ⚠ There is no `reserveForReply` here, and there was: an
           * integer defaulting to 512, sitting beside the sampling
           * config's own `responseTokens` that also defaults to 512. The same mistake as the ranker's `budget: 4096` —
           * re-entering a number the system already knows, free to
           * drift from the model actually being called and warning
           * nobody when it did. Context in, response out: the reserve
           * *is* the response allowance, so it is read, not typed.
           */
          safetyMargin: {
            type: "number",
            default: 0.05,
            description: "Fraction of the window kept free as a buffer against token-count drift."
          }
        }
      }
    },
    ports: { out: { main: S2.budget, available: S2.budget } }
  })
);
var mergeCandidates = pin2(
  describeTaskDefinition2({
    id: "core:task/merge-candidates@1",
    timeoutMs: 500,
    ports: {
      in: { sources: S2.candidates },
      out: {
        // Both open with the band-intent elements the sources carried
        // (lifted out before the fusion, put back after — a fused rank
        // is never stamped on one); readers call `splitCandidates()`.
        main: S2.candidates,
        candidates: S2.candidates,
        /** What fused with what — and a complaint when nothing did. */
        diagnostics: S2.json
      }
    }
  })
);
var concatCandidates = pin2(
  describeTaskDefinition2({
    id: "core:task/concat-candidates@1",
    i18n: { name: { en: "Combine candidates" } },
    timeoutMs: 500,
    ports: {
      in: { sources: S2.candidates },
      out: {
        // Both open with band-intent elements — the first per band
        // across every source, hoisted ahead of the items; readers
        // call `splitCandidates()`.
        main: S2.candidates,
        candidates: S2.candidates,
        /** How many arrived per list, and how many repeats were dropped. */
        diagnostics: S2.json
      }
    }
  })
);
var rankPorts = {
  in: { candidates: S2.candidates, budget: S2.budget },
  out: {
    main: S2.candidates,
    candidates: S2.candidates,
    /**
     * The per-candidate trail: score, included, reason, and the signal
     * breakdown behind it.
     *
     * A declared out-port rather than an implementation detail, because it is
     * what Assemble allocates from — and because a ranker swapped in by a
     * plugin has to produce it too, or the budget panel goes blank the moment
     * anyone changes rankers (16 §5c).
     */
    decisions: S2.json
  }
};
var SOURCES = [
  {
    key: "messages",
    i18n: { en: "Conversation" },
    description: { en: "The chat itself \u2014 what was actually said." },
    tone: 0
  },
  {
    key: "worldLore",
    i18n: { en: "World lore" },
    description: { en: "Lorebook entries about the world." },
    tone: 1
  },
  {
    key: "characterLore",
    i18n: { en: "Character lore" },
    description: { en: "Lorebook entries bound to a character." },
    tone: 2
  },
  {
    key: "history",
    i18n: { en: "History entries" },
    description: { en: "Dated entries recording earlier events." },
    tone: 3
  },
  {
    key: "relationships",
    i18n: { en: "Relationships" },
    description: { en: "The narrative graph. Off by default." },
    tone: 4
  }
];
var SHARE_NORMALISATION = {
  type: "enum",
  of: ["relative", "fixed"],
  default: "relative",
  i18n: { en: "How shares divide the window" },
  description: {
    en: "'relative' treats each source's share as a ratio against the others, so they always add up to the whole window. 'fixed' reads each share as the fraction of the window it states, scaling them down only when they exceed it."
  }
};
var SIGNAL_WEIGHT_FIELDS = {
  signalKeyword: {
    type: "perMember",
    members: SOURCES,
    default: {
      messages: 0,
      worldLore: 0.35,
      characterLore: 0.35,
      history: 0.35,
      relationships: 0
    },
    i18n: { en: "Keyword match" },
    description: {
      en: "How much an entry's own trigger keywords appearing in recent messages counts toward its score."
    }
  },
  signalNameMatch: {
    type: "perMember",
    members: SOURCES,
    default: {
      messages: 0,
      worldLore: 0.25,
      characterLore: 0.25,
      history: 0,
      relationships: 0
    },
    i18n: { en: "Name mentioned" },
    description: {
      en: "How much a cast member's name appearing in the entry counts when that character is in the scene."
    }
  },
  /**
   * Two questions under one name, split by source — bug 16, and it stays split.
   *
   * World lore and history ask *how much of what the scene is naming does this
   * entry name too*; character lore asks *did this entry's own character speak
   * in the guaranteed window*. A character-lore entry names its own character
   * by construction, so the first question scores every present character's
   * private lore alike and distinguishes nothing.
   *
   * ⚠ **The world-lore half is graded now, and this weight moved with it**
   * (design §13.10, retrieval plan phase 3). It used to be a binary substring
   * test — does the entry's title or keys contain a cast name, `Al` firing on
   * `Alchemy` — worth exactly `{0, 0.2}`. It is now the rarity-weighted,
   * word-boundary, two-sided overlap the admission gate already used: what the
   * conversation named, intersected with what this entry names, weighted so
   * that a thing every entry mentions counts for nothing.
   *
   * That measure **saturates**: about 0.63 for one rare shared entity and 0.86
   * for two, so at the old 0.2 its live range would have been ~[0.13, 0.17] —
   * *narrower* than the crude signal it replaces. Grading without re-weighting
   * makes a signal more correct and less influential at the same time, so the
   * weight is sized for the measure that is actually running: 0.35, the same
   * anchor `entity-search`'s own strength uses, which keeps one strongly
   * shared name worth a little less than an entry whose every key fired.
   *
   * Character lore keeps **0.2**. Its measurement did not change, so its
   * weight must not either.
   */
  signalEntityCooccurrence: {
    type: "perMember",
    members: SOURCES,
    default: { messages: 0, worldLore: 0.35, characterLore: 0.2, history: 0, relationships: 0 },
    i18n: { en: "Shared entities" },
    description: {
      en: "How much an entry naming the same people and places as the recent conversation counts. For character lore it asks something else: whether that character has been speaking."
    }
  },
  /**
   * How much *being about the same thing* counts, as an embedding measures it.
   *
   * The fourth mechanism and the only one that needs a model. It arrives on
   * candidates the semantic mechanism found — `core:query/vector-search@1`, wired
   * into the reply pipeline as a sibling of the lore lanes — and it is a
   * **score component**, not a rival ordering: an entry both the keyword scan
   * and the semantic mechanism found keeps its keyword signals and gains this one,
   * so agreement between two independent mechanisms compounds by addition and
   * there is no fusion step to reconcile two incomparable scales.
   *
   * ⚠ **Not zero, and that is deliberate.** The `admitThreshold` convention
   * says a control that changes what reaches the model ships off — and it does
   * here, one level up: the mechanism's own cap (`vector-search.maxEntries`) is 0, so
   * nothing carries this signal until somebody raises it. Making *both* the cap
   * and the weight zero would mean raising the cap changed nothing, which is
   * the trap a two-switch feature always sets. One switch, and it is the one
   * named after what it does.
   *
   * Sized below a keyword hit on purpose. A cosine above the mechanism's own
   * threshold is real evidence and weaker evidence than an authored key
   * firing: keys still guarantee, meaning still only adds.
   */
  signalSemantic: {
    type: "perMember",
    members: SOURCES,
    default: {
      messages: 0,
      worldLore: 0.3,
      characterLore: 0.3,
      history: 0.3,
      relationships: 0
    },
    i18n: { en: "Similar meaning" },
    description: {
      en: "How much it counts that an entry is about what the conversation is about, even with no shared words. Needs an embedding model and the semantic arm switched on."
    }
  },
  /**
   * How much *being called that* counts, as an embedding measures it.
   *
   * The fifth mechanism, and the one that catches the reference nothing else
   * can. It arrives on candidates `core:query/entity-link@1` matched a
   * **description** in the conversation to one of an entry's **names** —
   * *"the captain"* → Captain Vell, *"the order"* → The Ashguard Riders.
   * Neither reference shares a character with its target, so keywords,
   * trigrams and the gazetteer all miss them.
   *
   * ⚠ **Sized to sit strictly below `signalNameMatch`, and that is a rule.**
   * Invented proper nouns are where embeddings are least reliable — "Vell"
   * has no learned meaning, so its vector comes from subword fragments and
   * Vell, Vall and Vela cluster — so exact and trigram matching own invented
   * names, entity vectors own descriptive references, and a vector link must
   * never outrank an entry whose title literally occurred. A similarity
   * cannot exceed 1, so 0.2 against `signalNameMatch`'s 0.25 keeps that true
   * at every value the mechanism can produce.
   *
   * Not zero, for `signalSemantic`'s reason one field up: the mechanism's switch is
   * `mention-spans.maxMentions` and it is 0, so nothing carries this signal
   * until somebody raises it. One switch, not two.
   */
  signalEntityVector: {
    type: "perMember",
    members: SOURCES,
    default: {
      messages: 0,
      worldLore: 0.2,
      characterLore: 0.2,
      history: 0.2,
      relationships: 0
    },
    i18n: { en: "Called by a description" },
    description: {
      en: 'How much it counts that the conversation described something \u2014 "the captain", "the order" \u2014 that matches what an entry is called. Needs an embedding model and the description arm switched on. Deliberately weaker than an entry whose name was actually said.'
    }
  },
  signalTfidf: {
    type: "perMember",
    members: SOURCES,
    default: {
      messages: 0.1,
      worldLore: 0.1,
      characterLore: 0.1,
      history: 0.1,
      relationships: 0
    },
    i18n: { en: "Distinctive words" },
    description: {
      en: "How much rare, distinctive vocabulary shared with the conversation counts \u2014 common words prove little."
    }
  },
  signalLastRefRecency: {
    type: "perMember",
    members: SOURCES,
    default: {
      messages: 0,
      worldLore: 0.1,
      characterLore: 0.1,
      history: 0.1,
      relationships: 0
    },
    i18n: { en: "Recently referenced" },
    description: {
      en: "How much an entry the conversation touched a moment ago outranks one it has not mentioned in a while."
    }
  },
  /**
   * ⚠ **`signalRecency` and `signalSceneAffinity` were declared here and are
   * gone (migration 0099).** Neither had a producer — anywhere, ever. No
   * mechanism wrote `signals.recency` and none wrote `signals.sceneAffinity`,
   * so both weights multiplied a permanent zero: two controls that rendered,
   * validated, saved, resolved through the whole scope chain, and could not
   * move a single prompt at any value on any install.
   *
   * They are removed rather than wired because each needs a *design decision*
   * this change is not entitled to make, and both are the kind that is
   * cheaper to get right later than to guess at now:
   *
   *   · **Recency** carried `history: 0.2`, on a band that really is
   *     populated, so building a producer for it would reorder every install's
   *     history entries — and the number it would rank on is genuinely
   *     ambiguous. A dated entry has an *in-world* date and an *authored*
   *     order, they disagree constantly (a flashback is old and new at once),
   *     and picking one silently is a worse answer than picking neither.
   *   · **Scene affinity** has no fact to read. `scenes` and
   *     `lorebook_bindings.scene_id` exist in the schema, but nothing in
   *     retrieval knows which scene a session is *in*, so the producer is a
   *     feature and not a wiring job.
   *
   * Both are welcome back the day something produces them — as a new field
   * beside its producer, which is the order that keeps this from happening a
   * third time. `runtime/signalWiring.test.ts` is what enforces that: a signal
   * declared here and producible by nothing fails, and so does the reverse.
   *
   * `signalDensity` survives the same audit for the opposite reason — it now
   * has one. `densitySignal` had existed in `ranking/signals.ts` with no
   * caller for as long as this weight had existed with no producer; the scan
   * writes it on every candidate now, exactly as it writes `proximity`.
   */
  signalDensity: {
    type: "perMember",
    members: SOURCES,
    /**
     * ⚠ **Unmoved, and the lore bands' 0 is what makes wiring it safe.**
     *
     * `signalProximity`'s case exactly: the number falls out of the key walk
     * that was already happening, so the only thing this weight decides is
     * whether it counts — and turning it on reorders lore in an upgraded
     * install that never asked. Every lore band therefore stays at 0 and the
     * scan simply starts *reporting* the number, where a reader can see its
     * value before deciding to weight it.
     *
     * `messages: 0.1` is left exactly as it was rather than tidied to 0.
     * That band is not populated on the shipped path (the entity
     * mechanism's `messages` out-port is deliberately unwired) and nothing
     * writes `density` on a message candidate even when it is, so the number
     * is inert either way — and moving a default that cannot change an
     * outcome is a re-tune with no reason attached.
     */
    default: { messages: 0.1, worldLore: 0, characterLore: 0, history: 0, relationships: 0 },
    i18n: { en: "Length against the pool" },
    description: {
      en: "How much a longer-than-average entry outranks a short one. Length is a proxy for how much an entry has to say; raise it when your book mixes one-line stubs with real articles."
    }
  },
  /**
   * How tightly an entry's matched keys clustered in the window.
   *
   * Two keys matching adjacent is stronger evidence than the same two
   * matching twenty words apart: "the Ashguard rode" is about the Ashguard
   * riding, and the same two words either side of a paragraph break are two
   * unrelated sentences. `signalKeyword` cannot tell those apart — it counts
   * *how many* of an entry's keys matched and never *where* — so this is the
   * distinction that signal is missing rather than a second reading of it.
   *
   * ⚠ **0 everywhere, which is the one default it can have.** The number is
   * computed on every scan (it falls out of the key walk that was already
   * happening), so the only thing this weight decides is whether it counts —
   * and turning it on reorders lore in an upgraded install that never asked.
   * Same convention as `admitThreshold` and `scoreLedAllocation`.
   */
  signalProximity: {
    type: "perMember",
    members: SOURCES,
    default: { messages: 0, worldLore: 0, characterLore: 0, history: 0, relationships: 0 },
    i18n: { en: "Keywords close together" },
    description: {
      en: "How much it counts that an entry's keywords appeared near each other rather than scattered across the window."
    }
  },
  signalPriorityBonus: {
    type: "perMember",
    members: SOURCES,
    default: {
      messages: 0,
      worldLore: 0.15,
      characterLore: 0.15,
      history: 0,
      relationships: 0
    },
    i18n: { en: "Author priority" },
    description: {
      en: "Score added per step of an entry's own priority setting \u2014 the author's thumb on the scale."
    }
  }
};
var MECHANISM_WEIGHTS = {
  type: "strengths",
  min: 0,
  max: 1,
  quick: true,
  members: [
    {
      key: "keyword",
      i18n: { en: "Keywords" },
      description: {
        en: "The author's own trigger words, how distinctive the shared vocabulary is, and how closely the matches clustered."
      },
      tone: 1
    },
    {
      key: "semantic",
      i18n: { en: "Meaning" },
      description: {
        en: "Similarity of meaning, with no shared words required. Needs an embedding model and the semantic arm switched on."
      },
      tone: 3
    },
    {
      key: "name",
      i18n: { en: "Names" },
      description: {
        en: "An entry called by its own name, and entries naming the same people and places as the scene."
      },
      tone: 2
    }
  ],
  default: { keyword: 1, semantic: 1, name: 1 },
  i18n: { en: "How entries are found" },
  description: {
    en: "How much each way of finding an entry counts toward its score. Turning one up takes nothing from the others \u2014 this is not the context split."
  }
};
var SCORE_LED_ALLOCATION = {
  type: "boolean",
  default: false,
  i18n: { en: "Let the best entries lead" },
  description: {
    en: "Spend the whole context on whatever scored highest, wherever it came from, and treat each band as a ceiling rather than a reserved slice. Off divides the context into bands first and fills each one separately, which is how it has always worked."
  }
};
var rankHybrid = pin2(
  describeTaskDefinition2({
    id: "core:task/rank-hybrid@1",
    timeoutMs: 500,
    slots: {
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          // Cross-source only (R-7 P5). Ahead of the nine, because it
          // is the altitude a reader starts at: the grouped mechanisms
          // first, the individual signals under them for anyone who
          // wants that far in, then how the sources' shares divide
          // the window and in what precedence it is filled.
          mechanismWeights: MECHANISM_WEIGHTS,
          ...SIGNAL_WEIGHT_FIELDS,
          shareNormalisation: SHARE_NORMALISATION,
          scoreLedAllocation: SCORE_LED_ALLOCATION
        }
      },
      /**
       * The post-retrieval hook (18 §4a): user chains over the candidate
       * pool before ranking sees it. Spread onto this type alone rather
       * than into `rankSlots` — widening a sibling's accepted set is a
       * hash change on a type nobody meant to touch (S3).
       */
      scripts: {
        kind: "scripts",
        accepts: ["core:script:candidates/filter@1", "core:script:candidates/rescore@1"],
        port: "candidates",
        phase: "before",
        description: "Scripts that drop or rescore retrieved entries before the ranker orders them. Dropping excludes with a reason; rescoring changes the order."
      }
    },
    ports: {
      in: rankPorts.in,
      out: {
        ...rankPorts.out,
        /**
         * What each band was allotted, what it spent, and how many
         * entries it got there (D-H).
         *
         * ⚠ **Published by the binding since it was written, declared
         * by nobody.** `select()` returns this beside the decisions and
         * the binding has always returned it on this key — but an
         * undeclared out-port is invisible: nothing downstream could
         * learn it existed, `validate.ts` skipped the edge, and
         * `core:task/assemble@2` ran its allocation on empty defaults
         * while the numbers sat one node upstream.
         *
         * Spread onto this type alone rather than into `rankPorts` —
         * the same reason the `scripts` hook above is, one construct up
         * (S3). The `rank-recall` example computes no per-band usage;
         * giving it a port it cannot fill would move a hash to declare
         * a promise it does not keep.
         *
         * `json` rather than a shape of its own. It is
         * `Record<band, {allocated, used, entries}>` and the band
         * vocabulary is the ranker's `SOURCES` list, which a plugin may
         * extend — a shape id pinned here would freeze the very list
         * that is meant to grow.
         */
        groups: S2.json
      }
    }
  })
);
var queryWindows = pin2(
  describeTaskDefinition2({
    id: "core:task/query-windows@1",
    i18n: { name: { en: "Retrieval queries" } },
    timeoutMs: 500,
    slots: {
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          currentWindow: {
            type: "integer",
            default: 2,
            description: "How many of the latest messages form the 'current' retrieval query."
          },
          recentWindow: {
            type: "integer",
            default: 3,
            description: "How many messages before those form the wider 'recent' retrieval query."
          }
        }
      }
    },
    ports: {
      in: { messages: S2.messages, cast: S2.sessionCast },
      out: { main: S2.json, current: S2.json, recent: S2.json }
    }
  })
);
var rankSemantic = pin2(
  describeTaskDefinition2({
    id: "core:task/rank-semantic@1",
    i18n: { name: { en: "Rank semantic results" } },
    timeoutMs: 1e3,
    slots: {
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          /**
           * ⚠ No `currentWindow` / `recentWindow` here, and there
           * were (culled 2026-09-16, R-12). They size the two query
           * windows — how many messages form the 'current' and the
           * 'recent' question — which `core:task/query-windows@1`
           * cuts and declares as its own params. Declared here too,
           * they were rendered twice and read once: the ranker
           * receives windows already cut and consults neither.
           */
          rrfK: {
            type: "integer",
            default: 60,
            description: "Rank-fusion constant \u2014 higher values flatten the difference between ranks."
          },
          recencyBoost: {
            type: "number",
            default: 0.15,
            description: "Extra score given to recent entries."
          },
          recencyDecay: {
            type: "number",
            default: 0.01,
            description: "How quickly the recency boost fades per message of age."
          },
          thresholdMin: {
            type: "number",
            default: 0.3,
            description: "Minimum similarity a match needs to be considered at all."
          },
          relativeThreshold: {
            type: "number",
            default: 0.7,
            description: "Drop matches scoring below this fraction of the best match."
          },
          mmrLambda: {
            type: "number",
            default: 0.7,
            description: "Balance between relevance and variety \u2014 1 is pure relevance, 0 maximum variety."
          },
          /**
           * ⚠ Not the five `SOURCES` the budget split uses. These are
           * the semantic mechanism's own record kinds — what a stored vector
           * *is* — and `historyEntry` vs `history` is a real
           * difference, not a spelling. Mapping one vocabulary onto
           * the other here would quietly rename keys the ranker
           * matches literally (`weights.ts DEFAULT_SEMANTIC`).
           */
          sourceBudget: {
            type: "perMember",
            members: [
              {
                key: "message",
                i18n: { en: "Messages" },
                description: { en: "Chat messages found by meaning." },
                tone: 0
              },
              {
                key: "worldLore",
                i18n: { en: "World lore" },
                description: { en: "Lorebook entries about the world." },
                tone: 1
              },
              {
                key: "characterLore",
                i18n: { en: "Character lore" },
                description: { en: "Lorebook entries bound to a character." },
                tone: 2
              },
              {
                key: "historyEntry",
                i18n: { en: "History entries" },
                description: { en: "Dated entries recording earlier events." },
                tone: 3
              },
              {
                key: "narrativeRelationship",
                i18n: { en: "Relationships" },
                description: { en: "The narrative graph. Off by default." },
                tone: 4
              }
            ],
            default: {
              message: 12,
              worldLore: 8,
              characterLore: 6,
              historyEntry: 6,
              narrativeRelationship: 5
            },
            i18n: { en: "Most matches per kind" },
            description: {
              en: "A ceiling on how many semantic matches of each kind survive fusion, before the budget ranker sees them."
            }
          },
          defaultSourceBudget: {
            type: "integer",
            default: 20,
            description: "The ceiling for any match kind not named above \u2014 what a plugin-added source gets until it declares its own."
          }
        }
      }
    },
    ports: {
      in: {
        /**
         * One entry per query window, each carrying its own per-message
         * ranked lists and its own similarity matrix. The whole stack
         * runs per window; the results are concatenated, not fused.
         */
        windows: S2.json,
        messages: S2.messages
      },
      out: {
        main: S2.candidates,
        candidates: S2.candidates,
        diagnostics: S2.json
      }
    }
  })
);
var rankRecall = pin2(
  describeTaskDefinition2({
    id: "chariot.recall:rank-recall@1",
    timeoutMs: 500,
    public: true,
    ports: rankPorts
  })
);
var assemble = pin2(
  describeTaskDefinition2({
    id: "core:task/assemble@2",
    timeoutMs: 1e3,
    slots: {
      // An *assembly* template: its scope really is the input ports, so this half of
      // 16 §4's claim holds.
      template: {
        kind: "template",
        // Handlebars FIRST, then Liquid: the first entry is what a new
        // template here is written in, and every shipped row holds
        // Handlebars — so the order is what keeps the parity corpus
        // byte-identical. Both are accepted because a story string is a
        // layout, not a dialect: the same arrangement is expressible in
        // either, and a slot naming one makes the other unselectable
        // everywhere. Jinja is absent because core renders neither
        // parity nor helpers for it (12 §2a).
        engines: [handlebars.id, liquid.id],
        facet: "templates",
        variables: {
          blocks: "any",
          budget: ["total", "remaining"],
          prompts: ["system", "postHistory"]
        },
        description: "The story string: the overall layout of the finished prompt \u2014 where the character cards, lore, history and instructions sit. Leave empty to use the built-in layout."
      },
      prompts: {
        kind: "prompts",
        quick: true,
        facet: "prompts",
        fields: {
          system: { type: "text" },
          postHistory: { type: "text" }
        }
      },
      /**
       * How the values Assemble itself produces are laid out.
       *
       * These three exist here rather than upstream because they come out
       * the other side of the budget: what a layout receives is what
       * actually fit, which no earlier node knows.
       *
       * `characterLore` is deliberately absent. It is a top-level value on
       * the assembly context that no template renders — qualifying entries
       * are folded into their bound character inside `characters`, under
       * an `"extra lore"` key. A layout for it would be a setting that
       * changes nothing.
       */
      variables: {
        kind: "variables",
        facet: "variables",
        description: "How the retrieved lore and history are laid out \u2014 JSON, prose, or whatever you write. Duplicate one to change it.",
        renders: {
          worldLore: "core:var/world-lore@1",
          history: "core:var/history@1",
          currentDate: "core:var/current-date@1"
        }
      },
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          /**
           * ⚠ No `budget` here either. It was an integer defaulting to
           * 4096 — the same re-entered number the ranker carried, with
           * the same defect: an absolute count on a node cannot know
           * which model the prompt is about to be sent to, so it was
           * free to disagree with the window and warn nobody. The
           * total now arrives on the `budget` in-port from
           * `core:task/context-budget@1`, which derives it from the
           * sampling config the reply is generated against.
           */
          /**
           * Where the post-history reminder goes, and whether it goes
           * at all.
           *
           * Numbers, so they are parameters rather than prompt text —
           * a `prompts` slot carries authored strings and typing a
           * count as one would be the wrong shape wearing a
           * convenient home. The trigger is a **suppression**: below
           * it a short chat gets no reminder, because a reinforcement
           * note two messages after the system prompt is noise.
           */
          postHistoryDepth: {
            type: "integer",
            default: 0,
            description: "Place the post-history reminder this many messages before the end. 0 puts it last."
          },
          postHistoryTokenTrigger: {
            type: "integer",
            default: 0,
            description: "Only add the reminder once the chat is at least this many tokens long. 0 always adds it."
          },
          /**
           * ⚠ No `truncation` here, and there was one — an enum of
           * `oldest-first | lowest-weight`, "what gets dropped first
           * when the context is over budget" — declared, rendered,
           * and read by nothing (culled 2026-09-16, R-12). Assemble
           * drops nothing: what fits is decided upstream by the
           * ranker's `select`, per band, against `share`,
           * `maxEntries`, `minEntries` and `scoreLedAllocation` on
           * `core:task/rank-hybrid@1`, and this node renders the
           * decisions it is handed. A second drop rule here would be
           * a second owner of one decision. NOMENCLATURE §25 records
           * the cull.
           */
          /**
           * Which sections the prompt is built from, and in what order —
           * SillyTavern's *prompt list*, as a param on the node that
           * assembles the prompt (ruling 2026-09-10).
           *
           * A param and not a session setting, and not a table: it is the
           * same kind of fact as "which prompt does this step use", so it
           * belongs in the configuration a preset selects and it is an
           * administrator's. A preset carries it to every session started
           * from it for free, because a preset's configuration is already
           * what a run resolves against.
           *
           * ⚠ **The declared default means "leave the template alone".** It
           * is the shipped template's own order, so a configuration nobody
           * has touched stores nothing and renders the bytes it always did —
           * and a template somebody WROTE, whose sections sit in an order
           * they chose, is not silently reordered into this one. See
           * `isShippedPromptBlocks`.
           */
          blocks: PROMPT_BLOCKS_DECL
        }
      },
      /**
       * Which connection this prompt is being written FOR.
       *
       * Not compute, and this node calls nothing: the only thing read out
       * of it is `metadata.promptFormat` — whether the finished prompt is
       * one instruct-wrapped string or a role-tagged array, and which
       * wrapper. A wire format is a property of the endpoint, and until
       * this slot existed there was no way for the node that renders the
       * prompt to learn it. `renderers.ts` fell back to Vicuna on every
       * run, so a ChatML or Llama-2 connection was sent Vicuna markers and
       * nothing anywhere said so.
       *
       * ## Wire it to the SENDING node, always
       *
       * `slot.connectionOf('generate')`, exactly as `contextBudget` shares
       * the sampling reference, and for the same reason stated there: a
       * prompt wrapped for one endpoint and sent to another is wrong
       * silently. Sharing the reference makes the two impossible to point
       * apart rather than documenting that they must agree and hoping.
       *
       * ## No `requires`
       *
       * The sibling connection slots declare one because they are about to
       * CALL the connection and an unmet capability should refuse at bind.
       * This one reads a label. Declaring a capability it never exercises
       * would let an untested connection grey itself out of a picker for a
       * node that was never going to send it anything.
       */
      connection: {
        kind: "connection",
        shape: S2.textGen,
        description: "Which connection this prompt is formatted for. Point it at the step that sends the reply \u2014 a prompt wrapped for one endpoint and sent to another is wrong in a way nothing reports."
      }
    },
    ports: {
      in: {
        candidates: S2.candidates,
        budget: S2.budget,
        templateContext: S2.templateContext,
        /**
         * The ranker's per-candidate trail — score, verdict, reason.
         *
         * ⚠ **Supplied since the node was written, declared only now.**
         * All three shipped specs wire `decisions: $.rank.decisions`,
         * and the binding halts without them ("wire a ranker between
         * retrieval and assembly"), so this is not a new input — it is
         * the load-bearing one. What was missing was the declaration,
         * and the cost of that is exact: `validate.ts` skips its shape
         * check when either side is undeclared (`if (!outShape ||
         * !inShape) continue`), so a plugin ranker publishing the wrong
         * shape on this edge got no finding, and a plugin ASSEMBLER had
         * nothing to read to learn the port existed.
         *
         * `json`, matching `rankPorts.out.decisions` — a decision is a
         * candidate with its arithmetic attached, and the panel reads
         * the same objects the allocator does.
         */
        decisions: S2.json,
        /**
         * The finished chat lines, from `core:task/process-messages@1`.
         *
         * Wired by all three specs (`messages: $.lines.messages`) and
         * undeclared for the same stretch as `decisions`. Two readers
         * depend on it and neither is optional: the transcript the
         * template renders, and the depth the post-history reminder is
         * placed at — which is computed against *these* lines because
         * the context builder ships a placeholder index, the final
         * array not existing when it runs.
         */
        messages: S2.messages,
        /**
         * Per band: allocated, used, entries — the arithmetic the
         * ranker did while deciding (D-H).
         *
         * ⚠ **The one genuinely new edge in this set.** The two
         * above were supplied and undeclared; this was PUBLISHED by
         * `core:task/rank-hybrid@1` and wired by nobody, so `allocate`
         * fell to its own `{}` and the per-band numbers the ranker had
         * already computed were dropped on the floor between two
         * adjacent nodes.
         *
         * What it does NOT touch is the prompt: `allocate` puts this
         * straight onto `AllocatedContext.groups` and reads it nowhere
         * else, so `blocks`, `totalTokens` and `budget` — everything
         * the render sees — are byte-identical with it wired or not.
         * What changes is the receipt: `dispatch.ts` publishes
         * `payload.groups` as the run's `sources`, which is the budget
         * panel's whole data set and has been empty on every run.
         *
         * Undeclared on purpose for the other rankers. A ranker that
         * computes no per-band usage leaves this unwired and
         * `allocate` takes the branch it has always taken.
         */
        groups: S2.json
      },
      out: { main: S2.assembled, context: S2.assembled }
    }
  })
);
var sessionCast = pin2(
  describeQueryDefinition({
    id: "core:query/session-cast@1",
    i18n: { name: { en: "Session cast" } },
    timeoutMs: 2e3,
    ports: {
      in: { scope: S2.sessionScope },
      out: { main: S2.sessionCast, cast: S2.sessionCast }
    }
  })
);
var relationshipSlots = (what) => ({
  params: {
    kind: "parameters",
    facet: "weights",
    schema: {
      maxEntries: {
        type: "integer",
        /**
         * ⚠ **No `default:`, and its absence is the declaration.**
         *
         * Neither spec ever named this slot, so `resolveInput` never
         * resolved it and `bindings.ts` called `capRelationships` with
         * `undefined` on every run this node type has ever made — which
         * that function reads as *no ceiling at all* and returns the
         * section whole. `respond` wires `params: slot.params()` now, so
         * whatever is declared here becomes live; under ruling D-8 the
         * declared default must therefore BE the value every run has
         * actually used, and that value is "uncapped".
         *
         * Uncapped is not expressible as a number here. `0` is already
         * taken and means the opposite — `capRelationships` returns
         * `null` for it, so the section is dropped entirely, which is the
         * `admitThreshold` / `maxEntries` off-switch convention this
         * package uses everywhere. A negative sentinel IS what
         * `capRelationships` reads as "no cap" (`cap < 0` returns the
         * section), but `min: 0` forbids one and no other parameter in
         * this package uses a negative sentinel; inventing the convention
         * here would be a design decision riding in on a wiring fix. And
         * a large finite number is not the value either — it is a
         * different value that is *usually* indistinguishable, which is
         * the kind of nearly-right that D-8 exists to refuse.
         *
         * So: no default. `resolveSlot`'s params branch copies a schema
         * default only `if (v?.default !== undefined)`, and
         * `reconcileConfigs` back-fills a row only when a declaration
         * carries one — so an untouched install resolves `undefined` and
         * stays uncapped, exactly as before. The control renders as an
         * empty box, which `NumberControl` and the panel already treat as
         * "unset" (an emptied box commits `undefined` and clears the
         * row), so the empty state round-trips rather than being a hole.
         *
         * `drizzle/0111` deletes the stored `12` that `reconcileConfigs`
         * back-filled from the old declaration; without it, wiring the
         * slot would cap every upgraded install at 12 as a side effect.
         */
        min: 0,
        quick: true,
        i18n: { en: "Most relationships" },
        description: {
          en: `A ceiling on how many ${what} reach the prompt, closest first. Leave it empty for no ceiling; 0 leaves the section out altogether.`
        }
      }
    }
  }
});
var RELATIONSHIP_TIMEOUT = 5e3;
var relationshipsPerspectives = pin2(
  describeQueryDefinition({
    id: "core:query/relationships-perspectives@1",
    i18n: {
      name: { en: "Relationships: their perspective" },
      description: {
        en: "How the speaking character regards the others, read from the narrative graph. Produces nothing when the chat has no lorebook or the speaker has no node in it."
      }
    },
    optional: true,
    timeoutMs: RELATIONSHIP_TIMEOUT,
    slots: relationshipSlots("of their own views"),
    ports: {
      in: { scope: S2.sessionScope },
      /**
       * `json`, not `text`. The summary used to be stringified inside
       * `buildGraphContext` and handed on as a finished blob, which made
       * it the one context value a layout could do nothing with — you
       * cannot render relationships as prose, drop a section, or even
       * change the indent if the shape was flattened upstream. The node
       * emits the structure and the variable layout renders it.
       */
      out: { main: S2.json, relationshipsPerspectives: S2.json }
    }
  })
);
var relationshipsKnown = pin2(
  describeQueryDefinition({
    id: "core:query/relationships-known@1",
    i18n: {
      name: { en: "Relationships: how others see them" },
      description: {
        en: "How the others regard the speaking character, plus any figures known to everyone. Read from the narrative graph."
      }
    },
    optional: true,
    timeoutMs: RELATIONSHIP_TIMEOUT,
    slots: relationshipSlots("views of them"),
    ports: {
      in: { scope: S2.sessionScope },
      out: { main: S2.json, relationshipsKnown: S2.json }
    }
  })
);
var relationshipSearch = pin2(
  describeQueryDefinition({
    id: "core:query/relationship-search@1",
    i18n: {
      name: { en: "Relationships: ranked" },
      description: {
        en: "The narrative graph as ranked candidates that compete for the context window, ordered by who is in the scene, who is speaking, and what changed most recently."
      }
    },
    optional: true,
    timeoutMs: RELATIONSHIP_TIMEOUT,
    slots: {
      params: {
        ...relationshipSlots("graph relationships").params,
        schema: {
          /**
           * The band's intent (R-7 P5), on the one relationship read
           * that ranks. `share` is 0, which is what the ranker's map
           * held: the band ships inert and the share is its switch —
           * every candidate leaves as `excluded_group_disabled` with
           * that reason until somebody raises it, and the two dump
           * nodes render the graph whole meanwhile.
           *
           * `maxEntries` is `relationshipSlots`' own — the ceiling
           * this node already applies before it publishes — and it is
           * the band's ceiling too: one number, the query's, rather
           * than a second on the ranker free to disagree. Absent
           * means uncapped, as it always has here, where the map's
           * `relationships: 0` was a cap of nothing sitting behind a
           * share of nothing — raising the share alone used to
           * exclude every relationship as over its ceiling. It does
           * not now. Migration 0135 culls a stored 0 for that reason
           * and moves anything else.
           */
          ...bandIntentFields({ label: "relationships", noun: "the narrative graph" }, { share: 0 }),
          // Declared second so the query's own wording and `min: 0`
          // win over the generic ceiling above.
          ...relationshipSlots("graph relationships").params.schema
        }
      }
    },
    ports: {
      /**
       * ⚠ **No `text` in-port**, for `core:query/entity-search@1`'s
       * reason: the four lore queries declared one that nothing filled
       * and nothing read (culled 2026-09-16), and shipping a fifth with
       * the same standing excuse written for it would have been adding
       * the defect on purpose. A relationship is reached by walking edges
       * from the speaker's node, so the scope is the whole of the
       * question.
       */
      in: { scope: S2.sessionScope },
      out: {
        // Both open with a band-intent element — the graph's own,
        // published whether or not a tie was found — ahead of the
        // items; readers call `splitCandidates()`.
        main: S2.candidates,
        hits: S2.candidates,
        /**
         * How many ties were walked, how many the scene was present
         * for, and what the ceiling did — the mechanism-level half of
         * the trail, which no per-candidate row can carry.
         *
         * Declared rather than merely published, unlike the lore lanes'
         * own diagnostics: an undeclared out-port is invisible to
         * `validate.ts` and unreadable by a plugin, which is the finding
         * `core:task/rank-hybrid@1`'s `groups` cost a release.
         */
        diagnostics: S2.json
      }
    }
  })
);
var contextPorts = {
  in: {
    cast: S2.sessionCast,
    /**
     * Whose voice the reply is, when a next-speaker node decided (19 §5).
     * Optional: unwired, the speaker still rides the cast bundle (the
     * scope's value), which is how every spec worked before the node
     * existed — and how the narrator's context, which has no speaker,
     * still works. Wired, it wins, so the receipt's speaker and the
     * prompt's speaker cannot disagree.
     */
    currentCharacterId: S2.rowIds
  },
  out: {
    main: S2.templateContext,
    templateContext: S2.templateContext,
    /**
     * The name on the trailing assistant line.
     *
     * Its own port rather than a field inside the context, because
     * nothing renders `{{seedName}}` — it is not a template variable.
     * It is what the message processor writes on the line the model
     * continues from, and in narrator mode it is the one name that
     * must *not* be the joined cast list: seeding "Alice and Cara:"
     * teaches the model to write joint dialogue instead of narrating.
     */
    seedName: S2.text
  }
};
var PROMPTS_DESCRIPTION = "The written instructions this pipeline sends the model \u2014 pick a prompt, or duplicate one and make it yours.";
var VARIABLES_DESCRIPTION = "How each part of the prompt is laid out \u2014 JSON, prose, or whatever you write. Duplicate one to change it.";
var sharedRenders = {
  instructions: "core:var/instructions@1",
  characters: "core:var/characters@1",
  personas: "core:var/personas@1",
  scenario: "core:var/scenario@1",
  postHistoryInstructions: "core:var/post-history-instructions@1",
  characterNames: "core:var/character-names@1",
  personaNames: "core:var/persona-names@1"
};
var buildTemplateContext = pin2(
  describeTaskDefinition2({
    id: "core:task/build-template-context@1",
    i18n: { name: { en: "Build template context" } },
    timeoutMs: 2e3,
    /**
     * The example-dialogue pick. Declaring it is what gets `ctx.random` — the
     * run-seeded RNG — instead of `Math.random()`, so the same run replayed
     * chooses the same example and a different turn still gets variety.
     */
    declaresRandomness: true,
    /**
     * The authored text. It arrives as config rather than on a port because it
     * *is* config — the same prompt config the assembly template renders from,
     * layered instance → user → chat like every other slot.
     */
    slots: {
      prompts: {
        kind: "prompts",
        quick: true,
        facet: "prompts",
        description: PROMPTS_DESCRIPTION,
        fields: {
          systemPrompt: { type: "text" },
          postHistoryInstructions: { type: "text" }
        }
      },
      variables: {
        kind: "variables",
        facet: "variables",
        description: VARIABLES_DESCRIPTION,
        renders: {
          ...sharedRenders,
          /** From the speaking character's card. */
          exampleDialogue: "core:var/example-dialogue@1",
          /**
           * The narrative graph, as two variables rather than one.
           *
           * They were `speakerRelationships` — a single block holding
           * both what the speaker thinks of everyone and what everyone
           * thinks of the speaker. Opposite claims under one heading,
           * which a model reads as one list, and one layout, one
           * priority and one on/off switch for both.
           */
          relationshipsPerspectives: "core:var/relationships-perspectives@1",
          relationshipsKnown: "core:var/relationships-known@1"
        }
      },
      /**
       * The pre-assemble context hook (18 §4a): user chains over the
       * finished template context — conditional style guides, seeded
       * event tables — after this node resolves it and before anything
       * renders it.
       *
       * `messages/inject` lives here too — **not** on the message
       * processor — because of the ruling of 2026-08-23: injections are
       * template-context *data* (`context.injections`, resolved to
       * `injectionsByIndex` beside `postHistory.targetIndex`), rendered
       * by the template's own message loop. Splicing them into the list
       * behind the template's back would be the §20 defect again, one
       * layer down: a position the template cannot express, an author
       * cannot see, and a corpus cannot check.
       */
      scripts: {
        kind: "scripts",
        accepts: ["core:script:context/transform@1", "core:script:messages/inject@1"],
        port: "main",
        phase: "after",
        description: "Scripts over what the prompt template renders \u2014 edit the instructions, roll an occasional event, or inject a reminder at a depth in the conversation."
      }
    },
    ports: {
      in: {
        ...contextPorts.in,
        /**
         * The narrative graph, as the two claims it really is — how the
         * speaker regards everyone, and how everyone regards the
         * speaker (D-I).
         *
         * ⚠ **Supplied by `respond` since the split, declared here
         * only now.** The spec wires both off
         * `core:query/relationships-perspectives@1` and
         * `core:query/relationships-known@1`, the two `renders` above
         * name the variables they feed, and the builder reads both by
         * these exact names — so every part of the round trip was
         * written down except the ports themselves.
         *
         * `json`, matching what those queries publish and for the
         * reason stated at them: the structure travels so a variable
         * layout can render it, rather than a blob nothing can
         * restyle.
         *
         * ⚠ Declared on THIS type alone rather than in `contextPorts`,
         * which the narrator builder shares. Its own docblock says the
         * narrate spec never supplies these because graph context
         * needs a speaker's perspective and a narrator has none — so
         * widening the shared map would give it two ports it must
         * leave empty forever, and move its hash to say so (S3).
         */
        relationshipsPerspectives: S2.json,
        relationshipsKnown: S2.json,
        /**
         * Who is speaking, when the speaker is not in the cast.
         *
         * ⚠ **Neither is wired by any spec, and both are supplied on
         * every side-character turn.** `core:task/build-side-character-
         * context@1` is not a separate implementation — the host's
         * binding for it unwraps its `sideCharacter` in-port and calls THIS
         * type's handler with the name and the card spread onto the
         * input, because `resolveContextInput` owns the card rules and
         * a side character's card and a cast member's must compile
         * through one function.
         *
         * So the supplier is the host rather than a document, and that
         * is exactly why declaring them matters: it is the only record
         * that this type's input surface is wider than its edges. An
         * undeclared key reaching a handler is indistinguishable from a
         * typo until someone reads both files at once.
         *
         * `speakerName` is `text` — it is the name on the seed line and
         * what `{{char}}` renders. `speakerCharacter` is `json`: the
         * card, or `null` for a free-form name, which is a normal turn
         * rather than a degraded one.
         */
        speakerName: S2.text,
        speakerCharacter: S2.json,
        /**
         * Who is speaking, as a participant reference (R-18 (3); U5g,
         * 2026-09-16) — the turn strategy's `speaker`. Read for one
         * thing: an **envoy** (`envoy:<slug>`) has no character row, so
         * its card — name and description, off the genre's declaration
         * the cast read carries — is compiled here where a cast
         * member's would be, through the same `speakerName` /
         * `speakerCharacter` seam a side character uses. A `character:`
         * reference changes nothing: `currentCharacterId` already says
         * it. Optional; unwired on the specs that seat no envoy.
         */
        speaker: S2.participantRef,
        /**
         * The session's resolved stats and states, as
         * `core:query/session-state@1` publishes them:
         * `{ world, cast, possessions }`, already resolved down the
         * session → lorebook → card → default chain.
         *
         * A template reads `state.world.weather` and
         * `state.cast.verity.hp` — the **resolved** value and nothing
         * below it. Which layer a number came from is a question for
         * the Cast member page, not for a prompt.
         *
         * ⚠ Declared on THIS type alone rather than in `contextPorts`,
         * following `relationshipsPerspectives` above and for the same
         * reason: widening the shared map moves the narrator's hash to
         * declare a port no shipped spec fills. Unwired — which is
         * every shipped spec today — the key is absent and the context
         * has no `state`, which is what a chat session should have.
         */
        state: S2.json
      },
      out: contextPorts.out
    }
  })
);
var buildNarratorContext = pin2(
  describeTaskDefinition2({
    id: "core:task/build-narrator-context@1",
    i18n: { name: { en: "Build narrator context" } },
    timeoutMs: 2e3,
    slots: {
      prompts: {
        kind: "prompts",
        quick: true,
        facet: "prompts",
        description: PROMPTS_DESCRIPTION,
        fields: {
          systemPrompt: { type: "text" },
          postHistoryInstructions: { type: "text" },
          narratorName: { type: "text" }
        }
      },
      variables: {
        kind: "variables",
        facet: "variables",
        description: VARIABLES_DESCRIPTION,
        renders: { ...sharedRenders }
      },
      /** The same hook as `build-template-context` — see it for the terms. */
      scripts: {
        kind: "scripts",
        accepts: ["core:script:context/transform@1", "core:script:messages/inject@1"],
        port: "main",
        phase: "after",
        description: "Scripts over what the prompt template renders \u2014 edit the instructions, roll an occasional event, or inject a reminder at a depth in the conversation."
      }
    },
    ports: contextPorts
  })
);
var buildSideCharacterContext = pin2(
  describeTaskDefinition2({
    id: "core:task/build-side-character-context@1",
    i18n: { name: { en: "Build side character context" } },
    timeoutMs: 2e3,
    slots: {
      prompts: {
        kind: "prompts",
        quick: true,
        facet: "prompts",
        description: PROMPTS_DESCRIPTION,
        fields: {
          systemPrompt: { type: "text" },
          postHistoryInstructions: { type: "text" }
        }
      },
      variables: {
        kind: "variables",
        facet: "variables",
        description: VARIABLES_DESCRIPTION,
        renders: { ...sharedRenders }
      },
      /** The same hook as the other two builders — see them for the terms. */
      scripts: {
        kind: "scripts",
        accepts: ["core:script:context/transform@1", "core:script:messages/inject@1"],
        port: "main",
        phase: "after",
        description: "Scripts over what the prompt template renders \u2014 edit the instructions, roll an occasional event, or inject a reminder at a depth in the conversation."
      }
    },
    ports: {
      in: {
        cast: contextPorts.in.cast,
        /**
         * `{ name, characterId, known, character }`, from the trigger's
         * first step. `name` is what the seed line carries and what
         * `{{char}}` renders; `character` is the card, absent for a
         * free-form name, which is a normal turn rather than a degraded
         * one — the builder falls back to the name it was given,
         * because a typed name is all there is.
         *
         * Was `speaker` until 2026-09-16 — see the inlet's port of
         * this name for why the fact moved off that word.
         */
        sideCharacter: S2.json,
        /**
         * Where this turn is happening, as the world state says it.
         *
         * Declared late, and for a defect rather than for symmetry: a
         * voice built with no place in front of it answered from
         * whatever the transcript suggested and moved the scene to a
         * harbour the plan had never mentioned. Unwired on every
         * pipeline that had this node before it, so those keep the
         * context they already had.
         */
        state: S2.json,
        /**
         * The planner's document, for the one fact the state cannot
         * supply on a first turn: where the scene is, before anything
         * has written a location down.
         */
        plan: S2.json
      },
      out: {
        ...contextPorts.out,
        /**
         * Who this voice is, as a **participant reference** —
         * `character:<id>` for a name the cast holds, null for a
         * free-form one. Additive, 2026-09-17 (W1).
         *
         * The resolution already happened: this node derives the
         * speaking character from the `sideCharacter` fact so the card,
         * `{{char}}` and the seed line agree. Publishing it is what lets
         * a lore lane INSIDE the same `each` be handed the same answer
         * — `speaker: $.voices.item.context.speaker` on
         * `core:query/character-lore@1` — rather than a second
         * name-to-row match somewhere downstream, which is how the
         * prompt's speaker and the lore's speaker come to disagree.
         *
         * ⚠ It is published, never taken: there is still no
         * `currentCharacterId` IN-port here, for the reason the header
         * gives. What changed is that the id the node computed is now
         * readable, not that a spec may set it.
         */
        speaker: S2.participantRef
      }
    }
  })
);
var agentContextSlots = (promptFields) => ({
  prompts: {
    kind: "prompts",
    quick: true,
    facet: "prompts",
    description: PROMPTS_DESCRIPTION,
    fields: promptFields
  },
  variables: {
    kind: "variables",
    facet: "variables",
    description: VARIABLES_DESCRIPTION,
    renders: { ...sharedRenders }
  },
  /** The same pre-assemble hook the other three builders carry. */
  scripts: {
    kind: "scripts",
    accepts: ["core:script:context/transform@1", "core:script:messages/inject@1"],
    port: "main",
    phase: "after",
    description: "Scripts over what the prompt template renders \u2014 edit the instructions, roll an occasional event, or inject a reminder at a depth in the conversation."
  }
});
var buildPlannerContext = pin2(
  describeTaskDefinition2({
    id: "core:task/build-planner-context@1",
    i18n: { name: { en: "Build planner context" } },
    timeoutMs: 2e3,
    slots: agentContextSlots({
      systemPrompt: { type: "text" },
      postHistoryInstructions: { type: "text" }
    }),
    ports: {
      in: {
        cast: contextPorts.in.cast,
        state: S2.json,
        /**
         * The session's own genre fields, by key — `tone`,
         * `difficulty` and whatever else the genre declared.
         *
         * On the template context under their own names, so an
         * authored prompt writes `{{tone}}` the way it writes
         * `{{char}}`. That is the whole round trip the genre's `fields`
         * declaration promises: declared on the genre, edited in
         * session settings, stored on the row, published by the input
         * node, and read here by the agent whose wording depends on
         * them. Without this port the last step was missing and a
         * prompt naming `{{tone}}` rendered a blank.
         */
        fields: S2.json
      },
      out: contextPorts.out
    }
  })
);
var buildSceneContext = pin2(
  describeTaskDefinition2({
    id: "core:task/build-scene-context@1",
    i18n: { name: { en: "Build scene context" } },
    timeoutMs: 2e3,
    slots: agentContextSlots({
      systemPrompt: { type: "text" },
      postHistoryInstructions: { type: "text" },
      narratorName: { type: "text" }
    }),
    ports: {
      in: {
        cast: contextPorts.in.cast,
        state: S2.json,
        /** What the planning step decided this turn is about. */
        plan: S2.json,
        /**
         * The session's own genre fields, by key — `tone`,
         * `difficulty` and whatever else the genre declared.
         *
         * On the template context under their own names, so an
         * authored prompt writes `{{tone}}` the way it writes
         * `{{char}}`. That is the whole round trip the genre's `fields`
         * declaration promises: declared on the genre, edited in
         * session settings, stored on the row, published by the input
         * node, and read here by the agent whose wording depends on
         * them. Without this port the last step was missing and a
         * prompt naming `{{tone}}` rendered a blank.
         */
        fields: S2.json
      },
      out: contextPorts.out
    }
  })
);
var buildKeeperContext = pin2(
  describeTaskDefinition2({
    id: "core:task/build-keeper-context@1",
    i18n: { name: { en: "Build state keeper context" } },
    timeoutMs: 2e3,
    slots: agentContextSlots({
      systemPrompt: { type: "text" },
      postHistoryInstructions: { type: "text" }
    }),
    ports: {
      in: {
        cast: contextPorts.in.cast,
        state: S2.json,
        /**
         * The reply this keeper is reading, as text — put on the
         * template context under `reply`, because the thing a keeper
         * reports on is the scene that was just written and the
         * transcript does not contain it yet.
         */
        reply: S2.text,
        /**
         * ⚠ **An ORDERING edge, and nothing else reads it.**
         *
         * A state change is anchored to the newest message in the
         * session, which is how a swipe takes its changes back with it.
         * So the keeper has to run AFTER the reply is written, not
         * merely beside it — and in a graph whose order is its edges,
         * the only way to say "after that write" is to take the write's
         * result on a port. It is the write result rather than the text
         * for exactly that reason: the text exists before the write and
         * would order nothing.
         *
         * ⚠ Typed `json`, NOT `write-result@1`, and the difference is
         * the standing rule rather than a convenience.
         * `core:shape/write-result@1` is deliberately accepted nowhere:
         * under async review a write is a proposal a reviewer may still
         * reject, so a port declaring that shape is a port promising to
         * handle both arms of it. This node handles neither — it never
         * looks inside — and declaring the shape would claim otherwise.
         * `json` is the honest type for a value taken as opaque, and
         * write results are assignable to it like everything else.
         */
        afterWrite: S2.json,
        /**
         * The session's own genre fields, by key — `tone`,
         * `difficulty` and whatever else the genre declared.
         *
         * On the template context under their own names, so an
         * authored prompt writes `{{tone}}` the way it writes
         * `{{char}}`. That is the whole round trip the genre's `fields`
         * declaration promises: declared on the genre, edited in
         * session settings, stored on the row, published by the input
         * node, and read here by the agent whose wording depends on
         * them. Without this port the last step was missing and a
         * prompt naming `{{tone}}` rendered a blank.
         */
        fields: S2.json
      },
      out: contextPorts.out
    }
  })
);
var processMessages = pin2(
  describeTaskDefinition2({
    id: "core:task/process-messages@1",
    i18n: { name: { en: "Process messages" } },
    timeoutMs: 1e3,
    slots: {
      /**
       * The message-rewrite hook (18 §4a), on the *processed* list —
       * names resolved, per-message interpolation done. `transform` only:
       * `messages/inject` deliberately does **not** live here. Injection
       * is a statement about *position in the rendered conversation*, and
       * position belongs to the template (§20, ruling of 2026-08-23) —
       * inject chains attach on the context builders, land as
       * `context.injections`, and the template's own loop renders them.
       * Splicing rows into this list would be a position the template
       * cannot express and an author cannot see.
       */
      scripts: {
        kind: "scripts",
        accepts: ["core:script:messages/transform@1"],
        port: "main",
        phase: "after",
        description: "Scripts over the message list the model will see \u2014 rewrite or drop lines. Reminders at a depth attach on the context step instead."
      }
    },
    ports: {
      in: {
        messages: S2.messages,
        cast: S2.sessionCast,
        templateContext: S2.templateContext,
        seedName: S2.text,
        /**
         * Text the model is being asked to CONTINUE — the seed line's
         * body rather than a message of its own (ruling 2026-09-08,
         * D-2).
         *
         * ⚠ **Absent on an ordinary turn, and that is the normal case.**
         * There is no `optional` marker for a port: a port nothing wires
         * resolves to `undefined`, the seed line renders empty, and the
         * model starts the reply. Every spec but a continue leaves it
         * unwired on purpose.
         *
         * It is a port rather than a second synthetic message because a
         * partial reply is not a turn: appending it as one produces two
         * consecutive assistant entries on a chat endpoint and a
         * wrongly-closed block on a completion one. The seed is the one
         * place in the prompt whose block is deliberately left open
         * (`includeClose: false` for id -2), which is exactly what a
         * continuation needs.
         *
         * ⚠ It is **not** a stored message, and nothing downstream may
         * treat it as one. The row holding it is `isGenerating` and is
         * excluded from every message read, so lore scans, semantic and
         * entity queries and history windows do not see it. It counts
         * against the token budget, because it is in the prompt.
         */
        continuationPrefill: S2.text
      },
      out: { main: S2.messages, messages: S2.messages }
    }
  })
);
var proseTranscript = pin2(
  describeTaskDefinition2({
    id: "core:task/prose-transcript@1",
    i18n: { name: { en: "Transcript as prose" } },
    timeoutMs: 1e3,
    ports: {
      in: {
        messages: S2.messages,
        cast: S2.sessionCast,
        templateContext: S2.templateContext
      },
      out: { main: S2.messages, messages: S2.messages }
    }
  })
);
var turnStrategy = (id, label2, extras = {}) => describeTaskDefinition2({
  id,
  i18n: { name: { en: label2 } },
  timeoutMs: 1e3,
  ...extras,
  ports: {
    in: {
      cast: S2.sessionCast,
      messages: S2.messages,
      /**
       * The explicit pick, when the trigger made one, as a
       * participant reference (R-18 (3)) — `character:<id>` or
       * `envoy:<slug>`. Always wins. Wired from the inlet's port of
       * the same name.
       */
      speaker: S2.participantRef,
      /**
       * @deprecated The explicit pick as a bare character id (one
       * release, from 2026-09-16). Honoured when `speaker` is unwired
       * or null; read `speaker`.
       */
      characterId: S2.rowIds
    },
    out: {
      main: S2.speakerSelection,
      /**
       * Who speaks, as a participant reference — the pick, or the
       * strategy's own `character:<id>`; null when nobody does.
       */
      speaker: S2.participantRef,
      /**
       * The bare id, for wiring into context and generation. Null
       * for an envoy, which has no row — the context and generation
       * consumers keep reading this until they speak references.
       */
      characterId: S2.rowIds,
      /** What decided — the receipt line §5 exists for. */
      strategy: S2.text
    }
  }
});
var turnRoundRobin = pin2(turnStrategy("core:task/turn-round-robin@1", "Round robin"));
var turnRandom = pin2(
  turnStrategy("core:task/turn-random@1", "Random", {
    declaresRandomness: true
  })
);
var turnManual = pin2(turnStrategy("core:task/turn-manual@1", "Manual"));
var turnNone = pin2(turnStrategy("core:task/turn-none@1", "No speaker"));
var attachImage = pin2(
  describeOutletDefinition({
    id: "core:outlet/attach-image@1",
    effects: "write",
    /** The image is a reference to an asset this run rendered; nothing to retype (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: 5e3,
    reviewDefault: "on",
    causesEvent: "core:event/message-updated@1",
    ports: { in: { target: S2.rowIds, image: S2.image }, out: { main: S2.writeResult } }
  })
);
var advertiseTools = pin2(
  describeTaskDefinition2({
    id: "core:task/advertise-tools@1",
    i18n: { name: { en: "Advertise tools" } },
    timeoutMs: 500,
    slots: {
      params: {
        kind: "parameters",
        schema: {
          style: {
            type: "enum",
            of: ["native", "prompt"],
            default: "prompt",
            description: "How the model learns its tools: 'native' hands the declarations to the API's own tool-calling; 'prompt' writes them into the context for models without one."
          }
        }
      }
    },
    ports: {
      // [{ name, description, parameters }] — parameters as JSON Schema.
      in: { tools: S2.json },
      out: { main: S2.json, native: S2.json, prompt: S2.text }
    }
  })
);
var parseToolCall = pin2(
  describeTaskDefinition2({
    id: "core:task/parse-tool-call@1",
    i18n: { name: { en: "Parse tool call" } },
    timeoutMs: 500,
    ports: {
      in: { text: S2.text, tools: S2.json },
      // `call` is { tool, args } | null — null is the loop's exit
      // predicate, not an error: a reply with no call is the model being
      // done. `text` is the reply with the call block stripped, so what
      // renders is prose and what dispatches is data.
      out: { main: S2.json, call: S2.json, text: S2.text }
    }
  })
);
var availableTools = pin2(
  describeQueryDefinition({
    id: "core:query/available-tools@1",
    i18n: { name: { en: "Available tools" } },
    timeoutMs: 2e3,
    slots: {
      params: {
        kind: "parameters",
        schema: {
          include: {
            type: "string[]",
            description: "Offer only these tools, by name, in this order. Empty offers every tool the session has."
          },
          plugins: {
            type: "boolean",
            default: true,
            description: "Offer tools contributed by the session's enabled extensions, as well as the built-in ones."
          }
        }
      }
    },
    ports: { in: { scope: S2.sessionScope }, out: { main: S2.json, tools: S2.json } }
  })
);
var runTool = pin2(
  describeOracleDefinition({
    id: "core:oracle/run-tool@1",
    i18n: { name: { en: "Run tool" } },
    effects: "external",
    /** The call was the model's and the tool list the install's: approve or refuse (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: 3e4,
    ports: {
      // `call` is parse-tool-call's `{ tool, args } | null`; `tools` is
      // advertise-tools' input, so refusal reads the same list the model
      // saw; `text` is the prose parse-tool-call stripped the call out of.
      in: { call: S2.json, tools: S2.json, text: S2.text },
      /**
       * Three ports because an iteration produces up to three different
       * things and one port carrying two of them is a port a downstream
       * node has to interrogate.
       *
       *  - `main` — `{ tool, result }` or `{ tool, error }`, or null when
       *    nothing was called. One shape, two arms, so nothing downstream
       *    decides what happened by looking for a missing key.
       *  - `text` — that rendered as the tool-result block **the next
       *    prompt carries**. Empty when nothing ran.
       *  - `answer` — what this iteration contributes to the
       *    **conversation**: the model's prose, and only on the iteration
       *    that called no tool, which is the one where the model stopped
       *    working and answered. Empty otherwise, so joining every
       *    iteration's `answer` yields the turn's reply and nothing else.
       */
      out: { main: S2.json, text: S2.text, answer: S2.text }
    }
  })
);
var joinText = pin2(
  describeTaskDefinition2({
    id: "core:task/join-text@1",
    i18n: { name: { en: "Join text" } },
    timeoutMs: 500,
    slots: {
      params: {
        kind: "parameters",
        schema: {
          path: {
            type: "string",
            default: "text",
            description: "Which key to read off each entry. Empty reads the entry itself, for a list of plain strings."
          },
          separator: {
            type: "string",
            default: "\n\n",
            description: "What goes between the entries that had something to say."
          }
        }
      }
    },
    ports: { in: { items: S2.json }, out: { main: S2.text, text: S2.text } }
  })
);
var parseJson = pin2(
  describeTaskDefinition2({
    id: "core:task/parse-json@1",
    i18n: { name: { en: "Read JSON" } },
    timeoutMs: 1e3,
    /**
     * A reply nobody can read subtracts the structure and nothing else.
     *
     * The binding answers `err` with the reason, the executor absorbs it as
     * `recoveredAsEmpty`, and every downstream port reads absent: a `map`
     * over the missing list runs zero times, a template renders no block. So
     * a model that ignored the schema costs a turn its plan, not its reply —
     * which is the same "an unavailable mechanism subtracts a signal, it
     * never disables a path" rule retrieval already works by.
     */
    optional: true,
    slots: {
      params: {
        kind: "parameters",
        schema: {
          path: {
            type: "string",
            quick: true,
            description: "Which value inside the answer to publish on `value` and `items`, as a dotted path. Empty publishes the whole answer."
          }
        }
      }
    },
    ports: {
      in: { text: S2.textStream },
      out: {
        main: S2.json,
        /** The whole parsed document, whatever `path` says. */
        json: S2.json,
        /** The value at `path` — the document itself when `path` is empty. */
        value: S2.json,
        /** That same value as a list, for a `map` to iterate. */
        items: S2.json
      }
    }
  })
);
var roll = pin2(
  describeTaskDefinition2({
    id: "chariot.dice-tray:roll@1",
    i18n: { name: { en: "Roll dice" } },
    timeoutMs: 200,
    declaresRandomness: true,
    public: true,
    ports: {
      in: { notation: S2.text },
      out: { main: S2.json, total: S2.json }
    }
  })
);
var gate = pin2(
  describeTaskDefinition2({
    id: "test:task/gate@1",
    timeoutMs: 500,
    ports: { in: { main: S2.json }, out: { main: S2.json } }
  })
);
var slow = pin2(
  describeTaskDefinition2({
    id: "test:task/slow@1",
    timeoutMs: 30,
    ports: { in: { main: S2.json }, out: { main: S2.json } }
  })
);
var passthrough = pin2(
  describeTaskDefinition2({
    id: "test:task/passthrough@1",
    timeoutMs: 500,
    toggleable: true,
    ports: { in: { main: S2.json }, out: { main: S2.json } }
  })
);
var badToggleable = pin2(
  describeTaskDefinition2({
    id: "test:task/bad-toggleable@1",
    timeoutMs: 500,
    toggleable: true,
    ports: { in: { main: S2.text }, out: { main: S2.image } }
  })
);
var embedText = pin2(
  describeOracleDefinition({
    id: "core:oracle/embed-text@1",
    shape: S2.embeddings,
    effects: "external",
    /** Nothing to edit: an embedding of a text somebody else wrote (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: 5e3,
    /**
     * ⚠ **Producing nothing is a legitimate outcome, and this is what makes
     * that structural rather than careful.**
     *
     * Embeddings are optional in this product by design: most installs have
     * no model loaded, and the retrieval plan's second governing rule is an
     * absolute — *an unavailable mechanism subtracts a signal; it never
     * reroutes, disables a path, or excludes a candidate.* The host answers
     * "no embedding model is loaded and validated" by **throwing**, which is
     * the right answer to give a caller and the wrong thing to let end a
     * turn.
     *
     * `optional` is what turns that error into an empty `ok` in the executor
     * — recorded, with `recoveredAsEmpty` and the reason on the receipt, so
     * it is tolerated rather than hidden. The binding's `enabled` parameter
     * decides how *loudly*: `auto` treats an unavailable model as an absence
     * and returns no vectors without calling it a failure, `on` lets the
     * failure be recorded as one. Neither can cost somebody a reply, and
     * that is the point of putting the guarantee here instead of in a
     * `try`.
     *
     * It also earns the node a "Use this source" switch, which is the
     * zero-cost way to turn the semantic mechanism off entirely on an install that
     * has a model and does not want it spent on retrieval.
     */
    optional: true,
    slots: {
      connection: {
        kind: "connection",
        quick: true,
        shape: S2.embeddings,
        // The two production rows carrying `modality: 'embeddings'` fell
        // through every modality switch in the app; `text->embedding` is
        // the home they never had.
        requires: [tf({ in: [IoKinds.text], out: [IoKinds.embedding] })]
      },
      params: {
        kind: "parameters",
        schema: {
          /**
           * `shared`: one switch for every embed step of a spec (R-7
           * P2). `respond` puts it on the semantic mechanism's embed
           * and the entity-vector mechanism's embed reads it through
           * `slot.params({ node })` — an install with no embedding
           * model switches both off in one place, which is the only
           * reading of "embedding: off" a person means.
           */
          enabled: {
            type: "enum",
            of: ["auto", "on", "off"],
            default: "auto",
            shared: true
          }
        }
      }
    },
    ports: {
      in: {
        text: S2.text,
        /** Batched: one call, one vector each, in order. */
        texts: S2.json
      },
      out: { main: S2.vector, vector: S2.vector, vectors: S2.json }
    }
  })
);
var mcpTool = pin2(
  describeOracleDefinition({
    id: "core:oracle/mcp-tool@1",
    i18n: {
      name: { en: "MCP tool" },
      description: {
        en: "Call one tool on a Model Context Protocol server, recorded verbatim and gated like every effectful step."
      }
    },
    shape: S2.mcp,
    effects: "external",
    /** Declared, not bound — plans/28 owns the handler (plans/29 R-2). */
    provisional: true,
    /** The arguments are the model's invocation: approve or refuse it, never rewrite it (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: 6e4,
    slots: {
      connection: {
        kind: "connection",
        quick: true,
        shape: S2.mcp,
        /**
         * ⚠ No `requires`, and that is deliberate rather than an omission.
         *
         * The capability space describes io TRANSFORMS — what a model can
         * be handed and what it gives back. An MCP server is not one: it
         * serves tools, it does not turn text into anything. The nearest
         * id, `text->text`, would be false, and claiming it would make
         * every chat connection in the install look offerable here.
         *
         * So this slot keeps filtering by `shape` alone, which is the
         * right axis for it. `requires` is for slots whose answer is "what
         * must this connection be able to DO".
         */
        description: "Which MCP server this step calls."
      },
      params: {
        kind: "parameters",
        schema: {
          tool: {
            type: "string",
            quick: true,
            i18n: { en: "Tool" },
            description: {
              en: "The advertised tool name on the connected server."
            }
          }
        }
      }
    },
    ports: {
      in: {
        /** Arguments for the tool, merged over any declared in params. */
        args: S2.json
      },
      out: {
        main: S2.json,
        text: S2.text,
        /** The content blocks exactly as the server returned them. */
        content: S2.json
      }
    }
  })
);
var mcpResource = pin2(
  describeOracleDefinition({
    id: "core:oracle/mcp-resource@1",
    i18n: {
      name: { en: "MCP resource" },
      description: {
        en: "Read one resource from a Model Context Protocol server, recorded verbatim."
      }
    },
    shape: S2.mcp,
    effects: "external",
    /** Declared, not bound — plans/28 owns the handler (plans/29 R-2). */
    provisional: true,
    /** The uri is the invocation: approve or refuse (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: 6e4,
    slots: {
      connection: {
        kind: "connection",
        quick: true,
        shape: S2.mcp,
        // No `requires` — see the sibling MCP node above: a tool server is
        // not an io transform, so `shape` is the right filter here.
        description: "Which MCP server this step reads from."
      },
      params: {
        kind: "parameters",
        schema: {
          uri: {
            type: "string",
            quick: true,
            i18n: { en: "Resource URI" },
            description: {
              en: "The advertised resource URI on the connected server."
            }
          }
        }
      }
    },
    ports: {
      in: {
        /** Overrides the declared URI when wired. */
        uri: S2.text
      },
      out: {
        main: S2.json,
        text: S2.text,
        content: S2.json
      }
    }
  })
);
var generateText = pin2(
  describeOracleDefinition({
    id: "core:oracle/generate-text@1",
    i18n: { name: { en: "Generate reply" } },
    shape: S2.textGen,
    effects: "external",
    /** The payload is the compiled prompt; a prompt rewritten at the gate is one the receipt cannot explain — approve or refuse (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: 12e4,
    timeoutKind: "idle",
    usage: "response.usage",
    slots: {
      connection: {
        kind: "connection",
        quick: true,
        shape: S2.textGen,
        /**
         * What the connection must be able to do, as opposed to what it
         * is called. `shape` above still types the SLOT; this types the
         * connection, and it is what the picker filters on and what the
         * bind check refuses by — naming "Chat" rather than an id.
         *
         * Only `requires`, deliberately — still, now that the binding DOES
         * consume `attachments`. It is the Anthropic adapter that sends
         * them today (as base64 content blocks on the last user turn); a
         * connection whose adapter has no such code REFUSES a request
         * carrying files rather than sending it without them, so the
         * `attachments` port is honest without a slot-level requirement.
         *
         * An `optional` vision requirement would meanwhile put a "no
         * vision" caveat on every text connection in the app, on every
         * run — and the port is empty on nearly all of them.
         */
        requires: [tf({ in: [IoKinds.text], out: [IoKinds.text] })],
        description: "Which model server this step sends its request to."
      },
      sampling: {
        kind: "sampling",
        quick: true,
        shape: S2.textGen,
        description: "The sampling settings \u2014 temperature and friends \u2014 used for this request."
      },
      /**
       * ⚠ No `prompts` slot, and there was one — `system` and
       * `postHistory`, "the written instructions sent with every request
       * from this step" (culled 2026-09-16, R-12). No handler read it:
       * the instructions reach the model INSIDE the assembled context,
       * through `core:task/assemble@2`'s own `prompts` slot, and this
       * node sends what it is handed on `context`. Every shipped spec
       * wired it as `slot.prompts({ node: 'context' })` for one reason
       * only — so the panel would not render a second copy of the
       * context builder's text — which is a declaration existing to hide
       * itself. The same slot on `generate-with-tools@1` and
       * `generate-json@1` went with it.
       */
      /**
       * ⚠ No `template` slot, and there was one — "how the assembled
       * context is wrapped for this model before sending".
       *
       * Nothing read it and nothing seeded a row, so it rendered as an
       * empty picker beside the settings that do work. Wrapping for the
       * wire is the `wire` slot's job and the connection adapter's; a
       * second, inert way to express it invited the two to disagree.
       */
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          stopSequences: {
            type: "string[]",
            description: "Sequences that end the reply the moment the model writes one. One per line."
          },
          streaming: streamingParam()
        }
      }
    },
    /**
     * Vision and interleaved output, declared.
     *
     * `accepts` is what makes a multimodal model reachable at all: before
     * this the only image ports in the whole graph pointed *outward*
     * (render, attach), so an image could be produced and stored but never
     * sent. `emits` says a reply may contain generated media — which is
     * what a single call now routinely returns, interleaved with the prose
     * rather than beside it.
     *
     * Declaring both here does not oblige a connection to do either; the
     * adapter reports what its model actually supports and the two are
     * resolved at bind time.
     */
    media: {
      accepts: ["image", "document"],
      emits: ["image"]
    },
    ports: {
      in: {
        context: S2.assembled,
        /**
         * Whose reply is being generated — the stop-string exclusion
         * (§27l): the speaking character's own name must not stop
         * their own reply. The host already preferred a payload value
         * over the run scope's; this port is what lets a spec supply
         * one, so the exclusion follows the next-speaker node's output
         * (19 §5) instead of the pre-run guess.
         */
        currentCharacterId: S2.rowIds,
        /**
         * Media travelling with the request — the page a user
         * attached, the frame a vision step is asked about. A list
         * because interleaving is ordered and a single ref could not
         * express "these three, in this order".
         *
         * Optional, and never quietly ignored: the host forwards these
         * references to the dispatch, which resolves each one to bytes
         * (checking it belongs to this run's session or user) and hands
         * them to the adapter in this order. A request whose connection
         * has vision switched off, or whose adapter has no code that
         * sends files, is REFUSED rather than sent without them —
         * dropping a file is indistinguishable from a model ignoring it.
         */
        attachments: S2.mediaList
      },
      /**
       * `parts` is the honest shape of a completion: an ordered list of
       * text, reasoning, generated media and tool calls. `main` and
       * `text` stay exactly as they were — `part-stream` is assignable
       * to `text-stream`, so every spec wired to them keeps working and
       * degrades by concatenating the prose.
       *
       * `thinking` is the reasoning trace the dispatch separated from
       * the text before the text reached the port — published by the
       * binding since it first stripped one, declared now that a
       * downstream write (`update-message`) takes it. Empty when the
       * model produced none.
       */
      out: {
        main: S2.partStream,
        text: S2.textStream,
        parts: S2.partStream,
        thinking: S2.text
      }
    }
  })
);
var generateWithTools = pin2(
  describeOracleDefinition({
    id: "core:oracle/generate-with-tools@1",
    i18n: { name: { en: "Generate with tools" } },
    shape: S2.textGen,
    effects: "external",
    /** The compiled prompt and the tool list: approve or refuse, as `generate-text` (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: 12e4,
    timeoutKind: "idle",
    usage: "response.usage",
    slots: {
      connection: {
        kind: "connection",
        quick: true,
        shape: S2.textGen,
        requires: [tf({ in: [IoKinds.text], out: [IoKinds.text] })],
        /**
         * Asked rather than required, so this node is bindable to every
         * text connection and the author decides what to do without one
         * — which is the ruling on `optional` (`ctx.can`): the type
         * system makes absence impossible to forget about, and the
         * fallback is the author's to write. A spec that wants the
         * emulated door instead wires `advertise-tools`' `prompt`.
         */
        optional: ["tools"],
        description: "Which model server this step sends its request to."
      },
      sampling: { kind: "sampling", quick: true, shape: S2.textGen },
      // No `prompts` slot — see `generateText` (culled 2026-09-16, R-12).
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          stopSequences: {
            type: "string[]",
            description: "Sequences that end the reply the moment the model writes one. One per line."
          },
          streaming: streamingParam()
        }
      }
    },
    media: { accepts: ["image", "document"], emits: ["image"] },
    ports: {
      in: {
        context: S2.assembled,
        /** `advertise-tools`' `native` port — the declarations, verbatim. */
        tools: S2.json,
        currentCharacterId: S2.rowIds,
        attachments: S2.mediaList
      },
      out: {
        main: S2.partStream,
        text: S2.textStream,
        parts: S2.partStream,
        /**
         * `{ tool, args }` when the model called one, null when it
         * answered — the same shape `parse-tool-call` publishes, so
         * `run-tool` and the loop's predicate take either door without
         * knowing which was used.
         */
        toolCall: S2.json
      }
    }
  })
);
var generateJson = pin2(
  describeOracleDefinition({
    id: "core:oracle/generate-json@1",
    i18n: { name: { en: "Generate JSON" } },
    shape: S2.textGen,
    effects: "external",
    /** The compiled prompt and the schema: approve or refuse, as `generate-text` (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: 12e4,
    timeoutKind: "idle",
    usage: "response.usage",
    /**
     * An answer nobody can read costs the structure and nothing else.
     *
     * The same guarantee `parse-json@1` makes, kept here because this node
     * replaced it in the chain: a planner whose document came back malformed
     * should leave a turn with no plan, narrated anyway, rather than a turn
     * that failed. The executor records `recoveredAsEmpty` and every
     * downstream port reads absent, so a `map` over the missing list runs
     * zero times.
     */
    optional: true,
    slots: {
      connection: {
        kind: "connection",
        quick: true,
        shape: S2.textGen,
        requires: [tf({ in: [IoKinds.text], out: [IoKinds.text] })],
        /**
         * Asked rather than required, which is the `ctx.can` ruling: the
         * node binds to every text connection and the binding decides
         * what to do without them. The ladder is `json_schema` (the
         * shape on the wire, natively or compiled to a grammar), then
         * `json_object` (JSON, shape unsaid), then a sentence in the
         * prompt — and the last rung works everywhere, so an absence
         * costs fidelity rather than the step.
         */
        optional: ["json_schema", "json_object"],
        description: "Which model server this step sends its request to."
      },
      sampling: { kind: "sampling", quick: true, shape: S2.textGen },
      // No `prompts` slot — see `generateText` (culled 2026-09-16, R-12).
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          /**
           * Which value inside the answer reaches `value` and `items`.
           *
           * A data reference is `{node, port}` with no sub-path, so a
           * downstream `map` cannot iterate `plan.speakers` off a port
           * carrying the whole document — the same reason `parse-json`
           * carries this parameter, and the same spelling.
           *
           * Several dotted paths separated by commas are read in order
           * and their lists joined. That is what makes an answer split
           * into arms wireable at all: a keeper reports
           * `{values, possessions}` because a schema can only be strict
           * about a list whose items are all one shape, and the node
           * that resolves them takes one list.
           */
          path: {
            type: "string",
            quick: true,
            description: "Which value inside the answer to publish on `value` and `items`, as a dotted path. Several paths, separated by commas, are joined in order. Empty publishes the whole answer."
          },
          stopSequences: {
            type: "string[]",
            description: "Sequences that end the reply the moment the model writes one. One per line."
          },
          streaming: streamingParam()
        }
      }
    },
    ports: {
      in: {
        context: S2.assembled,
        /**
         * The shape the answer must take, as a JSON Schema document.
         *
         * Optional, and the node is useful without it: an unschema'd
         * request still asks for JSON rather than prose. Supplied, it
         * reaches whichever field the connection's service calls it —
         * Ollama's `format`, OpenAI's `json_schema`, a GBNF grammar on
         * the llama.cpp family — and a connection that takes none
         * ignores it, which is the degradation rule the adapters
         * already follow for `responseFormat`.
         */
        schema: S2.json
      },
      out: {
        /** The parsed document, which is what this node is for. */
        main: S2.json,
        json: S2.json,
        /** The value at `path` — the document itself when `path` is empty. */
        value: S2.json,
        /** That same value as a list, for a `map` to iterate. */
        items: S2.json,
        /** What the model actually wrote, for a reader diagnosing the above. */
        text: S2.textStream
      }
    }
  })
);
var speak = pin2(
  describeOracleDefinition({
    id: "core:oracle/speak@1",
    i18n: { name: { en: "Speak" } },
    shape: S2.tts,
    effects: "external",
    /** Declared, not bound — plans/14 owns the handler (plans/29 R-2). */
    provisional: true,
    /** The words to be spoken may be corrected before the call (R-15 review fields). */
    review: { fields: ["text"] },
    timeoutMs: 6e4,
    slots: {
      connection: {
        kind: "connection",
        quick: true,
        shape: S2.tts,
        requires: [tf({ in: [IoKinds.text], out: [IoKinds.audio] })]
      },
      sampling: { kind: "sampling", quick: true, shape: S2.tts },
      template: {
        kind: "template",
        engine: jinja2.id,
        facet: "templates"
      },
      params: {
        kind: "parameters",
        facet: "weights",
        schema: { skipCodeBlocks: { type: "boolean", default: true } }
      }
    },
    ports: { in: { text: S2.text }, out: { main: S2.audio, audio: S2.audio } }
  })
);
var generateImage = pin2(
  describeOracleDefinition({
    id: "core:oracle/generate-image@1",
    i18n: { name: { en: "Generate image" } },
    shape: S2.imageGen,
    effects: "external",
    /** The prompt and the negative may be edited; `init` names an asset and may not (R-15 review fields). */
    review: { fields: ["prompt", "negative"] },
    // Idle rather than wall: a render is minutes on modest hardware, and a
    // backend still reporting progress is working, not hung.
    timeoutMs: 6e5,
    timeoutKind: "idle",
    slots: {
      connection: {
        kind: "connection",
        quick: true,
        shape: S2.imageGen,
        /**
         * The declaration that makes a KoboldCPP connection offerable
         * here at all: its TYPE says text, and what it can do says
         * otherwise.
         */
        requires: [tf({ in: [IoKinds.text], out: [IoKinds.image] })],
        description: "Which image server this step sends its request to."
      },
      sampling: {
        kind: "sampling",
        quick: true,
        shape: S2.imageGen,
        description: "Steps, CFG, size, seed \u2014 the settings every image backend shares."
      },
      prompts: {
        kind: "prompts",
        quick: true,
        facet: "prompts",
        description: "How the incoming text becomes what the image model is asked for.",
        fields: {
          positive: { type: "text" },
          negative: { type: "text" }
        }
      },
      /**
       * No `facet`, unlike the text nodes' `weights`: the one parameter
       * here decides how the request is SENT, and the weights facet is
       * where a person looks for what the model is asked for.
       *
       * On an image backend `off` is the difference between one request
       * and a render polled for progress and previews, which is the
       * whole of what a background stage saves by turning it off.
       */
      params: {
        kind: "parameters",
        schema: { streaming: streamingParam() }
      }
    },
    media: { emits: ["image", "video"] },
    ports: {
      in: {
        prompt: S2.text,
        negative: S2.text,
        /** An input image, for backends that report `img2img`. */
        init: S2.media
      },
      out: {
        main: S2.mediaList,
        media: S2.mediaList,
        image: S2.image,
        caption: S2.text
      }
    }
  })
);
var renderImage = pin2(
  describeOracleDefinition({
    id: "chariot.comfy:render-image@1",
    shape: S2.imageGen,
    effects: "external",
    /** A sample plugin oracle: its payload is a compiled prompt — approve or refuse (R-15 review fields). */
    review: { fields: [] },
    public: true,
    timeoutMs: 3e5,
    slots: {
      connection: {
        kind: "connection",
        quick: true,
        shape: S2.imageGen,
        requires: [tf({ in: [IoKinds.text], out: [IoKinds.image] })]
      },
      sampling: { kind: "sampling", quick: true, shape: S2.imageGen },
      prompts: {
        kind: "prompts",
        quick: true,
        facet: "prompts",
        fields: {
          positive: { type: "text" },
          negative: { type: "text" }
        }
      },
      params: {
        kind: "parameters",
        facet: "weights",
        schema: { steps: { type: "integer", default: 25 } }
      }
    },
    ports: {
      in: { context: S2.assembled },
      out: { main: S2.image, image: S2.image }
    }
  })
);
var sloppyStream = pin2(
  describeTaskDefinition2({
    id: "test:task/sloppy-stream@1",
    timeoutMs: 5e3,
    ports: { in: { main: S2.textStream }, out: { main: S2.json } }
  })
);
var sessionGreetings = pin2(
  describeQueryDefinition({
    id: "core:query/session-greetings@1",
    i18n: { name: { en: "Session greetings" } },
    timeoutMs: 2e3,
    ports: {
      in: { scope: S2.sessionScope },
      out: { main: S2.json, greetings: S2.json }
    }
  })
);
var seedGreetings = pin2(
  describeOutletDefinition({
    id: "core:outlet/seed-greetings@1",
    effects: "write",
    /** The greetings are the cards' own text and the channel the genre's: approve or refuse (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: 5e3,
    causesEvent: "core:event/message-created@1",
    ports: {
      in: {
        greetings: S2.json,
        /**
         * The channel the greetings land on (20 §7) — the genre's
         * declared greeting channel, written by the create specs as a
         * literal (`createChat.ts`, `adventure.ts`). Absent is `main`.
         * Declared 2026-09-16 (U2 residual): the host read it off the
         * payload while no declaration supplied it.
         */
        channel: S2.text
      },
      out: { main: S2.writeResult, messageIds: S2.writeResult }
    }
  })
);
var createMessage = pin2(
  describeOutletDefinition({
    id: "core:outlet/create-message@1",
    effects: "write",
    /** The text may be reviewed; who speaks, which row and which channel are the run's identity (R-15 review fields). */
    review: { fields: ["text"] },
    reviewDefault: "off",
    liveRow: true,
    timeoutMs: 5e3,
    causesEvent: "core:event/message-created@1",
    slots: {
      /**
       * The write hook (18 §4a): one chain rewrites the final output, the
       * other decides where a streamed reply stops. Stop is a verdict —
       * min-reduction across every attached script, and the connection's
       * own guards join the same union at dispatch (18 §4b), which is why
       * order never needs ruling. `speakerName` and `castNames` are
       * extras: readable, never writable, by construction (18 §6a).
       */
      scripts: {
        kind: "scripts",
        accepts: ["core:script:text/transform@1", "core:script:text/stop@1"],
        port: "text",
        phase: "before",
        extras: ["speakerName", "castNames"],
        description: "Scripts over the reply as it is saved \u2014 clean up the text, or stop a streaming reply early."
      }
    },
    ports: {
      in: {
        text: S2.text,
        /**
         * Media to post WITH the message, as references.
         *
         * Posting an image as a NEW message is one write, not a create
         * followed by an `attach-image`: the answer is the same one
         * streaming got — one node with a settled output, not two nodes
         * and a hope. The write that creates the message is the write
         * that attaches its images.
         */
        media: S2.mediaList,
        /**
         * Who is speaking, as a cast row — the inlet's `characterId`.
         * Null or absent means nobody in particular: narration, or a
         * message no character voices.
         */
        characterId: S2.rowIds,
        /**
         * The participant voicing this message when they are **not** a
         * cast row — the side-character fact `{ name, characterId, known }`
         * off `side-character-turn@1`'s `sideCharacter` port. Stored
         * beside the message under `metadata.sideCharacter` (was
         * `metadata.speaker` until U5g, 2026-09-16 — that key is the
         * participant reference now, on the row as on the inlet, R1),
         * where the run and the receipt read it from; it never writes a
         * cast row and never enters the rotation.
         *
         * Was `speaker` until 2026-09-16 — the inlet's port of that
         * name is a participant reference now (R-18 (3)).
         */
        sideCharacter: S2.json,
        /**
         * Who is speaking, as a **participant reference** (R-18 (3);
         * U5g, 2026-09-16) — `character:<id>` or `envoy:<slug>`, the
         * inlet's `speaker`. Stored beside the message as
         * `metadata.speaker`; it is the only identity an envoy's turn
         * carries, since an envoy has no row for `characterId` to name.
         * Optional: a spec that wires only `characterId` writes the row
         * it always wrote.
         */
        speaker: S2.participantRef,
        /**
         * Create the row as a **placeholder**: empty, generating, and the
         * run's live row — filled by a later `update-message`, or
         * finalised by core if the run stops first.
         *
         * A port, not a parameter, and the call site is what decides:
         * the reply specs write `generating: true` as a literal into the
         * node's config, in the same map as `text`, and `resolveInput`
         * passes it through untouched — so the binding reads it exactly
         * the way it reads a port (see `summarize-batch`'s `loreType`
         * for the same reasoning at length). A `params` field would put
         * a structural fact of the document in the panel as a knob.
         */
        generating: S2.json,
        /**
         * The message is **narration** — not a character's turn. Shown
         * under the narrator's name, never counted by the rotation. A
         * literal, on the same terms as `generating`. The name is the
         * session's narrator name, or the `speaker`'s where one was
         * named; the host resolves it at the write, which is where the
         * row is.
         */
        narration: S2.json,
        /**
         * Instructions this message was asked for — a narrator's focus
         * note. Stored beside the message and shown with it; never its
         * text. Wired from the inlet's `text` on the narrate specs, which
         * is what a narrator turn's triggering text is.
         */
        instructions: S2.text,
        /**
         * The channel the row lands on (20 §7). Absent is `main`, so a
         * pipeline that has never heard of channels writes where it
         * always did; a channel the session's genre never declared is
         * refused at the write. Declared 2026-09-16 (U2 residual) for
         * the same reason `seed-greetings` declares its own.
         */
        channel: S2.text,
        /**
         * An existing message row to take as the placeholder instead of
         * inserting one — the inlet's `messageId` on a regenerate, swipe
         * or continue. The row is reset to generating and becomes the
         * run's live row; its text and swipe history stay as the verb
         * left them. Absent on a fresh turn, which inserts.
         */
        row: S2.rowIds,
        /**
         * Message **blocks** to post with the row (20 §6; R-15
         * *Forms*; U5d, 2026-09-17): a list of `MessageBlock` — text,
         * tables, meters, and the two interactive kinds, `choices` and
         * `form`, which are **forms** when they carry an `addressee`.
         * The host validates the tree (`checkMessageBlocks`), refuses
         * a block naming a function this spec declares no action for
         * or one whose action is `world` (the effects line), stamps
         * each form with the writing spec's action identity and an
         * id, stores them as a `core:blocks` part, and — for a form
         * whose addressee the run's pinned portrayals say the AI
         * portrays — records `core:event/form-addressed@1` for the
         * genre's answer pipeline once this run's receipt is saved.
         * Absent on nearly every message.
         */
        blocks: S2.json
      },
      out: { main: S2.writeResult, messageId: S2.writeResult }
    }
  })
);
var updateMessage = pin2(
  describeOutletDefinition({
    id: "core:outlet/update-message@1",
    effects: "write",
    /** The text may be reviewed; the row may not, nor the reasoning trace (R-15 review fields). */
    review: { fields: ["text"] },
    timeoutMs: 5e3,
    causesEvent: "core:event/message-updated@1",
    slots: {
      /** The same write hook as `create-message` — see it for the terms. */
      scripts: {
        kind: "scripts",
        accepts: ["core:script:text/transform@1", "core:script:text/stop@1"],
        port: "text",
        phase: "before",
        extras: ["speakerName", "castNames"],
        description: "Scripts over the reply as it is saved \u2014 clean up the text, or stop a streaming reply early."
      }
    },
    ports: {
      in: {
        target: S2.rowIds,
        text: S2.text,
        /**
         * The reasoning trace the oracle separated from its text, when
         * the model produced one. Stored beside the message as the
         * thinking pane reads it; absent means none.
         */
        thinking: S2.text,
        /**
         * Blocks to append to the row — the same list, the same
         * checks and the same stamping as `create-message`'s
         * `blocks`; appended as a `core:blocks` part after the text
         * lands, so a reply can end with a question put to the cast.
         */
        blocks: S2.json
      },
      out: { main: S2.writeResult, messageId: S2.writeResult }
    }
  })
);
var deleteMessage = pin2(
  describeOutletDefinition({
    id: "core:outlet/delete-message@1",
    effects: "write",
    reviewDefault: "off",
    // Nothing to edit at the gate: approve the delete or refuse it. The
    // row it is about was judged by the handler (the item rule) before
    // the run began, and a reviewer retyping `target` would re-aim the
    // write at a row nobody judged (U5b review C1).
    review: { fields: [] },
    timeoutMs: 5e3,
    causesEvent: "core:event/message-deleted@1",
    ports: {
      in: { target: S2.rowIds },
      out: { main: S2.writeResult, messageId: S2.writeResult, lost: S2.json }
    }
  })
);
var hideMessage = pin2(
  describeOutletDefinition({
    id: "core:outlet/hide-message@1",
    effects: "write",
    reviewDefault: "off",
    /** The direction may be reviewed; the row may not (see `delete-message`). */
    review: { fields: ["hidden"] },
    timeoutMs: 5e3,
    causesEvent: "core:event/message-hidden@1",
    ports: {
      in: { target: S2.rowIds, hidden: S2.json },
      out: { main: S2.writeResult, messageId: S2.writeResult, hidden: S2.json }
    }
  })
);
var editMessage = pin2(
  describeOutletDefinition({
    id: "core:outlet/edit-message@1",
    effects: "write",
    reviewDefault: "off",
    /** The text may be reviewed; the row may not (see `delete-message`). */
    review: { fields: ["text"] },
    timeoutMs: 5e3,
    causesEvent: "core:event/message-edited@1",
    ports: {
      in: { target: S2.rowIds, text: S2.text },
      out: { main: S2.writeResult, messageId: S2.writeResult, previous: S2.json }
    }
  })
);
var swipeMessage = pin2(
  describeOutletDefinition({
    id: "core:outlet/swipe-message@1",
    effects: "write",
    reviewDefault: "off",
    /**
     * A recorded alternative's text may be reviewed; neither the row nor
     * the `index` — which alternative a navigation selects is as much the
     * request's identity as the row is (see `delete-message`).
     */
    review: { fields: ["text"] },
    timeoutMs: 5e3,
    causesEvent: "core:event/message-swiped@1",
    ports: {
      in: { target: S2.rowIds, index: S2.json, text: S2.text },
      out: {
        main: S2.writeResult,
        messageId: S2.writeResult,
        swipeIndex: S2.json,
        previous: S2.json
      }
    }
  })
);
var branchSession = pin2(
  describeOutletDefinition({
    id: "core:outlet/branch-session@1",
    effects: "write",
    reviewDefault: "off",
    /** The title may be reviewed; the fork point may not (see `delete-message`). */
    review: { fields: ["title"] },
    timeoutMs: 3e4,
    causesEvent: "core:event/session-branched@1",
    ports: {
      in: { fromMessage: S2.rowIds, title: S2.text },
      out: { main: S2.writeResult, sessionId: S2.writeResult }
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
var formContext = pin2(
  describeTaskDefinition2({
    id: "core:task/form-context@1",
    i18n: { name: { en: "Form as prompt and schema" } },
    timeoutMs: 1e3,
    ports: {
      in: { form: S2.json, templateContext: S2.templateContext },
      out: {
        main: S2.templateContext,
        templateContext: S2.templateContext,
        schema: S2.json,
        question: S2.text
      }
    }
  })
);
var makeChoices = pin2(
  describeTaskDefinition2({
    id: "core:task/make-choices@1",
    i18n: { name: { en: "Question as choices" } },
    timeoutMs: 1e3,
    ports: {
      in: {
        /** The oracle's document: `{ question, options, addressee? }`. */
        json: S2.json,
        /** The function every option fires — the block's `fn`. */
        fn: S2.text,
        /**
         * The identity of the declaration the options fire, when it is
         * another spec's (`core:spec/adventure-answer#answer`). Absent,
         * the host stamps this spec's own declaration for `fn` at the
         * write.
         */
        action: S2.text,
        /** Who the question is put to. Wired, it wins over the document's. */
        addressee: S2.participantRef,
        /** The cast, to resolve a name the document used into a reference. */
        cast: S2.sessionCast
      },
      out: {
        main: S2.json,
        blocks: S2.json,
        /** The question as prose — the row's content. */
        text: S2.text,
        /** Who the block was addressed to, resolved; null when nobody. */
        addressee: S2.participantRef
      }
    }
  })
);
var readAnswer = pin2(
  describeTaskDefinition2({
    id: "core:task/read-answer@1",
    i18n: { name: { en: "Read the answer" } },
    timeoutMs: 1e3,
    ports: {
      in: { payload: S2.json, form: S2.json },
      out: {
        main: S2.json,
        /** The chosen option's key (`choices`), else null. */
        choice: S2.text,
        /** The chosen option's label, else null. */
        label: S2.text,
        /** Who answered, as a participant reference — the form's addressee. */
        addressee: S2.participantRef,
        /** The addressee's character row, null for an envoy or a person. */
        characterId: S2.rowIds,
        question: S2.text,
        /** The whole answer: `{ choice }` or the entered values. */
        values: S2.json
      }
    }
  })
);
var answerForm = pin2(
  describeOutletDefinition({
    id: "core:outlet/answer-form@1",
    i18n: { name: { en: "Answer the form" } },
    effects: "write",
    reviewDefault: "off",
    /** The answer may be corrected at the gate; which form, and who answers, may not (R-15 review fields). */
    review: { fields: ["answer"] },
    /**
     * A write's timeout, not a run's (was 600000 until 2026-09-17, U5d
     * review W2): the commit checks the answer, asks the cycle caps and
     * **collects** the fire — the action's run is dispatched by the host
     * after this run's receipt is saved, outside any node timeout, as
     * this run's child. A grandchild parked at review parks nothing here.
     *
     * Thirty seconds rather than a write's usual five (U5d review S-a,
     * the same day): the commit does database work of its own — the
     * block off the row, the session, the routing, a cap refusal's
     * receipt — and under PGlite contention (a full test run, a busy
     * install) five seconds turned a legible **halt** into a timeout
     * `err` with no sentence. The ceiling is still a write's order of
     * magnitude, never a model call's: nothing here waits on an oracle.
     */
    timeoutMs: 3e4,
    causesEvent: "core:event/form-answered@1",
    ports: {
      in: {
        /** The block, as the inlet published it. */
        form: S2.json,
        /** The oracle's document — checked against `formAnswerSchema(form)`. */
        answer: S2.json,
        messageId: S2.rowIds,
        blockId: S2.text,
        addressee: S2.participantRef
      },
      out: {
        main: S2.writeResult,
        messageId: S2.writeResult,
        /** The answer as committed: `{ choice }` or the values. */
        answer: S2.json,
        /** The identity of the action the answer fires — `<spec slug>#<key>`. */
        firedAction: S2.text,
        /** The child run's id, chosen at the commit so this receipt can name it. */
        firedRunId: S2.text
      }
    }
  })
);
var attachAudio = pin2(
  describeOutletDefinition({
    id: "core:outlet/attach-audio@1",
    effects: "write",
    /** A reference to rendered audio; nothing to retype (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: 5e3,
    causesEvent: "core:event/message-updated@1",
    ports: { in: { target: S2.rowIds, audio: S2.audio }, out: { main: S2.writeResult } }
  })
);
var summarizeRequest = pin2(
  describeInletDefinition({
    id: "core:inlet/summarize-request@1",
    ports: {
      out: {
        main: S2.summarizeRequest,
        scope: S2.sessionScope,
        request: S2.summarizeRequest
      }
    }
  })
);
var summarizeSource = pin2(
  describeQueryDefinition({
    id: "core:query/summarize-source@1",
    i18n: { name: { en: "Messages to summarize" } },
    timeoutMs: 5e3,
    ports: {
      in: { scope: S2.sessionScope, request: S2.summarizeRequest },
      out: { main: S2.messages, messages: S2.messages }
    }
  })
);
var batchMessages = pin2(
  describeTaskDefinition2({
    id: "core:task/batch-messages@1",
    i18n: { name: { en: "Batch messages" } },
    timeoutMs: 2e3,
    slots: {
      /**
       * The window the cut is clamped to — the same slot, by reference,
       * that the drafting step generates against.
       *
       * The context window belongs to the sampling config, never to a knob
       * on a node (17 §1a), and the executor resolves a `sampling` slot to
       * the config's switched-on *values* — so this stays a pure Task
       * reading data it was handed rather than a Query looking one up. Same
       * shape and same reason as `core:task/context-budget@1`.
       *
       * ⚠ Wire it as a REFERENCE to the drafting Provider's slot
       * (`slot.samplingOf(...)`), not as a picker of its own. A batch cut
       * against one window and drafted against another is wrong in the
       * direction that overflows, silently — and unlike the assembled
       * context there is no truncation on this path to catch it, because
       * the batch prompt is injected whole.
       */
      sampling: { kind: "sampling", quick: true },
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          /**
           * The chat half of a batch prompt, and only that half — the
           * template around it and the room the draft is written back
           * into are a reserve the binding adds on top, which is why
           * this can be raised right up to the window minus that
           * reserve and no further.
           *
           * ⚠ Bigger is not better. Long-context models degrade in the
           * middle, so this is a QUALITY point rather than a fraction
           * of whatever window happens to be available: nothing scales
           * it up to fill a large one, and the window is only ever a
           * ceiling on what an admin asks for.
           *
           * 2560 is 0.5's effective batch (`4096 - 1500`) at a round
           * 2.5 Ki, so arriving here re-tunes nobody.
           */
          batchTokens: {
            type: "integer",
            default: 2560,
            i18n: { en: "How much chat each batch holds" },
            description: {
              en: "Tokens of chat one summary draft is written from. Capped by the drafting step\u2019s Context Tokens, less room for the prompt and the draft itself."
            }
          },
          minBatchMessages: {
            type: "integer",
            default: 1,
            description: "Never cut a batch smaller than this many messages."
          }
        }
      }
    },
    ports: {
      in: { messages: S2.messages },
      out: { main: S2.drafts, batches: S2.drafts }
    }
  })
);
var summarizeBatch = pin2(
  describeOracleDefinition({
    id: "core:oracle/summarize-batch@1",
    i18n: { name: { en: "Draft a batch" } },
    shape: S2.textGen,
    effects: "external",
    /** A drafting call over a batch: approve or refuse (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: 12e4,
    timeoutKind: "idle",
    usage: "response.usage",
    /**
     * The first interior point (18 §4e), and core dogfooding it (07 §0b):
     * every intermediate draft passes the user's chain before synthesis
     * reads it — slop killed in the material summaries are built *from*,
     * not only in final replies. Invoked by the binding via
     * `ctx.scripts.applyText('each-draft', …)`; recorded per application
     * as `appliedBy: 'binding'`. Declares what it accepts (R-11): a draft
     * is text, so text transforms — said here rather than assumed by the
     * broker, which is the difference between a point a plugin can shape
     * and a literal in the executor.
     */
    scriptPoints: [
      {
        key: "each-draft",
        accepts: ["core:script:text/transform@1"],
        label: { en: "Each draft" },
        description: {
          en: "Runs over every intermediate draft this step produces, before synthesis reads them."
        }
      }
    ],
    slots: {
      connection: {
        kind: "connection",
        quick: true,
        shape: S2.textGen,
        requires: [tf({ in: [IoKinds.text], out: [IoKinds.text] })]
      },
      sampling: { kind: "sampling", quick: true, shape: S2.textGen },
      prompts: {
        kind: "prompts",
        quick: true,
        facet: "prompts",
        fields: { batch: { type: "text" } }
      }
    },
    ports: {
      // `request` carries what a person asked for — the topic line, most
      // visibly — so the drafting prompt can honour it. The whole request
      // object travels rather than a plucked field, because what the
      // request holds is the socket's contract with its modal, not this
      // node's to enumerate.
      in: {
        batch: S2.messages,
        request: S2.summarizeRequest,
        /**
         * Which kind of entry this pipeline writes — the word every
         * summarize prompt template branches on (D-I).
         *
         * ## A port, not a parameter, and the call site is what decides
         *
         * `summarizeSpec` writes it as a **literal into the node's
         * config**, in the same map as `batch` and `request` and
         * alongside them: `C.summarizeBatch.v1({ batch, request,
         * loreType, … })`. `resolveInput` passes a non-ref config value
         * through untouched, so the binding reads `input.loreType`
         * exactly the way it reads a port — same position, same access,
         * same absence-is-`undefined`. Declaring it as anything else
         * would describe a mechanism that is not the one running.
         *
         * A `params` field is the alternative, and it is the wrong one
         * twice over. It would move the read to `input.params.loreType`
         * — a different value from a different layer — and it would put
         * the control in the panel, stored per configuration and
         * layered instance → user → session like every other parameter.
         * `SummarizeShape` in the catalog already rules on that: this is
         * "the thing that distinguishes the four namespaces from one
         * another", and a user who changed it "would turn their scene
         * summarizer into a world summarizer without renaming
         * anything".
         *
         * ⚠ An in-port no edge feeds is not a contradiction here. A
         * port is a named input the node reads; where the value comes
         * from — an upstream node, or an author writing it down — is the
         * document's business. What the declaration buys is that the
         * name is now checkable: the app's binding types derive their
         * legal reads from `ports.in`, so `input.loreTypes` stops
         * compiling, and the panel and the plugin validator can both see
         * that this node takes one.
         *
         * `text` rather than an enum shape: a shape ids a payload, and
         * the four legal words are the prompt templates' vocabulary,
         * which a plugin summarizer is free to extend.
         */
        loreType: S2.text
      },
      out: { main: S2.textStream, draft: S2.textStream }
    }
  })
);
var summarizeSynth = pin2(
  describeOracleDefinition({
    id: "core:oracle/summarize-synth@1",
    i18n: { name: { en: "Synthesize the drafts" } },
    shape: S2.textGen,
    effects: "external",
    /** The merge call: approve or refuse (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: 12e4,
    timeoutKind: "idle",
    usage: "response.usage",
    slots: {
      connection: {
        kind: "connection",
        quick: true,
        shape: S2.textGen,
        requires: [tf({ in: [IoKinds.text], out: [IoKinds.text] })]
      },
      sampling: { kind: "sampling", quick: true, shape: S2.textGen },
      prompts: {
        kind: "prompts",
        quick: true,
        facet: "prompts",
        fields: { synth: { type: "text" } }
      }
    },
    ports: {
      // Same `request` pass-through as the batch step: the topic reaches
      // synthesis too, or a focused summary drifts back to a general one
      // the moment the drafts are merged.
      in: {
        drafts: S2.drafts,
        request: S2.summarizeRequest,
        /** Authored on the node, exactly as on the batch step — see it. */
        loreType: S2.text
      },
      out: { main: S2.textStream, content: S2.textStream }
    }
  })
);
var nameEntry = pin2(
  describeOracleDefinition({
    id: "core:oracle/name-entry@1",
    i18n: { name: { en: "Name the entry" } },
    shape: S2.textGen,
    effects: "external",
    /** Approve or refuse; the name it produces is reviewed at the entry's write (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: 6e4,
    usage: "response.usage",
    slots: {
      connection: {
        kind: "connection",
        quick: true,
        shape: S2.textGen,
        requires: [tf({ in: [IoKinds.text], out: [IoKinds.text] })]
      },
      sampling: { kind: "sampling", quick: true, shape: S2.textGen },
      prompts: {
        kind: "prompts",
        quick: true,
        facet: "prompts",
        fields: { name: { type: "text" } }
      }
    },
    ports: {
      in: {
        content: S2.text,
        /** Authored on the node, exactly as on the two steps above — see them. */
        loreType: S2.text
      },
      out: { main: S2.textStream, name: S2.textStream }
    }
  })
);
var extractCast = pin2(
  describeOracleDefinition({
    id: "core:oracle/extract-cast@1",
    i18n: { name: { en: "Extract the cast" } },
    shape: S2.textGen,
    effects: "external",
    /** Approve or refuse (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: 6e4,
    usage: "response.usage",
    slots: {
      connection: {
        kind: "connection",
        quick: true,
        shape: S2.textGen,
        requires: [tf({ in: [IoKinds.text], out: [IoKinds.text] })]
      },
      sampling: { kind: "sampling", quick: true, shape: S2.textGen },
      prompts: {
        kind: "prompts",
        quick: true,
        facet: "prompts",
        fields: { characterExtraction: { type: "text" } }
      },
      /**
       * The two halves of a replaceable core function, on the scripts
       * rung. Scripts here *shape* the extraction — what the model reads,
       * what the pipeline keeps. Replacing the extractor itself is the
       * other rung: a same-shaped provider offered by the swap list,
       * because extraction calls a model and scripts are pure compute.
       */
      scripts: {
        kind: "scripts",
        accepts: ["core:script:text/transform@1"],
        port: "content",
        phase: "before",
        description: "Scripts over the scene text before the extractor reads it \u2014 strip out-of-character chatter, normalise a nickname, redact."
      },
      castScripts: {
        kind: "scripts",
        accepts: ["core:script:cast/transform@1"],
        port: "cast",
        phase: "after",
        description: "Scripts over the extracted cast \u2014 rename someone, merge aliases, drop a junk detection, add someone the model missed."
      }
    },
    ports: {
      // `request` carries the known cast list ([id: N] entries) so the
      // extraction prompt can reference real ids — without it the model
      // invents castIds and the resolve step silently drops every one.
      //
      // ⚠ No `messages` in-port, and there was one (culled 2026-09-16,
      // R-12). `summarize` wired the transcript into it and the handler
      // never read it: the extractor works from `content` — the synthesised
      // summary — which is what the prompt builder takes. A port a spec
      // fills and nothing reads costs the run a copy of the transcript
      // and tells a reader the extractor sees it.
      in: {
        content: S2.text,
        request: S2.summarizeRequest
      },
      out: { main: S2.json, cast: S2.json }
    }
  })
);
var entryKeys = pin2(
  describeQueryDefinition({
    id: "core:query/entry-keys@1",
    i18n: {
      name: { en: "Suggest keywords" },
      description: {
        en: "Proposes the keywords an entry should be found by, taken from its own text. Runs on your machine, calls no model, and can only ever suggest words the text actually contains."
      }
    },
    /**
     * Pure computation over rows already in the database — one pass over the
     * lorebook per candidate word. It reads no network and loads no model, so
     * the only way it can take long is a very large book.
     */
    timeoutMs: 5e3,
    /**
     * Producing nothing is an ordinary and correct outcome — a passage with
     * nothing distinctive in it gets no keys rather than the five least
     * common words it happens to contain — and a suggestion must never be
     * able to cost somebody their summary. Both are the same `optional`.
     */
    optional: true,
    slots: {
      params: {
        kind: "parameters",
        facet: "weights",
        schema: {
          /**
           * ⚠ **A ceiling on firing opportunities, not a display
           * preference.** Any single key matching admits the entry, so
           * this is how wide the entry's door is — and the keyword
           * signal is `matched / keys.length`, so a longer list also
           * makes the entry *rank* worse for the same single hit.
           *
           * Five: a scene is about a place, a thing and an event or
           * two. Measured at eight, with the ordinary-word cap opened
           * with it, **six of twelve** history entries fire on
           * narrative prose naming nothing from any scene — against
           * one at five — and the shared-name probe stops being clean.
           * **0 is off**, in the `admitThreshold` convention.
           *
           * It is a ceiling and never a target — fewer is the normal
           * result and none is a valid one.
           */
          maxKeys: {
            type: "integer",
            default: 5,
            min: 0,
            max: 20,
            quick: true,
            i18n: { en: "Most keywords suggested" },
            description: "A ceiling on how many keywords are proposed for one entry. Each one is another way the entry can be pulled into a prompt, so a short list is usually a better one. 0 suggests none."
          },
          /**
           * ⚠ **The one calibration a user can actually reason about**,
           * and the reason the others are not here. How rare a word has
           * to be, how short it may be, how much of a name to keep —
           * those are measurements, not preferences, and a settings
           * panel cannot perform them.
           *
           * This one is a preference, because it trades two things a
           * user can feel: an ordinary word like "watch" or "left" is
           * how an entry gets found when it names nothing proper, and
           * it is also how an entry starts firing on any scene at all.
           * Two ordinary words of five; 0 restricts suggestions to
           * names and places, which measured cleanest and left two of
           * twelve summaries with no keys at all.
           */
          maxOrdinaryWords: {
            type: "integer",
            default: 2,
            min: 0,
            max: 20,
            i18n: { en: "Ordinary words allowed" },
            description: "How many of the suggestions may be everyday words rather than names of people, places or things. Names are far less likely to pull the entry into an unrelated scene; 0 suggests names only."
          }
        }
      }
    },
    ports: {
      in: {
        /** The lorebook and the cast — what distinctiveness is measured against. */
        scope: S2.sessionScope,
        /**
         * The passage keys are proposed for.
         *
         * `content`, matching `name-entry@1`, so both proposal steps take
         * the drafted summary off the same out-port under the same name.
         */
        content: S2.text
      },
      out: {
        main: S2.json,
        /** The proposals, each with the evidence for it. */
        keys: S2.json,
        /** Every candidate turned away, and the rule that turned it away. */
        rejected: S2.json
      }
    }
  })
);
var createLoreEntry = pin2(
  describeOutletDefinition({
    id: "core:outlet/create-lore-entry@1",
    i18n: { name: { en: "Save the lore entry" } },
    effects: "write",
    /** Both the name and the content may be edited before the entry lands (R-15 review fields). */
    review: { fields: ["name", "content"] },
    timeoutMs: 1e4,
    causesEvent: "core:event/lore-entry-created@1",
    ports: {
      in: { name: S2.text, content: S2.text },
      out: { main: S2.writeResult, entryId: S2.writeResult }
    }
  })
);
var graphScenes = pin2(
  describeQueryDefinition({
    id: "core:query/graph-scenes@1",
    i18n: { name: { en: "Scenes to build from" } },
    timeoutMs: 5e3,
    ports: {
      in: { scope: S2.sessionScope },
      out: { main: S2.graphScenes, scenes: S2.graphScenes }
    }
  })
);
var graphStep = (id, label2, field, extra = {}) => pin2(
  describeOracleDefinition({
    id,
    i18n: { name: { en: label2 } },
    shape: S2.textGen,
    effects: "external",
    /** Each graph step sends a compiled prompt: approve or refuse (R-15 review fields). */
    review: { fields: [] },
    timeoutMs: extra.timeoutMs ?? 12e4,
    timeoutKind: "idle",
    usage: "response.usage",
    slots: {
      connection: {
        kind: "connection",
        quick: true,
        shape: S2.textGen,
        requires: [tf({ in: [IoKinds.text], out: [IoKinds.text] })]
      },
      sampling: { kind: "sampling", quick: true, shape: S2.textGen },
      prompts: {
        kind: "prompts",
        quick: true,
        facet: "prompts",
        fields: { [field]: { type: "text" } }
      }
    },
    ports: {
      in: { scenes: S2.graphScenes },
      out: { main: S2.json, result: S2.json }
    }
  })
);
var graphNodeResolution = graphStep(
  "core:oracle/graph-node-resolution@1",
  "Resolve nodes",
  "nodeResolution"
);
var graphPreFilter = graphStep(
  "core:oracle/graph-pre-filter@1",
  "Pre-filter",
  "preFilter"
);
var graphPerspective = graphStep(
  "core:oracle/graph-perspective@1",
  "Perspective",
  "perspective"
);
var graphNodeDescription = graphStep(
  "core:oracle/graph-node-description@1",
  "Describe new nodes",
  "nodeDescription"
);
var graphStateDetection = graphStep(
  "core:oracle/graph-state-detection@1",
  "Detect state changes",
  "stateDetection"
);
var graphProposal = pin2(
  describeOutletDefinition({
    id: "core:outlet/graph-proposal@1",
    i18n: { name: { en: "Propose graph changes" } },
    effects: "write",
    /** The proposal is what the review screen exists to edit (R-15 review fields). */
    review: { fields: ["proposal"] },
    timeoutMs: 1e4,
    causesEvent: "core:event/graph-proposal-created@1",
    ports: {
      in: { proposal: S2.json },
      out: { main: S2.writeResult, proposalId: S2.writeResult }
    }
  })
);
var sessionState = pin2(
  describeQueryDefinition({
    id: "core:query/session-state@1",
    i18n: { name: { en: "Session state" } },
    timeoutMs: 2e3,
    ports: {
      in: { scope: S2.sessionScope },
      out: { main: S2.json, state: S2.json, version: S2.json }
    }
  })
);
var resolveStateChanges = pin2(
  describeQueryDefinition({
    id: "core:query/resolve-state-changes@1",
    i18n: { name: { en: "Resolve state changes" } },
    timeoutMs: 5e3,
    ports: {
      in: {
        /**
         * `[{ owner, slot, value } | { owner, entryId, delta }]` as a
         * model writes them: `owner` is a name from the conversation or
         * `world`, `slot` is a stat's local name (`hp`) or its full id.
         */
        changes: S2.json,
        /** Which session's cast the names are resolved against. */
        scope: S2.sessionScope,
        /**
         * The planner's document, whose `worldHints` are a second,
         * smaller set of named changes: where this turn happens, the
         * time of day and the weather.
         *
         * Its own port rather than more entries on `changes`, because
         * a reference is `{node, port}` with no sub-path — a spec
         * cannot join one node's list to another node's object on one
         * port, and the two are written by different agents answering
         * different questions. A hint that repeats what the world
         * already says proposes nothing, which is what makes "repeat
         * the state when this turn changes none of it" safe to ask of
         * the planner.
         */
        plan: S2.json,
        /**
         * The **state version** this turn read (U5f): the session-state
         * query's `version`. Passed through onto every resolved change
         * as `base`, so `set-state` can tell a delta against the state
         * the model saw from one against a state that has since moved.
         * Optional: a spec that wires none proposes against whatever
         * is current at the write.
         */
        base: S2.json
      },
      out: {
        main: S2.json,
        /** Ready for `core:task/set-state@1`'s `changes` port — each carrying `base` when one was wired. */
        changes: S2.json,
        /** One sentence per change that named something not here. */
        refused: S2.json
      }
    }
  })
);
var setState = pin2(
  describeTaskDefinition2({
    id: "core:task/set-state@1",
    i18n: { name: { en: "Set state" } },
    timeoutMs: 5e3,
    slots: {
      params: {
        kind: "parameters",
        schema: {
          mode: {
            type: "enum",
            of: ["propose", "apply"],
            default: "propose",
            quick: true,
            description: "'propose' holds the changes for the player to accept or reject; 'apply' writes them immediately, stamped with this run. Use 'apply' only where the pipeline itself decided the number."
          }
        }
      }
    },
    ports: {
      // [{ owner: { kind, id }, slotId, value, base? } | { owner, entryId, delta, base? }]
      // `scope` is what says which session, and therefore which message a
      // change is anchored to — a change with no anchor is one a swipe
      // could not take back.
      in: {
        changes: S2.json,
        scope: S2.sessionScope,
        /**
         * The **state version** the changes are deltas against (plans/29
         * R-15 *Staleness and order*; U5f) — the session-state query's
         * `version`, for every change that does not carry its own
         * `base`. In `apply` mode a base behind the current version is
         * **rebased**: a change whose slot is untouched since the base
         * still holds and is applied; one whose slot moved is put on
         * `refused` with the versions named, and the next turn's
         * `resolve-state-changes` re-resolves it — a run never re-enters
         * an earlier node. In `propose` mode the base is stamped on the
         * proposal for the accept to judge the same way. Optional: with
         * none, the write is against whatever is current.
         */
        base: S2.json
      },
      /**
       * What happened, as three lists: `applied` for rows written,
       * `proposed` for rows held, `refused` for the sentences — a value
       * the slot does not accept, or a slot that moved since `base`.
       * The first two are always present and one of them is always
       * empty, so nothing downstream decides which mode ran by looking
       * for a missing key.
       */
      out: { main: S2.json, applied: S2.json, proposed: S2.json, refused: S2.json }
    }
  })
);
var lorebookEntries = pin2(
  describeQueryDefinition({
    id: "core:query/lorebook-entries@1",
    i18n: {
      name: { en: "Lorebook entries" },
      description: {
        en: "Lists the entries of the session\u2019s lorebook \u2014 all of them, or the one with a given name. Retrieval is not involved: nothing is matched against the conversation, nothing is scored and nothing is ranked."
      }
    },
    /**
     * The lore definitions' number. One indexed read of one book plus the
     * bindings it hydrates, which is the same work their shared scan pays
     * for before it scans anything.
     */
    timeoutMs: 2e3,
    slots: {
      params: {
        kind: "parameters",
        schema: {
          /**
           * Which entry types to list — `core:entry/world-lore`,
           * `core:entry/character-lore`, `core:entry/history`, or a
           * plugin's own. Bare ids, no `@version`: the version is a
           * separate column and a type's rows are its rows across
           * versions.
           *
           * A `list` of `text` rather than an `enum` of the three
           * core ids, because the set is open — an install with a
           * plugin entry type has more of them, and an enum frozen
           * into this definition's content hash could not grow
           * without a re-projection. An id no type declares matches
           * nothing, which is the honest answer to a typo.
           *
           * Empty or absent lists every entry type.
           *
           * Named `entryTypes` rather than `types` (R3): *type* alone
           * is the word four other vocabularies use — a node type, a
           * session type, a part type — and a parameter may not take
           * the bare noun.
           */
          entryTypes: {
            type: "list",
            item: { type: "text" },
            i18n: { en: "Entry types listed" },
            description: "Which kinds of entry to list, by type id \u2014 world lore, character lore, history, or a type an extension declares. Leave it empty for all of them."
          },
          /**
           * The *does it exist* case: one exact name, matched
           * case-insensitively with surrounding whitespace trimmed
           * on both sides.
           *
           * Exact and never a substring or a pattern. A genre asking
           * "is there a room called the Cellar?" needs *yes* or *no*,
           * and a match that also returned "Cellar Door" and "The
           * Wine Cellars" would answer a question nobody asked — the
           * search-shaped reading of this node is the keyword scan
           * above, which already exists and is better at it.
           *
           * History entries have no name at all (the type declares no
           * title role), so naming one lists nothing.
           *
           * Absent lists every entry of the chosen types.
           */
          name: {
            type: "text",
            quick: true,
            i18n: { en: "Only the entry named" },
            description: "List only the entry with exactly this name, ignoring capitalisation and surrounding spaces. Leave it empty to list them all."
          },
          /**
           * A ceiling on rows read, not a page: there is no offset
           * and no cursor, so raising it is the only way to see more.
           *
           * 500 is a large lorebook and 2000 is a ceiling on the
           * ceiling — this list is usually on its way into a prompt,
           * and a book that would not fit in a context window is not
           * made to fit by asking for all of it. The cap is enforced
           * at the read as well as declared here; a node's parameter
           * is a control, never a promise the host takes on trust.
           */
          limit: {
            type: "integer",
            default: 500,
            min: 1,
            max: 2e3,
            i18n: { en: "Most entries listed" },
            description: "A ceiling on how many entries are listed. There is no second page \u2014 raising this is the only way to see more."
          }
        }
      }
    },
    ports: {
      /**
       * Which session's lorebook, and — through `currentCharacterId` —
       * who is speaking, which is what the binding-visibility policy
       * reads. No `text` in-port: there is nothing here to match text
       * against.
       */
      in: { scope: S2.sessionScope },
      /**
       * One bare list of rows on both ports, `main` for a spec that
       * wires the node's output and `entries` for one that names what it
       * is reading. Same value, same order — world lore, then character
       * lore, then history, each by row id.
       *
       * ⚠ `S.json` and deliberately **not** `S.candidates`. A candidate
       * is something a mechanism proposed, carrying signals a ranker
       * reads; these rows were proposed by nothing and carry no signals,
       * and publishing them as candidates would let a spec wire a
       * whole lorebook into `select` as if a scan had found it.
       */
      out: { main: S2.json, entries: S2.json }
    }
  })
);
var pickByHash = pin2(
  describeTaskDefinition2({
    id: "core:task/pick-by-hash@1",
    i18n: {
      name: { en: "Pick by hash" },
      description: {
        en: "Picks one entry of a list for this session, the same one every time, without writing anything down. Adding an entry almost never moves the pick."
      }
    },
    /** Pure arithmetic over a list that is already in memory. */
    timeoutMs: 500,
    slots: {
      params: {
        kind: "parameters",
        schema: {
          /**
           * Which field on each entry identifies it.
           *
           * The identity is what the hash is taken over, so it
           * decides the answer: two runs that disagree about it
           * disagree about the pick. Absent, an entry that IS a
           * string is its own identity and anything else is
           * identified by `id` — the two shapes a core list
           * actually arrives in (`cast-choices` publishes `key`,
           * a lore listing publishes rows with `id`).
           *
           * ⚠ It must be **stable**: a name the author may edit
           * moves the pick the day they edit it. A row id does not.
           */
          by: {
            type: "string",
            quick: true,
            i18n: { en: "Identified by" },
            description: "Which field on each entry identifies it \u2014 a row id, or the option key. Leave it empty for plain strings, or for rows with an `id`."
          }
        }
      }
    },
    ports: {
      in: {
        /** The list to pick from. */
        items: S2.json,
        /**
         * The stable key this session picks under.
         *
         * Either the session's **scope** — `$.input.sessionScope`,
         * which the binding spells `session:<id>` — or a literal
         * string for a pick that is not per-session.
         *
         * ⚠ `S.json` rather than `S.text`, and not for want of a
         * type. `session-scope@1` is not assignable to `text@1`, and
         * there is no text-shaped port anywhere that carries a
         * session's identity — so a `text` port here could be wired
         * to a literal and to nothing else, which would give every
         * session of a genre the same answer. `json` is the
         * permissive sink, so the scope wires, a literal wires, and
         * anything a spec wires that the binding cannot read as a key
         * halts with a sentence naming what to wire instead.
         */
        scopeKey: S2.json
      },
      out: {
        /** The chosen entry, whole and exactly as it arrived. */
        main: S2.json,
        /**
         * Where it sat in the list **as handed in**, not among the
         * identifiable entries. `pickIndex` rather than `index`
         * (R3): a bare *index* is a database index, a message's
         * position and a list offset all at once.
         */
        pickIndex: S2.json,
        /**
         * The identity it won under — the string the hash was taken
         * over. This is the side a later junction compares an answer
         * against with `equalsPath`, which is why it is published at
         * all: the chosen item is a document, and a predicate
         * compares keys.
         */
        chosenKey: S2.text
      }
    }
  })
);
var castChoices = pin2(
  describeTaskDefinition2({
    id: "core:task/cast-choices@1",
    i18n: {
      name: { en: "The cast as choices" },
      description: {
        en: "Turns the session\u2019s cast into the option list a question is asked with \u2014 one option per live character, keyed by who they are."
      }
    },
    timeoutMs: 500,
    slots: {
      params: {
        kind: "parameters",
        schema: {
          /**
           * Which half of the room to leave out.
           *
           * A persona is a character the player voices (0132), so
           * both halves are cast members and which one a question
           * is about depends entirely on the question: *who do you
           * accuse* is asked about the suspects and must not offer
           * the detective, while *who do you play* is the other way
           * round.
           */
          exclude: {
            type: "enum",
            of: ["none", "personas", "characters"],
            default: "none",
            quick: true,
            i18n: { en: "Left out" },
            description: "Leave out the characters the players voice (personas), the rest of the cast (characters), or nobody."
          }
        }
      }
    },
    ports: {
      in: {
        cast: S2.sessionCast,
        /**
         * The question the options answer — the prose that sits
         * above them on the block, and the row's own content.
         *
         * Unwired it is the empty string, and `make-choices@1`
         * publishes no block for a document with no question — the
         * same silence it answers an empty option list with, rather
         * than a block asking nothing.
         */
        question: S2.text
      },
      out: {
        /** `{ key, label }[]`, in seating order: characters, then personas. */
        main: S2.json,
        options: S2.json,
        /**
         * `{ question, options }` — the document
         * `core:task/make-choices@1` reads off its own `json` port,
         * in exactly that shape, so the two wire straight to each
         * other and no oracle stands between a cast read and the
         * question it is asked with.
         */
        json: S2.json
      }
    }
  })
);

// sdk-tests/fixtures/unified-plugin/src/index.ts
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
var extension = defineExtension({
  slug: PLUGIN_SLUG,
  name: "Tally",
  version: "1.0.0",
  description: "Counts words and says so.",
  engines: { "serene-pub": ">=0.7 <0.8" },
  hooks: [handler(tallyDefinition, tallyHandler)],
  pipelines: [createSession, respond],
  genres: [tallyGenre],
  surfaces: {
    panels: [{ id: TALLY_PANEL_ID, entry: "ui/tally.html", title: "Tally", channels: ["main"] }]
  },
  configs: [
    {
      spec: RESPOND_SPEC_ID,
      slug: "tally-default",
      label: "Tally",
      description: "As shipped.",
      values: { tally: { params: { trim: true } } }
    },
    // A config over somebody else's spec: legitimate, and the one thing in
    // this package that has to land in `requires`.
    {
      spec: "core:spec/respond",
      slug: "tally-flavoured",
      label: "Tally flavoured",
      values: {}
    }
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
      genre: tallyGenre.id,
      label: "Tally",
      description: "Counts what you say.",
      bindings: {
        [sessionEvents.sessionCreated]: { spec: CREATE_SPEC_ID },
        [sessionEvents.messageRespond]: { spec: RESPOND_SPEC_ID, config: "tally-default" }
      }
    }
  ],
  permissions: { storage: { quotaBytes: 4 * 1024 * 1024 } }
});
var src_default = extension;

// <stdin>
var __ext = src_exports && (src_default || extension) || src_exports;
var __hooks = __ext && __ext.hooks || [];
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
