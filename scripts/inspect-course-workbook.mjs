import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const input = '/Users/apewin/Downloads/课程安排表.xlsx';
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
const summary = await workbook.inspect({
  kind: 'workbook,sheet,table',
  maxChars: 12000,
  tableMaxRows: 20,
  tableMaxCols: 20,
  tableMaxCellChars: 100,
});
console.log(summary.ndjson);
for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange(true);
  if (!used) continue;
  console.log(`--- ${sheet.name} ${used.address} ---`);
  console.log(JSON.stringify(used.values));
}
