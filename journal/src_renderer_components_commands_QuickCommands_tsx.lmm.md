# LMM: src/renderer/components/commands/QuickCommands.tsx

## RAW

This 133-line file is the "Quick Actions" sub-panel rendered inside CommandsPanel's first tab. It defines its own catalog `QUICK_COMMANDS: CommandDef[]` (lines 10-33) of 22 entries, each tagged with `category: 'Model' | 'Effort' | 'Session' | 'Workflow' | 'Info' | 'Config'`. A separate `CATEGORIES` array (line 35) lists the categories as pills shown at the top (lines 50-75). The component owns two pieces of state: `activeCategory` (line 42, default `'Model'`) and `hoveredCmd: string | null` (line 43). The filtered command list (line 45) re-derives on every render — fine at 22 items.

Each command renders as a tall card with label, description, and the raw command in monospace right-aligned (lines 82-128). On hover, the card lifts via `transform: 'translateX(2px)'` (line 98) and brightens its background to `var(--accent-gradient-soft)` (line 95). Clicking sends the full command including arguments — e.g. `'/model opus'` not just `'/model'` — which is the key UX win over CommandsPanel's accordion (CommandsPanel.tsx line 190 strips arguments).

Open questions:
- Why does QuickCommands have a separate catalog from CommandsPanel.tsx's `SLASH_COMMANDS`? The data overlaps heavily (`/model opus` here, `/model [model]` there).
- Categories here (Model, Effort, Session, Workflow, Info, Config) differ from CommandsPanel (Model & Effort, Session, Workflow, Config, Info & Utils). Slight but real divergence.
- Category default is hardcoded `'Model'` (line 42) — should it remember the user's last selection?
- No empty-state for a category with zero matches (impossible with current data, but trivial to break).
- Pills wrap (`flexWrap: 'wrap'` line 53) but there's no visual indication of which pill is "first" when wrapping — focus order may surprise.

## NODES

1. **Duplicate catalog vs CommandsPanel** (lines 10-33) — same domain, two arrays, two sources of truth.
2. **Category list as separate array** (line 35) — derivable via `Array.from(new Set(QUICK_COMMANDS.map(c => c.category)))`; today's explicit list also dictates display order, which is a feature.
3. **`hoveredCmd` keyed by command string** (line 43) — fine for unique commands, fragile if two entries share the same command.
4. **Pill-based filter UI** (lines 50-75) — reuses the segmented-control pattern from CommandsPanel tabs but with `border-radius: --radius-xl` (pill) vs `--radius-sm` (tab).
5. **Sends full command including args** (line 84) — correct UX choice, but parameterized commands like `/resume` lack a target.
6. **`transform: translateX(2px)` on hover** (line 98) — small motion; combined with background change, feels alive.
7. **Inline `gridTemplateColumns` not used** — but `flexWrap` plus per-pill width works because pills self-size.
8. **No keyboard nav between pills** — arrow keys do not move between categories; only Tab.
9. **No `role="radiogroup"` or `role="tablist"`** — semantically the pills are a single-select filter.
10. **Hover state coupled to command identity** — if a command appears in two categories, switching tabs preserves hover wrongly. (Not a current bug; commands are unique.)
11. **`monospace` value display** (line 120) — readable, but inline with `whiteSpace: nowrap` (line 121) can overflow narrow sidebars.

Tensions:
- **T1: Two catalogs vs one.** Maintaining `QUICK_COMMANDS` and `SLASH_COMMANDS` in parallel is the most obvious duplication in the cluster. Yet they have different semantics: quick = "ready to fire", slash = "reference of every option".
- **T2: Pill-as-filter vs segmented-tab.** Both UIs do the same thing (select one of N). The pill style here vs the segmented-tab style in CommandsPanel suggests visual hierarchy (sub-filter vs primary tab), but the visual distinction is not documented anywhere.
- **T3: Send-on-click vs confirm-then-send.** Quick clicks send commands to a live terminal — irrevocable. A small confirm step ("Send /clear?") could prevent accidental destructive actions.

## REFLECT

**Core insight:** QuickCommands is the more usable half of the Commands experience because it commits to sending full commands, but its separate catalog quietly duplicates CommandsPanel's data; merging them while preserving the "quick" subset would eliminate the most impactful duplication in the cluster.

Resolved tensions:
- **T1 resolved:** Define a single `COMMANDS` array in `src/shared/commands.ts` with a `quick: boolean` flag (or `quickCommand: string` field giving the ready-to-fire variant). QuickCommands filters by `quick === true`; CommandsPanel shows all.
- **T2 resolved:** Document the visual hierarchy: segmented-tab = top-level mode, pill = subcategory filter. Or unify both to one shape and accept it.
- **T3 resolved:** Add a config in SettingsPanel: "Confirm before sending destructive commands" (default off). Tag commands like `/clear`, `/rewind` as destructive and gate them.

Hidden assumptions:
- That all quick commands are safe to send without arguments (true for `/model opus`, dubious for `/resume`).
- That the user wants to see the same six categories every time — no recent/favorite category.
- That `activeCategory` state is fine to lose on tab switch (it does, when CommandsPanel re-mounts QuickCommands).

## SYNTHESIZE

**What it should become:**
- Shared `COMMANDS` catalog in `src/shared/commands.ts`; QuickCommands and CommandsPanel both consume.
- `role="radiogroup" aria-label="Filter by category"` on pill container; `role="radio" aria-checked={isActive}` on each pill, with arrow-key navigation.
- Persist `activeCategory` in localStorage (per the user's preference for persistent UX).
- Add a `destructive: boolean` flag and optional confirmation for tagged commands.
- Memoize `filtered` with `useMemo` (low priority at 22 items but cheap).

Actionable items:
1. Lift `QUICK_COMMANDS` to `src/shared/commands.ts`; merge with `SLASH_COMMANDS` via a `quick: boolean` flag.
2. Add `role="radiogroup"` to pill container (line 50) and `role="radio" aria-checked` to each pill (line 57).
3. Implement roving tabindex for arrow-key navigation between pills.
4. Persist `activeCategory` in localStorage with key `claude-studio-quick-category`.
5. Tag destructive commands (`/clear`, `/rewind`, `/branch`?) and add a confirm prompt via a small modal or `window.confirm` for v1.
6. Reduce `transform: translateX(2px)` to `0` if user has `prefers-reduced-motion`.

Risks:
- Sharing a catalog requires resolving the category-name divergence ("Model" vs "Model & Effort"); pick one and update both.
- Adding confirmation dialogs in an Electron app may interrupt flow; make it opt-in.
- `localStorage` persistence assumes the user has a single-window mental model; if they open two windows with different categories, both will overwrite each other's preference on switch.
