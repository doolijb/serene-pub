/**
 * World Info parity — testing the claim in 13 §7i.
 *
 * The competitive assessment asserts that every SillyTavern World Info feature "maps into
 * the existing model as params or template logic, not as new mechanisms." That was an
 * untested claim about the most competitively important feature in the product, so this
 * module implements them and the tests check whether it held.
 *
 * Verdict, recorded honestly at the bottom of this file.
 */
const matches = (text, key, useRegex, caseSensitive) => {
    if (useRegex) {
        try {
            return new RegExp(key, caseSensitive ? '' : 'i').test(text);
        }
        catch {
            return false;
        }
    }
    const hay = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? key : key.toLowerCase();
    return hay.includes(needle);
};
const primaryHit = (e, text, p) => e.keys.some((k) => matches(text, k, e.useRegex ?? p.useRegex, p.caseSensitive));
const secondaryOk = (e, text, p) => {
    if (!e.secondary)
        return true;
    const hits = e.secondary.keys.map((k) => matches(text, k, e.useRegex ?? p.useRegex, p.caseSensitive));
    switch (e.secondary.op) {
        case 'AND_ANY':
            return hits.some(Boolean);
        case 'AND_ALL':
            return hits.every(Boolean);
        case 'NOT_ANY':
            return !hits.some(Boolean);
        case 'NOT_ALL':
            return !hits.every(Boolean);
    }
};
/**
 * Activation, including bounded recursion.
 *
 * Recursion lives *inside* the Query hook's opaque interior (01 §12.3) and is bounded by a
 * declared param — so it needs no pipeline-level construct and cannot become an unbounded
 * loop. This is the part of the parity claim that held cleanly.
 */
export function activate(entries, scanText, p) {
    const scanned = scanText.slice(0, Math.max(0, p.scanDepth)).join('\n');
    const found = new Map();
    const pass = (text, depth) => {
        for (const e of entries) {
            if (found.has(e.id))
                continue;
            if (e.constant) {
                found.set(e.id, { entry: e, depth });
                continue;
            }
            if (primaryHit(e, text, p) && secondaryOk(e, text, p))
                found.set(e.id, { entry: e, depth });
        }
    };
    pass(scanned, 0);
    for (let d = 1; d <= p.recursionDepth; d++) {
        const feed = [...found.values()]
            .filter((f) => f.depth === d - 1 && f.entry.recursable !== false && !f.entry.preventRecursion)
            .map((f) => f.entry.content)
            .join('\n');
        if (!feed)
            break;
        const before = found.size;
        pass(feed, d);
        if (found.size === before)
            break;
    }
    return [...found.values()];
}
/** Probability, rolled against the run seed — so it replays, which ST's cannot. */
export function rollProbability(hits, random) {
    const kept = [];
    const rolledOut = [];
    for (const { entry } of hits) {
        const p = entry.probability ?? 1;
        if (p >= 1 || random() < p)
            kept.push(entry);
        else
            rolledOut.push(entry.id);
    }
    return { kept, rolledOut };
}
/**
 * Inclusion groups: competing entries share a label, and one wins by group weight, with
 * insertion order as the deterministic tiebreak.
 *
 * This is ranking, so it belongs in the rank Task (16 §5c) — no new mechanism.
 */
export function resolveGroups(entries, random) {
    const groups = new Map();
    const kept = [];
    for (const e of entries) {
        if (!e.group) {
            kept.push(e);
            continue;
        }
        const g = groups.get(e.group) ?? [];
        g.push(e);
        groups.set(e.group, g);
    }
    const lost = [];
    for (const [, members] of groups) {
        const total = members.reduce((n, m) => n + (m.groupWeight ?? 1), 0);
        let pick = random() * total;
        let winner = members[0];
        for (const m of members) {
            pick -= m.groupWeight ?? 1;
            if (pick <= 0) {
                winner = m;
                break;
            }
        }
        kept.push(winner);
        lost.push(...members.filter((m) => m.id !== winner.id).map((m) => m.id));
    }
    return { kept, lost };
}
/**
 * Depth positioning **in a Task** — one of two valid places to do it.
 *
 * ⚠ RETRACTION. An earlier version of this file claimed depth positioning "didn't map" and
 * needed a shape change. That was wrong. **Depth is a context-template concern**, and the
 * assembly template expresses it directly:
 *
 * ```jinja
 * {% for m in messages %}{% set d = loop.revindex %}
 *   {% for l in lore %}{% if l.depth == d %}{{ l.rendered }}{% endif %}{% endfor %}
 *   {{ m.rendered }}
 * {% endfor %}
 * ```
 *
 * That is tested end to end in use case 41. Nothing about `context-candidates` changes —
 * it already carried `items[]`, which is all the loop needs. The only real requirement is
 * the obvious one: a Query that flattens its messages into a single opaque string forecloses
 * it, so history reaches the template as a list. That is guidance, not a schema change.
 *
 * This function remains as the Task-side alternative, for authors who would rather compute
 * placement than express it in a template.
 */
export function assembleWithPositions(history, lore, budget, costOf) {
    const byPriority = (a, b) => {
        const rank = { always: 0, high: 1, normal: 2, low: 3 };
        return rank[a.priority] - rank[b.priority] || a.order - b.order;
    };
    const included = [];
    const dropped = [];
    let spent = 0;
    const admit = (i) => {
        const cost = costOf(i.rendered);
        if (i.priority !== 'always' && spent + cost > budget) {
            dropped.push(i.id);
            return false;
        }
        spent += cost;
        included.push(i.id);
        return true;
    };
    const admittedLore = lore.slice().sort(byPriority).filter(admit);
    const admittedHistory = history.filter(admit);
    // Interleave: this is only possible because history is still a list of items.
    const out = [];
    const before = admittedLore.filter((l) => l.position === 'before_char').sort((a, b) => a.order - b.order);
    const after = admittedLore.filter((l) => l.position === 'after_char').sort((a, b) => a.order - b.order);
    const atDepth = admittedLore.filter((l) => typeof l.position === 'object');
    out.push(...before.map((l) => l.rendered));
    out.push(...after.map((l) => l.rendered));
    const hist = admittedHistory.map((h) => h.rendered);
    for (const l of atDepth.sort((a, b) => b.position.atDepth - a.position.atDepth)) {
        const depth = l.position.atDepth;
        const idx = Math.max(0, hist.length - depth);
        hist.splice(idx, 0, l.rendered);
    }
    out.push(...hist);
    return { text: out.join('\n'), included, dropped };
}
/**
 * ── Verdict on 13 §7i's claim ──────────────────────────────────────────────
 *
 * **Seven of seven mapped with no new mechanism.**
 *
 *   · regex keys, logic operators, scan depth  → params on the trigger Query
 *   · recursion                                → bounded scan inside the Query's interior
 *   · constants                                → priority 'always', honoured before budget
 *   · probability                              → the run seed, and replayable unlike ST's
 *   · inclusion groups + group weight          → the rank Task, which already existed
 *   · insertion order                          → sort key, or template ordering
 *   · positional insertion at chat depth       → the assembly template, via a loop over
 *                                                messages with the depth captured by `set`
 *
 * The claim held. An earlier draft of this file reported a shape change was needed; that was
 * my error, corrected after Jody pointed out depth is a templating concern.
 *
 * ── The real parity gap is elsewhere ───────────────────────────────────────
 *
 * **SP's lorebook entries have no `depth` field today.** The pipeline can position by depth
 * the moment an entry carries one — so the work is an entry-schema addition in the lorebook
 * model, not anything in the pipeline architecture. Worth stating precisely, because
 * "positional insertion is missing" and "the architecture can't express it" are very
 * different problems and only the first one is true.
 */
//# sourceMappingURL=worldinfo.js.map