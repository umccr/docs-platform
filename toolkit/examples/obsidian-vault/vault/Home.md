---
type: note
title: "Example team"
updated: 2026-09-29
---

# Example team

See [[Priorities]] for the agreed plan and [[writing#Headings|the writing guide]].

> [!tip] How this page works
> The tables below are Obsidian Bases views, rendered when the site was built.

## Active projects

```base
filters:
  and:
    - type == "project"
    - status == "active"
views:
  - type: table
    name: Active projects
    order:
      - file.name
      - domains
      - lead
      - priority
    sort:
      - property: priority
        direction: DESC
```

## Backlog

```base
filters:
  and:
    - type == "project"
    - or:
        - status == "backlog"
        - status == "on-hold"
views:
  - type: table
    name: Backlog
    limit: 5
    order:
      - file.name
      - status
```

%% An Obsidian comment: never published. %%
