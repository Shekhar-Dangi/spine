/**
 * Local storage management for explain mode templates.
 * Built-in templates are seeded from the backend's defaults.
 * Users can edit/add/delete templates; changes persist in localStorage.
 */
import type { ExplainTemplate } from "@/types";

const STORAGE_KEY = "spine_explain_templates";

// ---------------------------------------------------------------------------
// Default template texts (mirrors backend/services/explain.py)
// Available placeholders: {book_title}, {author}, {chapter_num}, {chapter_title}, {chapter_text}
// ---------------------------------------------------------------------------

export const DEFAULT_TEMPLATE_TEXTS: Record<string, string> = {
  story: `Book: "{book_title}" by {author}
Chapter {chapter_num}: "{chapter_title}"

Chapter text:
---
{chapter_text}
---

Write this explanation as a causal story of discovery.

Use this structure:

# 1. The World Before the Problem
What did the world look like before this idea existed?
What constraints were people facing?

# 2. The Core Problem
What specific limitation or crisis forced innovation?

# 3. Early Attempts (And Why They Failed)
Describe the first solutions.
Explain their weaknesses clearly.

# 4. The Breakthrough
Who changed the rules?
What new structure or idea was invented?
Define the concept at the moment it appears.

# 5. New Problems Created
How did this solution introduce new risks or distortions?

# 6. Repeated Pattern
Show how this cycle repeats in later history.

# 7. What This Means Today
Connect back to the present without moralizing.

Rules:
- Introduce concepts only when needed.
- Do not front-load terminology.
- Keep progression chronological and causal.
- Use short recaps after each major shift.`,

  first_principles: `Book: "{book_title}" by {author}
Chapter {chapter_num}: "{chapter_title}"

Chapter text:
---
{chapter_text}
---

Teach this chapter from first principles — starting from concrete problems and building up to the solution.

Use this structure:

# 1. The Concrete Problem
What specific real-world situation or constraint motivated this idea?
Make it tangible. No abstractions yet.

# 2. The Constraints
What are the fundamental limits we cannot escape?
What is physically, mathematically, or logically impossible to avoid?

# 3. The Naive Approach
What is the obvious, simple solution a smart person would first try?
Why does it break down?

# 4. The Core Abstraction
What new concept or model must we invent to make progress?
Define it at the moment it becomes necessary.

# 5. The Mechanism
How does the solution actually work, step by step?
Be precise. If there is math, derive it from scratch.

# 6. Trade-offs
What does this approach give up? What does it cost?
Every solution has a price.

# 7. Failure Modes
Under what conditions does this approach fail?
What edge cases break the model?

# 8. Scaling
How does behavior change at scale — more data, more users, more complexity?

Rules:
- Build knowledge bottom-up. Never assume the reader knows the answer.
- Each step should feel inevitable given the previous step.
- Derive, do not assert.`,

  systems: `Book: "{book_title}" by {author}
Chapter {chapter_num}: "{chapter_title}"

Chapter text:
---
{chapter_text}
---

Analyze this chapter as a system — identify its components, flows, and dynamics.

Use this structure:

# 1. Components
What are the distinct parts of this system?
What role does each play?

# 2. Incentives
What does each component want to maximize or minimize?
What drives its behavior?

# 3. Information Flow
How does information move through the system?
What does each component know, and when?

# 4. Resource Flow
What resources (energy, money, time, attention) flow through the system?
Where do they accumulate? Where do they deplete?

# 5. Feedback Loops
What feedback loops exist — reinforcing (amplifying) and balancing (stabilizing)?
Trace each loop explicitly.

# 6. Failure Dynamics
How does the system fail?
Which feedback loops become destructive under stress?

# 7. Leverage Points
Where could a small change produce a large effect?
What interventions would restructure the system's behavior?

Rules:
- Be specific. Name the actual components, not generic abstractions.
- Show how loops interact — they rarely operate in isolation.
- Prioritize dynamics over static structure.`,

  derivation: `Book: "{book_title}" by {author}
Chapter {chapter_num}: "{chapter_title}"

Chapter text:
---
{chapter_text}
---

Derive the central idea or result of this chapter from scratch, step by step.

Use this structure:

# 1. Define the Variables
What quantities, objects, or concepts are we working with?
Define each precisely before using it.

# 2. State the Assumptions
What do we assume to be true?
Which assumptions are load-bearing — what breaks if they fail?

# 3. Step-by-Step Derivation
Show every step. No skipping.
Justify each transition: why does this step follow from the previous?
If this is conceptual rather than mathematical, trace the logical chain.

# 4. Intuitive Meaning
Now that we have the result — what does it actually mean?
Translate the formal result into plain intuition.

# 5. Edge Cases
What happens at the boundaries?
Test the result against extreme or degenerate cases.

# 6. Limitations
Where does this derivation break down?
What assumptions were we making that might not hold in practice?

Rules:
- Show your work at every step.
- If a step requires justification, provide it.
- Distinguish between what is derived and what is assumed.
- Prioritize clarity of reasoning over brevity.`,

  synthesis: `Book: "{book_title}" by {author}
Chapter {chapter_num}: "{chapter_title}"

Chapter text:
---
{chapter_text}
---

Synthesize the essential insight of this chapter — compress it to its irreducible core.

Use this structure:

# 1. The Core Thesis
In one or two sentences: what is the single most important claim this chapter makes?
Not a summary — the sharpest possible statement of the central idea.

# 2. The Primary Mechanism
What is the causal engine behind this thesis?
How does it actually produce the claimed effect?

# 3. Key Evidence
What are the 2-3 pieces of evidence or examples that most strongly support the thesis?
Be specific — name the actual cases, data, or arguments.

# 4. Central Trade-offs
What does accepting this idea cost?
What must you give up, ignore, or accept as a downside?

# 5. One Mental Model
If you could take away only one reusable mental model from this chapter — one pattern that transfers to other domains — what would it be?
State it in a form that could be applied elsewhere.

Rules:
- Resist the urge to summarize everything. Synthesize, don't recap.
- Every sentence should earn its place. Cut what doesn't add insight.
- The goal is a model the reader can carry and reuse — not a complete account.`,
};

export const BUILTIN_TEMPLATES: ExplainTemplate[] = [
  { id: "story", name: "Story", key: "story", template: DEFAULT_TEMPLATE_TEXTS.story, isBuiltin: true, isModified: false },
  { id: "first_principles", name: "First Principles", key: "first_principles", template: DEFAULT_TEMPLATE_TEXTS.first_principles, isBuiltin: true, isModified: false },
  { id: "systems", name: "Systems", key: "systems", template: DEFAULT_TEMPLATE_TEXTS.systems, isBuiltin: true, isModified: false },
  { id: "derivation", name: "Derivation", key: "derivation", template: DEFAULT_TEMPLATE_TEXTS.derivation, isBuiltin: true, isModified: false },
  { id: "synthesis", name: "Synthesis", key: "synthesis", template: DEFAULT_TEMPLATE_TEXTS.synthesis, isBuiltin: true, isModified: false },
];

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

export function getExplainTemplates(): ExplainTemplate[] {
  if (typeof window === "undefined") return BUILTIN_TEMPLATES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ExplainTemplate[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return BUILTIN_TEMPLATES;
}

export function saveExplainTemplates(templates: ExplainTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export function resetExplainTemplatesToDefaults(): ExplainTemplate[] {
  localStorage.removeItem(STORAGE_KEY);
  return BUILTIN_TEMPLATES;
}

/** Generate a mode key from a display name (slug, max 32 chars). */
export function slugifyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32) || "custom";
}
