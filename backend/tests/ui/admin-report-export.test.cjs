const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('Admin report exports plain Excel with details while keeping confidential records count-only',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');let result;
 const db={services:[{key:'general',label:'General'}],transactions:[{code:'PUBLIC',name:'Visitor',service:'general',status:'Completed',createdAt:new Date('2026-10-20')},{code:'PRIVATE',name:'Secret name',service:'private',status:'Pending',createdAt:new Date('2026-10-20')}],chats:[]};
 const c={loadDB:()=>db,periodStart:()=>new Date('2026-10-01'),reportPeriod:'Monthly',today:()=> '2026-10-20',fmtDate:()=> '2026-10-20',fmtDateTime:()=> '2026-10-20 10:00 AM',currentUser:{fullName:'Admin'},isConfidentialTxn:t=>t.service==='private',serviceLabel:()=> 'General',SpreadsheetExport:{download:(filename,rows,widths,options)=>result={filename,rows,options}},logActivity(){},saveDB(){},toast(){}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function downloadReportExcel()'),source.indexOf('function renderProfile()')),c);c.downloadReportExcel();
 assert.ok(result.filename.endsWith('.xlsx'));assert.equal(result.options.sheetName,'Admin Report');
 assert.ok(result.rows.some(row=>row[0]==='PUBLIC'));assert.ok(!JSON.stringify(result.rows).includes('Secret name'));assert.ok(!result.rows.some(row=>row[0]==='PRIVATE'));
 assert.ok(result.rows.some(row=>row[0]==='Records not listed (count only)'&&row[1]===1));
});
