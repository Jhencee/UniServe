const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
for(const file of ['Admin/admin.js','User/user.js','Super Admin/super-admin.js','Landing/landing.js'])test(file+' displays Philippine office time independent of device time zone',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../../..',file),'utf8');const context={Date,Intl};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('const officeTimeParts ='),source.indexOf('const today ='))+'\nthis.showDate=fmtDate; this.showTime=fmtTime;',context);
 assert.equal(context.showDate('2026-11-20T16:05:00Z'),'2026-11-21');assert.equal(context.showTime('2026-11-20T16:05:00Z'),'12:05 AM');
});
