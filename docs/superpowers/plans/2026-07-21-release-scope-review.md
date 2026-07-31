# Release Scope Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy only verified, compatible production changes from the current working tree.

**Architecture:** Group changes by runtime boundary (backend, bot, frontend, nginx, schema), verify each group against its callers and tests, and exclude generated or documentation artifacts. The local-squad traffic policy fix remains mandatory and is checked independently.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, Docker Compose, Nginx.

## Global Constraints

- Preserve unrelated user work unless it is explicitly approved for this release.
- Do not deploy migrations unless their matching runtime code and validation are included.
- Deploy through `scripts/deploy-to-bot.sh` after a selective staging directory passes dry-run.

---

### Task 1: Classify release candidates

**Files:**
- Inspect: tracked and untracked workspace changes

- [ ] Review diffs, migrations, and package changes; classify each as release, defer, or generated artifact.
- [ ] Verify every selected backend change has an applicable test or build check.

### Task 2: Resolve release conflicts

**Files:**
- Modify: only files with confirmed incompatibilities

- [ ] Write a focused failing test for each confirmed behavior conflict.
- [ ] Make the smallest compatible code change.
- [ ] Run the focused test and the backend build.

### Task 3: Deploy selected changes

**Files:**
- Execute: `scripts/deploy-to-bot.sh`

- [ ] Build a temporary deployment copy containing only approved files.
- [ ] Run the deployment dry-run and inspect its manifest.
- [ ] Deploy, then confirm the API health check and Compose service status.
