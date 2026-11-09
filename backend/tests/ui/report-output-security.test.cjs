const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
test('report timing averages preserve seconds and exclude missing measurements',()=>{
 const c={};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function averageReportMetric('),source.indexOf('\n}',source.indexOf('function averageReportMetric('))+2),c);
 assert.equal(c.averageReportMetric([{wait:0.2},{wait:0.4},{wait:null},{},{wait:NaN},{wait:-1}], 'wait'),0.30000000000000004);
 assert.equal(c.averageReportMetric([{wait:null}], 'wait'),null);
});
test('print snapshots restore cached data and cannot be saved to browser storage',async()=>{
 const original={transactions:[{name:'Redacted'}]},snapshot={transactions:[{name:'Authorized private detail'}]};let saved=0,printed=false;
 const c={loadDB:()=>original,saveDB:()=>saved++,reviveDates(){},SharedAppointments:{request:async()=>snapshot},document:{getElementById:()=>null},toast:()=>assert.fail('unexpected failure')};const originalLoad=c.loadDB;
 vm.createContext(c);vm.runInContext(source.slice(0,source.indexOf('function averageReportMetric(')),c);
 await c.authorizedReportOutput({kind:'combined',includeConf:true},()=>{assert.equal(c.loadDB().transactions[0].name,'Authorized private detail');c.saveDB(c.loadDB());printed=true;});
 assert.ok(printed);assert.equal(saved,0);assert.equal(c.loadDB,originalLoad);assert.equal(original.transactions[0].name,'Redacted');
});
test('failed server authorization never calls the renderer',async()=>{
 let rendered=false;const c={SharedAppointments:{request:async()=>{throw Error('Locked');}},toast:()=>{}};vm.createContext(c);vm.runInContext(source.slice(0,source.indexOf('function averageReportMetric(')),c);
 await c.authorizedReportOutput({kind:'combined',includeConf:true},()=>rendered=true);assert.equal(rendered,false);
});

test('restricted transaction cache retains safe timing metrics and preserves mixed report averages',()=>{
 const api=fs.readFileSync(path.resolve(__dirname,'../../../shared/appointment-api.js'),'utf8');
 const c={attachmentCache:new Map(),privateRecords:new Map(),versionCache:new Map()};vm.createContext(c);
 vm.runInContext(api.slice(api.indexOf('  function snapshot(db)'),api.indexOf('  saveDB=function')),c);
 vm.runInContext(source.slice(source.indexOf('function averageReportMetric('),source.indexOf('\n}',source.indexOf('function averageReportMetric('))+2),c);
 const ordinary={id:'public',service:'general',shared:true,waitingTimeMin:2,serviceTimeMin:0,totalTimeMin:2};
 const confidential={id:'private',service:'custom_private',shared:true,restricted:true,completedAt:'2026-10-23T10:00:00Z',waitingTimeMin:8,serviceTimeMin:0.5,totalTimeMin:8.5,name:'PRIVATE NAME',email:'PRIVATE EMAIL',contact:'PRIVATE CONTACT',visitId:'PRIVATE VISIT',attachments:[{dataUrl:'PRIVATE FILE'}],notes:'PRIVATE NOTES'};
 const original={services:[{key:'custom_private',confidential:true}],appointments:[],transactions:[ordinary,confidential,{id:'missing',service:'general',shared:true,totalTimeMin:null}]};
 const cached=JSON.parse(JSON.stringify(c.snapshot(original))),refreshed=c.snapshot(cached);
 for(const rows of [cached.transactions,refreshed.transactions]){
  for(const key of ['waitingTimeMin','serviceTimeMin','totalTimeMin'])assert.equal(c.averageReportMetric(rows,key),c.averageReportMetric(original.transactions,key));
  assert.equal(c.averageReportMetric(rows,'waitingTimeMin'),5);assert.equal(c.averageReportMetric(rows,'serviceTimeMin'),0.25);
  assert.equal(rows[1].completedAt,confidential.completedAt);assert.equal(rows[1].restricted,true);assert.equal(rows[1].name,'Restricted record');
 }
 assert.ok(!JSON.stringify(refreshed).includes('PRIVATE'));
 assert.equal(c.privateRecords.has('private'),false);
});
