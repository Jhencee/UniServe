// Isolated browser check: static assets and mocked API only; no live records are changed.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../../..');
const mime={'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1),parts=relative.split('/');
  if(!['Landing','User','Admin','Super Admin','shared'].includes(parts[0])||parts.some(p=>p==='..'||p.startsWith('.')||p.includes('\\'))){res.writeHead(404);res.end();return;}
  fs.readFile(path.join(root,relative),(err,bytes)=>{res.writeHead(err?404:200,{'Content-Type':mime[path.extname(relative)]||'application/octet-stream'});res.end(err?'Not found':bytes);});
});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await new Promise((resolve,reject)=>server.listen(8765,'127.0.0.1',resolve).once('error',reject));
  const chrome=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9224','--user-data-dir='+path.join(require('node:os').tmpdir(),'uniserve-process-'+Date.now()),'about:blank'],{windowsHide:true,stdio:'ignore'});
  try{
    let ready=false;
    for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:9224/json/version')).ok){ready=true;break;}}catch{}await pause(100);}
    if(!ready)throw Error('Isolated browser did not start.');
    const checks=process.argv.includes('--all')?['visit-enhancements-smoke.cjs','role-data-smoke.cjs','flow-smoke.cjs']:process.argv.includes('--navigation')?['flow-smoke.cjs']:['visit-enhancements-smoke.cjs'];
    for(const check of checks){
      const child=spawn(process.execPath,[path.join(__dirname,check)],{windowsHide:true,stdio:'inherit'});
      const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});
      if(code!==0){process.exitCode=code||1;break;}
    }
  }finally{
    try{const info=await(await fetch('http://127.0.0.1:9224/json/version')).json();const ws=new WebSocket(info.webSocketDebuggerUrl);await new Promise(resolve=>{ws.onopen=()=>{ws.send(JSON.stringify({id:1,method:'Browser.close'}));resolve();};ws.onerror=resolve;});}catch{}chrome.kill();server.close();
  }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
