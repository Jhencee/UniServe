const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../shared/appointment-api.js'),'utf8');
function setup(findVisit){
 const calls=[],errors=[],rendered=[];const c={lookupMyVisit:null,document:{getElementById:()=>({value:'VIS-1234'})},normVisitRef:v=>v,visitorFormError:message=>errors.push(message),escapeHtml:String,myActiveQueueId:null,persistSession(){},renderQueueTicket:()=>rendered.push('queue'),showPassModalReadonly:()=>rendered.push('appointment'),visitorRequest:async url=>{calls.push(url);if(url.startsWith('/appointments'))throw Object.assign(Error('Not found'),{status:404});return findVisit();}};
 vm.createContext(c);const start=source.indexOf('    lookupMyVisit=async function(){'),end=source.indexOf('\n  }\n})();',start);vm.runInContext(source.slice(start,end),c);return {c,calls,errors,rendered};
}
test('walk-in lookup uses the current server visit after an appointment is not found',async()=>{const {c,calls,rendered}=setup(()=>({queue:{id:'queue-1'}}));await c.lookupMyVisit();assert.deepEqual(calls,['/appointments/visit/VIS-1234','/visits/VIS-1234']);assert.equal(c.myActiveQueueId,'queue-1');assert.deepEqual(rendered,['queue']);});
test('a missing server visit is not replaced with a stale cached appointment',async()=>{const {c,errors,rendered}=setup(()=>{throw Object.assign(Error('Not found'),{status:404});});await c.lookupMyVisit();assert.match(errors[0],/No visit found/);assert.deepEqual(rendered,[]);});
