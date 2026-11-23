const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../User/user.js'),'utf8');
const context={escapeHtml:String,icon:()=>'',FEEDBACK_MAX:300};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function hasActivePickup('),source.indexOf('function feedbackSectionHtml(')),context);
vm.runInContext(source.slice(source.indexOf('function feedbackSectionHtml('),source.indexOf('function setFeedbackStars(')),context);
test('feedback is shown for the original visit, not its pickup',()=>{
 assert.match(context.feedbackSectionHtml({id:'original',status:'Completed'}),/Submit Feedback/);
 assert.match(context.feedbackSectionHtml({status:'Completed',feedback:{rating:5}}),/Feedback Received/);
 assert.equal(context.feedbackSectionHtml({status:'Completed',pickupOfVisitId:'VIS-ORIGINAL'}),'');
 assert.equal(context.feedbackSectionHtml({status:'Completed',pickupTransactionId:'transaction',feedback:{rating:5}}),'');
});
test('pickup summary offers only the next appropriate action',()=>{
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Preparing'}),/Being prepared/);
 assert.doesNotMatch(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Preparing'}),/button/);
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Ready'}),/Join pickup queue/);
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Ready',pickupProgress:{pickup:{status:'Waiting'}}}),/View pickup queue/);
 assert.doesNotMatch(context.pickupSummaryHtml({status:'Serving',pickupOfVisitId:'VIS-ORIGINAL',pickupProgress:{documentStatus:'Ready'}}),/button/);
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Claimed'}),/Claimed/);
 assert.doesNotMatch(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Claimed'}),/button/);
});
