// ── STORAGE ──────────────────────────────────────────────────────────────────
var DB_NAME='utilityInspect',DB_VER=1,STORE='data';
var idb=null;
var db={maps:[],units:[]};
var state={screen:'maps',mapId:null,unitId:null,filter:'All'};
var patchCount=0;
// Temp photo storage while form is open
var formPhotos={before:null,after:null};

function openIDB(cb){
  var req=indexedDB.open(DB_NAME,DB_VER);
  req.onupgradeneeded=function(e){e.target.result.createObjectStore(STORE);};
  req.onsuccess=function(e){idb=e.target.result;cb();};
  req.onerror=function(){cb();};
}
function idbGet(cb){
  if(!idb)return cb();
  var tx=idb.transaction(STORE,'readonly');
  var req=tx.objectStore(STORE).get('db');
  req.onsuccess=function(e){if(e.target.result)db=e.target.result;cb();};
  req.onerror=function(){cb();};
}
function idbSave(){
  if(!idb)return;
  var tx=idb.transaction(STORE,'readwrite');
  tx.objectStore(STORE).put(db,'db');
}

// ── UTILS ────────────────────────────────────────────────────────────────────
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function toast(msg){
  var t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},2200);
}
function $(id){return document.getElementById(id);}
function qs(sel,ctx){return (ctx||document).querySelector(sel);}
function esc(s){
  if(!s)return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function segSel(gid,btn){
  document.querySelectorAll('#'+gid+' button').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
}
function statusBadge(s){
  var m={Fail:'b-fail','Door Fail':'b-door',Vegetation:'b-veg','No Access':'b-na',Clean:'b-clean'};
  return '<span class="badge '+(m[s]||'b-clean')+'">'+s+'</span>';
}
function typeBadge(t){
  return t==='Pedestal'?'<span class="badge b-ped">Pedestal</span>':'<span class="badge b-trans">Transformer</span>';
}

// ── NAVIGATION ───────────────────────────────────────────────────────────────
function setScreen(name){
  document.querySelectorAll('.screen').forEach(function(s){s.classList.remove('active');});
  $('screen'+name.charAt(0).toUpperCase()+name.slice(1)).classList.add('active');
  state.screen=name;
  $('mainContent').scrollTop=0;
}
function goBack(){
  if(state.screen==='unit') showUnits(state.mapId);
  else showMaps();
}
function fabAction(){
  if(state.screen==='maps') showNewMapModal();
  else if(state.screen==='units') showNewUnitModal();
}

// ── MAPS ─────────────────────────────────────────────────────────────────────
function showMaps(){
  state.mapId=null;state.unitId=null;
  $('topTitle').textContent='UtilityLog';
  $('backWrap').style.display='none';
  $('filterRow').classList.remove('visible');
  $('topActs').innerHTML='';
  $('fab').style.display='flex';
  renderMaps();setScreen('maps');
}

function renderMaps(){
  var c=$('screenMaps');
  var mapsHtml=db.maps.map(function(m){
    var us=db.units.filter(function(u){return u.mapId===m.id;});
    var fails=us.filter(function(u){return u.status==='Fail'||u.status==='Door Fail';}).length;
    var vegs=us.filter(function(u){return u.status==='Vegetation';}).length;
    var patches=us.reduce(function(a,u){return a+(u.patches||0);},0);
    var date=m.createdAt?new Date(m.createdAt).toLocaleDateString('en-CA'):'';
    return '<div class="card">'
      +'<div class="card-row card-tap" onclick="showUnits(\''+m.id+'\')">'
      +'<div><div class="card-title">'+esc(m.name)+'</div>'
      +'<div class="card-sub">'+esc(m.location)+(date?' · '+date:'')+'</div>'
      +'<div style="display:flex;gap:14px;margin-top:8px">'
      +'<span style="font-size:12px;color:var(--text2)">'+us.length+' units</span>'
      +(fails?'<span style="font-size:12px;color:var(--danger-text)">'+fails+' fail'+(fails>1?'s':'')+'</span>':'')
      +(vegs?'<span style="font-size:12px;color:var(--success-text)">'+vegs+' veg</span>':'')
      +(patches?'<span style="font-size:12px;color:var(--text2)">'+patches+' patch'+(patches>1?'es':'')+'</span>':'')
      +'</div></div>'+typeBadge(m.type||'Pedestal')+'</div>'
      +'<div class="map-acts">'
      +'<button class="btn btn-sm" onclick="showUnits(\''+m.id+'\')">Open</button>'
      +'<button class="btn btn-sm" onclick="confirmDeleteMap(\''+m.id+'\',\''+esc(m.name)+'\')">Delete map</button>'
      +'</div></div>';
  }).join('');

  var dataHtml='<div class="section-lbl" style="margin-top:8px">Data</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap">'
    +'<button class="btn" onclick="exportBackup()">Export backup</button>'
    +'<button class="btn" onclick="$(\'importFile\').click()">Import backup</button>'
    +'<input type="file" id="importFile" accept=".json" style="display:none" onchange="importBackup(event)"/>'
    +'</div>';

  if(!db.maps.length){
    c.innerHTML='<div class="empty-state"><div class="empty-ico">🗺️</div>'
      +'<p style="font-weight:600;font-size:16px">No maps yet</p>'
      +'<p style="font-size:13px;margin-top:6px">Tap + to create your first map</p></div>'+dataHtml;
    return;
  }
  c.innerHTML=mapsHtml+dataHtml;
}

function confirmDeleteMap(mapId,mapName){
  if(!confirm('Delete map "'+mapName+'" and all its units? This cannot be undone.'))return;
  db.maps=db.maps.filter(function(m){return m.id!==mapId;});
  db.units=db.units.filter(function(u){return u.mapId!==mapId;});
  idbSave();renderMaps();toast('Map deleted');
}

// ── UNITS ─────────────────────────────────────────────────────────────────────
function showUnits(mapId){
  state.mapId=mapId;state.filter='All';
  var map=db.maps.find(function(m){return m.id===mapId;});
  $('topTitle').textContent=esc(map.name);
  $('backWrap').style.display='';
  $('topActs').innerHTML=
    '<button class="btn btn-sm" onclick="showSummary()">Summary</button>'
    +'<button class="btn btn-sm" onclick="exportPDF()">PDF</button>';
  $('filterSelect').value='All';
  $('filterRow').classList.add('visible');
  $('fab').style.display='flex';
  renderUnits();setScreen('units');
}

function setFilter(f){state.filter=f;renderUnits();}

function renderUnits(){
  var us=db.units.filter(function(u){return u.mapId===state.mapId;});
  if(state.filter!=='All') us=us.filter(function(u){return u.status===state.filter;});
  us.sort(function(a,b){return (a.asap?+a.asap:9999)-(b.asap?+b.asap:9999);});
  var c=$('screenUnits');
  if(!us.length){
    c.innerHTML='<div class="empty-state"><div class="empty-ico">🔌</div>'
      +'<p style="font-weight:600;font-size:16px">No units'+(state.filter!=='All'?' with "'+state.filter+'"':' yet')+'</p>'
      +'<p style="font-size:13px;margin-top:6px">Tap + to add a unit</p></div>';
    return;
  }
  c.innerHTML=us.map(function(u){
    return '<div class="card card-tap" onclick="showUnit(\''+u.id+'\')">'
      +'<div class="card-row"><span class="card-title">'+esc(u.epcor)+'</span>'+statusBadge(u.status)+'</div>'
      +'<div style="display:flex;align-items:center;gap:8px;margin-top:5px;flex-wrap:wrap">'
      +(u.asap?'<span class="card-sub">ASAP #'+esc(u.asap)+'</span>':'')
      +(u.failType?'<span class="card-sub">· '+esc(u.failType)+'</span>':'')
      +(u.patches?'<span class="card-sub">· '+u.patches+' patch'+(u.patches>1?'es':'')+'</span>':'')
      +(u.beforePhoto||u.afterPhoto?'<span class="card-sub" style="color:var(--teal-text)">· 📷 '+(u.beforePhoto&&u.afterPhoto?'2':'1')+' photo'+(u.beforePhoto&&u.afterPhoto?'s':'')+'</span>':'')
      +'</div></div>';
  }).join('');
}

// ── UNIT DETAIL ───────────────────────────────────────────────────────────────
function showUnit(id){
  state.unitId=id;
  var u=db.units.find(function(x){return x.id===id;});
  $('topTitle').textContent=esc(u.epcor);
  $('backWrap').style.display='';
  $('filterRow').classList.remove('visible');
  $('topActs').innerHTML='<button class="btn btn-sm" onclick="editUnit(\''+id+'\')">Edit</button>';
  $('fab').style.display='none';
  renderUnitDetail(u);setScreen('unit');
}

function renderUnitDetail(u){
  var isFail=u.status==='Fail'||u.status==='Door Fail';
  var showAfter=isFail||u.status==='Vegetation';
  var html='<div class="unit-header">'
    +'<div class="card-row"><div>'
    +'<div style="font-size:22px;font-weight:700;letter-spacing:-0.5px">'+esc(u.epcor)+'</div>'
    +(u.asap?'<div style="font-size:13px;color:var(--text2);margin-top:2px">ASAP #'+esc(u.asap)+'</div>':'')
    +'</div>'+statusBadge(u.status)+'</div>'
    +'<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">'
    +typeBadge(u.unitType||'Pedestal')
    +(u.utility?'<span class="badge b-na">'+esc(u.utility)+'</span>':'')
    +'</div></div>';

  if(isFail){
    html+='<div class="section-lbl">Fail details</div>'
      +'<div class="row-detail"><span style="font-size:13px;color:var(--text2)">Type</span>'
      +'<span style="font-size:14px;font-weight:500">'+(u.failType?esc(u.failType):'—')+'</span></div>'
      +'<div class="row-detail"><span style="font-size:13px;color:var(--text2)">Patches</span>'
      +'<span style="font-size:18px;font-weight:700;color:var(--teal)">'+(u.patches||0)+'</span></div>';
  }
  if(u.status==='Vegetation') html+='<div style="padding:10px 0;font-size:14px;color:var(--text2)">Vegetation noted — no patch required.</div>';
  if(u.status==='No Access') html+='<div style="padding:10px 0;font-size:14px;color:var(--text2)">Unit not accessible during inspection.</div>';

  html+='<div class="section-lbl">Photos</div><div class="photo-grid">';
  html+=detailPhotoSlot(u,'before','Before');
  if(showAfter) html+=detailPhotoSlot(u,'after',isFail?'After patch':'Vegetation');
  html+='</div>';

  if(u.notes){
    html+='<div class="section-lbl">Notes</div>'
      +'<div style="font-size:14px;line-height:1.65;color:var(--text2)">'+esc(u.notes)+'</div>';
  }
  html+='<div style="margin-top:22px;padding-bottom:20px">'
    +'<button class="btn btn-danger" style="width:100%" onclick="deleteUnit(\''+u.id+'\')">Delete unit</button></div>';
  $('screenUnit').innerHTML=html;
}

function detailPhotoSlot(u,key,label){
  var p=u[key+'Photo'];
  if(p) return '<div class="photo-slot" onclick="viewPhoto(\''+u.id+'\',\''+key+'\')">'
    +'<img src="'+p+'" alt="'+label+'">'
    +'<span style="position:absolute;bottom:5px;left:7px;background:rgba(0,0,0,0.55);color:#fff;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:600;z-index:1">'+label+'</span></div>';
  return '<div class="photo-slot" onclick="pickPhoto(\'detail\',\''+u.id+'\',\''+key+'\')">'
    +'<span class="p-ico">+</span><span class="p-lbl">'+label+'</span></div>';
}

// ── PHOTO PICKING ─────────────────────────────────────────────────────────────
// context: 'detail' or 'form', unitId only used for detail
function pickPhoto(context,unitId,key){
  openModal('<p class="modal-title">Add photo</p>'
    +'<div style="display:flex;flex-direction:column;gap:10px;padding-bottom:6px">'
    +'<button class="btn" style="width:100%;padding:14px;font-size:15px" onclick="launchCamera(\''+context+'\',\''+unitId+'\',\''+key+'\',true)">📷 Take photo</button>'
    +'<button class="btn" style="width:100%;padding:14px;font-size:15px" onclick="launchCamera(\''+context+'\',\''+unitId+'\',\''+key+'\',false)">🖼️ Choose from gallery</button>'
    +'<button class="btn" style="width:100%;padding:12px" onclick="closeModal()">Cancel</button>'
    +'</div>');
}

function launchCamera(context,unitId,key,useCamera){
  closeModal();
  var inp=document.createElement('input');
  inp.type='file';inp.accept='image/*';
  if(useCamera) inp.capture='environment';
  inp.onchange=function(){
    var file=inp.files[0];if(!file)return;
    var r=new FileReader();
    r.onload=function(e){
      var data=e.target.result;
      if(context==='detail'){
        var u=db.units.find(function(x){return x.id===unitId;});
        u[key+'Photo']=data;
        idbSave();
        renderUnitDetail(db.units.find(function(x){return x.id===state.unitId;}));
        toast('Photo saved');
      } else {
        // form context — store in formPhotos and refresh the form slot
        formPhotos[key]=data;
        refreshFormPhotoSlot(key);
        toast('Photo added');
      }
    };r.readAsDataURL(file);
  };inp.click();
}

function refreshFormPhotoSlot(key){
  var slot=$('formPhoto_'+key);
  if(!slot)return;
  slot.innerHTML=formPhotoSlotInner(key);
}

function formPhotoSlotInner(key){
  var label=key==='before'?'Before':'After patch';
  if(formPhotos[key]){
    return '<img class="photo-form-preview" src="'+formPhotos[key]+'" alt="'+label+'">'
      +'<div class="photo-form-actions">'
      +'<button onclick="pickPhoto(\'form\',\'\',\''+key+'\')">Change</button>'
      +'<button onclick="formPhotos[\''+key+'\']=null;refreshFormPhotoSlot(\''+key+'\')">Remove</button>'
      +'</div>';
  }
  return '<div class="photo-form-empty" onclick="pickPhoto(\'form\',\'\',\''+key+'\')">'
    +'<span class="pfe-ico">+</span><span class="pfe-lbl">'+label+'</span></div>'
    +'<div class="photo-form-actions">'
    +'<button onclick="launchCamera(\'form\',\'\',\''+key+'\',true)">Camera</button>'
    +'<button onclick="launchCamera(\'form\',\'\',\''+key+'\',false)">Gallery</button>'
    +'</div>';
}

function photoFormSlotHTML(key){
  return '<div class="photo-form-wrap" id="formPhoto_'+key+'">'+formPhotoSlotInner(key)+'</div>';
}

function viewPhoto(unitId,key){
  var u=db.units.find(function(x){return x.id===unitId;});
  var label=key==='before'?'Before':'After';
  openModal('<p class="modal-title">'+label+'</p>'
    +'<img src="'+u[key+'Photo']+'" style="width:100%;border-radius:var(--radius);margin-bottom:14px">'
    +'<div style="display:flex;gap:8px">'
    +'<button class="btn btn-danger" style="flex:1" onclick="removePhoto(\''+unitId+'\',\''+key+'\')">Remove</button>'
    +'<button class="btn" style="flex:1" onclick="closeModal()">Close</button></div>');
}
function removePhoto(unitId,key){
  var u=db.units.find(function(x){return x.id===unitId;});
  delete u[key+'Photo'];idbSave();closeModal();
  renderUnitDetail(db.units.find(function(x){return x.id===state.unitId;}));
  toast('Photo removed');
}

// ── NEW MAP ───────────────────────────────────────────────────────────────────
function showNewMapModal(){
  openModal('<p class="modal-title">New map</p>'
    +'<div class="form-group"><label class="form-label">Map name</label>'
    +'<input id="mName" placeholder="e.g. Sakaw West" autocomplete="off"/></div>'
    +'<div class="form-group"><label class="form-label">Location / area</label>'
    +'<input id="mLoc" placeholder="e.g. Edmonton North" autocomplete="off"/></div>'
    +'<div class="form-group"><label class="form-label">Primary unit type</label>'
    +'<div class="seg" id="mTypeSeg">'
    +'<button class="active" onclick="segSel(\'mTypeSeg\',this)">Pedestal</button>'
    +'<button onclick="segSel(\'mTypeSeg\',this)">Transformer</button>'
    +'<button onclick="segSel(\'mTypeSeg\',this)">Mixed</button>'
    +'</div></div>'
    +'<button class="btn btn-primary" style="width:100%;padding:13px;font-size:15px" onclick="createMap()">Create map</button>');
  setTimeout(function(){var el=$('mName');if(el)el.focus();},150);
}
function createMap(){
  var name=$('mName').value.trim();if(!name)return;
  db.maps.push({id:uid(),name:name,location:$('mLoc').value.trim(),
    type:qs('#mTypeSeg .active').textContent,createdAt:Date.now()});
  idbSave();closeModal();renderMaps();toast('Map created');
}

// ── UNIT FORM ─────────────────────────────────────────────────────────────────
function unitFormHTML(u){
  var status=u?u.status:'Clean';
  var isFail=status==='Fail'||status==='Door Fail';
  return '<div class="form-group"><label class="form-label">EPCOR #</label>'
    +'<input id="uEpcor" value="'+(u?esc(u.epcor):'')+'" placeholder="e.g. PED15828" autocomplete="off"/></div>'
    +'<div class="form-group"><label class="form-label">ASAP # (internal)</label>'
    +'<input id="uAsap" type="number" value="'+(u&&u.asap?u.asap:'')+'" placeholder="e.g. 33"/></div>'
    +'<div class="form-group"><label class="form-label">Unit type</label><div class="seg" id="uTypeSeg">'
    +['Pedestal','Transformer'].map(function(t){
      return '<button'+((!u&&t==='Pedestal')||(u&&u.unitType===t)?' class="active"':'')+' onclick="segSel(\'uTypeSeg\',this)">'+t+'</button>';
    }).join('')+'</div></div>'
    +'<div class="form-group"><label class="form-label">Utility colour</label><div class="seg" id="uColSeg">'
    +['Grey','Green','Other'].map(function(c){
      return '<button'+((!u&&c==='Grey')||(u&&u.utility===c)?' class="active"':'')+' onclick="segSel(\'uColSeg\',this)">'+c+'</button>';
    }).join('')+'</div></div>'
    +'<div class="form-group"><label class="form-label">Status</label><div class="seg" id="uStatSeg">'
    +['Clean','Fail','Door Fail','Vegetation','No Access'].map(function(s){
      return '<button'+(s===status?' class="active"':'')+' onclick="segSel(\'uStatSeg\',this);chkFail()">'+s+'</button>';
    }).join('')+'</div></div>'
    +'<div id="failFields" style="display:'+(isFail?'block':'none')+'">'
    +'<div class="form-group"><label class="form-label">Fail type</label><select id="uFailType">'
    +['Rust Holes (Unit)','Rust Holes (Door)','Oil Leak'].map(function(f){
      return '<option'+(u&&u.failType===f?' selected':'')+'>'+f+'</option>';
    }).join('')+'</select></div>'
    +'<div class="form-group"><label class="form-label">Patches</label>'
    +'<div class="patch-ctrl">'
    +'<button class="patch-btn" onclick="adjP(-1)">−</button>'
    +'<span class="patch-val" id="pNum">'+(u?u.patches||0:0)+'</span>'
    +'<button class="patch-btn" onclick="adjP(1)">+</button>'
    +'</div></div></div>'
    +'<div class="form-group"><label class="form-label">Before photo</label>'
    +photoFormSlotHTML('before')+'</div>'
    +'<div class="form-group" id="afterPhotoGroup" style="display:'+(isFail?'block':'none')+'">'
    +'<label class="form-label">After photo</label>'
    +photoFormSlotHTML('after')+'</div>'
    +'<div class="form-group"><label class="form-label">Notes</label>'
    +'<textarea id="uNotes" rows="2" placeholder="Optional notes...">'+(u?esc(u.notes||''):'')+'</textarea></div>';
}

function showNewUnitModal(){
  patchCount=0;formPhotos={before:null,after:null};
  openModal('<p class="modal-title">Add unit</p>'+unitFormHTML(null)
    +'<button class="btn btn-primary" style="width:100%;padding:13px;font-size:15px;margin-top:4px" onclick="createUnit()">Add unit</button>');
  setTimeout(function(){var el=$('uEpcor');if(el)el.focus();},150);
}

function adjP(d){patchCount=Math.max(0,patchCount+d);$('pNum').textContent=patchCount;}

function chkFail(){
  var s=qs('#uStatSeg .active').textContent;
  var isFail=s==='Fail'||s==='Door Fail';
  $('failFields').style.display=isFail?'block':'none';
  var ag=$('afterPhotoGroup');if(ag) ag.style.display=isFail?'block':'none';
}

function createUnit(){
  var epcor=$('uEpcor').value.trim();if(!epcor)return;
  var status=qs('#uStatSeg .active').textContent;
  var isFail=status==='Fail'||status==='Door Fail';
  var u={id:uid(),mapId:state.mapId,epcor:epcor,
    asap:$('uAsap').value.trim(),
    unitType:qs('#uTypeSeg .active').textContent,
    utility:qs('#uColSeg .active').textContent,
    status:status,
    failType:isFail?$('uFailType').value:'',
    patches:isFail?patchCount:0,
    notes:$('uNotes').value.trim(),
    createdAt:Date.now()};
  if(formPhotos.before) u.beforePhoto=formPhotos.before;
  if(formPhotos.after&&isFail) u.afterPhoto=formPhotos.after;
  patchCount=0;formPhotos={before:null,after:null};
  db.units.push(u);idbSave();closeModal();renderUnits();toast('Unit added');
}

function editUnit(id){
  var u=db.units.find(function(x){return x.id===id;});
  patchCount=u.patches||0;
  formPhotos={before:u.beforePhoto||null,after:u.afterPhoto||null};
  openModal('<p class="modal-title">Edit '+esc(u.epcor)+'</p>'+unitFormHTML(u)
    +'<button class="btn btn-primary" style="width:100%;padding:13px;font-size:15px;margin-top:4px" onclick="saveUnit(\''+id+'\')">Save changes</button>');
}

function saveUnit(id){
  var u=db.units.find(function(x){return x.id===id;});
  var status=qs('#uStatSeg .active').textContent;
  var isFail=status==='Fail'||status==='Door Fail';
  u.epcor=$('uEpcor').value.trim();
  u.asap=$('uAsap').value.trim();
  u.status=status;
  u.failType=isFail?$('uFailType').value:'';
  u.patches=isFail?patchCount:0;
  u.notes=$('uNotes').value.trim();
  if(formPhotos.before) u.beforePhoto=formPhotos.before;
  else if(formPhotos.before===null&&u.beforePhoto) delete u.beforePhoto;
  if(formPhotos.after&&isFail) u.afterPhoto=formPhotos.after;
  else if(!isFail) delete u.afterPhoto;
  patchCount=0;formPhotos={before:null,after:null};
  idbSave();closeModal();
  $('topTitle').textContent=esc(u.epcor);
  renderUnitDetail(u);toast('Saved');
}

function deleteUnit(id){
  if(!confirm('Delete this unit? This cannot be undone.'))return;
  db.units=db.units.filter(function(u){return u.id!==id;});
  idbSave();goBack();toast('Unit deleted');
}

// ── SUMMARY ───────────────────────────────────────────────────────────────────
function showSummary(){
  var us=db.units.filter(function(u){return u.mapId===state.mapId;});
  var map=db.maps.find(function(m){return m.id===state.mapId;});
  var fails=us.filter(function(u){return u.status==='Fail';}).length;
  var door=us.filter(function(u){return u.status==='Door Fail';}).length;
  var veg=us.filter(function(u){return u.status==='Vegetation';}).length;
  var na=us.filter(function(u){return u.status==='No Access';}).length;
  var clean=us.filter(function(u){return u.status==='Clean';}).length;
  var patches=us.reduce(function(a,u){return a+(u.patches||0);},0);
  var ru=us.filter(function(u){return u.failType==='Rust Holes (Unit)';}).length;
  var rd=us.filter(function(u){return u.failType==='Rust Holes (Door)';}).length;
  var oil=us.filter(function(u){return u.failType==='Oil Leak';}).length;
  function sm(n,l){return '<div class="stat-box"><div class="stat-num">'+n+'</div><div class="stat-lbl">'+l+'</div></div>';}
  var html='<p class="modal-title">'+esc(map.name)+'</p>'
    +'<div class="stat-grid">'
    +sm(us.length,'Total')+sm(fails+door,'Fails')+sm(patches,'Patches')
    +sm(veg,'Veg')+sm(na,'No access')+sm(clean,'Clean')+'</div>';
  if(fails||door){
    html+='<div class="section-lbl">Fail breakdown</div>'
      +'<div style="font-size:14px;line-height:2.4">'
      +(ru?'Rust Holes (Unit): <strong style="color:var(--teal)">'+ru+'</strong><br>':'')
      +(rd?'Rust Holes (Door): <strong style="color:var(--teal)">'+rd+'</strong><br>':'')
      +(oil?'Oil Leak: <strong style="color:var(--teal)">'+oil+'</strong><br>':'')
      +'</div>';
  }
  html+='<button class="btn" style="width:100%;margin-top:16px;padding:12px" onclick="closeModal()">Close</button>';
  openModal(html);
}

// ── PDF ───────────────────────────────────────────────────────────────────────
function exportPDF(){
  if(typeof jspdf==='undefined'){toast('PDF loading, try again in a moment');return;}
  var map=db.maps.find(function(m){return m.id===state.mapId;});
  var us=db.units.filter(function(u){return u.mapId===state.mapId;});
  us.sort(function(a,b){return (a.asap?+a.asap:9999)-(b.asap?+b.asap:9999);});
  if(!us.length){toast('No units to export');return;}
  toast('Generating PDF...');
  var doc=new jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  var date=new Date().toLocaleDateString('en-CA');
  var fails=us.filter(function(u){return u.status==='Fail'||u.status==='Door Fail';}).length;
  var patches=us.reduce(function(a,u){return a+(u.patches||0);},0);
  var veg=us.filter(function(u){return u.status==='Vegetation';}).length;
  doc.setFontSize(20);doc.setFont(undefined,'bold');doc.text(map.name,14,20);
  doc.setFontSize(10);doc.setFont(undefined,'normal');doc.setTextColor(100);
  doc.text(map.location+'  ·  '+map.type+'  ·  '+date,14,27);
  doc.setTextColor(0);
  doc.text('Total: '+us.length+'   Fails: '+fails+'   Patches: '+patches+'   Veg: '+veg,14,34);
  var rows=us.map(function(u){
    return [u.epcor||'',u.asap||'',u.unitType||'',u.status,u.failType||'—',u.patches||0,u.notes||''];
  });
  doc.autoTable({
    startY:40,
    head:[['EPCOR #','ASAP #','Type','Status','Fail type','Patches','Notes']],
    body:rows,
    styles:{fontSize:9,cellPadding:3,overflow:'linebreak'},
    headStyles:{fillColor:[13,148,136],textColor:255,fontStyle:'bold',fontSize:9},
    alternateRowStyles:{fillColor:[248,253,252]},
    columnStyles:{0:{fontStyle:'bold',cellWidth:28},1:{cellWidth:18,halign:'center'},2:{cellWidth:22},3:{cellWidth:22},4:{cellWidth:32},5:{cellWidth:16,halign:'center'},6:{cellWidth:'auto'}},
    didParseCell:function(d){
      if(d.section==='body'&&d.column.index===3){
        var s=d.cell.raw;
        if(s==='Fail') d.cell.styles.textColor=[180,30,30];
        else if(s==='Door Fail') d.cell.styles.textColor=[146,64,14];
        else if(s==='Vegetation') d.cell.styles.textColor=[22,101,52];
        else if(s==='No Access') d.cell.styles.textColor=[100,100,100];
      }
    },
    margin:{left:14,right:14}
  });
  doc.save(map.name.replace(/\s+/g,'_')+'_'+date+'.pdf');
  setTimeout(function(){toast('PDF saved!');},600);
}

// ── BACKUP ────────────────────────────────────────────────────────────────────
function exportBackup(){
  var blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;a.download='utilitylog_'+new Date().toLocaleDateString('en-CA')+'.json';
  a.click();URL.revokeObjectURL(url);toast('Backup exported!');
}
function importBackup(e){
  var file=e.target.files[0];if(!file)return;
  var r=new FileReader();
  r.onload=function(ev){
    try{
      var parsed=JSON.parse(ev.target.result);
      if(parsed.maps&&parsed.units){
        if(!confirm('Replace all current data with this backup?'))return;
        db=parsed;idbSave();showMaps();toast('Backup imported!');
      }else{toast('Invalid backup file');}
    }catch(err){toast('Could not read file');}
  };r.readAsText(file);e.target.value='';
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function openModal(html){
  $('modalBox').innerHTML='<div class="modal-handle"></div>'+html;
  $('overlay').classList.add('open');
}
function closeModal(){
  $('overlay').classList.remove('open');
  patchCount=0;
}
function closeModalOutside(e){if(e.target===$('overlay'))closeModal();}

// ── INIT ──────────────────────────────────────────────────────────────────────
var s1=document.createElement('script');
s1.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
document.head.appendChild(s1);
var s2=document.createElement('script');
s2.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.6.0/jspdf.plugin.autotable.min.js';
document.head.appendChild(s2);

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(function(){});
}

openIDB(function(){idbGet(function(){showMaps();});});
