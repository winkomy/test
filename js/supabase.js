(function(){
 'use strict';
 const SUPABASE_URL='https://yzequtnkzuyayydpqayf.supabase.co';
 const SUPABASE_PUBLISHABLE_KEY='sb_publishable_6ZYtf4b0pq4BhSyyDOMdnA_vx0Av15e';
 const TABLE={customers:'winko_test_customers',projects:'winko_test_projects',quotations:'winko_test_quotations',bom:'winko_test_bom_items',approvals:'winko_test_quotation_approvals',production:'winko_test_production_approvals',notifications:'winko_test_notifications',prices:'winko_test_price_database',numbers:'winko_test_quotation_number_settings',audit:'winko_test_audit_logs'};
 const state={mode:'local',lastError:'',client:null,channel:null,booted:false,restConnected:false,authenticated:false,currentUser:null,realtimeStatus:'idle',tableHealth:{},lastAttemptAt:null,lastSyncedAt:null,pendingCount:0,failedCount:0,pollTimer:0,pollIntervalMs:0,reconnectTimer:0,roleObserver:null,compat:{customerNormalizedTelephone:null,quotationArchive:null,approvalEventColumns:null}};
 const safe=v=>String(v==null?'':v), norm=v=>safe(v).trim().toLowerCase().replace(/\s+/g,' '), num=v=>Number.isFinite(Number(v))?Number(v):0;
 const deep=v=>{try{return JSON.parse(JSON.stringify(v))}catch(error){return v}};
  const DB_STATUS={Draft:'DRAFT','Pending Main Approval':'PENDING_APPROVAL','Changes Required':'CHANGES_REQUIRED',Approved:'APPROVED',Archived:'ARCHIVED',DRAFT:'DRAFT',PENDING_APPROVAL:'PENDING_APPROVAL',CHANGES_REQUIRED:'CHANGES_REQUIRED',APPROVED:'APPROVED',ARCHIVED:'ARCHIVED'};
  const UI_STATUS={DRAFT:'Draft',PENDING_APPROVAL:'Pending Main Approval',CHANGES_REQUIRED:'Changes Required',APPROVED:'Approved',ARCHIVED:'Archived'};
  const toDbStatus=value=>DB_STATUS[safe(value)]||safe(value||'DRAFT').toUpperCase().replace(/\s+/g,'_');
  const toUiStatus=value=>UI_STATUS[toDbStatus(value)]||safe(value||'Draft');
 const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(safe(v));
 const missingColumn=(error,column)=>{const message=safe(error?.message||error).toLowerCase(),name=column.toLowerCase();return message.includes(name+' does not exist')||message.includes("could not find the '"+name+"' column")||message.includes('column '+name+' ')};
 function setStatus(mode,error){
   state.mode=mode;state.lastError=error?safe(error.message||error):'';
   if(mode==='connected'||mode==='degraded')state.restConnected=true;
   else if(['offline','local','sync_error','error'].includes(mode))state.restConnected=false;
   const el=document.getElementById('winkoDbStatus');if(!el)return;
   const syncError=mode==='sync_error'||mode==='error',healthy=mode==='connected'||mode==='degraded';
   el.className='winko-db-status '+(healthy?'connected':syncError?'error':'');
   el.textContent=mode==='connected'?'Cloud Sync Connected':mode==='degraded'?'Cloud Sync Connected · Partial':mode==='connecting'?'Cloud Sync Connecting...':mode==='offline'?'Offline · Saved Locally':mode==='local'?'Local Mode':syncError?'Cloud Sync Error · Retry':'Local Mode';
   const failed=Object.entries(state.tableHealth||{}).filter(([,v])=>!v?.ok).map(([name,v])=>name+': '+safe(v?.error||'unavailable'));
   const realtime=state.realtimeStatus==='error'?'Realtime unavailable; automatic polling is active.':'';
   const queued=state.pendingCount?`${state.pendingCount} pending local change(s); ${state.failedCount} failed change(s) awaiting retry.`:'No pending local changes.';
   el.title=[state.lastError,queued,realtime,failed.join('\n')].filter(Boolean).join('\n')||'Shared test data connection';el.dataset.pendingSync=String(state.pendingCount||0);el.dataset.failedSync=String(state.failedCount||0);
   el.style.cursor=syncError?'pointer':'default';el.onclick=syncError?()=>window.WinkoDB?.retrySupabaseConnection?.():null;
 };
 function reportTableError(key,error){state.tableHealth[key]={ok:false,error:safe(error?.message||error),checkedAt:new Date().toISOString()};setStatus(state.restConnected?'degraded':'sync_error',error)}
 function readJson(key,fallback){try{const v=JSON.parse(localStorage.getItem(key)||'null');return v==null?fallback:v}catch(e){return fallback}}
 function writeJson(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch(e){console.warn('Local fallback write failed',e)}}
 function role(){return typeof window.getWinkoRole==='function'?window.getWinkoRole():(document.body.dataset.appRole||'main')}
 function localApprovals(){return readJson('winkoQuoteApprovalsV1',{})||{}}
 function localNotifications(){const v=readJson('winkoNotificationsV1',[]);return Array.isArray(v)?v:[]}
 function customerKey(rec){const email=norm(rec?.email),tel=norm(rec?.tel).replace(/[^0-9]/g,'');return email?'email:'+email:(tel?'tel:'+tel:'name:'+norm(rec?.customer||rec?.company_name))}
 function currentInput(id){return document.getElementById(id)?.value||''}
 function quotePayload(rec,ids){
   const snap=rec?.snapshot||{}, inputs=snap.inputs||{}, crm=snap.crm||{};
 const totals=window.__winkoQuotationTotals||{};
   return {reference:safe(rec.reference||snap.ref).trim(),customer_id:ids?.customerId||null,project_id:ids?.projectId||null,customer_name:safe(rec.customer||snap.customer||crm.crmCustomer),project_name:safe(rec.project||snap.project||crm.crmProject),status:toDbStatus(rec.status||'Draft'),prepared_by:safe(crm.crmPreparedBy||inputs.preparedBy),quotation_date:(crm.crmDate||inputs.bomDate)||null,currency:safe(totals.currency||inputs.currency||'MYR'),subtotal:num(totals.subtotal!=null?totals.subtotal:rec.amount),sst_percent:num(totals.sstPercent!=null?totals.sstPercent:(inputs.sstPct==null||inputs.sstPct===''?5:inputs.sstPct)),sst_amount:num(totals.sstAmount),grand_total:num(totals.grandTotal!=null?totals.grandTotal:rec.amount),archived:!!rec.archived,archived_at:rec.archivedAt||null,selected_preset:safe(snap.selectedPreset||''),revision:num(rec.revision),submitted_at:rec.submittedAt||null,approved_at:rec.approvedAt||null,approved_by:rec.approvedBy||null,approval_note:rec.approvalNote||'',submitted_fingerprint:rec.submittedFingerprint||null,approved_fingerprint:rec.approvedFingerprint||null,snapshot:snap};
 }
 async function getClient(){if(state.client)return state.client;if(!window.supabase?.createClient){setStatus('offline');return null}try{setStatus('connecting');state.client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});return state.client}catch(e){setStatus('sync_error',e);return null}}
 async function requireAuthenticatedUser(){const c=await getClient();if(!c)throw new Error('Supabase client is unavailable.');const sessionResult=await c.auth.getSession();if(sessionResult.error)throw sessionResult.error;const user=sessionResult.data?.session?.user||null;if(!user){const error=new Error('Sign in is required before cloud data can be changed.');error.code='AUTH_REQUIRED';throw error}state.authenticated=true;state.currentUser=user;return user}
 async function saveCustomerProjectRemoteUnsafe(rec){
   const c=state.client;if(!c||!rec)return{};
   await requireAuthenticatedUser();
   const company=safe(rec.customer||rec.company_name||'Unnamed customer').trim()||'Unnamed customer';
   const normalized=norm(company),email=safe(rec.email).trim(),emailKey=norm(email);
   const telephone=safe(rec.tel||rec.telephone),telephoneKey=telephone.replace(/[^0-9]/g,'');
   let customerId=uuid(rec.supabaseCustomerId)?rec.supabaseCustomerId:null;
   if(!customerId){
     let found=null;
     if(emailKey){
       found=await c.from(TABLE.customers).select('id').ilike('email',emailKey).limit(1);
     }else if(telephoneKey){
       if(state.compat.customerNormalizedTelephone!==false){
         found=await c.from(TABLE.customers).select('id').eq('normalized_telephone',telephoneKey).limit(1);
         if(found.error&&missingColumn(found.error,'normalized_telephone')){state.compat.customerNormalizedTelephone=false;found=null}
       }
       if(!found&&state.compat.customerNormalizedTelephone===false){
         const candidates=await fetchTable(TABLE.customers);
         customerId=candidates.find(row=>safe(row.telephone).replace(/[^0-9]/g,'')===telephoneKey)?.id||null;
       }
     }else{
       found=await c.from(TABLE.customers).select('id').eq('normalized_name',normalized).limit(1);
     }
     if(found?.error)throw found.error;
     customerId=customerId||found?.data?.[0]?.id||null;
   }
   const customer={...(customerId?{id:customerId}:{}),company_name:company,normalized_name:normalized,address:safe(rec.address),attention:safe(rec.attention),telephone,email};
   if(state.compat.customerNormalizedTelephone!==false)customer.normalized_telephone=telephoneKey;
   let cr=await c.from(TABLE.customers).upsert(customer,{onConflict:'id'}).select('id').single();
   if(cr.error&&state.compat.customerNormalizedTelephone!==false&&missingColumn(cr.error,'normalized_telephone')){
     state.compat.customerNormalizedTelephone=false;delete customer.normalized_telephone;
     cr=await c.from(TABLE.customers).upsert(customer,{onConflict:'id'}).select('id').single();
   }
   if(cr.error)throw cr.error;
   customerId=cr.data.id;
   const projectName=safe(rec.project||rec.project_name||'Project').trim()||'Project',projectNorm=norm(projectName);
   let projectId=uuid(rec.supabaseProjectId)?rec.supabaseProjectId:null;
   if(!projectId){const found=await c.from(TABLE.projects).select('id').eq('customer_id',customerId).eq('normalized_name',projectNorm).limit(1);if(found.error)throw found.error;projectId=found.data?.[0]?.id||null}
   const project={...(projectId?{id:projectId}:{}),customer_id:customerId,project_name:projectName,normalized_name:projectNorm};
   const pr=await c.from(TABLE.projects).upsert(project,{onConflict:'id'}).select('id').single();
   if(pr.error)throw pr.error;
   return{customerId,projectId:pr.data.id};
 }
 async function saveCustomerRemote(rec){
   const c=state.client;if(!c)throw new Error('Supabase is not connected.');
   await requireAuthenticatedUser();
   const company=safe(rec?.company_name||rec?.customer||'').trim();
   if(!company)throw new Error('Customer name is required.');
   const normalized=norm(company),email=safe(rec?.email).trim(),emailKey=norm(email);
   const telephone=safe(rec?.telephone||rec?.tel).trim(),telephoneKey=telephone.replace(/[^0-9]/g,'');
   let customerId=uuid(rec?.id||rec?.supabaseCustomerId)?(rec.id||rec.supabaseCustomerId):null;
   if(!customerId){
     let found=null;
     if(emailKey)found=await c.from(TABLE.customers).select('id').ilike('email',emailKey).limit(1);
     else if(telephoneKey&&state.compat.customerNormalizedTelephone!==false){
       found=await c.from(TABLE.customers).select('id').eq('normalized_telephone',telephoneKey).limit(1);
       if(found.error&&missingColumn(found.error,'normalized_telephone')){state.compat.customerNormalizedTelephone=false;found=null}
     }
     if(!found&&telephoneKey&&state.compat.customerNormalizedTelephone===false){
       const candidates=await fetchTable(TABLE.customers);
       customerId=candidates.find(row=>safe(row.telephone).replace(/[^0-9]/g,'')===telephoneKey)?.id||null;
     }
     if(!found&&!customerId)found=await c.from(TABLE.customers).select('id').eq('normalized_name',normalized).limit(1);
     if(found?.error)throw found.error;
     customerId=customerId||found?.data?.[0]?.id||null;
   }
   const payload={...(customerId?{id:customerId}:{}),company_name:company,normalized_name:normalized,address:safe(rec?.address),attention:safe(rec?.attention),telephone,email};
   if(state.compat.customerNormalizedTelephone!==false)payload.normalized_telephone=telephoneKey;
   let result=await c.from(TABLE.customers).upsert(payload,{onConflict:'id'}).select('*').single();
   if(result.error&&state.compat.customerNormalizedTelephone!==false&&missingColumn(result.error,'normalized_telephone')){
     state.compat.customerNormalizedTelephone=false;delete payload.normalized_telephone;
     result=await c.from(TABLE.customers).upsert(payload,{onConflict:'id'}).select('*').single();
   }
   if(result.error)throw result.error;
   return result.data;
 }
 const remoteCustomerLocks=new Map();
 async function saveCustomerProjectRemote(rec){
   const key=norm(rec?.customer||rec?.company_name||'Unnamed customer');
   const prior=remoteCustomerLocks.get(key)||Promise.resolve();
   const pending=prior.then(()=>saveCustomerProjectRemoteUnsafe(rec));
   const tracked=pending.finally(()=>{if(remoteCustomerLocks.get(key)===tracked)remoteCustomerLocks.delete(key)});
   remoteCustomerLocks.set(key,tracked);
   return tracked;
 }
function buildBomRowsForRemote(snapshot,quoteId){
   const hasCanonicalBom=!!snapshot?.canonicalBom,canonicalSections=Array.isArray(snapshot?.canonicalBom?.bomByTank)&&snapshot.canonicalBom.bomByTank.length?snapshot.canonicalBom.bomByTank:(Array.isArray(snapshot?.bomByTank)?snapshot.bomByTank:[]),canonicalRows=Array.isArray(snapshot?.canonicalBom?.generatedRows)?snapshot.canonicalBom.generatedRows:[];
   if(hasCanonicalBom&&!canonicalSections.length&&!canonicalRows.length)throw new Error('BOM calculation unavailable. Recalculate in the current quotation before saving.');
   if(canonicalSections.length)return canonicalSections.flatMap((section,sectionIndex)=>(section.rows||[]).map((row,index)=>{const quantity=Number(row.effectiveQty??row.effective??row.quantity)||0,price=Number(row.unitPrice)||0,key=safe(row.canonicalKey||row.itemCode||row.internalKey||('canonical-'+index)),tankKey=safe(section.tankKey||row.tankKey||('tank-'+(sectionIndex+1)));return {quotation_id:quoteId,tank_key:tankKey,item_key:key,category:safe(row.category),item_name:safe(row.item||row.dynamicName||row.description||row.itemCode||'BOM item'),quantity,unit_price:price,line_total:quantity*price,included:quantity>0,quantity_source:safe(row.source||'index.html'),quantity_status:safe(row.status||row.confidence||'Generated'),manual_quantity:Number(row.adjustmentQty??row.adjustment)||0,override_reason:safe(row.adjustmentReason||''),snapshot:{...row,tankKey,tankIndex:section.tankIndex||sectionIndex+1,dimensions:section.dimensions,tankQty:section.tankQty,bomSchemaVersion:snapshot.canonicalBom.bomSchemaVersion,bomEngineVersion:snapshot.canonicalBom.bomEngineVersion,bomTemplateVersion:snapshot.canonicalBom.bomTemplateVersion,formulaOwner:'index.html'}}}).filter(row=>row.included||row.quantity>0));
   if(canonicalRows.length)return canonicalRows.map((row,index)=>{const quantity=Number(row.effectiveQty??row.effective??row.quantity)||0,price=Number(row.unitPrice)||0,key=safe(row.canonicalKey||row.itemCode||row.internalKey||('canonical-'+index));return {quotation_id:quoteId,tank_key:'legacy-combined',item_key:key,category:safe(row.category),item_name:safe(row.item||row.description||row.itemCode||'BOM item'),quantity,unit_price:price,line_total:quantity*price,included:quantity>0,quantity_source:safe(row.source||'index.html'),quantity_status:safe(row.status||'Generated'),manual_quantity:Number(row.adjustmentQty??row.adjustment)||0,override_reason:safe(row.adjustmentReason||''),snapshot:{...row,bomSchemaVersion:snapshot.canonicalBom.bomSchemaVersion,bomEngineVersion:snapshot.canonicalBom.bomEngineVersion,bomTemplateVersion:snapshot.canonicalBom.bomTemplateVersion,formulaOwner:'index.html',legacyCombined:true}}}).filter(row=>row.included||row.quantity>0);
   const savedItems=Array.isArray(snapshot?.items)?snapshot.items:[];
   const liveItems=typeof items!=='undefined'&&Array.isArray(items)?items:[];
   const sourceItems=savedItems.length?savedItems:liveItems;
   const tankList=Array.isArray(snapshot?.quoteTanks)?snapshot.quoteTanks:[];
   const formulaFor=(saved)=>{
     const live=liveItems.find(x=>safe(x.id)===safe(saved?.id)||safe(x.item)===safe(saved?.item));
     if(live)return {...live,...saved,formula:saved?.formula||live.formula};
     const def=typeof defaultItems!=='undefined'?defaultItems.find(x=>safe(x.id)===safe(saved?.id)||safe(x.item)===safe(saved?.item)):null;
     return {...(def||{}),...saved,formula:saved?.formula||def?.formula||null};
   };
   const inputValue=(inputs,key)=>inputs?.[key]??'';
   const fallbackTank=()=>{
     const inputs=snapshot?.inputs||{},unit=safe(inputValue(inputs,'dimensionUnit')||'ft')==='m'?'m':'ft';
     const toFt=v=>unit==='m'?Number(v||0)/0.3048:Number(v||0);
     const t={id:'tank-1',length:toFt(inputValue(inputs,'length')),width:toFt(inputValue(inputs,'width')),height:toFt(inputValue(inputs,'height')),panelSize:Math.max(toFt(inputValue(inputs,'panelSize')),0.0001),dimensionUnit:unit,displayLength:Number(inputValue(inputs,'length'))||0,displayWidth:Number(inputValue(inputs,'width'))||0,displayHeight:Number(inputValue(inputs,'height'))||0,displayPanelSize:Number(inputValue(inputs,'panelSize'))||0,qty:Math.max(Number(inputValue(inputs,'tankQty'))||1,1),partitions:Array.isArray(inputs.partitions)?inputs.partitions:[]};
     ['manhole','roofThickness','wallL1Thickness','wallL2Thickness','wallL3Thickness','wallL4Thickness','baseThickness','tankFinish','internalLiner','baseSupport','complianceStandard','tankScopeNote','extLadderRequired','extLadderQty','intLadderRequired','intLadderQty','safetyCageRequired','safetyCageQty','airVentRequired','airVentQty','airVentSize','wliRequired','wliQty','manholeAccessoryQty','partitionRequired','partitionType','partitionLength','partitionWidth','partitionQty'].forEach(key=>{const value=inputValue(inputs,key);t[key]=/Qty|Size|Thickness|Length|Width|manhole$|partitionQty/i.test(key)?Number(value)||0:value});
     t.partitionUnit=unit;
     return t;
   };
   const tanks=tankList.length?tankList:[fallbackTank()];
   const rows=[];
   tanks.forEach((tank,index)=>{
     const t={...tank,id:safe(tank?.id||tank?.key||`tank-${index+1}`)};
     const tankStateValue={length:Number(t.length)||0,width:Number(t.width)||0,height:Number(t.height)||0,panelSize:Number(t.panelSize)||4,manhole:Number(t.manholeAccessoryQty??t.manhole)||0,lp:(Number(t.length)||0)/(Number(t.panelSize)||4),wp:(Number(t.width)||0)/(Number(t.panelSize)||4),hp:(Number(t.height)||0)/(Number(t.panelSize)||4)};
     window.__activeTankForAccessory=t;
     sourceItems.forEach((saved,i)=>{
       const x=formulaFor(saved);
       const quantity=(Number(itemQuantity(x,tankStateValue))||0)*Math.max(Number(t.qty)||1,1);
       const source=quantitySourceInfo(x,tankStateValue);
       const price=Number(x.price||x.unitPrice)||0;
       rows.push({quotation_id:quoteId,tank_key:t.id,item_key:safe(x.id||x.item||('item-'+i)),category:safe(x.cat||x.category),item_name:safe(x.item||x.name||'Item'),quantity,unit_price:price,line_total:quantity*price,included:x.include!==false,quantity_source:safe(source.label),quantity_status:safe(quantityStatus(x,tankStateValue)),manual_quantity:x.manualQty===''||x.manualQty==null?null:num(x.manualQty),override_reason:safe(x.overrideReason||''),snapshot:{...x,quantity,quantitySource:source.label,quantityStatus:quantityStatus(x,tankStateValue),tank_key:t.id}});
     });
   });
   window.__activeTankForAccessory=null;
   return rows.filter(row=>row.included||row.quantity>0);
 }
 const PENDING_BOM_SAVE_KEY='winkoPendingBomSavesV1';
 function pendingBomSaves(){const value=readJson(PENDING_BOM_SAVE_KEY,{});return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
 function queuePendingBomSave(snapshot,quoteId,reference){
   if(!snapshot||!quoteId)return;
   const all=pendingBomSaves(),key=safe(quoteId||reference);
   all[key]={quoteId,reference:safe(reference),snapshot:deep(snapshot),queuedAt:new Date().toISOString()};
   writeJson(PENDING_BOM_SAVE_KEY,all);
 }
 function removePendingBomSave(quoteId,reference){
   const all=pendingBomSaves(),key=safe(quoteId||reference);
   if(!Object.prototype.hasOwnProperty.call(all,key))return;
   delete all[key];writeJson(PENDING_BOM_SAVE_KEY,all);
 }
 async function flushPendingBomSaves(){
   const all=pendingBomSaves(),failed=[],recovered=[];
   for(const [key,entry] of Object.entries(all)){
     if(!entry?.quoteId||!entry?.snapshot){delete all[key];continue}
     try{await saveBomRemote(entry.snapshot,entry.quoteId);delete all[key];recovered.push(entry.reference||key)}
     catch(error){failed.push({key,reference:entry.reference||key,error})}
   }
   writeJson(PENDING_BOM_SAVE_KEY,all);
   return{recovered,failed};
 }
 async function saveBomRemote(snapshot,quoteId){
   if(!state.client||!quoteId||(!Array.isArray(snapshot?.items)&&!snapshot?.canonicalBom))return null;
   const rows=buildBomRowsForRemote(snapshot,quoteId);
   const r=await state.client.rpc('winko_test_replace_bom',{quotation_id:quoteId,bom_rows:rows});
   if(r.error){
     const message=safe(r.error.message||r.error);
     if(/function|rpc|could not find|does not exist|42883/i.test(message)){
       const old=await state.client.from(TABLE.bom).select('id').eq('quotation_id',quoteId);
       if(old.error){reportTableError('bom',old.error);throw old.error}
       let inserted=[];
       try{
         if(rows.length){const direct=await state.client.from(TABLE.bom).insert(rows).select('id');if(direct.error)throw direct.error;inserted=direct.data||[]}
         if(old.data?.length){const removed=await state.client.from(TABLE.bom).delete().in('id',old.data.map(row=>row.id));if(removed.error)throw removed.error}
         return inserted;
       }catch(error){
         /* The compatibility path cannot be a true database transaction. If
            replacing old rows fails, remove the newly inserted batch so a
            retry cannot leave duplicate BOM lines behind. */
         if(inserted.length){const rollback=await state.client.from(TABLE.bom).delete().in('id',inserted.map(row=>row.id));if(rollback.error)console.error('BOM compatibility rollback failed.',rollback.error)}
         reportTableError('bom',error);throw error;
       }
     }
     reportTableError('bom',r.error);throw r.error
   }
   return r.data;
 }
async function saveQuotationRecord(rec){
   const c=await getClient();if(!c||!rec)return null;
   try{
     await requireAuthenticatedUser();
     const ids=await saveCustomerProjectRemote({customer:rec.customer,address:rec.address||rec.snapshot?.crm?.crmAddress,attention:rec.attention||rec.snapshot?.crm?.crmAttention,tel:rec.tel||rec.snapshot?.crm?.crmTel,email:rec.email||rec.snapshot?.crm?.crmEmail,project:rec.project,supabaseCustomerId:rec.supabaseCustomerId,supabaseProjectId:rec.supabaseProjectId});
     const payload=quotePayload(rec,ids);if(!payload.reference)throw new Error('Quotation reference is required');
     const withoutArchiveFields=source=>{const value={...source};delete value.archived;delete value.archived_at;return value};
     const writeQuotation=async writer=>{
       let result=await writer(state.compat.quotationArchive===false?withoutArchiveFields(payload):payload);
       if(result.error&&state.compat.quotationArchive!==false&&(missingColumn(result.error,'archived')||missingColumn(result.error,'archived_at'))){
         state.compat.quotationArchive=false;
         result=await writer(withoutArchiveFields(payload));
       }
       if(!result.error&&state.compat.quotationArchive===null)state.compat.quotationArchive=true;
       return result;
     };
     let q;
     if(rec.supabaseId){
       const existing=await c.from(TABLE.quotations).select('id,reference').eq('id',rec.supabaseId).limit(1);if(existing.error)throw existing.error;if(!existing.data?.length)throw new Error('The existing quotation record could not be found. Reload quotations before saving.');
       const conflict=await c.from(TABLE.quotations).select('id').eq('reference',payload.reference).neq('id',rec.supabaseId).limit(1);if(conflict.error)throw conflict.error;if(conflict.data?.length){const error=new Error('This quotation reference already exists. A new quotation number is required.');error.code='DUPLICATE_QUOTATION_REFERENCE';throw error}
       q=await writeQuotation(body=>c.from(TABLE.quotations).update(body).eq('id',rec.supabaseId).select().single());
     }else{
       const conflict=await c.from(TABLE.quotations).select('id,customer_name,project_name').eq('reference',payload.reference).limit(1);if(conflict.error)throw conflict.error;
       const existingRemote=conflict.data?.[0];
       if(existingRemote&&['local-only','pending','error'].includes(rec.syncStatus)&&norm(existingRemote.customer_name)===norm(payload.customer_name)&&norm(existingRemote.project_name)===norm(payload.project_name)){
         rec.supabaseId=existingRemote.id;q=await writeQuotation(body=>c.from(TABLE.quotations).update(body).eq('id',existingRemote.id).select().single());
       }else if(existingRemote){const error=new Error('This quotation reference already exists. A new quotation number is required.');error.code='DUPLICATE_QUOTATION_REFERENCE';throw error}
       else q=await writeQuotation(body=>c.from(TABLE.quotations).insert(body).select().single());
     }
     if(q.error)throw q.error;rec.supabaseId=q.data.id;rec.supabaseCustomerId=ids.customerId;rec.supabaseProjectId=ids.projectId;
     try{await saveBomRemote(payload.snapshot,q.data.id);removePendingBomSave(q.data.id,payload.reference)}catch(error){queuePendingBomSave(payload.snapshot,q.data.id,payload.reference);throw error}
     try{await saveAudit({quotation_id:q.data.id,quotation_reference:payload.reference,action:'quotation_'+payload.status.toLowerCase().replace(/[^a-z0-9]+/g,'_'),role:role(),details:{status:payload.status}})}catch(error){console.warn('Quotation saved, but its audit event could not be recorded.',error);window.WinkoErrorHandler?.report?.(error,'quotation-audit')}
     return q.data;
   }catch(error){
     /* A rejected save is an operation error, not proof that the quotations
        table is offline. Keep the successful connectivity probe authoritative
        so one bad/stale record does not poison the global Cloud Sync badge. */
     state.lastError=safe(error?.message||error);
     setStatus(state.restConnected?'degraded':'sync_error',error);
     window.WinkoErrorHandler?.report(error,'quotation-save');throw error
   }
 }
 async function archiveQuotationRemote(reference,archived=true,quotationId=''){const c=await getClient();if(!c||!reference)throw new Error('Supabase is not connected');await requireAuthenticatedUser();const payload={archived:!!archived,archived_at:archived?new Date().toISOString():null};const query=uuid(quotationId)?c.from(TABLE.quotations).update(payload).eq('id',quotationId):c.from(TABLE.quotations).update(payload).eq('reference',safe(reference));let result=await query.select('id,reference,archived,archived_at').limit(1);if(result.error&& (missingColumn(result.error,'archived')||missingColumn(result.error,'archived_at'))){throw new Error('The quotation archive fields are missing from Supabase. Apply the existing quotation archive migration, then retry.')}if(result.error)throw result.error;if(!Array.isArray(result.data)||!result.data.length)throw new Error('The quotation was not found or Main does not have permission to archive it.');return result.data[0]}
 async function deleteProjectRemote(projectId){const c=await getClient();if(!c||!uuid(projectId))throw new Error('Project is not synced');const q=await c.from(TABLE.quotations).select('id',{head:true,count:'exact'}).eq('project_id',projectId);if(q.error)throw q.error;if(Number(q.count)>0)throw new Error('This project contains quotations. Delete or archive quotations first.');const r=await c.from(TABLE.projects).delete().eq('id',projectId);if(r.error)throw r.error;return true}
 async function deleteCustomerRemote(customerId){const c=await getClient();if(!c||!uuid(customerId))throw new Error('Customer is not synced');await requireAuthenticatedUser();const q=await c.from(TABLE.quotations).update({customer_id:null,project_id:null,customer_name:null,project_name:null}).eq('customer_id',customerId).select('id');if(q.error)throw q.error;const p=await c.from(TABLE.projects).delete().eq('customer_id',customerId).select('id');if(p.error)throw p.error;const r=await c.from(TABLE.customers).delete().eq('id',customerId).select('id').maybeSingle();if(r.error)throw r.error;if(!r.data)throw new Error('The customer was not found or Main does not have permission to remove it.');return true}
 async function saveNotificationRemote(n){
   const c=await getClient();if(!c||!n)return null;
   await requireAuthenticatedUser();
   const p={target_role:safe(n.targetRole),type:safe(n.type||'update'),quotation_id:uuid(n.quotationId)?n.quotationId:null,quotation_reference:safe(n.reference),customer_name:safe(n.customer),project_name:safe(n.project),title:safe(n.title||'Quotation update'),message:safe(n.message),event_key:safe(n.eventKey||[n.targetRole,n.type,n.reference,n.createdAt].join('|')),is_read:!!n.read};
   const found=await c.from(TABLE.notifications).select('id').eq('event_key',p.event_key).limit(1);if(found.error)throw found.error;
   const r=found.data?.[0]?.id?await c.from(TABLE.notifications).update(p).eq('id',found.data[0].id).select().single():await c.from(TABLE.notifications).insert(p).select().single();
   if(r.error)throw r.error;return r.data;
 }
 async function setNotificationReadRemote(n,read){if(!n)return null;return saveNotificationRemote({...n,read:!!read})}
 async function loadProductionApprovalRemote(referenceOrQuotationId){const c=await getClient();if(!c)return null;const session=await c.auth.getSession();if(session.error)throw session.error;if(!session.data?.session)return null;let quotationId=uuid(referenceOrQuotationId)?referenceOrQuotationId:null;if(!quotationId&&referenceOrQuotationId){const q=await c.from(TABLE.quotations).select('id').eq('reference',safe(referenceOrQuotationId)).limit(1);if(q.error)throw q.error;quotationId=q.data?.[0]?.id||null}if(!quotationId){window.winkoRemoteProductionApproval=null;return null}const r=await c.from(TABLE.production).select('*').eq('quotation_id',quotationId).order('created_at',{ascending:false}).limit(1);if(r.error)throw r.error;const row=r.data?.[0]||null;window.winkoRemoteProductionApproval=row?{...row,reference:safe(referenceOrQuotationId),fingerprint:row.bom_fingerprint,approvedBy:row.approved_by,approvedAt:row.approved_at||row.created_at}:null;window.winkoRemoteProductionApprovalLoaded=true;try{updateProductionApprovalUI?.(state())}catch(error){console.warn('Production approval display did not refresh.',error);window.WinkoErrorHandler?.report?.(error,'production-approval-display')}return window.winkoRemoteProductionApproval}
 async function saveProductionApprovalRemote(a){
   const c=await getClient();if(!c||!a)return null;await requireAuthenticatedUser();let quotationId=uuid(a.quotationId)?a.quotationId:null;
   const linked=a.quotation||(!quotationId&&a.reference?localApprovals()[a.reference]:null);
   if(!quotationId&&linked?.snapshot){const quote={...linked,reference:linked.reference||a.reference,status:linked.status||'Draft',syncStatus:linked.syncStatus||'pending'};const saved=await saveQuotationRecord(quote);quotationId=saved?.id||quote.supabaseId||null}
   if(!quotationId&&a.reference){const q=await c.from(TABLE.quotations).select('id').eq('reference',a.reference).limit(1);if(q.error)throw q.error;quotationId=q.data?.[0]?.id||null}
   if(!quotationId)throw new Error('Production approval needs a synced quotation reference. Save the quotation first.');
   const existing=await c.from(TABLE.production).select('*').eq('quotation_id',quotationId).eq('bom_fingerprint',safe(a.fingerprint)).order('created_at',{ascending:false}).limit(1);if(existing.error)throw existing.error;
   if(existing.data?.[0]){const row=existing.data[0];window.winkoRemoteProductionApproval={...row,reference:a.reference||''};window.winkoRemoteProductionApprovalLoaded=true;return row}
   const r=await c.from(TABLE.production).insert({quotation_id:quotationId,bom_fingerprint:safe(a.fingerprint),approved_by:safe(a.approvedBy),status:'APPROVED FOR PRODUCTION',notes:safe(a.notes||'')}).select().single();if(r.error){reportTableError('production',r.error);throw r.error}window.winkoRemoteProductionApproval={...r.data,reference:a.reference||''};window.winkoRemoteProductionApprovalLoaded=true;return r.data
 }
 async function savePriceDatabaseRemote(map){if(!map)return[];const c=await getClient();if(!c)throw new Error('Supabase client unavailable; reconnect before syncing prices.');await requireAuthenticatedUser();const rows=Object.entries(map).filter(([,v])=>!v?.archived).map(([itemKey,v])=>({item_key:itemKey,item_name:safe(v?.name||v?.item_name||itemKey),category:safe(v?.category||''),price:num(v?.price),currency:['MYR','SGD','USD'].includes(v?.currency)?v.currency:'MYR'}));if(!rows.length)return[];const r=await c.from(TABLE.prices).upsert(rows,{onConflict:'item_key'}).select();if(r.error){reportTableError('prices',r.error);throw r.error}if(!Array.isArray(r.data)||r.data.length!==rows.length)throw new Error(`Price sync verification failed: submitted ${rows.length} active price rows but Supabase confirmed ${r.data?.length||0}.`);/* The price table is intentionally kept schema-compatible. Store the audit-only
    source/status/default flags in the existing audit log rather than silently
    losing them after a cross-device refresh. */
   try{await saveAudit({action:'price_metadata_snapshot',role:role(),details:{metadataVersion:1,prices:window.winkoPriceMetadataSnapshot?.({...((typeof priceDatabase==='object'&&priceDatabase)||{}),...map})||{}}})}catch(error){console.warn('Price metadata audit could not be saved.',error)}
   return r.data||[]}
 async function saveNumberSettingsRemote(s){const c=await getClient();if(!c||!s)return null;await requireAuthenticatedUser();const r=await c.from(TABLE.numbers).upsert({id:true,prefix:s.prefix,year:s.year,next_sequence:num(s.nextSequence)||1,digits:num(s.digits)||3,auto_number:s.autoNumber!==false,reset_each_year:s.resetEachYear!==false},{onConflict:'id'}).select().single();if(r.error){reportTableError('numbers',r.error);throw r.error}return r.data}
 async function loadNumberSettingsRemote(){const c=await getClient();if(!c)return null;const r=await c.from(TABLE.numbers).select('*').eq('id',true).limit(1);if(r.error)throw r.error;const x=r.data?.[0];return x?{version:2,prefix:x.prefix,year:x.year,nextSequence:x.next_sequence,digits:x.digits,autoNumber:x.auto_number,resetEachYear:x.reset_each_year}:null}
 async function allocateQuotationNumber(){const c=await getClient();if(!c)throw new Error('Supabase client unavailable');const r=await c.rpc('winko_test_allocate_quotation_number');if(r.error){reportTableError('numbers',r.error);throw r.error}const value=Array.isArray(r.data)?r.data[0]:r.data;if(typeof value==='string')return value;return value?.quotation_number||value?.reference||value?.next_reference||null}
 async function saveAudit(a){const c=await getClient();if(!c)throw new Error('Audit database is unavailable.');if(!a?.action)throw new Error('Audit action is required.');const r=await c.from(TABLE.audit).insert({quotation_id:uuid(a.quotation_id)?a.quotation_id:null,quotation_reference:a.quotation_reference||null,action:safe(a.action),role:a.role||role(),details:a.details||{}});if(r.error){reportTableError('audit',r.error);throw r.error}return true}
 function hydrateQuotations(rows){
   if(!Array.isArray(rows))return;
   const cache=localApprovals(),remoteRefs=new Set(),next={};
    rows.forEach(row=>{const ref=safe(row.reference).trim();if(!ref)return;remoteRefs.add(ref);const old=cache[ref]||Object.values(cache).find(item=>item?.supabaseId===row.id||safe(item?.reference).trim()===ref)||{},dbStatus=toDbStatus(row.status),normalizeSnapshot=value=>{const result=deep(value||{});result.ref=ref;result.crm={...(result.crm||{}),crmRef:ref};result.inputs={...(result.inputs||{}),reference:ref};return result},serverSnapshot=normalizeSnapshot(row.snapshot),approvedSnapshot=row.approved_snapshot?normalizeSnapshot(row.approved_snapshot):(dbStatus==='APPROVED'?deep(serverSnapshot):null);next[ref]={...old,reference:ref,customer:row.customer_name||'',project:row.project_name||'',status:toUiStatus(row.status),dbStatus,amount:num(row.grand_total),currency:row.currency||old.currency||'MYR',subtotal:num(row.subtotal),sstPercent:num(row.sst_percent),sstAmount:num(row.sst_amount),revision:row.revision||0,submittedAt:row.submitted_at||null,submittedBy:row.submitted_by||null,ownerUserId:row.owner_user_id||null,approvedAt:row.approved_at||null,approvedBy:uuid(row.approved_by)?'Main':(row.approved_by||null),approvalNote:row.approval_note||'',submittedFingerprint:row.submitted_fingerprint||null,approvedFingerprint:row.approved_fingerprint||null,snapshot:serverSnapshot,approvedSnapshot,returnedAt:row.returned_at||null,returnedBy:row.returned_by||null,updatedAt:row.updated_at||row.created_at,supabaseId:row.id,archived:!!row.archived,archivedAt:row.archived_at||null,syncStatus:'synced',recordType:'quotation'}});
   Object.entries(cache).forEach(([key,old])=>{const ref=safe(old?.reference||key).trim();if(ref&&!remoteRefs.has(ref)&&old?.syncStatus!=='synced')next[ref]={...old,reference:ref,syncStatus:old?.syncStatus||'local-only'}});
   writeJson('winkoQuoteApprovalsV1',next);
 }
 function hydrateNotifications(rows){
   if(!Array.isArray(rows))return;
   const local=localNotifications(),localByKey=new Map(local.map(item=>[safe(item?.eventKey||item?.id),item])),remoteKeys=new Set(),next=[];
   rows.forEach(row=>{const n={id:row.id,eventKey:row.event_key||row.id,targetRole:row.target_role,type:row.type,quotationId:row.quotation_id,reference:row.quotation_reference||'',customer:row.customer_name||'',project:row.project_name||'',title:row.title,message:row.message,createdAt:row.created_at,read:!!row.is_read,syncStatus:'synced'};remoteKeys.add(n.eventKey);const pending=localByKey.get(safe(n.eventKey));next.push(pending&&(pending.syncStatus!=='synced'||pending.syncReadPending)?{...n,...pending,id:n.id||pending.id,eventKey:n.eventKey,syncStatus:pending.syncStatus||'pending'}:n)});
   local.filter(n=>!remoteKeys.has(safe(n.eventKey||n.id))&&(n.syncStatus!=='synced'||n.syncReadPending)).forEach(n=>next.push({...n,syncStatus:n.syncStatus||'local-only'}));
   writeJson('winkoNotificationsV1',next.sort((a,b)=>safe(b.createdAt).localeCompare(safe(a.createdAt))).slice(0,200));
 }
 function hydrateCustomers(customers,projects,quotations){
   if(typeof customerProjects==='undefined')return;
   const cm=new Map((customers||[]).map(x=>[x.id,x])),remote=[];
   // Keep customer identities even when a customer has no project yet. The
   // Main customer browser uses this Supabase-backed collection as its source
   // of truth, while projects and quotations remain lightweight history rows.
   (customers||[]).forEach(c=>remote.push({id:'C'+c.id,recordType:'customer',supabaseCustomerId:c.id,customer:c.company_name||'',address:c.address||'',attention:c.attention||'',tel:c.telephone||'',email:c.email||'',project:'',status:'Draft',updatedAt:c.updated_at||c.created_at,syncStatus:'synced',customerKey:customerKey({customer:c.company_name,email:c.email,tel:c.telephone})}));
   (projects||[]).forEach(p=>{const c=cm.get(p.customer_id)||{};remote.push({id:'S'+p.id,recordType:'project',supabaseProjectId:p.id,supabaseCustomerId:p.customer_id,customer:c.company_name||'',address:c.address||'',attention:c.attention||'',tel:c.telephone||'',email:c.email||'',project:p.project_name||'',status:'Draft',updatedAt:p.updated_at||p.created_at,syncStatus:'synced',customerKey:customerKey({customer:c.company_name,email:c.email,tel:c.telephone})})});
    (quotations||[]).forEach(q=>{const c=cm.get(q.customer_id)||{};remote.push({id:'Q'+q.id,recordType:'quotation',supabaseId:q.id,supabaseProjectId:q.project_id,supabaseCustomerId:q.customer_id,customer:q.customer_name||c.company_name||'',address:c.address||'',attention:c.attention||'',tel:c.telephone||'',email:c.email||'',project:q.project_name||'',reference:q.reference||'',preparedBy:q.prepared_by||'',date:q.quotation_date||'',status:toUiStatus(q.status),dbStatus:toDbStatus(q.status),amount:num(q.grand_total),currency:q.currency||'MYR',archived:!!q.archived,archivedAt:q.archived_at||null,updatedAt:q.updated_at||q.created_at,syncStatus:'synced',customerKey:customerKey({customer:q.customer_name||c.company_name,email:c.email,tel:c.telephone})})});
   const local=Array.isArray(customerProjects)?customerProjects.filter(x=>x?.syncStatus!=='synced'):[];
   const recordKey=x=>x?.reference||x?.supabaseProjectId||[customerKey(x),norm(x?.project),safe(x?.id)].join('|');
   const seen=new Set(remote.map(recordKey));local.forEach(x=>{const k=recordKey(x);if(!seen.has(k)){remote.push({...x,syncStatus:x.syncStatus||'local-only'});seen.add(k)}});customerProjects=remote;
   try{saveExtendedData();renderCustomerProjectOptions?.();renderCustomerHistory?.()}catch(error){console.warn('Customer/project cache could not refresh after cloud load.',error);window.WinkoErrorHandler?.report?.(error,'customer-project-refresh')}
 }
 const TABLE_ORDER_KEY={[TABLE.prices]:'item_key',[TABLE.numbers]:'id'};
 async function fetchTable(name){
   const orderKey=TABLE_ORDER_KEY[name]||'id',pageSize=500,maxPages=1000,rows=[];
   for(let page=0;page<maxPages;page++){
     const from=page*pageSize,to=from+pageSize-1;
     const result=await state.client.from(name).select('*').order(orderKey,{ascending:true}).range(from,to);
     if(result.error)throw result.error;
     const chunk=Array.isArray(result.data)?result.data:[];rows.push(...chunk);
     if(chunk.length<pageSize)return rows;
   }
   throw new Error('Sync stopped after the safe pagination limit while loading '+name+'.');
 }
 async function probeTable(name){const r=await state.client.from(name).select('id',{head:true,count:'exact'});if(r.error)throw r.error;return{healthOnly:true,count:Number(r.count)||0}}
 let syncTimer=0;
 function scheduleRemoteSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncRemote().catch(e=>{state.lastError=safe(e?.message||e);window.WinkoErrorHandler?.report(e,'supabase-sync')}),300)}
 function stopPolling(){if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=0}state.pollIntervalMs=0}
 function startPolling(intervalMs=12000){const delay=Math.max(12000,Number(intervalMs)||12000);if(state.pollTimer&&state.pollIntervalMs===delay)return;stopPolling();state.pollIntervalMs=delay;state.pollTimer=setInterval(()=>{if(!document.hidden)syncRemote().catch(error=>{console.warn('Scheduled cloud sync failed.',error);window.WinkoErrorHandler?.report?.(error,'supabase-sync-poll')})},delay)}
 function scheduleRealtimeReconnect(){if(state.reconnectTimer)return;state.reconnectTimer=setTimeout(async()=>{state.reconnectTimer=0;try{if(state.channel)await state.client?.removeChannel?.(state.channel)}catch(error){console.warn('Realtime channel cleanup failed.',error);window.WinkoErrorHandler?.report?.(error,'supabase-realtime-cleanup')}state.channel=null;subscribe()},5000)}
 const OUTBOX=()=>window.winkoSyncOutbox;
 const OUTBOX_PENDING_STATUSES=new Set(['pending','error','local-only']);
 async function ensureQueuedLocalWrites(){
   const queue=OUTBOX(),userId=safe(state.currentUser?.id);if(!queue||!userId)return;
   const box=await queue.list(),operations=box.operations||{};
   const addIfMissing=async(key,type,id,payload)=>{if(!operations[key]){await queue.put(type,id,payload,userId);operations[key]={key,type,id,payload,ownerUserId:userId}}else if(operations[key].ownerUserId===userId){await queue.refresh?.(type,id,payload,userId);operations[key]={...operations[key],type,id,payload,ownerUserId:userId}}};
   for(const record of Object.values(localApprovals())){
     const ref=safe(record?.reference).trim(),status=safe(record?.syncStatus),updated=Date.parse(record?.updatedAt||'')||0;
     if(ref&&record?.ownerUserId===userId&&OUTBOX_PENDING_STATUSES.has(status)&&(!record.pendingTransition||status!=='pending'||Date.now()-updated>15000))await addIfMissing('quotation:'+ref,'quotation',ref,{record});
     if(ref&&record?.pendingArchiveSync?.ownerUserId===userId)await addIfMissing('archive:'+ref,'archive',ref,{reference:ref,quotationId:record.supabaseId||'',archived:!!record.pendingArchiveSync.archived,archivedAt:record.pendingArchiveSync.archivedAt||null});
   }
   if(typeof customerProjects!=='undefined'&&Array.isArray(customerProjects))for(const record of customerProjects){const id=safe(record?.id),status=safe(record?.syncStatus),age=Date.now()-(Date.parse(record?.updatedAt||'')||0);if(id&&record?.recordType!=='quotation'&&record?.ownerUserId===userId&&OUTBOX_PENDING_STATUSES.has(status)&&!(status==='pending'&&age<15000))await addIfMissing('customer-project:'+id,'customer-project',id,{record})}
   for(const notification of localNotifications()){const key=safe(notification?.eventKey||notification?.id),status=safe(notification?.syncStatus),age=Date.now()-(Date.parse(notification?.syncRequestedAt||notification?.createdAt||'')||0);if(key&&notification?.createdByUserId===userId&&(OUTBOX_PENDING_STATUSES.has(status)||notification.syncReadPending)&&!(status==='pending'&&age<15000))await addIfMissing('notification:'+key,'notification',key,{notification})}
   if(role()==='main'){
     if(typeof priceDatabase!=='undefined'&&priceDatabase&&typeof priceDatabase==='object'){const pendingEntries=Object.entries(priceDatabase).filter(([,record])=>['UNSAVED','SAVED','SYNC ERROR','LOCAL ONLY'].includes(safe(record?.status))||safe(record?.syncStatus)==='SYNC ERROR'),automatic=pendingEntries.filter(([,record])=>record?.autoGenerated===true||record?.legacyFallbackMigrated===true),manual=pendingEntries.filter(([,record])=>!automatic.includes(record));if(automatic.length)await addIfMissing('auto-prices:auto-registered','auto-prices','auto-registered',{keys:automatic.map(([key])=>key)});if(manual.length)await addIfMissing('prices:pending-local-prices','prices','pending-local-prices',{prices:Object.fromEntries(manual)})}
     const pending=readJson('winkoProductionBomApprovalV1',null),status=safe(pending?.syncStatus),approvalAge=Date.now()-(Date.parse(pending?.approvedAt||'')||0);
     if(pending?.reference&&pending?.ownerUserId===userId&&OUTBOX_PENDING_STATUSES.has(status)&&!(status==='pending'&&approvalAge<15000))await addIfMissing('production:'+pending.reference,'production',pending.reference,{approval:pending});
     const numberPending=readJson('winkoPendingQuotationNumberSettingsV1',null);
     const numberAge=Date.now()-(Date.parse(numberPending?.requestedAt||'')||0);if(numberPending?.ownerUserId===userId&&numberPending.settings&&numberAge>=15000)await addIfMissing('number-settings:number-settings','number-settings','number-settings',{settings:numberPending.settings});
   }
 }
 function setLocalNotificationSynced(eventKey,row){const rows=localNotifications(),entry=rows.find(item=>safe(item?.eventKey||item?.id)===safe(eventKey));if(!entry)return;entry.id=row?.id||entry.id;entry.syncStatus='synced';entry.syncReadPending=false;delete entry.syncError;delete entry.nextSyncAttemptAt;writeJson('winkoNotificationsV1',rows)}
 async function flushSyncOutbox(){
   const queue=OUTBOX(),userId=safe(state.currentUser?.id),result={synced:[],failed:[],pendingCount:0,failedCount:0};
   if(!queue||!userId)return result;
   await ensureQueuedLocalWrites();
   let box=await queue.list(),operations=box.operations||{};
   const owned=Object.values(operations).filter(item=>item?.ownerUserId===userId);result.pendingCount=owned.length;
   for(const operation of owned){
     if(Number(operation.nextAttemptAt)>Date.now())continue;
     try{
       let synced=false;
       if(operation.type==='quotation'){
         const ref=safe(operation.id),record=operation.payload?.record;
         if(record&&typeof window.winkoRetryQuotationSync==='function'){
           const cache=localApprovals();if(!cache[ref]){cache[ref]={...record,reference:ref,ownerUserId:userId,syncStatus:'error'};writeJson('winkoQuoteApprovalsV1',cache)}
           synced=await window.winkoRetryQuotationSync(ref,{silent:true})===true;
         }
       }else if(operation.type==='notification'){
         const notification=operation.payload?.notification;if(notification){const row=await saveNotificationRemote(notification);setLocalNotificationSynced(operation.id,row);synced=!!row}
       }else if(operation.type==='customer-project'){
         const record=operation.payload?.record;if(record){const ids=await saveCustomerProjectRemote(record);if(!ids?.customerId||!ids?.projectId)throw new Error('Supabase did not confirm the customer and project IDs.');if(typeof customerProjects!=='undefined'&&Array.isArray(customerProjects)){const current=customerProjects.find(item=>safe(item?.id)===safe(operation.id));if(current){Object.assign(current,{supabaseCustomerId:ids.customerId,supabaseProjectId:ids.projectId,syncStatus:'synced',syncError:''});saveExtendedData();renderCustomerProjectOptions?.(current.id);renderCustomerHistory?.()}}synced=true}
       }else if(operation.type==='production'&&role()==='main'){
         const pending=operation.payload?.approval;if(pending){const row=await saveProductionApprovalRemote(pending);if(row){writeJson('winkoProductionBomApprovalV1',{...pending,...row,quotation:undefined,syncStatus:'synced',ownerUserId:userId});synced=true}}
       }else if(operation.type==='archive'&&role()==='main'){
         const archived=!!operation.payload?.archived,ref=safe(operation.payload?.reference||operation.id),row=await archiveQuotationRemote(ref,archived,operation.payload?.quotationId||'');
         const records=localApprovals(),local=records[ref]||{};records[ref]={...local,reference:ref,supabaseId:row.id,archived:!!row.archived,archivedAt:row.archived_at||null,pendingArchiveSync:null};writeJson('winkoQuoteApprovalsV1',records);synced=true;
       }else if(operation.type==='prices'&&role()==='main'){
         const queued=operation.payload?.prices;if(queued&&Object.keys(queued).length){const rows=await savePriceDatabaseRemote(queued);if(!Array.isArray(rows))throw new Error('Supabase did not return the saved price rows.');Object.entries(queued).forEach(([key,saved])=>{const record=typeof priceDatabase!=='undefined'?priceDatabase?.[key]:null;if(!record||record.updatedAt!==saved.updatedAt||Number(record.price)!==Number(saved.price))return;const autoDefault=record.autoGenerated===true&&Number(record.price)===1&&/winko standard fastener default/i.test(String(record.source||''));record.status=autoDefault?'AUTO DEFAULT':(Number(record.price)>0?'SYNCED':'MISSING PRICE');record.syncStatus='SYNCED';delete record.syncError});await saveExtendedData();try{applyPricesToBom?.(false);calculate?.();prepareQuotation?.();renderPriceDatabase?.()}catch(error){window.WinkoErrorHandler?.report?.(error,'price-sync')}synced=true}
       }else if(operation.type==='auto-prices'&&role()==='main'){
         const keys=operation.payload?.keys;if(Array.isArray(keys)&&typeof window.syncAutoRegisteredPrices==='function'){const result=await window.syncAutoRegisteredPrices(keys);if(!result||Number(result.synced)<Number(result.requested))throw new Error('Supabase did not confirm every automatically registered price row.');synced=true}
       }else if(operation.type==='number-settings'&&role()==='main'){
         const settings=operation.payload?.settings;if(settings){await saveNumberSettingsRemote(settings);writeJson('winkoQuotationNumberSettings',{...settings,version:2});writeJson('winkoPendingQuotationNumberSettingsV1',null);synced=true}
       }
       if(synced){await queue.remove(operation.key);result.synced.push(operation.key)}
       else if(operation.type==='quotation'&&typeof window.winkoRetryQuotationSync!=='function')continue;
       else if((operation.type==='production'||operation.type==='archive'||operation.type==='number-settings'||operation.type==='prices'||operation.type==='auto-prices')&&role()!=='main')continue;
       else throw new Error('Sync handler did not confirm the queued '+operation.type+' operation.');
     }catch(error){
       await queue.failed(operation.key,error);result.failed.push({key:operation.key,error});
       if(operation.type==='quotation'){const records=localApprovals(),ref=safe(operation.id);if(records[ref]){records[ref].syncStatus='error';records[ref].syncError=safe(error?.message||error);writeJson('winkoQuoteApprovalsV1',records)}}
       if(operation.type==='notification'){const rows=localNotifications(),entry=rows.find(item=>safe(item?.eventKey||item?.id)===safe(operation.id));if(entry){entry.syncStatus='error';entry.syncError=safe(error?.message||error);writeJson('winkoNotificationsV1',rows)}}
       if(operation.type==='customer-project'&&typeof customerProjects!=='undefined'&&Array.isArray(customerProjects)){const current=customerProjects.find(item=>safe(item?.id)===safe(operation.id));if(current){current.syncStatus='error';current.syncError=safe(error?.message||error);saveExtendedData()}}
       if(operation.type==='production'){const pending=readJson('winkoProductionBomApprovalV1',null);if(pending){pending.syncStatus='error';pending.syncError=safe(error?.message||error);writeJson('winkoProductionBomApprovalV1',pending)}}
       if(operation.type==='prices'&&typeof priceDatabase!=='undefined'){Object.values(priceDatabase||{}).forEach(record=>{if(record)record.syncStatus='SYNC ERROR'});saveExtendedData()}
       if(operation.type==='auto-prices'&&typeof priceDatabase!=='undefined'){(operation.payload?.keys||[]).forEach(key=>{if(priceDatabase[key]){priceDatabase[key].syncStatus='SYNC ERROR';priceDatabase[key].syncError=safe(error?.message||error)}});saveExtendedData()}
     }
   }
   box=await queue.list();const remaining=Object.values(box.operations||{}).filter(item=>item?.ownerUserId===userId);result.pendingCount=remaining.length;result.failedCount=remaining.filter(item=>Number(item.attempts)>0).length;
   state.pendingCount=result.pendingCount;state.failedCount=result.failedCount;
   return result;
 }
 let remoteSyncInFlight=null,remoteSyncRequestedAgain=false;
 async function syncRemote(){
   if(remoteSyncInFlight){remoteSyncRequestedAgain=true;return remoteSyncInFlight}
   remoteSyncInFlight=(async()=>{let result;do{remoteSyncRequestedAgain=false;result=await syncRemoteOnce()}while(remoteSyncRequestedAgain);return result})()
   try{return await remoteSyncInFlight}catch(error){state.lastError=safe(error?.message||error);setStatus(state.restConnected?'degraded':'sync_error',error);window.WinkoErrorHandler?.report(error,'supabase-sync');return{ok:false,error}}finally{remoteSyncInFlight=null}
 }
 async function syncRemoteOnce(){
   if(!state.client)return{ok:false};
   state.lastAttemptAt=new Date().toISOString();
   if(window.winkoExtendedDataRecoveryPromise)await window.winkoExtendedDataRecoveryPromise;
    const entries=Object.entries(TABLE).filter(([key])=>role()!=='sales'||!['production','audit'].includes(key)),hydratedKeys=new Set(['customers','projects','quotations','notifications','prices','numbers']);
   /* A role switch changes which tables are expected. Discard health results
      for tables that are not part of this sync so an old Main-only failure
      cannot leave the Sales header permanently in Partial/Error state. */
   const activeKeys=new Set(entries.map(([key])=>key));
   Object.keys(state.tableHealth).forEach(key=>{if(!activeKeys.has(key))delete state.tableHealth[key]});
   const results=await Promise.allSettled(entries.map(([key,name])=>hydratedKeys.has(key)?fetchTable(name):probeTable(name))),data={},failed=[];
   entries.forEach(([key],i)=>{const result=results[i];if(result.status==='fulfilled'){if(!result.value?.healthOnly)data[key]=result.value;state.tableHealth[key]={ok:true,count:result.value?.healthOnly?result.value.count:result.value.length,checkedAt:new Date().toISOString()}}else{failed.push({key,error:result.reason});state.tableHealth[key]={ok:false,error:safe(result.reason?.message||result.reason),checkedAt:new Date().toISOString()}}});
   if(!state.tableHealth.quotations?.ok){const error=failed.find(x=>x.key==='quotations')?.error||new Error('Quotation database is unavailable');setStatus('sync_error',error);window.WinkoErrorHandler?.report(error,'supabase-sync');return{ok:false,error,failed}}
   hydrateQuotations(data.quotations);
   if(data.notifications)hydrateNotifications(data.notifications);
   if(data.customers&&data.projects&&data.quotations)hydrateCustomers(data.customers,data.projects,data.quotations);
   let priceResult=null;if(data.prices){const priceMetadata=await window.winkoFetchRemotePriceMetadata?.(state.client)||{};priceResult=window.hydrateRemotePriceDatabase?.(data.prices,{metadata:priceMetadata});if(priceResult?.applied){try{window.applyPricesToBom?.(false);calculate?.();prepareQuotation?.();window.renderPriceDatabase?.()}catch(error){window.WinkoErrorHandler?.report(error,'price-sync')}}}
   if(data.numbers?.[0]){const x=data.numbers[0];writeJson('winkoQuotationNumberSettings',{version:2,prefix:x.prefix,year:x.year,nextSequence:x.next_sequence,digits:x.digits,autoNumber:x.auto_number,resetEachYear:x.reset_each_year})}
   const pendingBomResult=await flushPendingBomSaves();
   if(pendingBomResult.failed.length){const error=pendingBomResult.failed[0].error;failed.push({key:'bom',error});state.tableHealth.bom={ok:false,error:safe(error?.message||error),checkedAt:new Date().toISOString()}}
   else if(pendingBomResult.recovered.length)state.tableHealth.bom={ok:true,count:pendingBomResult.recovered.length,checkedAt:new Date().toISOString()};
   const outboxResult=await flushSyncOutbox();
   outboxResult.failed.forEach(entry=>failed.push({key:'outbox',error:entry.error}));
   state.pendingCount=outboxResult.pendingCount;state.failedCount=failed.filter(entry=>entry.key!=='outbox').length+outboxResult.failedCount;
   const partial=failed.length>0||outboxResult.pendingCount>0;
   if(!partial)state.lastSyncedAt=new Date().toISOString();
   const statusMessage=failed.length?failed.map(x=>x.key+': '+safe(x.error?.message||x.error)).join('; '):(outboxResult.failedCount?outboxResult.pendingCount+' queued change(s); '+outboxResult.failedCount+' failed and awaiting retry':(outboxResult.pendingCount?outboxResult.pendingCount+' queued change(s) still waiting to sync':null));
   setStatus(partial?'degraded':'connected',statusMessage);
   if(state.channel)startPolling(partial||state.realtimeStatus!=='live'?12000:60000);
   try{window.winkoNotifications?.render?.();window.winkoRenderRoleDashboard?.();window.winkoRenderQuotations?.();window.winkoRenderApprovalQueue?.();window.winkoRenderQuotationNumberSettings?.();window.winkoRenderMainCustomers?.()}catch(error){console.warn('Remote UI refresh failed',error)}
   return{ok:true,partial,failed,pendingCount:outboxResult.pendingCount,priceResult};
 }
 function subscribe(){
   if(!state.client||state.channel)return;state.realtimeStatus='connecting';
   state.channel=state.client.channel('winko-test-sync').on('postgres_changes',{event:'*',schema:'public',table:TABLE.notifications},scheduleRemoteSync).on('postgres_changes',{event:'*',schema:'public',table:TABLE.quotations},scheduleRemoteSync).on('postgres_changes',{event:'*',schema:'public',table:TABLE.customers},scheduleRemoteSync).on('postgres_changes',{event:'*',schema:'public',table:TABLE.projects},scheduleRemoteSync).on('postgres_changes',{event:'*',schema:'public',table:TABLE.production},()=>{const ref=document.getElementById('reference')?.value||document.getElementById('ceRef')?.value;if(ref)Promise.resolve(window.winkoLoadProductionApprovalRemote?.(ref)).catch(error=>{console.warn('Realtime production approval refresh failed.',error);window.WinkoErrorHandler?.report?.(error,'production-approval-realtime')})}).on('postgres_changes',{event:'*',schema:'public',table:TABLE.prices},()=>window.schedulePriceSync?.()).on('postgres_changes',{event:'*',schema:'public',table:TABLE.approvals},scheduleRemoteSync).subscribe((status,error)=>{
     const partial=Object.values(state.tableHealth).some(x=>!x.ok)||state.pendingCount>0||state.failedCount>0;
     if(status==='SUBSCRIBED'){state.realtimeStatus='live';startPolling(partial?12000:60000);if(state.restConnected)setStatus(partial?'degraded':'connected',partial?state.lastError:null)}
     else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){state.realtimeStatus='error';if(error){state.lastError=safe(error?.message||error);console.error('Supabase Realtime '+status,error)}startPolling(12000);scheduleRealtimeReconnect();if(state.restConnected)setStatus(partial?'degraded':'connected',partial?state.lastError:null)}
   });
 }
 function observeRoleSwitch(){if(state.roleObserver||!document.body)return;state.roleObserver=new MutationObserver(changes=>{if(changes.some(x=>x.attributeName==='data-app-role'))scheduleRemoteSync()});state.roleObserver.observe(document.body,{attributes:true,attributeFilter:['data-app-role']})}
 async function bootstrap(authSession){const c=await getClient();if(!c){setStatus('offline');return{ok:false}}try{const sessionResult=authSession?{data:{session:authSession}}:await c.auth.getSession();if(sessionResult.error)throw sessionResult.error;state.currentUser=sessionResult.data?.session?.user||null;state.authenticated=!!state.currentUser;if(!state.authenticated){const error=new Error('Sign in required');error.code='AUTH_REQUIRED';throw error}const probe=await c.from(TABLE.quotations).select('id',{head:true,count:'exact'});if(probe.error)throw probe.error;state.restConnected=true;const result=await syncRemote();if(result.ok){subscribe();observeRoleSwitch();state.booted=true}return result}catch(e){setStatus(e?.code==='AUTH_REQUIRED'?'offline':'sync_error',e);return{ok:false,error:e}}}
  async function retrySupabaseConnection(authSession){stopPolling();clearTimeout(state.reconnectTimer);state.reconnectTimer=0;try{if(state.channel)await state.client?.removeChannel?.(state.channel)}catch(e){}state.channel=null;state.restConnected=false;state.realtimeStatus='idle';state.booted=false;return bootstrap(authSession)}
 async function healthCheck(){if(!state.client)await getClient();const result=await syncRemote();return{...result,mode:state.mode,restConnected:state.restConnected,realtimeStatus:state.realtimeStatus,lastSyncedAt:state.lastSyncedAt,tables:JSON.parse(JSON.stringify(state.tableHealth))}}
 window.WinkoDB={config:{url:SUPABASE_URL,publishableKey:SUPABASE_PUBLISHABLE_KEY},state,getClient,requireAuthenticatedUser,fetchAllRows:fetchTable,bootstrap,syncRemote,healthCheck,getHealth:()=>({mode:state.mode,restConnected:state.restConnected,authenticated:state.authenticated,realtimeStatus:state.realtimeStatus,lastAttemptAt:state.lastAttemptAt,lastSyncedAt:state.lastSyncedAt,pendingCount:state.pendingCount,failedCount:state.failedCount,tables:JSON.parse(JSON.stringify(state.tableHealth))}),syncRemotePrices:()=>window.syncRemotePrices?.(),scheduleRemoteSync,retrySupabaseConnection,setSyncError:e=>setStatus(state.restConnected?'degraded':'sync_error',e),allocateQuotationNumber,archiveQuotation:archiveQuotationRemote,deleteProject:deleteProjectRemote,deleteCustomer:deleteCustomerRemote,buildBomRowsForRemote,saveCustomer:saveCustomerRemote,saveCustomerProject:saveCustomerProjectRemote,saveQuotationRecord,saveNotification:saveNotificationRemote,setNotificationRead:setNotificationReadRemote,saveProductionApproval:saveProductionApprovalRemote,loadProductionApprovalRemote,savePriceDatabase:savePriceDatabaseRemote,saveNumberSettings:saveNumberSettingsRemote,loadNumberSettings:loadNumberSettingsRemote,saveAudit,toDbStatus,toUiStatus,isConnected:()=>!!state.client&&state.restConnected&&state.authenticated};
 window.WinkoDB.quotationIdentitySafety={duplicateReferenceCheck:true,existingUpdatesById:true,newRecordsUseInsert:true,numberAllocator:'winko_test_allocate_quotation_number'};
  window.addEventListener('online',()=>{if(state.authenticated&&window.WinkoAuth?.ready)retrySupabaseConnection().catch(error=>console.warn('Supabase reconnect failed',error))});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.authenticated&&(!state.restConnected||state.mode==='degraded'))retrySupabaseConnection().catch(error=>{console.warn('Cloud reconnection after returning to the tab failed.',error);window.WinkoErrorHandler?.report?.(error,'supabase-reconnect')})});
  // Authentication owns initial bootstrapping; do not sync quotations before access is resolved.
  window.winkoSupabaseReady=null;
})();
