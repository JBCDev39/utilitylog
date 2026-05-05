// ── CONSTANTS ─────────────────────────────────────────────────────────────────
var FAIL_TYPES=['Rust Holes (Door)','Rust Holes (Unit)','Rust Holes (Unit & Door)','Oil Leak','Structural Damage'];
var STATUS_ORDER={Fail:0,Vegetation:1,'No Access':2,Clean:3};
var FORM_KEY='ulf_form';
var DRAFT_KEY='ulf_drafts'; // array of drafts per map

// ── STATE ─────────────────────────────────────────────────────────────────────
var DB_NAME='utilityInspect',DB_VER=1,STORE='data';
var idb=null;
var db={maps:[],units:[],trash:[]};
var state={screen:'maps',mapId:null,unitId:null,filter:'All',sort:'asap'};
var patchCount=0;
var formState={mode:'new',unitId:null,pendingPhotoKey:null,failTypeVal:'Rust Holes (Door)'};
var formPhotos={before:null,after:null};
var formGPS=null;
var newMapPhoto=null;
var fabOpen=false;
var qaStatus=null;
var dotMenuOpen=false;
var annState={unitId:null,key:null,textX:20,textY:20,fontSize:14,dragging:false,startX:0,startY:0};

// ── IDB ───────────────────────────────────────────────────────────────────────
function openIDB(cb){
  var req=indexedDB.open(DB_NAME,DB_VER);
  req.onupgradeneeded=function(e){if(!e.target.result.objectStoreNames.contains(STORE))e.target.result.createObjectStore(STORE);};
  req.onsuccess=function(e){idb=e.target.result;cb();};
  req.onerror=function(){cb();};
}
function idbGet(cb){
  if(!idb)return cb();
  var tx=idb.transaction(STORE,'readonly');
  var req=tx.objectStore(STORE).get('db');
  req.onsuccess=function(e){if(e.target.result){db=e.target.result;if(!db.trash)db.trash=[];}cb();};
  req.onerror=function(){cb();};
}
function idbSave(){if(!idb)return;idb.transaction(STORE,'readwrite').objectStore(STORE).put(db,'db');}

// ── FORM PERSISTENCE (camera fix) ────────────────────────────────────────────
function saveFormState(){
  try{
    sessionStorage.setItem(FORM_KEY,JSON.stringify({
      mode:formState.mode,unitId:formState.unitId,mapId:state.mapId,
      epcor:val('uEpcor'),asap:val('uAsap'),
      unitType:activeInSeg('uTypeSeg'),status:activeInSeg('uStatSeg'),
      failType:formState.failTypeVal||FAIL_TYPES[0],patches:patchCount,notes:val('uNotes'),
      photoKey:formState.pendingPhotoKey,beforePhoto:formPhotos.before,afterPhoto:formPhotos.after
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
    formState={mode:fs.mode,unitId:fs.unitId||null,pendingPhotoKey:null,failTypeVal:fs.failType||FAIL_TYPES[0]};
    var u=fs.mode==='edit'?db.units.find(function(x){return x.id===fs.unitId;}):null;
    openUnitForm(u,fs);
    setTimeout(function(){refreshFormPhotoSlot('before');refreshFormPhotoSlot('after');},80);
    return true;
  }catch(e){return false;}
}

// ── DRAFT (form abandoned without saving) ────────────────────────────────────
function getAllDrafts(){try{var r=sessionStorage.getItem(DRAFT_KEY);return r?JSON.parse(r):[];}catch(e){return [];}}
function getDraftsForMap(mapId){return getAllDrafts().filter(function(d){return d.mapId===mapId;});}
function saveDraft(){
  try{
    var epcor=val('uEpcor').trim();
    if(!epcor)return;
    var drafts=getAllDrafts();
    drafts.push({
      id:uid(),mapId:state.mapId,
      epcor:epcor,asap:val('uAsap'),
      unitType:activeInSeg('uTypeSeg'),status:activeInSeg('uStatSeg'),
      failType:formState.failTypeVal||FAIL_TYPES[0],patches:patchCount,notes:val('uNotes'),
      beforePhoto:formPhotos.before,afterPhoto:formPhotos.after,
      savedAt:Date.now()
    });
    sessionStorage.setItem(DRAFT_KEY,JSON.stringify(drafts));
  }catch(e){}
}
function removeDraft(draftId){try{var drafts=getAllDrafts().filter(function(d){return d.id!==draftId;});sessionStorage.setItem(DRAFT_KEY,JSON.stringify(drafts));}catch(e){}}
function clearDraft(){try{var drafts=getAllDrafts().filter(function(d){return d.mapId!==state.mapId;});sessionStorage.setItem(DRAFT_KEY,JSON.stringify(drafts));}catch(e){}}
function hasDraftForMap(mapId){return getDraftsForMap(mapId).length>0;}

// ── UNIT HISTORY ──────────────────────────────────────────────────────────────
function recordHistory(u,prevSnapshot){
  if(!u.history)u.history=[];
  var changes=[];
  var fields={status:'Status',failType:'Fail type',patches:'Patches',notes:'Notes',unitType:'Unit type',asap:'ASAP #',fins:'Fins'};
  Object.keys(fields).forEach(function(k){
    var prev=prevSnapshot?prevSnapshot[k]:undefined;
    var curr=u[k];
    if(prev===undefined&&curr===undefined)return;
    if(String(prev||'')!==String(curr||'')){
      changes.push({field:fields[k],from:prev||'—',to:curr||'—'});
    }
  });
  // photo changes
  if(prevSnapshot){
    if(!!prevSnapshot.beforePhoto!==!!u.beforePhoto)changes.push({field:'Before photo',from:prevSnapshot.beforePhoto?'Added':'None',to:u.beforePhoto?'Added':'Removed'});
    if(!!prevSnapshot.afterPhoto!==!!u.afterPhoto)changes.push({field:'After photo',from:prevSnapshot.afterPhoto?'Added':'None',to:u.afterPhoto?'Added':'Removed'});
  } else {
    changes.push({field:'Unit created',from:'',to:u.epcor});
  }
  if(changes.length===0)return;
  u.history.push({ts:Date.now(),changes:changes});
  // keep last 50 entries
  if(u.history.length>50)u.history=u.history.slice(-50);
}

// ── UNIT VALIDATION ───────────────────────────────────────────────────────────
function getUnitIssues(u){
  var issues=[];
  if(!u.status||u.status==='')issues.push('Missing status');
  if(!u.asap||u.asap==='')issues.push('Missing ASAP #');
  if(!u.unitType||u.unitType==='')issues.push('Missing unit type');
  return issues;
}
function isUnitIncomplete(u){return getUnitIssues(u).length>0;}

// ── DUPE DETECTION ────────────────────────────────────────────────────────────
function checkDupe(mapId,epcor,asap,excludeId){
  var mapUnits=db.units.filter(function(u){return u.mapId===mapId&&u.id!==excludeId;});
  var dupeEpcor=epcor&&mapUnits.some(function(u){return (u.epcor||'').toUpperCase()===(epcor||'').toUpperCase();});
  var dupeAsap=asap&&mapUnits.some(function(u){return u.asap&&u.asap===asap;});
  return {epcor:dupeEpcor,asap:dupeAsap};
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function toast(msg,duration){var t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(function(){t.classList.remove('show');},duration||2400);}
function $(id){return document.getElementById(id);}
function qs(sel,ctx){return (ctx||document).querySelector(sel);}
function val(id){var el=$(id);return el?el.value:'';}
function activeInSeg(gid){var el=qs('#'+gid+' .active');return el?el.textContent:'';}
function esc(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function segSel(gid,btn){document.querySelectorAll('#'+gid+' button').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');}
function statusBadge(s,inc){var m={Fail:'b-fail',Vegetation:'b-veg','No Access':'b-na',Clean:'b-clean'};return '<span class="badge '+(m[s]||'b-clean')+'">'+esc(s)+'</span>'+(inc?' <span class="badge b-incomplete">Incomplete</span>':'');}
function typeBadge(t){return t==='Pedestal'?'<span class="badge b-ped">Pedestal</span>':'<span class="badge b-trans">Transformer</span>';}
function daysLeft(d){return Math.max(0,30-Math.floor((Date.now()-d)/(864e5)));}
function fmtTs(ts){var d=new Date(ts);return d.toLocaleDateString('en-CA')+' '+d.toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit'});}

// ── FAB ───────────────────────────────────────────────────────────────────────
function showFabMenu(){$('fabRoot').classList.add('show');$('fabSingle').style.display='none';closeFabMenu();}
function showFabSingle(){$('fabRoot').classList.remove('show');$('fabSingle').style.display='flex';}
function hideFab(){$('fabRoot').classList.remove('show');$('fabSingle').style.display='none';closeFabMenu();}
function toggleFabMenu(){fabOpen=!fabOpen;$('fabMenu').classList.toggle('open',fabOpen);$('fabMain').classList.toggle('open',fabOpen);$('fabBackdrop').classList.toggle('open',fabOpen);}
function closeFabMenu(){fabOpen=false;$('fabMenu').classList.remove('open');$('fabMain').classList.remove('open');$('fabBackdrop').classList.remove('open');}

// ── DOT MENU ──────────────────────────────────────────────────────────────────
function toggleDotMenu(){
  dotMenuOpen=!dotMenuOpen;
  var dd=$('dotDropdown');if(dd)dd.classList.toggle('open',dotMenuOpen);
  if(dotMenuOpen){
    document.addEventListener('click',closeDotMenuOutside,true);
  }
}
function closeDotMenuOutside(e){
  var dd=$('dotDropdown');
  if(dd&&!dd.contains(e.target)&&e.target.id!=='dotBtn'){
    dotMenuOpen=false;dd.classList.remove('open');
    document.removeEventListener('click',closeDotMenuOutside,true);
  }
}
function closeDotMenu(){dotMenuOpen=false;var dd=$('dotDropdown');if(dd)dd.classList.remove('open');document.removeEventListener('click',closeDotMenuOutside,true);}

// ── COMPRESSION ───────────────────────────────────────────────────────────────
function compressImage(dataUrl,maxDim,quality,cb){
  var img=new Image();
  img.onload=function(){
    var w=img.width,h=img.height;
    if(w>maxDim||h>maxDim){if(w>h){h=Math.round(h*maxDim/w);w=maxDim;}else{w=Math.round(w*maxDim/h);h=maxDim;}}
    var c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);cb(c.toDataURL('image/jpeg',quality));
  };img.src=dataUrl;
}

// ── PHOTO NAMING ──────────────────────────────────────────────────────────────
function photoFileName(epcor,status,slot){
  var e=(epcor||'UNIT').replace(/\s+/g,'_').toUpperCase();
  var s=status==='Fail'?'FAIL':status==='Vegetation'?'VEG':status==='No Access'?'NO_ACCESS':'CLEAN';
  if(slot==='before')return e+'_'+s+'_BEFORE';
  if(slot==='after'){if(status==='Fail')return e+'_FAIL_PATCHED';if(status==='Vegetation')return e+'_VEG_CLEARED';return e+'_'+s+'_AFTER';}
  return e+'_'+s;
}
function downloadPhoto(dataUrl,filename){var a=document.createElement('a');a.href=dataUrl;a.download=filename+'.jpg';a.click();}

// ── PICKER ────────────────────────────────────────────────────────────────────
function openPicker(type){
  var opts,title,current;
  if(type==='filter'){opts=['All units','Fail','Vegetation','No Access','Clean','Incomplete'];title='Filter';current=state.filter==='All'?'All units':state.filter;}
  else if(type==='failType'){opts=FAIL_TYPES;title='Fail type';current=formState.failTypeVal||FAIL_TYPES[0];}
  $('pickerTitle').textContent=title;
  $('pickerOptions').innerHTML=opts.map(function(o){
    var sel=o===current;
    return '<div class="picker-option'+(sel?' selected':'')+'" onclick="selectPickerOption(\''+type+'\',\''+o.replace(/'/g,"\\'")+'\')"><span>'+esc(o)+'</span>'+(sel?'<svg class="picker-check" width="18" height="14" viewBox="0 0 18 14" fill="none"><path d="M1 7l5 5L17 1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>':'')+'</div>';
  }).join('');
  $('pickerOverlay').classList.add('open');
}
function selectPickerOption(type,v){
  closePicker();
  if(type==='filter'){state.filter=v==='All units'?'All':v;$('filterVal').textContent=v;renderUnits();}
  else if(type==='failType'){formState.failTypeVal=v;var el=$('failTypeDisplay');if(el)el.textContent=v;}
}
function closePicker(){$('pickerOverlay').classList.remove('open');}
function closePickerOutside(e){if(e.target===$('pickerOverlay'))closePicker();}

// ── NAVIGATION ────────────────────────────────────────────────────────────────
function setScreen(name,dir){
  document.querySelectorAll('.screen').forEach(function(s){s.classList.remove('active','anim-in','anim-back','anim-fade');});
  var el=$('screen'+name.charAt(0).toUpperCase()+name.slice(1));
  el.classList.add('active');el.classList.add(dir==='back'?'anim-back':dir==='fade'?'anim-fade':'anim-in');
  state.screen=name;$('mainContent').scrollTop=0;
}
function goBack(){
  if(state.screen==='unit')showUnits(state.mapId,'back');
  else if(state.screen==='gallery')showUnits(state.mapId,'back');
  else showMaps('back');
}

// ── GLOBAL STATS ──────────────────────────────────────────────────────────────
function calcGlobalStats(){
  return {
    totalMaps:db.maps.length,totalUnits:db.units.length,
    totalFails:db.units.filter(function(u){return u.status==='Fail';}).length,
    totalPatches:db.units.reduce(function(a,u){return a+(u.patches||0);},0),
    totalVeg:db.units.filter(function(u){return u.status==='Vegetation';}).length,
    activeMaps:db.maps.filter(function(m){return m.status!=='Completed';}).length
  };
}

// ── MAPS ──────────────────────────────────────────────────────────────────────
function showMaps(dir){
  state.mapId=null;state.unitId=null;
  $('topTitle').textContent='UtilityLog';$('backWrap').style.display='none';$('controlsRow').classList.remove('visible');
  purgeExpiredTrash();var tc=db.trash.length;
  var trashSVG='<svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  $('topActs').innerHTML='<button class="btn btn-icon" onclick="showTrash()" style="position:relative" title="Trash">'+trashSVG+(tc?'<span class="trash-badge" style="position:absolute;top:-4px;right:-4px;margin:0">'+tc+'</span>':'')+'</button>';
  showFabSingle();renderMaps();setScreen('maps',dir||'fade');
}
function renderMaps(){
  var c=$('screenMaps');var g=calcGlobalStats();
  var banner='<div class="stats-banner card-anim"><div class="stats-banner-title">Season overview</div><div class="stats-row"><div class="stat-cell"><div class="stat-cell-num">'+g.totalMaps+'</div><div class="stat-cell-lbl">Maps</div></div><div class="stat-cell"><div class="stat-cell-num">'+g.totalUnits+'</div><div class="stat-cell-lbl">Units</div></div><div class="stat-cell"><div class="stat-cell-num'+(g.totalFails?' red':'')+'">'+g.totalFails+'</div><div class="stat-cell-lbl">Fails</div></div><div class="stat-cell"><div class="stat-cell-num">'+g.totalPatches+'</div><div class="stat-cell-lbl">Patches</div></div></div>'+(g.totalVeg?'<div class="stats-divider"></div><div style="font-size:12px;color:var(--text2)">'+g.totalVeg+' vegetation · '+g.activeMaps+' active map'+(g.activeMaps!==1?'s':'')+'</div>':'')+'</div>';
  if(!db.maps.length){c.innerHTML=banner+'<div class="empty-state"><div class="empty-title">No maps yet</div><div class="empty-sub">Tap + to create your first map</div></div>'+dataSection();return;}
  c.innerHTML=banner+db.maps.map(function(m,i){
    var us=db.units.filter(function(u){return u.mapId===m.id;});
    var fails=us.filter(function(u){return u.status==='Fail';}).length;
    var vegs=us.filter(function(u){return u.status==='Vegetation';}).length;
    var patches=us.reduce(function(a,u){return a+(u.patches||0);},0);
    var incomplete=us.filter(function(u){return isUnitIncomplete(u);}).length;
    var date=m.createdAt?new Date(m.createdAt).toLocaleDateString('en-CA'):'';
    var isComplete=m.status==='Completed';
    var cam='<svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="color:var(--text3)"><path d="M2 7a2 2 0 012-2h.5l1-2h9l1 2H16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="11" r="3" stroke="currentColor" stroke-width="1.5"/></svg>';
    var thumb=m.photo?'<img class="map-thumb" src="'+m.photo+'" onclick="viewMapPhoto(\''+m.id+'\')" alt="Map">':'<div class="map-thumb-ph">'+cam+'</div>';
    return '<div class="card card-anim" style="animation-delay:'+(i*0.04)+'s'+(isComplete?';opacity:0.65':'')+'"><div class="card-row" onclick="showUnits(\''+m.id+'\')" style="cursor:pointer"><div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap"><div class="card-title">'+esc(m.name)+'</div><div class="map-status-pill '+(isComplete?'completed':'active')+'" onclick="toggleMapStatus(event,\''+m.id+'\')"><div class="pill-dot"></div>'+(isComplete?'Completed':'Active')+'</div></div><div class="card-sub">'+esc(m.location)+(date?' · '+date:'')+'</div>'+(m.notes?'<div style="font-size:12px;color:var(--text3);margin-top:3px;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(m.notes)+'</div>':'')+'<div class="card-meta"><span>'+us.length+' unit'+(us.length!==1?'s':'')+'</span>'+(fails?'<span class="red">'+fails+' fail'+(fails>1?'s':'')+'</span>':'')+(vegs?'<span class="grn">'+vegs+' veg</span>':'')+(patches?'<span>'+patches+' patch'+(patches>1?'es':'')+'</span>':'')+(incomplete?'<span class="warn">'+incomplete+' incomplete</span>':'')+'</div></div>'+thumb+'</div><div class="map-acts"><button class="btn btn-sm" onclick="editMapNotes(\''+m.id+'\')">Notes</button><button class="btn btn-sm" onclick="addMapPhoto(\''+m.id+'\')">Photo</button><button class="btn btn-sm" onclick="softDeleteMap(\''+m.id+'\',\''+esc(m.name)+'\')">Delete</button></div></div>';
  }).join('')+dataSection();
}
function dataSection(){return '<div class="section-lbl" style="margin-top:4px">Data</div><div style="display:flex;gap:8px;flex-wrap:wrap;padding-bottom:8px"><button class="btn" onclick="exportBackup()">Export backup</button><button class="btn" onclick="$(\'importFile\').click()">Import backup</button><input type="file" id="importFile" accept=".json" style="display:none" onchange="importBackup(event)"/></div>';}
function toggleMapStatus(e,mapId){
  e.stopPropagation();
  var m=db.maps.find(function(x){return x.id===mapId;});
  var us=db.units.filter(function(u){return u.mapId===mapId;});
  var incomplete=us.filter(function(u){return isUnitIncomplete(u);}).length;
  if(m.status!=='Completed'&&incomplete>0){
    toast(incomplete+' unit'+(incomplete>1?'s':'')+' still incomplete — marking complete anyway',3500);
  }
  m.status=m.status==='Completed'?'Active':'Completed';
  idbSave();renderMaps();
}
function addMapPhoto(mapId){var inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.capture='environment';inp.onchange=function(){var file=inp.files[0];if(!file)return;var r=new FileReader();r.onload=function(e){compressImage(e.target.result,1200,0.82,function(comp){var m=db.maps.find(function(x){return x.id===mapId;});m.photo=comp;idbSave();renderMaps();toast('Map photo saved');});};r.readAsDataURL(file);};inp.click();}
function viewMapPhoto(mapId){var m=db.maps.find(function(x){return x.id===mapId;});if(!m||!m.photo)return;openModal('<p class="modal-title">'+esc(m.name)+'</p><img class="modal-photo-full" src="'+m.photo+'" alt="Map"><div style="display:flex;gap:8px"><button class="btn btn-danger" style="flex:1" onclick="removeMapPhoto(\''+mapId+'\')">Remove</button><button class="btn" style="flex:1" onclick="closeModal()">Close</button></div>');}
function removeMapPhoto(mapId){var m=db.maps.find(function(x){return x.id===mapId;});delete m.photo;idbSave();closeModal();renderMaps();toast('Photo removed');}
function editMapNotes(mapId){var m=db.maps.find(function(x){return x.id===mapId;});openModal('<p class="modal-title">Map notes</p><div class="form-group"><label class="form-label">Notes</label><textarea id="mNotesVal" rows="4" placeholder="Gate code, contact, access info…">'+esc(m.notes||'')+'</textarea></div><button class="btn btn-primary" style="width:100%;padding:13px" onclick="saveMapNotes(\''+mapId+'\')">Save</button>');setTimeout(function(){var el=$('mNotesVal');if(el)el.focus();},150);}
function saveMapNotes(mapId){var m=db.maps.find(function(x){return x.id===mapId;});m.notes=val('mNotesVal').trim();idbSave();closeModal();renderMaps();toast('Notes saved');}

// ── TRASH ─────────────────────────────────────────────────────────────────────
function softDeleteMap(mapId,mapName){if(!confirm('Move "'+mapName+'" to trash?'))return;var map=db.maps.find(function(m){return m.id===mapId;});var units=db.units.filter(function(u){return u.mapId===mapId;});db.trash.push({map:map,units:units,deletedAt:Date.now()});db.maps=db.maps.filter(function(m){return m.id!==mapId;});db.units=db.units.filter(function(u){return u.mapId!==mapId;});idbSave();showMaps();toast('Moved to trash');}
function purgeExpiredTrash(){var b=db.trash.length;db.trash=db.trash.filter(function(t){return daysLeft(t.deletedAt)>0;});if(db.trash.length!==b)idbSave();}
function showTrash(){
  $('topTitle').textContent='Trash';$('backWrap').style.display='';$('topActs').innerHTML='';$('controlsRow').classList.remove('visible');hideFab();
  var c=$('screenTrash');
  if(!db.trash.length){c.innerHTML='<div class="empty-state"><div class="empty-title">Trash is empty</div><div class="empty-sub">Deleted maps appear here for 30 days</div></div>';setScreen('trash');return;}
  c.innerHTML=db.trash.map(function(t,i){var days=daysLeft(t.deletedAt);return '<div class="card card-anim" style="animation-delay:'+(i*0.04)+'s"><div class="card-row"><div><div class="card-title">'+esc(t.map.name)+'</div><div class="card-sub">'+esc(t.map.location)+'</div><div style="font-size:12px;color:var(--warn);margin-top:4px">'+days+' day'+(days!==1?'s':'')+' left</div></div>'+typeBadge(t.map.type||'Pedestal')+'</div><div class="map-acts"><button class="btn btn-sm" onclick="restoreMap('+i+')">Restore</button><button class="btn btn-sm btn-danger" onclick="permanentDeleteMap('+i+')">Delete forever</button></div></div>';}).join('');
  setScreen('trash');
}
function restoreMap(idx){var t=db.trash[idx];db.maps.push(t.map);(t.units||[]).forEach(function(u){db.units.push(u);});db.trash.splice(idx,1);idbSave();showMaps();toast('Map restored');}
function permanentDeleteMap(idx){if(!confirm('Permanently delete "'+db.trash[idx].map.name+'"?'))return;db.trash.splice(idx,1);idbSave();showTrash();toast('Permanently deleted');}

// ── UNITS ─────────────────────────────────────────────────────────────────────
function showUnits(mapId,dir){
  state.mapId=mapId;state.filter='All';state.sort='asap';
  var map=db.maps.find(function(m){return m.id===mapId;});
  $('topTitle').textContent=esc(map.name);$('backWrap').style.display='';
  $('topActs').innerHTML=
    '<button class="btn btn-sm" onclick="showGallery()">Gallery</button>'
    +'<div class="dot-menu-wrap"><button class="dot-btn" id="dotBtn" onclick="toggleDotMenu()" aria-label="More options"><span></span><span></span><span></span></button>'
    +'<div class="dot-dropdown" id="dotDropdown">'
    +'<div class="dot-item" onclick="closeDotMenu();showSummary()">Summary</div>'
    +'<div class="dot-item" onclick="closeDotMenu();exportPDF()">PDF — Full report</div>'
    +'<div class="dot-item" onclick="closeDotMenu();exportSupervisorPDF()">PDF — Supervisor</div>'
    +'<div class="dot-item" onclick="closeDotMenu();showIncompleteQueue()">Incomplete units</div>'
    +'</div></div>';
  $('filterVal').textContent='All units';$('searchInput').value='';
  $('controlsRow').classList.add('visible');showFabMenu();renderUnits();setScreen('units',dir||'forward');
}
function renderUnits(){
  var q=($('searchInput')?$('searchInput').value:'').toLowerCase().trim();
  var us=db.units.filter(function(u){return u.mapId===state.mapId;});
  var hasDraft=hasDraftForMap(state.mapId);
  if(state.filter==='Incomplete'){us=us.filter(function(u){return isUnitIncomplete(u);});}
  else if(state.filter!=='All'){us=us.filter(function(u){return u.status===state.filter;});}
  if(q)us=us.filter(function(u){return (u.epcor||'').toLowerCase().includes(q)||(u.asap||'').toString().includes(q);});
  if(state.sort==='status'){us.sort(function(a,b){var ao=STATUS_ORDER[a.status]!==undefined?STATUS_ORDER[a.status]:9;var bo=STATUS_ORDER[b.status]!==undefined?STATUS_ORDER[b.status]:9;return ao!==bo?ao-bo:(a.asap?+a.asap:9999)-(b.asap?+b.asap:9999);});}
  else{us.sort(function(a,b){return (a.asap?+a.asap:9999)-(b.asap?+b.asap:9999);});}
  var c=$('screenUnits');
  var draftHtml='';
  if(hasDraft){
    var mapDrafts=getDraftsForMap(state.mapId);
    var draftCount=mapDrafts.length;
    var draftLabel=draftCount===1?('Draft — '+esc(mapDrafts[0].epcor||'Unsaved unit')):draftCount+' drafts saved';
    draftHtml='<div class="draft-banner" onclick="showDraftList()"><div><div class="draft-banner-text">'+draftLabel+'</div><div class="draft-banner-sub">Tap to resume</div></div><svg width="8" height="13" viewBox="0 0 8 13" fill="none"><path d="M1 1l6 5.5L1 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
  }
  if(!us.length){c.innerHTML=draftHtml+'<div class="empty-state"><div class="empty-title">'+(q?'No results':'No units yet')+'</div><div class="empty-sub">'+(q||state.filter!=='All'?'Try a different search or filter':'Tap + to add a unit')+'</div></div>';return;}
  var incompleteUnits=db.units.filter(function(u){return u.mapId===state.mapId&&isUnitIncomplete(u);});
  var incompleteHtml='';
  if(incompleteUnits.length&&state.filter==='All'&&!q){
    incompleteHtml='<div class="incomplete-section"><div class="incomplete-title"><svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M10 3a7 7 0 100 14A7 7 0 0010 3z" stroke="currentColor" stroke-width="1.5"/><path d="M10 7v4M10 13h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'+incompleteUnits.length+' incomplete unit'+(incompleteUnits.length>1?'s':'')+'</div>'
      +incompleteUnits.map(function(u){return '<div class="incomplete-item" onclick="showUnit(\''+u.id+'\')"><div><div class="incomplete-item-epcor">'+esc(u.epcor)+'</div><div class="incomplete-item-issues">'+getUnitIssues(u).join(' · ')+'</div></div><svg width="8" height="13" viewBox="0 0 8 13" fill="none"><path d="M1 1l6 5.5L1 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';}).join('')+'</div>';
  }
  c.innerHTML=draftHtml+incompleteHtml+us.map(function(u,i){
    var photos=(u.beforePhoto?1:0)+(u.afterPhoto?1:0);
    var incomplete=isUnitIncomplete(u);
    return '<div class="card card-tap card-anim" style="animation-delay:'+(i*0.03)+'s" onclick="showUnit(\''+u.id+'\')">'
      +'<div class="card-row"><span class="card-title" style="font-family:monospace;font-size:14px">'+esc(u.epcor)+'</span>'+statusBadge(u.status,incomplete)+'</div>'
      +'<div class="card-meta">'+(u.asap?'<span>ASAP #'+esc(u.asap)+'</span>':'')+(u.failType?'<span>'+esc(u.failType)+'</span>':'')+(u.patches?'<span>'+u.patches+' patch'+(u.patches>1?'es':'')+'</span>':'')+(photos?'<span class="grn">'+photos+' photo'+(photos>1?'s':'')+'</span>':'')+(u.lat?'<span>GPS</span>':'')+'</div></div>';
  }).join('');
}

function showIncompleteQueue(){
  var us=db.units.filter(function(u){return u.mapId===state.mapId&&isUnitIncomplete(u);});
  if(!us.length){toast('No incomplete units');return;}
  var html='<p class="modal-title">Incomplete units</p>';
  html+=us.map(function(u){return '<div style="padding:12px 0;border-bottom:0.5px solid var(--border);cursor:pointer" onclick="closeModal();showUnit(\''+u.id+'\')"><div style="font-family:monospace;font-size:14px;font-weight:600">'+esc(u.epcor)+'</div><div style="font-size:12px;color:var(--warn);margin-top:4px">'+getUnitIssues(u).join(' · ')+'</div></div>';}).join('');
  html+='<button class="btn" style="width:100%;margin-top:16px;padding:12px" onclick="closeModal()">Close</button>';
  openModal(html);
}

// ── DRAFT ─────────────────────────────────────────────────────────────────────
function showDraftList(){
  var drafts=getDraftsForMap(state.mapId);
  if(!drafts.length)return;
  if(drafts.length===1){resumeDraftById(drafts[0].id);return;}
  var html='<p class="modal-title">Drafts ('+drafts.length+')</p>';
  html+=drafts.slice().reverse().map(function(d){
    var time=new Date(d.savedAt).toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit'});
    var dateStr=new Date(d.savedAt).toLocaleDateString('en-CA');
    var did=d.id;
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:13px 0;border-bottom:0.5px solid var(--border);gap:10px">'
      +'<div style="cursor:pointer;flex:1" onclick="closeModal();resumeDraftById(\"'+did+'\")">'
      +'<div style="font-family:monospace;font-size:14px;font-weight:600;color:var(--draft)">'+esc(d.epcor)+'</div>'
      +'<div style="font-size:11px;color:var(--text3);margin-top:2px">'+dateStr+' at '+time+(d.status?' · '+d.status:'')+'</div>'
      +'</div>'
      +'<button class="btn btn-sm btn-danger" onclick="removeDraft(\"'+did+'\");renderUnits();closeModal()">Discard</button>'
      +'</div>';
  }).join('');
  html+='<div style="display:flex;gap:8px;margin-top:16px">'
    +'<button class="btn btn-danger" style="flex:1" onclick="clearDraft();renderUnits();closeModal()">Discard all</button>'
    +'<button class="btn" style="flex:1" onclick="closeModal()">Cancel</button>'
    +'</div>';
  openModal(html);
}
function resumeDraftById(draftId){
  var drafts=getAllDrafts();
  var d=drafts.find(function(x){return x.id===draftId;});
  if(!d)return;
  removeDraft(draftId);
  formPhotos={before:d.beforePhoto||null,after:d.afterPhoto||null};
  patchCount=d.patches||0;
  formState={mode:'new',unitId:null,pendingPhotoKey:null,failTypeVal:d.failType||FAIL_TYPES[0]};
  openUnitForm(null,d);
}
function discardDraft(){clearDraft();renderUnits();toast('Drafts discarded');}

// ── GALLERY ───────────────────────────────────────────────────────────────────
function showGallery(){
  $('topTitle').textContent='Gallery';$('backWrap').style.display='';$('topActs').innerHTML='';$('controlsRow').classList.remove('visible');hideFab();
  var us=db.units.filter(function(u){return u.mapId===state.mapId&&(u.beforePhoto||u.afterPhoto);});
  var c=$('screenGallery');
  if(!us.length){c.innerHTML='<div class="empty-state"><div class="empty-title">No photos yet</div><div class="empty-sub">Add photos to units to see them here</div></div>';setScreen('gallery');return;}
  var befores=us.filter(function(u){return u.beforePhoto;});
  var afters=us.filter(function(u){return u.afterPhoto;});
  var html='';
  if(befores.length){html+='<div class="gallery-section-title">Before</div><div class="gallery-grid">';html+=befores.map(function(u){return '<div class="gallery-item" onclick="viewGalleryPhoto(\''+u.id+'\',\'before\')"><img src="'+u.beforePhoto+'" alt="'+esc(u.epcor)+'"><div class="gallery-label">'+esc(u.epcor)+(u.asap?' · #'+esc(u.asap):'')+'</div></div>';}).join('');html+='</div>';}
  if(afters.length){html+='<div class="gallery-section-title">After</div><div class="gallery-grid">';html+=afters.map(function(u){return '<div class="gallery-item" onclick="viewGalleryPhoto(\''+u.id+'\',\'after\')"><img src="'+u.afterPhoto+'" alt="'+esc(u.epcor)+'"><div class="gallery-label">'+esc(u.epcor)+(u.asap?' · #'+esc(u.asap):'')+(u.status==='Fail'?' · Patched':'')+'</div></div>';}).join('');html+='</div>';}
  c.innerHTML=html;setScreen('gallery');
}
function viewGalleryPhoto(unitId,key){
  var u=db.units.find(function(x){return x.id===unitId;});var fname=photoFileName(u.epcor,u.status,key);
  openModal('<p class="modal-title">'+esc(u.epcor)+' — '+(key==='before'?'Before':'After')+'</p><img src="'+u[key+'Photo']+'" style="width:100%;border-radius:var(--radius);margin-bottom:14px;max-height:55vh;object-fit:contain;background:var(--bg2)"><div style="display:flex;gap:8px"><button class="btn" style="flex:1" onclick="downloadPhoto(db.units.find(function(x){return x.id===\''+unitId+'\';})[\''+key+'Photo\'],\''+fname+'\');toast(\'Saved!\')">Save to device</button><button class="btn" style="flex:1" onclick="closeModal()">Close</button></div>');
}

// ── UNIT DETAIL ───────────────────────────────────────────────────────────────
function showUnit(id){
  state.unitId=id;var u=db.units.find(function(x){return x.id===id;});
  $('topTitle').textContent=u.epcor;$('backWrap').style.display='';$('controlsRow').classList.remove('visible');
  $('topActs').innerHTML='<button class="btn btn-sm" onclick="exportUnitPDF(\''+id+'\')">PDF</button><button class="btn btn-sm" onclick="startEditUnit(\''+id+'\')">Edit</button>';
  hideFab();renderUnitDetail(u);setScreen('unit');
}
function renderUnitDetail(u){
  var isFail=u.status==='Fail';
  var issues=getUnitIssues(u);
  var camSVG='<svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="color:var(--grn-text)"><path d="M2 7a2 2 0 012-2h.5l1-2h9l1 2H16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="11" r="3" stroke="currentColor" stroke-width="1.5"/></svg>';
  var html='';
  if(issues.length){html+='<div style="background:var(--warn-bg);border:0.5px solid var(--warn-border);border-radius:var(--radius);padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--warn)">Incomplete: '+issues.join(' · ')+'</div>';}
  html+='<div class="unit-header anim-fade"><div class="card-row" style="margin-bottom:10px"><div style="font-size:22px;font-weight:700;letter-spacing:-0.5px;font-family:monospace">'+esc(u.epcor)+'</div>'+statusBadge(u.status,issues.length>0)+'</div><div style="display:flex;gap:8px;flex-wrap:wrap">'+typeBadge(u.unitType||'Pedestal')+(u.asap?'<span style="font-size:12px;color:var(--text2);align-self:center">ASAP #'+esc(u.asap)+'</span>':'')+(u.fins?'<span class="badge" style="background:rgba(96,165,250,0.1);color:#60a5fa">Fins</span>':'')+'</div></div>';
  if(isFail)html+='<div class="section-lbl">Fail details</div><div class="row-detail"><span class="row-detail-label">Type</span><span class="row-detail-value">'+(u.failType?esc(u.failType):'—')+'</span></div><div class="row-detail"><span class="row-detail-label">Patches</span><span class="row-detail-value" style="color:var(--grn-text);font-size:18px;font-weight:700">'+(u.patches||0)+'</span></div>';
  if(u.status==='Vegetation')html+='<div style="padding:10px 0;font-size:14px;color:var(--text2)">Vegetation noted.</div>';
  if(u.status==='No Access')html+='<div style="padding:10px 0;font-size:14px;color:var(--text2)">Unit not accessible.</div>';
  if(u.lat)html+='<div class="section-lbl">Location</div><div class="gps-stamp"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;color:var(--grn-text)"><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span class="gps-coords">'+u.lat.toFixed(6)+', '+u.lng.toFixed(6)+'</span><a class="gps-link" href="https://www.google.com/maps?q='+u.lat+','+u.lng+'" target="_blank">View on Maps</a></div>';
  html+='<div class="section-lbl">Photos</div><div class="photo-grid">'+detailPhotoSlot(u,'before','Before')+detailPhotoSlot(u,'after','After')+'</div>';
  if(u.notes)html+='<div class="section-lbl">Notes</div><div style="font-size:14px;line-height:1.65;color:var(--text2)">'+esc(u.notes)+'</div>';
  // History
  if(u.history&&u.history.length){
    html+='<div class="section-lbl">Change history</div>';
    var hist=u.history.slice().reverse();
    html+=hist.map(function(h){
      return '<div class="history-entry"><div class="history-time">'+fmtTs(h.ts)+'</div>'
        +h.changes.map(function(c){
          if(!c.from&&c.field==='Unit created')return '<div class="history-change">Unit created</div>';
          return '<div class="history-change"><strong>'+esc(c.field)+'</strong>: '+esc(String(c.from))+' → '+esc(String(c.to))+'</div>';
        }).join('')+'</div>';
    }).join('');
  }
  html+='<div style="margin-top:24px;padding-bottom:20px"><button class="btn btn-danger" style="width:100%" onclick="deleteUnit(\''+u.id+'\')">Delete unit</button></div>';
  $('screenUnit').innerHTML=html;
}
function detailPhotoSlot(u,key,label){
  var p=u[key+'Photo'];var camSVG='<svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="color:var(--grn-text)"><path d="M2 7a2 2 0 012-2h.5l1-2h9l1 2H16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="11" r="3" stroke="currentColor" stroke-width="1.5"/></svg>';
  if(p)return '<div class="photo-slot" onclick="viewDetailPhoto(\''+u.id+'\',\''+key+'\')" ><img src="'+p+'" alt="'+label+'"><span style="position:absolute;bottom:6px;left:8px;background:rgba(0,0,0,0.6);color:#fff;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:600;z-index:1">'+label.toUpperCase()+'</span></div>';
  return '<div class="photo-slot" onclick="detailPickPhoto(\''+u.id+'\',\''+key+'\')">'+camSVG+'<span class="p-lbl">'+label+'</span></div>';
}
function detailPickPhoto(unitId,key){openModal('<p class="modal-title">Add photo</p><div style="display:flex;flex-direction:column;gap:10px;padding-bottom:6px"><button class="btn" style="width:100%;padding:14px;font-size:15px" onclick="detailLaunch(\''+unitId+'\',\''+key+'\',true)">Take photo</button><button class="btn" style="width:100%;padding:14px;font-size:15px" onclick="detailLaunch(\''+unitId+'\',\''+key+'\',false)">Choose from gallery</button><button class="btn" style="width:100%;padding:12px" onclick="closeModal()">Cancel</button></div>');}
function detailLaunch(unitId,key,cam){
  closeModal();var inp=document.createElement('input');inp.type='file';inp.accept='image/*';if(cam)inp.capture='environment';
  inp.onchange=function(){var file=inp.files[0];if(!file)return;var r=new FileReader();r.onload=function(e){compressImage(e.target.result,1600,0.85,function(comp){
    var u=db.units.find(function(x){return x.id===unitId;});
    var prev={beforePhoto:u.beforePhoto,afterPhoto:u.afterPhoto};
    u[key+'Photo']=comp;
    recordHistory(u,prev);
    idbSave();showAnnotationModal(comp,unitId,key);
  });};r.readAsDataURL(file);};inp.click();
}
function viewDetailPhoto(unitId,key){
  var u=db.units.find(function(x){return x.id===unitId;});var fname=photoFileName(u.epcor,u.status,key);
  openModal('<p class="modal-title">'+(key==='before'?'Before':'After')+'</p><img src="'+u[key+'Photo']+'" style="width:100%;border-radius:var(--radius);margin-bottom:14px;max-height:55vh;object-fit:contain;background:var(--bg2)"><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" style="flex:1" onclick="downloadPhoto(db.units.find(function(x){return x.id===\''+unitId+'\';})[\''+key+'Photo\'],\''+fname+'\');toast(\'Saved!\')">Save to device</button><button class="btn" style="flex:1" onclick="showAnnotationModal(db.units.find(function(x){return x.id===\''+unitId+'\';})[\''+key+'Photo\'],\''+unitId+'\',\''+key+'\')">Annotate</button><button class="btn btn-danger" style="flex:1" onclick="removeDetailPhoto(\''+unitId+'\',\''+key+'\')">Remove</button></div>');
}
function removeDetailPhoto(unitId,key){
  var u=db.units.find(function(x){return x.id===unitId;});
  var prev={beforePhoto:u.beforePhoto,afterPhoto:u.afterPhoto};
  delete u[key+'Photo'];recordHistory(u,prev);idbSave();closeModal();
  renderUnitDetail(db.units.find(function(x){return x.id===state.unitId;}));toast('Photo removed');
}
function deleteUnit(id){if(!confirm('Delete this unit?'))return;db.units=db.units.filter(function(u){return u.id!==id;});idbSave();goBack();toast('Unit deleted');}

// ── ANNOTATION ────────────────────────────────────────────────────────────────
function showAnnotationModal(dataUrl,unitId,key){
  closeModal();var u=db.units.find(function(x){return x.id===unitId;});var defaultText=u?u.epcor:'';
  annState={unitId:unitId,key:key,textX:20,textY:20,fontSize:14,dragging:false,startX:0,startY:0};
  openModal('<p class="modal-title">Annotate photo</p><div class="form-group"><label class="form-label">Text</label><input id="annText" value="'+esc(defaultText)+'" placeholder="e.g. PED15828" oninput="updateAnnLabel()"/></div><div class="annotation-wrap" id="annWrap"><canvas id="annCanvas"></canvas><div class="ann-label selected" id="annLabel" style="left:20px;top:20px;font-size:14px">'+esc(defaultText)+'</div></div><div class="ann-controls"><div class="ann-row"><label>Size</label><input type="range" id="annSize" min="10" max="40" value="14" oninput="updateAnnSize(this.value)"/></div></div><p style="font-size:11px;color:var(--text3);margin-top:10px;text-align:center">Drag label to reposition</p><div style="display:flex;gap:8px;margin-top:14px"><button class="btn" style="flex:1" onclick="closeModal()">Skip</button><button class="btn btn-primary" style="flex:1" onclick="applyAnnotation(\''+unitId+'\',\''+key+'\')">Save</button></div>');
  setTimeout(function(){var canvas=$('annCanvas');var wrap=$('annWrap');if(!canvas||!wrap)return;var img=new Image();img.onload=function(){var maxW=wrap.clientWidth;var ratio=img.height/img.width;canvas.width=img.width;canvas.height=img.height;canvas.style.width=maxW+'px';canvas.style.height=Math.round(maxW*ratio)+'px';wrap.style.height=Math.round(maxW*ratio)+'px';canvas.getContext('2d').drawImage(img,0,0);};img.src=dataUrl;setupAnnDrag();var el=$('annText');if(el)el.focus();},120);
}
function updateAnnLabel(){var lbl=$('annLabel');var txt=$('annText');if(lbl&&txt)lbl.textContent=txt.value;}
function updateAnnSize(v){annState.fontSize=parseInt(v);var lbl=$('annLabel');if(lbl)lbl.style.fontSize=v+'px';}
function setupAnnDrag(){
  var lbl=$('annLabel');var wrap=$('annWrap');if(!lbl||!wrap)return;
  function getPos(e){var t=e.touches?e.touches[0]:e;return {x:t.clientX,y:t.clientY};}
  function onStart(e){e.preventDefault();var p=getPos(e);annState.dragging=true;annState.startX=p.x-annState.textX;annState.startY=p.y-annState.textY;}
  function onMove(e){if(!annState.dragging)return;e.preventDefault();var p=getPos(e);var wRect=wrap.getBoundingClientRect();annState.textX=Math.max(0,Math.min(p.x-annState.startX,wRect.width-100));annState.textY=Math.max(0,Math.min(p.y-annState.startY,wRect.height-30));lbl.style.left=annState.textX+'px';lbl.style.top=annState.textY+'px';}
  function onEnd(){annState.dragging=false;}
  lbl.addEventListener('mousedown',onStart);lbl.addEventListener('touchstart',onStart,{passive:false});
  document.addEventListener('mousemove',onMove);document.addEventListener('touchmove',onMove,{passive:false});
  document.addEventListener('mouseup',onEnd);document.addEventListener('touchend',onEnd);
}
function applyAnnotation(unitId,key){
  var canvas=$('annCanvas');var wrap=$('annWrap');var text=$('annText')?$('annText').value:'';if(!canvas){closeModal();return;}
  var scaleX=canvas.width/(wrap?wrap.clientWidth:1);var ctx=canvas.getContext('2d');var tx=annState.textX*scaleX;var ty=annState.textY*scaleX;var fontSize=Math.round(annState.fontSize*scaleX);
  ctx.font='bold '+fontSize+'px -apple-system,sans-serif';var metrics=ctx.measureText(text||' ');var pad=fontSize*0.4;var bw=metrics.width+pad*2;var bh=fontSize+pad*1.5;
  ctx.fillStyle='rgba(0,0,0,0.72)';roundRect(ctx,tx,ty,bw,bh,fontSize*0.25);ctx.fill();ctx.fillStyle='#ffffff';ctx.fillText(text,tx+pad,ty+fontSize+pad*0.3);
  var u=db.units.find(function(x){return x.id===unitId;});u[key+'Photo']=canvas.toDataURL('image/jpeg',0.9);
  idbSave();closeModal();renderUnitDetail(db.units.find(function(x){return x.id===state.unitId;}));toast('Annotation saved');
}
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}

// ── GPS ───────────────────────────────────────────────────────────────────────
function stampGPSForm(){if(!navigator.geolocation){toast('GPS not available');return;}toast('Getting location…');navigator.geolocation.getCurrentPosition(function(pos){formGPS={lat:pos.coords.latitude,lng:pos.coords.longitude};var lbl=$('gpsFormLabel');if(lbl)lbl.textContent='Lat '+formGPS.lat.toFixed(5)+' · Lon '+formGPS.lng.toFixed(5);toast('Location stamped');},function(){toast('Could not get location');},{enableHighAccuracy:true,timeout:10000});}

// ── UNIT FORM ─────────────────────────────────────────────────────────────────
function showNewUnitModal(){patchCount=0;formPhotos={before:null,after:null};formGPS=null;formState={mode:'new',unitId:null,pendingPhotoKey:null,failTypeVal:FAIL_TYPES[0]};openUnitForm(null,null);}
function startEditUnit(id){var u=db.units.find(function(x){return x.id===id;});patchCount=u.patches||0;formPhotos={before:u.beforePhoto||null,after:u.afterPhoto||null};formGPS=u.lat?{lat:u.lat,lng:u.lng}:null;formState={mode:'edit',unitId:id,pendingPhotoKey:null,failTypeVal:u.failType||FAIL_TYPES[0]};openUnitForm(u,null);}

function openUnitForm(u,saved){
  var status=saved?saved.status:(u?u.status:'Clean');var isFail=status==='Fail';
  var unitType=saved?saved.unitType:(u?u.unitType:'Pedestal');var isTrans=unitType==='Transformer';
  var finsVal=u&&u.fins?true:false;var failTypeVal=saved?saved.failType:(formState.failTypeVal||FAIL_TYPES[0]);
  var camSVG='<svg width="22" height="22" viewBox="0 0 20 20" fill="none" style="color:var(--grn-text)"><path d="M2 7a2 2 0 012-2h.5l1-2h9l1 2H16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="11" r="3" stroke="currentColor" stroke-width="1.5"/></svg>';
  var gpsSVG='<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  var chevSVG='<svg width="12" height="7" viewBox="0 0 12 7" fill="none"><path d="M1 1l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var html='<p class="modal-title">'+(u&&!saved?'Edit '+esc(u.epcor):(saved?'Resume draft':'Add unit'))+'</p>'
    +'<div class="form-group"><label class="form-label">EPCOR # <span style="color:var(--fail);font-size:10px">required</span></label><input id="uEpcor" value="'+(saved?esc(saved.epcor):(u?esc(u.epcor):''))+'" placeholder="'+(unitType==='Pedestal'?'e.g. PED15828':'e.g. T1234')+'" autocomplete="off" autocorrect="off" spellcheck="false" oninput="this.value=this.value.toUpperCase();onEpcorInput()"/><div class="field-warn" id="warnEpcor">EPCOR # is required</div></div>'
    +'<div class="form-group"><label class="form-label">ASAP # <span style="color:var(--warn);font-size:10px">recommended</span></label><input id="uAsap" type="number" value="'+(saved?saved.asap:(u&&u.asap?u.asap:''))+'" placeholder="e.g. 33"/><div class="field-warn" id="warnAsap">ASAP # is missing — unit will be flagged incomplete</div></div>'
    +'<div class="form-group"><label class="form-label">Unit type</label><div class="seg" id="uTypeSeg">'+['Pedestal','Transformer'].map(function(t){var active=saved?saved.unitType===t:(u?u.unitType===t:t==='Pedestal');return '<button'+(active?' class="active"':'')+' onclick="segSel(\'uTypeSeg\',this);onUnitTypeChange(this)">'+t+'</button>';}).join('')+'</div></div>'
    +'<div id="finsGroup" class="field-expand'+(isTrans?' shown':' hidden')+'" style="max-height:'+(isTrans?'80px':'0')+';margin-bottom:'+(isTrans?'16':'0')+'px"><div class="toggle-row"><div><div class="toggle-label">Fins</div><div class="toggle-sub">Does this transformer have fins?</div></div><label class="toggle-switch"><input type="checkbox" id="uFins"'+(finsVal?' checked':'')+'/><div class="toggle-track"></div></label></div></div>'
    +'<div class="form-group"><label class="form-label">Status</label><div class="seg" id="uStatSeg">'+['Clean','Fail','Vegetation','No Access'].map(function(s){return '<button'+(s===status?' class="active"':'')+' onclick="segSel(\'uStatSeg\',this);chkFail()">'+s+'</button>';}).join('')+'</div></div>'
    +'<div id="failFields" class="field-expand'+(isFail?' shown':' hidden')+'" style="max-height:'+(isFail?'200px':'0')+'">'
    +'<div class="form-group"><label class="form-label">Fail type</label><button class="form-picker" onclick="openPicker(\'failType\')"><span class="form-picker-val" id="failTypeDisplay">'+esc(failTypeVal)+'</span><span class="form-picker-chevron">'+chevSVG+'</span></button></div>'
    +'<div class="form-group"><label class="form-label">Patches</label><div class="patch-ctrl"><button class="patch-btn" onclick="adjP(-1)">−</button><span class="patch-val" id="pNum">'+(saved?saved.patches:(u?u.patches||0:0))+'</span><button class="patch-btn" onclick="adjP(1)">+</button></div></div></div>'
    +'<div class="form-group"><label class="form-label">GPS location</label><button class="btn" style="width:100%;gap:8px" onclick="stampGPSForm()">'+gpsSVG+'<span id="gpsFormLabel">'+(formGPS?'Lat '+formGPS.lat.toFixed(5)+' · Lon '+formGPS.lng.toFixed(5):'Stamp current location')+'</span></button></div>'
    +'<div class="form-group"><label class="form-label">Before photo</label><div class="photo-form-wrap'+(val('uEpcor')||u||saved?'':' blocked')+'" id="formPhoto_before">'+formPhotoSlotInner('before')+'</div><p class="form-hint" id="photoHint" style="display:'+(val('uEpcor')||u||saved?'none':'block')+'">Enter EPCOR # first to enable photos</p></div>'
    +'<div class="form-group"><label class="form-label">After photo</label><div class="photo-form-wrap'+(val('uEpcor')||u||saved?'':' blocked')+'" id="formPhoto_after">'+formPhotoSlotInner('after')+'</div></div>'
    +'<div class="form-group"><label class="form-label">Notes</label><textarea id="uNotes" rows="2" placeholder="Optional notes…">'+(saved?esc(saved.notes||''):(u?esc(u.notes||''):''))+'</textarea></div>'
    +'<button class="btn btn-primary" style="width:100%;padding:14px;font-size:15px;margin-top:4px" onclick="submitUnitForm()">'+(formState.mode==='edit'?'Save changes':'Add unit')+'</button>'
    +(saved?'<button class="btn" style="width:100%;padding:11px;margin-top:8px" onclick="removeDraftAndClose()">Discard this draft</button>':'');
  openModal(html);
  if(saved)patchCount=saved.patches||0;
  // Show ASAP warning softly after a moment
  setTimeout(function(){
    var asapEl=$('uAsap');var warn=$('warnAsap');
    if(asapEl&&warn&&!asapEl.value){warn.classList.add('show');}
  },1000);
}
function onUnitTypeChange(btn){
  var isPed=btn.textContent==='Pedestal';var isTrans=btn.textContent==='Transformer';
  var el=$('uEpcor');if(el)el.placeholder=isPed?'e.g. PED15828':'e.g. T1234';
  var fg=$('finsGroup');if(fg){fg.style.maxHeight=isTrans?'80px':'0';fg.style.marginBottom=isTrans?'16px':'0';fg.classList.toggle('shown',isTrans);fg.classList.toggle('hidden',!isTrans);}
}
function onEpcorInput(){
  var hasVal=val('uEpcor').trim().length>0;
  ['before','after'].forEach(function(key){var wrap=$('formPhoto_'+key);if(wrap)wrap.classList.toggle('blocked',!hasVal);});
  var hint=$('photoHint');if(hint)hint.style.display=hasVal?'none':'block';
  var warn=$('warnEpcor');if(warn)warn.classList.toggle('show',!hasVal);
}
function adjP(d){patchCount=Math.max(0,patchCount+d);$('pNum').textContent=patchCount;}
function chkFail(){var s=activeInSeg('uStatSeg');var isFail=s==='Fail';var el=$('failFields');if(el){el.style.maxHeight=isFail?'200px':'0';el.classList.toggle('shown',isFail);el.classList.toggle('hidden',!isFail);}}

function submitUnitForm(){
  var epcor=val('uEpcor').trim();
  if(!epcor){var w=$('warnEpcor');if(w)w.classList.add('show');toast('EPCOR # is required');return;}
  var status=activeInSeg('uStatSeg');var isFail=status==='Fail';
  var finsEl=$('uFins');var fins=finsEl?finsEl.checked:false;
  var failType=formState.failTypeVal||FAIL_TYPES[0];
  var asap=val('uAsap').trim();
  // Dupe check
  var dupes=checkDupe(state.mapId,epcor,asap,formState.mode==='edit'?formState.unitId:null);
  if(dupes.epcor||dupes.asap){
    var msg='';
    if(dupes.epcor)msg+='EPCOR # "'+epcor+'" already exists in this map. ';
    if(dupes.asap)msg+='ASAP # "'+asap+'" already exists in this map. ';
    msg+='Save anyway?';
    if(!confirm(msg))return;
  }
  if(formState.mode==='edit'){
    var u=db.units.find(function(x){return x.id===formState.unitId;});
    var prev={status:u.status,failType:u.failType,patches:u.patches,notes:u.notes,unitType:u.unitType,asap:u.asap,fins:u.fins,beforePhoto:u.beforePhoto,afterPhoto:u.afterPhoto};
    u.epcor=epcor;u.asap=asap;u.unitType=activeInSeg('uTypeSeg');u.status=status;u.failType=isFail?failType:'';u.patches=isFail?patchCount:0;u.notes=val('uNotes').trim();u.fins=fins;u.incomplete=false;
    if(formGPS){u.lat=formGPS.lat;u.lng=formGPS.lng;}
    if(formPhotos.before)u.beforePhoto=formPhotos.before;else if(formPhotos.before===null)delete u.beforePhoto;
    if(formPhotos.after)u.afterPhoto=formPhotos.after;else if(formPhotos.after===null)delete u.afterPhoto;
    recordHistory(u,prev);
    idbSave();clearFormState();clearDraft();closeModal();$('topTitle').textContent=esc(u.epcor);renderUnitDetail(u);toast('Saved');
  } else {
    var nu={id:uid(),mapId:state.mapId,epcor:epcor,asap:asap,unitType:activeInSeg('uTypeSeg'),status:status,failType:isFail?failType:'',patches:isFail?patchCount:0,notes:val('uNotes').trim(),fins:fins,createdAt:Date.now()};
    if(formGPS){nu.lat=formGPS.lat;nu.lng=formGPS.lng;}
    if(formPhotos.before)nu.beforePhoto=formPhotos.before;if(formPhotos.after)nu.afterPhoto=formPhotos.after;
    recordHistory(nu,null);
    db.units.push(nu);idbSave();clearFormState();clearDraft();closeModal();
    patchCount=0;formPhotos={before:null,after:null};formGPS=null;renderUnits();toast('Unit added');
  }
}

// ── FORM PHOTOS ───────────────────────────────────────────────────────────────
function formPhotoSlotInner(key){
  var camSVG='<svg width="22" height="22" viewBox="0 0 20 20" fill="none" style="color:var(--grn-text)"><path d="M2 7a2 2 0 012-2h.5l1-2h9l1 2H16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="11" r="3" stroke="currentColor" stroke-width="1.5"/></svg>';
  if(formPhotos[key])return '<img class="photo-form-preview" src="'+formPhotos[key]+'" alt="photo"><div class="photo-form-actions"><button onclick="formLaunch(\''+key+'\',true)">Retake</button><button onclick="formLaunch(\''+key+'\',false)">Gallery</button><button onclick="formRemovePhoto(\''+key+'\')">Remove</button></div>';
  return '<div class="photo-form-empty" onclick="formLaunch(\''+key+'\',false)">'+camSVG+'<span class="pfe-lbl">Tap to add</span></div><div class="photo-form-actions"><button onclick="formLaunch(\''+key+'\',true)">Camera</button><button onclick="formLaunch(\''+key+'\',false)">Gallery</button></div>';
}
function refreshFormPhotoSlot(key){var s=$('formPhoto_'+key);if(s)s.innerHTML=formPhotoSlotInner(key);}
function formRemovePhoto(key){formPhotos[key]=null;refreshFormPhotoSlot(key);saveFormState();}
function formLaunch(key,cam){
  var epcor=val('uEpcor').trim();if(!epcor){toast('Enter EPCOR # first');return;}
  formState.pendingPhotoKey=key;saveFormState();
  var inp=document.createElement('input');inp.type='file';inp.accept='image/*';if(cam)inp.capture='environment';
  inp.onchange=function(){var file=inp.files[0];if(!file)return;var r=new FileReader();r.onload=function(e){compressImage(e.target.result,1600,0.85,function(comp){formPhotos[key]=comp;formState.pendingPhotoKey=null;saveFormState();refreshFormPhotoSlot(key);toast('Photo added');});};r.readAsDataURL(file);};inp.click();
}
function restoreFormIfNeeded(){
  try{var raw=sessionStorage.getItem(FORM_KEY);if(!raw)return false;var fs=JSON.parse(raw);if(!fs.photoKey)return false;clearFormState();state.mapId=fs.mapId;formPhotos={before:fs.beforePhoto||null,after:fs.afterPhoto||null};patchCount=fs.patches||0;formState={mode:fs.mode,unitId:fs.unitId||null,pendingPhotoKey:null,failTypeVal:fs.failType||FAIL_TYPES[0]};var u=fs.mode==='edit'?db.units.find(function(x){return x.id===fs.unitId;}):null;openUnitForm(u,fs);setTimeout(function(){refreshFormPhotoSlot('before');refreshFormPhotoSlot('after');},80);return true;}catch(e){return false;}
}

// ── QUICK ADD ─────────────────────────────────────────────────────────────────
function showQuickAddModal(){
  qaStatus=null;
  openModal('<p class="modal-title">Quick Add</p><div class="form-group"><label class="form-label">EPCOR #</label><input class="qa-epcor" id="qaEpcor" placeholder="e.g. PED15828" autocomplete="off" autocorrect="off" spellcheck="false" oninput="this.value=this.value.toUpperCase();checkQASubmit()"/></div><div class="form-group"><label class="form-label">Status</label><div class="qa-status-grid"><div class="qa-status-opt" id="qaClean" onclick="selQAStatus(\'Clean\',this)">Clean</div><div class="qa-status-opt" id="qaFail" onclick="selQAStatus(\'Fail\',this)">Fail</div><div class="qa-status-opt" id="qaVeg" onclick="selQAStatus(\'Vegetation\',this)">Vegetation</div><div class="qa-status-opt" id="qaNA" onclick="selQAStatus(\'No Access\',this)">No Access</div></div></div><button class="qa-submit" id="qaSubmitBtn" disabled onclick="submitQuickAdd()">Save unit</button><p style="font-size:11px;color:var(--text3);text-align:center;margin-top:10px">ASAP # and unit type can be filled in later</p>');
  setTimeout(function(){var el=$('qaEpcor');if(el)el.focus();},150);
}
function selQAStatus(s,el){qaStatus=s;var cls={Clean:'sel-clean',Fail:'sel-fail',Vegetation:'sel-veg','No Access':'sel-na'};['qaClean','qaFail','qaVeg','qaNA'].forEach(function(id){var btn=$(id);if(btn)btn.className='qa-status-opt';});el.classList.add(cls[s]||'');checkQASubmit();}
function checkQASubmit(){var btn=$('qaSubmitBtn');if(btn)btn.disabled=!(val('qaEpcor').trim()&&qaStatus);}
function submitQuickAdd(){
  var epcor=val('qaEpcor').trim();if(!epcor||!qaStatus)return;
  var dupes=checkDupe(state.mapId,epcor,null,null);
  if(dupes.epcor&&!confirm('EPCOR # "'+epcor+'" already exists in this map. Save anyway?'))return;
  var nu={id:uid(),mapId:state.mapId,epcor:epcor,asap:'',unitType:'Pedestal',status:qaStatus,failType:'',patches:0,notes:'',createdAt:Date.now()};
  recordHistory(nu,null);
  db.units.push(nu);idbSave();closeModal();renderUnits();toast(epcor+' added');
}

// ── NEW MAP ───────────────────────────────────────────────────────────────────
function showNewMapModal(){
  newMapPhoto=null;
  var camSVG='<svg width="22" height="22" viewBox="0 0 20 20" fill="none" style="color:var(--grn-text)"><path d="M2 7a2 2 0 012-2h.5l1-2h9l1 2H16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="11" r="3" stroke="currentColor" stroke-width="1.5"/></svg>';
  openModal('<p class="modal-title">New map</p>'
    +'<div class="form-group"><label class="form-label">Map name <span style="color:var(--fail);font-size:10px">required</span></label><input id="mName" placeholder="e.g. Sakaw West" autocomplete="off" oninput="onMapNameInput()"/><div class="field-warn" id="warnMName">Map name is required</div></div>'
    +'<div class="form-group"><label class="form-label">Location / area <span style="color:var(--warn);font-size:10px">recommended</span></label><input id="mLoc" placeholder="e.g. Edmonton North" autocomplete="off"/><div class="field-warn" id="warnMLoc">Location helps identify the map</div></div>'
    +'<div class="form-group"><label class="form-label">Notes (optional)</label><textarea id="mNotes" rows="2" placeholder="Gate code, contact info…"></textarea></div>'
    +'<div class="form-group"><label class="form-label">Primary unit type</label><div class="seg" id="mTypeSeg"><button class="active" onclick="segSel(\'mTypeSeg\',this)">Pedestal</button><button onclick="segSel(\'mTypeSeg\',this)">Transformer</button><button onclick="segSel(\'mTypeSeg\',this)">Mixed</button></div></div>'
    +'<div class="form-group"><label class="form-label">Map photo (optional)</label><div class="photo-form-wrap" id="newMapPhotoSlot"><div class="photo-form-empty" onclick="pickNewMapPhoto(false)">'+camSVG+'<span class="pfe-lbl">Tap to add</span></div><div class="photo-form-actions"><button onclick="pickNewMapPhoto(true)">Camera</button><button onclick="pickNewMapPhoto(false)">Gallery</button></div></div></div>'
    +'<button class="btn btn-primary" style="width:100%;padding:14px;font-size:15px" onclick="createMap()">Create map</button>');
  setTimeout(function(){var el=$('mName');if(el)el.focus();},150);
}
function onMapNameInput(){var w=$('warnMName');var locW=$('warnMLoc');if(w)w.classList.toggle('show',!val('mName').trim());if(locW&&!val('mLoc').trim())setTimeout(function(){if(locW)locW.classList.add('show');},800);}
function pickNewMapPhoto(cam){var inp=document.createElement('input');inp.type='file';inp.accept='image/*';if(cam)inp.capture='environment';inp.onchange=function(){var file=inp.files[0];if(!file)return;var r=new FileReader();r.onload=function(e){compressImage(e.target.result,1200,0.82,function(comp){newMapPhoto=comp;var slot=$('newMapPhotoSlot');if(slot)slot.innerHTML='<img class="photo-form-preview" src="'+comp+'" alt="Map"><div class="photo-form-actions"><button onclick="pickNewMapPhoto(true)">Retake</button><button onclick="pickNewMapPhoto(false)">Gallery</button><button onclick="newMapPhoto=null;renderNewMapPhotoEmpty()">Remove</button></div>';toast('Photo added');});};r.readAsDataURL(file);};inp.click();}
function renderNewMapPhotoEmpty(){var slot=$('newMapPhotoSlot');if(slot)slot.innerHTML='<div class="photo-form-empty" onclick="pickNewMapPhoto(false)"><svg width="22" height="22" viewBox="0 0 20 20" fill="none" style="color:var(--grn-text)"><path d="M2 7a2 2 0 012-2h.5l1-2h9l1 2H16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="11" r="3" stroke="currentColor" stroke-width="1.5"/></svg><span class="pfe-lbl">Tap to add</span></div><div class="photo-form-actions"><button onclick="pickNewMapPhoto(true)">Camera</button><button onclick="pickNewMapPhoto(false)">Gallery</button></div>';}
function createMap(){
  var name=val('mName').trim();
  if(!name){var w=$('warnMName');if(w)w.classList.add('show');toast('Map name is required');return;}
  var m={id:uid(),name:name,location:val('mLoc').trim(),notes:val('mNotes').trim(),type:activeInSeg('mTypeSeg'),status:'Active',createdAt:Date.now()};
  if(newMapPhoto)m.photo=newMapPhoto;newMapPhoto=null;db.maps.push(m);idbSave();closeModal();renderMaps();toast('Map created');
}

// ── SUMMARY ───────────────────────────────────────────────────────────────────
function showSummary(){
  // Button tap feedback handled by .btn:active CSS
  // Modal entrance handled by .modal-overlay.open .modal transition
  var us=db.units.filter(function(u){return u.mapId===state.mapId;});
  var map=db.maps.find(function(m){return m.id===state.mapId;});
  var fails=us.filter(function(u){return u.status==='Fail';}).length;
  var veg=us.filter(function(u){return u.status==='Vegetation';}).length;
  var na=us.filter(function(u){return u.status==='No Access';}).length;
  var clean=us.filter(function(u){return u.status==='Clean';}).length;
  var patches=us.reduce(function(a,u){return a+(u.patches||0);},0);
  var incomplete=us.filter(function(u){return isUnitIncomplete(u);}).length;
  function sm(n,l,red){return '<div class="sum-box"><div class="sum-num'+(red?' red':'')+'">'+n+'</div><div class="sum-lbl">'+l+'</div></div>';}
  var html='<p class="modal-title">'+esc(map.name)+'</p><div class="sum-grid">'+sm(us.length,'Total')+sm(fails,'Fails',fails>0)+sm(patches,'Patches')+sm(veg,'Veg')+sm(na,'No access')+sm(clean,'Clean')+'</div>';
  if(incomplete)html+='<div style="background:var(--warn-bg);border:0.5px solid var(--warn-border);border-radius:var(--radius);padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--warn)">'+incomplete+' unit'+(incomplete>1?'s':'')+' incomplete (missing status, ASAP #, or unit type)</div>';
  if(fails){html+='<div class="section-lbl">Fail breakdown</div><div style="font-size:14px;line-height:2.4">';FAIL_TYPES.forEach(function(f){var n=us.filter(function(u){return u.failType===f;}).length;if(n)html+=esc(f)+': <strong style="color:var(--grn-text)">'+n+'</strong><br>';});html+='</div>';}
  if(map.notes)html+='<div class="section-lbl">Map notes</div><div style="font-size:14px;color:var(--text2);line-height:1.6">'+esc(map.notes)+'</div>';
  html+='<button class="btn" style="width:100%;margin-top:18px;padding:13px" onclick="closeModal()">Close</button>';
  openModal(html);
}

// ── PDF — FULL ────────────────────────────────────────────────────────────────
function exportPDF(){
  if(typeof jspdf==='undefined'){toast('PDF not ready, try again');return;}
  var map=db.maps.find(function(m){return m.id===state.mapId;});
  var us=db.units.filter(function(u){return u.mapId===state.mapId;});
  if(state.sort==='status'){us.sort(function(a,b){var ao=STATUS_ORDER[a.status]!==undefined?STATUS_ORDER[a.status]:9;var bo=STATUS_ORDER[b.status]!==undefined?STATUS_ORDER[b.status]:9;return ao!==bo?ao-bo:(a.asap?+a.asap:9999)-(b.asap?+b.asap:9999);});}else{us.sort(function(a,b){return (a.asap?+a.asap:9999)-(b.asap?+b.asap:9999);});}
  if(!us.length){toast('No units to export');return;}toast('Generating PDF…');
  var doc=new jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  var date=new Date().toLocaleDateString('en-CA');var pw=doc.internal.pageSize.getWidth();
  var fails=us.filter(function(u){return u.status==='Fail';}).length;
  var patches=us.reduce(function(a,u){return a+(u.patches||0);},0);
  var veg=us.filter(function(u){return u.status==='Vegetation';}).length;
  doc.setFillColor(21,128,61);doc.rect(0,0,pw,32,'F');doc.setTextColor(255);doc.setFontSize(20);doc.setFont(undefined,'bold');doc.text(map.name,14,16);doc.setFontSize(9);doc.setFont(undefined,'normal');doc.text(map.location+'  ·  '+map.type+'  ·  '+date,14,24);doc.setTextColor(0);var y=40;
  if(map.notes){doc.setFontSize(9);doc.setTextColor(80);doc.text('Notes: '+map.notes,14,y);y+=6;doc.setTextColor(0);}
  doc.setFontSize(10);doc.text('Total: '+us.length+'   Fails: '+fails+'   Patches: '+patches+'   Veg: '+veg,14,y);y+=6;
  doc.autoTable({startY:y,head:[['EPCOR #','ASAP #','Type','Status','Fail type','Patches','Fins','Notes']],body:us.map(function(u){return [u.epcor||'',u.asap||'',u.unitType||'',u.status,u.failType||'—',u.patches||0,u.fins?'Yes':'',u.notes||''];}),styles:{fontSize:8,cellPadding:2.5,overflow:'linebreak'},headStyles:{fillColor:[21,128,61],textColor:255,fontStyle:'bold',fontSize:8},alternateRowStyles:{fillColor:[240,253,244]},columnStyles:{0:{fontStyle:'bold',cellWidth:24},1:{cellWidth:14,halign:'center'},2:{cellWidth:18},3:{cellWidth:16},4:{cellWidth:30},5:{cellWidth:12,halign:'center'},6:{cellWidth:10,halign:'center'},7:{cellWidth:'auto'}},didParseCell:function(d){if(d.section==='body'&&d.column.index===3){var s=d.cell.raw;if(s==='Fail')d.cell.styles.textColor=[180,30,30];else if(s==='Vegetation')d.cell.styles.textColor=[21,128,61];else if(s==='No Access')d.cell.styles.textColor=[100,100,100];}},margin:{left:14,right:14}});
  var wp=us.filter(function(u){return u.beforePhoto||u.afterPhoto;});
  if(wp.length){doc.addPage();doc.setFontSize(14);doc.setFont(undefined,'bold');doc.setTextColor(0);doc.text('Photos',14,20);var py=28;var imgW=(pw-14-14-6)/2;var imgH=imgW*0.65;wp.forEach(function(u){if(py+imgH+14>doc.internal.pageSize.getHeight()-14){doc.addPage();py=20;}doc.setFontSize(10);doc.setFont(undefined,'bold');doc.text(u.epcor+(u.asap?' · ASAP #'+u.asap:''),14,py);doc.setFont(undefined,'normal');py+=5;if(u.beforePhoto){try{doc.addImage(u.beforePhoto,'JPEG',14,py,imgW,imgH);}catch(e){}doc.setFontSize(8);doc.setTextColor(100);doc.text('Before',14,py+imgH+3);doc.setTextColor(0);}if(u.afterPhoto){var ax=14+(u.beforePhoto?imgW+6:0);try{doc.addImage(u.afterPhoto,'JPEG',ax,py,imgW,imgH);}catch(e){}doc.setFontSize(8);doc.setTextColor(100);doc.text('After',ax,py+imgH+3);doc.setTextColor(0);}py+=imgH+10;});}
  doc.save(map.name.replace(/\s+/g,'_')+'_'+date+'.pdf');setTimeout(function(){toast('PDF saved!');},600);
}

// ── PDF — SUPERVISOR ──────────────────────────────────────────────────────────
function exportSupervisorPDF(){
  if(typeof jspdf==='undefined'){toast('PDF not ready, try again');return;}
  var map=db.maps.find(function(m){return m.id===state.mapId;});
  var us=db.units.filter(function(u){return u.mapId===state.mapId;});
  if(!us.length){toast('No units to export');return;}toast('Generating supervisor PDF…');
  var doc=new jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  var date=new Date().toLocaleDateString('en-CA');var pw=doc.internal.pageSize.getWidth();
  var fails=us.filter(function(u){return u.status==='Fail';}).length;
  var veg=us.filter(function(u){return u.status==='Vegetation';}).length;
  var na=us.filter(function(u){return u.status==='No Access';}).length;
  var clean=us.filter(function(u){return u.status==='Clean';}).length;
  var patches=us.reduce(function(a,u){return a+(u.patches||0);},0);
  var incomplete=us.filter(function(u){return isUnitIncomplete(u);}).length;
  var pct=us.length?Math.round(clean/us.length*100):0;
  // Header
  doc.setFillColor(21,128,61);doc.rect(0,0,pw,36,'F');
  doc.setTextColor(255);doc.setFontSize(18);doc.setFont(undefined,'bold');doc.text(map.name+' — Supervisor Summary',14,14);
  doc.setFontSize(9);doc.setFont(undefined,'normal');doc.text(map.location+'  ·  '+map.type+'  ·  Generated: '+date,14,22);
  doc.text('Status: '+map.status,14,29);
  doc.setTextColor(0);var y=46;
  // Key stats box
  doc.setFillColor(245,250,245);doc.rect(14,y,pw-28,32,'F');
  doc.setFontSize(9);doc.setTextColor(80);
  var statCols=[[us.length,'Total units'],[fails,'Fails'],[patches,'Patches'],[veg,'Vegetation'],[na,'No access'],[pct+'%','Clean rate']];
  var cw=(pw-28)/6;
  statCols.forEach(function(s,i){doc.setFontSize(18);doc.setFont(undefined,'bold');if(i===1&&fails>0){doc.setTextColor(180,30,30);}else{doc.setTextColor(21,128,61);}doc.text(String(s[0]),14+cw*i+cw/2,y+14,{align:'center'});doc.setFontSize(7);doc.setFont(undefined,'normal');doc.setTextColor(80);doc.text(s[1],14+cw*i+cw/2,y+24,{align:'center'});});
  doc.setTextColor(0);y+=40;
  if(map.notes){doc.setFontSize(9);doc.setTextColor(80);doc.text('Notes: '+map.notes,14,y);y+=7;doc.setTextColor(0);}
  // Fail breakdown
  if(fails){
    doc.setFontSize(11);doc.setFont(undefined,'bold');doc.text('Fail breakdown',14,y);y+=6;doc.setFont(undefined,'normal');
    FAIL_TYPES.forEach(function(f){var n=us.filter(function(u){return u.failType===f;}).length;if(!n)return;doc.setFontSize(9);doc.text(f+':',16,y);doc.setFont(undefined,'bold');doc.text(String(n),80,y);doc.setFont(undefined,'normal');y+=5;});y+=3;
  }
  // Exceptions — fails and no access only
  var exceptions=us.filter(function(u){return u.status==='Fail'||u.status==='No Access'||u.status==='Vegetation';});
  exceptions.sort(function(a,b){return (a.asap?+a.asap:9999)-(b.asap?+b.asap:9999);});
  if(exceptions.length){
    doc.setFontSize(11);doc.setFont(undefined,'bold');doc.text('Exception list',14,y);y+=6;
    doc.autoTable({startY:y,head:[['EPCOR #','ASAP #','Status','Fail type','Patches','Notes']],body:exceptions.map(function(u){return [u.epcor||'',u.asap||'',u.status,u.failType||'—',u.patches||0,u.notes||''];}),styles:{fontSize:8,cellPadding:2.5,overflow:'linebreak'},headStyles:{fillColor:[21,128,61],textColor:255,fontStyle:'bold',fontSize:8},alternateRowStyles:{fillColor:[248,248,248]},columnStyles:{0:{fontStyle:'bold',cellWidth:28},1:{cellWidth:16,halign:'center'},2:{cellWidth:22},3:{cellWidth:34},4:{cellWidth:14,halign:'center'},5:{cellWidth:'auto'}},didParseCell:function(d){if(d.section==='body'&&d.column.index===2){var s=d.cell.raw;if(s==='Fail')d.cell.styles.textColor=[180,30,30];else if(s==='Vegetation')d.cell.styles.textColor=[21,128,61];else if(s==='No Access')d.cell.styles.textColor=[100,100,100];}},margin:{left:14,right:14}});
    y=doc.lastAutoTable.finalY+6;
  }
  if(incomplete){doc.setFontSize(9);doc.setTextColor(180,120,0);doc.text('* '+incomplete+' unit'+(incomplete>1?'s':'')+' have incomplete data (missing ASAP #, status, or unit type)',14,y);doc.setTextColor(0);}
  doc.save(map.name.replace(/\s+/g,'_')+'_supervisor_'+date+'.pdf');setTimeout(function(){toast('Supervisor PDF saved!');},600);
}

// ── PDF — UNIT ────────────────────────────────────────────────────────────────
function exportUnitPDF(id){
  if(typeof jspdf==='undefined'){toast('PDF not ready, try again');return;}
  var u=db.units.find(function(x){return x.id===id;});var map=db.maps.find(function(m){return m.id===u.mapId;});
  toast('Generating PDF…');
  var doc=new jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  var date=new Date().toLocaleDateString('en-CA');var pw=doc.internal.pageSize.getWidth();
  doc.setFillColor(21,128,61);doc.rect(0,0,pw,30,'F');doc.setTextColor(255);doc.setFontSize(18);doc.setFont(undefined,'bold');doc.text(u.epcor,14,13);doc.setFontSize(9);doc.setFont(undefined,'normal');doc.text(map.name+'  ·  '+map.location+'  ·  '+date,14,22);doc.setTextColor(0);var y=38;
  function row(label,value,color){doc.setFontSize(9);doc.setTextColor(120);doc.text(label,14,y);if(color)doc.setTextColor(color[0],color[1],color[2]);else doc.setTextColor(0);doc.setFont(undefined,'bold');doc.text(String(value||'—'),70,y);doc.setFont(undefined,'normal');y+=7;}
  row('ASAP #',u.asap||'—');row('Unit type',u.unitType||'—');row('Status',u.status,u.status==='Fail'?[180,30,30]:null);
  if(u.fins)row('Fins','Yes');if(u.status==='Fail'){row('Fail type',u.failType||'—');row('Patches',u.patches||0);}
  if(u.lat)row('GPS',u.lat.toFixed(6)+', '+u.lng.toFixed(6));
  if(u.notes){y+=2;doc.setFontSize(9);doc.setTextColor(120);doc.text('Notes',14,y);y+=5;doc.setTextColor(0);var lines=doc.splitTextToSize(u.notes,pw-28);doc.text(lines,14,y);y+=lines.length*5+4;}
  if(u.beforePhoto||u.afterPhoto){y+=4;doc.setFontSize(11);doc.setFont(undefined,'bold');doc.text('Photos',14,y);y+=6;doc.setFont(undefined,'normal');var imgW=(pw-14-14-6)/2;var imgH=imgW*0.72;if(u.beforePhoto){try{doc.addImage(u.beforePhoto,'JPEG',14,y,imgW,imgH);}catch(e){}doc.setFontSize(8);doc.setTextColor(100);doc.text('Before',14,y+imgH+3);}if(u.afterPhoto){var ax=14+(u.beforePhoto?imgW+6:0);try{doc.addImage(u.afterPhoto,'JPEG',ax,y,imgW,imgH);}catch(e){}doc.setFontSize(8);doc.setTextColor(100);doc.text('After',ax,y+imgH+3);}}
  doc.save(u.epcor.replace(/\s+/g,'_')+'_'+date+'.pdf');setTimeout(function(){toast('PDF saved!');},600);
}

// ── BACKUP ────────────────────────────────────────────────────────────────────
function exportBackup(){var blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='utilitylog_'+new Date().toLocaleDateString('en-CA')+'.json';a.click();URL.revokeObjectURL(url);toast('Backup exported!');}
function importBackup(e){var file=e.target.files[0];if(!file)return;var r=new FileReader();r.onload=function(ev){try{var p=JSON.parse(ev.target.result);if(p.maps&&p.units){if(!confirm('Replace all current data with this backup?'))return;if(!p.trash)p.trash=[];db=p;idbSave();showMaps();toast('Backup imported!');}else toast('Invalid backup file');}catch(err){toast('Could not read file');}};r.readAsText(file);e.target.value='';}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function openModal(html){$('modalBox').innerHTML='<div class="modal-handle"></div>'+html;$('overlay').classList.add('open');}
function closeModal(){$('overlay').classList.remove('open');patchCount=0;formGPS=null;}
function closeModalOutside(e){
  if(e.target===$('overlay')){
    // Save as draft if form was open
    var epcor=val('uEpcor');
    if(epcor&&epcor.trim()&&formState.mode==='new'){saveDraft();}
    closeModal();
  }
}

if('serviceWorker'in navigator){navigator.serviceWorker.register('sw.js').catch(function(){});}
openIDB(function(){idbGet(function(){if(!restoreFormIfNeeded())showMaps();});});

// ── EXTRAS ────────────────────────────────────────────────────────────────────
function removeDraftAndClose(){
  // called from form discard button — need to find the draft being edited
  // since we removed it from the list when resuming, just close
  clearDraft();closeModal();renderUnits();
}
