# Repository agent instructions

Read and follow [WORKFLOW.md](WORKFLOW.md) when it is present. The local
coordinator's `WORKFLOW.md` describes worktree management and release promotion.

- Create one dedicated feature branch and worktree per task, based on `dev`.
- Perform task work in the feature worktree. Reserve `dev` and `main` for
  review, integration, and release promotion.
- Rebase features onto the current `dev` before fast-forward-only integration.
- Preserve existing changes and avoid destructive Git operations.
- Use Conventional Commits and run validation appropriate to each change.
- Report the branch, worktree path, commits, and validation when handing off.
