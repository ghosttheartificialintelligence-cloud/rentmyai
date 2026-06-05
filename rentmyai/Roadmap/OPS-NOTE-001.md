# OPS NOTE 001: GitHub Push Blocked
**Date:** 2026-06-05
**Status:** Known — deferred

---

## Issue
`git push` fails with:
```
fatal: could not read Username for 'https://github.com': Device not configured
```

## Root Cause
Mac Mini has no GitHub authentication configured.

## Findings
| Item | Status |
|------|--------|
| Remote URL | HTTPS (not SSH) |
| Credential helper | Not configured |
| `gh` CLI | Not installed |
| GitHub token in git config | None |
| SSH key | None |

## Implication
Local commits are safe but cannot be pushed to GitHub from this machine.

## Resolution — Pending Manual Action
Choose one:
1. **HTTPS + token:** Configure `git config --global credential.helper store`, then set remote with token embedded
2. **SSH:** Generate SSH key, add to GitHub, switch remotes to `git@github.com:...`
3. **Manual push:** Push from a machine that has GitHub auth configured (e.g., office workstation)

## Do Not
- Store tokens in plain text files
- Paste tokens into Telegram or chat
- Commit credentials to the repo

## Commits Waiting to Push
```
a8427ba ME-0008 result: full autonomous loop validated
aac1aa5 ME-0008 result: decision engine validated
fadfdb6 ME-0008: Decision engine endpoint
```

## Affected Repos
- `rentmyai` (gh + origin remotes both need auth)
