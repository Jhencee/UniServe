const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../shared/appointment-api.js'),'utf8');
test('late transaction failures do not show confidential errors on Messages',async()=>{
 let reject;const alerts=[],c={state_view:'transactions',records:()=>new Promise((_,r)=>reject=r),escapeHtml:String,toast:message=>alerts.push(message),originalTransactions:()=>{throw Error('Stale screen rendered');}};
 vm.createContext(c);const line=source.split('\n').find(line=>line.includes('renderTransactions=async function'));vm.runInContext(line,c);
 const pending=c.renderTransactions();c.state_view='messages';reject(Error('Confidential case access and an active unlock are required.'));await pending;assert.deepEqual(alerts,[]);
 const active=c.renderTransactions();c.state_view='transactions';reject(Error('Record access denied.'));await active;assert.deepEqual(alerts,['Record access denied.']);
});
