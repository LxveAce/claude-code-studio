# LMM — tsconfig.json

## RAW

Nineteen lines, single tsconfig, no `references`, no `paths`, no `baseUrl`, no project split between main/preload/renderer. `target: ESNext`, `module: ESNext`, `moduleResolution: bundler` — this configuration outsources every interesting decision to Vite, which is the bundler doing the actual work. `jsx: react-jsx` (the new transform, no React import needed), `strict: true` (good), `esModuleInterop: true`, `skipLibCheck: true` (pragmatic — avoids @types/* version skirmishes), `resolveJsonModule: true`, `forceConsistentCasingInFileNames: true` (defensive on Windows where the FS is case-insensitive but Git is case-sensitive). The `outDir` is `.vite/build`, same as where Forge's Vite plugin writes the main and preload bundles — but TypeScript itself is never invoked to emit anything in this project (there's no `tsc` script). `declaration: true` + `declarationMap: true` + `sourceMap: true` would generate `.d.ts` files if `tsc` were ever run, but those flags are inert here. `include: src/**/*` catches everything including renderer (browser-targeted) and main (Node-targeted) under one config — meaning the same `lib` (defaulted to ESNext + DOM because target is ESNext and no `lib` is specified) applies to both. Open questions: (1) Does the renderer accidentally have access to Node types it shouldn't (via `@types/node` being installed devDep-wide)? (2) Why ship `declaration` flags when nothing emits? (3) What enforces the no-emit assumption — could a stray `tsc` invocation in CI suddenly try to write into `.vite/build` and clobber Vite output?

## NODES

1. **Single tsconfig for three different runtimes** (main = Node, preload = Node+sandbox, renderer = browser).
2. **No `lib` field** → TypeScript defaults to `ESNext` + `DOM` + `DOM.Iterable` because target is ESNext. Main process gets DOM types it should never use.
3. **No `types` field** → all installed `@types/*` are ambient globally. `@types/node` leaks into renderer.
4. **`moduleResolution: bundler`** — modern, correct for Vite, but disallows `tsc` emit in some scenarios.
5. **`outDir: .vite/build`** — collides with Vite's output directory; only safe because nothing invokes `tsc --emit`.
6. **`strict: true`** — non-negotiable; good.
7. **`skipLibCheck: true`** — papers over @types/react 19 + @types/node 25 compatibility issues.
8. **No `noEmit`** — the configuration looks emit-capable but emit would corrupt Vite's output.
9. **No `paths` aliases** despite a `src/shared` directory used by all three runtimes — imports are relative (`../../shared/types`).
10. **No `incremental` / `composite`** — no build caching, full check every run (when there is a run).

**Tension A**: One config tries to be authoritative for three runtimes with different `lib` and `types` requirements.
**Tension B**: `outDir` is set but emit would be destructive — silent footgun for any contributor who runs `tsc` to "verify."

## REFLECT

Core insight: **this tsconfig is a type-checker hint file, not a build configuration** — its only job is to make IDEs (VS Code) understand the project, and every emit-related setting is decorative.

Tension A resolved: the author accepted the cost of leaky types (DOM in main, Node in renderer) in exchange for a single config. The renderer is unlikely to call `process.platform`; the main is unlikely to touch `document`. In practice, runtime errors would catch any mistake. But the type system is no help here.

Tension B resolved: it's a real footgun. The first time someone runs `npx tsc` (as I'd recommend in the package.json journal) to typecheck, they'll get `.d.ts` files dumped into `.vite/build` and then a fresh Forge `start` will overwrite some but not all of them. Solution is `noEmit: true` plus a wrapper script.

Hidden assumptions: (1) No one will ever run `tsc` directly; (2) IDE squiggles are an adequate substitute for a `typecheck` CI step; (3) the three runtimes never share types in ways that require runtime-specific lib pruning (mostly true — `src/shared` is types/constants only).

## SYNTHESIZE

What this should become:
- A root `tsconfig.json` with `noEmit: true`, no `outDir`, no `declaration*`.
- Three referenced configs (`tsconfig.main.json`, `tsconfig.preload.json`, `tsconfig.renderer.json`) using `references` and `composite: true`, each with the right `lib`/`types` for its runtime.
- Add a `paths` alias for `@shared/*` → `src/shared/*` once Vite is taught the same.

Actionable items:
1. Add `"noEmit": true` and remove `outDir`/`declaration*` (lowest-effort fix; prevents the footgun immediately).
2. Add `"lib": ["ESNext"]` at root and a renderer override that adds `"DOM"`.
3. Add `"types": []` at root and runtime-specific `"types": ["node"]` / `"types": ["vite/client"]` overrides.
4. Wire `npm run typecheck` to use this config.

Risks if untouched: type errors leak past development (no CI check). The bigger latent risk is the `outDir` footgun. Lowest priority is the single-config-for-three-runtimes problem because errors would surface at runtime quickly anyway.
