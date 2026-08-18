/**
 * A minimal template engine, enough to demonstrate variable awareness (16 §4).
 *
 * Supports `{{ a.b.c }}` and `{% for x in items %}…{% endfor %}`. Not Jinja — just
 * enough surface to answer the question the docs make a promise about: *can the editor
 * tell an author which variables exist, and flag one that doesn't?*
 *
 * ⚠ Writing this surfaced a correction to 16 §4 — see `templateScope`.
 */
const EXPR = /\{\{\s*([^}]+?)\s*\}\}/g;
const FOR = /\{%\s*for\s+(\w+)\s+in\s+([\w.]+)\s*%\}/g;
const IF = /\{%\s*if\s+([^%]+?)\s*%\}/g;
/**
 * Extract top-level variable references. Loop-bound names are marked so they are not
 * reported as unknown, and anything computed is marked dynamic rather than verified —
 * an editor that promises correctness and lets a typo through is worse than one that
 * says what it checks (16 §4).
 */
export function extractRefs(src) {
    const bound = new Set();
    const loopSources = [];
    for (const m of src.matchAll(FOR)) {
        bound.add(m[1]);
        const parts = m[2].split('.');
        loopSources.push({ root: parts[0], path: parts.slice(1), bound: false, dynamic: false });
    }
    const refs = [...loopSources];
    for (const m of src.matchAll(EXPR)) {
        const expr = m[1].trim();
        const dynamic = /[\[\(]/.test(expr);
        const parts = expr.split('.');
        refs.push({
            root: parts[0].replace(/[\[\(].*$/, ''),
            path: parts.slice(1),
            bound: bound.has(parts[0].replace(/[\[\(].*$/, '')),
            dynamic,
        });
    }
    return refs;
}
/** Render. Missing values become empty strings — templates never throw at run time. */
export function render(src, baseScope) {
    let out = src;
    let prev;
    const scope = { ...baseScope };
    // {% set name = expr %} — bind a value for the rest of this scope. This is what makes
    // depth positioning a template concern: capture the outer loop's index before entering
    // an inner loop, where `loop` would otherwise be shadowed.
    //
    // Loop bodies are masked first, so a set belonging to an inner scope is left for that
    // scope's own render pass rather than being stripped by this one.
    {
        const { masked, blocks } = maskLoops(out);
        out = masked;
        out = out.replace(/\{%\s*set\s+(\w+)\s*=\s*([^%]+?)\s*%\}/g, (_m, name, expr) => {
            const raw = expr.trim();
            scope[name] = /^-?\d+$/.test(raw)
                ? Number(raw)
                : /^['"].*['"]$/.test(raw)
                    ? raw.slice(1, -1)
                    : get(scope, raw.split('.'));
            return '';
        });
        out = out.replace(/\u0000(\d+)\u0000/g, (_m, i) => blocks[Number(i)]);
    }
    // loops — outermost first, so inner loops render inside their parent's scope.
    // (An innermost-first pass evaluates the inner loop before `set`/item bindings exist,
    // which is a real bug this replaced.)
    out = renderLoops(out, scope);
    // conditionals
    do {
        prev = out;
        out = out.replace(/\{%\s*if\s+([^%]+?)\s*%\}((?:(?!\{%\s*if\s)[\s\S])*?)\{%\s*endif\s*%\}/g, (_m, cond, body) => (evaluate(cond, scope) ? body : ''));
    } while (out !== prev);
    return out.replace(EXPR, (_m, expr) => {
        const v = get(scope, expr.trim().split('.'));
        return v === undefined || v === null ? '' : String(v);
    });
}
/** `a.b == c`, `a.b != c`, or a truthy path. Enough for positioning, not a language. */
function evaluate(cond, scope) {
    const cmp = /^(.+?)\s*(==|!=)\s*(.+)$/.exec(cond.trim());
    if (!cmp)
        return Boolean(get(scope, cond.trim().split('.')));
    const left = get(scope, cmp[1].trim().split('.'));
    const rightRaw = cmp[3].trim();
    const right = /^-?\d+$/.test(rightRaw)
        ? Number(rightRaw)
        : /^['"].*['"]$/.test(rightRaw)
            ? rightRaw.slice(1, -1)
            : get(scope, rightRaw.split('.'));
    return cmp[2] === '==' ? left === right : left !== right;
}
function get(scope, path) {
    let cur = scope;
    for (const k of path) {
        if (cur === undefined || cur === null)
            return undefined;
        cur = cur[k];
    }
    return cur;
}
export function templateScope(decl) {
    return decl?.variables ?? {};
}
export function checkTemplate(src, scope) {
    const known = Object.keys(scope);
    const out = [];
    for (const ref of extractRefs(src)) {
        if (ref.bound)
            continue;
        if (ref.dynamic) {
            out.push({
                severity: 'warning',
                message: `'${ref.root}' is accessed dynamically and cannot be checked`,
                fix: 'this is allowed — verification covers top-level references only, so confirm this one yourself',
            });
            continue;
        }
        if (!known.includes(ref.root)) {
            out.push({
                severity: 'error',
                message: `'${ref.root}' is not available to this template`,
                fix: known.length
                    ? `available here: ${known.join(', ')}`
                    : 'this template slot declares no variables — check the node type',
            });
            continue;
        }
        const allowed = scope[ref.root];
        if (Array.isArray(allowed) && ref.path.length && !allowed.includes(ref.path[0])) {
            out.push({
                severity: 'error',
                message: `'${ref.root}.${ref.path[0]}' does not exist`,
                fix: `'${ref.root}' has: ${allowed.join(', ')}`,
            });
        }
    }
    return out;
}
/**
 * Mask top-level `{% for %}…{% endfor %}` blocks with placeholders, matching them balanced
 * rather than by regex — nested loops make non-greedy matching wrong, which is exactly the
 * bug this replaced.
 */
function maskLoops(src) {
    const blocks = [];
    let out = '';
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
        while ((m = TAG.exec(src))) {
            if (m[1] === 'for')
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
        out += `\u0000${blocks.push(src.slice(open.index, end)) - 1}\u0000`;
        i = end;
    }
    return { masked: out, blocks };
}
/** Render top-level `{% for %}` blocks; nested ones are handled by the recursive call. */
function renderLoops(src, scope) {
    const { masked, blocks } = maskLoops(src);
    if (!blocks.length)
        return src;
    return masked.replace(/\u0000(\d+)\u0000/g, (_m, idx) => {
        const block = blocks[Number(idx)];
        const head = /^\{%\s*for\s+(\w+)\s+in\s+([\w.]+)\s*%\}/.exec(block);
        if (!head)
            return block;
        const body = block.slice(head[0].length, block.lastIndexOf('{%'));
        const items = get(scope, head[2].split('.'));
        if (!Array.isArray(items))
            return '';
        return items
            .map((item, i) => render(body, {
            ...scope,
            [head[1]]: item,
            loop: { index: i + 1, index0: i, revindex: items.length - i, length: items.length },
        }))
            .join('');
    });
}
//# sourceMappingURL=template.js.map