const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../User/user.js'),'utf8');
test('walk-in option enables only after server confirms capacity',async()=>{
 const button={disabled:true},status={};let accepting=false,fail=false;
 const c={document:{getElementById:id=>id==='walkInEntryButton'?button:status},isOfficeHours:()=>true,UniServeUX:{request:async()=>{if(fail)throw Error('Offline');return {accepting,message:'Daily capacity reached'};}}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('async function refreshWalkInEntryAvailability()'),source.indexOf('function selectedBarHtml(')),c);
 await c.refreshWalkInEntryAvailability();assert.equal(button.disabled,true);assert.equal(status.textContent,'Daily capacity reached');
 accepting=true;await c.refreshWalkInEntryAvailability();assert.equal(button.disabled,false);
 fail=true;await c.refreshWalkInEntryAvailability();assert.equal(button.disabled,true);assert.match(status.textContent,/could not be verified/);
});
test('closed walk-in attempts return to entry methods without a booking modal',async()=>{
 let rendered=0;const c={isOfficeHours:()=>false,renderVisitChoose:()=>rendered++};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('async function startWalkIn()'),source.indexOf('function renderVisitWalkinForm()')),c);
 await c.startWalkIn();assert.equal(rendered,1);
});
