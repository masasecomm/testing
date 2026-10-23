function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  spreadsheet.setSpreadsheetTimeZone('America/Chicago');

  const sheetNames = [
    'All Captured Queries',
    'New Entries',
    'Rising Queries',
    'Dying Queries',
    'TimeStamp',
  ];
  sheetNames.forEach(name => {
    if (!spreadsheet.getSheetByName(name)) spreadsheet.insertSheet(name);
  });

  const publishedSheet = spreadsheet.getSheetByName('Published queries');
  if (publishedSheet) spreadsheet.deleteSheet(publishedSheet);
  const queryTrendsSheet = spreadsheet.getSheetByName('Query Trends');
  if (queryTrendsSheet) spreadsheet.deleteSheet(queryTrendsSheet);
  const emptyDefaultSheet = spreadsheet.getSheetByName('Sheet1');
  if (emptyDefaultSheet && emptyDefaultSheet.getLastRow() === 0
      && spreadsheet.getSheets().length > 1) {
    spreadsheet.deleteSheet(emptyDefaultSheet);
  }

  if (data.action === 'reset') {
    sheetNames.forEach(name => spreadsheet.getSheetByName(name).clearContents());
    return jsonResponse({ ok: true, reset: true });
  }

  writeQuerySheet(spreadsheet, 'All Captured Queries', data.all || [], data.exportedAtCentral);
  writeQuerySheet(spreadsheet, 'New Entries', data.newEntries || []);
  writeQuerySheet(spreadsheet, 'Rising Queries', data.rising || []);
  writeQuerySheet(spreadsheet, 'Dying Queries', data.dying || []);
  const timestampSheet = spreadsheet.getSheetByName('TimeStamp');
  writeTimestampRows(timestampSheet, data.timestampEntries || []);

  return jsonResponse({ ok: true });
}

function writeQuerySheet(spreadsheet, name, entries, exportedAt) {
  const sheet = spreadsheet.getSheetByName(name);
  sheet.clearContents();
  let row = 1;
  if (exportedAt) {
    sheet.getRange(row++, 1, 1, 2).setValues([['Exported (Central Time)', exportedAt]]);
  }
  sheet.getRange(row++, 1, 1, 3).setValues([['Rank', 'Search Query', 'Times Seen']]);
  if (entries.length) {
    ensureRowsForWrite(sheet, row + entries.length - 1);
    sheet.getRange(row, 1, entries.length, 3)
      .setValues(entries.map(entry => [entry.rank, entry.query, entry.count]));
  } else {
    ensureRowsForWrite(sheet, row - 1);
  }
}

function writeTimestampRows(sheet, entries) {
  sheet.getRange(1, 1, 1, 2)
    .setValues([['Captured At (Central Time)', 'Search Query']]);

  const validEntries = entries.filter(entry =>
    entry && entry.query && entry.capturedAt && !isNaN(new Date(entry.capturedAt).getTime()));
  const lastRow = sheet.getRange(sheet.getMaxRows(), 1)
    .getNextDataCell(SpreadsheetApp.Direction.UP).getRow();
  if (lastRow > 0) sheet.getRange(1, 3, lastRow, 1).clearContent();
  const existingRows = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 2).getValues()
    : [];
  const existingKeys = new Set(existingRows
    .filter(row => row[0] && row[1])
    .map(row => `${new Date(row[0]).getTime()}|${row[1]}`));
  const newEntries = validEntries.filter(entry =>
    !existingKeys.has(`${new Date(entry.capturedAt).getTime()}|${entry.query}`));
  if (!newEntries.length) return;

  const firstWriteRow = lastRow + 1;
  const requiredLastRow = firstWriteRow + newEntries.length - 1;
  ensureRowsForWrite(sheet, requiredLastRow);

  sheet.getRange(firstWriteRow, 1, newEntries.length, 2).setValues(
    newEntries.map(entry => [
      new Date(entry.capturedAt),
      entry.query,
    ]),
  );
  sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss.000');
}

function ensureRowsForWrite(sheet, requiredLastRow) {
  const currentMaxRows = sheet.getMaxRows();
  const spareRowsAfterWrite = currentMaxRows - requiredLastRow;
  if (spareRowsAfterWrite >= 1000) return;
  const rowsToAdd = Math.max(1000, requiredLastRow - currentMaxRows + 1000);
  sheet.insertRowsAfter(currentMaxRows, rowsToAdd);
}

function jsonResponse(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
