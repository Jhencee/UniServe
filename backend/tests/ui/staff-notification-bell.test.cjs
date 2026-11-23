const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('the notification bell uses the unread calculation instead of an absent sidebar badge',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../../../shared/staff-actions.js'),'utf8');
 const nodes=[];const themes={replaceWith(){}};
 const document={querySelector:s=>s==='.topbar-right .theme-toggle'?themes:null,createElement:()=>{const node={children:[],setAttribute(){},append(child){this.children.push(child);},set innerHTML(value){this.html=value;}};nodes.push(node);return node;}};
 let refreshes=0;const window={refreshSidebarNotificationCount(){refreshes++;}};
 vm.runInNewContext(source,{document,window,navigate(){}});
 assert.equal(refreshes,1);assert.ok(nodes.some(node=>node.className==='icon-btn staff-notification-button'));
});
