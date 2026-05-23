# LMM — vite.main.config.ts

## RAW

Twelve lines including imports. Three externals (`node-pty`, `electron-store`, `systeminformation`) and a single resolve condition (`node`). That's it. Yet this file does more semantic work than the other two Vite configs combined, because every external listed here is a non-trivial dependency decision. `node-pty` is external because it's native — bundling would try to inline `.node` binaries (impossible) or break the require paths. `electron-store@^11` is external because it's ESM-only and the main bundle (CJS-flavored per `main: ".vite/build/index.js"` convention) can't statically import an ESM module — externalizing means the require happens at runtime against the installed node_modules, where Electron's loader handles ESM correctly. `systeminformation` is external because it uses dynamic platform-specific binaries (it shells out to OS commands and loads native helpers). The `conditions: ['node']` setting tells Vite's resolver to prefer the `node` export condition in package.json `exports` maps — without this, ESM-aware packages might resolve to their browser builds. Open questions: (1) Why isn't `electron-squirrel-startup` externalized — it's a startup-time `require` that should also stay external? (2) Why no `target: 'node22'` (matching Electron 42's bundled Node) to prevent transpilation of features Node already supports? (3) Is there an implicit assumption that Forge's VitePlugin adds Electron-aware defaults that make most of this redundant?

## NODES

1. **`external: ['node-pty', 'electron-store', 'systeminformation']`** — three categories: native, ESM-only, dynamic-loader.
2. **No `target` set** — Vite defaults to `modules` for builds, which may not match Electron's Node version.
3. **`conditions: ['node']`** — resolver hint; matters when packages have both `node` and `browser` exports.
4. **No `output.format` specified** — Forge's VitePlugin overrides this; the actual output is CJS by default for main.
5. **No `minify` setting** — default minification applies to production builds.
6. **No `sourcemap` setting** — Vite defaults to `false` for build; debugging packaged main process is harder.
7. **`electron-squirrel-startup` NOT externalized** — small and CJS-safe, but inconsistent treatment.
8. **No explicit `lib` entry / `formats`** — Forge's plugin injects the right entry from forge.config.ts.
9. **No envprefix or `define`** — env access goes through standard `process.env`.
10. **Implicit reliance on Forge's plugin defaults** — this file is a delta, not a full config.

**Tension A**: Three externals chosen carefully (each for a different reason), but the criteria isn't written down anywhere; future contributors won't know whether their new dep needs to be added.
**Tension B**: `electron-store` externalization is a workaround for the ESM-CJS landmine, but if Forge's Vite plugin outputs ESM (which it does in some configs), the externalization is no longer load-bearing — only fragility-bearing.

## REFLECT

Core insight: **this config encodes three hard-won bug fixes as a list, without comments explaining why each entry is there** — losing the institutional knowledge would mean rediscovering the same errors.

Tension A resolved: the criteria is "anything that breaks when bundled" — native modules, ESM-only packages, runtime-loaders. A comment block could codify this rule.

Tension B resolved: electron-store v11 being external is genuinely required only if main bundles as CJS. The user can verify by checking `.vite/build/index.js` for `require("electron-store")` vs `import`. If the bundle is ESM, externalizing is still safe (avoids inlining), so the cost of being wrong is zero. The danger is the opposite: removing the external (because "we're ESM now") could resurrect the original bug.

Hidden assumptions: (1) Forge's VitePlugin injects sensible Electron defaults for everything not declared here; (2) the postinstall patches keep `node-pty` rebuildable; (3) `systeminformation`'s internal command-shelling works the same when external as when bundled (true — externalizing means it's loaded from node_modules at runtime exactly as if no bundler existed).

## SYNTHESIZE

What this should become:
- Add a comment block above each external explaining why (native / ESM / dynamic).
- Add `build.target: 'node22'` (or whatever Electron 42's Node version is — likely Node 20 or 22) to skip unnecessary transpilation.
- Add `build.sourcemap: 'inline'` for debuggable packaged builds (drop for size-sensitive ship builds).
- Consider externalizing `electron-squirrel-startup` for consistency.

Actionable items:
1. Add inline comments documenting each externalization rationale (10 minutes; saves future hours).
2. Set the Node `target` matching Electron 42's bundled Node version.
3. Audit `src/main/*.ts` for any other requires of ESM-only / native packages added in Phase 4+ (e.g., `@octokit/rest` is ESM-only in recent majors — it may also need externalizing or dynamic import).

Risks if untouched: when `@octokit/rest@21` (ESM-only) is added to main code without being externalized, the build will appear to succeed but main will crash at runtime trying to `require()` an ESM module. This is exactly the trap electron-store already taught — and the lesson isn't documented.
