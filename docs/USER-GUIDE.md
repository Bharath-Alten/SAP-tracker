# Control-Plan Automation — User Guide

This application takes a control-plan Excel file, lets you check and correct the values on
screen, and then creates the control plan in SAP for you: the header and every CP Grid row.

---

## 1. Start the application

Open a terminal in the project folder and run:

```
npm start
```

Wait for the browser to open at **http://localhost:4000**. If it does not open by itself, type
that address in your browser.

Leave the terminal window open while you work. To stop the application, press `Ctrl+C` in it.

---

## 2. Import your workbook

1. On the **Import** screen, drag your `.xlsx` control plan onto the box, or press **Choose a file**.
2. The application reads the file and opens the **Data** screen.

Only `.xlsx` files are accepted. If the file is refused, the message tells you why.

---

## 3. Check the data

The **Header** tab shows the CP Front Page as a form, with the same sections as the workbook:

- Control Plan Identification, Stage, Status, Applicability, Inputs Reference, Team, Revision History.
- **Status** is a dropdown showing the option marked with an X in the file. You can change it.
- Anything you change is marked *Changed*, with a **revert** link to undo it.

The **Grid** tab shows the CP Grid sheet as a table. Click any cell to edit it. Edited cells are
highlighted.

**Save changes** writes your edits back to a workbook file on disk. It is optional: the
automation uses what is on screen, saved or not.

---

## 4. Run the automation

Press **Run automation** at the bottom right.

1. A SAP browser window opens at the launchpad.
2. **Sign in yourself** in that window, with your own SAP user and password.
3. As soon as you are signed in, the application takes over. Do not close that window.
4. It creates the control plan and adds every grid row.

Progress appears in the panel at the bottom of the application:

```
LOGIN: please sign in in the browser window (waiting up to 300s)
LOGIN: signed in
HEADER: SAP created AFM1_D_2026_0409 / A0
GRID OK   row 1/52 (CONFORMITEST 04)
...
GRID: SAP reports 52 row(s) in AFM1_D_2026_0409/A0
```

The last lines tell you the **control plan number** SAP created and how many rows it contains.

A run takes about a minute plus the time you need to sign in. You have 5 minutes to sign in
before the run gives up.

---

## 5. Check the result in SAP

Open the control plan number from the run panel.

**If the CP Grid screen looks empty or short**, check the filter buttons above the table
(`MES | M | T | S | All`) and the view next to *Controls*. Press **All** to see every row. The
screen hides rows that do not match the selected filter.

---

## 6. When something goes wrong

The run panel shows the failing step, and a screenshot of the SAP window is saved for each
failed run.

| Message | What it means | What to do |
|---|---|---|
| *Credentials missing …* | Only when automatic sign-in is switched on | Ask your developer for the `backend/.env` file |
| *please sign in in the browser window* | Normal — it is waiting for you | Sign in in the SAP window |
| *ERR_NAME_NOT_RESOLVED* | SAP cannot be reached from this machine | Connect to the corporate network or VPN |
| *no CSRF token (HTTP 401)* | The sign-on did not complete, or you lack rights on the CP service | Sign in again; if it repeats, ask for access to `Z_1N31_CP_SRV` |
| *GRID FAIL row n …* | SAP refused that row; its reason is on the same line | Fix the value in the Grid tab and run again |
| *Test timeout* | A step took too long | Run again; if it repeats, tell your developer |

Nothing is deleted or overwritten in SAP by this application: each run **creates a new**
control plan.

---

## 7. Everyday tips

- **One workbook, one run.** Import, check, run, note the plan number.
- **Corrections are quicker here than in SAP.** Fix values in the Grid tab before running.
- **Keep the run panel open** until the end so you can copy the plan number.
- **Failed run?** Nothing is half-finished on your side: the plan may exist with fewer rows, so
  check it in SAP before running again, to avoid a duplicate.
