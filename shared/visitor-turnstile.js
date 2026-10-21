(() => {
  let configuration,scriptLoading;
  const widgets=new Map();
  async function config(){
    if(!configuration)configuration=(async()=>{
      const response=await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/login/challenge',{headers:{Accept:'application/json'}});
      const value=await response.json();
      if(!response.ok)throw Error(value.message||'Cannot load the security check.');
      return value;
    })().catch(error=>{configuration=null;throw error;});
    return configuration;
  }
  async function script(){
    if(window.turnstile)return;
    if(!scriptLoading)scriptLoading=new Promise((resolve,reject)=>{
      let tag=document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
      const existing=!!tag;
      if(!tag){tag=document.createElement('script');tag.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';tag.async=true;}
      tag.addEventListener('load',resolve,{once:true});
      tag.addEventListener('error',()=>{tag.remove();scriptLoading=null;reject(Error('Cannot load the security check. Check your connection and try again.'));},{once:true});
      if(!existing)document.head.appendChild(tag);
    });
    await scriptLoading;
  }
  async function mount(id){
    const element=document.getElementById(id);if(!element)return;
    const settings=await config();
    if(!element.isConnected)return;
    element.hidden=!settings.enabled;if(!settings.enabled)return;
    const status=element.querySelector('[role="status"]');
    if(window.location.protocol==='file:')throw Error('Open UniServe through localhost or your website to complete verification.');
    await script();if(!element.isConnected)return;
    const previous=widgets.get(id);
    if(previous?.element===element)return;
    if(previous)window.turnstile.remove(previous.widget);
    const state={element,token:'',widget:undefined};widgets.set(id,state);
    status.textContent='Complete the security check before requesting your code.';
    state.widget=window.turnstile.render(element.querySelector('.visitor-security-widget'),{
      sitekey:settings.siteKey,action:'visitor-code',size:'flexible',theme:document.documentElement.dataset.theme==='dark'?'dark':'light',
      callback:token=>{state.token=token;status.textContent='';},
      'expired-callback':()=>{state.token='';status.textContent='Security check expired. Please complete it again.';},
      'error-callback':()=>{state.token='';status.textContent='Security check could not finish. Refresh and try again.';},
    });
  }
  window.VisitorTurnstile={
    markup:id=>`<div id="${id}" class="visitor-security" hidden><div class="visitor-security-widget"></div><p class="field-hint" role="status" aria-live="polite"></p></div>`,
    async mount(id){try{await mount(id);}catch(error){const el=document.getElementById(id);if(el){el.hidden=false;el.querySelector('[role="status"]').textContent=error.message;}}},
    async getToken(id){const settings=await config();if(!settings.enabled)return '';await mount(id);const token=widgets.get(id)?.token;if(!token)throw Error('Complete the security check before requesting a code.');return token;},
    reset(id){const state=widgets.get(id);if(state){state.token='';if(state.element.isConnected&&window.turnstile)window.turnstile.reset(state.widget);}},
  };
})();
