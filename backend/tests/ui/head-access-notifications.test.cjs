const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
function setup(head){
 const feed={innerHTML:'',textContent:'',hidden:false,insertAdjacentHTML(){},setAttribute(){}};
 const tab={insertAdjacentHTML(){},dataset:{category:'all'},id:'notification-tab-all',setAttribute(){},closest:()=>content};
 const content={innerHTML:'',querySelector:selector=>selector.includes('notification-tab')||selector.includes('[data-category')?tab:feed,querySelectorAll:()=>[]};
 const c={currentUser:{id:'staff',confidentialApprover:head},approvedAccessNotifications:[{id:'approved-1',code:'OSS-001',scope:'view'}],headAccessRequestNotifications:[{id:'request-1',requester_name:'Requesting Admin',code:'OSS-001',scope:'view'}],localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null},document:{getElementById:()=>content,querySelector:()=>null},loadDB:()=>({appointments:[],transactions:[]}),OfficeCalendar:{parts:()=>({date:'2026-10-23'})},escapeHtml:String};c.window=c;vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf("let notificationStatusFilter="),source.indexOf('function queueStatusPill(')),c);
 c.renderNotifications();return feed.innerHTML;
}
test('approved access appears with an open-record action in requester notifications',()=>{
 const html=setup(false);assert.ok(html.includes('Access request approved'));assert.ok(html.includes('openApprovedAccessRequest(this.dataset.id)'));
});
test('permission requests appear only in Head Admin notifications with a review action',()=>{
 for(const head of [false,true]){const html=setup(head);assert.equal(html.includes('Confidential access requested'),head);assert.equal(html.includes('Requesting Admin'),head);assert.equal(html.includes('openHeadAccessRequest(this.dataset.id)'),head);}
});

test('sidebar and header share the unread total without additive drift',()=>{
 let badge={textContent:'999',dataset:{importantUpdates:'99',accessRequests:'99'}};
 const storage=new Map();
 const db={appointments:[{id:'a',status:'Requested',earlierSlotOptIn:true,followUpTasks:[{id:'task',dueDate:'2026-10-01',completed:false}]}],transactions:[{id:'case',caseStatus:'Open'}]};
 const c={currentUser:{id:'head',confidentialApprover:true},OfficeCalendar:{parts:()=>({date:'2026-11-08'})},loadDB:()=>db,document:{querySelector:()=>badge},localStorage:{getItem:key=>storage.get(key)||null},sessionStorage:{getItem:()=>null},importantNotifications:[{id:'update',kind:'system',title:'Update'}],approvedAccessNotifications:[{id:'approval'}],headAccessRequestNotifications:[{id:'access'}]};
 c.window=c;vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('let notificationStatusFilter='),source.indexOf('function queueStatusPill(')),c);
 assert.equal(c.staffNotificationItems().length,7);
 c.refreshSidebarNotificationCount();assert.equal(badge.textContent,'7');
 // Navigation replaces the badge element, including all its dataset counters.
 badge={textContent:'4',dataset:{}};c.state_view='calendar';c.refreshSidebarNotificationCount();assert.equal(badge.textContent,'7');
 c.state_view='queue';c.refreshSidebarNotificationCount();c.refreshSidebarNotificationCount();assert.equal(badge.textContent,'7');
 const notification=c.staffNotificationItems()[0];
 storage.set('uniserve-notifications:head',JSON.stringify({[c.notificationPreferenceKey(notification)]:{archived:true}}));
 c.refreshSidebarNotificationCount();assert.equal(badge.textContent,'6');
 c.importantNotifications.push({id:'new',kind:'system',title:'New update'});c.refreshSidebarNotificationCount();assert.equal(badge.textContent,'7');
 const headerBadge={textContent:'',hidden:false},header={querySelector:()=>headerBadge,setAttribute:(k,v)=>header[k]=v};
 c.document.querySelector=selector=>selector.includes('staff-notification-button')?header:badge;
 const preferences={};c.staffNotificationItems().forEach(n=>preferences[c.notificationPreferenceKey(n)]={read:true});
 storage.set('uniserve-notifications:head',JSON.stringify(preferences));c.refreshSidebarNotificationCount();
 assert.equal(badge.textContent,'0');assert.equal(headerBadge.textContent,'0');assert.equal(badge.hidden,true);assert.equal(headerBadge.hidden,true);assert.match(header['aria-label'],/no unread/);
 const first=c.staffNotificationItems()[0];preferences[c.notificationPreferenceKey(first)]={read:false};storage.set('uniserve-notifications:head',JSON.stringify(preferences));c.refreshSidebarNotificationCount();
 assert.equal(badge.textContent,'1');assert.equal(headerBadge.textContent,'1');assert.equal(headerBadge.hidden,false);assert.match(header['aria-label'],/1 unread/);

});
