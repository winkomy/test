(function(){
 'use strict';
 const safe=value=>String(value==null?'':value),esc=value=>safe(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const readStore=()=>{try{return JSON.parse(localStorage.getItem('winkoQuoteApprovalsV1')||'{}')||{}}catch(_){return{}}};
  function toast(message,type='info',duration=3400){const themes={success:{icon:'✓'},error:{icon:'⚠'},warning:{icon:'!'},info:{icon:'ℹ'}},status=Object.prototype.hasOwnProperty.call(themes,type)?type:'info';let host=document.getElementById('winkoToastContainer');if(!host){host=document.createElement('div');host.id='winkoToastContainer';host.className='winko-toast-host';host.setAttribute('aria-live','polite');host.setAttribute('aria-relevant','additions');host.setAttribute('aria-atomic','false');document.body.appendChild(host)}const item=document.createElement('div');item.className='winko-toast '+status;item.setAttribute('role','status');const icon=document.createElement('span');icon.className='winko-toast-icon';icon.setAttribute('aria-hidden','true');icon.textContent=themes[status].icon;const text=document.createElement('span');text.className='winko-toast-message';text.textContent=String(message??'');item.append(icon,text);host.appendChild(item);requestAnimationFrame(()=>item.classList.add('is-visible'));const life=Number.isFinite(Number(duration))?Math.max(0,Number(duration)):3400;setTimeout(()=>{item.classList.remove('is-visible');setTimeout(()=>item.remove(),240)},life);return item}
 window.winkoToast=toast;
 function role(){return typeof window.getWinkoRole==='function'?window.getWinkoRole():(document.body.dataset.appRole||'main')}
 function normalize(value){return window.WinkoDB?.toDbStatus?.(value)||({Draft:'DRAFT','Pending Main Approval':'PENDING_APPROVAL','Changes Required':'CHANGES_REQUIRED',Approved:'APPROVED',Archived:'ARCHIVED'}[safe(value)]||safe(value))}
 function showBanner(record,status){const page=document.getElementById('quotation');if(!page)return;page.querySelector('#winkoStatusReview')?.remove();const banner=document.createElement('section');banner.id='winkoStatusReview';banner.className='winko-status-review';const approved=status==='APPROVED',pending=status==='PENDING_APPROVAL',changes=status==='CHANGES_REQUIRED';banner.innerHTML='<div><div class="'+(approved?'winko-approved-mark':pending?'winko-waiting-mark':'')+'">'+(approved?'✓ APPROVED':pending?'QUOTATION SUBMITTED':changes?'CHANGES REQUIRED':'QUOTATION')+'</div><h2>'+(approved?'Final Quotation':pending?'Waiting for Main Approval':changes?'Main requested changes':esc(record.reference||''))+'</h2><p>'+esc(record.reference||'')+' · '+esc(record.customer||record.customer_name||'')+' · '+esc(record.project||record.project_name||'')+(approved&&(record.approvedAt||record.approved_at)?' · Approved '+esc(new Date(record.approvedAt||record.approved_at).toLocaleDateString()):'')+'</p>'+(changes&&record.approvalNote?'<p><strong>Main note:</strong> '+esc(record.approvalNote)+'</p>':'')+'</div>'+(approved?'<button type="button" class="primary" data-final-export>Export Quotation PDF</button>':'');page.insertBefore(banner,page.firstChild);banner.querySelector('[data-final-export]')?.addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{await window.exportQuotationPdf?.()}catch(error){console.error('Final quotation export failed.',error);window.WinkoErrorHandler?.report?.(error,'quotation-pdf-export');toast('Final PDF export failed. Please retry.','error')}finally{button.disabled=false}})}
  const openingQuotations=new Map();let activeQuotationLoad=null,queuedRealtimeQuotation=null;
  async function resolveQuotation(value){
    const key=safe(typeof value==='object'?(value?.id||value?.reference):value).trim(),store=readStore(),cached=store[key]||Object.values(store).find(record=>record?.supabaseId===key||safe(record?.reference).trim()===key)||null;
    if(!key)throw new Error('Quotation reference is required.');
    if(!window.WinkoAuth?.ready||!window.WinkoAuth?.user?.id)throw new Error('Sign in before opening a quotation.');
    const db=await window.WinkoDB?.getClient?.();if(!db)throw new Error('Supabase is unavailable. Retry your connection.');
    const session=await db.auth.getSession();if(session.error)throw session.error;if(!session.data?.session?.user||session.data.session.user.id!==window.WinkoAuth.user.id)throw new Error('Your sign-in session is unavailable. Sign in again before opening this quotation.');
    let remote=null,networkError=null;
    try{const response=await db.from('winko_test_quotations').select('*').eq(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)?'id':'reference',key).maybeSingle();if(response.error)throw response.error;remote=response.data}
    catch(error){networkError=error}
    if(remote){const record=window.WinkoQuotationRepository?.applyServerRow?.(remote)||remote;return{row:remote,record,local:false}}
    const owned=role()==='main'||cached?.ownerUserId===window.WinkoAuth.user.id;
    const networkUnavailable=networkError&&!['42501','401','403','PGRST301'].includes(safe(networkError.code))&&!/permission denied|row.level security|unauthorized|forbidden/i.test(safe(networkError.message));
    if(cached&&owned&&(networkUnavailable||(!networkError&&cached.syncStatus==='local-only'&&cached.ownerUserId===window.WinkoAuth.user.id))){if(networkError)toast('Cloud retrieval failed; opening the saved local copy of '+key+'.','warning');return{row:cached,record:cached,local:true}}
    if(networkError)throw new Error('Could not retrieve '+key+': '+(typeof networkError?.message==='string'?networkError.message:'network error'));
    throw new Error('Quotation '+key+' was not found or is not accessible to this account.');
  }
  async function reconstructBom(snapshot,row){if((Array.isArray(snapshot.items)&&snapshot.items.length)||(Array.isArray(snapshot.canonicalBom?.generatedRows)&&snapshot.canonicalBom.generatedRows.length))return snapshot;if(!row?.id)return snapshot;const db=await window.WinkoDB.getClient();const result=await db.from('winko_test_bom_items').select('*').eq('quotation_id',row.id).order('tank_key',{ascending:true}).order('item_name',{ascending:true});if(result.error){console.warn('[QUOTE] BOM rows could not be reconstructed',row.reference,result.error);window.WinkoErrorHandler?.report?.(result.error,'quotation-bom-restore');toast('Quotation opened without reconstructed BOM rows. Ask Main to review the BOM.','warning');return snapshot}if(!result.data?.length)return snapshot;return{...snapshot,items:result.data.map(item=>({...item.snapshot,id:item.item_key,item:item.item_name,cat:item.category,price:item.unit_price,include:item.included!==false,manualQty:item.manual_quantity,overrideReason:item.override_reason,quantity:item.quantity,quantityStatus:item.quantity_status,quantitySource:item.quantity_source,tank_key:item.tank_key||'quotation'}))}}
  async function winkoOpenQuotation(value,options={}){
    const key=safe(typeof value==='object'?(value?.id||value?.reference):value).trim(),mode=typeof options==='string'?options:(options?.mode||'review');
    const known=Object.values(readStore()).find(record=>safe(record?.reference)===key||safe(record?.supabaseId||record?.id)===key),lockKey=safe(known?.supabaseId||known?.id||known?.reference||key)+'|'+mode;
    if(openingQuotations.has(lockKey))return openingQuotations.get(lockKey);
    const previousLoad=activeQuotationLoad;
    const task=(async()=>{if(previousLoad)await previousLoad;try{
      if(window.WinkoState?.isDirty?.()&&!confirm('You have unsaved changes. Continue?'))return false;
      console.info('[QUOTE] opening',key);
      const {row,record,local}=await resolveQuotation(value),reference=safe(row.reference||record.reference).trim(),status=normalize(row.status||record.dbStatus||record.status);
      let snapshot=status==='APPROVED'?(row.approved_snapshot||record.approvedSnapshot||row.snapshot||record.snapshot):(row.snapshot||record.snapshot);
      if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new Error('Quotation snapshot is unavailable.');
      if(!local&&status!=='APPROVED')snapshot=await reconstructBom(snapshot,row);
      if(!Object.keys(snapshot).some(field=>field!=='ref'))throw new Error('Quotation snapshot is unavailable.');
      const restored={...snapshot,ref:reference,crm:{...(snapshot.crm||{}),crmRef:reference},inputs:{...(snapshot.inputs||{}),reference}};
      if(typeof window.winkoRestoreQuotationSnapshot!=='function')throw new Error('Quotation restore is unavailable.');
      window.__winkoStateHydrating=true;try{await Promise.resolve(window.winkoRestoreQuotationSnapshot(restored))}finally{window.__winkoStateHydrating=false}
      ['crmRef','ceRef','reference','qRefInput'].forEach(id=>{const field=document.getElementById(id);if(field)field.value=reference});
      window.__winkoLoadedQuotationReference=reference;window.__winkoApprovedFinalRecord=status==='APPROVED'?record:null;window.WinkoState?.markSaved?.();
      if(typeof window.prepareQuotation!=='function')throw new Error('Quotation preview is unavailable.');
      if(await Promise.resolve(window.prepareQuotation())===false){if(status==='DRAFT'||status==='CHANGES_REQUIRED')toast('Draft opened, but its quotation preview needs complete details.','warning');else throw new Error('Quotation preview could not be prepared from the saved snapshot.')}
      document.body.classList.remove('winko-sales-final','winko-sales-submitted');const page=document.getElementById('quotation');page?.classList.remove('winko-approved-final');page?.querySelector('#winkoStatusReview')?.remove();
      window.winkoSetWorkflowStep?.(role()==='sales'&&mode==='edit'?1:(role()==='sales'?2:4));window.winkoNavigate?.(role()==='sales'&&mode==='edit'?'quickEntry':'quotation');
      if(role()==='sales'&&status==='APPROVED'){document.body.classList.add('winko-sales-final');page?.classList.add('winko-approved-final');showBanner(record,status)}
      else if(role()==='sales'&&status==='PENDING_APPROVAL'){document.body.classList.add('winko-sales-submitted');showBanner(record,status)}
      else if(status==='CHANGES_REQUIRED'||(role()==='main'&&status==='PENDING_APPROVAL'))showBanner(record,status);
      window.winkoFitQuotationPreview?.();window.winkoRefreshApprovalWorkflow?.();window.winkoReviewToolbarRefresh?.();
      console.info('[QUOTE] loaded',{reference,id:row.id||record.supabaseId||null,status});return row;
    }catch(error){console.error('[QUOTE] open failed',{reference:key,operation:'quotation-open',error});window.WinkoErrorHandler?.report?.(error,'quotation-open');toast('Could not open '+(key||'quotation')+': '+(typeof error?.message==='string'?error.message:'Please retry.'),'error');return false}})();
    openingQuotations.set(lockKey,task);activeQuotationLoad=task;try{return await task}finally{openingQuotations.delete(lockKey);if(activeQuotationLoad===task)activeQuotationLoad=null;if(!activeQuotationLoad&&queuedRealtimeQuotation){const queued=queuedRealtimeQuotation;queuedRealtimeQuotation=null;queueMicrotask(()=>refreshCurrentQuotationFromRealtime(queued))}}
  }
  function refreshCurrentQuotationFromRealtime(row){const ref=safe(document.getElementById('crmRef')?.value||document.getElementById('ceRef')?.value),page=document.getElementById('quotation');if(!page?.classList.contains('active')||!ref||row.reference!==ref)return;if(activeQuotationLoad){queuedRealtimeQuotation=row;return}if(window.WinkoState?.isDirty?.()){toast('This quotation changed in the cloud. Save or discard your edits before reopening it.','warning');return}Promise.resolve(winkoOpenQuotation(row.id,{mode:'review'})).catch(error=>{console.error('Realtime quotation refresh failed.',error);window.WinkoErrorHandler?.report?.(error,'quotation-realtime')})}
  window.winkoOpenQuotation=winkoOpenQuotation;
  window.openQuotationByStatus=(value,mode='review')=>winkoOpenQuotation(value,{mode});
  window.winkoLoadApprovalQuotation=value=>winkoOpenQuotation(value,{mode:'review'});
 function isServerApprovedQuotation(record){
   const approved=normalize(record?.dbStatus||record?.status)==='APPROVED';
   if(approved&&!(record?.approvedAt||record?.approved_at))console.warn('Compatibility: approved quotation has no approved_at timestamp',record?.reference||'');
   return approved;
 }
 async function canExportFinalQuotation(reference){
   const ref=safe(reference);let record=readStore()[ref]||window.__winkoApprovedFinalRecord||null;
   if(!ref)return false;
   if(ref){
     try{
       const db=await window.WinkoDB?.getClient?.();if(!db)throw new Error('Supabase client is unavailable.');
       const session=await db.auth.getSession();if(session.error)throw session.error;if(!session.data?.session?.user)throw new Error('Sign in again to verify approval before export.');
       const remote=await window.WinkoQuotationRepository.getByReference(ref);
       if(!remote)throw new Error('Approved quotation could not be verified in the cloud.');
       window.WinkoQuotationRepository.applyServerRow(remote);record=remote;
     }catch(error){toast('Could not refresh approval status: '+safe(error?.message||error),'error');return false}
   }
   if(!isServerApprovedQuotation(record)){window.__winkoFinalExportRecord=null;return false}
   window.__winkoFinalExportRecord=record;
   return true;
 }
 window.isServerApprovedQuotation=isServerApprovedQuotation;
 window.canExportFinalQuotation=canExportFinalQuotation;
 const originalExport=window.exportQuotationPdf||window.perfectQuotationPrint;
 if(typeof originalExport==='function'){
   window.exportQuotationPdf=async function(){
     if(role()==='sales'){
       const ref=safe(document.getElementById('crmRef')?.value||document.getElementById('ceRef')?.value||window.__winkoLoadedQuotationReference);
       if(!await canExportFinalQuotation(ref)){alert('Main approval is required before Sales can export the final quotation PDF.');return false}
       const record=window.__winkoFinalExportRecord,snapshot=record?.approvedSnapshot||record?.approved_snapshot||record?.snapshot;
       if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)){alert('The approved quotation snapshot is unavailable. Please ask Main to approve this quotation again.');return false}
       try{
         if(typeof window.winkoRestoreQuotationSnapshot!=='function')throw new Error('Quotation restore is unavailable.');
         await Promise.resolve(window.winkoRestoreQuotationSnapshot(snapshot));
         ['crmRef','ceRef','reference','qRefInput'].forEach(id=>{const field=document.getElementById(id);if(field)field.value=ref});
         if(typeof window.prepareQuotation!=='function'||await Promise.resolve(window.prepareQuotation())===false)throw new Error('Approved quotation preview could not be prepared.');
       }catch(error){console.error('Approved quotation PDF preparation failed.',error);window.WinkoErrorHandler?.report?.(error,'quotation-pdf-prepare');toast('PDF export stopped: the approved quotation could not be prepared.','error');return false}
       window.__winkoFinalExportAuthorized=true;
       try{return await originalExport.apply(this,arguments)}finally{window.__winkoFinalExportAuthorized=false}
     }
     return originalExport.apply(this,arguments)
   };
   window.perfectQuotationPrint=window.exportQuotationPdf;
 }
  document.addEventListener('click',async event=>{const button=event.target.closest?.('[data-open-quotation-id]');if(!button)return;event.preventDefault();if(button.disabled)return;const label=button.textContent;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Opening…';try{await winkoOpenQuotation(button.dataset.openQuotationId,{mode:'review'})}catch(error){console.error('Quotation button failed.',error);window.WinkoErrorHandler?.report?.(error,'quotation-open-click')}finally{button.disabled=false;button.removeAttribute('aria-busy');button.textContent=label}},true);
  let realtimeSubscribed=false;
  window.winkoStartQuotationRealtime=async()=>{if(realtimeSubscribed||!window.WinkoAuth?.ready||!window.WinkoDB?.state?.client||typeof window.WinkoQuotationRepository?.subscribe!=='function')return false;await window.WinkoQuotationRepository.subscribe(refreshCurrentQuotationFromRealtime);realtimeSubscribed=true;return true};
})();
