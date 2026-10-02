(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fields = [
    ['ceExtLadder', 'extLadderRequired', 'ceExtLadderQty', 'extLadderQty', 'External Ladder'],
    ['ceIntLadder', 'intLadderRequired', 'ceIntLadderQty', 'intLadderQty', 'Internal Ladder'],
    ['ceAirVent', 'airVentRequired', 'ceAirVentQty', 'airVentQty', 'Air Vent'],
    ['ceWli', 'wliRequired', 'ceWliQty', 'wliQty', 'Water Level Indicator']
  ];
  const previous = new Map();
  const required = value => /^(yes|required|true|1)$/i.test(String(value).trim());
  const positiveQty = value => Math.max(1, Math.floor(Number(value) || 1));

  function setLiner(value) {
    const field = $('ceInternalLiner');
    if (!field) return;
    const liner = String(value || 'Silicone liner');
    $('ceInternalLinerTick').checked = !/^(none|nil|no|not required)$/i.test(liner.trim());
    const standard = ['Silicone liner', 'HDPE liner'].includes(liner);
    $('ceInternalLinerType').value = standard ? liner : 'Other';
    $('ceInternalLinerOther').value = standard || !$('ceInternalLinerTick').checked || liner === 'Other' ? '' : liner;
    field.value = liner;
    syncLiner();
  }

  function syncLiner() {
    const tick = $('ceInternalLinerTick');
    if (!tick) return;
    const type = $('ceInternalLinerType'), custom = $('ceInternalLinerOther');
    const other = tick.checked && type.value === 'Other';
    const readOnly = window.winkoIsQuotationApprovedReadOnly?.() === true;
    $('ceInternalLinerOptions').hidden = !tick.checked;
    $('ceInternalLinerOtherField').hidden = !other;
    tick.disabled = readOnly;
    type.disabled = !tick.checked || readOnly;
    custom.disabled = !other || readOnly;
    custom.required = other;
    custom.setCustomValidity(other && !custom.value.trim() ? 'Enter the other liner specification.' : '');
    $('ceInternalLiner').value = !tick.checked ? 'None' : type.value === 'Other' ? custom.value.trim() || 'Other' : type.value;
  }

  function applyPreparedBy(reset = false) {
    const account = window.WinkoAuth;
    if (!account?.user?.id || account.access?.authorized !== true) return;
    const name = String(account.access.fullName || account.access.full_name || account.user.user_metadata?.full_name || account.user.email?.split('@')[0] || '').trim();
    if (!name) return;
    ['cePreparedBy', 'crmPreparedBy', 'preparedBy', 'editPreparedByName'].forEach(id => {
      const field = $(id);
      if (field && (reset || !field.value.trim())) field.value = name;
    });
  }

  function sync({fromMain = false, reset = false} = {}) {
    if (fromMain) setLiner($('internalLiner')?.value);
    else syncLiner();
    if (reset) previous.clear();
    fields.forEach(([id, source, qtyId, sourceQty]) => {
      const field = $(id), tick = $(id + 'Tick'), qty = $(qtyId);
      if (!field || !tick || !qty) return;
      if (fromMain) {
        field.value = required($(source)?.value) ? 'yes' : 'no';
        qty.value = $(sourceQty)?.value ?? '1';
      }
      const on = required(field.value);
      field.value = on ? 'yes' : 'no';
      tick.checked = on;
      tick.disabled = window.winkoIsQuotationApprovedReadOnly?.() === true;
      if (Number(qty.value) > 0) previous.set(id, positiveQty(qty.value));
      qty.value = on ? positiveQty(qty.value || previous.get(id)) : 0;
      qty.disabled = !on || window.winkoIsQuotationApprovedReadOnly?.() === true;
    });
    if (fromMain && $('ceAirVentSize')) $('ceAirVentSize').value = $('airVentSize')?.value || '4';
    if ($('ceAirVentSize')) $('ceAirVentSize').disabled = !required($('ceAirVent')?.value) || window.winkoIsQuotationApprovedReadOnly?.() === true;
    const cage = $('ceSafetyCage'), external = required($('ceExtLadder')?.value);
    if (cage) {
      if (fromMain) cage.checked = required($('safetyCageRequired')?.value);
      if (!external) {
        cage.checked = false;
        if ($('safetyCageRequired')) $('safetyCageRequired').value = 'no';
        if ($('safetyCageTick')) $('safetyCageTick').checked = false;
      }
      cage.disabled = !external || window.winkoIsQuotationApprovedReadOnly?.() === true;
    }
    if (fromMain && $('ceSafetyCageQty')) $('ceSafetyCageQty').value = $('safetyCageQty')?.value || '1';
    const labels = fields.filter(([id]) => required($(id)?.value)).map(row => row[4]);
    if (cage?.checked) labels.splice(1, 0, 'Safety Cage');
    if ($('tankAccessorySelection')) $('tankAccessorySelection').textContent = labels.join(' · ') || 'No accessories selected';
  }

  function loadTank(tank) {
    if ($('internalLiner')) $('internalLiner').value = tank.internalLiner ?? 'Silicone liner';
    setLiner(tank.internalLiner);
    fields.forEach(([id, source, qtyId, sourceQty]) => {
      if ($(source)) $(source).value = required(tank[source] ?? 'yes') ? 'yes' : 'no';
      if ($(sourceQty)) $(sourceQty).value = tank[sourceQty] ?? 1;
    });
    if ($('airVentSize')) $('airVentSize').value = tank.airVentSize ?? 4;
    if ($('safetyCageRequired')) $('safetyCageRequired').value = required(tank.safetyCageRequired ?? 'no') ? 'yes' : 'no';
    if ($('safetyCageQty')) $('safetyCageQty').value = tank.safetyCageQty ?? 1;
    sync({fromMain: true, reset: true});
  }

  function init() {
    const root = $('quickEntry');
    if (!root) return;
    const construction = root.querySelector('.tank-construction');
    if (construction && $('compactServiceBlock')) construction.before($('compactServiceBlock'));
    const details = $('salesAccessoryDetails');
    if (details) details.open = true;
    sync({reset: true});
    applyPreparedBy();
    window.addEventListener('winko-role-changed', () => applyPreparedBy());
    const linerChanged = () => {
      syncLiner();
      $('ceInternalLiner').dispatchEvent(new Event('change', {bubbles: true}));
    };
    $('ceInternalLinerOther')?.addEventListener('input', linerChanged);
    root.addEventListener('change', event => {
      if (['ceInternalLinerTick', 'ceInternalLinerType'].includes(event.target.id)) linerChanged();
      const row = fields.find(([id, , qtyId]) => event.target.id === id + 'Tick' || event.target.id === id || event.target.id === qtyId);
      if (row) {
        const [id, , qtyId] = row;
        if (event.target.id === id + 'Tick') {
          $(id).value = event.target.checked ? 'yes' : 'no';
          if (event.target.checked && !(Number($(qtyId).value) > 0)) $(qtyId).value = previous.get(id) || 1;
        }
        sync();
        if (event.target.id === id + 'Tick') $(id).dispatchEvent(new Event('change', {bubbles: true}));
      } else if (event.target.id === 'ceSafetyCage') sync();
    }, true);
  }
  window.winkoAccessoryInputs = {sync, loadTank, setLiner, applyPreparedBy, validateLiner: () => $('ceInternalLinerOther')?.reportValidity() !== false, requiredValue: value => required(value) ? 'yes' : 'no'};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
