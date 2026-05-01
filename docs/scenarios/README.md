# Nexus AI — User Scenario Library

Scenario cards describing the situations where users come to Nexus, what they know, what they want, and what good looks like. These are the source of truth for product requirements, eval cases, user research, and documentation.

## Format

Each scenario card answers:
- **Situation** — the user's context and moment
- **What I know / don't know** — epistemic state coming in
- **Intent** — what they're trying to accomplish
- **Success** — observable outcomes that mean it worked
- **Failure** — what bad looks like (not just "no result")
- **Signals** — measurable indicators for evaluation
- **Derives into** — eval case, product gap, doc section

Each card also carries two priority fields:

| Field | Values | Meaning |
|---|---|---|
| **Frequency** | `daily` / `weekly` / `occasional` / `rare` | How often a real user hits this moment |
| **Stakes** | `high` / `medium` / `low` | Cost of a bad answer — lost work, outage, confusion |

These guide where to invest in eval coverage and product improvements. High stakes + high frequency = highest priority.

## Global Assumptions

These apply to every scenario unless explicitly overridden:

- **WPE connection is optional.** If WPE is not connected (not logged in or not a customer), local-only results are a complete and correct answer — not a failure or partial result.
- **Data is always available at some tier.** For local sites: running → full WP-CLI; halted → filesystem scan; never scanned → unknown. The system handles tier selection transparently; the user should never need to know which tier was used.
- **Implementation concepts stay hidden.** Users should never see terms like "vector store", "graph DB", "digital twin", or "embedding" unless they specifically ask about internals.

## The Five Moments

| Moment | Description | Scenarios |
|---|---|---|
| [First Run](first-run.md) | User installs Nexus and encounters it for the first time | 4 |
| [Orientation](orientation.md) | User wants to understand what they have across their fleet | 5 |
| [Find](find.md) | User is looking for something specific across their sites | 5 |
| [Health](health.md) | User wants to know if things are working correctly | 4 |
| [Compare](compare.md) | User needs to choose between or map across multiple sites | 4 |
| [Investigate](investigate.md) | User has sudden ownership of an unfamiliar site | 2 |

## Relationship to Eval Cases

Each scenario card references the eval case it derives into (`tests/evals/cases/`). The scenario card is the human-readable source of truth; the eval YAML is the machine-executable artifact.

Scenario cards are also portable: the same scenario feeds product requirements, user interview guides, demo scripts, and documentation — not just evals.

## Types

**Positive scenarios** — the user has what they need and the system should answer.  
**Negative scenarios** — something is missing (auth, indexing, site doesn't exist) and the system should fail gracefully, not silently.
