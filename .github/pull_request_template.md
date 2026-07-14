<!-- Keep PRs atomic — one concern each. -->

## What & why

<!-- What does this change and why. -->

## Checklist

- [ ] `npm run lint` and `npm run build` pass (build includes the typecheck).
- [ ] `npm run test:unit` passes; new logic has a behavioural test.
- [ ] Safety invariants hold (no main-display write, no display cycling in the mode path). See [CONTRIBUTING](../CONTRIBUTING.md#safety-invariants--do-not-break-these).
- [ ] Docs updated in the same commit as the code they describe.
- [ ] `CHANGELOG.md` updated if user-facing.
