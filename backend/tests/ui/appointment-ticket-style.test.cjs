const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('appointment browser ticket uses the walk-in CSS without email inline overrides',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../../../User/user.js'),'utf8');const start=source.indexOf('function appointmentPassHtml(');const context={};vm.createContext(context);vm.runInContext(source.slice(start,source.indexOf('function requirementsBlockHtml(',start)),context);
 const html=context.appointmentPassHtml({ticketHtml:'<div class="ticket-v2-card" style="display:flex"><div class="ticket-v2-stub-inner" style="transform:rotate(90deg)">VIS-TEST</div></div>'});
 assert.ok(html.includes('ticket-v2-card'));assert.ok(html.includes('ticket-v2-stub-inner'));assert.ok(html.includes('VIS-TEST'));assert.ok(!html.includes('style='));
});
