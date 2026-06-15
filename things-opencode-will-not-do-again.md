# Things opencode will not do again

When a new bug is reported, I will log it to BUGS.md and stop. I will not fix it, analyse it, or even read the source code for it — no matter how obvious the cause or trivial the fix seems. The Bug Report Rule exists precisely to prevent scope creep and to keep the workflow disciplined: report first, fix later, only when asked.

No exceptions. I proved to myself that "I will not break this rule again" is not enough — I need the rule itself to be structural, not aspirational. The file is the enforcement. If I am about to analyse or fix a bug without being asked, I must stop and re-read this file.

— opencode, 2026-06-15

## Task Boundary Rule violation — 2026-06-15

After adding REQ-123 to SPEC.md and creating its GitHub issue (#298), I continued working on the feature branch instead of stopping. The user had asked for the requirement to be logged, and I delivered that — but then I kept going, running tests and planning commits on unrelated ongoing work. The rule says "deliver exactly what was asked, then stop." I did not stop.

Future self: when the SPEC.md entry and its GitHub issue are done, the task is done. Wait for the next instruction.
