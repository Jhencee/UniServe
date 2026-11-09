// Run with a headless Chrome CDP endpoint on 9224. Uses isolated API fixtures only.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const out = path.resolve(__dirname, '../../storage/app/private/responsive-checks');
fs.mkdirSync(out, {recursive:true});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const widths = [320,360,390,430,600,768,820,880,881,960,961,980,1024,1250,1280,1399,1440,1920,2560];
const viewports = [...widths.map(width=>({width,height:width<600?844:900})),{width:568,height:320},{width:844,height:390},{width:1024,height:600},{width:640,height:450}];
const settings = {orgName:'Office of Student Services',sessionTimeout:120,maintenanceMode:false,gracePeriodMinutes:15,noShowThresholdMinutes:60,appointmentSlotCapacity:1,allowParallelService:false};
const services = [{key:'good_moral',label:'Good Moral Character',desc:'Request a certification of good moral character.',icon:'cap',requirements:['Student identification card','Completed request form'],active:true}];
const appointments = [{id:'fixture-a',visitId:'VIS-RESPONSIVE',code:'APT-TEST',name:'Responsive Test Visitor',email:'visitor@example.test',type:'Student',service:services[0].label,serviceKey:'good_moral',status:'Requested',date:'2026-11-10',time:'10:00',createdAt:new Date().toISOString(),revision:0,shared:true,attachments:[]}];
const calendar = {revision:0,weekly:Array.from({length:7},(_,i)=>({open:i>0&&i<6,start:'08:00',end:'17:00'})),lunch:{enabled:true,start:'12:00',end:'13:00'},days:{}};
function fixture(url, user) {
  const endpoint = new URL(url).pathname;
  if(endpoint.endsWith('/settings')) return {settings,revision:0};
  if(endpoint.endsWith('/services')) return {services};
  if(endpoint.endsWith('/appointments')) return {appointments};
  if(endpoint.endsWith('/calendar')) return {calendar};
  if(endpoint.endsWith('/admins')) return {users:user?[user]:[]};
  if(endpoint.endsWith('/reports')) return {activityLog:[],transactions:[],appointments,queues:[]};
  if(endpoint.endsWith('/service-records')) return {transactions:[],visitorLog:[]};
  if(endpoint.endsWith('/queue')) return {queues:[]};
  if(endpoint.endsWith('/chats')) return {chats:[]};
  if(endpoint.endsWith('/audit')) return {data:[],current_page:1,last_page:1,total:0};
  if(endpoint.endsWith('/realtime/config')) return {enabled:false};
  if(endpoint.endsWith('/appointment-offices')) return {offices:['Office of Student Services']};
  if(endpoint.endsWith('/walk-in-capacity')) return {accepting:true};
  return {};
}
async function page(user) {
  const target = await (await fetch('http://127.0.0.1:9224/json/new?about:blank',{method:'PUT'})).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(), errors=[];
  let serial=0;
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
  });
  ws.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(message.id){const task=pending.get(message.id);pending.delete(message.id);message.error?task?.reject(Error(JSON.stringify(message.error))):task?.resolve(message.result);}
    if(message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
    if(message.method==='Fetch.requestPaused') send('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from(JSON.stringify(fixture(message.params.request.url,user))).toString('base64')}).catch(console.error);
  };
  await send('Page.enable');await send('Runtime.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:'*/api/*'}]});
  const db={users:user?[user]:[],services,transactions:[],appointments,chats:[],activityLog:[],queues:[],queueCounters:{},visitorLog:[],visitCounter:0,systemSettings:settings,sampleDataRemovedV2:true};
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.UNISERVE_API_BASE='http://127.0.0.1:8765/api';localStorage.clear();sessionStorage.clear();localStorage.setItem('ossuniserve_db_v1',${JSON.stringify(JSON.stringify(db))});${user?`sessionStorage.setItem('ossuniserve_session',${JSON.stringify(JSON.stringify({currentUser:user,token:'responsive-fixture'}))});`:''}`});
  const run=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  return {send,run,errors,
    goto:async url=>{await send('Page.navigate',{url:'http://127.0.0.1:8765'+url});await pause(600);for(let i=0;i<40;i++){if(await run("document.readyState==='complete'"))break;await pause(100);}},
    close:async()=>{await send('Page.close');ws.close();},
    screenshot:async name=>{const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(result.data,'base64'));}
  };
}
const geometry=`(()=>{
 const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!el.closest('[hidden],[aria-hidden="true"],.skip-link,.sidebar:not(.open)')};
 const viewport=document.documentElement.clientWidth;
 const overflow=[...document.querySelectorAll('body *')].filter(visible).filter(el=>{
   const r=el.getBoundingClientRect();
   if(r.right<=viewport+1&&r.left>= -1)return false;
   for(let parent=el.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
     const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
     if(/auto|scroll|hidden|clip/.test(style.overflowX)&&(r.right>bounds.right+1||r.left<bounds.left-1))return false;
   }
   return true;
 }).slice(0,12).map(el=>({tag:el.tagName,cls:el.className,right:Math.round(el.getBoundingClientRect().right),width:Math.round(el.getBoundingClientRect().width)}));
 const bar=document.querySelector('.svc-selected-bar'),button=bar?.querySelector('button'),label=bar?.querySelector('.lbl');
 const modal=document.querySelector('#activeModal > .modal'),rect=modal?.getBoundingClientRect();
 const nav=document.querySelector('.landing-nav'),navRect=nav?.getBoundingClientRect(),actions=document.getElementById('navActions'),brand=nav?.querySelector('.brandline');
 const desktopHeaderFits=!navRect?.width||innerWidth<961||(getComputedStyle(document.getElementById('navToggle')).display==='none'&&getComputedStyle(actions).display!=='none'&&Math.abs(actions.getBoundingClientRect().top+actions.getBoundingClientRect().height/2-brand.getBoundingClientRect().top-brand.getBoundingClientRect().height/2)<2);
 return {viewport,scroll:document.documentElement.scrollWidth,overflow,desktopHeaderFits,buttonBesideLabel:!button||button.getBoundingClientRect().left>=label.getBoundingClientRect().right-1,modalFits:!rect||(rect.top>=-1&&rect.bottom<=innerHeight+1)};
})()`;
async function main(){
 const server=http.createServer((req,res)=>{
   const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
   if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
   fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data);});
 });
 await new Promise(resolve=>server.listen(8765,'127.0.0.1',resolve));
 const results=[];
 try{
  for(const portal of ['landing','visitor','admin','super']){
   if(process.argv.some(arg=>arg.startsWith('--portal='))&&!process.argv.includes('--portal='+portal))continue;
   const user=['admin','super'].includes(portal)?{id:'responsive-fixture',username:'fixture',fullName:'Responsive Test Administrator',role:portal==='super'?'SUPER_ADMIN':'ADMIN',active:true,confidentialAccess:true,confidentialApprover:true}:null;
   const p=await page(user);
   try{
    await p.goto(({landing:'/Landing/landing.html',visitor:'/User/user.html',admin:'/Admin/admin.html',super:'/Super%20Admin/superadmin.html'})[portal]);
    const screens=({landing:['home','menu','login','queue'],visitor:['home','services','choose','walkin','appointment','lookup','calendar-modal'],admin:['dashboard','queue','appointments','calendar','transactions','logbook','messages','services','reports','feedback','profile','appointment-modal'],super:['dashboard','users','reports','settings','activitylog','profile','calendar-modal']})[portal];
    for(const screen of screens){
     if(portal==='landing')await p.run(screen==='menu'?"showScreen('landing');toggleNav()":screen==='login'?"showScreen('loginScreen')":screen==='queue'?"showScreen('landing');openPublicDisplay()":"showScreen('landing')");
     else if(portal==='visitor'){
      await p.run("closeModal();showVisitorHub()");
      if(screen!=='home')await p.run(screen==='calendar-modal'?"UniServeUX.visitorCalendar()":screen==='lookup'?"navigateVisitor('checkvisit')":`navigateVisitor('visit');visitVisitorType='Student';visitSelectedService=findService(loadDB(),'good_moral');${screen==='services'?'':screen==='choose'?'renderVisitChoose()':screen==='walkin'?'renderVisitWalkinForm()':'renderVisitScheduleForm()'}`);
     }else {
      await p.run("closeModal()");
      await p.run(screen==='calendar-modal'?"UniServeUX.visitorCalendar()":screen==='appointment-modal'?"openApptDetail('fixture-a',true)":`navigate('${screen}')`);
     }
     await pause(160);
     for(const {width,height} of viewports){
      await p.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:width<600?3:1,mobile:width<600});await pause(35);
      const result=await p.run(geometry);results.push({portal,screen,width,height,...result});
      if(process.argv.includes('--screenshots')&&height>600&&[390,820,980,1280].includes(width)&&['home','appointment','walkin','queue','dashboard','settings'].includes(screen)){await pause(250);await p.screenshot(`${portal}-${screen}-${width}`);}
     }
    }
    if(portal==='landing'){
     // Model the initial 980px layout viewport exposed by a phone's Desktop site mode.
     await p.send('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(window,'innerWidth',{configurable:true,value:980});document.addEventListener('DOMContentLoaded',()=>{delete window.innerWidth;},{once:true});"});
     await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
     await p.send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:3,mobile:true});
     await p.goto('/Landing/landing.html');await pause(300);
     assert.equal(await p.run("document.querySelector('meta[name=viewport]').content"),'width=1440');
     assert.equal(await p.run("document.documentElement.clientWidth"),1440);
     assert.equal(await p.run("getComputedStyle(document.querySelector('.brand-title')).fontSize"),'24px');
     assert.equal(await p.run("document.querySelector('#crestSlotA img').getBoundingClientRect().width"),52);
     assert.equal(await p.run("getComputedStyle(document.getElementById('navToggle')).display"),'none');
     assert.equal(await p.run("getComputedStyle(document.querySelector('.nav-link')).fontSize"),'13.12px');
     if(process.argv.includes('--screenshots'))await p.screenshot('landing-phone-exact-desktop');
    }
    if(user){
     await p.run('closeModal()');
     for(const width of [320,820]){
      await p.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await pause(250);
      await p.run("document.querySelector('.menu-btn').click()");await pause(250);
      assert.ok(await p.run("document.querySelector('.sidebar').classList.contains('open')&&!document.querySelector('.mobile-drawer-backdrop').hidden"),`${portal} drawer opens at ${width}`);
      await p.run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await pause(250);
      assert.ok(await p.run("!document.querySelector('.sidebar').classList.contains('open')&&document.querySelector('.mobile-drawer-backdrop').hidden"),`${portal} drawer closes at ${width}`);
     }
    }
    assert.deepEqual(p.errors,[],`${portal} JavaScript errors`);
   }finally{await p.close();}
  }
 }finally{await new Promise(resolve=>server.close(resolve));}
 const failures=results.filter(result=>result.scroll>result.viewport+1||result.overflow.length||!result.buttonBesideLabel||!result.modalFits||!result.desktopHeaderFits);
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks:results.length,failures,results},null,2));
 console.log(JSON.stringify({checks:results.length,failures:failures.map(({portal,screen,width,height,scroll,overflow,buttonBesideLabel,modalFits})=>({portal,screen,width,height,scroll,overflow,buttonBesideLabel,modalFits}))},null,2));
 if(!process.argv.includes('--audit'))assert.equal(failures.length,0,'Responsive layout failures; see responsive-checks/results.json');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
