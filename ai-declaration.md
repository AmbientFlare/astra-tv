# AI Declaration

Astra was built with heavy use of AI coding tools. This document states where
and how, using the category/level structure requested by the
[!selfhosted@lemmy.world AI & Promotional Post rules](https://lemmy.world/post/49151085).

Multiple different LLMs worked on this codebase over the course of development.

## Categories

| Category | Level | Notes |
|---|---|---|
| Design | **Assisted** | Product and UI design are mine. I sketched the interface I wanted on paper and handed that to an LLM. System architecture was worked out with AI assistance. |
| Implementation | **Generated** | The large majority of production code was AI-generated from my prompts and direction. |
| Testing | **Generated** | The test suite was AI-generated. I did not hand-write the tests. |
| Documentation | **Pair** | README, docs and release notes are roughly an even split of my writing and generated prose. |
| Review | **Pair** | Code review and PR feedback split between me and AI tooling. |

Deployment is not listed because no AI was involved in it. The Vega packaging,
the Amazon developer submission process, signing, and release deployment were
done entirely by hand.

## What was not AI

Hardware validation was done by me, on physical devices, and could not have
been automated. This includes A/V sync testing against a real TV, the
one-hour sync soak, repeat-seek and resume-position verification, remote/D-pad
behaviour, and the debugging of Vega-specific playback failures that only
reproduce on-device.

## Levels used

Per the community rule set:

- **Hint** - AI suggested a solution, a human did the task.
- **Assisted** - AI acted on part of a task, a human handled the bulk.
- **Pair** - roughly a 50/50 split of human-written and generated.
- **Generated** - human prompted, AI generated.
