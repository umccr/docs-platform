---
type: status
title: "Ada: what's on my plate"
---

# Ada: what's on my plate

```base
filters:
  and:
    - type == "project"
    - or:
        - lead == "Ada"
        - members.contains("Ada")
views:
  - type: table
    name: My projects
    order:
      - file.name
      - status
      - priority
    sort:
      - property: priority
        direction: DESC
```

## My actions

Open actions with Ada before the first colon.

```tasks
not done
description regex matches /^[^:]*\bAda\b[^:]*:/
group by filename
```
