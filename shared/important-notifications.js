/* Recipient-authorized updates; only notification IDs are saved in this tab. */
(function(){
  const staff=typeof state_view!=='undefined';
  if(!staff)return;
  const host=document.querySelector('.admin-actions-panel');if(!host)return;
  const key='important-seen:'+currentUser.id;let seen=new Set();
  try{seen=new Set(JSON.parse(sessionStorage.getItem(key)||'[]'));}catch(_){}
  let items=[],busy=false,previousMaintenance;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const mark=()=>{items.forEach(n=>seen.add(n.id));sessionStorage.setItem(key,JSON.stringify([...seen].slice(-500)));paint();};
  function paint(){
    if(typeof window.refreshSidebarNotificationCount==='function'){window.refreshSidebarNotificationCount();return;}
    const badge=document.querySelector('#sidebarNotifications .notification-bell-count');
    if(badge){const previous=Number(badge.dataset.importantUpdates||0);badge.textContent=Math.max(0,Number(badge.textContent||0)-previous)+items.length;badge.dataset.importantUpdates=String(items.length);}
  }
  window.openImportantNotification=async function(id){
    const item=items.find(n=>n.id===id);if(!item)return;seen.add(id);sessionStorage.setItem(key,JSON.stringify([...seen].slice(-500)));paint();closeModal();
    if(typeof markImportantNotificationRead==='function')markImportantNotificationRead(item);
    let actionView=state_view;
    try{
      if(item.kind==='appointment'){
        navigate('appointments');actionView='appointments';const r=await SharedAppointments.request('/appointments/visit/'+encodeURIComponent(item.target));if(state_view!=='appointments')return;SharedAppointments.cache(r);openApptDetail(item.target,true);
      }else if(item.kind==='case')openTxnDetail(item.target);
      else if(item.kind==='access'){await openConfidentialAccess();viewAccessRequest(item.target);}
      else if(item.kind==='chat'){
        navigate('messages');await openStaffChat(item.target);
      }else openModal(item.title,'<p>'+escape(item.detail)+'</p>',[{label:'Done',cls:'btn-ghost',action:closeModal}]);
    }catch(e){if((state_view)===actionView)toast(escape(e.message),'err');}
  };
  async function refresh(){
    if(busy||document.visibilityState==='hidden')return;busy=true;
    try{
      const maintenance=!!loadDB().systemSettings.maintenanceMode;
      const headers={Accept:'application/json'};let authorized=false;
      if(staff){const s=JSON.parse(sessionStorage.getItem('ossuniserve_session')||'{}');if(s.token){headers.Authorization='Bearer '+s.token;authorized=true;}}
      let next=[];
      if(authorized){const response=await fetch(UniServeConfig.apiBase+'/attention',{headers,signal:AbortSignal.timeout(10000)});if(response.ok)next=(await response.json()).notifications||[];else if(response.status!==401&&response.status!==403)throw Error('Updates unavailable');}
      if(previousMaintenance!==undefined&&previousMaintenance!==maintenance){seen.delete('maintenance:active');seen.delete('maintenance:ended');}
      if(maintenance)next.unshift({id:'maintenance:active',title:'Maintenance is active',detail:'New visits are temporarily unavailable. You can still check existing visits.',kind:'system',target:''});
      else if(previousMaintenance===true||items.some(n=>n.id==='maintenance:ended'))next.unshift({id:'maintenance:ended',title:'Maintenance ended',detail:'The portal is available again.',kind:'system',target:''});
      previousMaintenance=maintenance;
      next=[...new Map(next.map(n=>[n.id,n])).values()];
      const changed=JSON.stringify(items)!==JSON.stringify(next);
      items=next;window.importantNotifications=items;paint();
      if(changed&&staff&&state_view==='notifications'&&typeof renderNotifications==='function')await renderNotifications();
    }catch(_){}finally{busy=false;}
  }
  refresh();setInterval(refresh,15000);window.addEventListener('uniserve:changed',refresh);document.addEventListener('visibilitychange',refresh);
})();
