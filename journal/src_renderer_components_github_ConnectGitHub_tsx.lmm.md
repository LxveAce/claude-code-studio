# LMM — src/renderer/components/github/ConnectGitHub.tsx

## RAW
This is a token-entry form, and it's the security-sensitive piece of the whole cluster. The input is `type="password"` (line 56) so the token is masked in the field, and `autoComplete="off"` (line 60) prevents browser autofill from caching it. The submit handler trims, validates non-empty, calls the parent's `onConnect`, and on success clears the local state — meaning the raw token never survives a successful validation in renderer memory longer than the await. That's good hygiene. The "Generate token" button (lines 89-103) opens an external URL via `window.electronAPI.github.openExternal` with `scopes=repo,read:user&description=Claude%20Code%20Studio` prefilled — a nice touch that reduces user error. But it raises a security question: is the main-process `openExternal` handler whitelisted to github.com domains, or will it open arbitrary URLs? If a future caller passes a malicious URL, that's a phishing vector; the renderer cannot enforce this and must trust main. Open questions: (1) does `openExternal` validate the URL host against an allowlist; (2) what happens if the user pastes a token with extra whitespace or quotes (trim handles whitespace, but smart-quotes from a docs page would survive); (3) the error message on line 21 says "Failed to validate token" — but the actual error from github-service might be more specific (rate limit, network, 401) and is being thrown away; (4) the busy state correctly prevents double-submit, but nothing prevents an Enter-key spam from rapidly retrying after each completion — minor concern; (5) the scopes shown to user (line 127) hardcode `repo` and `read:user` matching the URL, but if the actual token has different scopes (user pasted their own old token), the SignedInBar will show the truth — so there's a documentation-vs-reality split that's fine but worth noting.

## NODES
1. **Lines 8-10 — minimal state**: `token`, `busy`, `err`. Right-sized.
2. **Line 14 — empty check after trim**: prevents whitespace-only submission.
3. **Line 19 — `setToken('')` after success**: clears renderer memory of the token immediately on success. Good practice.
4. **Line 21 — generic error message override**: `e.message` is shown, but the catch always lands the user with a vague string; specific server messages do propagate via `e.message`, which is fine.
5. **Line 28-31 — openExternal with prefilled URL**: trust boundary to main process; renderer assumes whitelist exists.
6. **Lines 56-60 — password input + autoComplete off**: correct hygiene for a secret field.
7. **Line 80-84 — disabled state visual**: disabled button is also visually muted; good affordance.
8. **Lines 121-129 — required-scopes documentation**: helpful — but it's redundant with the URL query string, which already requests these.
9. **No paste-time validation**: doesn't check if token looks like `ghp_*` or `github_pat_*`; relies on server-side validation.
10. **Line 21 — error is set but never cleared on retry without unmount**: when user types again, `err` persists until next submit; minor UX.
11. **No "show token" toggle**: user can't verify the pasted value.
12. **Lines 134-140 — `codeStyle` constant**: module-level; no per-render alloc.

**Tensions**: (a) Trust main-process openExternal vs. defense in depth — renderer cannot enforce URL whitelist, only main can. (b) Generic error text vs. specific server detail — current code passes through `e.message`, which is fine if github-service errors are user-friendly.

## REFLECT
**Core insight**: the security posture of this form is solid in renderer (password field, autocomplete off, clear-on-success, no logging visible), but the *real* security depends entirely on (a) the main-process token storage using OS keychain — which the help text on line 50 promises — and (b) `openExternal` having an allowlist. The renderer can verify neither. **Resolved tensions**: it's correct to delegate URL whitelist and storage to main; renderer should not duplicate. The vague-vs-specific error text is fine because `e.message` from `setToken` IPC will likely contain the GitHub API's exact reason (401, rate limit, etc.) — assuming github-service propagates rather than rewrites. **Hidden assumptions**: (1) main-process `openExternal` will refuse a malicious URL — must be verified in github-service or the IPC handler; (2) the OS keychain is available and writable (Windows Credential Manager); (3) the token will never be logged or appear in error stack traces (`e.message` should not include the token value); (4) the user won't paste into a developer console-monitored field.

## SYNTHESIZE
**What it should become**: keep current form, add a paste-time format hint (not validation), and add a "Cancel" or "Forget what I typed" affordance.

**Actionable items**:
- Add `aria-describedby` linking the input to the help text on line 50 for screen readers.
- Clear `err` state when user starts typing (`onChange` of token).
- Consider showing a "format looks correct/wrong" inline hint based on `ghp_` / `github_pat_` prefix — not validation, just a hint.
- Verify (in github-service or IPC handler) that `openExternal` enforces an https-only, github.com-host allowlist; this component cannot do that itself.
- Confirm github-service never includes the token value in thrown error messages (audit the catch path on line 17-23).
- Add `inputMode="text"` and `spellCheck={false}` to the input to suppress any browser intervention.

**Risks**: medium — this is the security entry point for the panel. The component itself is well-formed; the risk lives in main-process pieces it trusts. The most concrete renderer risk is that an error from `setToken` could echo the token back in `e.message` if github-service is careless.
