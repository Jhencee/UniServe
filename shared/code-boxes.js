/* Keep one native input for paste, autofill, labels and existing verification flows. */
(() => {
  const selector='input.verification-code-input,input.chat-code-input,input[autocomplete="one-time-code"][maxlength="6"],input[inputmode="numeric"][maxlength="6"]';
  function enhance(input){
    if(input.closest('.code-boxes'))return;
    const wasFocused=document.activeElement===input;
    const wrap=document.createElement('div');wrap.className='code-boxes';
    input.before(wrap);wrap.append(input);
    const alphanumeric=input.classList.contains('chat-code-input');
    const clean=value=>alphanumeric?value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6):value.replace(/[^0-9]/g,'').slice(0,6);
    input.maxLength=6;input.inputMode=alphanumeric?'text':'numeric';
    const digits=Array.from({length:6},()=>{
      const box=document.createElement('span');box.className='code-digit';box.setAttribute('aria-hidden','true');wrap.append(box);return box;
    });
    function sync(){
      input.value=clean(input.value);
      const focused=document.activeElement===input;
      const position=Math.min(input.selectionStart??input.value.length,5);
      digits.forEach((box,index)=>{
        box.textContent=input.value[index]||'';
        box.classList.toggle('is-filled',Boolean(input.value[index]));
        box.classList.toggle('is-current',focused&&index===position);
      });
      wrap.classList.toggle('is-invalid',input.getAttribute('aria-invalid')==='true');
    }
    for(const event of ['input','change','focus','blur','keyup','select'])input.addEventListener(event,sync);
    input.addEventListener('click',event=>{
      const rect=wrap.getBoundingClientRect();
      const index=Math.min(5,Math.max(0,Math.floor((event.clientX-rect.left)/rect.width*6)));
      input.setSelectionRange(Math.min(index,input.value.length),Math.min(index+1,input.value.length));sync();
    });
    input.addEventListener('paste',event=>{
      const pasted=event.clipboardData?.getData('text');if(!pasted)return;
      event.preventDefault();input.value=clean(pasted);
      input.setSelectionRange(input.value.length,input.value.length);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    new MutationObserver(sync).observe(input,{attributes:true,attributeFilter:['aria-invalid']});
    if(wasFocused)input.focus({preventScroll:true});
    sync();
  }
  const scan=()=>document.querySelectorAll(selector).forEach(enhance);
  scan();
  new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&!n.classList?.contains('code-digit'))))scan();}).observe(document.body,{childList:true,subtree:true});
})();
