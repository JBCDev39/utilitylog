// ── STORAGE ───────────────────────────────────────────────────────────────────
var DB_NAME='utilityInspect',DB_VER=1,STORE='data';
var idb=null;
var db={maps:[],units:[],trash:[]};
var state={screen:'maps',mapId:null,unitId:null,filter:'All',sort:'asap',navDir:'forward'};
var patchCount=0;
var formState={mode:'new',unitId:null,pendingPhotoKey:null};
var formPhotos={before:null,after:null};
var newMapPhoto=null;
var FORM_KEY='ulf_form';
var FAIL_TYPES=['Rust Holes (Door)','Rust Holes (Unit & Body)','Oil Leak'];
var STATUS_ORDER={Fail:0,Vegetation:1,'No Access':2,Clean:3};

// ── INDEXED DB ────────────────────────────────────────────────────────────────
function openIDB(cb){
  var req=indexedDB.open(DB_NAME,DB_VER);
  req.onupgradeneeded=function(e){
    if(!e.target.result.objectStoreNames.contains(STORE))
      e.target.result.createObjectStore(STORE);
  };
  req.onsuccess=function(e){idb=e.target.result;cb();};
  req.onerror=function(){cb();};
}
function idbGet(cb){
  if(!idb)return cb();
  var tx=idb.transaction(STORE,'readonly');
  var req=tx.objectStore(STORE).get('db');
  req.onsuccess=function(e){
    if(e.target.result){db=e.target.result;if(!db.trash)db.trash=[];}
    cb();
  };
  req.onerror=function(){cb();};
}
function idbSave(){
  if(!idb)return;
  idb.transaction(STORE,'readwrite').objectStore(STORE).put(db,'db');
}

// ── FORM STATE PERSISTENCE ────────────────────────────────────────────────────
function saveFormState(){
  try{
    sessionStorage.setItem(FORM_KEY,JSON.stringify({
      mode:formState.mode,unitId:formState.unitId,mapId:state.mapId,
      epcor:val('uEpcor'),asap:val('uAsap'),
      unitType:activeInSeg('uTypeSeg'),status:activeInSeg('uStatSeg'),
      failType:val('uFailType'),patches:patchCount,notes:val('uNotes'),
      photoKey:formState.pendingPhotoKey,
      beforePhoto:formPhotos.before,afterPhoto:formPhotos.after
    }));
  }catch(e){}
}
function clearFormState(){try{sessionStorage.removeItem(FORM_KEY);}catch(e){}}
function restoreFormIfNeeded(){
  try{
    var raw=sessionStorage.getItem(FORM_KEY);
    if(!raw)return false;
    var fs=JSON.parse(raw);
    if(!fs.photoKey)return false;
    clearFormState();
    state.mapId=fs.mapId;
    formPhotos={before:fs.beforePhoto||null,after:fs.afterPhoto||null};
    patchCount=fs.patches||0;
    formState={mode:fs.mode,unitId:fs.unitId||null,pendingPhotoKey:null};
    var u=fs.mode==='edit'?db.units.find(function(x){return x.id===fs.unitId;}):null;
    openUnitForm(u,fs);
    setTimeout(function(){refreshFormPhotoSlot('before');refreshFormPhotoSlot('after');},80);
    return true;
  }catch(e){return false;}
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function toast(msg){
  var t=$('toast');t.textContent=msg;t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},2400);
}
function $(id){return document.getElementById(id);}
function qs(sel,ctx){return (ctx||document).querySelector(sel);}
function val(id){var el=$(id);return el?el.value:'';}
function activeInSeg(gid){var el=qs('#'+gid+' .active');return el?el.textContent:'';}
function esc(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function segSel(gid,btn){
  document.querySelectorAll('#'+gid+' button').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
}
function statusBadge(s){
  var m={Fail:'b-fail',Vegetation:'b-veg','No Access':'b-na',Clean:'b-clean'};
  return '<span class="badge '+(m[s]||'b-clean')+'">'+s+'</span>';
}
function typeBadge(t){
  return t==='Pedestal'?'<span class="badge b-ped">Pedestal</span>':'<span class="badge b-trans">Transformer</span>';
}
function daysLeft(d){return Math.max(0,30-Math.floor((Date.now()-d)/(864e5)));}
function showFab(){var f=$('fab');f.classList.add('visible');}
function hideFab(){var f=$('fab');f.classList.remove('visible');}

// ── IMAGE COMPRESSION ─────────────────────────────────────────────────────────
function compressImage(dataUrl,maxDim,quality,cb){
  var img=new Image();
  img.onload=function(){
    var w=img.width,h=img.height;
    if(w>maxDim||h>maxDim){
      if(w>h){h=Math.round(h*maxDim/w);w=maxDim;}
      else{w=Math.round(w*maxDim/h);h=maxDim;}
    }
    var c=document.createElement('canvas');
    c.width=w;c.height=h;
    c.getContext('2d').drawImage(img,0,0,w,h);
    cb(c.toDataURL('image/jpeg',quality));
  };
  img.src=dataUrl;
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────
function setScreen(name,dir){
  var screens=document.querySelectorAll('.screen');
  screens.forEach(function(s){s.classList.remove('active','anim-in','anim-back','anim-fade');});
  var el=$('screen'+name.charAt(0).toUpperCase()+name.slice(1));
  el.classList.add('active');
  el.classList.add(dir==='back'?'anim-back':dir==='fade'?'anim-fade':'anim-in');
  state.screen=name;
  $('mainContent').scrollTop=0;
}
function goBack(){
  if(state.screen==='unit'){showUnits(state.mapId,'back');}
  else{showMaps('back');}
}
function fabAction(){
  if(state.screen==='maps') showNewMapModal();
  else if(state.screen==='units') showNewUnitModal();
}

// ── MAPS ──────────────────────────────────────────────────────────────────────
function showMaps(dir){
  state.mapId=null;state.unitId=null;
  $('topTitle').textContent='UtilityLog';
  $('backWrap').style.display='none';
  $('controlsRow').classList.remove('visible');
  purgeExpiredTrash();
  var trashCount=db.trash.length;
  $('topActs').innerHTML='<button class="btn btn-sm" onclick="showTrash()">'
    +'🗑'+(trashCount?'<span class="trash-badge">'+trashCount+'</span>':'')+'</button>';
  showFab();renderMaps();setScreen('maps',dir||'fade');
}

function renderMaps(){
  var c=$('screenMaps');
  if(!db.maps.length){
    c.innerHTML='<div class="empty-state"><div class="empty-ico">🗺️</div>'
      +'<p style="font-weight:600;font-size:16px">No maps yet</p>'
      +'<p style="font-size:13px;margin-top:6px">Tap + to create your first map</p></div>'
      +dataSection();
    return;
  }
  c.innerHTML=db.maps.map(function(m,i){
    var us=db.units.filter(function(u){return u.mapId===m.id;});
    var fails=us.filter(function(u){return u.status==='Fail';}).length;
    var vegs=us.filter(function(u){return u.status==='Vegetation';}).length;
    var patches=us.reduce(function(a,u){return a+(u.patches||0);},0);
    var date=m.createdAt?new Date(m.createdAt).toLocaleDateString('en-CA'):'';
    var thumbHtml=m.photo
      ?'<img class="map-thumb" src="'+m.photo+'" onclick="viewMapPhoto(\''+m.id+'\')" alt="Map">'
      :'<div class="map-thumb-placeholder" onclick="addMapPhoto(\''+m.id+'\')">🗺️</div>';
    var delay=(i*0.04)+'s';
    return '<div class="card card-anim" style="animation-delay:'+delay+'">'
      +'<div class="card-row" style="cursor:pointer" onclick="showUnits(\''+m.id+'\')">'
      +'<div style="flex:1;min-width:0">'
      +'<div class="card-title">'+esc(m.name)+'</div>'
      +'<div class="card-sub">'+esc(m.location)+(date?' · '+date:'')+'</div>'
      +(m.notes?'<div style="font-size:12px;color:var(--text3);margin-top:3px;font-style:italic">'+esc(m.notes)+'</div>':'')
      +'<div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap">'
      +'<span style="font-size:12px;color:var(--text2)">'+us.length+' unit'+(us.length!==1?'s':'')+'</span>'
      +(fails?'<span style="font-size:12px;color:var(--danger-text)">'+fails+' fail'+(fails>1?'s':'')+'</span>':'')
      +(vegs?'<span style="font-size:12px;color:var(--grn-text)">'+vegs+' veg</span>':'')
      +(patches?'<span style="font-size:12px;color:var(--text2)">'+patches+' patch'+(patches>1?'es':'')+'</span>':'')
      +'</div></div>'+thumbHtml+'</div>'
      +'<div class="map-acts">'
      +'<button class="btn btn-sm" onclick="showUnits(\''+m.id+'\')">Open</button>'
      +'<button class="btn btn-sm" onclick="addMapPhoto(\''+m.id+'\')">📷 '+(m.photo?'Rephoto':'Photo')+'</button>'
      +'<button class="btn btn-sm" onclick="editMapNotes(\''+m.id+'\')">Notes</button>'
      +'<button class="btn btn-sm" onclick="softDeleteMap(\''+m.id+'\',\''+esc(m.name)+'\')">Delete</button>'
      +'</div></div>';
  }).join('')+dataSection();
  c.innerHTML=c.innerHTML; // trigger repaint for animations
}

function dataSection(){
  return '<div class="section-lbl" style="margin-top:8px">Data</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap">'
    +'<button class="btn" onclick="exportBackup()">Export backup</button>'
    +'<button class="btn" onclick="$(\'importFile\').click()">Import backup</button>'
    +'<input type="file" id="importFile" accept=".json" style="display:none" onchange="importBackup(event)"/>'
    +'</div>';
}

function addMapPhoto(mapId){
  var inp=document.createElement('input');
  inp.type='file';inp.accept='image/*';inp.capture='environment';
  inp.onchange=function(){
    var file=inp.files[0];if(!file)return;
    var r=new FileReader();
    r.onload=function(e){
      compressImage(e.target.result,1200,0.82,function(comp){
        var m=db.maps.find(function(x){return x.id===mapId;});
        m.photo=comp;idbSave();renderMaps();toast('Map photo saved');
      });
    };r.readAsDataURL(file);
  };inp.click();
}
function viewMapPhoto(mapId){
  var m=db.maps.find(function(x){return x.id===mapId;});
  if(!m||!m.photo)return;
  openModal('<p class="modal-title">'+esc(m.name)+'</p>'
    +'<img class="map-photo-full" src="'+m.photo+'" alt="Map photo">'
    +'<div style="display:flex;gap:8px">'
    +'<button class="btn btn-danger" style="flex:1" onclick="removeMapPhoto(\''+mapId+'\')">Remove</button>'
    +'<button class="btn" style="flex:1" onclick="closeModal()">Close</button></div>');
}
function removeMapPhoto(mapId){
  var m=db.maps.find(function(x){return x.id===mapId;});
  delete m.photo;idbSave();closeModal();renderMaps();toast('Photo removed');
}

function editMapNotes(mapId){
  var m=db.maps.find(function(x){return x.id===mapId;});
  openModal('<p class="modal-title">Map notes</p>'
    +'<div class="form-group"><label class="form-label">Notes</label>'
    +'<textarea id="mNotesVal" rows="4" placeholder="Gate code, contact, access info…" style="resize:none">'+esc(m.notes||'')+'</textarea></div>'
    +'<button class="btn btn-primary" style="width:100%;padding:13px" onclick="saveMapNotes(\''+mapId+'\')">Save</button>');
  setTimeout(function(){var el=$('mNotesVal');if(el)el.focus();},150);
}
function saveMapNotes(mapId){
  var m=db.maps.find(function(x){return x.id===mapId;});
  m.notes=val('mNotesVal').trim();
  idbSave();closeModal();renderMaps();toast('Notes saved');
}

// ── TRASH ─────────────────────────────────────────────────────────────────────
function softDeleteMap(mapId,mapName){
  if(!confirm('Move "'+mapName+'" to trash? Kept for 30 days.'))return;
  var map=db.maps.find(function(m){return m.id===mapId;});
  var units=db.units.filter(function(u){return u.mapId===mapId;});
  db.trash.push({map:map,units:units,deletedAt:Date.now()});
  db.maps=db.maps.filter(function(m){return m.id!==mapId;});
  db.units=db.units.filter(function(u){return u.mapId!==mapId;});
  idbSave();showMaps();toast('Map moved to trash');
}
function purgeExpiredTrash(){
  var b=db.trash.length;
  db.trash=db.trash.filter(function(t){return daysLeft(t.deletedAt)>0;});
  if(db.trash.length!==b)idbSave();
}
function showTrash(){
  $('topTitle').textContent='Trash';
  $('backWrap').style.display='';
  $('topActs').innerHTML='';
  $('controlsRow').classList.remove('visible');
  hideFab();renderTrash();setScreen('trash');
}
function renderTrash(){
  var c=$('screenTrash');
  if(!db.trash.length){
    c.innerHTML='<div class="empty-state"><div class="empty-ico">🗑️</div>'
      +'<p style="font-weight:600;font-size:16px">Trash is empty</p>'
      +'<p style="font-size:13px;margin-top:6px">Deleted maps appear here for 30 days</p></div>';
    return;
  }
  c.innerHTML=db.trash.map(function(t,i){
    var days=daysLeft(t.deletedAt);
    return '<div class="card card-anim" style="animation-delay:'+(i*0.04)+'s">'
      +'<div class="card-row"><div>'
      +'<div class="card-title">'+esc(t.map.name)+'</div>'
      +'<div class="card-sub">'+esc(t.map.location)+'</div>'
      +'<div style="font-size:12px;color:var(--warn-text);margin-top:4px">'+days+' day'+(days!==1?'s':'')+' left</div>'
      +'</div>'+typeBadge(t.map.type||'Pedestal')+'</div>'
      +'<div class="map-acts">'
      +'<button class="btn btn-sm" onclick="restoreMap('+i+')">Restore</button>'
      +'<button class="btn btn-sm btn-danger" onclick="permanentDeleteMap('+i+')">Delete forever</button>'
      +'</div></div>';
  }).join('');
}
function restoreMap(idx){
  var t=db.trash[idx];
  db.maps.push(t.map);(t.units||[]).forEach(function(u){db.units.push(u);});
  db.trash.splice(idx,1);idbSave();showMaps();toast('Map restored');
}
function permanentDeleteMap(idx){
  if(!confirm('Permanently delete "'+db.trash[idx].map.name+'"?'))return;
  db.trash.splice(idx,1);idbSave();renderTrash();toast('Permanently deleted');
}

// ── UNITS ─────────────────────────────────────────────────────────────────────
function showUnits(mapId,dir){
  state.mapId=mapId;state.filter='All';state.sort='asap';
  var map=db.maps.find(function(m){return m.id===mapId;});
  $('topTitle').textContent=esc(map.name);
  $('backWrap').style.display='';
  $('topActs').innerHTML=
    '<button class="btn btn-sm" onclick="showSummary()">Summary</button>'
    +'<button class="btn btn-sm" onclick="exportPDF()">PDF</button>';
  $('filterSelect').value='All';
  $('sortSelect').value='asap';
  $('searchInput').value='';
  $('controlsRow').classList.add('visible');
  showFab();renderUnits();setScreen('units',dir||'forward');
}
function setFilter(f){state.filter=f;renderUnits();}
function setSort(s){state.sort=s;renderUnits();}
function renderUnits(){
  var q=($('searchInput')?$('searchInput').value:'').toLowerCase().trim();
  var us=db.units.filter(function(u){return u.mapId===state.mapId;});
  if(state.filter!=='All') us=us.filter(function(u){return u.status===state.filter;});
  if(q) us=us.filter(function(u){
    return (u.epcor||'').toLowerCase().includes(q)||(u.asap||'').toString().includes(q);
  });
  if(state.sort==='status'){
    us.sort(function(a,b){
      var ao=STATUS_ORDER[a.status]!==undefined?STATUS_ORDER[a.status]:9;
      var bo=STATUS_ORDER[b.status]!==undefined?STATUS_ORDER[b.status]:9;
      return ao!==bo?ao-bo:(a.asap?+a.asap:9999)-(b.asap?+b.asap:9999);
    });
  } else {
    us.sort(function(a,b){return (a.asap?+a.asap:9999)-(b.asap?+b.asap:9999);});
  }
  var c=$('screenUnits');
  if(!us.length){
    c.innerHTML='<div class="empty-state"><div class="empty-ico">🔌</div>'
      +'<p style="font-weight:600;font-size:16px">'+(q?'No results for "'+esc(q)+'"':state.filter!=='All'?'No "'+state.filter+'" units':'No units yet')+'</p>'
      +'<p style="font-size:13px;margin-top:6px">'+(q||state.filter!=='All'?'Try a different search or filter':'Tap + to add a unit')+'</p></div>';
    return;
  }
  c.innerHTML=us.map(function(u,i){
    var photos=(u.beforePhoto?1:0)+(u.afterPhoto?1:0);
    return '<div class="card card-tap card-anim" style="animation-delay:'+(i*0.03)+'s" onclick="showUnit(\''+u.id+'\')">'
      +'<div class="card-row"><span class="card-title">'+esc(u.epcor)+'</span>'+statusBadge(u.status)+'</div>'
      +'<div style="display:flex;gap:8px;margin-top:5px;flex-wrap:wrap">'
      +(u.asap?'<span class="card-sub">ASAP #'+esc(u.asap)+'</span>':'')
      +(u.failType?'<span class="card-sub">· '+esc(u.failType)+'</span>':'')
      +(u.patches?'<span class="card-sub">· '+u.patches+' patch'+(u.patches>1?'es':'')+'</span>':'')
      +(photos?'<span class="card-sub" style="color:var(--grn-text)">· 📷 '+photos+' photo'+(photos>1?'s':'')+'</span>':'')
      +'</div></div>';
  }).join('');
}

// ── UNIT DETAIL ───────────────────────────────────────────────────────────────
function showUnit(id){
  state.unitId=id;
  var u=db.units.find(function(x){return x.id===id;});
  $('topTitle').textContent=esc(u.epcor);
  $('backWrap').style.display='';
  $('controlsRow').classList.remove('visible');
  $('topActs').innerHTML=
    '<button class="btn btn-sm" onclick="exportUnitPDF(\''+id+'\')">PDF</button>'
    +'<button class="btn btn-sm" onclick="startEditUnit(\''+id+'\')">Edit</button>';
  hideFab();renderUnitDetail(u);setScreen('unit');
}
function renderUnitDetail(u){
  var isFail=u.status==='Fail';
  var html='<div class="unit-header anim-fade">'
    +'<div class="card-row"><div>'
    +'<div style="font-size:22px;font-weight:700;letter-spacing:-0.5px">'+esc(u.epcor)+'</div>'
    +(u.asap?'<div style="font-size:13px;color:var(--text2);margin-top:2px">ASAP #'+esc(u.asap)+'</div>':'')
    +'</div>'+statusBadge(u.status)+'</div>'
    +'<div style="margin-top:10px">'+typeBadge(u.unitType||'Pedestal')+'</div></div>';
  if(isFail){
    html+='<div class="section-lbl">Fail details</div>'
      +'<div class="row-detail"><span style="font-size:13px;color:var(--text2)">Type</span>'
      +'<span style="font-size:14px;font-weight:500">'+(u.failType?esc(u.failType):'—')+'</span></div>'
      +'<div class="row-detail"><span style="font-size:13px;color:var(--text2)">Patches</span>'
      +'<span style="font-size:18px;font-weight:700;color:var(--grn)">'+(u.patches||0)+'</span></div>';
  }
  if(u.status==='Vegetation') html+='<div style="padding:10px 0;font-size:14px;color:var(--text2)">Vegetation noted.</div>';
  if(u.status==='No Access') html+='<div style="padding:10px 0;font-size:14px;color:var(--text2)">Unit not accessible.</div>';
  html+='<div class="section-lbl">Photos</div><div class="photo-grid">'
    +detailPhotoSlot(u,'before','Before')
    +detailPhotoSlot(u,'after','After')
    +'</div>';
  if(u.notes) html+='<div class="section-lbl">Notes</div>'
    +'<div style="font-size:14px;line-height:1.65;color:var(--text2)">'+esc(u.notes)+'</div>';
  html+='<div style="margin-top:22px;padding-bottom:20px">'
    +'<button class="btn btn-danger" style="width:100%" onclick="deleteUnit(\''+u.id+'\')">Delete unit</button></div>';
  $('screenUnit').innerHTML=html;
}
function detailPhotoSlot(u,key,label){
  var p=u[key+'Photo'];
  if(p) return '<div class="photo-slot" onclick="viewDetailPhoto(\''+u.id+'\',\''+key+'\')">'
    +'<img src="'+p+'" alt="'+label+'">'
    +'<span style="position:absolute;bottom:5px;left:7px;background:rgba(0,0,0,0.55);color:#fff;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:600;z-index:1">'+label+'</span></div>';
  return '<div class="photo-slot" onclick="detailPickPhoto(\''+u.id+'\',\''+key+'\')">'
    +'<span class="p-ico">+</span><span class="p-lbl">'+label+'</span></div>';
}
function detailPickPhoto(unitId,key){
  openModal('<p class="modal-title">Add photo</p>'
    +'<div style="display:flex;flex-direction:column;gap:10px;padding-bottom:6px">'
    +'<button class="btn" style="width:100%;padding:14px;font-size:15px" onclick="detailLaunch(\''+unitId+'\',\''+key+'\',true)">📷 Take photo</button>'
    +'<button class="btn" style="width:100%;padding:14px;font-size:15px" onclick="detailLaunch(\''+unitId+'\',\''+key+'\',false)">🖼️ Gallery</button>'
    +'<button class="btn" style="width:100%;padding:12px" onclick="closeModal()">Cancel</button>'
    +'</div>');
}
function detailLaunch(unitId,key,cam){
  closeModal();
  var inp=document.createElement('input');
  inp.type='file';inp.accept='image/*';if(cam)inp.capture='environment';
  inp.onchange=function(){
    var file=inp.files[0];if(!file)return;
    var r=new FileReader();
    r.onload=function(e){
      compressImage(e.target.result,1600,0.85,function(comp){
        var u=db.units.find(function(x){return x.id===unitId;});
        u[key+'Photo']=comp;idbSave();
        renderUnitDetail(db.units.find(function(x){return x.id===state.unitId;}));
        toast('Photo saved');
      });
    };r.readAsDataURL(file);
  };inp.click();
}
function viewDetailPhoto(unitId,key){
  var u=db.units.find(function(x){return x.id===unitId;});
  var label=key==='before'?'Before':'After';
  openModal('<p class="modal-title">'+label+'</p>'
    +'<img src="'+u[key+'Photo']+'" style="width:100%;border-radius:var(--radius);margin-bottom:14px">'
    +'<div style="display:flex;gap:8px">'
    +'<button class="btn btn-danger" style="flex:1" onclick="removeDetailPhoto(\''+unitId+'\',\''+key+'\')">Remove</button>'
    +'<button class="btn" style="flex:1" onclick="closeModal()">Close</button></div>');
}
function removeDetailPhoto(unitId,key){
  var u=db.units.find(function(x){return x.id===unitId;});
  delete u[key+'Photo'];idbSave();closeModal();
  renderUnitDetail(db.units.find(function(x){return x.id===state.unitId;}));
  toast('Photo removed');
}
function deleteUnit(id){
  if(!confirm('Delete this unit?'))return;
  db.units=db.units.filter(function(u){return u.id!==id;});
  idbSave();goBack();toast('Unit deleted');
}

// ── UNIT FORM ─────────────────────────────────────────────────────────────────
function showNewUnitModal(){
  patchCount=0;formPhotos={before:null,after:null};
  formState={mode:'new',unitId:null,pendingPhotoKey:null};
  openUnitForm(null,null);
}
function startEditUnit(id){
  var u=db.units.find(function(x){return x.id===id;});
  patchCount=u.patches||0;
  formPhotos={before:u.beforePhoto||null,after:u.afterPhoto||null};
  formState={mode:'edit',unitId:id,pendingPhotoKey:null};
  openUnitForm(u,null);
}
function openUnitForm(u,saved){
  var status=saved?saved.status:(u?u.status:'Clean');
  var isFail=status==='Fail';
  var unitType=saved?saved.unitType:(u?u.unitType:'Pedestal');
  var html='<p class="modal-title">'+(u&&!saved?'Edit '+esc(u.epcor):'Add unit')+'</p>'
    +'<div class="form-group"><label class="form-label">EPCOR #</label>'
    +'<input id="uEpcor" value="'+(saved?esc(saved.epcor):(u?esc(u.epcor):''))+'" '
    +'placeholder="'+(unitType==='Pedestal'?'e.g. PED15828':'e.g. T1234')+'" autocomplete="off"/></div>'
    +'<div class="form-group"><label class="form-label">ASAP # (internal)</label>'
    +'<input id="uAsap" type="number" value="'+(saved?saved.asap:(u&&u.asap?u.asap:''))+'" placeholder="e.g. 33"/></div>'
    +'<div class="form-group"><label class="form-label">Unit type</label><div class="seg" id="uTypeSeg">'
    +['Pedestal','Transformer'].map(function(t){
      var active=saved?saved.unitType===t:(u?u.unitType===t:t==='Pedestal');
      return '<button'+(active?' class="active"':'')+' onclick="segSel(\'uTypeSeg\',this);onUnitTypeChange(this)">'+t+'</button>';
    }).join('')+'</div></div>'
    +'<div class="form-group"><label class="form-label">Status</label><div class="seg" id="uStatSeg">'
    +['Clean','Fail','Vegetation','No Access'].map(function(s){
      return '<button'+(s===status?' class="active"':'')+' onclick="segSel(\'uStatSeg\',this);chkFail()">'+s+'</button>';
    }).join('')+'</div></div>'
    +'<div id="failFields" class="field-expand'+(isFail?' shown':' hidden')+'" style="max-height:'+(isFail?'200px':'0')+'">'
    +'<div class="form-group"><label class="form-label">Fail type</label><select id="uFailType">'
    +FAIL_TYPES.map(function(f){
      var sel=saved?saved.failType===f:(u&&u.failType===f);
      return '<option'+(sel?' selected':'')+'>'+f+'</option>';
    }).join('')+'</select></div>'
    +'<div class="form-group"><label class="form-label">Patches</label>'
    +'<div class="patch-ctrl"><button class="patch-btn" onclick="adjP(-1)">−</button>'
    +'<span class="patch-val" id="pNum">'+(saved?saved.patches:(u?u.patches||0:0))+'</span>'
    +'<button class="patch-btn" onclick="adjP(1)">+</button></div></div></div>'
    +'<div class="form-group"><label class="form-label">Before photo</label>'
    +'<div class="photo-form-wrap" id="formPhoto_before">'+formPhotoSlotInner('before')+'</div></div>'
    +'<div class="form-group"><label class="form-label">After photo</label>'
    +'<div class="photo-form-wrap" id="formPhoto_after">'+formPhotoSlotInner('after')+'</div></div>'
    +'<div class="form-group"><label class="form-label">Notes</label>'
    +'<textarea id="uNotes" rows="2" placeholder="Optional notes…" style="resize:none">'+(saved?esc(saved.notes||''):(u?esc(u.notes||''):''))+'</textarea></div>'
    +'<button class="btn btn-primary" style="width:100%;padding:13px;font-size:15px;margin-top:4px" onclick="submitUnitForm()">'
    +(formState.mode==='edit'?'Save changes':'Add unit')+'</button>';
  openModal(html);
  if(saved) patchCount=saved.patches||0;
}
function onUnitTypeChange(btn){
  var el=$('uEpcor');
  if(el) el.placeholder=btn.textContent==='Pedestal'?'e.g. PED15828':'e.g. T1234';
}
function adjP(d){patchCount=Math.max(0,patchCount+d);$('pNum').textContent=patchCount;}
function chkFail(){
  var s=activeInSeg('uStatSeg');
  var isFail=s==='Fail';
  var el=$('failFields');
  if(el){
    el.style.maxHeight=isFail?'200px':'0';
    el.classList.toggle('shown',isFail);
    el.classList.toggle('hidden',!isFail);
  }
}
function submitUnitForm(){
  var epcor=val('uEpcor').trim();if(!epcor){toast('EPCOR # is required');return;}
  var status=activeInSeg('uStatSeg');
  var isFail=status==='Fail';
  if(formState.mode==='edit'){
    var u=db.units.find(function(x){return x.id===formState.unitId;});
    u.epcor=epcor;u.asap=val('uAsap').trim();
    u.unitType=activeInSeg('uTypeSeg');u.status=status;
    u.failType=isFail?val('uFailType'):'';u.patches=isFail?patchCount:0;
    u.notes=val('uNotes').trim();
    if(formPhotos.before)u.beforePhoto=formPhotos.before;
    else if(formPhotos.before===null)delete u.beforePhoto;
    if(formPhotos.after)u.afterPhoto=formPhotos.after;
    else if(formPhotos.after===null)delete u.afterPhoto;
    idbSave();clearFormState();closeModal();
    $('topTitle').textContent=esc(u.epcor);
    renderUnitDetail(u);toast('Saved');
  } else {
    var nu={id:uid(),mapId:state.mapId,epcor:epcor,asap:val('uAsap').trim(),
      unitType:activeInSeg('uTypeSeg'),status:status,
      failType:isFail?val('uFailType'):'',patches:isFail?patchCount:0,
      notes:val('uNotes').trim(),createdAt:Date.now()};
    if(formPhotos.before)nu.beforePhoto=formPhotos.before;
    if(formPhotos.after)nu.afterPhoto=formPhotos.after;
    db.units.push(nu);idbSave();clearFormState();closeModal();
    patchCount=0;formPhotos={before:null,after:null};
    renderUnits();toast('Unit added');
  }
}

// ── FORM PHOTOS ───────────────────────────────────────────────────────────────
function formPhotoSlotInner(key){
  var label=key==='before'?'Before':'After';
  if(formPhotos[key]){
    return '<img class="photo-form-preview" src="'+formPhotos[key]+'" alt="'+label+'">'
      +'<div class="photo-form-actions">'
      +'<button onclick="formLaunch(\''+key+'\',true)">📷 Retake</button>'
      +'<button onclick="formLaunch(\''+key+'\',false)">🖼️ Gallery</button>'
      +'<button onclick="formRemovePhoto(\''+key+'\')">Remove</button>'
      +'</div>';
  }
  return '<div class="photo-form-empty" onclick="formLaunch(\''+key+'\',false)">'
    +'<span class="pfe-ico">+</span><span class="pfe-lbl">Tap to add</span></div>'
    +'<div class="photo-form-actions">'
    +'<button onclick="formLaunch(\''+key+'\',true)">📷 Camera</button>'
    +'<button onclick="formLaunch(\''+key+'\',false)">🖼️ Gallery</button>'
    +'</div>';
}
function refreshFormPhotoSlot(key){var s=$('formPhoto_'+key);if(s)s.innerHTML=formPhotoSlotInner(key);}
function formRemovePhoto(key){formPhotos[key]=null;refreshFormPhotoSlot(key);saveFormState();}
function formLaunch(key,cam){
  formState.pendingPhotoKey=key;saveFormState();
  var inp=document.createElement('input');
  inp.type='file';inp.accept='image/*';if(cam)inp.capture='environment';
  inp.onchange=function(){
    var file=inp.files[0];if(!file)return;
    var r=new FileReader();
    r.onload=function(e){
      compressImage(e.target.result,1600,0.85,function(comp){
        formPhotos[key]=comp;formState.pendingPhotoKey=null;
        saveFormState();refreshFormPhotoSlot(key);toast('Photo added');
      });
    };r.readAsDataURL(file);
  };inp.click();
}

// ── NEW MAP ───────────────────────────────────────────────────────────────────
function showNewMapModal(){
  newMapPhoto=null;
  openModal('<p class="modal-title">New map</p>'
    +'<div class="form-group"><label class="form-label">Map name</label>'
    +'<input id="mName" placeholder="e.g. Sakaw West" autocomplete="off"/></div>'
    +'<div class="form-group"><label class="form-label">Location / area</label>'
    +'<input id="mLoc" placeholder="e.g. Edmonton North" autocomplete="off"/></div>'
    +'<div class="form-group"><label class="form-label">Notes (optional)</label>'
    +'<textarea id="mNotes" rows="2" placeholder="Gate code, contact info…" style="resize:none"></textarea></div>'
    +'<div class="form-group"><label class="form-label">Primary unit type</label>'
    +'<div class="seg" id="mTypeSeg">'
    +'<button class="active" onclick="segSel(\'mTypeSeg\',this)">Pedestal</button>'
    +'<button onclick="segSel(\'mTypeSeg\',this)">Transformer</button>'
    +'<button onclick="segSel(\'mTypeSeg\',this)">Mixed</button>'
    +'</div></div>'
    +'<div class="form-group"><label class="form-label">Map photo (optional)</label>'
    +'<div class="photo-form-wrap" id="newMapPhotoSlot">'
    +'<div class="photo-form-empty" onclick="pickNewMapPhoto(false)">'
    +'<span class="pfe-ico">+</span><span class="pfe-lbl">Tap to add</span></div>'
    +'<div class="photo-form-actions">'
    +'<button onclick="pickNewMapPhoto(true)">📷 Camera</button>'
    +'<button onclick="pickNewMapPhoto(false)">🖼️ Gallery</button>'
    +'</div></div></div>'
    +'<button class="btn btn-primary" style="width:100%;padding:13px;font-size:15px" onclick="createMap()">Create map</button>');
  setTimeout(function(){var el=$('mName');if(el)el.focus();},150);
}
function pickNewMapPhoto(cam){
  var inp=document.createElement('input');
  inp.type='file';inp.accept='image/*';if(cam)inp.capture='environment';
  inp.onchange=function(){
    var file=inp.files[0];if(!file)return;
    var r=new FileReader();
    r.onload=function(e){
      compressImage(e.target.result,1200,0.82,function(comp){
        newMapPhoto=comp;
        var slot=$('newMapPhotoSlot');
        if(slot) slot.innerHTML='<img class="photo-form-preview" src="'+comp+'" alt="Map">'
          +'<div class="photo-form-actions">'
          +'<button onclick="pickNewMapPhoto(true)">📷 Retake</button>'
          +'<button onclick="pickNewMapPhoto(false)">🖼️ Gallery</button>'
          +'<button onclick="newMapPhoto=null;$(\'newMapPhotoSlot\').innerHTML=\'<div class=\\\"photo-form-empty\\\" onclick=\\\"pickNewMapPhoto(false)\\\"><span class=\\\"pfe-ico\\\">+</span><span class=\\\"pfe-lbl\\\">Tap to add</span></div><div class=\\\"photo-form-actions\\\"><button onclick=\\\"pickNewMapPhoto(true)\\\">📷 Camera</button><button onclick=\\\"pickNewMapPhoto(false)\\\">🖼️ Gallery</button></div>\'">Remove</button>'
          +'</div>';
        toast('Photo added');
      });
    };r.readAsDataURL(file);
  };inp.click();
}
function createMap(){
  var name=val('mName').trim();if(!name)return;
  var m={id:uid(),name:name,location:val('mLoc').trim(),
    notes:val('mNotes').trim(),
    type:activeInSeg('mTypeSeg'),createdAt:Date.now()};
  if(newMapPhoto)m.photo=newMapPhoto;
  newMapPhoto=null;
  db.maps.push(m);idbSave();closeModal();renderMaps();toast('Map created');
}

// ── SUMMARY ───────────────────────────────────────────────────────────────────
function showSummary(){
  var us=db.units.filter(function(u){return u.mapId===state.mapId;});
  var map=db.maps.find(function(m){return m.id===state.mapId;});
  var fails=us.filter(function(u){return u.status==='Fail';}).length;
  var veg=us.filter(function(u){return u.status==='Vegetation';}).length;
  var na=us.filter(function(u){return u.status==='No Access';}).length;
  var clean=us.filter(function(u){return u.status==='Clean';}).length;
  var patches=us.reduce(function(a,u){return a+(u.patches||0);},0);
  var rd=us.filter(function(u){return u.failType==='Rust Holes (Door)';}).length;
  var ru=us.filter(function(u){return u.failType==='Rust Holes (Unit & Body)';}).length;
  var oil=us.filter(function(u){return u.failType==='Oil Leak';}).length;
  function sm(n,l,delay){return '<div class="stat-box" style="animation-delay:'+delay+'s"><div class="stat-num">'+n+'</div><div class="stat-lbl">'+l+'</div></div>';}
  var html='<p class="modal-title">'+esc(map.name)+'</p>'
    +'<div class="stat-grid">'
    +sm(us.length,'Total',0)+sm(fails,'Fails',0.04)+sm(patches,'Patches',0.08)
    +sm(veg,'Veg',0.12)+sm(na,'No access',0.16)+sm(clean,'Clean',0.2)+'</div>';
  if(fails){
    html+='<div class="section-lbl">Fail breakdown</div>'
      +'<div style="font-size:14px;line-height:2.4">'
      +(rd?'Rust Holes (Door): <strong style="color:var(--grn)">'+rd+'</strong><br>':'')
      +(ru?'Rust Holes (Unit & Body): <strong style="color:var(--grn)">'+ru+'</strong><br>':'')
      +(oil?'Oil Leak: <strong style="color:var(--grn)">'+oil+'</strong><br>':'')
      +'</div>';
  }
  if(map.notes) html+='<div class="section-lbl">Map notes</div>'
    +'<div style="font-size:14px;color:var(--text2);line-height:1.6">'+esc(map.notes)+'</div>';
  html+='<button class="btn" style="width:100%;margin-top:16px;padding:12px" onclick="closeModal()">Close</button>';
  openModal(html);
}

// ── PDF — MAP OVERVIEW ────────────────────────────────────────────────────────
function exportPDF(){
  if(typeof jspdf==='undefined'){toast('PDF loading, try again');return;}
  var map=db.maps.find(function(m){return m.id===state.mapId;});
  var us=db.units.filter(function(u){return u.mapId===state.mapId;});
  if(state.sort==='status'){
    us.sort(function(a,b){
      var ao=STATUS_ORDER[a.status]!==undefined?STATUS_ORDER[a.status]:9;
      var bo=STATUS_ORDER[b.status]!==undefined?STATUS_ORDER[b.status]:9;
      return ao!==bo?ao-bo:(a.asap?+a.asap:9999)-(b.asap?+b.asap:9999);
    });
  } else {
    us.sort(function(a,b){return (a.asap?+a.asap:9999)-(b.asap?+b.asap:9999);});
  }
  if(!us.length){toast('No units to export');return;}
  toast('Generating PDF…');
  var doc=new jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  var date=new Date().toLocaleDateString('en-CA');
  var fails=us.filter(function(u){return u.status==='Fail';}).length;
  var patches=us.reduce(function(a,u){return a+(u.patches||0);},0);
  var veg=us.filter(function(u){return u.status==='Vegetation';}).length;
  doc.setFontSize(20);doc.setFont(undefined,'bold');doc.text(map.name,14,20);
  doc.setFontSize(10);doc.setFont(undefined,'normal');doc.setTextColor(100);
  doc.text(map.location+'  ·  '+map.type+'  ·  '+date,14,27);
  if(map.notes){doc.setFontSize(9);doc.text('Notes: '+map.notes,14,33);doc.setFontSize(10);}
  doc.setTextColor(0);
  var summaryY=map.notes?39:34;
  doc.text('Total: '+us.length+'   Fails: '+fails+'   Patches: '+patches+'   Veg: '+veg,14,summaryY);
  doc.autoTable({
    startY:summaryY+6,
    head:[['EPCOR #','ASAP #','Type','Status','Fail type','Patches','Notes']],
    body:us.map(function(u){return [u.epcor||'',u.asap||'',u.unitType||'',u.status,u.failType||'—',u.patches||0,u.notes||''];}),
    styles:{fontSize:9,cellPadding:3,overflow:'linebreak'},
    headStyles:{fillColor:[21,128,61],textColor:255,fontStyle:'bold',fontSize:9},
    alternateRowStyles:{fillColor:[240,253,244]},
    columnStyles:{0:{fontStyle:'bold',cellWidth:26},1:{cellWidth:16,halign:'center'},2:{cellWidth:20},3:{cellWidth:18},4:{cellWidth:30},5:{cellWidth:14,halign:'center'},6:{cellWidth:'auto'}},
    didParseCell:function(d){
      if(d.section==='body'&&d.column.index===3){
        var s=d.cell.raw;
        if(s==='Fail')d.cell.styles.textColor=[180,30,30];
        else if(s==='Vegetation')d.cell.styles.textColor=[21,128,61];
        else if(s==='No Access')d.cell.styles.textColor=[100,100,100];
      }
    },
    margin:{left:14,right:14}
  });
  // Photos section
  var unitsWithPhotos=us.filter(function(u){return u.beforePhoto||u.afterPhoto;});
  if(unitsWithPhotos.length){
    doc.addPage();
    doc.setFontSize(14);doc.setFont(undefined,'bold');
    doc.text('Photos',14,20);
    var py=28;
    var pw=doc.internal.pageSize.getWidth();
    var imgW=(pw-14-14-6)/2;
    var imgH=imgW*0.65;
    unitsWithPhotos.forEach(function(u){
      if(py+imgH+14>doc.internal.pageSize.getHeight()-14){doc.addPage();py=20;}
      doc.setFontSize(10);doc.setFont(undefined,'bold');
      doc.text(u.epcor+(u.asap?' · ASAP #'+u.asap:''),14,py);
      doc.setFont(undefined,'normal');py+=5;
      if(u.beforePhoto){
        try{doc.addImage(u.beforePhoto,'JPEG',14,py,imgW,imgH);}catch(e){}
        doc.setFontSize(8);doc.setTextColor(100);doc.text('Before',14,py+imgH+3);doc.setTextColor(0);
      }
      if(u.afterPhoto){
        var ax=14+(u.beforePhoto?imgW+6:0);
        try{doc.addImage(u.afterPhoto,'JPEG',ax,py,imgW,imgH);}catch(e){}
        doc.setFontSize(8);doc.setTextColor(100);doc.text('After',ax,py+imgH+3);doc.setTextColor(0);
      }
      py+=imgH+10;
    });
  }
  doc.save(map.name.replace(/\s+/g,'_')+'_'+date+'.pdf');
  setTimeout(function(){toast('PDF saved!');},600);
}

// ── PDF — SINGLE UNIT ─────────────────────────────────────────────────────────
function exportUnitPDF(id){
  if(typeof jspdf==='undefined'){toast('PDF loading, try again');return;}
  var u=db.units.find(function(x){return x.id===id;});
  var map=db.maps.find(function(m){return m.id===u.mapId;});
  toast('Generating PDF…');
  var doc=new jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  var date=new Date().toLocaleDateString('en-CA');
  var pw=doc.internal.pageSize.getWidth();
  // Header
  doc.setFillColor(21,128,61);doc.rect(0,0,pw,28,'F');
  doc.setTextColor(255);doc.setFontSize(18);doc.setFont(undefined,'bold');
  doc.text(u.epcor,14,13);
  doc.setFontSize(9);doc.setFont(undefined,'normal');
  doc.text(map.name+'  ·  '+map.location+'  ·  '+date,14,21);
  doc.setTextColor(0);
  // Info
  var y=36;
  function row(label,value,color){
    doc.setFontSize(9);doc.setTextColor(120);doc.text(label,14,y);
    doc.setTextColor(color||0);doc.setFont(undefined,'bold');
    doc.text(String(value),60,y);doc.setFont(undefined,'normal');
    y+=7;
  }
  row('ASAP #',u.asap||'—');
  row('Unit type',u.unitType||'—');
  row('Status',u.status,u.status==='Fail'?[180,30,30]:0);
  if(u.status==='Fail'){
    row('Fail type',u.failType||'—');
    row('Patches',u.patches||0);
  }
  if(u.notes){
    y+=2;
    doc.setFontSize(9);doc.setTextColor(120);doc.text('Notes',14,y);y+=5;
    doc.setTextColor(0);doc.setFontSize(9);
    var lines=doc.splitTextToSize(u.notes,pw-28);
    doc.text(lines,14,y);y+=lines.length*5+4;
  }
  // Photos
  if(u.beforePhoto||u.afterPhoto){
    y+=4;
    doc.setFontSize(11);doc.setFont(undefined,'bold');doc.setTextColor(0);
    doc.text('Photos',14,y);y+=6;doc.setFont(undefined,'normal');
    var imgW=(pw-14-14-6)/2;var imgH=imgW*0.72;
    if(u.beforePhoto){
      try{doc.addImage(u.beforePhoto,'JPEG',14,y,imgW,imgH);}catch(e){}
      doc.setFontSize(8);doc.setTextColor(100);doc.text('Before',14,y+imgH+3);
    }
    if(u.afterPhoto){
      var ax=14+(u.beforePhoto?imgW+6:0);
      try{doc.addImage(u.afterPhoto,'JPEG',ax,y,imgW,imgH);}catch(e){}
      doc.setFontSize(8);doc.setTextColor(100);doc.text('After',ax,y+imgH+3);
    }
  }
  doc.save(u.epcor.replace(/\s+/g,'_')+'_'+date+'.pdf');
  setTimeout(function(){toast('PDF saved!');},600);
}

// ── BACKUP ────────────────────────────────────────────────────────────────────
function exportBackup(){
  var blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');a.href=url;
  a.download='utilitylog_'+new Date().toLocaleDateString('en-CA')+'.json';
  a.click();URL.revokeObjectURL(url);toast('Backup exported!');
}
function importBackup(e){
  var file=e.target.files[0];if(!file)return;
  var r=new FileReader();
  r.onload=function(ev){
    try{
      var p=JSON.parse(ev.target.result);
      if(p.maps&&p.units){
        if(!confirm('Replace all current data with this backup?'))return;
        if(!p.trash)p.trash=[];db=p;idbSave();showMaps();toast('Backup imported!');
      }else toast('Invalid backup file');
    }catch(err){toast('Could not read file');}
  };r.readAsText(file);e.target.value='';
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function openModal(html){
  $('modalBox').innerHTML='<div class="modal-handle"></div>'+html;
  $('overlay').classList.add('open');
}
function closeModal(){$('overlay').classList.remove('open');patchCount=0;}
function closeModalOutside(e){if(e.target===$('overlay'))closeModal();}

// ── SERVICE WORKER ────────────────────────────────────────────────────────────
if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(function(){});}

// ── PDF LIBS ──────────────────────────────────────────────────────────────────
['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.6.0/jspdf.plugin.autotable.min.js'
].forEach(function(src){var s=document.createElement('script');s.src=src;document.head.appendChild(s);});

// ── INIT ──────────────────────────────────────────────────────────────────────
openIDB(function(){idbGet(function(){if(!restoreFormIfNeeded())showMaps();});});
