# JEM Yiddish ASR Workbench

## Build Rules
- This is a Vite vanilla JS project. No frameworks (no React, Vue, Angular).
- All source files are ES modules in `src/`. Entry point is `src/app.js`, imported from `index.html`.
- Styles go in `style.css` (imported from index.html).
- Static data goes in `public/data.json`.
- Every module exports functions. No default exports. Named exports only.
- RTL support required for all Hebrew/Yiddish text.
- Dark theme. Colors defined as CSS custom properties in `:root`.
- Each file should be self-contained. Import only from `src/utils.js` and `src/state.js` as shared deps.
- Do NOT create new files beyond the ones listed in the file structure below.
- Keep it simple. Vanilla DOM manipulation. No build-time dependencies beyond Vite.

## File Structure
```
index.html              — single page shell, imports app.js and style.css
style.css               — all styles, dark theme, RTL, responsive
src/app.js              — entry: load data, init state, render, wire everything
src/state.js            — state management, localStorage, export/import
src/table.js            — unified table render, filters, sort, pagination, bulk select
src/mapping.js          — matching algorithm, suggested matches, search modal, link/unlink
src/cleaning.js         — 5-pass regex cleaner, clean rate, batch clean
src/alignment.js        — RunPod API calls, confidence parsing, batch align with progress
src/review.js           — diff viewer, inline editing, approve/reject, keyboard nav
src/karaoke.js          — audio player, word highlighting, seek, SRT/VTT export
src/benchmark.js        — ASR API config, WER/CER calculator, comparison table
src/utils.js            — Hebrew date parser, Yiddish normalization, levenshtein, CSV export
public/data.json        — pre-computed audio/transcript metadata
```

---

# Project Brief

## Mission

JEM (Jewish Educational Media) holds one of the largest Yiddish audio archives in the world — thousands of hours of the Lubavitcher Rebbe's farbrengens recorded between 1950–1992. Most of this audio has never been transcribed. The goal is to fine-tune an AI model that can automatically transcribe Yiddish speech, then use it to transcribe the entire archive, making it searchable and accessible.

To train that model, we need **50 hours of clean, aligned, verified audio-text pairs** spanning all years of the Rebbe's teachings. To measure whether the model is improving, we have **5 gold standard benchmark files** with verified transcripts and known WER (Word Error Rate) scores. The benchmark files must never enter the training set.

This app is the **data preparation workbench** that takes JEM's raw archive and produces training-ready data.

---

## What Exists Today

### Raw Data
- **4,669 audio files** on Google Drive (Rebbe's farbrengens, sichos, maamarim)
- **1,065 written transcripts** on Google Drive (handwritten/typed hanahos)
- **1,809 pairs** already matched (audio linked to its transcript)
- **423 curated pairs** selected for the 50-hour training set (listed in `50_hours_mapping.csv`)
- **5 gold standard benchmark files** with verified-perfect transcripts and baseline WER scores
- **2,860 unmatched audio files** that still need transcripts

### Existing Infrastructure
- **RunPod GPU endpoint** at `align.kohnai.ai/api/align` — accepts audio + text, returns word-level timestamps + confidence scores. Uses Yiddish-tuned Whisper model (`yi-whisper-large-v3-turbo-ct2`). Already deployed and working.
- **`data.json`** (~246KB) — pre-computed metadata for all 4,669 audio files and 1,065 transcripts, including Hebrew calendar dates, content types, suggested matches, and the 423 selected 50-hour pairs.
- **`50_hours_mapping.csv`** — the 423 curated audio-transcript pairs selected for training.

### Audio Storage: Cloudflare R2
Google Drive shared links are unreliable for programmatic access (rate limits, auth popups, expiring links). Audio files must be stored in **Cloudflare R2** — S3-compatible object storage with zero egress fees, already in the Cloudflare ecosystem.

**R2 Bucket:** `jem-asr-audio`
**Custom domain:** `audio.kohnai.ai` (served via Cloudflare Workers or R2 public access)

```
jem-asr-audio/
├── benchmark/          5 gold standard files (~50MB) — upload FIRST
├── training/           423 fifty-hour files (~3GB est.) — upload SECOND
└── archive/            remaining 2,860+ files — upload LATER (post-training)
```

**Migration priority:**
1. 5 benchmark files immediately (used constantly for WER testing)
2. 423 training files next (needed for clean → align → review pipeline)
3. Rest of archive after model is trained (for bulk transcription)

**Upload method:** One-time script using `wrangler r2 object put` or Python boto3 (R2 is S3-compatible). Downloads from Google Drive, uploads to R2.

**In `data.json`:** Each audio entry gets an `r2Link` field (e.g., `https://audio.kohnai.ai/training/5712-sicha-03.mp3`). App uses `r2Link` when available, falls back to `driveLink` for files not yet migrated.

### ASR APIs Available for Benchmarking
- OpenAI Whisper API
- YiddishLabs API
- Google Gemini API
- Any future fine-tuned model endpoint

---

## Architecture: One Table, One App, Zero Backend

### Philosophy
This is a browser-only static app. No server, no database, no framework. One HTML file, vanilla JS, one CSS file. State lives in the browser (localStorage) and can be exported/imported as JSON. The only external call is to RunPod for GPU alignment and to ASR APIs for benchmarking.

Why: the dataset (4,669 files) easily fits in browser memory. The processing (regex cleaning, WER calculation) is trivial JS. The only heavy compute (alignment) already has a deployed GPU endpoint. A backend adds complexity for zero benefit.

### Deployment
Static site on Cloudflare Pages. Single repo on GitHub. If auth is needed later, add Cloudflare Access (zero code change).

### Tech Stack
- **Vite** — build tool, dev server, production bundling
- **Vanilla HTML/CSS/JS** — no framework
- **data.json** — pre-computed metadata loaded on startup
- **localStorage** — auto-persisted user state
- **RunPod API** — GPU alignment (existing endpoint)
- **ASR APIs** — benchmarking (configurable endpoints)

---

## The Unified Table

The entire app is **one table**. Every audio file is a row. Columns appear as a file progresses through stages. The table view changes based on which filter/mode the user selects.

### Columns

| Column | Present When | Description |
|--------|-------------|-------------|
| ☐ (checkbox) | Always | Bulk select for batch operations |
| # | Always | Row number |
| Audio Name | Always | Filename of the audio recording |
| Year | Always | Hebrew year (5711–5752) |
| Type | Always | Sicha / Maamar / Farbrengen |
| Est. Duration | Always | Estimated length in minutes |
| First 15 Words | When transcript exists | Opening line of the transcript (Hebrew/Yiddish RTL) — instant visual confirmation of correct match |
| Transcript Name | After mapping | Linked transcript filename |
| Match Confidence | After mapping | 0–100% algorithmic confidence of the match |
| Clean Rate | After cleaning | % of text retained after stripping editorial content |
| Avg. Confidence | After alignment | Average word-level alignment confidence (0–100%) |
| Low Confidence Words | After alignment | Count of words below 40% confidence — tells reviewer where to look |
| Status | Always | Current stage: unmapped / mapped / cleaned / aligned / reviewed / approved |
| Actions | Always | Context-sensitive buttons per row |

### Filters (top bar)

| Filter | Shows | Count Badge |
|--------|-------|-------------|
| All | Every audio file | 4,669 |
| Unmapped | Audio with no linked transcript | 2,860 |
| Mapped | Pairs ready for cleaning | varies |
| 50-Hour Set | The 423 curated training pairs | 423 |
| Benchmark | The 5 gold standard files (locked) | 5 |
| Needs Review | Aligned but not yet approved | varies |
| Approved | Ready for training export | varies |

### Row State Machine

```
unmapped ──→ mapped ──→ cleaned ──→ aligned ──→ reviewed ──→ approved
                                       │
                              confidence scores
                              guide the review
                                       │
                                       ▼
                                  reviewer sees:
                                  - diff (what cleaning changed)
                                  - confidence (what alignment struggled with)
                                  - inline editing (fix mistakes)
                                  - approve / reject per row
```

### The Benchmark Guard

The 5 gold standard files are **hard-flagged** as `is_benchmark: true`. The app enforces:
- They NEVER appear in the 50-hour set
- They NEVER enter the training export
- They have their own dedicated filter view
- They cannot be approved for training (button doesn't exist on these rows)
- They CAN be run through ASR models for WER scoring

---

## Features by Mode

### 1. Mapping Mode

**Purpose:** Link audio files to their correct transcripts.

**How it works:**
- Filter to "Unmapped" to see audio files without transcripts
- Each unmapped row shows **suggested matches** — transcripts ranked by confidence using the date+keyword matching algorithm
- The **First 15 Words** column shows the opening line of each suggested transcript so the user can instantly verify
- Click a suggestion to link it (sets status to `mapped`)
- Click the ✕ on a mapped row to unlink it
- **Search modal** for manual matching — filter transcripts by year, month, content type, free text search across names and first lines
- Bulk operations: select multiple rows, assign transcript to all (rare, but possible for multi-part farbrengens)

**Matching Algorithm (ported from existing JS):**
- Extract Hebrew year (5711–5752), month (Tishrei–Elul), day from filenames
- Score: exact date match = highest, year+month = medium, year only = 0.25
- Keyword boost: "Sicha", "Maamar", "Farbrengen", "Basi Lgani" etc.
- Combined confidence: 0.0–1.0, displayed as percentage
- Sort suggestions by confidence descending

### 2. Cleaning Mode

**Purpose:** Strip non-spoken editorial content from transcripts so only the Rebbe's actual words remain.

**How it works:**
- Filter to "Mapped" or "50-Hour Set" to see rows ready for cleaning
- Select rows → click "Clean Selected" (or "Clean All")
- Five regex cleaning passes run in-browser:

| Pass | What It Strips | Example |
|------|---------------|---------|
| 1. Brackets | `[editorial notes]`, `[unclear]`, `[sic]` | `[הגהה]` → removed |
| 2. Parentheses | `(inaudible)`, `(emphasis)`, `(laughter)` | `(לא ברור)` → removed |
| 3. Section markers | סעיף א׳, numbered headings, asterisks | `* * *` → removed |
| 4. Special chars | Zero-width chars, smart quotes, formatting | `\u200B` → removed |
| 5. Whitespace | Multiple spaces, blank lines, trailing spaces | normalized |

- **Clean Rate** calculated: `(cleaned_word_count / original_word_count) * 100`
- If clean rate < 50%, flag row as suspicious (too much removed)
- Status moves to `cleaned`

**The diff is shown during review (step 4), not here.** Cleaning is a batch operation — you clean everything, then review with alignment data to guide you.

### 3. Alignment Mode

**Purpose:** Get word-level timestamps and confidence scores for each cleaned transcript.

**How it works:**
- Filter to "Cleaned" to see rows ready for alignment
- Select rows → click "Align Selected"
- For each row, the app fetches the audio from **Cloudflare R2** (fast, reliable, no auth), then calls the RunPod API:

```
POST https://align.kohnai.ai/api/align
{
  "mode": "align",
  "audio_base64": "<base64 from R2 fetch>",
  "audio_format": ".mp3",
  "text": "<cleaned transcript text>",
  "language": "yi"
}
```

- Response contains per-word data:
```json
{
  "timestamps": [
    {"word": "דער", "start": 0.0, "end": 0.32, "confidence": 0.92},
    {"word": "רבי", "start": 0.35, "end": 0.71, "confidence": 0.88},
    ...
  ]
}
```

- **Cold start warning:** RunPod scales to zero. First call takes ~2.5 minutes. Show a timer/progress indicator.
- Confidence scores stored on each row
- **Avg. Confidence** and **Low Confidence Word Count** columns populate
- Status moves to `aligned`
- Rows are now ready for human review

### 4. Review Mode (the core workflow)

**Purpose:** Human reviewer verifies cleaning quality, guided by alignment confidence scores.

**How it works:**
- Filter to "Needs Review" (or "50-Hour Set" filtered to aligned status)
- Click a row to expand the **review panel** below the table row (inline, not a separate page)

**The review panel shows:**

#### Top: Summary Bar
- Audio name, transcript name, year, duration
- Clean rate (e.g., "87% retained")
- Avg. confidence (e.g., "76%")
- Low confidence word count (e.g., "14 words below 40%")

#### Middle: Diff + Confidence View
Two-column or inline diff display:
- **Left:** Original transcript (raw)
- **Right:** Cleaned transcript (post-regex)
- Removed text highlighted in red
- Each word in the cleaned column is a **chip** colored by alignment confidence:
  - **Green (≥80%):** high confidence, trust it
  - **Orange (40–79%):** uncertain, spot-check
  - **Red (<40%):** low confidence, definitely review this word
- Reviewer's eye goes straight to **red words that were also changed by cleaning** — these are the most likely errors

#### Bottom: Inline Editing
- Click any word in the cleaned text to edit it directly
- Add back a word that was incorrectly removed
- Fix a word that was mis-cleaned
- Changes update the cleaned text in real-time

#### Actions
- **Approve** — mark this row as reviewed and approved (status → `reviewed`)
- **Reject** — flag for re-cleaning or manual attention
- **Skip** — move to next row without deciding

#### Bulk Actions (top of table)
- **Select All** checkbox → **Approve All Selected** — for when a batch looks clean
- Keyboard shortcuts: `↑/↓` navigate rows, `Enter` approve, `S` skip, `R` reject, `E` edit mode

### 5. Karaoke Player

**Purpose:** Audio playback with synchronized word highlighting. Used during review AND for generating subtitle files.

**How it works:**
- Available on any aligned row — click the ▶ button
- Opens a modal/overlay with:
  - HTML5 `<audio>` player with standard controls
  - Word grid below — all words displayed as chips, RTL
  - As audio plays, `timeupdate` event highlights the current word
  - Words colored by confidence (green/orange/red)
  - **Click any word** to seek audio to that timestamp
  - Playback speed controls (0.5x, 1x, 1.5x, 2x) — useful for fast speech sections

**Subtitle Export:**
- From the karaoke view, click "Export SRT" or "Export VTT"
- Generates standard subtitle file from the word timestamps
- Groups words into subtitle segments (e.g., 5-second chunks or by natural pauses)
- These files can be used directly in video players to show words as they're spoken

### 6. Benchmark Mode

**Purpose:** Measure ASR model quality before and after training.

**How it works:**
- Filter to "Benchmark" to see the 5 gold standard files
- **API Configuration panel** (gear icon): add ASR endpoints
  - Model name (e.g., "Whisper Large v3", "YiddishLabs", "Fine-tuned v1")
  - API endpoint URL
  - API key
  - Request format (configurable JSON template)
- Click "Run Benchmark" → sends each gold standard audio to each configured ASR model
- Each model's transcript becomes a **sub-row** under the benchmark file

**Per sub-row:**
- Model name
- Raw ASR output text
- WER (Word Error Rate): `(Substitutions + Insertions + Deletions) / Reference Words`
- CER (Character Error Rate): same formula at character level
- Custom WER: only counts critical errors (reviewer can mark acceptable spelling variants)
- Yiddish normalization applied before scoring: strip nikkud (vowel marks), cantillation marks, punctuation, lowercase

**Comparison View:**
- Side-by-side table: Model A vs Model B vs Model C on the same audio file
- Highlight which model got each word right/wrong
- Before/after training comparison: "Whisper baseline WER: 45% → Fine-tuned WER: 18%"

### 7. Transcription Mode (Post-Training)

**Purpose:** Use the fine-tuned model to transcribe the 2,860+ untranscribed audio files.

**How it works:**
- Filter to "Unmapped" (audio files with no transcript at all)
- Select rows → click "Transcribe"
- Sends audio to the fine-tuned model API (configured in benchmark settings)
- Returns full transcript + word timestamps + confidence
- Transcript populates the row as a new transcription
- Review in karaoke mode — approve or edit
- Export as text, SRT, VTT

This is the **end game** — once the model is trained and verified via benchmark, this mode lets JEM transcribe the entire remaining archive.

---

## Data Structures

### State Object (in-memory, persisted to localStorage)

```javascript
{
  // Loaded from data.json on startup
  audio: [
    {
      id: "a_001",
      name: "5712-sicha-03.mp3",
      driveLink: "https://drive.google.com/...",
      r2Link: "https://audio.kohnai.ai/training/5712-sicha-03.mp3",  // preferred
      year: "5712",
      month: "Tishrei",
      day: 15,
      type: "Sicha",
      estMinutes: 12,
      isBenchmark: false,
      isSelected50hr: true
    }
  ],

  transcripts: [
    {
      id: "t_001",
      name: "sicha_5712_03.txt",
      link: "https://drive.google.com/...",
      year: "5712",
      month: "Tishrei",
      day: 15,
      firstLine: "דער רבי האט געזאגט אז מען דארף זיין בשמחה..."
    }
  ],

  // User-created data (persisted to localStorage)
  mappings: {
    "a_001": {
      transcriptId: "t_001",
      confidence: 0.85,
      matchReason: "exact date + keyword",
      confirmedBy: "user",
      confirmedAt: "2026-03-11T10:30:00Z"
    }
  },

  cleaning: {
    "a_001": {
      originalText: "...",
      cleanedText: "...",
      cleanRate: 87,
      cleanedAt: "2026-03-11T11:00:00Z"
    }
  },

  alignments: {
    "a_001": {
      words: [
        { word: "דער", start: 0.0, end: 0.32, confidence: 0.92 },
        { word: "רבי", start: 0.35, end: 0.71, confidence: 0.88 }
      ],
      avgConfidence: 0.76,
      lowConfidenceCount: 14,
      alignedAt: "2026-03-11T11:30:00Z"
    }
  },

  reviews: {
    "a_001": {
      status: "approved",       // approved | rejected | pending
      editedText: "...",        // if reviewer made inline edits
      reviewedAt: "2026-03-11T12:00:00Z"
    }
  },

  benchmarks: {
    "a_bench_001": {
      results: [
        {
          model: "Whisper Large v3",
          transcript: "...",
          wer: 0.45,
          cer: 0.22,
          customWer: 0.38,
          ranAt: "2026-03-11T13:00:00Z"
        },
        {
          model: "Fine-tuned v1",
          transcript: "...",
          wer: 0.18,
          cer: 0.09,
          customWer: 0.12,
          ranAt: "2026-03-15T09:00:00Z"
        }
      ]
    }
  },

  // ASR API configuration
  asrModels: [
    {
      name: "Whisper Large v3",
      endpoint: "https://api.openai.com/v1/audio/transcriptions",
      apiKey: "sk-...",
      requestTemplate: { model: "whisper-1", language: "yi" }
    }
  ]
}
```

### Derived Row Status (computed, not stored)

```javascript
function getStatus(audioId) {
  if (state.reviews[audioId]?.status === "approved") return "approved"
  if (state.alignments[audioId]) return "aligned"       // ready for review
  if (state.cleaning[audioId]) return "cleaned"          // ready for alignment
  if (state.mappings[audioId]) return "mapped"            // ready for cleaning
  return "unmapped"
}
```

---

## File Structure

```
jem-asr-workbench/
├── index.html              # Single page — table, filters, modals
├── src/
│   ├── app.js              # Entry point — load data, init state, render table
│   ├── state.js            # State management — load/save/export/import
│   ├── table.js            # Table rendering — filters, sorting, pagination, bulk select
│   ├── mapping.js          # Matching algorithm, search modal, link/unlink
│   ├── cleaning.js         # 5-pass regex cleaner, clean rate calculator
│   ├── alignment.js        # RunPod API calls, confidence parsing, progress UI
│   ├── review.js           # Diff viewer, inline editing, approve/reject, keyboard nav
│   ├── karaoke.js          # Audio player, word highlighting, seek, SRT/VTT export
│   ├── benchmark.js        # ASR API config, WER/CER calculator, comparison view
│   └── utils.js            # Hebrew date parser, Yiddish normalization, CSV export
├── style.css               # Dark theme, RTL support, confidence colors, responsive
├── public/
│   └── data.json           # Pre-computed audio/transcript metadata (246KB)
├── package.json
├── vite.config.js
└── PROJECT_BRIEF.md        # This file
```

---

## Visual Design

### Theme: Dark Mode, Neon Accents
- Background: `#0a0a0f`
- Surface/cards: `#16162a`
- Text primary: `#e8e8f0`
- Text secondary: `#8888aa`
- Accent blue: `#00d4ff` (links, active states)
- Green: `#4ade80` (high confidence, approved, good clean rate)
- Orange: `#fb923c` (medium confidence, needs attention)
- Red: `#f87171` (low confidence, rejected, errors)
- Purple: `#b366ff` (benchmark items)

### RTL Support
- All Yiddish/Hebrew text renders right-to-left
- Word chips in karaoke flow RTL
- Table cells with Hebrew content align right
- Diff viewer respects RTL

### Responsive
- Desktop: full table with all columns
- Tablet: columns collapse, priority columns remain (name, first 15 words, status)
- Mobile: card view per row instead of table

---

## Build Plan — 1 Hour with 6 Parallel Claude Agents

### Minute 0–5: Setup (manual)
```bash
npm create vite@latest jem-asr-workbench -- --template vanilla
cd jem-asr-workbench
mkdir -p src public
# Copy data.json from existing yiddish-mapping repo into public/
# Create the file structure above with empty files
```

### Minutes 5–45: 6 Agents Build in Parallel

#### Agent 1 — `app.js` + `state.js` + `table.js` (Core Table & State)
Build the foundation:
- `state.js`: Load `data.json` on startup. Merge with localStorage saved state. Provide `getState()`, `setState()`, `exportState()` (download JSON), `importState()` (upload JSON). Auto-save to localStorage on every mutation. Computed `getStatus(audioId)` function.
- `table.js`: Render the unified table from state. Filter bar (All / Unmapped / Mapped / 50-Hour / Benchmark / Needs Review / Approved) with count badges. Sortable columns (click header to sort). Pagination (50 rows per page). Checkbox column for bulk select. "Select All" toggle. Search input (filters across audio name, transcript name, first 15 words). Row click expands inline detail panel. Status column with colored badges.
- `app.js`: Initialize app. Wire table to state. Register keyboard shortcuts. Render filter bar + table + action bar.

#### Agent 2 — `mapping.js` (Matching Engine)
- Matching algorithm: compare Hebrew dates (year/month/day) + keywords between audio and transcripts. Score 0.0–1.0. Return top 5 suggestions per unmatched audio.
- On unmapped rows: show "Suggested Matches" dropdown with confidence scores and first 15 words preview.
- Click suggestion → link audio to transcript → update state → re-render row.
- Unlink button on mapped rows.
- Search modal: opens full-screen overlay. Shows all transcripts. Filter by year, month, type, free text. Click to select and link.
- First 15 Words column: parse from transcript data, display RTL, truncate with ellipsis.

#### Agent 3 — `cleaning.js` + `review.js` (Clean & Review)
- `cleaning.js`: Five regex passes (brackets, parentheses, section markers, special chars, whitespace). `cleanText(raw)` returns cleaned string. `cleanRate(raw, cleaned)` returns percentage. Batch clean: iterate selected rows, apply cleaning, update state.
- `review.js`: Inline review panel (expands below table row on click). Shows:
  - Summary bar (clean rate, avg confidence, low confidence count)
  - Diff view: original vs cleaned text. Red = removed, green = kept. Each word in cleaned text is a chip colored by alignment confidence.
  - Inline editing: click any word chip to edit. Contenteditable span. Blur saves.
  - Approve / Reject / Skip buttons.
  - Bulk approve: "Approve All Selected" button in top action bar.
  - Keyboard navigation: ↑↓ move between rows, Enter = approve, S = skip, R = reject, E = toggle edit mode on current word.

#### Agent 4 — `alignment.js` + `karaoke.js` (Align & Play)
- `alignment.js`:
  - `alignRow(audioId)`: fetch audio file from Google Drive link, convert to base64, POST to `https://align.kohnai.ai/api/align` with `{mode: "align", audio_base64, audio_format: ".mp3", text: cleanedText, language: "yi"}`. Parse response timestamps. Store on state. Handle cold start (show "GPU warming up..." with elapsed timer). Handle errors gracefully.
  - Batch align: iterate selected rows with progress bar ("Aligning 3 of 423...").
  - CORS note: if direct calls fail, document that Cloudflare proxy handles this.
- `karaoke.js`:
  - Modal overlay with `<audio>` element + word chip grid.
  - `timeupdate` listener: find current word by timestamp, add `.active` class (highlighted background).
  - Click word → `audio.currentTime = word.start`.
  - Confidence coloring: green (≥0.8), orange (≥0.4), red (<0.4).
  - Playback speed buttons: 0.5x, 1x, 1.5x, 2x.
  - RTL word flow.
  - SRT export: group words into segments by pauses (gap > 0.5s = new segment), format as `.srt` with sequential numbering and timecodes.
  - VTT export: same logic, WebVTT format.
  - Download button for each format.

#### Agent 5 — `benchmark.js` (Score & Compare)
- ASR API config panel (gear icon → modal):
  - Add/remove/edit model configurations (name, endpoint URL, API key, request template as JSON).
  - Stored in state.asrModels.
  - API keys stored in localStorage only (never exported in state JSON — strip on export).
- Run benchmark: for each of 5 gold standard files × each configured model:
  - Send audio to ASR endpoint.
  - Receive transcript text.
  - Calculate WER: Levenshtein edit distance at word level. Yiddish normalization first (strip nikkud U+0591–U+05C7, strip punctuation, lowercase). Classify each error as Substitution/Insertion/Deletion.
  - Calculate CER: same at character level.
  - Custom WER: only count critical errors (substitutions that change meaning, not spelling variants).
  - Store results on state.benchmarks.
- Comparison table: model name | file name | WER | CER | Custom WER. Sortable. Highlight best model per file in green. Show before/after training delta with arrow (↓ = improved, ↑ = worse).
- Per-word error view: expand a benchmark result to see each word with S/I/D error type marked.

#### Agent 6 — `style.css` + `utils.js` (Theme & Utilities)
- `style.css`:
  - CSS custom properties for all colors (dark theme).
  - Base reset and typography (system font stack).
  - Table styles: striped rows, hover highlight, sticky header, horizontal scroll on mobile.
  - Filter bar: pill buttons with count badges, active state.
  - Word chips: base style + `.confidence-high` (green bg), `.confidence-mid` (orange bg), `.confidence-low` (red bg), `.active` (bright highlight for karaoke).
  - Diff styles: `.diff-removed` (red bg), `.diff-kept` (default), inline layout.
  - Review panel: expandable below row, slide-down animation.
  - Modal overlay: centered, dark backdrop, max-width 900px.
  - Status badges: colored pills (unmapped=gray, mapped=blue, cleaned=cyan, aligned=orange, approved=green, benchmark=purple).
  - RTL: `[dir="rtl"]` rules, `.hebrew-text` class.
  - Action bar: sticky bottom, glass-morphism background.
  - Responsive breakpoints: 1200px (full), 768px (compact), 480px (cards).
  - Scrollbar styling for dark theme.
- `utils.js`:
  - `parseHebrewDate(filename)`: extract year/month/day from filename strings.
  - `normalizeYiddish(text)`: strip nikkud (U+0591–U+05C7), remove punctuation, lowercase — used before WER comparison.
  - `levenshtein(a, b)`: word-level edit distance. Returns {distance, operations: [{type: 'S'|'I'|'D', ref, hyp}]}.
  - `calculateWER(reference, hypothesis)`: normalize both, run levenshtein, return {wer, cer, substitutions, insertions, deletions, total}.
  - `generateSRT(words)`: group words into segments, output SRT format string.
  - `generateVTT(words)`: same, WebVTT format.
  - `exportCSV(rows, columns)`: generate CSV string from data, trigger download.
  - `truncateWords(text, n)`: return first n words of text with ellipsis.
  - `formatConfidence(score)`: 0.85 → "85%".
  - `debounce(fn, ms)`: for search input.

### Minutes 45–55: Integration
- Wire all modules together in `app.js`
- Test each flow: mapping → cleaning → alignment → review → approve
- Test benchmark flow separately
- Test karaoke player + subtitle export
- Fix any wiring bugs

### Minutes 55–60: Deploy
```bash
npm run build
npx wrangler pages deploy dist/
```

---

## API Reference

### RunPod Alignment (existing)

```
POST https://align.kohnai.ai/api/align

Request:
{
  "mode": "align",              // "align" (audio+text) or "transcribe" (audio only)
  "audio_base64": "...",        // base64 encoded audio
  "audio_format": ".mp3",      // .mp3, .wav, .m4a
  "text": "...",                // transcript text (for align mode)
  "language": "yi"              // always "yi" for Yiddish
}

Response:
{
  "full_text": "...",
  "segments": [{
    "start": 0.0,
    "end": 5.2,
    "text": "...",
    "words": [{ "word": "...", "start": 0.0, "end": 0.5, "confidence": 0.85 }]
  }],
  "timestamps": [              // flat list of all words
    { "word": "דער", "start": 0.0, "end": 0.32, "confidence": 0.92 }
  ],
  "model": "yi-whisper-large-v3-turbo-ct2"
}

Notes:
- Cold start: ~2.5 minutes (GPU scales from zero)
- Warm response: 0.5–1 second
- Max audio: depends on RunPod config
- Cloudflare proxy hides the RunPod API key
```

### WER Calculation (in-browser)

```
Standard WER = (S + I + D) / N

Where:
  S = substitutions (wrong word)
  I = insertions (extra word in hypothesis)
  D = deletions (missing word from hypothesis)
  N = total words in reference

Custom WER = (I + D + critical_S) / N
  critical_S = substitutions that change meaning (not spelling variants)

Yiddish normalization (applied before comparison):
  1. Strip nikkud: Unicode range U+0591–U+05C7
  2. Strip punctuation: all non-letter, non-space characters
  3. Lowercase (for any Latin characters mixed in)
  4. Collapse multiple spaces to single space
  5. Trim
```

---

## Keyboard Shortcuts

| Key | Action | Context |
|-----|--------|---------|
| `↑` / `↓` | Navigate rows | Table |
| `Enter` | Approve current row | Review mode |
| `S` | Skip current row | Review mode |
| `R` | Reject current row | Review mode |
| `E` | Toggle edit mode | Review mode |
| `Space` | Play/pause audio | Karaoke player |
| `←` / `→` | Seek ±5 seconds | Karaoke player |
| `/` | Focus search input | Table |
| `Escape` | Close modal/panel | Any modal |
| `Ctrl+A` | Select all visible rows | Table |
| `Ctrl+E` | Export state as JSON | Global |
| `Ctrl+Shift+E` | Export approved as CSV | Global |

---

## What Success Looks Like

1. **All 423 pairs** in the 50-hour set are mapped, cleaned, aligned, reviewed, and approved
2. **Zero gold standard files** in the training export
3. **Training data exported** as clean audio-text pairs with word-level timestamps
4. **Model fine-tuned** on the 50-hour set
5. **WER improves** on the 5 gold standard files (measured in benchmark mode)
6. **Remaining 2,860 audio files** transcribed using the fine-tuned model
7. **Subtitle files generated** for use in video playback

---

## R2 Upload Script (run once per batch)

```bash
# Upload 5 benchmark files
for file in benchmark_files/*.mp3; do
  wrangler r2 object put "jem-asr-audio/benchmark/$(basename $file)" \
    --file "$file" --content-type "audio/mpeg"
done

# Upload 423 training files
for file in training_files/*.mp3; do
  wrangler r2 object put "jem-asr-audio/training/$(basename $file)" \
    --file "$file" --content-type "audio/mpeg"
done
```

Or use Python with boto3 (R2 is S3-compatible) for downloading from Google Drive and uploading to R2 in one script.

---

## Future Extensions (not built now)

- Multi-user collaboration via shared JSON on cloud storage
- Cloudflare Access for auth
- Cloudflare D1 (SQLite at edge) if localStorage becomes limiting
- Batch alignment queue with webhook callbacks
- Auto-cleaning suggestions using LLM
- Singing/silence detection in audio
- Many-to-many audio-transcript relationships (multi-part farbrengens)
