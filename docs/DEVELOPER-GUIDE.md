# Control-Plan Automation — Developer Guide

Node + TypeScript application that reads a control-plan workbook, shows it as a form and a grid,
and creates the control plan in SAP (header and CP Grid rows) through SAP's own OData service.

---

## 1. Get it running

```bash
npm install              # once, installs both workspaces
npm run setup:browsers   # once, installs Chromium for Playwright
npm start                # builds everything, serves the app, opens the browser
```

`npm start` is the only command for normal use: **one process, one URL** (http://localhost:4000).

| Command | Purpose |
|---|---|
| `npm start` | Build + serve + open the browser |
| `npm run serve` | Serve the existing build (no rebuild) |
| `npm run build` | Build frontend (`frontend/dist`) and backend (`backend/dist`) |
| `npm run dev` | Hot reload: Vite on 5173, API on 4000 |
| `npm test` | Run the Playwright specs from the terminal |

Node 18+ required (developed on 24).

---

## 2. Layout

```
backend/
  src/
    index.ts             Express: API routes + serves the built frontend
    excelParser.ts       .xlsx -> { sheetNames, sheets, layouts }
    sheetLayout.ts       turns the CP Front Page into titled sections (blue fills = headings)
    config.ts            port, timeouts
    playwright/
      specRunner.ts      starts a Playwright spec per run, streams its output to the UI
  tests/                 the automation itself (run by Playwright, not by tsc)
    api-flow.spec.ts     DEFAULT-CANDIDATE: manual login, then header + rows by OData
    login.spec.ts        screen-by-screen flow: fills the CP form, clicks Save, then rows
    createHeader.ts      POST ETCPHeaderInfoSet (creates the plan)
    gridRows.ts          POST ETCPIRControlsSet per row, inside a $batch changeset
    workbookData.ts      the uploaded values, by label, for the specs
    sapLogin.ts          service URLs, credentials, CSRF token, session warm-up
    tsconfig.json        editor-only config for this folder (Playwright compiles at run time)
frontend/src/App.tsx     the whole UI (import, header form, grid, run panel)
```

---

## 3. How a run works

1. The browser posts the edited sheets to `POST /api/automation/run`.
2. `specRunner.ts` writes them to `uploads/artifacts/<job>/workbook-data.json` and starts
   Playwright: `playwright test <spec>`, passing `WORKBOOK_DATA_PATH`.
3. The spec reads the values with `getFormFields()` / `getGridRows()`.
4. Every stdout line becomes a run-panel entry; the exit code decides success.
5. Screenshots and traces land in `uploads/artifacts/<job>/test-results/`.

Which spec runs: `PLAYWRIGHT_SPEC`, from the environment or `backend/.env`; default
`tests/login.spec.ts`.

---

## 4. Configuration — `backend/.env`

Copy `backend/.env.example`. The file is git-ignored; values there are passed to the spec, and
real environment variables win over it.

| Variable | Purpose |
|---|---|
| `PLAYWRIGHT_SPEC` | Which spec Run automation executes, e.g. `tests/api-flow.spec.ts` |
| `GRID_ROWS` | `all` sends every grid row; otherwise only the first (safe default) |
| `AUTO_LOGIN` | `1` types `SAP_USER` / `SAP_PASSWORD` instead of waiting for the user |
| `SAP_USER`, `SAP_PASSWORD` | Only needed with `AUTO_LOGIN=1` |
| `LOGIN_WAIT_MS` | How long to wait for a manual sign-in (default 300000) |
| `CP_ID`, `CP_ISSUE` | Send rows to an existing plan instead of the one just created |
| `CP_PLANT`, `CP_PROGRAM`, `CP_MATURITY`, `CP_GRANULARITY`, `CP_TARGET_SYSTEM`, `CP_MFT`, `CP_EFFECTIVITY` | Header values the CP screen hard-codes |
| `PORT` | App port (default 4000) |

**Never commit credentials.** `login.spec.ts` and `sapLogin.ts` read them from the environment.

---

## 5. The SAP side

Service: `Z_1N31_CP_SRV` (OData V2), client 001.

| What | Call |
|---|---|
| Create the plan | `POST ETCPHeaderInfoSet` with `CPID: "CP_ID"` — the placeholder; SAP returns the real id |
| Add a grid row | `POST ETCPIRControlsSet` with **empty** `CPID`/`Issue`, inside a `$batch` changeset together with `MERGE ETCPHeaderInfoSet(CPID=…,Issue=…)` `{"Mode":"U"}` |
| Read rows back | `GET ETCPIRControlsSet?$filter=CPID eq '…' and Issue eq '…'&$inlinecount=allpages` |

**The changeset is what attaches a row to a plan.** A plain `POST` with `CPID` filled in returns
201 and the row never appears in the plan. This was learned from the screen's own network
traffic and is the single most important detail in `gridRows.ts`.

Writes need a CSRF token (`GET <service>/?…` with `X-CSRF-Token: Fetch`) **and** a session that
has been through the CP app in the browser — the service answers 401 otherwise. `warmUpService()`
and the retry loop in `sapLogin.ts` handle that.

### Field mapping

`gridRows.ts` holds two tables:

- `GRID_MAP` — SAP field ← workbook column, for plain text values.
- `CODES` — fields SAP stores as codes: `Safety Critical → Y`, `Qualitative → L`, `Basic → BAS`,
  `Qualitative Mandatory → LM`, `In-process → P`, `L1 → ACTR_001`, `ROUTING → DOSS_02N`.

A value with no known code is sent as text and reported as `GRID NOTE …` in the run panel. When
you see one, add the pair to `CODES`. `EMPTY_ROW` mirrors the full payload the screen sends, so
the request shape stays identical.

`createHeader.ts` builds the header the same way, including the two values the screen derives:
`AssignedProduct` = `<product>+AODS/` and `PlanProdAssign` = `<engineering product>:$:`.

---

## 6. Finding out what SAP expects

The fastest route is the screen itself: open the CP app in Chrome, DevTools → Network, filter
`$batch`, do the action by hand, then read the request payload. Both entity shapes in this
project came from there.

`tests/odata-discovery.spec.ts` helps too: it logs in, downloads `$metadata`, reads one plan,
and suggests a workbook-to-SAP mapping by comparing values. Run it with
`npx playwright test tests/odata-discovery.spec.ts`; output lands in `backend/odata/`.

---

## 7. Working on it safely

- **Tag what works.** `ui-flow-working` marks the last fully working screen-based flow:
  `git checkout ui-flow-working -- backend/tests/login.spec.ts`.
- **Keep the two flows apart.** `login.spec.ts` (screens) and `api-flow.spec.ts` (API) are
  separate files; switch with `PLAYWRIGHT_SPEC` instead of editing either.
- **Start with one row.** Leave `GRID_ROWS` unset while changing the mapping.
- **Each run creates a new plan.** Nothing is overwritten, but test plans accumulate in SAP.
- **Type-check the specs** with `npx tsc --noEmit -p tests/tsconfig.json` (the build does not
  cover `tests/`).
- **Editing a spec needs no rebuild**; changing anything in `backend/src` does — use `npm start`.

---

## 8. Frontend notes

`App.tsx` is deliberately one file.

- The layout is fixed-height: the ribbon and action bar never scroll, only the form/grid do.
- The Header form is built from `parsedData.layouts[sheet]`, produced by `sheetLayout.ts`, which
  detects headings by their dark fill colour. A workbook without such fills falls back to a
  row-by-row view.
- Edits live in `editedSheets`; `importedSheets` keeps the original so "Changed" and *revert*
  work. Both saved and unsaved edits are sent to the automation.
- `RUN_PHASES` maps log step names to the progress bar. If you rename a step in a runner, update
  it there too.

---

## 9. Known limits

- **SSO must be done in a browser.** That is why a window opens at all.
- **Playwright's Chromium is separate from your Chrome**, so the corporate certificate is not
  trusted: `ignoreHTTPSErrors: true` in `playwright.config.ts` covers it.
- **Run history is in memory.** Restarting the server clears it.
- **One run at a time** is the assumption; the job store allows more but the SAP session does not.
