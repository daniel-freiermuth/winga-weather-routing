# Definition of Done

The agent must verify ALL items in this checklist before declaring a task complete. The checklist is printed and each item confirmed before reporting "done" to the user.

## Checklist

Print this checklist before declaring done:

```
DoD Checklist:
  [ ] 1. Code compiles (npm run build)
  [ ] 2. Linting passes (npm run lint)
  [ ] 3. Formatting passes (npm run format:check)
  [ ] 4. Tests pass (npm test)
  [ ] 5. Deployed to test container (if applicable)
  [ ] 6. User confirmed it works
  [ ] 7. BUGS.md / SPEC.md updated (row moved to correct table)
  [ ] 8. CHANGELOG.md updated under ## Upcoming
  [ ] 9. README.md updated (if user-visible change)
  [ ] 10. Phase 1 commit done (implementation, ref #N)
  [ ] 11. Phase 2 commit done (after explicit user confirmation)
  [ ] 12. Branch pushed, CI passes on branch
  [ ] 13. PR created (with explicit approval)
  [ ] 14. PR merged (with explicit approval, --merge only)
  [ ] 15. CI passes on main after merge
  [ ] 16. GitHub issue closed (gh issue close, after CI on main passes)
```

---

## 1. Implementation Verification

Before reporting implementation complete to the user:

- **Code compiles:** `npm run build` passes (tsc, strict mode)
- **Linting passes:** `npm run lint` passes (eslint, no warnings)
- **Formatting passes:** `npm run format:check` passes (prettier)
- **Tests pass:** `npm test` passes (node:test)
- **Deployed:** Changes deployed to the test container and verified
- **User confirmed:** The user has explicitly confirmed the implementation works

---

## 2. Documentation

Every implementation must update:

- **BUGS.md / SPEC.md:** Row moved from Open to Closed (Phase 2 only, after confirmation). See Three-Table Rule below.
- **CHANGELOG.md:** Entry added under `## Upcoming` at the top. Replaced with version number on publish.
- **README.md:** Updated if the change is user-visible (affects what the user sees, configures, or interacts with). If no user-visible change, state this in the commit message.

---

## 3. Git Workflow

### Commit Rule

Commit at logical boundaries, not at every file change. Implementation and confirmation are two separate commits:

**Phase 1 — implementation commit** (before confirmation):
- Code changes only.
- The row stays in the Open table in SPEC.md / BUGS.md.
- Commit message uses `ref #N`.

**Phase 2 — confirmation commit** (after user confirms it works):
- Move the row from the Open table to the Closed table in SPEC.md or BUGS.md.
- Commit message uses `ref #N`.
- **Phase 2 requires explicit confirmation.** The user must say something like "confirmed", "it works", "looks good", or "DoD complete" — do not interpret general instructions like "continue", "proceed", "now for X", or "go on" as confirmation. When in doubt, ask: "Have you confirmed this works, or should I wait for your test results?"

After the Phase 2 commit: **push the branch** (`git push origin <branch>`), then **wait for CI to pass** before closing the issue. Run `gh run list --branch <branch>` to check CI status. Only close the issue once CI succeeds.

Never mark something as done or fixed in the docs before it has been confirmed.

The commit message must reference the GitHub issue with `ref #N`. Do not use `closes #N` or `fixes #N` — these auto-close the issue on push. Close the issue explicitly with `gh issue close` only after confirmation.

### Three-Table Rule

SPEC.md and BUGS.md each maintain three tables:

1. **Open** — items not yet implemented or fixed
2. **Won't Fix / Won't Implement** — items that will not be worked on
3. **Closed** — items confirmed done

Rows are sorted by ID number within each table. A row is moved from Open to Won't Fix or Closed only in the Phase 2 confirmation commit — never in the Phase 1 implementation commit.

---

## 4. PR and Merge

Each step requires **explicit approval** from the user:

1. **PR creation** — ask before creating. Do not create a PR without explicit approval.
2. **CI passes** — run `gh pr checks` to verify CI status before requesting merge.
3. **Merge** — ask before merging. Use `gh pr merge --merge` (regular merge commit). Never use `--squash`.
4. **CI on main** — after merge, wait for CI to pass on main before closing issues.
5. **Issue closure** — close with `gh issue close` and a summary comment. Only after CI passes on main.

PR guidelines:
- Branch from latest `main`; rebase, never merge commits
- One logical change per PR
- PR title is descriptive and self-contained
- Description: motivation (why) and approach (how)
- Never pass `--delete-branch` to `gh pr merge`
- **Version number changes** are only made as part of publishing. Follow Semantic Versioning.
