async function previewBackupFile(input){
  const file=input.files?.[0],status=document.getElementById('restoreBackupStatus');
  if(!file)return;
  const choose=document.getElementById('restoreBackupChoose');
  document.getElementById('restoreBackupName').textContent=file.name;
  choose.disabled=true;
  input.disabled=true;status.textContent='Checking backup…';
  try{
    if(file.size>30*1024*1024)throw Error('Choose a backup smaller than 30 MB.');
    let backup;try{backup=JSON.parse(await file.text());}catch(_){throw Error('This file is not valid JSON. Select the original downloaded backup.');}
    const preview=await UniServeUX.request('/backup/preview','POST',{backup});
    status.textContent='Backup checked. Review the preview before restoring.';
    const date=new Date(preview.createdAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'});
    openModal('Restore this backup?',`<p class="field-hint">Backup created ${escapeHtml(date)}.</p><p style="margin:12px 0">${escapeHtml(preview.message)}</p><div class="table-wrap"><table><thead><tr><th>Records</th><th>Current</th><th>Backup</th></tr></thead><tbody>${preview.tables.map(row=>`<tr><td>${escapeHtml(row.table.replace(/_/g,' '))}</td><td>${row.currentRows}</td><td>${row.backupRows}</td></tr>`).join('')}</tbody></table></div><div class="field" style="margin-top:16px"><label for="restoreConfirmation">Type RESTORE to confirm replacement</label><input id="restoreConfirmation" autocomplete="off" placeholder="RESTORE"></div><p id="restoreInlineError" role="alert" class="field-hint"></p>`,[
      {label:'Keep current data',cls:'btn-ghost',action:closeModal},
      {label:'Restore backup',cls:'btn-danger-o',action:async()=>{
        const error=document.getElementById('restoreInlineError');
        if(document.getElementById('restoreConfirmation').value!=='RESTORE'){error.textContent='Type RESTORE to confirm.';return;}
        const button=document.getElementById('modalBtn1');button.disabled=true;button.textContent='Restoring…';
        error.textContent='Keep this window open until restoration finishes.';
        try{
          await UniServeUX.request('/backup/restore','POST',{token:preview.token,confirmation:'RESTORE'});
          localStorage.removeItem(DB_KEY);sessionStorage.removeItem('ossuniserve_session');
          openModal('Backup restored','<p>Your records were restored and a recovery backup was saved on the server. Sign in again using an account from the restored backup.</p>',[{label:'Sign in again',cls:'btn-primary',action:()=>{location.href='../Landing/landing.html';}}]);
        }catch(e){error.textContent=e.message;button.disabled=false;button.textContent='Restore backup';}
      }}
    ]);
  }catch(e){status.textContent=e.message;}
  finally{input.disabled=false;input.value='';choose.disabled=false;}
}
