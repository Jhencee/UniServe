const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const admin=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
const access=fs.readFileSync(path.resolve(__dirname,'../../../Admin/confidential-access.js'),'utf8');
test('expired confidential access locks the record even when its transaction table is absent',()=>{
 const timers=[],c={document:{getElementById:()=>null},confUnlocked:new Map([['case',true]]),confTimers:{case:1},clearTimeout:id=>timers.push(id),state_view:'transactions'};
 vm.createContext(c);
 vm.runInContext(admin.slice(admin.indexOf('function renderTxnTable()'),admin.indexOf('function closeKebabs()')),c);
 vm.runInContext(admin.slice(admin.indexOf('function lockConfTxn('),admin.indexOf('function maskName(')),c);
 assert.doesNotThrow(()=>c.lockConfTxn('case'));assert.equal(c.confUnlocked.has('case'),false);assert.equal(c.confTimers.case,undefined);assert.deepEqual(timers,[1]);
});
test('access tab callbacks safely stop after their panel is removed',()=>{
 const c={window:{},accessData:{requests:[],cases:[]},document:{getElementById:()=>null},selectAccessTab:()=>{throw Error('Missing panel should not render');}};
 vm.createContext(c);
 vm.runInContext(access.slice(access.indexOf('  window.paintConfidentialRequests ='),access.indexOf('  window.assignConfidentialCase =')),c);
 assert.doesNotThrow(()=>c.window.paintConfidentialRequests());assert.doesNotThrow(()=>c.window.paintConfidentialAssignments());
});
