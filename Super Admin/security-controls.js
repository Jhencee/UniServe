function confirmSuperAction(action) { return confirmStaffAction(action); }
function sendSystemTestEmail() {
  confirmSuperAction(async()=>{const result=await UniServeUX.request('/system/test-email','POST',{}, {signal:AbortSignal.timeout(30000)});openModal('Check your inbox',`<p>${escapeHtml(result.message)}</p><p>Reference: <strong>${escapeHtml(result.reference)}</strong></p><p class="field-hint">A successful send does not prove inbox delivery. Match this reference in your email.</p>`,[{label:'Close',cls:'btn-ghost',action:closeModal}]);});
}
