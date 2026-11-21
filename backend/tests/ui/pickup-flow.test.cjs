const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../User/user.js'),'utf8');
const context={escapeHtml:String};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function hasActivePickup('),source.indexOf('function feedbackSectionHtml(')),context);
test('pickup summary offers only the next appropriate action',()=>{
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Preparing'}),/Being prepared/);
 assert.doesNotMatch(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Preparing'}),/button/);
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Ready'}),/Join pickup queue/);
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Ready',pickupProgress:{pickup:{status:'Waiting'}}}),/View pickup queue/);
 assert.doesNotMatch(context.pickupSummaryHtml({status:'Serving',pickupOfVisitId:'VIS-ORIGINAL',pickupProgress:{documentStatus:'Ready'}}),/button/);
 assert.match(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Claimed'}),/Claimed/);
 assert.doesNotMatch(context.pickupSummaryHtml({status:'Completed',pickupStatus:'Claimed'}),/button/);
});
