const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../User/visitor-actions.js'),'utf8');
function setup(fail=false){
 const calls={},style={setProperty:()=>{}},copy={style,querySelectorAll:()=>[]};
 const ticket={getBoundingClientRect:()=>({width:300,height:500}),cloneNode:()=>copy,querySelectorAll:()=>[],querySelector:()=>({textContent:'VIS-TEST'})};
 const link={click:()=>calls.clicked=true,remove:()=>{}};
 const canvas={getContext:()=>({fillRect:()=>{},drawImage:()=>calls.drawn=true}),toBlob:(callback,mime)=>{calls.mime=mime;callback(fail?null:{type:mime});}};
 const context={window:{},document:{fonts:{ready:Promise.resolve()},querySelector:()=>ticket,createElement:tag=>tag==='canvas'?canvas:link,createElementNS:()=>({setAttribute:()=>{},appendChild:()=>{}}),body:{appendChild:()=>{}}},getComputedStyle:()=>({fontFamily:'Arial',[Symbol.iterator]:function*(){}}),XMLSerializer:class{serializeToString(){return '<svg/>';}},Image:class{set src(value){this.onload();}},URL:{createObjectURL:blob=>{calls.blob=blob;return 'blob:png';},revokeObjectURL:()=>{}},encodeURIComponent,setTimeout:callback=>callback(),toast:message=>calls.error=message};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('// Rasterize')),context);
 return {context,calls,link,canvas};
}
test('ticket download rasterizes at double resolution and saves image/png',async()=>{
 const {context,calls,link,canvas}=setup(),button={disabled:false,isConnected:true};await context.window.downloadVisitorTicket(button);
 assert.equal(calls.mime,'image/png');assert.equal(calls.blob.type,'image/png');assert.equal(link.download,'UniServe-VIS-TEST.png');assert.equal(canvas.width,600);assert.equal(canvas.height,1000);assert.equal(calls.drawn,true);assert.equal(calls.clicked,true);assert.equal(button.disabled,false);assert.equal(calls.error,undefined);
});
test('failed PNG encoding reports an error and restores the download button',async()=>{
 const {context,calls}=setup(true),button={disabled:false,isConnected:true};await context.window.downloadVisitorTicket(button);
 assert.match(calls.error,/Could not save/);assert.equal(button.disabled,false);assert.equal(calls.clicked,undefined);
});
