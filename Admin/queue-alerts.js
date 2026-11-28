/* Only the authenticated queue snapshot is used; initial records do not chime. */
(function(){
  const key='uniserve-queue-sound:'+currentUser.id;
  let enabled=localStorage.getItem(key)==='on',audio,busy=false,stopped=false,seen=null,count=0;
  function paint(){
    const badge=document.getElementById('queueWaitingBadge');
    if(badge){badge.textContent=String(count);badge.hidden=count===0;badge.setAttribute('aria-label',count+' visitors ready to call');}
    document.querySelectorAll('.queue-sound-toggle').forEach(button=>{const label='Queue sound: '+(enabled?'on':'off');button.setAttribute('aria-pressed',String(enabled));button.setAttribute('aria-label',label);button.setAttribute('title',label);});
  }
  async function unlock(){
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!enabled||!Audio)return;
    audio??=new Audio();if(audio.state==='suspended')await audio.resume();
  }
  function chime(){
    if(!enabled||audio?.state!=='running')return;
    const tone=audio.createOscillator(),gain=audio.createGain(),at=audio.currentTime;
    tone.type='sine';tone.frequency.setValueAtTime(660,at);tone.frequency.setValueAtTime(880,at+.14);
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.08,at+.02);gain.gain.exponentialRampToValueAtTime(.001,at+.4);
    tone.connect(gain);gain.connect(audio.destination);tone.start(at);tone.stop(at+.42);
  }
  function update(rows){
    const waiting=rows.filter(q=>!q.restricted&&q.status==='Waiting'&&isDue(q));
    const next=new Set(waiting.map(q=>q.id));
    if(seen&&waiting.some(q=>!seen.has(q.id)))chime();
    seen=next;count=next.size;paint();
  }
  async function refresh(){
    if(stopped||busy||document.visibilityState==='hidden')return;
    const token=loadSession().token;if(!token)return;
    busy=true;
    try{
      const response=await fetch((globalThis.UniServeConfig?.apiBase||'/api')+'/queue',{headers:{Accept:'application/json',Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
      if(response.status===401){stop();return;}
      if(!response.ok)throw Error('Queue unavailable');
      const result=await response.json();if(!stopped)update(result.queues||[]);
    }catch(_){}finally{busy=false;}
  }
  async function toggle(){enabled=!enabled;localStorage.setItem(key,enabled?'on':'off');paint();try{await unlock();if(enabled)chime();}catch(_){enabled=false;localStorage.setItem(key,'off');paint();}}
  const timer=setInterval(refresh,15000);
  function stop(){stopped=true;count=0;paint();clearInterval(timer);audio?.close();}
  window.UniServeQueueAlerts={get count(){return count;},get enabled(){return enabled;},toggle,refresh};
  document.addEventListener('pointerdown',()=>{unlock().catch(()=>{});});
  document.addEventListener('keydown',()=>{unlock().catch(()=>{});});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
  window.addEventListener('uniserve:changed',refresh);
  window.addEventListener('uniserve:session-ended',stop);
  window.addEventListener('pagehide',stop);
  paint();refresh();
})();
