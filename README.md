# SAP Tracker Automation

This project is a working internal web application that lets a user:

- upload an Excel (.xlsx) file (CSV support removed)
- parse the workbook and preview the data
- trigger Playwright automation from the UI
- track the automation progress and logs
- pass the structured data into an automation workflow
- see whether the process succeeds or fails

This is a working app structure for your CP/SAP automation process, built to be extended with your real selectors and automation flow.

---

## Quick start (normal use)

```bash
npm install     # once
npm start       # builds the app, starts ONE server and opens the browser
```

Then use the application at **http://localhost:4000**.

That is the only process you need. There is no separate frontend server to start.

First-time only, if Chromium has never been installed for Playwright on this machine:

```bash
npm run setup:browsers
```

Stop the application with `Ctrl+C` in the terminal.

### Startup commands

| Command | What it does | URL |
|---|---|---|
| `npm start` | Builds frontend + backend, starts the single server, opens the browser | http://localhost:4000 |
| `npm run serve` | Starts the already-built server without rebuilding or opening a browser | http://localhost:4000 |
| `npm run build` | Builds frontend (`frontend/dist`) and backend (`backend/dist`) only | – |
| `npm run dev` | Developer mode with hot reload (Vite on 5173 + API on 4000) | http://localhost:5173 |
| `npm test` | Runs the Playwright tests in `backend/tests` | – |
| `npm run setup:browsers` | Installs the Chromium browser used by Playwright | – |

### Configuration (environment variables, all optional)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | Port of the single server (e.g. `set PORT=4100` in cmd, `$env:PORT=4100` in PowerShell) |
| `FRONTEND_URL` | `http://localhost:5173` | CORS origin, only relevant for `npm run dev` |
| `CP_BASE_URL` | `https://example.com` | Target application base URL (config placeholder) |
| `AUTOMATION_TIMEOUT_MS` | `120000` | Automation timeout setting |
| `SAP_USER` / `SAP_PASSWORD` | – | SAP sign-on used by `tests/login.spec.ts` |

### SAP credentials

Copy `backend/.env.example` to `backend/.env` and fill in your own sign-on:

```
SAP_USER=your-sap-user
SAP_PASSWORD=your-sap-password
```

`backend/.env` is git-ignored, so credentials never reach the repository. The app reads it at
every run, so no terminal variables are needed. Real environment variables, if set, win over the file.

---

## Architecture

One Node.js process serves both the user interface and the API:

```text
Browser ── http://localhost:4000 ──► Express server (backend/src/index.ts)
                                       ├── /            built React UI (frontend/dist)
                                       └── /api/*       upload, save, run, status, artifacts
                                                           ↓
                                                        Excel (.xlsx) parser
                                                           ↓
                                                        Playwright automation (server-side)
                                                           ↓
                                                        CP / SAP application
```

Playwright runs on the server because it drives a real browser; the web page only sends the (edited) workbook data and polls job progress.

In `npm run dev`, Vite serves the UI with hot reload on port 5173 and proxies `/api` to the Express server on port 4000. This is only needed while changing the UI code.

### User interface

- A fixed ribbon (**Import · Data · Run · Reset · About**) that always stays at the top.
- **Import**: drop or choose a `.xlsx` control plan.
- **Data**: the first sheet (CP Front Page) as a **Header form**, the second sheet (CP Grid) as an **editable Grid**. Only this area scrolls.
- A fixed bottom action bar with **Save changes** and **Run automation**.
- **Run**: a docked run panel with progress phases, logs, results, a download of the exact data sent to the automation, and run history.

Edited values (saved or not) are what the automation receives.

---

## Project structure

```text
SAP-tracker/
├── backend/
│   ├── src/
│   │   ├── config.ts
│   │   ├── excelParser.ts
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── sheetLayout.ts
│   │   └── playwright/
│   │       └── specRunner.ts
│   ├── tests/
│   │   ├── login.spec.ts        # the automation that Run automation executes
│   │   ├── workbookData.ts      # imported workbook values for the specs
│   │   ├── sapLogin.ts
│   │   └── odata-discovery.spec.ts
│   ├── uploads/
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   ├── vite.config.ts
│   └── index.html
├── package.json
├── README.md
└── node_modules/
```

---

## What each folder does

### Frontend
Location: `frontend/`

This is the React + TypeScript interface for:

- file upload
- Excel (.xlsx) preview
- Header form + editable Grid, Save changes and Run automation buttons
- docked run panel with progress, logs and results
- success/failure result

Main file:
- `frontend/src/App.tsx`

### Backend
Location: `backend/`

This is the Express + TypeScript API for:

- receiving uploaded files
- parsing workbook data
- passing parsed data to Playwright
- returning job status and progress

Main files:
- `backend/src/index.ts`
- `backend/src/excelParser.ts`

### Playwright automation
Location: `backend/src/playwright/`

This is where your automation logic sits.

Main files:
- `backend/tests/login.spec.ts` — the Playwright steps that Run automation executes
- `backend/src/playwright/specRunner.ts` — starts that spec and streams its output to the UI

`login.spec.ts` is the file you update with your actual CP selectors and page actions.

---

## How the application flow works

1. User uploads a file in the frontend.
2. Frontend sends the file to `/api/upload`.
3. Backend parses the Excel (.xlsx) file.
4. Parsed workbook data is converted into structured JSON.
5. The first sheet is shown as a Header form and the second as an editable Grid.
6. User edits values (optionally saves) and clicks Run automation.
7. Backend starts the automation job.
8. Playwright receives the structured workbook data.
9. Status updates are streamed to the UI.
10. Final success or failure is displayed.

---

## API endpoints

### Upload a file
`POST /api/upload`

Uploads and parses the file.

### Start automation
`POST /api/automation/run`

Starts the Playwright automation workflow.

### Check automation status
`GET /api/automation/status/:jobId`

Polls the running job and returns logs, result and artifact links.

### Save edited workbook
`POST /api/workbook/save`

Writes the edited sheets to `backend/uploads/`.

### Download a job artifact
`GET /api/automation/artifact/:jobId/:fileName`

Returns the workbook snapshot or screenshot saved for a run.

### Health check
`GET /api/health`

Returns basic service status.

---

## Build & Run

All commands run from the project root. Workspaces install frontend and backend dependencies together.

**Normal use / production-style:**

```bash
npm install
npm start
```

Open http://localhost:4000 (opened automatically). Import a workbook, review the Header and Grid, optionally **Save changes**, then click **Run automation**.

**Developer mode (hot reload while editing UI code):**

```bash
npm run dev
```

Open http://localhost:5173. Both the API and Vite are started by this single command.

---

## Playwright browser installation

Before running browser automation, install the browser binary:

```bash
cd backend
npx playwright install chromium
```

If your machine is behind a company proxy or certificate layer, you may need to trust the corporate root CA before the browser download works.

Example:

```powershell
set NODE_EXTRA_CA_CERTS=C:\path\to\your-company-root-ca.pem
cd C:\Users\bbathina\Desktop\SAP-tracker\backend
npx playwright install chromium
```

If the Playwright install fails with certificate errors, it is an environment issue, not a code issue.

---

## Playwright tests & reports

This repository contains a small Playwright Test configuration and an example test under `backend/src/playwright/`. You can run Playwright Test to generate an HTML report and collect artifacts (screenshots, traces) as follows.

1) Ensure dependencies and browsers are installed:

```bash
cd backend
npm install
npx playwright install
```

2) Run Playwright tests and produce an HTML report:

```bash
cd backend
npx playwright test --reporter=html
```

3) Where to find reports and artifacts:

- **HTML report:** `backend/playwright-report/` (Playwright creates `playwright-report` by default; this repo convention uses `backend/playwright-report/`)
- **Test artifacts (screenshots / traces):** `backend/test-results/` or the artifact paths printed by the test run
- **Runtime automation job artifacts (when triggered from the app):** `backend/uploads/artifacts/<jobId>/` — screenshots and workbook snapshots for each triggered job are saved here.

Notes:
- If `@playwright/test` is not installed in `backend/package.json`, add it to devDependencies before running tests: `npm install -D @playwright/test`.
- Playwright Test will also print the local path to the generated HTML report after a run; open that `index.html` in your browser to inspect the results.


## Current Playwright behavior in this app

The current automation starts with the real launchpad sign-on flow:

- navigate to `https://mylaunchpad.intra.corp/fiori#Shell-home`
- fill the username and password from the `SAP_USER` / `SAP_PASSWORD` environment variables
- click the Sign On button

This is the first staged step of the real automation flow.

---

## Real CP automation next steps

After the login screen works, the next steps are:

1. navigate to the required internal CP / SAP module or screen
2. create the required parent module
3. create the required two sub-child modules
4. populate the required fields from the Excel workbook
5. read the CP Grid sheet and map the rows
6. add the CP Grid rows into the correct module
7. save the information
8. validate the result
9. display final success or failure status

---

## Files to update when you add your real automation

### Real selectors and page actions
Use:
- `backend/tests/login.spec.ts`

This is where you add the actual selectors and page actions. Workbook values come from
`getFormFields()` / `getGridRows()` in `backend/tests/workbookData.ts`.

### Excel parsing
Use:
- `backend/src/excelParser.ts`

This handles the workbook (.xlsx) conversion logic.

---

## Important notes

- The frontend and backend are already connected.
- Upload and parsing are already working.
- The app is structured to support real Playwright automation.
- The current Playwright flow is intentionally staged so you can add real CP selectors step by step.
- The app already tracks status and logs in real time.

---

## Recommended next milestone sequence

### Step 1
Get Playwright browser installed successfully.

### Step 2
Verify the login flow reaches the launchpad and signs in.

### Step 3
Navigate to the CP module area after login.

### Step 4
Map workbook field values into UI fields.

### Step 5
Create the required parent and child modules.

### Step 6
Process the CP Grid rows.

### Step 7
Validate and save the data.

### Step 8
Deploy internally and use it with real CP files.

---

## Final summary

This project already provides a working foundation for:

- file upload
- Excel (.xlsx) parsing
- data preview
- automation trigger button
- status/logging UI
- real Playwright entry point
- modular page-object architecture

The remaining work is to replace the placeholder selectors and step flows with your real CP/SAP screen logic and business rules.
