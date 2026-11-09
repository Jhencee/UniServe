(() => {
  let config,widget,token='',loading;
  const box=()=>document.getElementById('loginTurnstile');
  const status=()=>document.getElementById('loginTurnstileStatus');
  async function init(){
    if(loading)return loading;
    loading=(async()=>{
      if(!config){
        const response=await fetch(UniServeConfig.apiBase+'/login/challenge',{headers:{Accept:'application/json'}});
        const result=await response.json();if(!response.ok)throw Error(result.message||'Cannot load the security check.');config=result;
      }
      if(!config.enabled){box().hidden=true;return;}
      if(window.location?.protocol==='file:')throw Error('Open UniServe through http://localhost or http://127.0.0.1. Cloudflare cannot verify a file opened directly from your computer.');
      box().hidden=false;
      status().textContent='Loading security check…';
      if(!window.turnstile)await new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
        script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('Cannot load Cloudflare. Check your connection and try signing in again.'));};document.head.appendChild(script);
      });
      if(widget===undefined)widget=window.turnstile.render('#loginTurnstileWidget',{
        sitekey:config.siteKey,action:'staff-login',theme:document.documentElement.dataset.theme==='dark'?'dark':'light',size:(document.getElementById('loginTurnstileWidget')?.getBoundingClientRect?.().width||300)<300?'compact':'flexible',
        callback:value=>{token=value;status().textContent='';},
        'expired-callback':()=>{token='';status().textContent='Security check expired. Please complete it again.';},
        'error-callback':code=>{
          token='';
          const messages={
            '110200':'This hostname is not allowed. Add '+(window.location?.hostname||'your website hostname')+' to your Cloudflare Turnstile widget’s Hostname Management.',
            '110100':'The Turnstile site key is invalid. Check the Site key in the Cloudflare dashboard.',
            '110110':'The Turnstile site key could not be found. Check the widget in Cloudflare.',
            '400020':'Check the Turnstile site key in your Cloudflare dashboard.',
            '200500':'Cannot load the Cloudflare verification frame. Check your connection or browser content blocker.',
          };
          status().textContent=(messages[String(code)]||'Cloudflare could not complete the security check. Try refreshing or using another browser.')+' (Code: '+code+')';
        },
      });
      if(!token)status().textContent='Complete the security check to continue.';
    })();
    try{await loading;}finally{loading=null;}
  }
  window.LoginTurnstile={
    async init(){try{await init();}catch(e){box().hidden=false;status().textContent=e.message;}},
    async getToken(){await init();if(config.enabled&&!token)throw Error('Complete the security check before signing in.');return token;},
    reset(){token='';if(widget!==undefined&&window.turnstile)window.turnstile.reset(widget);},
  };
})();
