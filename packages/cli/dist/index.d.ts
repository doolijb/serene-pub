/**
 * `@serene-pub/cli` — build-time tooling, kept out of the runtime package on purpose.
 *
 * Nothing here is importable by a running plugin, and that is the point: the packager
 * reads a plugin's source and decides what it is *allowed* to do. If a plugin could
 * import the thing that computes its own permissions, the manifest would stop being an
 * independent statement about the code (10 §10.2).
 */
export * from './compiler.js';
export * from './codegen.js';
//# sourceMappingURL=index.d.ts.map