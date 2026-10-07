# Agent worktree workflow

This repository uses the dev-to-main branch policy and the
merge-and-strip release policy.

dev is the integration branch and main is the release branch. Create each
feature worktree from dev. Before handoff, rebase the feature branch onto the
current dev, validate it, and leave it ready for review. The integration
coordinator integrates reviewed work with a fast-forward-only update to dev.

Release promotion is reviewed: merge the approved dev commit into main,
then strip a fixed release-only set (at minimum this WORKFLOW.md file) from the
release tree. Keep CONTRIBUTING.md. Run release validation, complete tagging for
the approved revision, and handle publication through the project's normal
release process.
