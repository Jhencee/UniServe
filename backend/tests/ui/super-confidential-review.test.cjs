const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Super Admin/admin-management.js'),'utf8');
function setup(selected){
 const calls=[],messages=[];const c={document:{querySelectorAll:()=>selected},confidentialRequest:async(...args)=>calls.push(args),toast:message=>messages.push(message),openConfidentialRequests:async()=>{}};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('async function reviewConfidentialRequests('),source.indexOf('async function openConfidentialAssignment(')),c);return {c,calls,messages};
}
test('Super Admin can approve and deny pending requests or revoke active approvals',async()=>{
 for(const [decision,status] of [['Approved','Pending'],['Denied','Pending'],['Revoked','Approved']]){const {c,calls}=setup([{value:'request-1',dataset:{status}}]);await c.reviewConfidentialRequests(decision);assert.equal(calls.length,1);assert.equal(calls[0][2].decision,decision);}
});
test('mixed request statuses are rejected before making changes',async()=>{
 const {c,calls,messages}=setup([{value:'one',dataset:{status:'Pending'}},{value:'two',dataset:{status:'Approved'}}]);await c.reviewConfidentialRequests('Approved');assert.equal(calls.length,0);assert.match(messages[0],/only pending/);
});
