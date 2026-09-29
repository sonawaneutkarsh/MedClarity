<div align="center">

# MedClarity

**Medical PDFs, minus the detective work.**

Upload multiple medical documents, ask a question, and get one organized answer with page-level citations, detected conflicts, and a timeline of relevant information.

</div>

---

## Why MedClarity

Medical records arrive as scattered PDFs — lab results, discharge summaries, follow-up notes — often with overlapping or conflicting information. MedClarity turns that pile of documents into a single, traceable picture:

- **Citations you can actually check** — answers include inline `[Document Name, p.X]` references that jump straight to the source page. This makes the evidence inspectable, although citations do not eliminate every LLM error.
- **Cross-document conflict detection** — the pipeline explicitly compares findings across reports and surfaces disagreements (different dosages, units, diagnoses) or chronological trends.
- **Plain or clinical language** — toggle between a warm, layperson-friendly explanation and a precise clinical review of the same findings.
- **An automatic medical timeline** — key events, treatments, and lab results are extracted and plotted chronologically across all your records.
- **Your PDFs stay in the browser** — the files are parsed locally with PDF.js. Only the extracted text is sent to the configured Gemini API for analysis.

> **Educational tool, not medical advice.** MedClarity helps you organize and understand your own records. Always discuss findings and treatment decisions with a qualified clinician.

---

## How it works

MedClarity does more than throw every document into one giant prompt. For larger document sets, it breaks the question down, finds the relevant evidence, checks for conflicts, and then builds one cited answer. Small document sets use a faster single-shot path.

1. **Plan** — the query is split into 2–4 focused clinical sub-questions, each mapped to the documents likely to contain the answer.
2. **Retrieve & answer** — for each sub-question, the relevant documents are read page-by-page and grounded facts are extracted with the exact source page.
3. **Audit** — extracted findings are compared across documents to detect contradictions, unit mismatches, and changes over time.
4. **Synthesize** — everything is merged into a structured report in your chosen reading level, with every claim carrying an inline citation.

Supporting features: click any medical term in an answer for a plain-language definition, get suggested follow-up questions based on your records, and inspect the raw pages side-by-side with the timeline.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 4, Framer Motion, Lucide icons |
| PDF parsing | PDF.js (browser-side, via CDN) |
| AI | Google Gemini (`gemini-2.5-flash` with automatic fallback), proxied server-side |
| Server | Express (dev + self-hosted production), Vercel serverless functions in `api/` |

---

## Getting started

**Prerequisites:** Node.js ≥ 18 and npm.

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (Express + Vite)
npm run dev
```

Open the printed URL (default `http://localhost:3000`). The server binds to `0.0.0.0` and honors the `PORT` environment variable.

### Gemini API key

MedClarity works with a **Gemini API key you paste into the app** (top bar), which is verified against the API and used only for your session:

- Create a key at [Google AI Studio](https://aistudio.google.com/apikey) — standard `AIzaSy...` API keys and `AQ....` auth keys are both supported.
- Paste it into the key field in the app header; a status dot confirms it's valid.
- No key is required to explore the UI — the app ships a mock/demo mode so you can see the flow without credentials.

Optionally, set `GEMINI_API_KEY` in your environment (e.g. a `.env` file — see `.env.example`) to use as a default; the app never requires a server-side key.

---

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the Express + Vite dev server (API proxy + HMR) |
| `npm run build` | Build the static frontend into `dist/` and bundle the Express server to `dist/server.cjs` |
| `npm start` | Serve the built app (`dist/`) in production |
| `npm run typecheck` | Type-check the codebase (`tsc --noEmit`) |
| `npm run clean` | Remove build output |

---

## Project structure

```
├── api/                  # Vercel serverless functions (/api/gemini, /api/gemini/verify, /api/key-status)
├── lib/
│   └── gemini-server.ts  # Server-side Gemini proxy: model fallback, retries, key verification, mock mode
├── server.ts             # Express server (dev middleware + static serving + /api routes)
├── src/
│   ├── lib/
│   │   ├── gemini.ts     # Agentic pipeline: plan → retrieve → audit → synthesize
│   │   └── pdfParser.ts  # Client-side PDF text & page extraction
│   ├── components/       # DocViewer, TimelineView, SuggestedQuestions, MedicalDictionaryPopup
│   ├── App.tsx           # Main app shell & chat
│   └── types.ts          # Shared domain types
├── index.html
├── vite.config.ts
└── vercel.json           # Vercel build/deploy configuration
```

---

## Deployment

### Vercel (recommended)

The repo includes `vercel.json` and serverless handlers in `api/`, so it deploys as a standard Vite + serverless project:

```bash
npx vercel
```

`vercel.json` builds with `vite build` and rewrites SPA routes to `index.html` while leaving `/api/*` to the serverless functions.

### Self-hosted (Node)

```bash
npm run build
npm start        # serves dist/ + /api routes on PORT (default 3000)
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP port for the server (default `3000`) |
| `GEMINI_API_KEY` | No | Optional default Gemini key; users can also paste a key in the app UI |
| `NODE_ENV` | No | `production` serves static files from `dist/`; otherwise Vite dev middleware |
| `VERCEL` | No | Set automatically on Vercel; skips the Express listener when present |

See [`.env.example`](.env.example) for reference.

---

## License

The source is publicly viewable, but no license for reuse is currently granted.
