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
    // Rasterize at export size so text and the embedded logo retain their detail.
    const scale=2;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width',width*scale);svg.setAttribute('height',height*scale);
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const content=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');
    content.setAttribute('width',width);content.setAttribute('height',height);
    content.appendChild(copy);svg.appendChild(content);
    const serialized=new XMLSerializer().serializeToString(svg);
    const picture=new Image();
    await new Promise((resolve,reject)=>{picture.onload=resolve;picture.onerror=()=>reject(Error('Could not create the ticket image. Please try again.'));picture.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(serialized);});
    const canvas=document.createElement('canvas');
    canvas.width=width*scale;canvas.height=height*scale;
    const context=canvas.getContext('2d');
    if(!context)throw Error('Your browser could not create the ticket image.');
    context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(picture,0,0,canvas.width,canvas.height);
    // Draw the source crest directly, avoiding the SVG foreignObject image rasterization.
    for (const logo of ticket.querySelectorAll('.ticket-v2-logo')) {
      const rect=logo.getBoundingClientRect(),style=getComputedStyle(logo);
      const insetLeft=parseFloat(style.paddingLeft)+parseFloat(style.borderLeftWidth);
      const insetTop=parseFloat(style.paddingTop)+parseFloat(style.borderTopWidth);
      const availableWidth=rect.width-insetLeft-parseFloat(style.paddingRight)-parseFloat(style.borderRightWidth);
      const availableHeight=rect.height-insetTop-parseFloat(style.paddingBottom)-parseFloat(style.borderBottomWidth);
      const sourceResponse=await fetch(logo.currentSrc||logo.src);
      if(!sourceResponse.ok)throw Error('Could not load the original ticket logo.');
      const sourceLogo=await createImageBitmap(await sourceResponse.blob());
      const ratio=Math.min(availableWidth/sourceLogo.width,availableHeight/sourceLogo.height);
      const logoWidth=sourceLogo.width*ratio,logoHeight=sourceLogo.height*ratio;
      const x=rect.left-bounds.left+insetLeft+(availableWidth-logoWidth)/2;
      const y=rect.top-bounds.top+insetTop+(availableHeight-logoHeight)/2;
      context.save();
      context.beginPath();
      context.ellipse((rect.left-bounds.left+rect.width/2)*scale,(rect.top-bounds.top+rect.height/2)*scale,rect.width*scale/2,rect.height*scale/2,0,0,Math.PI*2);
      context.clip();
      context.imageSmoothingEnabled=true;
      context.imageSmoothingQuality='high';
      context.drawImage(sourceLogo,x*scale,y*scale,logoWidth*scale,logoHeight*scale);
      sourceLogo.close();
      context.restore();
    }

    const png=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not save the ticket image.')),'image/png'));
    const reference=ticket.querySelector('.ticket-v2-number')?.textContent.trim()||'ticket';
    const url=URL.createObjectURL(png),link=document.createElement('a');
    link.href=url;link.download='UniServe-'+reference.replace(/[^a-zA-Z0-9_-]/g,'')+'.png';
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(error) {toast(error.message||'Could not download the ticket. Please try again.','err');}
  finally {if(button?.isConnected)button.disabled=false;}
};
