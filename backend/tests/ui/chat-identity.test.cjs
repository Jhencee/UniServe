const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
function setup(){const c={visitorView:'visit',currentPublicChatId:null};vm.createContext(c);const source=fs.readFileSync(path.resolve(__dirname,'../../../User/user.js'),'utf8');vm.runInContext(source.slice(source.indexOf('const PH_CONTACT_RE'),source.indexOf('function isValidPersonName')),c);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../User/chat-identity.js'),'utf8'),c);return c;}

test('chat renders the same Philippine prefix as the visit form',()=>{
 const c=setup(),content={innerHTML:''};
 c.document={getElementById:()=>content};
 c.renderChatIdentity();
 assert.match(content.innerHTML,/ph-phone-input/);
 assert.match(content.innerHTML,/Philippines \(\+63\)/);
 assert.match(content.innerHTML,/placeholder="9171234567"/);
 assert.doesNotMatch(content.innerHTML,/09XX-XXX-XXXX/);
});
test('chat validates names, PH contact numbers and Gmail',()=>{const c=setup(),valid=c.chatProfileValidation({first:'Juan',last:'Dela Cruz',contact:'0917-123-4567',email:'JUAN@gmail.com'});assert.ok(Object.values(valid).every(Boolean));const bad=c.chatProfileValidation({first:'123',last:'',contact:'12345',email:'x@example.com'});assert.ok(Object.values(bad).every(v=>!v));});
test('name validation supports accents and apostrophes without accepting markup',()=>{const c=setup();const valid=c.chatProfileValidation({first:'José',last:"O’Neil",contact:'+639171234567',email:'x@gmail.com'});assert.equal(valid.first,true);assert.equal(valid.last,true);assert.equal(c.chatProfileValidation({first:'<script>',last:'Cruz',contact:'09171234567',email:'x@gmail.com'}).first,false);});
