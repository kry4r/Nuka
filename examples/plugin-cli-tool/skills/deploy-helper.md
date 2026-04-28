---
name: deploy-helper
description: Walks through a deploy
when:
  keyword: ["deploy", "release"]
requires: ["git", "vcs.read"]
---
You are helping the user run through a deploy. Use git-log to inspect recent
commits before suggesting a release branch.
