# Launch Hardening Plan: Credential Scan, Cleanup Inventory, and Documentation Remediation

## Summary
On February 16, 2026, a non-mutating scan found real launch blockers:
1. Exposed credentials in Git history (commit `6244229`) in `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/cursor_revisiting_implementation_approa.md`.
2. Private TLS key in history and currently tracked (`/Users/jtr/_JTR23_/cosmo_ide_v2_dev/ssl/key.pem`).
3. Sensitive/generated files tracked despite `.gitignore` (2,863 ignored-but-tracked files, mostly `node_modules`).
4. Documentation mismatches and missing launch docs.

Selected execution preferences (locked):
1. History strategy: rewrite history (keep meaningful history).
2. Cleanup scope: aggressive launch cleanup.
3. Docs scope: expanded docs package.

## Public API / Interface Impact
1. No HTTP API route/schema changes are planned.
2. Developer interface changes:
- Update `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/package.json` to include `engines` (`node >=18`, `npm >=9`).
- Keep `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/package-lock.json` tracked (remove accidental ignore behavior from `.gitignore`).
3. Documentation contract changes:
- Add canonical docs index and security/install/release documentation.
- Align README commands and default ports with actual runtime behavior.

## Implementation Plan

### Phase 1: Immediate Credential Containment
1. Rotate and revoke all potentially exposed credentials before any push:
- OpenAI key, Anthropic API key, xAI key exposed in commit `6244229`.
- Any Anthropic OAuth token shown in untracked scan artifacts (`sk-ant-oat01...`).
- OpenClaw gateway token/password shown in untracked `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/OPENCLAW-INTEGRATION.md` if real.
2. Regenerate TLS materials:
- Replace `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/ssl/key.pem` and `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/ssl/cert.pem` after history rewrite.
3. Enforce "no public push" gate until post-rewrite verification passes.

### Phase 2: Working-Tree Cleanup Inventory Execution
1. Remove untracked secret-bearing artifacts from root or sanitize before any commit:
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/CLEANUP_CHECKLIST.md`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/SECURITY_SCAN_EXECUTIVE_SUMMARY.md`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/SECURITY_SCAN_REPORT.md`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/OPENCLAW-INTEGRATION.md` (sanitize token/password if retained)
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/REPOSITORY_INDEX.md`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/LAUNCH_PREP_SUMMARY.md`
2. Remove obsolete tracked backup/archive artifacts from HEAD:
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/server/ai-handler.js.backup`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/server/server.js.oauth-fixed`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/public/index-modular.html.INCOMPLETE`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/REFERENCE-v1.html`
3. De-track generated/sensitive directories currently tracked:
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/node_modules`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/conversations`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/ssl`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/prisma/studio.db`

### Phase 3: Git History Rewrite (Preserve Useful History)
1. Create offline mirror backup of the repository before rewrite.
2. Run `git-filter-repo` to purge sensitive and launch-noise paths from all history:
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/ssl/key.pem`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/ssl/cert.pem`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/prisma/studio.db`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/cursor_revisiting_implementation_approa.md`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/node_modules/**`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/conversations/**`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/server/ai-handler.js.backup`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/server/server.js.oauth-fixed`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/public/index-modular.html.INCOMPLETE`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/REFERENCE-v1.html`
3. Expire reflog and run aggressive GC.
4. Force-push rewritten history and require collaborator re-clone/reset instructions.

### Phase 4: `.gitignore` and Tracking Policy Repair
1. Fix overbroad ignore rule in `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/.gitignore`:
- Remove global `*.json` rule.
- Keep `package.json` and `package-lock.json` intentionally tracked.
2. Add precise ignore rules:
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/conversations/*.json`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/prisma/*.db`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/.claude/`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/snapshots/`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/ssl/`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/logs/` and `*.log`
3. Recheck with `git ls-files -ci --exclude-standard` and drive result to zero.

### Phase 5: Expanded Documentation Package
1. Add missing legal/security docs:
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/LICENSE` (MIT text)
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/SECURITY.md` (reporting process + secret handling + rotation policy)
2. Add user-operational docs under a real docs hub:
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/docs/INDEX.md`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/docs/INSTALL.md`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/docs/TROUBLESHOOTING.md`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/docs/CONTRIBUTING.md`
- `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/docs/RELEASE_CHECKLIST.md`
3. Reconcile README inconsistencies in `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/README.md`:
- Remove/replace nonexistent `npm run studio`.
- Replace "check documentation in `/docs`" with concrete new docs links.
- Keep license statement aligned with actual `LICENSE`.
4. Resolve port documentation mismatch:
- Align `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/.env.example` defaults with runtime (`3405/3406/3398`) or explicitly document intentional deviation.

### Phase 6: Final Verification and Launch Gate
1. History verification:
- `git log --all -- /Users/jtr/_JTR23_/cosmo_ide_v2_dev/ssl/key.pem` returns nothing.
- `git log --all -- /Users/jtr/_JTR23_/cosmo_ide_v2_dev/prisma/studio.db` returns nothing.
- `git log --all -- /Users/jtr/_JTR23_/cosmo_ide_v2_dev/cursor_revisiting_implementation_approa.md` returns nothing.
2. Secret-pattern verification across all history (non-placeholder patterns):
- No `sk-proj-`/`sk-ant-`/`xai-` full keys.
- No private key blocks.
3. Tracking verification:
- `git ls-files -ci --exclude-standard` returns zero.
- No tracked `node_modules`, `conversations`, `ssl`, or database artifacts.
4. Runtime smoke checks:
- Fresh install (`npm install`, `npm run db:migrate`, `npm start`) works.
- Primary app on `http://localhost:3405` and optional HTTPS on `https://localhost:3406`.
5. Documentation acceptance:
- Every README command exists and executes.
- All local markdown links resolve.
- Install flow succeeds on a clean clone using docs only.

## Test Cases and Scenarios
1. Secret regression test:
- Add a fake `sk-proj-...` string in a temp file, run scanner, verify detection, remove file, rerun clean.
2. History cleanliness test:
- Clone rewritten repo into a new directory and rerun full-history secret scan; expect zero high-confidence hits.
3. Ignore policy test:
- Create `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/conversations/test.json`; confirm ignored.
- Create `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/package-lock.json` change; confirm tracked.
4. Launch artifact test:
- Confirm removed backup/incomplete/reference files are absent from `HEAD` and history.
5. Docs usability test:
- New user follows `/Users/jtr/_JTR23_/cosmo_ide_v2_dev/docs/INSTALL.md` end-to-end without external assumptions.

## Assumptions and Defaults
1. Any credential found in commit `6244229` is treated as compromised and must be rotated, regardless of current usage.
2. Aggressive cleanup means deleting obsolete files rather than archiving them in-repo.
3. Expanded docs are source-controlled and intended for public repository users.
4. No product behavior/API changes are intended beyond repository hygiene and documentation alignment.
