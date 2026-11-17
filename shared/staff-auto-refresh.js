/* Staff change checks use the existing API; they never keep an idle session alive. */
(function(){
  if(typeof state_view==='undefined')return;
  const API=globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api';
  let stopped=false,busy=false,version=null,lastSuccess=0,retryAt=0;
  window.UniServeAutoRefresh={get active(){return !stopped&&lastSuccess>0&&Date.now()-lastSuccess<45000;},interval:15000};
  function notify(){window.dispatchEvent(new CustomEvent('uniserve:auto-refresh-status'));}
  async function refresh(){
    if(stopped||busy||document.visibilityState==='hidden'||Date.now()<retryAt||window.UniServeRealtime?.connected)return;
    // Do not replace dialogs or interrupt someone editing a form.
    if(document.getElementById('activeModal')||document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'))return;
    const session=JSON.parse(sessionStorage.getItem('ossuniserve_session')||'{}');
    if(!session.token)return;
    busy=true;const wasActive=window.UniServeAutoRefresh.active;
    try{
      const response=await fetch(API+'/realtime/changes',{headers:{Accept:'application/json',Authorization:'Bearer '+session.token},cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!response.ok){
        if(response.status===401||response.status===403){stop();return;}
        if(response.status===429)retryAt=Date.now()+Math.max(15,Number(response.headers.get('Retry-After'))||60)*1000;
        throw Error('Change check failed.');
      }
      const data=await response.json();if(stopped)return;
      if(typeof data.version!=='string'||!data.version)throw Error('Invalid change marker.');
      if(document.visibilityState==='hidden'||document.getElementById('activeModal')||document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'))return;
      lastSuccess=Date.now();
      if(version!==null&&version!==data.version)window.dispatchEvent(new CustomEvent('uniserve:changed',{detail:{resource:'settings'}}));
      version=data.version;
      if(!wasActive)notify();
    }catch(_){lastSuccess=0;if(wasActive)notify();}finally{busy=false;}
  }
  const timer=setInterval(refresh,15000);
  function stop(){stopped=true;lastSuccess=0;clearInterval(timer);notify();}
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
  window.addEventListener('uniserve:session-ended',stop);
  window.addEventListener('pagehide',stop);
  refresh();
})();
