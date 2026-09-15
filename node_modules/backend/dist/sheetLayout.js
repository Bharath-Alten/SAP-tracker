import * as XLSX from 'xlsx';
const X_MARK = /^x$/i;
function cellText(cell) {
    if (!cell)
        return '';
    return String(cell.w ?? cell.v ?? '').trim().replace(/\s*[\r\n]+\s*/g, ' · ').replace(/\s+/g, ' ');
}
function isDarkFill(cell) {
    const style = cell?.s;
    const hex = style?.fgColor?.rgb?.slice(-6);
    if (!hex || style?.patternType === 'none' || !/^[0-9a-f]{6}$/i.test(hex))
        return false;
    const [red, green, blue] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 < 0.5;
}
function stripColon(text) {
    return text.replace(/\s*:\s*$/, '');
}
function shortTitle(title) {
    const short = title.replace(/^control plan\s+/i, '');
    return short ? short.charAt(0).toUpperCase() + short.slice(1) : title;
}
// parseWorkbook drops blank rows, so map worksheet row numbers to indexes in the parsed rows.
function mapRowsToParsedIndex(worksheet, range, parsedRows) {
    const allRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, blankrows: true, defval: '' });
    const indexByRow = new Map();
    let next = 0;
    allRows.forEach((row, offset) => {
        if (next < parsedRows.length && JSON.stringify(row) === JSON.stringify(parsedRows[next])) {
            indexByRow.set(range.s.r + offset, next);
            next += 1;
        }
    });
    return next === parsedRows.length ? indexByRow : null;
}
export function buildSheetLayout(worksheet, parsedRows) {
    if (!worksheet['!ref'])
        return null;
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    const indexByRow = mapRowsToParsedIndex(worksheet, range, parsedRows);
    if (!indexByRow)
        return null;
    const merges = worksheet['!merges'] ?? [];
    const mergeAt = (r, c) => merges.find((m) => r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c);
    const spanEnd = (r, c) => mergeAt(r, c)?.e.c ?? c;
    const keyFor = (c) => `C${c - range.s.c + 1}`;
    const rows = [];
    for (const [r, index] of indexByRow) {
        const cells = [];
        for (let col = range.s.c; col <= range.e.c; col += 1) {
            const cell = worksheet[XLSX.utils.encode_cell({ r, c: col })];
            const text = cellText(cell);
            if (text)
                cells.push({ r, col, text, dark: isDarkFill(cell), ref: { row: index, key: keyFor(col) } });
        }
        if (cells.length)
            rows.push({ r, index, cells });
    }
    if (!rows.some((row) => row.cells.some((cell) => cell.dark)))
        return null;
    // 1. Split rows into sections at dark heading rows.
    const layout = { sections: [] };
    const drafts = [];
    rows.forEach((row, position) => {
        if (!row.cells.every((cell) => cell.dark)) {
            if (!drafts.length)
                drafts.push({ title: 'General', headingRow: row.r, subLabels: [], headerRows: [], rows: [] });
            drafts[drafts.length - 1].rows.push(row);
            return;
        }
        const [first, ...rest] = row.cells;
        if (position === 0 && row.cells.length === 1) {
            layout.title = first.text;
        }
        else if (row.cells.length === 1 || first.text.endsWith(':')) {
            drafts.push({ title: stripColon(first.text), headingRow: row.r, subLabels: rest, headerRows: [], rows: [] });
        }
        else {
            // Several dark cells side by side: column headers of a table.
            const last = drafts[drafts.length - 1];
            if (last && last.headerRows.length && !last.rows.length) {
                last.headerRows.push(row);
            }
            else {
                const title = row.cells.some((cell) => /revision/i.test(cell.text)) ? 'Revision History' : row.cells.map((cell) => cell.text).join(' · ');
                drafts.push({ title, headingRow: row.r, subLabels: [], headerRows: [row], rows: [] });
            }
        }
    });
    // Function codes (ME, Q, HoQ...) by column, reused to label table columns further down.
    const codeByCol = new Map();
    // 2. Turn each section's rows into fields, a choice list or a table.
    for (const draft of drafts) {
        const used = new Set();
        const items = [];
        const add = (r, col, item) => items.push({ order: r * 1000 + col, item });
        const cellAt = (row, col) => row?.cells.find((cell) => cell.col === col);
        const subLabelFor = (col) => draft.subLabels.find((label) => col >= label.col && col <= spanEnd(draft.headingRow, label.col))?.text;
        // "Function ->" row followed by "Name ->" row: one field per function.
        draft.rows.forEach((row, i) => {
            const next = draft.rows[i + 1];
            const arrow = row.cells.find((cell) => cell.dark && cell.text.endsWith('->'));
            const nextArrow = next?.cells.find((cell) => cell.dark && cell.text.endsWith('->'));
            if (!next || !arrow || !nextArrow || used.has(arrow))
                return;
            used.add(arrow);
            used.add(nextArrow);
            for (const code of row.cells.filter((cell) => !cell.dark)) {
                const name = cellAt(next, code.col);
                codeByCol.set(code.col, code.text);
                used.add(code);
                if (name)
                    used.add(name);
                add(code.r, code.col, {
                    type: 'field',
                    label: code.text,
                    cell: name && !name.dark ? name.ref : { row: next.index, key: keyFor(code.col) },
                    hint: subLabelFor(code.col)
                });
            }
        });
        // "Label :" followed by its value.
        if (!draft.headerRows.length) {
            for (const row of draft.rows) {
                const [label, ...rest] = row.cells.filter((cell) => !used.has(cell));
                if (!label || label.dark || !label.text.endsWith(':'))
                    continue;
                const value = rest.find((cell) => !cell.dark);
                used.add(label);
                if (value)
                    used.add(value);
                add(label.r, label.col, {
                    type: 'field',
                    label: stripColon(label.text),
                    cell: value ? value.ref : { row: row.index, key: keyFor(spanEnd(row.r, label.col) + 1) }
                });
            }
            // List of options where the chosen one is marked with an X.
            const choiceRows = draft.rows.filter((row) => {
                const [label, ...rest] = row.cells.filter((cell) => !used.has(cell));
                return label && !label.dark && !label.text.endsWith(':') && rest.every((cell) => X_MARK.test(cell.text));
            });
            const marks = choiceRows.flatMap((row) => row.cells.filter((cell) => X_MARK.test(cell.text)));
            if (choiceRows.length >= 2 && marks.length) {
                const markCol = marks[0].col;
                const options = choiceRows.map((row) => {
                    row.cells.forEach((cell) => used.add(cell));
                    return { label: row.cells[0].text, cell: { row: row.index, key: keyFor(markCol) } };
                });
                add(choiceRows[0].r, choiceRows[0].cells[0].col, { type: 'choice', label: shortTitle(draft.title), options });
            }
        }
        // Dark label with its value directly underneath (e.g. "Document Writer").
        draft.rows.forEach((row, i) => {
            const next = draft.rows[i + 1];
            for (const label of row.cells) {
                if (!label.dark || used.has(label) || label.text.endsWith('->'))
                    continue;
                const below = next && next.r === row.r + 1 ? cellAt(next, label.col) : undefined;
                if (!below || below.dark || used.has(below))
                    continue;
                used.add(label);
                used.add(below);
                add(label.r, label.col, { type: 'field', label: label.text, cell: below.ref });
            }
        });
        // Table: leaf header columns, plus any extra data columns found in the rows.
        if (draft.headerRows.length) {
            const headerCells = draft.headerRows.flatMap((row) => row.cells);
            const span = (cell) => [cell.col, spanEnd(cell.r, cell.col)];
            const columns = new Map();
            const leafSpans = [];
            for (const cell of headerCells) {
                const [start, end] = span(cell);
                const hasChildren = headerCells.some((other) => other.r > cell.r && other.col >= start && other.col <= end);
                if (hasChildren)
                    continue;
                const label = headerCells
                    .filter((other) => other.col <= cell.col && span(other)[1] >= cell.col)
                    .sort((a, b) => a.r - b.r)
                    .map((other) => other.text)
                    .join(' · ');
                columns.set(cell.col, label);
                leafSpans.push([start, end]);
            }
            const covered = (col) => leafSpans.some(([start, end]) => col >= start && col <= end);
            const dataRows = draft.rows.filter((row) => row.cells.some((cell) => !used.has(cell)));
            for (const cell of dataRows.flatMap((row) => row.cells)) {
                if (!columns.has(cell.col) && !covered(cell.col))
                    columns.set(cell.col, codeByCol.get(cell.col) ?? `Column ${XLSX.utils.encode_col(cell.col)}`);
                used.add(cell);
            }
            if (dataRows.length) {
                add(draft.headerRows[0].r, 0, {
                    type: 'table',
                    columns: [...columns.entries()].sort((a, b) => a[0] - b[0]).map(([col, label]) => ({ key: keyFor(col), label })),
                    rows: dataRows.map((row) => row.index)
                });
            }
        }
        // Anything not recognised is still shown: dark text as a note, values as fields.
        const leftovers = draft.rows.flatMap((row) => row.cells.filter((cell) => !used.has(cell)));
        const leftoverValues = leftovers.filter((cell) => !cell.dark);
        for (const cell of leftovers) {
            if (cell.dark) {
                add(cell.r, cell.col, { type: 'note', text: cell.text });
            }
            else {
                const label = leftoverValues.length === 1 && !items.length ? shortTitle(draft.title) : `Cell ${XLSX.utils.encode_cell({ r: cell.r, c: cell.col })}`;
                add(cell.r, cell.col, { type: 'field', label, cell: cell.ref });
            }
        }
        items.sort((a, b) => a.order - b.order);
        layout.sections.push({ title: draft.title, items: items.map(({ item }) => item) });
    }
    return layout.sections.length ? layout : null;
}
