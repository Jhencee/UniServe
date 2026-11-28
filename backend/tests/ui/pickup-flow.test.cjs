const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../User/user.js'),'utf8');
const context={escapeHtml:String,icon:()=>'',isOfficeHours:()=>true,FEEDBACK_MAX:300};
context.timelineStepsHtml=()=>'';context.fmtDateTime=String;
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function visitProgressHtml('),source.indexOf('function hasActivePickup(')),context);
vm.runInContext(source.slice(source.indexOf('function hasActivePickup('),source.indexOf('function feedbackSectionHtml(')),context);
vm.runInContext(source.slice(source.indexOf('function feedbackSectionHtml('),source.indexOf('function setFeedbackStars(')),context);
test('feedback is shown for the original visit, not its pickup',()=>{
 assert.match(context.feedbackSectionHtml({id:'original',status:'Completed'}),/Submit Feedback/);
 assert.match(context.feedbackSectionHtml({status:'Completed',feedback:{rating:5}}),/Feedback Received/);
 assert.equal(context.feedbackSectionHtml({status:'Completed',pickupOfVisitId:'VIS-ORIGINAL'}),'');
 assert.equal(context.feedbackSectionHtml({status:'Completed',pickupTransactionId:'transaction',feedback:{rating:5}}),'');
});
test('failed soft-copy delivery gives the same contact instruction in summary and progress',()=>{
 const q={status:'Completed',pickupStatus:'Ready',deliveryFormat:'digital',digitalDeliveryStatus:'Failed',pickupProgress:{documentStatus:'Ready'}};
 assert.match(context.pickupSummaryHtml(q),/Delivery failed — contact OSS/);
 assert.match(context.visitProgressHtml(q),/Delivery failed — contact OSS/);
 assert.match(source,/q\.digitalDeliveryStatus==='Failed'\?'Delivery failed — contact OSS\.'/);
});
test('pickup summary offers only the next appropriate action',()=>{
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Preparing'}),/Being prepared/);
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Preparing'}),/Choose delivery/);
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Ready'}),/Choose delivery/);
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Ready',deliveryFormat:'hard'}),/Join pickup queue/);
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Ready',pickupProgress:{pickup:{status:'Waiting'}}}),/View pickup queue/);
 assert.doesNotMatch(context.pickupSummaryHtml({status:'Serving',pickupOfVisitId:'VIS-ORIGINAL',pickupProgress:{documentStatus:'Ready'}}),/button/);
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Claimed'}),/Claimed/);
 assert.doesNotMatch(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Claimed'}),/button/);
});
test('joining pickup is disabled when OSS is closed but delivery can still be changed',()=>{
 context.isOfficeHours=()=>false;const html=context.pickupSummaryHtml({status:'Completed',pickupStatus:'Ready',deliveryFormat:'hard'});
 assert.match(html,/disabled aria-describedby="pickupClosedNotice"/);assert.match(html,/Pickup queue is available during OSS office hours/);assert.match(html,/Change delivery/);
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Ready',pickupProgress:{pickup:{status:'Waiting'}}}),/View pickup queue/);
 context.isOfficeHours=()=>true;
});
