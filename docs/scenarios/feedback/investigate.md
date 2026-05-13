# Investigate Scenarios

The user has been handed a site they know nothing about — sudden technical ownership. These are the most open-ended scenarios: the user can't even form a specific question because they don't know what they don't know.

This is distinct from all other moments. In Orientation, the user knows their own fleet. In Find, the user has a specific target. In Investigate, the user starts with almost no context and needs Nexus to help them build a mental model of an unfamiliar site.

---

## S-M6-01 · I just inherited this site — what is it?

**Type:** Positive | **Frequency:** occasional | **Stakes:** high  
**Eval case:** *(not yet written)*

### Situation
A developer has been handed technical ownership of a WordPress site they've never seen before. It could be a client handoff, an acquisition, a team member leaving, or an internal project transfer. They need to get up to speed without breaking anything.

### What I know
- The site exists and I have access to it
- Something about its URL or name

### What I don't know
- What the site is for (purpose, audience)
- What content it has and how it's structured
- What plugins are installed and why
- Whether it uses a theme, a page builder, or custom code
- What's custom-built vs off-the-shelf
- Who has been maintaining it and what their patterns were
- Whether it's healthy or has latent problems
- What I should NOT touch

### Intent
Build a working mental model of this site quickly — its purpose, architecture, content, and risk areas — without having to manually explore every corner.

### Success looks like
- Surfaces site purpose from content (what are the main pages about?)
- Lists installed plugins with a brief note on each one's role
- Identifies the theme and whether custom code is present
- Flags anything unusual or potentially risky (unmaintained plugins, outdated WP, large autoload)
- Suggests what to investigate further and what to leave alone
- Responds to follow-up questions naturally ("what does this plugin do?", "is this theme custom?")

### Failure looks like
- Returns a raw plugin list with no interpretation
- Requires the user to know what questions to ask
- Only reports metadata without any synthesis
- Flags everything as risky (alarm fatigue) or nothing as risky (false confidence)

### Signals
- Did it synthesize across multiple data sources (content + plugins + theme + health)?
- Did it distinguish custom code from off-the-shelf?
- Did it surface risk areas without overstating them?
- Did it answer "what is this site for?" from the content, not just the metadata?

### Known gap
This scenario requires deeper synthesis than current tools support out of the box. It would benefit from a dedicated "site orientation report" tool or workflow.

---

## S-M6-02 · What does this site do for its business owner?

**Type:** Positive | **Frequency:** rare | **Stakes:** high  
**Eval case:** *(not yet written)*

### Situation
A business owner (non-technical) has taken over a site or is reviewing a site they nominally own but don't fully understand. They want to understand its purpose, what it delivers to visitors, and what the key workflows are — without needing to understand the technical stack.

### What I know
- The site exists
- It does something for my business (or used to)

### What I don't know
- What the site actually does for visitors
- What the key pages and flows are
- Whether it's working as intended
- What it would cost to maintain or change

### Intent
Understand this site as a business asset — what it does, whether it's healthy, and what I'd need to know before making changes.

### Success looks like
- Describes the site's apparent purpose in plain language (from content, not code)
- Identifies the main user journeys (contact form, shop, booking, membership, etc.)
- Surfaces any obvious health or maintenance concerns in business terms
- Does not use technical jargon without explanation

### Failure looks like
- Responds with a plugin list
- Uses technical terms without translation (shortcode, CPT, REST endpoint)
- Requires the user to interpret raw data themselves

### Signals
- Was the response written for a non-technical reader?
- Did it describe the site's business purpose from content analysis?
- Did it translate technical issues into business terms?

### Note
This scenario is the business-owner corollary to S-M6-01. The underlying data is the same; the framing and language are completely different. This tests whether Nexus can adapt its communication to the user's role.
