/**
 * The pipeline type registry — the ruling on 13 §10c.
 *
 * ## Where a type's shape comes from, at three different moments
 *
 * The question underneath "schema sources" is which artefact is authoritative, and the
 * honest answer is that a different one is authoritative at each moment. Writing that
 * down is the ruling; pretending there is a single source is what would go wrong.
 *
 * | moment | source of truth | why |
 * |---|---|---|
 * | authoring | the `Descriptor` in code | the author is *defining* the type; nothing else knows it yet |
 * | compiling a spec | generated `/contracts` | frozen per release, so a pin resolves the same way forever (04 §2) |
 * | installing | **the registry row** | the only one core can read without executing the plugin |
 *
 * The third row is the whole point. Core must decide whether a plugin is installable
 * before it ever runs the plugin's code — F6 means core imports documents, never
 * authoring JS — so install-time validation reads two things that are both plain data:
 * the plugin's **manifest** (types summarized, permissions compiled from usage) and its
 * **documents** (nodes pinned by `typeId@version`, edges carrying the shapes they were
 * compiled against).
 *
 * ## What that makes checkable
 *
 * The interesting failure is not a plugin that pins a type nobody has — that one is
 * obvious and fails loudly. It is a plugin **built against a different release**, where
 * every id still resolves but a port now produces a different shape. The document
 * records the shape each edge was compiled against, so comparing it to the registry
 * catches exactly that, and catches it at install rather than mid-run.
 */
const versionOf = (id) => Number(/@(\d+)$/.exec(id)?.[1] ?? 1);
const bare = (id) => id.replace(/@\d+$/, '');
const shapeId = (s) => typeof s === 'string' ? s : (s?.id ?? undefined);
/** Project descriptors into registry rows — how core seeds and refreshes the table. */
export function snapshotRegistry(types, meta = {}) {
    return types.map((d) => ({
        id: bare(d.id),
        version: versionOf(d.id),
        kind: d.kind,
        ports: {
            in: Object.fromEntries(Object.entries(d.ports?.in ?? {}).map(([k, v]) => [k, shapeId(v)])),
            out: Object.fromEntries(Object.entries(d.ports?.out ?? {}).map(([k, v]) => [k, shapeId(v)])),
        },
        slots: { ...(d.slots ?? {}) },
        effects: d.effects,
        causesEvent: d.causesEvent,
        public: d.public,
        owner: meta.owner,
        release: meta.release,
    }));
}
/**
 * Decide whether a plugin is installable, from data alone.
 *
 * Never loads the plugin. Every finding names what to do, because the reader is an admin
 * who did not write the plugin and cannot be expected to infer the fix from the symptom.
 */
export function checkInstall(input) {
    const findings = [];
    const byId = new Map(input.registry.map((r) => [`${r.id}@${r.version}`, r]));
    const latest = new Map();
    for (const r of input.registry)
        latest.set(r.id, Math.max(latest.get(r.id) ?? 0, r.version));
    // 1. A plugin may not redeclare a type it does not own.
    for (const d of input.declares) {
        const existing = byId.get(d.id.includes('@') ? d.id : `${d.id}@1`);
        if (existing && existing.owner !== input.owner)
            findings.push({
                severity: 'error',
                code: 'E_REDECLARES_CORE',
                where: d.id,
                message: `${d.id} is already registered${existing.owner ? ` by '${existing.owner}'` : ' by core'}`,
                fix: `publish it under your own namespace instead. Ownership is what lets an update ` +
                    `replace the right rows — two owners for one id means an update cannot tell which ` +
                    `rows are its own (12 §3b).`,
            });
    }
    const declared = new Set(input.declares.map((d) => (d.id.includes('@') ? d.id : `${d.id}@1`)));
    for (const doc of input.documents) {
        for (const n of doc.nodes) {
            const pin = `${n.typeId}@${n.typeVersion}`;
            const entry = byId.get(pin);
            // 2. A pin that resolves to nothing.
            if (!entry && !declared.has(pin)) {
                const known = latest.get(n.typeId);
                findings.push({
                    severity: 'error',
                    code: 'E_UNKNOWN_TYPE',
                    where: `${doc.id} · ${n.key}`,
                    message: `pins ${pin}, which this instance does not have`,
                    fix: known
                        ? `this instance has ${n.typeId}@${known}. Pins are frozen on purpose, so the plugin has to be rebuilt against this release rather than silently re-pinned here.`
                        : `no version of ${n.typeId} is registered. It comes from another plugin — install that one first, or the pipeline has a dependency its manifest does not declare.`,
                });
                continue;
            }
            // 3. A private type belonging to someone else.
            if (entry && entry.owner && entry.owner !== input.owner && entry.public === false)
                findings.push({
                    severity: 'error',
                    code: 'E_PRIVATE_TYPE',
                    where: `${doc.id} · ${n.key}`,
                    message: `pins ${pin}, which is private to '${entry.owner}'`,
                    fix: `ask '${entry.owner}' to mark it public. A private type is one its owner may change without warning, so pinning it across a plugin boundary would break on their next release (01 §9).`,
                });
            // 4. Informational: a newer version exists. The pin still runs — that is what
            //    pinning is for — but an author reading the install log should know.
            const newest = latest.get(n.typeId);
            if (entry && newest && newest > n.typeVersion)
                findings.push({
                    severity: 'warning',
                    code: 'W_NEWER_VERSION',
                    where: `${doc.id} · ${n.key}`,
                    message: `pins ${pin}; this instance also has @${newest}`,
                    fix: `nothing is required — the pin resolves and runs. Upgrade deliberately if you want the newer behaviour.`,
                });
        }
        // 5. The one that matters: built against a different release. Every id resolves,
        //    but a port produces a different shape than the document was compiled against.
        for (const e of doc.edges) {
            if (!e.shape)
                continue;
            const from = doc.nodes.find((n) => n.key === e.from);
            if (!from)
                continue;
            const entry = byId.get(`${from.typeId}@${from.typeVersion}`);
            const now = entry?.ports.out[e.fromPort];
            if (entry && now && now !== e.shape)
                findings.push({
                    severity: 'error',
                    code: 'E_SHAPE_DRIFT',
                    where: `${doc.id} · ${e.from}.${e.fromPort} → ${e.to}.${e.toPort}`,
                    message: `compiled against ${e.shape}; this instance publishes ${now}`,
                    fix: `rebuild the plugin against this release. This is the failure a version number ` +
                        `alone would not have caught: the id resolved, so nothing looked wrong until the ` +
                        `value reached a node that could not read it.`,
                });
        }
    }
    // 5a. A hook that wants to run inside Serene Pub's process.
    //
    // Refused from the manifest, before anything is loaded — which is the only
    // moment it *can* be refused, since by the time the code is running it is
    // already in the host's process. An in-process hook cannot be stopped: a
    // runaway loop or a blocking call takes the whole application down with it,
    // and F36's promise that every invocation is bounded stops being enforceable
    // (13 §7h).
    for (const d of input.declares)
        if (d.runtime && d.runtime !== 'process')
            findings.push({
                severity: 'error',
                code: 'E_IN_PROCESS_HOOK',
                where: d.id,
                message: `declares runtime '${d.runtime}'; extension hooks run in their own process`,
                fix: `rebuild with the current SDK, which no longer offers an in-process runtime. ` +
                    `A hook inside the host's process cannot be timed out or killed, so one bad ` +
                    `loop stops Serene Pub rather than one node.`,
            });
    // 6. A declared type nobody bound is a node the executor cannot invoke.
    if (input.bound) {
        const bound = new Set(input.bound);
        for (const d of input.declares)
            if (!bound.has(d.id))
                findings.push({
                    severity: 'error',
                    code: 'E_MISSING_BINDING',
                    where: d.id,
                    message: `declared as a type but no hook implements it`,
                    fix: `add a pipelineHook for ${d.id}, or drop the declaration. A type with no binding is a node a user can add to a pipeline that then fails at run time.`,
                });
    }
    return findings;
}
export const installable = (f) => !f.some((x) => x.severity === 'error');
export function renderInstall(findings) {
    if (!findings.length)
        return 'installable';
    return findings
        .map((f) => `${f.severity === 'error' ? '✗' : '⚠'} ${f.where ?? ''}  [${f.code}] ${f.message}\n    → ${f.fix}`)
        .join('\n');
}
//# sourceMappingURL=registry.js.map