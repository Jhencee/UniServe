const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('settings markers track changed sections and clear only after a successful save',()=>{
 const input={type:'text',value:'Office'},classes=new Set(),status={textContent:''};
 const block={querySelectorAll:()=>[input],classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name),remove:name=>classes.delete(name)}};
 const host={querySelectorAll:()=>[block],querySelector:()=>classes.size?block:null};
 const c={document:{getElementById:id=>id==='superSettings'?host:status,querySelectorAll:()=>[block]}};
 vm.createContext(c);const source=fs.readFileSync(path.resolve(__dirname,'../../../Super Admin/super-admin.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('function watchSuperSettings()'),source.indexOf('function renderSettings()')),c);
 c.watchSuperSettings();input.value='Updated office';input.oninput();assert.equal(status.textContent,'Unsaved changes');
 input.value='Office';input.oninput();assert.equal(status.textContent,'No unsaved changes');
 input.value='Updated office';input.oninput();c.markSuperSettingsSaved();assert.equal(classes.size,0);assert.equal(status.textContent,'All settings saved');
 input.oninput();assert.equal(classes.size,0);
});
