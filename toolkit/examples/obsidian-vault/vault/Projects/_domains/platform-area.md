---
type: domain
title: "Platform area"
---

# Platform area

## Projects

```base
filters:
  and:
    - type == "project"
    - domains.contains(link("platform-area"))
views:
  - type: table
    name: Projects
    order:
      - file.name
      - status
      - priority
    sort:
      - property: priority
        direction: DESC
```
