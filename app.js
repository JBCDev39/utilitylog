// ── CONSTANTS ─────────────────────────────────────────────────────────────────
var FAIL_TYPES=['Rust Holes (Door)','Rust Holes (Unit & Door)','Oil Leak','Structural Damage'];
var STATUS_ORDER={Fail:0,Vegetation:1,'No Access':2,Clean:3};
var FORM_KEY='ulf_form';

// ── STATE ─────────────────────────────────────────────────────────────────────
var DB_NAME='utilityInspect',DB_VER=1,STORE='data';
var idb=null;
var db={maps:[],units:[],trash:[]};
var state={screen:'maps',mapId:null,unitId:null,filter:'All',sort:'asap'};
var patchCount=0;
var formState={mode:'new',unitId:null,pendingPhotoKey:null};
var formPhotos={before:null,after:null};
var newMapPhoto=null;
var fabOpen=false;

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
    if(e.target.result){
      db=e.target.result;
      if(!db.trash)db.trash=[];
    }
    cb();
  };
  req.onerror=function(){cb();};
}
function idbSave(){
  if(!idb)return;
  idb.transaction(STORE,'readwrite').objectStore(STORE).put(db,'db');
}

// ── FORM PERSISTENCE (Android camera fix) ─────────────────────────────────────
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
function statusBadge(s,incomplete){
  var m={Fail:'b-fail',Vegetation:'b-veg','No Access':'b-na',Clean:'b-clean'};
  var cls=m[s]||'b-clean';
  var html='<span class="badge '+cls+'">'+esc(s)+'</span>';
  if(incomplete) html+=' <span class="badge b-incomplete">Quick Add</span>';
  return html;
}
function typeBadge(t){
  return t==='Pedestal'?'<span class="badge b-ped">Pedestal</span>':'<span class="badge b-trans">Transformer</span>';
}
function daysLeft(d){return Math.max(0,30-Math.floor((Date.now()-d)/(864e5)));}

// ── FAB ───────────────────────────────────────────────────────────────────────
function showFabMenu(){
  $('fabRoot').style.display='flex';
  $('fabSingle').style.display='none';
}
function showFabSingle(){
  $('fabRoot').style.display='none';
  $('fabSingle').style.display='flex';
}
function hideFab(){
  $('fabRoot').style.display='none';
  $('fabSingle').style.display='none';
  closeFabMenu();
}
function toggleFabMenu(){
  fabOpen=!fabOpen;
  $('fabMenu').classList.toggle('open',fabOpen);
  $('fabMain').classList.toggle('open',fabOpen);
  $('fabBackdrop').classList.toggle('open',fabOpen);
}
function closeFabMenu(){
  fabOpen=false;
  $('fabMenu').classList.remove('open');
  $('fabMain').classList.remove('open');
  $('fabBackdrop').classList.remove('open');
}

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

// ── PHOTO FILE NAMING ─────────────────────────────────────────────────────────
function photoFileName(epcor,status,slot){
  var e=(epcor||'UNIT').replace(/\s+/g,'_').toUpperCase();
  var s=status==='Fail'?'FAIL':status==='Vegetation'?'VEG':status==='No Access'?'NO_ACCESS':'CLEAN';
  if(slot==='before') return e+'_'+s+'_BEFORE';
  if(slot==='after'){
    if(status==='Fail') return e+'_FAIL_PATCHED';
    if(status==='Vegetation') return e+'_VEG_CLEARED';
    return e+'_'+s+'_AFTER';
  }
  return e+'_'+s;
}

function downloadPhoto(dataUrl,filename){
  var a=document.createElement('a');
  a.href=dataUrl;
  a.download=filename+'.jpg';
  a.click();
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────
function setScreen(name,dir){
  document.querySelectorAll('.screen').forEach(function(s){
    s.classList.remove('active','anim-in','anim-back','anim-fade');
  });
  var el=$('screen'+name.charAt(0).toUpperCase()+name.slice(1));
  el.classList.add('active');
  el.classList.add(dir==='back'?'anim-back':dir==='fade'?'anim-fade':'anim-in');
  state.screen=name;
  $('mainContent').scrollTop=0;
}
function goBack(){
  if(state.screen==='unit') showUnits(state.mapId,'back');
  else showMaps('back');
}

// ── GLOBAL STATS ──────────────────────────────────────────────────────────────
function calcGlobalStats(){
  var allUnits=db.units;
  var totalMaps=db.maps.length;
  var totalUnits=allUnits.length;
  var totalFails=allUnits.filter(function(u){return u.status==='Fail';}).length;
  var totalPatches=allUnits.reduce(function(a,u){return a+(u.patches||0);},0);
  var totalVeg=allUnits.filter(function(u){return u.status==='Vegetation';}).length;
  var activeMaps=db.maps.filter(function(m){return m.status!=='Completed';}).length;
  return {totalMaps:totalMaps,totalUnits:totalUnits,totalFails:totalFails,totalPatches:totalPatches,totalVeg:totalVeg,activeMaps:activeMaps};
}

// ── MAPS ──────────────────────────────────────────────────────────────────────
function showMaps(dir){
  state.mapId=null;state.unitId=null;
  $('topTitle').textContent='UtilityLog';
  $('backWrap').style.display='none';
  $('controlsRow').classList.remove('visible');
  purgeExpiredTrash();
  var trashCount=db.trash.length;
  $('topActs').innerHTML=
    '<button class="btn btn-sm" onclick="showTrash()" style="display:flex;align-items:center;gap:5px">'
    +iconSVG('trash',14)+(trashCount?'<span class="trash-badge">'+trashCount+'</span>':'')+'</button>';
  showFabSingle();
  renderMaps();setScreen('maps',dir||'fade');
}

function renderMaps(){
  var c=$('screenMaps');
  var g=calcGlobalStats();

  // Global stats banner
  var banner='<div class="stats-banner card-anim">'
    +'<div class="stats-banner-title">Season overview</div>'
    +'<div class="stats-row">'
    +'<div class="stat-cell"><div class="stat-cell-num">'+g.totalMaps+'</div><div class="stat-cell-lbl">Maps</div></div>'
    +'<div class="stat-cell"><div class="stat-cell-num">'+g.totalUnits+'</div><div class="stat-cell-lbl">Units</div></div>'
    +'<div class="stat-cell"><div class="stat-cell-num'+(g.totalFails?' red':'')+'">'+g.totalFails+'</div><div class="stat-cell-lbl">Fails</div></div>'
    +'<div class="stat-cell"><div class="stat-cell-num">'+g.totalPatches+'</div><div class="stat-cell-lbl">Patches</div></div>'
    +'</div>'
    +(g.totalVeg?'<div class="stats-divider"></div><div style="font-size:12px;color:var(--text2)">'+g.totalVeg+' vegetation · '+g.activeMaps+' active map'+(g.activeMaps!==1?'s':'')+'</div>':'')
    +'</div>';

  if(!db.maps.length){
    c.innerHTML=banner
      +'<div class="empty-state"><div class="empty-ico">'+iconSVG('map',40)+'</div>'
      +'<div class="empty-title">No maps yet</div>'
      +'<div class="empty-sub">Tap + to create your first map</div></div>'
      +dataSection();
    return;
  }

  var mapsHtml=db.maps.map(function(m,i){
    var us=db.units.filter(function(u){return u.mapId===m.id;});
    var fails=us.filter(function(u){return u.status==='Fail';}).length;
    var vegs=us.filter(function(u){return u.status==='Vegetation';}).length;
    var patches=us.reduce(function(a,u){return a+(u.patches||0);},0);
    var date=m.createdAt?new Date(m.createdAt).toLocaleDateString('en-CA'):'';
    var isComplete=m.status==='Completed';
    var thumbHtml=m.photo
      ?'<img class="map-thumb" src="'+m.photo+'" onclick="viewMapPhoto(\''+m.id+'\')" alt="Map">'
      :'<div class="map-thumb-ph" onclick="addMapPhoto(\''+m.id+'\')">'+iconSVG('map',22)+'</div>';
    return '<div class="card card-anim" style="animation-delay:'+(i*0.04)+'s'+(isComplete?';opacity:0.7':'')+';">'
      +'<div class="card-row" onclick="showUnits(\''+m.id+'\')" style="cursor:pointer">'
      +'<div style="flex:1;min-width:0">'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
      +'<div class="card-title">'+esc(m.name)+'</div>'
      +'<div class="map-status-pill '+(isComplete?'completed':'active')+'" onclick="toggleMapStatus(event,\''+m.id+'\')">'
      +'<div class="pill-dot"></div>'+(isComplete?'Completed':'Active')+'</div>'
      +'</div>'
      +'<div class="card-sub">'+esc(m.location)+(date?' · '+date:'')+'</div>'
      +(m.notes?'<div style="font-size:12px;color:var(--text3);margin-top:3px;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(m.notes)+'</div>':'')
      +'<div class="card-meta">'
      +'<span>'+us.length+' unit'+(us.length!==1?'s':'')+'</span>'
      +(fails?'<span class="red">'+fails+' fail'+(fails>1?'s':'')+'</span>':'')
      +(vegs?'<span class="grn">'+vegs+' veg</span>':'')
      +(patches?'<span>'+patches+' patch'+(patches>1?'es':'')+'</span>':'')
      +'</div></div>'+thumbHtml+'</div>'
      +'<div class="map-acts">'
      +'<button class="btn btn-sm" onclick="showUnits(\''+m.id+'\')">Open</button>'
      +'<button class="btn btn-sm" onclick="addMapPhoto(\''+m.id+'\')">Photo</button>'
      +'<button class="btn btn-sm" onclick="editMapNotes(\''+m.id+'\')">Notes</button>'
      +'<button class="btn btn-sm" onclick="softDeleteMap(\''+m.id+'\',\''+esc(m.name)+'\')">Delete</button>'
      +'</div></div>';
  }).join('');

  c.innerHTML=banner+mapsHtml+dataSection();
}

function toggleMapStatus(e,mapId){
  e.stopPropagation();
  var m=db.maps.find(function(x){return x.id===mapId;});
  m.status=m.status==='Completed'?'Active':'Completed';
  idbSave();renderMaps();
  toast('Map marked as '+(m.status==='Completed'?'Completed':'Active'));
}

function dataSection(){
  return '<div class="section-lbl" style="margin-top:4px">Data</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;padding-bottom:8px">'
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
    +'<img class="modal-photo-full" src="'+m.photo+'" alt="Map">'
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
    +'<textarea id="mNotesVal" rows="4" placeholder="Gate code, contact, access info…">'+esc(m.notes||'')+'</textarea></div>'
    +'<button class="btn btn-primary" style="width:100%;padding:13px" onclick="saveMapNotes(\''+mapId+'\')">Save</button>');
  setTimeout(function(){var el=$('mNotesVal');if(el)el.focus();},150);
}
function saveMapNotes(mapId){
  var m=db.maps.find(function(x){return x.id===mapId;});
  m.notes=val('mNotesVal').trim();idbSave();closeModal();renderMaps();toast('Notes saved');
}

// ── TRASH ─────────────────────────────────────────────────────────────────────
function softDeleteMap(mapId,mapName){
  if(!confirm('Move "'+mapName+'" to trash? Kept for 30 days.'))return;
  var map=db.maps.find(function(m){return m.id===mapId;});
  var units=db.units.filter(function(u){return u.mapId===mapId;});
  db.trash.push({map:map,units:units,deletedAt:Date.now()});
  db.maps=db.maps.filter(function(m){return m.id!==mapId;});
  db.units=db.units.filter(function(u){return u.mapId!==mapId;});
  idbSave();showMaps();toast('Moved to trash');
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
    c.innerHTML='<div class="empty-state"><div class="empty-ico">'+iconSVG('trash',40)+'</div>'
      +'<div class="empty-title">Trash is empty</div>'
      +'<div class="empty-sub">Deleted maps appear here for 30 days</div></div>';
    return;
  }
  c.innerHTML=db.trash.map(function(t,i){
    var days=daysLeft(t.deletedAt);
    return '<div class="card card-anim" style="animation-delay:'+(i*0.04)+'s">'
      +'<div class="card-row"><div>'
      +'<div class="card-title">'+esc(t.map.name)+'</div>'
      +'<div class="card-sub">'+esc(t.map.location)+'</div>'
      +'<div style="font-size:12px;color:var(--warn);margin-top:4px">'+days+' day'+(days!==1?'s':'')+' left</div>'
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
  showFabMenu();renderUnits();setScreen('units',dir||'forward');
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
    c.innerHTML='<div class="empty-state"><div class="empty-ico">'+iconSVG('unit',40)+'</div>'
      +'<div class="empty-title">'+(q?'No results':'No units yet')+'</div>'
      +'<div class="empty-sub">'+(q||state.filter!=='All'?'Try a different search or filter':'Tap + to add a unit')+'</div></div>';
    return;
  }
  c.innerHTML=us.map(function(u,i){
    var photos=(u.beforePhoto?1:0)+(u.afterPhoto?1:0);
    return '<div class="card card-tap card-anim" style="animation-delay:'+(i*0.03)+'s" onclick="showUnit(\''+u.id+'\')">'
      +'<div class="card-row">'
      +'<span class="card-title" style="font-family:monospace;font-size:14px">'+esc(u.epcor)+'</span>'
      +statusBadge(u.status,u.incomplete)
      +'</div>'
      +'<div class="card-meta" style="margin-top:6px">'
      +(u.asap?'<span>ASAP #'+esc(u.asap)+'</span>':'')
      +(u.failType?'<span>'+esc(u.failType)+'</span>':'')
      +(u.patches?'<span>'+u.patches+' patch'+(u.patches>1?'es':'')+'</span>':'')
      +(photos?'<span class="grn">'+photos+' photo'+(photos>1?'s':'')+'</span>':'')
      +(u.lat?'<span>GPS</span>':'')
      +'</div></div>';
  }).join('');
}

// ── UNIT DETAIL ───────────────────────────────────────────────────────────────
function showUnit(id){
  state.unitId=id;
  var u=db.units.find(function(x){return x.id===id;});
  $('topTitle').textContent=u.epcor;
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
    +'<div class="card-row" style="margin-bottom:10px">'
    +'<div style="font-size:22px;font-weight:700;letter-spacing:-0.5px;font-family:monospace">'+esc(u.epcor)+'</div>'
    +statusBadge(u.status,u.incomplete)+'</div>'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap">'
    +typeBadge(u.unitType||'Pedestal')
    +(u.asap?'<span style="font-size:12px;color:var(--text2);align-self:center">ASAP #'+esc(u.asap)+'</span>':'')
    +(u.fins?'<span class="badge" style="background:rgba(96,165,250,0.1);color:#60a5fa">Fins</span>':'')
    +'</div></div>';

  if(isFail){
    html+='<div class="section-lbl">Fail details</div>'
      +'<div class="row-detail"><span class="row-detail-label">Type</span>'
      +'<span class="row-detail-value">'+(u.failType?esc(u.failType):'—')+'</span></div>'
      +'<div class="row-detail"><span class="row-detail-label">Patches</span>'
      +'<span class="row-detail-value" style="color:var(--grn-text);font-size:18px;font-weight:700">'+(u.patches||0)+'</span></div>';
  }
  if(u.status==='Vegetation') html+='<div style="padding:10px 0;font-size:14px;color:var(--text2)">Vegetation noted.</div>';
  if(u.status==='No Access') html+='<div style="padding:10px 0;font-size:14px;color:var(--text2)">Unit not accessible.</div>';

  if(u.lat){
    html+='<div class="section-lbl">Location</div>'
      +'<div class="gps-stamp">'
      +iconSVG('gps',14)
      +'<span class="gps-coords">'+u.lat.toFixed(6)+', '+u.lng.toFixed(6)+'</span>'
      +'<a class="gps-link" href="https://www.google.com/maps?q='+u.lat+','+u.lng+'" target="_blank">View on Maps</a>'
      +'</div>';
  }

  html+='<div class="section-lbl">Photos</div><div class="photo-grid">'
    +detailPhotoSlot(u,'before','Before')
    +detailPhotoSlot(u,'after','After')+'</div>';

  if(u.notes) html+='<div class="section-lbl">Notes</div>'
    +'<div style="font-size:14px;line-height:1.65;color:var(--text2)">'+esc(u.notes)+'</div>';

  html+='<div style="margin-top:24px;padding-bottom:20px">'
    +'<button class="btn btn-danger" style="width:100%" onclick="deleteUnit(\''+u.id+'\')">Delete unit</button></div>';
  $('screenUnit').innerHTML=html;
}

function detailPhotoSlot(u,key,label){
  var p=u[key+'Photo'];
  if(p) return '<div class="photo-slot" onclick="viewDetailPhoto(\''+u.id+'\',\''+key+'\')">'
    +'<img src="'+p+'" alt="'+label+'">'
    +'<span style="position:absolute;bottom:6px;left:8px;background:rgba(0,0,0,0.6);color:#fff;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:600;z-index:1;letter-spacing:0.04em">'+label.toUpperCase()+'</span></div>';
  return '<div class="photo-slot" onclick="detailPickPhoto(\''+u.id+'\',\''+key+'\')">'
    +iconSVG('camera',20)
    +'<span class="p-lbl">'+label+'</span></div>';
}

function detailPickPhoto(unitId,key){
  openModal('<p class="modal-title">Add photo</p>'
    +'<div style="display:flex;flex-direction:column;gap:10px;padding-bottom:6px">'
    +'<button class="btn" style="width:100%;padding:14px;font-size:15px;gap:10px" onclick="detailLaunch(\''+unitId+'\',\''+key+'\',true)">'+iconSVG('camera',18)+' Take photo</button>'
    +'<button class="btn" style="width:100%;padding:14px;font-size:15px;gap:10px" onclick="detailLaunch(\''+unitId+'\',\''+key+'\',false)">'+iconSVG('gallery',18)+' Choose from gallery</button>'
    +'<button class="btn" style="width:100%;padding:12px" onclick="closeModal()">Cancel</button>'
    +'</div>');
}
function detailLaunch(unitId,key,cam){
  closeModal();
  var u=db.units.find(function(x){return x.id===unitId;});
  var inp=document.createElement('input');
  inp.type='file';inp.accept='image/*';if(cam)inp.capture='environment';
  inp.onchange=function(){
    var file=inp.files[0];if(!file)return;
    var r=new FileReader();
    r.onload=function(e){
      compressImage(e.target.result,1600,0.85,function(comp){
        u[key+'Photo']=comp;
        idbSave();
        showAnnotationModal(comp,unitId,key);
      });
    };r.readAsDataURL(file);
  };inp.click();
}
function viewDetailPhoto(unitId,key){
  var u=db.units.find(function(x){return x.id===unitId;});
  var fname=photoFileName(u.epcor,u.status,key);
  openModal('<p class="modal-title">'+(key==='before'?'Before':'After')+'</p>'
    +'<img src="'+u[key+'Photo']+'" style="width:100%;border-radius:var(--radius);margin-bottom:14px">'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap">'
    +'<button class="btn" style="flex:1" onclick="downloadPhoto(db.units.find(function(x){return x.id===\''+unitId+'\';})[\''+key+'Photo\'],\''+fname+'\');toast(\'Saved as '+fname+'.jpg\')">Save to device</button>'
    +'<button class="btn" style="flex:1" onclick="showAnnotationModal(db.units.find(function(x){return x.id===\''+unitId+'\';})[\''+key+'Photo\'],\''+unitId+'\',\''+key+'\')">Annotate</button>'
    +'<button class="btn btn-danger" style="flex:1" onclick="removeDetailPhoto(\''+unitId+'\',\''+key+'\')">Remove</button>'
    +'</div>');
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

// ── PHOTO ANNOTATION ──────────────────────────────────────────────────────────
var annotationState={unitId:null,key:null,textX:20,textY:20,dragging:false,startX:0,startY:0};

function showAnnotationModal(dataUrl,unitId,key){
  closeModal();
  var u=db.units.find(function(x){return x.id===unitId;});
  var defaultText=u?u.epcor:'';
  annotationState={unitId:unitId,key:key,textX:20,textY:20,dragging:false};

  openModal('<p class="modal-title">Annotate photo</p>'
    +'<div class="form-group"><label class="form-label">Annotation text</label>'
    +'<input id="annText" value="'+esc(defaultText)+'" placeholder="e.g. PED15828" oninput="renderAnnotationPreview()"/></div>'
    +'<div class="annotation-wrap" id="annWrap">'
    +'<canvas id="annCanvas"></canvas>'
    +'<div class="ann-text-overlay selected" id="annLabel" style="left:20px;top:20px">'+esc(defaultText)+'</div>'
    +'</div>'
    +'<p style="font-size:11px;color:var(--text3);margin-top:8px;text-align:center">Drag the label to reposition it</p>'
    +'<div style="display:flex;gap:8px;margin-top:14px">'
    +'<button class="btn" style="flex:1" onclick="closeModal()">Cancel</button>'
    +'<button class="btn btn-primary" style="flex:1" onclick="applyAnnotation(\''+unitId+'\',\''+key+'\')">Save annotation</button>'
    +'</div>');

  setTimeout(function(){
    var canvas=$('annCanvas');
    var wrap=$('annWrap');
    var img=new Image();
    img.onload=function(){
      var maxW=wrap.clientWidth;
      var ratio=img.height/img.width;
      canvas.width=img.width;
      canvas.height=img.height;
      canvas.style.width=maxW+'px';
      canvas.style.height=(maxW*ratio)+'px';
      wrap.style.height=(maxW*ratio)+'px';
      canvas.getContext('2d').drawImage(img,0,0);
    };
    img.src=dataUrl;
    setupAnnotationDrag();
    $('annText').focus();
  },100);
}

function renderAnnotationPreview(){
  var lbl=$('annLabel');
  if(lbl) lbl.textContent=$('annText')?$('annText').value:'';
}

function setupAnnotationDrag(){
  var lbl=$('annLabel');
  var wrap=$('annWrap');
  if(!lbl||!wrap)return;

  function getPos(e){
    var t=e.touches?e.touches[0]:e;
    return {x:t.clientX,y:t.clientY};
  }
  function onStart(e){
    e.preventDefault();
    var p=getPos(e);
    annotationState.dragging=true;
    annotationState.startX=p.x-annotationState.textX;
    annotationState.startY=p.y-annotationState.textY;
  }
  function onMove(e){
    if(!annotationState.dragging)return;
    e.preventDefault();
    var p=getPos(e);
    var wRect=wrap.getBoundingClientRect();
    annotationState.textX=Math.max(0,Math.min(p.x-annotationState.startX,wRect.width-80));
    annotationState.textY=Math.max(0,Math.min(p.y-annotationState.startY,wRect.height-30));
    lbl.style.left=annotationState.textX+'px';
    lbl.style.top=annotationState.textY+'px';
  }
  function onEnd(){annotationState.dragging=false;}
  lbl.addEventListener('mousedown',onStart);
  lbl.addEventListener('touchstart',onStart,{passive:false});
  document.addEventListener('mousemove',onMove);
  document.addEventListener('touchmove',onMove,{passive:false});
  document.addEventListener('mouseup',onEnd);
  document.addEventListener('touchend',onEnd);
}

function applyAnnotation(unitId,key){
  var canvas=$('annCanvas');
  var wrap=$('annWrap');
  var text=$('annText')?$('annText').value:'';
  if(!canvas||!text){closeModal();return;}

  var scaleX=canvas.width/wrap.clientWidth;
  var scaleY=canvas.height/wrap.clientHeight;
  var ctx=canvas.getContext('2d');

  var tx=annotationState.textX*scaleX;
  var ty=annotationState.textY*scaleY;
  var fontSize=Math.round(canvas.width*0.04);
  ctx.font='bold '+fontSize+'px -apple-system,sans-serif';
  var metrics=ctx.measureText(text);
  var pad=fontSize*0.4;
  var bw=metrics.width+pad*2;
  var bh=fontSize+pad*1.5;

  ctx.fillStyle='rgba(0,0,0,0.72)';
  roundRect(ctx,tx,ty,bw,bh,fontSize*0.25);
  ctx.fill();
  ctx.fillStyle='#ffffff';
  ctx.fillText(text,tx+pad,ty+fontSize+pad*0.4);

  var u=db.units.find(function(x){return x.id===unitId;});
  u[key+'Photo']=canvas.toDataURL('image/jpeg',0.9);
  idbSave();closeModal();
  renderUnitDetail(db.units.find(function(x){return x.id===state.unitId;}));
  toast('Annotation saved');
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

// ── GPS ───────────────────────────────────────────────────────────────────────
function stampGPS(unitId){
  if(!navigator.geolocation){toast('GPS not available');return;}
  toast('Getting location…');
  navigator.geolocation.getCurrentPosition(
    function(pos){
      var u=db.units.find(function(x){return x.id===unitId;});
      u.lat=pos.coords.latitude;u.lng=pos.coords.longitude;
      idbSave();renderUnitDetail(u);toast('Location stamped');
    },
    function(){toast('Could not get location');},
    {enableHighAccuracy:true,timeout:10000}
  );
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
  var isPed=unitType==='Pedestal';
  var isTrans=unitType==='Transformer';
  var finsVal=u&&u.fins?true:false;

  var html='<p class="modal-title">'+(u&&!saved?'Edit '+esc(u.epcor):'Add unit')+'</p>'
    +'<div class="form-group"><label class="form-label">EPCOR #</label>'
    +'<input id="uEpcor" value="'+(saved?esc(saved.epcor):(u?esc(u.epcor):''))+'" '
    +'placeholder="'+(isPed?'e.g. PED15828':'e.g. T1234')+'" autocomplete="off" autocorrect="off" spellcheck="false" '
    +'oninput="onEpcorInput()"/></div>'
    +'<div class="form-group"><label class="form-label">ASAP # (internal)</label>'
    +'<input id="uAsap" type="number" value="'+(saved?saved.asap:(u&&u.asap?u.asap:''))+'" placeholder="e.g. 33"/></div>'
    +'<div class="form-group"><label class="form-label">Unit type</label><div class="seg" id="uTypeSeg">'
    +['Pedestal','Transformer'].map(function(t){
      var active=saved?saved.unitType===t:(u?u.unitType===t:t==='Pedestal');
      return '<button'+(active?' class="active"':'')+' onclick="segSel(\'uTypeSeg\',this);onUnitTypeChange(this)">'+t+'</button>';
    }).join('')+'</div></div>'
    // Fins toggle — only for Transformer
    +'<div id="finsGroup" class="field-expand'+(isTrans?' shown':' hidden')+'" style="max-height:'+(isTrans?'80px':'0')+';margin-bottom:'+(isTrans?'16px':'0')+'px">'
    +'<div class="toggle-row"><div><div class="toggle-label">Fins</div><div class="toggle-sub">Does this transformer have fins?</div></div>'
    +'<label class="toggle-switch"><input type="checkbox" id="uFins"'+(finsVal?' checked':'')+'/><div class="toggle-track"></div></label>'
    +'</div></div>'
    +'<div class="form-group"><label class="form-label">Status</label><div class="seg" id="uStatSeg">'
    +['Clean','Fail','Vegetation','No Access'].map(function(s){
      return '<button'+(s===status?' class="active"':'')+' onclick="segSel(\'uStatSeg\',this);chkFail()">'+s+'</button>';
    }).join('')+'</div></div>'
    +'<div id="failFields" class="field-expand'+(isFail?' shown':' hidden')+'" style="max-height:'+(isFail?'250px':'0')+'">'
    +'<div class="form-group"><label class="form-label">Fail type</label><select id="uFailType">'
    +FAIL_TYPES.map(function(f){
      var sel=saved?saved.failType===f:(u&&u.failType===f);
      return '<option'+(sel?' selected':'')+'>'+f+'</option>';
    }).join('')+'</select></div>'
    +'<div class="form-group"><label class="form-label">Patches</label>'
    +'<div class="patch-ctrl"><button class="patch-btn" onclick="adjP(-1)">−</button>'
    +'<span class="patch-val" id="pNum">'+(saved?saved.patches:(u?u.patches||0:0))+'</span>'
    +'<button class="patch-btn" onclick="adjP(1)">+</button></div></div></div>'
    // GPS stamp
    +'<div class="form-group"><label class="form-label">GPS location</label>'
    +'<button class="btn" style="width:100%;gap:8px" onclick="stampGPSForm()">'
    +iconSVG('gps',14)+' <span id="gpsFormLabel">'+(u&&u.lat?'Lat '+u.lat.toFixed(5)+' · Lon '+u.lng.toFixed(5):'Stamp current location')+'</span></button></div>'
    // Photos — blocked until EPCOR # entered
    +'<div class="form-group"><label class="form-label">Before photo</label>'
    +'<div class="photo-form-wrap'+(val('uEpcor')||u?'':' blocked')+'" id="formPhoto_before">'+formPhotoSlotInner('before')+'</div>'
    +'<p class="form-hint" id="photoHint" style="display:'+(val('uEpcor')||u?'none':'block')+'">Enter EPCOR # first to enable photos</p></div>'
    +'<div class="form-group"><label class="form-label">After photo</label>'
    +'<div class="photo-form-wrap'+(val('uEpcor')||u?'':' blocked')+'" id="formPhoto_after">'+formPhotoSlotInner('after')+'</div></div>'
    +'<div class="form-group"><label class="form-label">Notes</label>'
    +'<textarea id="uNotes" rows="2" placeholder="Optional notes…">'+(saved?esc(saved.notes||''):(u?esc(u.notes||''):''))+'</textarea></div>'
    +'<button class="btn btn-primary" style="width:100%;padding:14px;font-size:15px;margin-top:4px" onclick="submitUnitForm()">'
    +(formState.mode==='edit'?'Save changes':'Add unit')+'</button>';

  openModal(html);
  if(saved)patchCount=saved.patches||0;

  // Store GPS in form state
  if(u&&u.lat) formGPS={lat:u.lat,lng:u.lng};
  else formGPS=null;
}

var formGPS=null;
function stampGPSForm(){
  if(!navigator.geolocation){toast('GPS not available');return;}
  toast('Getting location…');
  navigator.geolocation.getCurrentPosition(
    function(pos){
      formGPS={lat:pos.coords.latitude,lng:pos.coords.longitude};
      var lbl=$('gpsFormLabel');
      if(lbl) lbl.textContent='Lat '+formGPS.lat.toFixed(5)+' · Lon '+formGPS.lng.toFixed(5);
      toast('Location stamped');
    },
    function(){toast('Could not get location');},
    {enableHighAccuracy:true,timeout:10000}
  );
}

function onUnitTypeChange(btn){
  var isPed=btn.textContent==='Pedestal';
  var isTrans=btn.textContent==='Transformer';
  var el=$('uEpcor');
  if(el) el.placeholder=isPed?'e.g. PED15828':'e.g. T1234';
  var fg=$('finsGroup');
  if(fg){
    fg.style.maxHeight=isTrans?'80px':'0';
    fg.style.marginBottom=isTrans?'16px':'0';
    fg.classList.toggle('shown',isTrans);
    fg.classList.toggle('hidden',!isTrans);
  }
}

function onEpcorInput(){
  var hasVal=val('uEpcor').trim().length>0;
  ['before','after'].forEach(function(key){
    var wrap=$('formPhoto_'+key);
    if(wrap) wrap.classList.toggle('blocked',!hasVal);
  });
  var hint=$('photoHint');
  if(hint) hint.style.display=hasVal?'none':'block';
}

function adjP(d){patchCount=Math.max(0,patchCount+d);$('pNum').textContent=patchCount;}
function chkFail(){
  var s=activeInSeg('uStatSeg');var isFail=s==='Fail';
  var el=$('failFields');
  if(el){el.style.maxHeight=isFail?'250px':'0';el.classList.toggle('shown',isFail);el.classList.toggle('hidden',!isFail);}
}

function submitUnitForm(){
  var epcor=val('uEpcor').trim();if(!epcor){toast('EPCOR # is required');return;}
  var status=activeInSeg('uStatSeg');var isFail=status==='Fail';
  var finsEl=$('uFins');var fins=finsEl?finsEl.checked:false;
  if(formState.mode==='edit'){
    var u=db.units.find(function(x){return x.id===formState.unitId;});
    u.epcor=epcor;u.asap=val('uAsap').trim();
    u.unitType=activeInSeg('uTypeSeg');u.status=status;
    u.failType=isFail?val('uFailType'):'';u.patches=isFail?patchCount:0;
    u.notes=val('uNotes').trim();u.fins=fins;u.incomplete=false;
    if(formGPS){u.lat=formGPS.lat;u.lng=formGPS.lng;}
    if(formPhotos.before)u.beforePhoto=formPhotos.before;
    else if(formPhotos.before===null)delete u.beforePhoto;
    if(formPhotos.after)u.afterPhoto=formPhotos.after;
    else if(formPhotos.after===null)delete u.afterPhoto;
    idbSave();clearFormState();closeModal();
    $('topTitle').textContent=u.epcor;renderUnitDetail(u);toast('Saved');
  } else {
    var nu={id:uid(),mapId:state.mapId,epcor:epcor,asap:val('uAsap').trim(),
      unitType:activeInSeg('uTypeSeg'),status:status,
      failType:isFail?val('uFailType'):'',patches:isFail?patchCount:0,
      notes:val('uNotes').trim(),fins:fins,incomplete:false,createdAt:Date.now()};
    if(formGPS){nu.lat=formGPS.lat;nu.lng=formGPS.lng;}
    if(formPhotos.before)nu.beforePhoto=formPhotos.before;
    if(formPhotos.after)nu.afterPhoto=formPhotos.after;
    db.units.push(nu);idbSave();clearFormState();closeModal();
    patchCount=0;formPhotos={before:null,after:null};formGPS=null;
    renderUnits();toast('Unit added');
  }
}

// ── FORM PHOTOS ───────────────────────────────────────────────────────────────
function formPhotoSlotInner(key){
  var label=key==='before'?'Before':'After';
  if(formPhotos[key]){
    return '<img class="photo-form-preview" src="'+formPhotos[key]+'" alt="'+label+'">'
      +'<div class="photo-form-actions">'
      +'<button onclick="formLaunch(\''+key+'\',true)">'+iconSVG('camera',14)+' Retake</button>'
      +'<button onclick="formLaunch(\''+key+'\',false)">'+iconSVG('gallery',14)+' Gallery</button>'
      +'<button onclick="formRemovePhoto(\''+key+'\')">Remove</button>'
      +'</div>';
  }
  return '<div class="photo-form-empty" onclick="formLaunch(\''+key+'\',false)">'
    +iconSVG('camera',22)+'<span class="pfe-lbl">Tap to add</span></div>'
    +'<div class="photo-form-actions">'
    +'<button onclick="formLaunch(\''+key+'\',true)">'+iconSVG('camera',14)+' Camera</button>'
    +'<button onclick="formLaunch(\''+key+'\',false)">'+iconSVG('gallery',14)+' Gallery</button>'
    +'</div>';
}
function refreshFormPhotoSlot(key){var s=$('formPhoto_'+key);if(s)s.innerHTML=formPhotoSlotInner(key);}
function formRemovePhoto(key){formPhotos[key]=null;refreshFormPhotoSlot(key);saveFormState();}
function formLaunch(key,cam){
  var epcor=val('uEpcor').trim();
  if(!epcor){toast('Enter EPCOR # first');return;}
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

// ── QUICK ADD ─────────────────────────────────────────────────────────────────
var qaStatus=null;
function showQuickAddModal(){
  qaStatus=null;
  openModal('<p class="modal-title">Quick Add</p>'
    +'<div class="qa-wrap">'
    +'<div class="form-group"><label class="form-label">EPCOR #</label>'
    +'<input class="qa-epcor" id="qaEpcor" placeholder="e.g. PED15828" autocomplete="off" autocorrect="off" spellcheck="false" oninput="checkQASubmit()"/></div>'
    +'<div class="form-group"><label class="form-label">Status</label>'
    +'<div class="qa-status-grid">'
    +'<div class="qa-status-opt" id="qaClean" onclick="selQAStatus(\'Clean\',this)">Clean</div>'
    +'<div class="qa-status-opt" id="qaFail" onclick="selQAStatus(\'Fail\',this)">Fail</div>'
    +'<div class="qa-status-opt" id="qaVeg" onclick="selQAStatus(\'Vegetation\',this)">Vegetation</div>'
    +'<div class="qa-status-opt" id="qaNA" onclick="selQAStatus(\'No Access\',this)">No Access</div>'
    +'</div></div>'
    +'<button class="qa-submit" id="qaSubmitBtn" disabled onclick="submitQuickAdd()">Save unit</button>'
    +'<p style="font-size:11px;color:var(--text3);text-align:center;margin-top:10px">Missing details can be filled in later via Edit</p>'
    +'</div>');
  setTimeout(function(){var el=$('qaEpcor');if(el)el.focus();},150);
}
function selQAStatus(s,el){
  qaStatus=s;
  var cls={Clean:'sel-clean',Fail:'sel-fail',Vegetation:'sel-veg','No Access':'sel-na'};
  ['qaClean','qaFail','qaVeg','qaNA'].forEach(function(id){
    var btn=$(id);if(btn) btn.className='qa-status-opt';
  });
  el.classList.add(cls[s]||'');
  checkQASubmit();
}
function checkQASubmit(){
  var btn=$('qaSubmitBtn');
  if(btn) btn.disabled=!(val('qaEpcor').trim()&&qaStatus);
}
function submitQuickAdd(){
  var epcor=val('qaEpcor').trim();if(!epcor||!qaStatus)return;
  var nu={id:uid(),mapId:state.mapId,epcor:epcor,asap:'',
    unitType:'Pedestal',status:qaStatus,failType:'',patches:0,
    notes:'',incomplete:true,createdAt:Date.now()};
  db.units.push(nu);idbSave();closeModal();renderUnits();
  toast(epcor+' added — tap to complete');
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
    +'<textarea id="mNotes" rows="2" placeholder="Gate code, contact info…"></textarea></div>'
    +'<div class="form-group"><label class="form-label">Primary unit type</label>'
    +'<div class="seg" id="mTypeSeg">'
    +'<button class="active" onclick="segSel(\'mTypeSeg\',this)">Pedestal</button>'
    +'<button onclick="segSel(\'mTypeSeg\',this)">Transformer</button>'
    +'<button onclick="segSel(\'mTypeSeg\',this)">Mixed</button>'
    +'</div></div>'
    +'<div class="form-group"><label class="form-label">Map photo (optional)</label>'
    +'<div class="photo-form-wrap" id="newMapPhotoSlot">'
    +'<div class="photo-form-empty" onclick="pickNewMapPhoto(false)">'
    +iconSVG('camera',22)+'<span class="pfe-lbl">Tap to add</span></div>'
    +'<div class="photo-form-actions">'
    +'<button onclick="pickNewMapPhoto(true)">'+iconSVG('camera',14)+' Camera</button>'
    +'<button onclick="pickNewMapPhoto(false)">'+iconSVG('gallery',14)+' Gallery</button>'
    +'</div></div></div>'
    +'<button class="btn btn-primary" style="width:100%;padding:14px;font-size:15px" onclick="createMap()">Create map</button>');
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
          +'<button onclick="pickNewMapPhoto(true)">'+iconSVG('camera',14)+' Retake</button>'
          +'<button onclick="pickNewMapPhoto(false)">'+iconSVG('gallery',14)+' Gallery</button>'
          +'<button onclick="newMapPhoto=null;renderNewMapPhotoEmpty()">Remove</button>'
          +'</div>';
        toast('Photo added');
      });
    };r.readAsDataURL(file);
  };inp.click();
}
function renderNewMapPhotoEmpty(){
  var slot=$('newMapPhotoSlot');
  if(slot) slot.innerHTML='<div class="photo-form-empty" onclick="pickNewMapPhoto(false)">'
    +iconSVG('camera',22)+'<span class="pfe-lbl">Tap to add</span></div>'
    +'<div class="photo-form-actions">'
    +'<button onclick="pickNewMapPhoto(true)">'+iconSVG('camera',14)+' Camera</button>'
    +'<button onclick="pickNewMapPhoto(false)">'+iconSVG('gallery',14)+' Gallery</button>'
    +'</div>';
}
function createMap(){
  var name=val('mName').trim();if(!name)return;
  var m={id:uid(),name:name,location:val('mLoc').trim(),
    notes:val('mNotes').trim(),type:activeInSeg('mTypeSeg'),
    status:'Active',createdAt:Date.now()};
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
  var ru=us.filter(function(u){return u.failType==='Rust Holes (Unit & Door)';}).length;
  var oil=us.filter(function(u){return u.failType==='Oil Leak';}).length;
  var str=us.filter(function(u){return u.failType==='Structural Damage';}).length;
  function sm(n,l,red){return '<div class="sum-box"><div class="sum-num'+(red?' red':'')+'">'+n+'</div><div class="sum-lbl">'+l+'</div></div>';}
  var html='<p class="modal-title">'+esc(map.name)+'</p>'
    +'<div class="sum-grid">'
    +sm(us.length,'Total')+sm(fails,'Fails',fails>0)+sm(patches,'Patches')
    +sm(veg,'Veg')+sm(na,'No access')+sm(clean,'Clean')+'</div>';
  if(fails){
    html+='<div class="section-lbl">Fail breakdown</div>'
      +'<div style="font-size:14px;line-height:2.4">'
      +(rd?'Rust Holes (Door): <strong style="color:var(--grn-text)">'+rd+'</strong><br>':'')
      +(ru?'Rust Holes (Unit & Door): <strong style="color:var(--grn-text)">'+ru+'</strong><br>':'')
      +(oil?'Oil Leak: <strong style="color:var(--grn-text)">'+oil+'</strong><br>':'')
      +(str?'Structural Damage: <strong style="color:var(--fail)">'+str+'</strong><br>':'')
      +'</div>';
  }
  if(map.notes) html+='<div class="section-lbl">Map notes</div>'
    +'<div style="font-size:14px;color:var(--text2);line-height:1.6">'+esc(map.notes)+'</div>';
  html+='<button class="btn" style="width:100%;margin-top:18px;padding:13px" onclick="closeModal()">Close</button>';
  openModal(html);
}

// ── PDF — MAP ─────────────────────────────────────────────────────────────────
function exportPDF(){
  if(typeof jspdf==='undefined'){toast('PDF loading, try again');return;}
  var map=db.maps.find(function(m){return m.id===state.mapId;});
  var us=db.units.filter(function(u){return u.mapId===state.mapId;});
  if(state.sort==='status'){
    us.sort(function(a,b){var ao=STATUS_ORDER[a.status]!==undefined?STATUS_ORDER[a.status]:9;var bo=STATUS_ORDER[b.status]!==undefined?STATUS_ORDER[b.status]:9;return ao!==bo?ao-bo:(a.asap?+a.asap:9999)-(b.asap?+b.asap:9999);});
  } else {
    us.sort(function(a,b){return (a.asap?+a.asap:9999)-(b.asap?+b.asap:9999);});
  }
  if(!us.length){toast('No units to export');return;}
  toast('Generating PDF…');
  var doc=new jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  var date=new Date().toLocaleDateString('en-CA');
  var pw=doc.internal.pageSize.getWidth();
  var fails=us.filter(function(u){return u.status==='Fail';}).length;
  var patches=us.reduce(function(a,u){return a+(u.patches||0);},0);
  var veg=us.filter(function(u){return u.status==='Vegetation';}).length;
  doc.setFillColor(21,128,61);doc.rect(0,0,pw,32,'F');
  doc.setTextColor(255);doc.setFontSize(20);doc.setFont(undefined,'bold');doc.text(map.name,14,16);
  doc.setFontSize(9);doc.setFont(undefined,'normal');doc.text(map.location+'  ·  '+map.type+'  ·  '+date,14,24);
  doc.setTextColor(0);var y=40;
  if(map.notes){doc.setFontSize(9);doc.setTextColor(80);doc.text('Notes: '+map.notes,14,y);y+=6;doc.setTextColor(0);}
  doc.setFontSize(10);doc.text('Total: '+us.length+'   Fails: '+fails+'   Patches: '+patches+'   Veg: '+veg,14,y);y+=6;
  doc.autoTable({
    startY:y,
    head:[['EPCOR #','ASAP #','Type','Status','Fail type','Patches','Fins','Notes']],
    body:us.map(function(u){return [u.epcor||'',u.asap||'',u.unitType||'',u.status+(u.incomplete?' *':''),u.failType||'—',u.patches||0,u.fins?'Yes':'',u.notes||''];}),
    styles:{fontSize:8,cellPadding:2.5,overflow:'linebreak'},
    headStyles:{fillColor:[21,128,61],textColor:255,fontStyle:'bold',fontSize:8},
    alternateRowStyles:{fillColor:[240,253,244]},
    columnStyles:{0:{fontStyle:'bold',cellWidth:24},1:{cellWidth:14,halign:'center'},2:{cellWidth:20},3:{cellWidth:18},4:{cellWidth:28},5:{cellWidth:12,halign:'center'},6:{cellWidth:10,halign:'center'},7:{cellWidth:'auto'}},
    didParseCell:function(d){
      if(d.section==='body'&&d.column.index===3){
        var s=d.cell.raw;
        if(s.indexOf('Fail')>-1)d.cell.styles.textColor=[180,30,30];
        else if(s==='Vegetation')d.cell.styles.textColor=[21,128,61];
        else if(s==='No Access')d.cell.styles.textColor=[100,100,100];
      }
    },
    margin:{left:14,right:14}
  });
  var unitsWithPhotos=us.filter(function(u){return u.beforePhoto||u.afterPhoto;});
  if(unitsWithPhotos.length){
    doc.addPage();
    doc.setFontSize(14);doc.setFont(undefined,'bold');doc.setTextColor(0);
    doc.text('Photos',14,20);var py=28;
    var imgW=(pw-14-14-6)/2;var imgH=imgW*0.65;
    unitsWithPhotos.forEach(function(u){
      if(py+imgH+14>doc.internal.pageSize.getHeight()-14){doc.addPage();py=20;}
      doc.setFontSize(10);doc.setFont(undefined,'bold');doc.text(u.epcor+(u.asap?' · ASAP #'+u.asap:''),14,py);
      doc.setFont(undefined,'normal');py+=5;
      if(u.beforePhoto){try{doc.addImage(u.beforePhoto,'JPEG',14,py,imgW,imgH);}catch(e){}
        doc.setFontSize(8);doc.setTextColor(100);doc.text('Before',14,py+imgH+3);doc.setTextColor(0);}
      if(u.afterPhoto){var ax=14+(u.beforePhoto?imgW+6:0);try{doc.addImage(u.afterPhoto,'JPEG',ax,py,imgW,imgH);}catch(e){}
        doc.setFontSize(8);doc.setTextColor(100);doc.text('After',ax,py+imgH+3);doc.setTextColor(0);}
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
  doc.setFillColor(21,128,61);doc.rect(0,0,pw,30,'F');
  doc.setTextColor(255);doc.setFontSize(18);doc.setFont(undefined,'bold');
  doc.text(u.epcor,14,13);
  doc.setFontSize(9);doc.setFont(undefined,'normal');
  doc.text(map.name+'  ·  '+map.location+'  ·  '+date,14,22);
  doc.setTextColor(0);var y=38;
  function row(label,value,color){
    doc.setFontSize(9);doc.setTextColor(120);doc.text(label,14,y);
    if(color)doc.setTextColor(color[0],color[1],color[2]);else doc.setTextColor(0);
    doc.setFont(undefined,'bold');doc.text(String(value||'—'),70,y);
    doc.setFont(undefined,'normal');y+=7;
  }
  row('ASAP #',u.asap||'—');
  row('Unit type',u.unitType||'—');
  row('Status',u.status,u.status==='Fail'?[180,30,30]:null);
  if(u.fins) row('Fins','Yes');
  if(u.status==='Fail'){row('Fail type',u.failType||'—');row('Patches',u.patches||0);}
  if(u.lat) row('GPS',u.lat.toFixed(6)+', '+u.lng.toFixed(6));
  if(u.notes){y+=2;doc.setFontSize(9);doc.setTextColor(120);doc.text('Notes',14,y);y+=5;
    doc.setTextColor(0);var lines=doc.splitTextToSize(u.notes,pw-28);doc.text(lines,14,y);y+=lines.length*5+4;}
  if(u.beforePhoto||u.afterPhoto){
    y+=4;doc.setFontSize(11);doc.setFont(undefined,'bold');doc.text('Photos',14,y);y+=6;
    doc.setFont(undefined,'normal');var imgW=(pw-14-14-6)/2;var imgH=imgW*0.72;
    if(u.beforePhoto){try{doc.addImage(u.beforePhoto,'JPEG',14,y,imgW,imgH);}catch(e){}
      doc.setFontSize(8);doc.setTextColor(100);doc.text('Before',14,y+imgH+3);}
    if(u.afterPhoto){var ax=14+(u.beforePhoto?imgW+6:0);try{doc.addImage(u.afterPhoto,'JPEG',ax,y,imgW,imgH);}catch(e){}
      doc.setFontSize(8);doc.setTextColor(100);doc.text('After',ax,y+imgH+3);}
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
function closeModal(){$('overlay').classList.remove('open');patchCount=0;formGPS=null;}
function closeModalOutside(e){if(e.target===$('overlay'))closeModal();}

// ── SVG ICONS ─────────────────────────────────────────────────────────────────
function iconSVG(name,size){
  size=size||18;
  var icons={
    camera:'<svg width="'+size+'" height="'+size+'" viewBox="0 0 20 20" fill="none"><path d="M2 7a2 2 0 012-2h.5l1-2h5l1 2H17a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="11" r="3" stroke="currentColor" stroke-width="1.5"/></svg>',
    gallery:'<svg width="'+size+'" height="'+size+'" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M2 14l4-4 3 3 3-4 6 5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    trash:'<svg width="'+size+'" height="'+size+'" viewBox="0 0 20 20" fill="none"><path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    map:'<svg width="'+size+'" height="'+size+'" viewBox="0 0 20 20" fill="none"><path d="M2 5l6-2 4 2 6-2v12l-6 2-4-2-6 2V5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 3v12M12 5v12" stroke="currentColor" stroke-width="1.5"/></svg>',
    unit:'<svg width="'+size+'" height="'+size+'" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 10h6M10 7v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    gps:'<svg width="'+size+'" height="'+size+'" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    chevron:'<svg width="'+size+'" height="'+size+'" viewBox="0 0 20 20" fill="none"><path d="M8 5l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  return icons[name]||'';
}

// ── SERVICE WORKER ────────────────────────────────────────────────────────────
if('serviceWorker'in navigator){navigator.serviceWorker.register('sw.js').catch(function(){});}

// ── PDF LIBS ──────────────────────────────────────────────────────────────────
['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.6.0/jspdf.plugin.autotable.min.js'
].forEach(function(src){var s=document.createElement('script');s.src=src;document.head.appendChild(s);});

// ── INIT ──────────────────────────────────────────────────────────────────────
openIDB(function(){idbGet(function(){if(!restoreFormIfNeeded())showMaps();});});
