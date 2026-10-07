# Stryker GLO Lakebase Workshop

Workshop materials for Stryker GLO using Databricks Lakebase.

## Development workflow

This repository uses the `dev-to-main` branch policy and `merge-and-strip`
release policy from the agent-worktree-workflow-quickstart.

- `main` is the default branch and holds reviewed releases.
- `dev` is the integration branch for development.
- Each task uses its own feature branch and Git worktree, created from `dev`.
- Rebase feature branches onto `dev` and integrate reviewed work with a
  fast-forward-only merge.
- Promote reviewed changes from `dev` to `main` with a merge commit, removing
  `WORKFLOW.md` from the release tree and retaining `CONTRIBUTING.md`.

The local coordinator contains a shared bare clone and separate checkouts:

```text
stryker-glo-lakebase-workshop/
├── stryker-glo-lakebase-workshop.bare/
└── worktrees/
    ├── main/
    ├── dev/
    └── <task>/
```

From the coordinator directory, create a feature worktree:

```sh
git --git-dir=stryker-glo-lakebase-workshop.bare worktree add \
  -b codex/my-feature worktrees/my-feature dev
```

Read `WORKFLOW.md` in the coordinator and development worktrees for the
integration and release procedures. Perform task work in feature worktrees;
reserve the `dev` and `main` worktrees for review, integration, and releases.

## License

This project is licensed under the [MIT License](LICENSE).
