// Keep authenticated personal data in this tab's memory, not browser-local storage.
(function(){
  const originalLoad=loadDB,originalSave=saveDB;
  const memory={appointments:new Map(),queues:new Map(),visitorLog:new Map()};
  const serviceExamples=new Map();
  const fields={appointments:['id','visitId','code','service','serviceKey','status','date','time','queueId','revision','shared','createdAt'],queues:['id','visitId','number','serviceKey','serviceLabel','source','status','scheduledAt','queueEnteredAt','createdAt','calledAt','servingAt','completedAt','assignedAdminId','assignedAdminName','recallCount','recalledAt','isSenior','isPWD','shared'],visitorLog:['id','visitId','timeIn','timeOut','source','shared']};
  function uniqueQueues(rows){
    const result=[],ids=new Map(),visits=new Map();
    for(const row of rows||[]){
      const index=ids.has(row.id)?ids.get(row.id):(row.visitId&&visits.has(row.visitId)?visits.get(row.visitId):undefined);
      if(index===undefined){const next=result.length;result.push(row);ids.set(row.id,next);if(row.visitId)visits.set(row.visitId,next);}
      else {if(row.shared||!result[index].shared)result[index]=row;ids.set(row.id,index);if(row.visitId)visits.set(row.visitId,index);}
    }
    return result;
  }
  function snapshot(db){
    db={...db,queues:uniqueQueues(db.queues)};
    const copy={...db};
    copy.services=(db.services||[]).map(service=>{
      if(!Array.isArray(service.examples))return service;
      const previous=serviceExamples.get(service.key)||[];
      const examples=service.examples.map((file,index)=>file.dataUrl?file:(previous[index]?.name===file.name?previous[index]:file));
      serviceExamples.set(service.key,examples);
      return {...service,examples:examples.map(({dataUrl,...metadata})=>metadata)};
    });
    for(const key of Object.keys(memory))copy[key]=(db[key]||[]).map(record=>{
      if(!record.shared)return record;
      if(!record.privateCached)memory[key].set(record.id,{...record});
      return {...Object.fromEntries(fields[key].filter(k=>record[k]!==undefined).map(k=>[k,record[k]])),privateCached:true,name:'Restricted record',type:'',attachments:[]};
    });
    return copy;
  }
  loadDB=function(){const db=originalLoad();for(const key of Object.keys(memory))db[key]=(db[key]||[]).map(record=>{const saved=memory[key].get(record.id);if(!saved)return record.privateCached?{...record,restricted:true}:record;return {...saved,...(record.attachments?.some(f=>f.dataUrl)?{attachments:record.attachments}:{})};});db.services=(db.services||[]).map(service=>({...service,examples:(service.examples||[]).map((file,index)=>serviceExamples.get(service.key)?.[index]?.name===file.name?serviceExamples.get(service.key)[index]:file)}));db.queues=uniqueQueues(db.queues);return db;};
  saveDB=function(db){originalSave(snapshot(db));};
  window.SecureState={persist:function(db){localStorage.setItem(DB_KEY,JSON.stringify(snapshot(db)));},clear:function(){for(const store of Object.values(memory))store.clear();}};
  SecureState.persist(originalLoad());
  if(typeof visitorView!=='undefined'){
    const originalTicket=renderQueueTicket;
    let ticketRefreshInFlight=false;
    renderQueueTicket=async function(queueAlreadyRefreshed=false,background=false){if(ticketRefreshInFlight)return false;ticketRefreshInFlight=true;try{const selectedId=myActiveQueueId,navigation=visitorNavigationVersion,q=loadDB().queues.find(q=>q.id===selectedId);if(!q?.shared){await originalTicket(queueAlreadyRefreshed,background);return false;}const result=await SharedAppointments.visitorRequest('/visits/'+encodeURIComponent(q.visitId));if(result&&myActiveQueueId===selectedId&&visitorNavigationVersion===navigation&&!visitorHubOpen){await originalTicket(true,background);return true;}return false;}catch(e){toast(escapeHtml(e.message),'err');return false;}finally{ticketRefreshInFlight=false;}};
    document.querySelector('.sidebar-foot')?.addEventListener('click',event=>{if(event.target.closest('a,button')&&!event.target.closest('.a11y-read-btn')){for(const key of Object.keys(sessionStorage))if(/visitor_token|chat-token:|visit-token:|oss_activeAppointment|oss_visit|ossuniserve_publicChat/i.test(key))sessionStorage.removeItem(key);SecureState.clear();}});
  }
})();
