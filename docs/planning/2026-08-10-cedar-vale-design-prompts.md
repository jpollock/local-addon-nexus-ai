# Cedar & Vale — design prompts for an external design pass

Three prompts. Each is self-contained; **Prompt A must run first** because B and C build on
its tokens. All content shown is real, pulled from the generated corpus on 2026-08-10 — not
placeholder. Field names are the actual ACF field names the theme will bind to.

What comes back gets translated into a WordPress block theme: `theme.json` tokens, block
templates, and Block Bindings that render the ACF fields directly. So the useful output is
**design tokens plus comps**, not HTML/CSS to ship.

---

## Prompt A — Art direction and design tokens

> I'm designing a WordPress site for **Cedar & Vale Health**, a fictional 25-location
> dermatology group in the US. It's one of two demo properties built from a single design
> system, and the two must read as genuinely different companies rather than one site with
> swapped hex values. The sibling property (Meridian Data, a B2B data company) is dense,
> dark-surfaced, data-forward, tabular figures and monospace for metrics. **Cedar & Vale is
> its opposite: warm, calm, generous whitespace, high-contrast typography.** A patient
> arriving worried about a mole should feel steadied by it.
>
> Constraints that are not negotiable:
> - **WCAG 2.2 AA is a floor, not a target.** State the measured contrast ratio for every
>   foreground/background pair you propose. Body text must clear 4.5:1; large text 3:1.
> - It must survive being rendered at 200% zoom and in a browser's forced-colors mode.
> - No decorative typefaces. Two families maximum. Assume they'll be self-hosted, so
>   prefer families with good variable-font support and modest file size.
> - Healthcare, not wellness-spa. Avoid the pastel-gradient, rounded-everything look.
>   It should feel like a competent medical practice that respects your time.
>
> Give me:
> 1. A colour palette as design tokens — surface, surface-raised, text, text-muted, border,
>   accent, accent-hover, plus semantic tokens for the three review states used throughout
>   the site (`reviewed`, `overdue`, `unreviewed`). Contrast ratio stated for each pairing.
>   Include a dark mode only if you think the property should have one; say why either way.
> 2. A type scale — family choices, the ramp (step sizes and line heights), and which step
>   is body copy. The site carries 600 long-form patient-education articles, so reading
>   comfort at length matters more than display drama.
> 3. A spacing scale and the layout measure (max line length) for article body text.
> 4. Border radius, border weight, and shadow treatment — one coherent decision, not a menu.
>
> Present it as a tokens table I can transcribe into a `theme.json`, plus one small visual
> specimen showing the palette and type ramp together.

---

## Prompt B — Location page and provider page

Run after Prompt A; hand its tokens in.

> Using the design tokens from before, design two page templates for Cedar & Vale Health.
> The whole argument of this site is **structured data driving presentation** — every value
> below is a real database field, not copy someone typed, so the layout should make the
> structure legible rather than burying it in prose.
>
> **1. Location page.** Real content:
>
> - Title: `Cedar & Vale Dermatology — Denver (80202)`
> - Address: 4653 Keenan Mall, Denver, CO 80202
> - Phone: (598) 555-5488
> - Hours: Mon–Fri 07:30–16:30, Sat 09:00–13:00, **closed Sunday**
> - Accepting new patients: **yes** (this is a boolean and should read at a glance)
> - Metro: Front Range
> - Parking: "Underground garage, first ninety minutes validated at reception"
> - Accessibility: "Automatic doors, accessible parking within twenty feet of the entrance"
> - Also on the page: the providers who practise here, and the insurance plans accepted here
>   (both are relationship lists — a location can have several of each)
>
> The hours table and the accepting-new-patients state are the two things a patient actually
> came for. Sunday being closed must be visibly *closed*, not a blank row.
>
> **2. Provider page.** Real content:
>
> - Name: `Clementine Lang, MD`
> - Credentials: MD · Specialties: medical dermatology
> - Board certifications: American Osteopathic Board of Dermatology
> - Languages spoken: English, Vietnamese
> - Practises at: Cedar & Vale Dermatology — Denver (80202)
> - A ~110-word professional biography
> - Review status: `reviewed` — clinical content on this site carries a review state and a
>   reviewer, and showing it is part of the point
>
> **A hard rule on provider imagery: no photorealistic faces.** Illustrated, abstract, or
> initial-based only. Sixty AI-generated photorealistic faces presented as board-certified
> dermatologists is an asset that looks fine in a demo and is indefensible the moment a
> screenshot travels without context. Design the avatar treatment accordingly — make it a
> deliberate style choice rather than an obvious placeholder.
>
> Show desktop and mobile for both. Languages spoken and specialties are arrays of arbitrary
> length — show how they degrade with one item and with six.

---

## Prompt C — Article page and the condition/treatment reference pages

Run after Prompt A; hand its tokens in.

> Using the same tokens, design the reading and reference experience for Cedar & Vale Health.
>
> **1. Patient-education article.** 600 of these exist. Real example:
>
> - Title: `What to expect at your first appointment for Acne Vulgaris`
> - Opens: "You have a doctor's appointment coming up for your acne, and you might feel
>   nervous about what will happen. That is normal. Knowing what to expect can help you feel
>   ready."
> - Reading level: `plain` (the other values are `standard` and `clinical` — this is a real
>   field and worth surfacing, since a reader who wants the clinical version should be able
>   to tell)
> - Review status: `reviewed`, with a reviewing clinician and a review date
> - Links out to the conditions and treatments it mentions
>
> Optimise for sustained reading. These run 300–450 words but the layout must not fall apart
> at 1,200. The medical-review signal is a trust marker and should be findable without
> shouting.
>
> **2. Condition page.** Real content:
>
> - Title: `Acne Vulgaris` · ICD-10: `L70.0` · Category: inflammatory
> - Body areas: face, chest, back
> - Symptoms: comedones, inflammatory papules, pustules
> - Related treatments (a relationship list), plus the articles written about it
>
> **3. Treatment page.** Real content:
>
> - Title: `Mohs Surgery`
> - Typical duration: 81 minutes · Anaesthesia: local · Downtime: 13 days
> - Insurance covered: yes · FDA status: none recorded (**this field is genuinely empty —
>   design the absent state, do not invent a value for it**)
> - Price range **varies by location**: e.g. Denver $1,296–$2,074, across 25 clinics
> - Conditions treated (a relationship list)
>
> The per-location price range is the most interesting structured element on the site — 25
> ranges for one procedure. Find a treatment for it that is honest about the spread without
> becoming a wall of numbers.
>
> Also show the **article archive** listing: 600 items need filtering that respects the real
> taxonomies — condition category, body area, reading level, review status.

---

## What I need back to build the theme

- Tokens in a transcribable form (name → value, with contrast ratios).
- Comps at desktop and mobile for: location, provider, article, condition, treatment, archive.
- Component-level notes for anything with a variable-length or empty state: relationship
  lists, `languages`/`specialties` arrays, the null `fda_status`, closed-Sunday hours.

## Acceptance gates I'll hold the implementation to

From spec §5 — these are acceptance criteria, not polish:
- WCAG 2.2 AA contrast throughout.
- Green Core Web Vitals. A demo that argues for SEO quality while failing CWV refutes itself
  in the dev tools of anyone curious enough to look.
- No photorealistic provider imagery.
