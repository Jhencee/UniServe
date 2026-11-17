const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../shared/realtime-updates.js'),'utf8');
async function socketUrl(config){
  const urls=[];
  const context={URL,AbortSignal,UniServeConfig:{apiBase:'https://api.example.com/api'},location:{protocol:'https:',hostname:'frontend.example.com',href:'https://frontend.example.com/'},
    document:{visibilityState:'visible',addEventListener(){}},window:{addEventListener(){}},
    WebSocket:class{constructor(url){urls.push(url);}},fetch:async()=>({ok:true,json:async()=>config}),setInterval(){},setTimeout(){},clearInterval(){},clearTimeout(){}};
  vm.createContext(context);vm.runInContext(source,context);await new Promise(resolve=>setImmediate(resolve));return urls;
}
test('WebSocket connects to the configured Reverb host instead of the frontend',async()=>{
  const urls=await socketUrl({enabled:true,key:'public-key',host:'updates.example.com',port:443,scheme:'wss'});
  assert.match(urls[0],/^wss:\/\/updates\.example\.com:443\/app\/public-key\?/);
});
test('older API configuration falls back to the API host',async()=>{
  const urls=await socketUrl({enabled:true,key:'public-key',port:443,scheme:'wss'});
  assert.match(urls[0],/^wss:\/\/api\.example\.com:443\//);
});
test('disabled broadcasting does not pretend a socket connection exists',async()=>{
  assert.deepEqual(await socketUrl({enabled:false}),[]);
});
