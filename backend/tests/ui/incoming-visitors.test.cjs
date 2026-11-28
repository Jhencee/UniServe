const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
test('notifies only for new arrivals after the initial queue snapshot',()=>{
 const elements=new Map();const document={getElementById:id=>elements.get(id),createElement:()=>({setAttribute(){},hidden:false}),body:{appendChild(el){elements.set(el.id,el);}}};
 const c={document,setTimeout:()=>1,clearTimeout:()=>{}};vm.createContext(c);
 vm.runInContext(src.slice(src.indexOf('let arrivalNoticeInitialized='),src.indexOf('let sharedQueueWrites =')),c);
 c.notifyIncomingVisitors([{id:'old',status:'Waiting'}]);assert.equal(elements.size,0);
 c.notifyIncomingVisitors([{id:'old',status:'Waiting'},{id:'new',status:'Waiting'}]);assert.match(elements.get('incomingVisitorNotice').textContent,/joined the queue/);
 elements.get('incomingVisitorNotice').textContent='unchanged';c.notifyIncomingVisitors([{id:'new',status:'Waiting'}]);assert.equal(elements.get('incomingVisitorNotice').textContent,'unchanged');
});
