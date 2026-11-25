const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../../../shared/appointment-api.js'),'utf8');
const c={window:{},escapeHtml:String};vm.createContext(c);
vm.runInContext(source.slice(source.indexOf('  window.additionalRequirementHtml='),source.indexOf('  window.showAdditionalRequirementFile=')),c);
const task={id:'t1',text:'Submit missing requirements',completed:false,updatedAt:'2026-11-25T00:00:00Z'};
const appt={id:'a1',shared:true,status:'Booked',followUpTasks:[task],attachments:[]};
test('upload appears only for an outstanding missing-requirement task',()=>{
 assert.match(c.window.additionalRequirementHtml(appt),/Submit a missing requirement/);
 assert.equal(c.window.additionalRequirementHtml({...appt,followUpTasks:[]}), '');
 assert.equal(c.window.additionalRequirementHtml({...appt,followUpTasks:[{...task,completed:true}]}), '');
});
test('submitted file hides its task upload even after the task is edited',()=>{
 const sent={additional:true,followUpTaskId:'t1',uploadedAt:'2026-11-25T01:00:00Z'};
 assert.equal(c.window.additionalRequirementHtml({...appt,attachments:[sent],followUpTasks:[{...task,updatedAt:'2026-11-26T00:00:00Z'}]}), '');
 assert.match(c.window.additionalRequirementHtml({...appt,attachments:[{...sent,followUpTaskId:'another'}]}),/Submit a missing requirement/);
});
