(function () {
  'use strict';

  const SOURCE = 'WINKO price list · 2 July 2026 · MYR';
  const PRESETS = [
    {id:'production',name:'Production',length:136,width:88,height:16,mm:[41480,26860,4880],effectiveM3:4657},
    {id:'domestic',name:'Domestic',length:48,width:48,height:16,mm:[14640,14640,4880],effectiveM3:764},
    {id:'fire',name:'Fire',length:40,width:36,height:16,mm:[12200,10980,4880],effectiveM3:552,revision:'Approved footprint: 12,200 × 10,980 mm; photo: 12,000 × 11,000 mm.'},
    {id:'cooling',name:'Cooling',length:16,width:12,height:16,mm:[4880,3660,4880],effectiveM3:65}
  ];
  const COMMON = {panelSize:4,dimensionUnit:'ft',unit:'ft',qty:1,tankFinish:'HDG',roofThickness:5,baseThickness:6,wallL1Thickness:6,wallL2Thickness:5,wallL3Thickness:5,wallL4Thickness:5,partitions:[],partitionRequired:'yes',partitionThickness:0,manhole:0,manholeAccessoryQty:0};
  let activeReference = null;
  const $ = id => document.getElementById(id);

  // These are source costs. Exact configured master rates take precedence in
  // the existing resolver. Raw sheets, MS products and bag rates are excluded.
  function referenceRate(row={}) {
    const key=String(row.canonicalKey||row.itemCode||row.internalKey||row.id||''),finish=String(row.tankFinish||'HDG').toUpperCase();
    if(finish!=='HDG')return null;
    let price=null,description='';
    const panel=key.match(/^panel_(?:base|wall_l\d+|partition)_(3_0|4_5|5_0)(?:_|$)/);
    if(panel){price={'3_0':186.50,'4_5':263.50,'5_0':294.19}[panel[1]];description='Finished HDG 1,220 mm panel, '+panel[1].replace('_','.')+' mm';}
    if(key==='panel_roof_1_5'){price=95;description='Pressed 1.5 mm HDG roof cover';}
    const boltLength=String(row.item||row.dynamicName||'').match(/M14\s*x\s*(\d+)/i);
    if(key==='m14_bn'&&Number(row.hardwareSpecification?.m14LengthMm??30)===30&&(!boltLength||Number(boltLength[1])===30)){price=.65;description='M14 × 30 HDG bolt RM0.48 + nut RM0.17; washer excluded';}
    if(key==='pvc_foam_5_45_10m'){price=22.5;description='5 × 45 mm foam, 10 m roll';}
    if(key==='pvc_foam_3_40_10m'){price=8;description='3 × 40 mm foam, 10 m roll';}
    if(price===null)return null;
    return {price,source:SOURCE,description,currency:'MYR',updatedAt:'2026-07-02',configured:true};
  }
  window.winkoGetBomReferenceRate=referenceRate;

  // Apply the user's requested allowance once when installing this version.
  // Subsequent deliberate settings edits and historical snapshots retain their
  // values; an explicit zero is never converted back to ten.
  function installAllowance() {
    try {
      const key='winkoSystemSettingsV1',settings=JSON.parse(localStorage.getItem(key)||'{}')||{};
      if(settings.bomIntegrationVersion==='2026-09-30')return;
      settings.tankBom={...(settings.tankBom||{}),fastenerWastePct:0};
      settings.bomIntegrationVersion='2026-09-30';
      localStorage.setItem(key,JSON.stringify(settings));
      window.dispatchEvent(new CustomEvent('winko-settings-changed'));
    } catch(error) { console.warn('Could not initialize the 0% allowance setting.',error); }
  }
  installAllowance();

  function tankFor(preset) {
    return {...COMMON,...preset,photoReference:{id:preset.id,moduleMm:1220,sourceDimensionsMm:preset.mm.slice(),effectiveM3:preset.effectiveM3,requiresPartition:true,requiresManhole:true,revision:preset.revision||''}};
  }
  function calculateDraft(id) {
    const preset=PRESETS.find(p=>p.id===id);
    if(!preset)throw new Error('Unknown photo tank.');
    if(!window.WinkoBomEngine?.calculateTank)throw new Error('BOM calculator is still loading.');
    return window.WinkoBomEngine.calculateTank(tankFor(preset));
  }

  function setField(id,value) {
    const el=$(id);if(!el)return;
    if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===String(value)))el.add(new Option(String(value),String(value)));
    el.value=String(value);
  }
  function loadPreset(id) {
    const preset=PRESETS.find(p=>p.id===id);if(!preset)return false;
    activeReference=tankFor(preset).photoReference;
    window.winkoSetQuickPartitions?.([],'ft');
    window.winkoSetCurrentPartitions?.([],'ft');
    window.syncTankDimensionSelectOptions?.('ft','quick');
    const fields={ceLength:preset.length,ceWidth:preset.width,ceHeight:16,ceUnit:'ft',cePanelSize:4,ceTankQty:1,ceTankFinish:'HDG',ceRoofThickness:5,ceBaseThickness:6,ceWallL1Thickness:6,ceWallL2Thickness:5,ceWallL3Thickness:5,ceWallL4Thickness:5,cePartition:'yes',cePartitionLength:'',cePartitionWidth:'',cePartitionThickness:'',ceManholeQty:''};
    Object.entries(fields).forEach(([id,value])=>setField(id,value));
    if($('ceUnit'))$('ceUnit').dataset.previousUnit='ft';
    setField('ceTankScopeNote','Photo tender: partition and manhole quantities pending; roof/stay schedules, magnetic level indicator, controls/pump interlock, foundation steel, connections and SPAN requirements to confirm. '+(preset.revision||''));
    window.compactSyncTankFields?.();
    $('quickEntry')?.dispatchEvent(new Event('input',{bubbles:true}));
    window.winkoRenderCompactSetupSummary?.();
    const note=$('winkoPhotoDraftLoadState');if(note)note.textContent=preset.name+' draft loaded. Complete partition dimensions/thickness and manhole quantity before adding the tank.';
    return true;
  }

  function init() {
    // Existing snapshot save/restore serializes tank objects. Keep the photo
    // provenance alongside the normal fields; no new database API is needed.
    const original=window.currentTankSnapshot;
    if(typeof original==='function')window.currentTankSnapshot=function(){const tank=original.apply(this,arguments);return activeReference?{...tank,photoReference:JSON.parse(JSON.stringify(activeReference))}:tank;};
    for(const name of ['compactEntryReset','newCustomerProject']){
      const original=window[name];if(typeof original==='function')window[name]=function(){activeReference=null;return original.apply(this,arguments);};
    }
  }
  window.WinkoPhotoBomDrafts={presets:PRESETS,tankFor,calculateDraft,loadPreset,referenceRate};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
