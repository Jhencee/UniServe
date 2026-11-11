/* Keep existing settings handlers while presenting them in one disclosure. */
(() => {
  const menu = document.getElementById('visitorActions');
  if (!menu) return;
  const panel = menu.querySelector('.visitor-actions-panel');
  const theme = document.getElementById('visitorThemeToggle');
  const syncTheme = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    theme.setAttribute('aria-checked', String(dark));
    theme.querySelector('.visitor-theme-state').textContent = dark ? 'On' : 'Off';
  };
  theme.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    syncTheme();
  });
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
  syncTheme();
  document.addEventListener('click', event => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
  panel.addEventListener('click', event => {
    if (event.target.closest('#a11yBtn')) menu.open = false;
  });
})();
// Rasterize the visible ticket with its styles and embedded logo into a PNG.
window.downloadVisitorTicket = async function(button) {
  const ticket = document.querySelector('#visitorContent .printable-ticket');
  if (!ticket) { toast('Open a ticket before downloading it.', 'err'); return; }
  if (ticket.dataset.downloadApproved === 'false') { toast('Your ticket will be available after OSS approves your schedule.', 'err'); return; }
  if(button)button.disabled=true;
  try {
    await document.fonts?.ready;
    await Promise.all([...ticket.querySelectorAll('img')].map(img=>img.decode()));
    const bounds=ticket.getBoundingClientRect();
    const width=Math.ceil(bounds.width),height=Math.ceil(bounds.height);
    if(!width||!height)throw Error('Open a visible ticket before downloading it.');
    const copy=ticket.cloneNode(true);
    const original=[ticket,...ticket.querySelectorAll('*')],cloned=[copy,...copy.querySelectorAll('*')];
    original.forEach((node,index)=>{
      const computed=getComputedStyle(node);
      for(const property of computed)cloned[index].style.setProperty(property,computed.getPropertyValue(property));
      // Use fonts available within the standalone SVG image, without remote font requests.
      cloned[index].style.setProperty('font-family',computed.fontFamily.includes('mono')?'monospace':'Arial, sans-serif');
      cloned[index].style.setProperty('animation','none');
      cloned[index].style.setProperty('transition','none');
    });
    copy.style.setProperty('margin','0');
    copy.style.setProperty('width',width+'px');
    copy.style.setProperty('height',height+'px');
    await Promise.all([...copy.querySelectorAll('img')].map(async img=>{
      const response=await fetch(new URL(img.getAttribute('src'),document.baseURI));
      if(!response.ok)throw Error('Could not download the ticket logo.');
      const blob=await response.blob();
      img.removeAttribute('srcset');
      img.src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read the ticket logo.'));reader.readAsDataURL(blob);});
    }));
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width',width);svg.setAttribute('height',height);
    const content=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');
    content.setAttribute('width','100%');content.setAttribute('height','100%');
    content.appendChild(copy);svg.appendChild(content);
    const serialized=new XMLSerializer().serializeToString(svg);
    const picture=new Image();
    await new Promise((resolve,reject)=>{picture.onload=resolve;picture.onerror=()=>reject(Error('Could not create the ticket image. Please try again.'));picture.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(serialized);});
    const scale=2,canvas=document.createElement('canvas');
    canvas.width=width*scale;canvas.height=height*scale;
    const context=canvas.getContext('2d');
    if(!context)throw Error('Your browser could not create the ticket image.');
    context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(picture,0,0,canvas.width,canvas.height);
    const png=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not save the ticket image.')),'image/png'));
    const reference=ticket.querySelector('.ticket-v2-number')?.textContent.trim()||'ticket';
    const url=URL.createObjectURL(png),link=document.createElement('a');
    link.href=url;link.download='UniServe-'+reference.replace(/[^a-zA-Z0-9_-]/g,'')+'.png';
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(error) {toast(error.message||'Could not download the ticket. Please try again.','err');}
  finally {if(button?.isConnected)button.disabled=false;}
};
