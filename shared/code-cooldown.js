(function(root){
  'use strict';
  const deadlines=new Map(),bindings=new Map();
  const normalize=key=>key.trim().toLowerCase();
  function remaining(key){
    key=normalize(key);
    let until=deadlines.get(key)||0;
    try{until=Math.max(until,Number(sessionStorage.getItem('oss-code-cooldown:'+key))||0);}catch(_){}
    return Math.max(0,Math.ceil((until-Date.now())/1000));
  }
  function update(){
    for(const [button,{key,label}] of bindings){
      if(!button.isConnected){bindings.delete(button);continue;}
      const seconds=remaining(key);
      button.disabled=seconds>0;
      button.textContent=seconds>0?`${label} (${seconds}s)`:label;
      if(!seconds)bindings.delete(button);
    }
  }
  root.CodeCooldown={
    remaining,
    start(key,seconds=60){
      key=normalize(key);const until=Date.now()+seconds*1000;deadlines.set(key,until);
      try{sessionStorage.setItem('oss-code-cooldown:'+key,String(until));}catch(_){}
      update();
    },
    bind(button,key,label='Resend code'){
      if(!button)return;
      bindings.set(button,{key:normalize(key),label});update();
    },
    unbind(button){bindings.delete(button);},
  };
  setInterval(update,1000);
})(window);
