// Local Wi-Fi preview. Serves only portal assets and proxies the existing local API.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),port=Number(process.env.MOBILE_PREVIEW_PORT||5503);
const apiPort=Number(process.env.MOBILE_PREVIEW_API_PORT||8000);
const allowed=new Set(['Landing','User','Admin','Super Admin','shared']);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
 if(req.url.startsWith('/api/')){
  const upstream=http.request({hostname:'127.0.0.1',port:apiPort,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:'+apiPort,'accept-encoding':'identity'}},reply=>{
   if(req.url.split('?')[0]==='/api/realtime/config'){
    let body='';reply.setEncoding('utf8');reply.on('data',chunk=>body+=chunk);reply.on('end',()=>{try{const config=JSON.parse(body);config.port=port;config.scheme='ws';res.writeHead(reply.statusCode,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(config));}catch{res.writeHead(502);res.end('Realtime preview unavailable');}});
   }else{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);}
  });
  upstream.on('error',()=>{res.writeHead(502);res.end('Start the local API on port 8000.');});req.pipe(upstream);return;
 }
 let relative;try{relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '');}catch{res.writeHead(400);res.end();return;}
 if(!relative){res.writeHead(302,{Location:'/Landing/landing.html'});res.end();return;}
 const parts=relative.split('/');
 if(!allowed.has(parts[0])||parts.some(part=>part.startsWith('.')||part.includes('\\'))||!mime[path.extname(relative).toLowerCase()]){res.writeHead(404);res.end();return;}
 const filename=path.resolve(root,relative);
 if(!filename.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
 fs.readFile(filename,(error,contents)=>{
  if(error){res.writeHead(404);res.end();return;}
  if(path.extname(filename)==='.html')contents=Buffer.from(contents.toString('utf8').replace('<head>','<head><script>window.UNISERVE_API_BASE=location.origin+"/api";</script>'));
  res.writeHead(200,{'Content-Type':mime[path.extname(filename).toLowerCase()],'Cache-Control':'no-store'});res.end(contents);
 });
});
server.on('upgrade',(req,socket,head)=>{
 if(!req.url.startsWith('/app/')){socket.destroy();return;}
 const upstream=http.request({hostname:'127.0.0.1',port:8080,path:req.url,method:'GET',headers:{...req.headers,host:'127.0.0.1:8080',origin:'http://localhost'}});
 upstream.on('upgrade',(reply,remote,remoteHead)=>{
  socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(reply.headers).map(([key,value])=>key+': '+value).join('\r\n')+'\r\n\r\n');
  if(remoteHead.length)socket.write(remoteHead);if(head.length)remote.write(head);remote.pipe(socket);socket.pipe(remote);remote.on('error',()=>socket.destroy());socket.on('error',()=>remote.destroy());
 });
 upstream.on('response',()=>socket.destroy());upstream.on('error',()=>socket.destroy());upstream.end();
});
server.listen(port,'0.0.0.0',()=>console.log('Mobile preview running on port '+port));
