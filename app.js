// ── DB ──────────────────────────────────────────────────────────────────────
var DB_NAME='utilityInspect', DB_VER=1, STORE='data';
var idb=null;
var db={maps:[],units:[]};
var state={screen:'maps',mapId:null,unitId:null,filter:'All'};
var patchCount=0;

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

function statusBadge(s){
  var m={Fail:'b-fail','Door Fail':'b-door',Vegetation:'b-veg','No Access':'b-na',Clean:'b-clean'};
  return '<span class="badge '+(m[s]||'b-clean')+'">'+s+'</span>';
}
function typeBadge(t){
  return t==='Pedestal'
    ?'<span class="badge b-ped">Pedestal</span>'
    :'<span class="badge b-trans">Transformer</span>';
}

// ── NAVIGATION ───────────────────────────────────────────────────────────────
function setScreen(name){
  document.querySelectorAll('.screen').forEach(function(s){s.classList.remove('active');});
  $('screen'+cap(name)).classList.add('active');
  state.screen=name;
  $('mainContent').scrollTop=0;
}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}

function goBack(){
  if(state.screen==='unit') showUnits(state.mapId);
  else showMaps();
}

function fabAction(){
  if(state.screen==='maps') showNewMapModal();
  else if(state.screen==='units') showNewUnitModal();
}

// ── MAPS SCREEN ──────────────────────────────────────────────────────────────
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
    return '<div class="card" onclick="showUnits(\''+m.id+'\')">'
      +'<div class="card-row"><span class="card-title">'+esc(m.name)+'</span>'+typeBadge(m.type||'Pedestal')+'</div>'
      +'<div class="card-sub">'+esc(m.location)+(date?' · '+date:'')+'</div>'
      +'<div style="display:flex;gap:14px;margin-top:10px">'
      +'<span style="font-size:12px;color:var(--text2)">'+us.length+' units</span>'
      +(fails?'<span style="font-size:12px;color:var(--danger-text)">'+fails+' fail'+(fails>1?'s':'')+'</span>':'')
      +(vegs?'<span style="font-size:12px;color:var(--success-text)">'+vegs+' veg</span>':'')
      +(patches?'<span style="font-size:12px;color:var(--text2)">'+patches+' patch'+(patches>1?'es':'')+'</span>':'')
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
      +'<p style="font-size:13px;margin-top:6px">Tap + to add your first map</p></div>'
      +dataHtml;
    return;
  }
  c.innerHTML=mapsHtml+dataHtml;
}

// ── UNITS SCREEN ─────────────────────────────────────────────────────────────
function showUnits(mapId){
  state.mapId=mapId;state.filter='All';
  var map=db.maps.find(function(m){return m.id===mapId;});
  $('topTitle').textContent=esc(map.name);
  $('backWrap').style.display='';
  $('topActs').innerHTML=
    '<button class="btn btn-sm" onclick="showSummary()">Summary</button>'
    +'<button class="btn btn-sm" onclick="exportPDF()">PDF</button>';
  renderFilterBar();
  $('filterRow').classList.add('visible');
  $('fab').style.display='flex';
  renderUnits();setScreen('units');
}

function renderFilterBar(){
  var filters=['All','Fail','Door Fail','Vegetation','No Access','Clean'];
  $('filterBar').innerHTML=filters.map(function(f){
    return '<button class="chip'+(state.filter===f?' active':'')+'" onclick="setFilter(\''+f+'\')">'+f+'</button>';
  }).join('');
}
function setFilter(f){state.filter=f;renderFilterBar();renderUnits();}

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
    return '<div class="card" onclick="showUnit(\''+u.id+'\')">'
      +'<div class="card-row"><span class="card-title">'+esc(u.epcor)+'</span>'+statusBadge(u.status)+'</div>'
      +'<div style="display:flex;align-items:center;gap:8px;margin-top:5px;flex-wrap:wrap">'
      +(u.asap?'<span class="card-sub">ASAP #'+esc(u.asap)+'</span>':'')
      +(u.failType?'<span class="card-sub">· '+esc(u.failType)+'</span>':'')
      +(u.patches?'<span class="card-sub">· '+u.patches+' patch'+(u.patches>1?'es':'')+'</span>':'')
      +(u.beforePhoto?'<span class="card-sub">· 📷 before</span>':'')
      +(u.afterPhoto?'<span class="card-sub">· 📷 after</span>':'')
      +'</div></div>';
  }).join('');
}

// ── UNIT DETAIL ──────────────────────────────────────────────────────────────
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
      +'<span style="font-size:18px;font-weight:700">'+(u.patches||0)+'</span></div>';
  }
  if(u.status==='Vegetation'){
    html+='<div style="padding:10px 0;font-size:14px;color:var(--text2)">Vegetation noted — no patch required.</div>';
  }
  if(u.status==='No Access'){
    html+='<div style="padding:10px 0;font-size:14px;color:var(--text2)">Unit not accessible during inspection.</div>';
  }

  html+='<div class="section-lbl">Photos</div><div class="photo-grid">';
  html+=photoSlot(u,'before','Before');
  if(isFail||u.status==='Vegetation') html+=photoSlot(u,'after',isFail?'After patch':'Vegetation');
  html+='</div>';

  if(u.notes){
    html+='<div class="section-lbl">Notes</div>'
      +'<div style="font-size:14px;line-height:1.65;color:var(--text2)">'+esc(u.notes)+'</div>';
  }

  html+='<div style="margin-top:22px;padding-bottom:20px">'
    +'<button class="btn btn-danger" style="width:100%" onclick="deleteUnit(\''+u.id+'\')">Delete unit</button></div>';
  $('screenUnit').innerHTML=html;
}

function photoSlot(u,key,label){
  var p=u[key+'Photo'];
  if(p) return '<div class="photo-slot" onclick="viewPhoto(\''+u.id+'\',\''+key+'\')">'
    +'<img src="'+p+'" alt="'+label+'">'
    +'<span style="position:absolute;bottom:5px;left:7px;background:rgba(0,0,0,0.55);color:#fff;'
    +'padding:2px 7px;border-radius:5px;font-size:10px;font-weight:600;z-index:1">'+label+'</span></div>';
  return '<div class="photo-slot" onclick="attachPhoto(\''+u.id+'\',\''+key+'\')">'
    +'<span class="p-ico">+</span><span class="p-lbl">'+label+'</span></div>';
}

function attachPhoto(unitId,key){
  var inp=document.createElement('input');
  inp.type='file';inp.accept='image/*';inp.capture='environment';
  inp.onchange=function(){
    var file=inp.files[0];if(!file)return;
    var r=new FileReader();
    r.onload=function(e){
      var u=db.units.find(function(x){return x.id===unitId;});
      u[key+'Photo']=e.target.result;
      idbSave();
      renderUnitDetail(db.units.find(function(x){return x.id===state.unitId;}));
      toast('Photo saved');
    };r.readAsDataURL(file);
  };inp.click();
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

// ── MODALS ───────────────────────────────────────────────────────────────────
function openModal(html){
  $('modalBox').innerHTML='<div class="modal-handle"></div>'+html;
  $('overlay').classList.add('open');
}
function closeModal(){$('overlay').classList.remove('open');patchCount=0;}
function closeModalOutside(e){if(e.target===$('overlay'))closeModal();}

// ── NEW MAP ──────────────────────────────────────────────────────────────────
function showNewMapModal(){
  openModal('<p class="modal-title">New map</p>'
    +'<div class="form-group"><label class="form-label">Map name</label>'
    +'<input id="mName" placeholder="e.g. Sakaw West" autocomplete="off"/></div>'
    +'<div class="form-group"><label class="form-label">Location / area</label>'
    +'<input id="mLoc" placeholder="e.g. Edmonton NE" autocomplete="off"/></div>'
    +'<div class="form-group"><label class="form-label">Primary unit type</label>'
    +'<div class="seg" id="mTypeSeg">'
    +'<button class="active" onclick="segSel(\'mTypeSeg\',this)">Pedestal</button>'
    +'<button onclick="segSel(\'mTypeSeg\',this)">Transformer</button>'
    +'<button onclick="segSel(\'mTypeSeg\',this)">Mixed</button>'
    +'</div></div>'
    +'<button class="btn btn-primary" style="width:100%;padding:13px;font-size:15px" onclick="createMap()">Create map</button>');
  setTimeout(function(){var el=$('mName');if(el)el.focus();},100);
}
function createMap(){
  var name=$('mName').value.trim();if(!name)return;
  db.maps.push({id:uid(),name:name,location:$('mLoc').value.trim(),
    type:qs('#mTypeSeg .active').textContent,createdAt:Date.now()});
  idbSave();closeModal();renderMaps();toast('Map created');
}

// ── NEW / EDIT UNIT ──────────────────────────────────────────────────────────
function unitFormHTML(u){
  var isEdit=!!u;
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
    +'<div class="form-group"><label class="form-label">Notes</label>'
    +'<textarea id="uNotes" rows="2" placeholder="Optional notes...">'+(u?esc(u.notes||''):'')+'</textarea></div>';
}

function showNewUnitModal(){
  patchCount=0;
  openModal('<p class="modal-title">Add unit</p>'+unitFormHTML(null)
    +'<button class="btn btn-primary" style="width:100%;padding:13px;font-size:15px;margin-top:4px" onclick="createUnit()">Add unit</button>');
  setTimeout(function(){var el=$('uEpcor');if(el)el.focus();},100);
}
function adjP(d){patchCount=Math.max(0,patchCount+d);$('pNum').textContent=patchCount;}
function chkFail(){
  var s=qs('#uStatSeg .active').textContent;
  $('failFields').style.display=(s==='Fail'||s==='Door Fail')?'block':'none';
}
function createUnit(){
  var epcor=$('uEpcor').value.trim();if(!epcor)return;
  var status=qs('#uStatSeg .active').textContent;
  var isFail=status==='Fail'||status==='Door Fail';
  db.units.push({id:uid(),mapId:state.mapId,epcor:epcor,
    asap:$('uAsap').value.trim(),
    unitType:qs('#uTypeSeg .active').textContent,
    utility:qs('#uColSeg .active').textContent,
    status:status,
    failType:isFail?$('uFailType').value:'',
    patches:isFail?patchCount:0,
    notes:$('uNotes').value.trim(),
    createdAt:Date.now()});
  patchCount=0;idbSave();closeModal();renderUnits();toast('Unit added');
}

function editUnit(id){
  var u=db.units.find(function(x){return x.id===id;});
  patchCount=u.patches||0;
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
  patchCount=0;idbSave();closeModal();
  $('topTitle').textContent=esc(u.epcor);
  renderUnitDetail(u);toast('Saved');
}
function deleteUnit(id){
  if(!confirm('Delete this unit? This cannot be undone.'))return;
  db.units=db.units.filter(function(u){return u.id!==id;});
  idbSave();goBack();toast('Unit deleted');
}

// ── SUMMARY ──────────────────────────────────────────────────────────────────
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
    +sm(us.length,'Total units')+sm(fails+door,'Fails')+sm(patches,'Patches')
    +sm(veg,'Vegetation')+sm(na,'No access')+sm(clean,'Clean')
    +'</div>';
  if(fails||door){
    html+='<div class="section-lbl">Fail breakdown</div>'
      +'<div style="font-size:14px;line-height:2.2">'
      +(ru?'Rust Holes (Unit): <strong>'+ru+'</strong><br>':'')
      +(rd?'Rust Holes (Door): <strong>'+rd+'</strong><br>':'')
      +(oil?'Oil Leak: <strong>'+oil+'</strong><br>':'')
      +'</div>';
  }
  html+='<button class="btn" style="width:100%;margin-top:16px;padding:12px" onclick="closeModal()">Close</button>';
  openModal(html);
}

// ── PDF EXPORT ───────────────────────────────────────────────────────────────
function exportPDF(){
  if(typeof jspdf==='undefined'){toast('PDF library loading, try again');return;}
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

  doc.setFontSize(20);doc.setFont(undefined,'bold');
  doc.text(map.name,14,20);
  doc.setFontSize(10);doc.setFont(undefined,'normal');doc.setTextColor(100);
  doc.text(map.location+'  ·  '+map.type+'  ·  Generated: '+date,14,27);
  doc.setTextColor(0);
  doc.setFontSize(10);
  doc.text('Total: '+us.length+'   Fails: '+fails+'   Patches: '+patches+'   Vegetation: '+veg,14,34);

  var rows=us.map(function(u){
    return [u.epcor||'',u.asap||'',u.unitType||'',u.status,u.failType||'—',u.patches||0,u.notes||''];
  });

  doc.autoTable({
    startY:40,
    head:[['EPCOR #','ASAP #','Type','Status','Fail type','Patches','Notes']],
    body:rows,
    styles:{fontSize:9,cellPadding:3,overflow:'linebreak'},
    headStyles:{fillColor:[17,17,17],textColor:255,fontStyle:'bold',fontSize:9},
    alternateRowStyles:{fillColor:[248,248,246]},
    columnStyles:{
      0:{fontStyle:'bold',cellWidth:28},
      1:{cellWidth:18,halign:'center'},
      2:{cellWidth:22},
      3:{cellWidth:22},
      4:{cellWidth:32},
      5:{cellWidth:16,halign:'center'},
      6:{cellWidth:'auto'}
    },
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

  var fname=map.name.replace(/\s+/g,'_')+'_'+date+'.pdf';
  doc.save(fname);
  setTimeout(function(){toast('PDF saved!');},500);
}

// ── BACKUP ───────────────────────────────────────────────────────────────────
function exportBackup(){
  var payload={maps:db.maps,units:db.units.map(function(u){
    var copy=Object.assign({},u);
    delete copy.beforePhoto;delete copy.afterPhoto;
    return copy;
  })};
  var full=JSON.stringify({maps:db.maps,units:db.units},null,2);
  var blob=new Blob([full],{type:'application/json'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;a.download='utilitylog_backup_'+new Date().toLocaleDateString('en-CA')+'.json';
  a.click();URL.revokeObjectURL(url);
  toast('Backup exported!');
}
function importBackup(e){
  var file=e.target.files[0];if(!file)return;
  var r=new FileReader();
  r.onload=function(ev){
    try{
      var parsed=JSON.parse(ev.target.result);
      if(parsed.maps&&parsed.units){
        if(!confirm('This will replace all current data. Continue?'))return;
        db=parsed;idbSave();showMaps();toast('Backup imported!');
      }else{toast('Invalid backup file');}
    }catch(err){toast('Could not read file');}
  };r.readAsText(file);
  e.target.value='';
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
function esc(s){
  if(!s)return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function segSel(gid,btn){
  document.querySelectorAll('#'+gid+' button').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
}

// ── SERVICE WORKER ────────────────────────────────────────────────────────────
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(function(){});
}

// ── INIT ─────────────────────────────────────────────────────────────────────
var pdfScript=document.createElement('script');
pdfScript.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
document.head.appendChild(pdfScript);
var autoTableScript=document.createElement('script');
autoTableScript.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.6.0/jspdf.plugin.autotable.min.js';
document.head.appendChild(autoTableScript);

openIDB(function(){idbGet(function(){showMaps();});});
