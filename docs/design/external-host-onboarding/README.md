# Design Brief: External Host Onboarding

## Overview

Nexus AI (a Local by WP Engine addon) lets a user connect WordPress sites that live on
arbitrary SSH-reachable hosts — not WP Engine, not Local. Today, connecting a new host is a
disjointed, CLI-first process spread across a text editor, a terminal, and a settings screen.
This brief asks for a single, self-contained UI wizard that replaces that whole process.

**What you're designing:** a multi-step "Add a host" flow that lives inside Local's native
Preferences window, under the existing "Nexus AI" page, as a new section alongside the
sections already there (AI Provider, Local AI Gateway, WP Engine API Credentials, AWS S3
Credentials, Chat History). See the attached screenshot of that page for the exact visual
context this needs to sit inside.

## Product decisions already settled

Do not re-litigate these during design — they come from real constraints, not preference:

- **Lives inside Preferences → Nexus AI**, as a new "External SSH Hosts" section, matching
  that page's existing collapsible-section style. Not a separate drawer, not a modal window —
  the wizard's steps expand and swap content in place, inside that section, the same way
  "AWS S3 Credentials" already expands to show its connected state and action buttons.
- **External hosts are never shown in Local's native Sites list.** They are a deliberately
  separate concept from a Local `Site` — no lifecycle (no start/stop), and mixing them into
  that list has already been considered and rejected elsewhere in this product's design.
- **Nexus will write the user's `~/.ssh/config` for them.** Today this is a fully manual,
  hand-edit-a-text-file step; the new flow takes hostname/username/port/key from the user and
  writes the `Host` block itself. (Engineering will handle the file-safety details of
  appending correctly — nothing for design to worry about beyond the form itself.)
- **The flow can generate a brand-new SSH key**, not just select an existing one, for a user
  who has never set one up. After generating (or selecting an existing key), the user must
  still manually copy the public key onto the remote server themselves — **Nexus never
  uploads it or runs `ssh-copy-id` automatically.** This needs a clear "copy this, paste it on
  your server" moment in the design, not a silent background action.
- **A brand-new host's identity must be approved by an explicit human action inside this UI —
  never automatable.** The first time this machine ever talks to a given host, SSH itself
  needs someone to confirm "yes, that's really my server" by looking at a short fingerprint
  code and clicking Approve. This is a deliberate security boundary already built and
  reviewed elsewhere in the codebase; the design's job is just to present it clearly, not to
  route around it with an auto-confirm or a remembered default.
- **A *changed* host key (one that doesn't match what was trusted before) is a hard stop with
  no approve option at all** — this is a real signal something may be wrong (server
  reinstalled, or worse, someone intercepting the connection), and the UI must not offer any
  path to click past it. Show the problem and point at manual next steps (contact whoever
  administers the server), nothing more.

## The flow

Four steps, all inline within the same "External SSH Hosts" section box:

### 1. Connection details
Form fields: alias (a short nickname for this connection), hostname, username, port (default
22), and an SSH key — either picked from keys already on the user's machine, or generated
fresh on the spot. Submitting this step writes the SSH config entry and moves to the probe.

### 2. Probe
Nexus attempts to connect and look for WordPress. This step has several possible outcomes,
and the design needs a distinct state for each:

- **Unknown host key** — show the fingerprint (a short code identifying this specific server)
  with **Approve** / **Dismiss** actions. This state already exists and is functional
  elsewhere in the product; it needs to be visually adapted to fit this new flow, not
  redesigned from scratch.
- **Changed host key** — hard stop, explained above. No approve action.
- **Authentication failed** — the public key isn't authorized on the server yet. Show the
  one-time command the user needs to run themselves, and a way to retry once they have.
- **WordPress not found automatically** — let the user type the path themselves and retry.
- **Success** — continue to step 3.

### 3. Pick site(s)
A host can have one WordPress site on it, or several (shared hosting). If exactly one is
found: confirm a short name for it and which environment it represents (production / staging
/ development). If more than one is found: a checklist, each with its own name and
environment, so the user picks which of several sites on that host to actually connect.

### 4. Done
Confirmation that the host (and its site(s)) are now connected, collapsing back to the
section's normal state — the new host now appears in the existing list of connected hosts.

## Fidelity requested

Low-to-mid fidelity is fine for a first pass — the goal is a clear, complete visual treatment
of every state above (including the five branches of step 2), consistent with Local's existing
Preferences UI look and feel, not final pixel-perfect polish. Rough wireframes exploring this
flow already exist internally for engineering's own reference; they are not final designs and
shouldn't be treated as a starting visual language — please work from Local's actual existing
Preferences page style instead.
