/* Reverb speaks the Pusher protocol. Only change hints travel over this socket. */
(function(){
  if(typeof WebSocket==='undefined')return;
  const API=(globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api');let socket,config,socketId,retry=1000,reconnectTimer,refreshTimer;
  const subscribed=new Set(),pending=new Set(),deniedCredentials=new Map(),authRetryAt=new Map();
  const staff=typeof state_view!=='undefined';
  window.UniServeRealtime={get connected(){
    if(staff)return subscribed.has('private-office');
    if(typeof visitorView!=='undefined'&&visitorView==='chat'&&typeof currentPublicChatId!=='undefined'&&currentPublicChatId)return subscribed.has('private-chat-'+currentPublicChatId);
    if(typeof myActiveQueueId!=='undefined'&&myActiveQueueId){const queue=loadDB().queues.find(q=>q.id===myActiveQueueId);if(queue)return subscribed.has('private-visit-'+queue.visitId);}
    if(typeof visitorView!=='undefined'&&['visit','checkvisit'].includes(visitorView)){const id=sessionStorage.getItem('oss_activeAppointmentId'),a=id&&loadDB().appointments.find(a=>a.id===id);if(a)return subscribed.has('private-visit-'+a.visitId);}
    return subscribed.has('public-queue');
  }};
  async function subscribe(channel){
    if(!socketId||socket?.readyState!==WebSocket.OPEN||subscribed.has(channel)||pending.has(channel))return;
    pending.add(channel);
    try{
      const data={channel};
      if(channel.startsWith('private-')){
        const headers={'Content-Type':'application/json',Accept:'application/json'};
        const session=JSON.parse(sessionStorage.getItem('ossuniserve_session')||'{}');
        if(staff)headers.Authorization='Bearer '+(session.token||'');
        const visitorToken=sessionStorage.getItem('ossuniserve_visitor_token');if(visitorToken)headers['X-Visitor-Token']=visitorToken;
        if(channel.startsWith('private-visit-')){const token=sessionStorage.getItem('visit-token:'+channel.slice(14));if(token)headers['X-Visit-Token']=token;}
        if(channel.startsWith('private-chat-')&&!visitorToken){const token=sessionStorage.getItem('chat-token:'+channel.slice(13));if(token)headers['X-Chat-Token']=token;}
        if(!headers.Authorization&&!headers['X-Visitor-Token']&&!headers['X-Visit-Token']&&!headers['X-Chat-Token'])return;
        const credential=JSON.stringify(headers);
        if(deniedCredentials.get(channel)===credential||Date.now()<(authRetryAt.get(channel)||0))return;
        const response=await fetch(API+'/realtime/auth',{method:'POST',headers,signal:AbortSignal.timeout(8000),body:JSON.stringify({socket_id:socketId,channel_name:channel})});
        if(!response.ok){if(response.status===401||response.status===403)deniedCredentials.set(channel,credential);else authRetryAt.set(channel,Date.now()+(response.status===429?Math.max(1,Number(response.headers.get('Retry-After'))||60)*1000:30000));return;}deniedCredentials.delete(channel);authRetryAt.delete(channel);Object.assign(data,await response.json());
      }
      if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({event:'pusher:subscribe',data}));
    }catch(_){}finally{pending.delete(channel);}
  }
  function channels(){
    if(staff){subscribe('private-office');return;}
    subscribe('public-queue');
    if(typeof visitorView!=='undefined'&&['visit','checkvisit'].includes(visitorView)){const id=sessionStorage.getItem('oss_activeAppointmentId'),a=id&&loadDB().appointments.find(a=>a.id===id);if(a?.visitId)subscribe('private-visit-'+a.visitId);}
    if(typeof currentPublicChatId!=='undefined'&&currentPublicChatId)subscribe('private-chat-'+currentPublicChatId);
    if(typeof myActiveQueueId!=='undefined'&&myActiveQueueId){const queue=loadDB().queues.find(q=>q.id===myActiveQueueId);if(queue?.visitId)subscribe('private-visit-'+queue.visitId);}
  }
  function connect(){
    if(document.visibilityState==='hidden')return;
    const secure=location.protocol==='https:',scheme=secure?'wss':config.scheme,host=location.protocol==='file:'?'127.0.0.1':location.hostname;
    socket=new WebSocket(`${scheme}://${host}:${config.port}/app/${encodeURIComponent(config.key)}?protocol=7&client=uniserve&version=1`);
    socket.onmessage=event=>{
      try{const message=JSON.parse(event.data),data=typeof message.data==='string'?JSON.parse(message.data):message.data;
        if(message.event==='pusher:connection_established'){socketId=data.socket_id;retry=1000;channels();}
        else if(message.event==='pusher_internal:subscription_succeeded')subscribed.add(message.channel);
        else if(message.event==='pusher:ping')socket.send(JSON.stringify({event:'pusher:pong',data:{}}));
        else if(message.event==='walk-in.intake.changed'&&staff&&message.channel==='private-office'&&subscribed.has(message.channel))window.dispatchEvent(new CustomEvent('uniserve:intake-notification',{detail:data}));
        else if(message.event==='portal.changed'){if(subscribed.has(message.channel)&&message.channel.startsWith('private-'))window.dispatchEvent(new CustomEvent('uniserve:browser-update',{detail:data}));clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>window.dispatchEvent(new CustomEvent('uniserve:changed',{detail:data})),250);}
      }catch(_){}
    };
    socket.onerror=()=>socket.close();
    socket.onclose=()=>{socketId=null;subscribed.clear();pending.clear();clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connect,retry);retry=Math.min(retry*2,30000);};
  }
  let configTimer,channelTimer;
  async function loadConfig(){
    try{const response=await fetch(API+'/realtime/config',{signal:AbortSignal.timeout(8000)});
      if(!response.ok){const wait=response.status===429?Math.max(1,Number(response.headers.get('Retry-After'))||60)*1000:30000;configTimer=setTimeout(loadConfig,wait);return;}
      const data=await response.json();config=data;if(data.enabled&&data.key){connect();if(!channelTimer)channelTimer=setInterval(channels,10000);}
    }catch(_){configTimer=setTimeout(loadConfig,30000);}
  }
  loadConfig();
  document.addEventListener('visibilitychange',()=>{if(config?.enabled&&document.visibilityState==='visible'){if(!socket||socket.readyState===WebSocket.CLOSED)connect();else channels();}});
  window.addEventListener('uniserve:visit-selected',channels);
  function stopRealtime(){clearTimeout(reconnectTimer);clearTimeout(configTimer);clearInterval(channelTimer);if(socket){socket.onclose=null;socket.close();}}
  window.addEventListener('pagehide',stopRealtime);
  window.addEventListener('uniserve:session-ended',stopRealtime);
})();
