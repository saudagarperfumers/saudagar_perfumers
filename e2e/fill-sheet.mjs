// Fills product rows into a downloaded product sheet, as the person filling it in would. Run with plain node
// (Playwright's test loader can't load ExcelJS): node e2e/fill-sheet.mjs <in.xlsx> <out.xlsx> '<rows as JSON>'
// A value of "$first-category" is replaced by the first category on the Choices tab. Prints the tab names and that
// category as JSON.
import ExcelJS from 'exceljs';

const [, , input, output, json] = process.argv;
const rows = JSON.parse(json);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(input);
const category = String(wb.getWorksheet('Choices').getCell(2, 1).value ?? '');
const ws = wb.getWorksheet('Products');
const columns = new Map();
ws.getRow(2).eachCell((cell, n) => columns.set(String(cell.value), n));
rows.forEach((row, i) => {
  for (const [header, value] of Object.entries(row)) {
    const n = columns.get(header);
    if (!n) throw new Error(`No column “${header}” on the Products tab`);
    ws.getCell(4 + i, n).value = value === '$first-category' ? category : value;
  }
});
await wb.xlsx.writeFile(output);
console.log(JSON.stringify({ tabs: wb.worksheets.map((w) => w.name), category }));
