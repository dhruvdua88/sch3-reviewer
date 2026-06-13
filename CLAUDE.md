# CLAUDE.md — engineering notes for AI sessions

> This file is read by Claude Code at the start of every session. It gives you (a future Claude) enough context to pick up work on this project without re-reading the whole codebase.
>
> Keep this file under ~250 lines. When the project changes, update this file in the same commit.

---

## What this project is

**Schedule III Reviewer** — a browser-only audit tool for Indian Chartered Accountants. Uploads a PDF of a company's financial statements, runs disclosure / arithmetic / tie-out checks against Schedule III Division I (Companies Act 2013, as amended 24-Mar-2021) and CARO 2020, and produces a structured working paper (Excel) and an SA-700 (Revised) compliant Independent Auditor's Report (Word).

Two review paths exist:

1. **Quick Review** — a deterministic, local rule engine (~25 checks). No API key needed. Runs in ~2 seconds.
2. **Deep AI Review** — full 73-test pass via DeepSeek's OpenAI-compatible API. Runs the rule engine first, then layers AI on top, then merges by test ID.

The user is **Dhruv Dua** of Dhruv Dua & Co. Chartered Accountants (FRN 028145N). Default firm settings reflect this.

---

## Tech stack (don't change without good reason)

| Layer | Choice |
|---|---|
| Build | Vite 5 (`npm run dev`, `npm run build`) |
| UI | React 18 (hooks only, no state library, no router) |
| Styles | Plain CSS-in-JS via inline `style` props; design tokens in `src/styles/tokens.js` |
| Fonts | Fraunces (serif) · IBM Plex Sans (body) · JetBrains Mono (mono) — Google Fonts |
| Icons | `lucide-react` v0.383 |
| PDF | `pdfjs-dist` v4 (worker bundled via Vite `?url` import) |
| Excel | `exceljs` 4.4 (lazy-loaded from cdnjs) — used for BOTH the working-paper export AND reading uploaded .xlsx workbooks |
| OCR (opt-in) | `tesseract.js` 5.1 (lazy-loaded from jsdelivr at user click) |
| AI | DeepSeek v4 Pro / Flash via the OpenAI-compatible endpoint |
| Storage | `localStorage` only — no backend, no DB, no analytics |
| Deploy | GitHub Pages via `gh-pages` package (`npm run deploy:gh`) |

The app is a pure SPA. Nothing runs server-side.

---

## File map

```
sch3-reviewer/
├── CLAUDE.md                  ← this file
├── README.md                  ← user-facing
├── package.json
├── vite.config.js             ← base path '/sch3-reviewer/' when GITHUB_PAGES=true
├── index.html
├── public/                    ← static assets (favicon, CNAME if any)
└── src/
    ├── ScheduleIIIReviewer.jsx ← old re-export shim (entry)
    ├── main.jsx               ← root React render
    ├── styles/
    │   └── tokens.js          ← colours / fonts / button styles / SEVERITY config
    ├── data/
    │   ├── prompts.js         ← SCH3_PROMPT (73 tests), CARO_PROMPT, NOTES_DRAFT_PROMPT
    │   ├── caroRemarks.js     ← STANDARD_CARO_REMARKS (21 ICAI illustrative paragraphs)
    │   ├── reportDefaults.js  ← DEFAULT_REPORT_FIELDS for Audit Report tab
    │   ├── rule11Wording.js   ← Scenario-tagged variants for Rule 11(a)..(g)
    │   └── ruleDefinitions.js ← Rule-engine keyword test catalogue
    ├── lib/
    │   ├── pdfExtract.js      ← pdfjs → markdown + per-page text
    │   ├── excelExtract.js    ← ExcelJS (.xlsx/.xlsm) → SAME markdown shape + structured grid
    │   ├── ocrPdf.js          ← Tesseract.js OCR fallback for scanned PDFs
    │   ├── deepseek.js        ← API wrapper: retry, cache, timeout, streaming
    │   ├── caroApplicability.js ← Client-side CARO Para 1(2)(iv) arithmetic
    │   ├── sch3Sanitise.js    ← Post-AI response filter (drops hallucinated issues)
    │   ├── sourceAnchor.js    ← Match evidenceQuote to PDF page for "View source"
    │   ├── issueState.js      ← Open/Accepted/Dismissed/For-review per issue + audit trail
    │   ├── metricsExtract.js  ← Regex extraction of keyMetrics from markdown
    │   ├── ruleEngine.js      ← runRuleEngine() + mergeAnalyses() — deterministic path
    │   ├── docExport.js       ← Word .doc generation (audit report + notes)
    │   ├── excelExport.js     ← 6-sheet Excel working paper (incl. MCA Verification)
    │   ├── engagementStore.js ← localStorage: API key, settings, recent engagements (last 5)
    │   └── format.js          ← Number / currency / date formatters
    └── components/
        ├── ScheduleIIIReviewer.jsx ← Main orchestrator. ALL phase + state lives here.
        ├── SettingsGate.jsx        ← Soft gate — can be skipped for Quick Review
        ├── SettingsPanel.jsx       ← Slide-in drawer (API key + firm defaults)
        ├── EngagementHeader.jsx    ← Sticky top bar
        ├── FileUpload.jsx          ← Drag-drop zone
        ├── PdfMarkdownPreview.jsx  ← Two-route choice screen (Quick / Deep AI)
        ├── AnalyzingProgress.jsx   ← Progress bar w/ cycling stage labels
        ├── SeveritySummary.jsx     ← Critical/High/Medium/Low pills
        ├── IssueList.jsx           ← Filter chips + J/K nav + expansion mgmt
        ├── IssueCard.jsx           ← Collapsible card + source pill + actions
        ├── SourceModal.jsx         ← Page-anchored evidence viewer
        ├── CaroApplicabilityView.jsx ← Threshold table + empty state
        ├── ClauseRow.jsx           ← 21 CARO clauses inline edit
        ├── AuditReportTab.jsx      ← Scenario dropdowns for Rule 11 wording
        ├── SuggestedNotesTab.jsx   ← Single accounting policies note drafter UI
        └── EngagementChat.jsx      ← Floating Cmd+K chat panel
```

---

## Architectural conventions

**The orchestrator owns ALL state.** `components/ScheduleIIIReviewer.jsx` is the source of truth for phase, analysis, caro, issueStates, draftedPolicy, chatMessages, etc. Child components are presentational — they receive props and emit callbacks. Don't lift state down into children.

**Phase machine.** `upload → extracting → preview → analyzing-sch3 → analyzing-caro → done | error`. Quick Review uses the same `analyzing-sch3` phase but skips DeepSeek.

**Same JSON shape everywhere.** Rule engine output, DeepSeek output, merged output, imported engagement — all use:
```js
{
  company:    { name, cin, yearEnd, ... },
  keyMetrics: { revenueLakhs, profitBeforeTaxLakhs, paidUpCapitalLakhs, ... },
  scheduleIIIIssues: [
    { id, section, severity, category, title, observation,
      evidenceQuote, noteRef, implication, recommendation,
      source: 'rule'|'ai'|'rule+ai',         // added by mergeAnalyses
      sourcePage, sourceMatch, sourceConfidence  // added by sourceAnchor
    }
  ]
}
```
Don't introduce parallel shapes. If you add a field, follow the existing naming.

**Soft-gate.** App loads without an API key. `SettingsGate` shows on first run but offers a "Skip" CTA that drops the user into Quick-Review-only mode. Don't reintroduce a hard gate.

**Determinism settings.** SCH3 calls run at `temperature: 0.0`, `top_p: 0.1`. CARO matches. Chat is `0.3 / 0.9` (intentionally looser). Don't change without discussing.

**Timeouts.** Default `callDeepSeek` timeout = 120s. SCH3 passes `timeoutMs: 240_000` because the 73-test prompt can take longer on dense documents. Don't lower this.

**Retry.** `callDeepSeek` auto-retries 3× with exponential backoff on 429 / 5xx / network errors. Don't retry on auth or content-filter errors.

**Response cache.** In-memory `Map` keyed by SHA-256 of (model + temperature + top_p + systemPrompt + userPrompt). Survives within a session, cleared on reload. Streaming calls bypass cache.

**Persistence.** `localStorage` keys are namespaced `ddandco_*`. `saveEngagement({...id})` updates in place when id matches existing entry (used for per-issue state changes). Engagement list capped at 5.

**Word export tone.** SA-700 (Revised) compliant, signed at the bottom by FRN + Membership No + UDIN. Word docs are HTML+MSO-XML blobs with the `.doc` extension — open cleanly in Word and Google Docs.

**Excel export.** 6 sheets — Cover, Schedule III Issues, CARO Applicability, CARO Annexure A, Audit Report Fields, MCA Verification. Built via ExcelJS lazy-loaded from CDN.

---

## Recent decisions (chronological — most recent first)

- **Excel ingest (latest):** uploads now accept `.xlsx`/`.xlsm` alongside PDF. `lib/excelExtract.js` reads the workbook with ExcelJS (lazy CDN, no new bundle dep) and normalises every sheet into the SAME `<label> ... <number>` markdown line-shape that `pdfExtract.js` emits — so `metricsExtract`, the rule engine, and the AI prompt are all format-agnostic and unchanged. Numbers come from cells (no OCR/layout guessing), negatives rendered bracketed for `parseIndianAmount`, dates as "dd Month yyyy". Also returns a structured `grid` (cells per sheet) for future exact footing checks. Legacy binary `.xls`/`.ods` rejected with a "save as .xlsx" message. `pdfMeta.kind` is `'pdf'|'excel'`.
- **Rule engine + soft-gate:** `Quick Review` always runs deterministic checks first; `Deep AI Review` layers DeepSeek on top with `mergeAnalyses`. Source pills on issue cards. 25 deterministic checks including notes-to-face tie-out, within-note arithmetic, opening = prior-year closing.
- **SCH3 prompt expanded 46 → 73 tests** across A (consistency incl. T70-T73 tie-out checks), B (2021 amendment), C (other Sch III incl. share capital block), D (AS compliance), E (Companies Act), F (P&L disclosure). Output cap at 60 issues per call.
- **MCA Verification tab** added to the Excel export — 11-row checklist for reviewer to cross-check books vs MCA portal.
- **Notes drafter rewritten** as a single comprehensive "Significant Accounting Policies" note (Note 2). Editable per sub-policy. Word export `downloadAccountingPoliciesWord`.
- **Audit Report tab scenario dropdowns** — each Rule 11 clause has a dropdown of standard variants drawn from `rule11Wording.js`. Rule 11(g) has 8 variants from the ICAI Implementation Guide on Audit Trail (Revised 2024).
- **Engagement chat** — Cmd+K opens a floating chat panel pre-loaded with engagement context.
- **Source-anchored evidence** — per-page text captured during extraction; each issue's `evidenceQuote` is fuzzy-matched to a page; click "Page N" chip opens `SourceModal`.
- **Per-issue audit trail** — Accept/Dismiss/For-review/Note actions with reviewer name + timestamp. Survives reloads. ICAI peer-review-grade artefact.
- **OCR fallback** — Tesseract.js loaded on demand for scanned PDFs.
- **CARO applicability moved client-side** — when Para 1(2)(iv) thresholds say "exempt", we synthesise the result locally and skip the API call entirely.

---

## ICAI / regulatory references used (the prompts cite these)

- **Schedule III, Companies Act 2013, Division I** — as amended by MCA Notification G.S.R. 207(E) dated 24 March 2021.
- **ICAI Guidance Note on Division I — Non Ind AS Schedule III** (Jan 2022 Edition) — `https://resource.cdn.icai.org/68981clcgc55147-gnd1.pdf`.
- **ICAI Implementation Guide on Reporting on Audit Trail under Rule 11(g)** (Revised 2024 Edition) — drives the `rule11Wording.js` Rule 11(g) variants.
- **ICAI Implementation Guide on Rule 11(e) and 11(f)** — drives the other Rule 11 variants.
- **CARO 2020** (Companies (Auditor's Report) Order 2020) — Para 1(2)(iv) thresholds + 21 paragraphs.
- **AS-1 to AS-29** notified under Section 133, Companies (Accounting Standards) Rules 2021.
- **MSMED Act 2006 Section 22** — six-clause disclosure.
- **Companies (Accounts) Rules 2014 Rule 8** read with Sec 134(3)(m) — Forex earnings & outgo.

---

## How to build, test, deploy

```bash
# Dev
npm install
npm run dev                   # → http://localhost:5173

# Build (no GitHub Pages base path)
npm run build                 # → dist/

# Build for GitHub Pages (base = /sch3-reviewer/)
GITHUB_PAGES=true npm run build

# Deploy to GitHub Pages
npm run deploy:gh             # builds with GITHUB_PAGES=true then pushes dist/ to gh-pages branch
```

**There is no test suite.** Validation is manual:
1. `npm run dev`
2. Skip the API key gate
3. Upload a known PDF; verify Quick Review fires
4. Click "Run Deep AI Review on top" (with key); verify merged output
5. Check Excel and Word exports

**Known build issue:** if `rm -rf node_modules package-lock.json && npm install` is needed because of the Rollup native-binary npm bug, that's expected on cross-platform syncs.

---

## Coding conventions

- **No emojis in source files** unless the user asks (consistent with their CA-firm tone).
- **Comments are sparing** but every non-trivial file has a header block explaining what it does and what it's NOT for.
- **Severity rubric:** CRITICAL = qualification-worthy / FS-integrity break · HIGH = mandatory disclosure missing · MEDIUM = incomplete / wrongly classified · LOW = presentation / rounding only.
- **Cite Sch III paragraphs in note refs** when relevant — e.g., `Sch III Div I Gen Instr Para 6(L)(xviii)`. The user is a CA; vague refs aren't useful.
- **Word budgets** in prompt output: title ≤ 12 words, observation ≤ 50, evidenceQuote ≤ 30, implication ≤ 25, recommendation ≤ 25. Don't loosen these — they keep token cost bounded.
- **Date format** for the user is Indian: "31 March 2025", not "March 31, 2025". Format helpers in `lib/format.js`.

---

## Open scope mentioned in conversation

Things the user has expressed interest in but hasn't asked to be built yet:

- **Ind AS Division II support** — auto-detect from policy note; separate prompt.
- **Cross-year trend / variance audit** — upload current + prior year PDFs.
- **Trial Balance → Schedule III mapper** — CSV/Excel TB input, skip the PDF route.
- **Reviewer sign-off workflow expansion** — manager review → partner review → signed-off status.
- **SA 530 sampling helper.**
- **Materiality calculator memo** (SA 320 / SA 450).
- **LLM provider abstraction** — OpenAI / Anthropic / Gemini / local Ollama. **Explicitly deferred — DeepSeek only for now.**

Things the user has explicitly ruled out:

- **Signing/authentication FRRB tests** (DIN / "For and on behalf of the Board" / place-and-date FRRB observations).
- **CIF imports / detailed forex expenditure breakdown** as a standalone test category.
- **Standalone classification-errors section** (we keep T29 and T30 only).
- **Hardcoded fixed seed in DeepSeek** for reproducibility.
- **Auto-export Excel on done.**
- **Auto-run Deep AI after Quick Review** (must be explicit click).

---

## When a session starts

1. `git status` — see what's uncommitted.
2. `git log --oneline -20` — see recent context.
3. Read `package.json` to confirm dependency versions.
4. If the user is asking about a specific area, jump to the relevant file in the map above. Don't read the whole codebase.
5. If the user asks for new audit tests, **research first** — fetch the relevant ICAI Guidance Note or Implementation Guide section before drafting. Don't invent disclosure requirements.
6. After meaningful changes, run the bundle-compile check:
   ```bash
   npx --yes esbuild --bundle src/components/ScheduleIIIReviewer.jsx \
     --loader:.jsx=jsx --loader:.js=js \
     --external:react --external:react-dom --external:lucide-react --external:pdfjs-dist \
     --format=esm --outfile=/tmp/check.js && echo OK
   ```
   `npm run build` is the gold standard but it's slow.

---

## What NOT to do

- Don't reintroduce a hard SettingsGate that blocks Quick Review.
- Don't add new dependencies without confirming with the user — the bundle is intentionally small.
- Don't rewrite the orchestrator into smaller files just for tidiness — the user values having all state in one place.
- Don't change the `keyMetrics` field names — they're consumed by exports, prompts, and CARO arithmetic.
- Don't enable streaming on the SCH3 / CARO calls by default — it's been observed to return empty buffers on DeepSeek's `response_format: json_object` path.
- Don't lower `timeoutMs: 240_000` on SCH3.
- Don't break the `source: 'rule' | 'ai' | 'rule+ai'` tagging — UI and analytics depend on it.
