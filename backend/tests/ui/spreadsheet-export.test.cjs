const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function build(rows){const c={window:{},TextEncoder};vm.createContext(c);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../shared/spreadsheet-export.js'),'utf8'),c);return c.window.SpreadsheetExport.build(rows,[20,35]);}
function files(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),result={};let offset=0;while(view.getUint32(offset,true)===0x04034b50){const size=view.getUint32(offset+18,true),nameSize=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),name=Buffer.from(bytes.slice(offset+30,offset+30+nameSize)).toString('utf8');const start=offset+30+nameSize+extra;result[name]=Buffer.from(bytes.slice(start,start+size)).toString('utf8');offset=start+size;}assert.equal(view.getUint32(offset,true),0x02014b50);assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);return result;}
test('Excel export contains a real workbook with widths, wrapping, filters and frozen headers',()=>{
 const archive=files(build([['Field','After'],['Maintenance','Yes']]));
 assert.ok(archive['[Content_Types].xml']);assert.ok(archive['xl/workbook.xml']);
 assert.match(archive['xl/worksheets/sheet1.xml'],/state="frozen"/);assert.match(archive['xl/worksheets/sheet1.xml'],/width="35"/);assert.match(archive['xl/worksheets/sheet1.xml'],/autoFilter ref="A1:B2"/);
 assert.match(archive['xl/styles.xml'],/wrapText="1"/);assert.match(archive['xl/styles.xml'],/FF800000/);
});
test('spreadsheet values are escaped text rather than executable formulas',()=>{
 const archive=files(build([['Value'],['=HYPERLINK("x")'],['A & B < C']]));
 const sheet=archive['xl/worksheets/sheet1.xml'];assert.ok(sheet.includes('=HYPERLINK(&quot;x&quot;)'));assert.ok(sheet.includes('A &amp; B &lt; C'));assert.ok(!sheet.includes('<f>'));
});
