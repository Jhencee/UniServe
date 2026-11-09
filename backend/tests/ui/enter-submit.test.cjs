const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../shared/ui-components.js'),'utf8');
const start=source.indexOf('// Supply Enter submission');
const end=source.indexOf("document.addEventListener('keydown'",source.indexOf("document.addEventListener('keydown'",start)+1);
function setup(){
 let handler,clicks=0,prevented=0;
 const action={getClientRects:()=>[{}],closest:()=>null,matches:()=>true,click:()=>clicks++,getAttribute:()=>null};
 const modal={contains:()=>true,dataset:{},querySelectorAll:()=>[action]};
 const input={matches:()=>true,type:'text',closest:()=>null};
 const document={addEventListener:(_,fn)=>handler=fn,getElementById:()=>modal};
 vm.runInNewContext(source.slice(start,end),{document});
 const press=(extra={})=>handler({key:'Enter',target:input,preventDefault:()=>prevented++,...extra});
 return {action,modal,input,press,counts:()=>[clicks,prevented]};
}
test('Enter activates verification once and suppresses default submission',()=>{const s=setup();s.press();assert.deepEqual(s.counts(),[1,1]);});
test('disabled and busy verification actions cannot submit',()=>{for(const busy of [false,true]){const s=setup();if(busy)s.modal.dataset.busy='true';else s.action.disabled=true;s.press();assert.equal(s.counts()[0],0);}});
test('preserves native forms, existing handlers, multiline input and modified Enter',()=>{
 for(const change of [s=>s.input.form={},s=>s.input.closest=()=>({}),s=>s.input.matches=()=>false]){const s=setup();change(s);s.press();assert.deepEqual(s.counts(),[0,0]);}
 for(const event of [{defaultPrevented:true},{repeat:true},{isComposing:true},{shiftKey:true},{ctrlKey:true},{key:'Escape'}]){const s=setup();s.press(event);assert.deepEqual(s.counts(),[0,0]);}
});
