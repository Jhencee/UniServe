const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
function setup(head){let modal,unlocks=0,printed=[];const c={currentUser:{confidentialApprover:head},closeModal(){},openModal:(title,body,buttons)=>modal={title,body,buttons},requireConfUnlock:(gate,cb,scope)=>{assert.equal(scope,'print');unlocks++;c.unlocked=cb;}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function askIncludeConf('),source.indexOf('function printTxnReport(')),c);c.askIncludeConf(0,value=>printed.push(value));return {c,get modal(){return modal;},get unlocks(){return unlocks;},printed};}
test('Reports always offers redacted output and Head Admin password unlock before confidential printing',()=>{const s=setup(true);assert.equal(s.modal.title,'Print report');assert.deepEqual(Array.from(s.modal.buttons,b=>b.label),['Print redacted copy','Unlock and print']);assert.equal(s.printed.length,0);s.modal.buttons[0].action();assert.deepEqual(s.printed,[false]);s.modal.buttons[1].action();assert.equal(s.unlocks,1);assert.deepEqual(s.printed,[false]);s.c.unlocked();assert.deepEqual(s.printed,[false,true]);});
test('regular Admin combined report offers redacted output only',()=>{const s=setup(false);assert.equal(s.modal.buttons.length,1);s.modal.buttons[0].action();assert.deepEqual(s.printed,[false]);assert.equal(s.unlocks,0);});


test('confidential service reports offer redacted output and preserve the selected print scope',()=>{
 let choice,output;const db={services:[{key:'incident_report',label:'Incident reports',confidential:true}],transactions:[]};
 const c={loadDB:()=>db,RANGES:{txn:{}},findService:()=>db.services[0],escapeHtml:String,rangeLabel:()=>'',CONFIDENTIAL_SERVICES:[],isConfidentialTxn:()=>true,inRange:()=>true,askIncludeConf:(count,cb,gate)=>choice={cb,gate},reportOutputActive:false,authorizedReportOutput:options=>output=options};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function printTxnReport('),source.indexOf('function printTxnReport(')+source.slice(source.indexOf('function printTxnReport(')).indexOf('\n  const all ='))+'\n}',c);
 c.printTxnReport('incident_report','txn');assert.equal(choice.gate.id,'svc:incident_report');assert.equal(output,undefined);
 choice.cb(false);assert.equal(output.includeConf,false);assert.equal(output.serviceKey,'incident_report');
 choice.cb(true);assert.equal(output.includeConf,true);
});
