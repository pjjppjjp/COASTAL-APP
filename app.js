import { generatePlan, polygonArea, toGeoJSON, toCSV } from './planner.js';
import { PRESET_SITES, geocode } from './geocoder.js';
import { motionAllowed, animateNumber, pressFeedback, introSequence, morphDialog, dismissDialog, springIn } from './motion.js';

// COASTAL: real geometry, explicit assumptions, no invented habitat assessment.
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const fmt = (value, digits = 0) => new Intl.NumberFormat('en-US', {maximumFractionDigits:digits}).format(value);
const money = value => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(value);
const clone = value => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const coordinateText = ([lat,lng]) => `${Math.abs(lat).toFixed(5)}° ${lat < 0 ? 'S' : 'N'} · ${Math.abs(lng).toFixed(5)}° ${lng < 0 ? 'W' : 'E'}`;
const SPECIES = [
  {id:'ovalis',short:'Spoon',name:'Spoon seagrass',latin:'Halophila ovalis',descriptor:'Small, paired paddle leaves',note:'An early-colonising seagrass with paired oval leaves, found in intertidal and subtidal habitats. Verify identification, local occurrence and donor suitability before planning a transplant.'},
  {id:'uninervis',short:'Narrowleaf',name:'Narrowleaf seagrass',latin:'Halodule uninervis',descriptor:'Slender blades with three-pointed tips',note:'A ribbon-leaved species found in shallow sandy and muddy habitats. Leaf tips have three teeth. Confirm local donor populations and conditions with a field survey.'},
  {id:'pinifolia',short:'Fineleaf',name:'Fineleaf seagrass',latin:'Halodule pinifolia',descriptor:'Very fine ribbons with rounded tips',note:'A fine ribbon-leaved species with rounded or slightly serrated leaf tips, often found on intertidal sandbanks. Confirm identification and site suitability locally.'}
];
const PATTERNS = [
  {id:'staggered',name:'Staggered',description:'Suggested start: offset rows spread structures evenly.'},
  {id:'grid',name:'Grid',description:'Straight rows for easy measuring and repeat monitoring.'},
  {id:'clusters',name:'Patches',description:'Groups of four, with open gaps between groups.'}
];
const DEFAULTS = {
  center:[12.5880,100.9560],areaM2:400,spacingM:2,pattern:'staggered',rotationDeg:0,boundary:null,
  unitCost:6,sparePercent:10,footprintM:.3,species:'ovalis',
  location:{name:'Samae San coast',detail:'Chonburi, Thailand',source:'Illustrative offshore planning pin · unassessed'}
};
const DRAFT_KEY = 'coastal-plan-draft-v1';
const SAVED_KEY = 'coastal-saved-plans-v1';
let storageUnavailable = false;
function readStorage(key, fallback) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { storageUnavailable = true; return fallback; } }
function writeStorage(key, value) { try { localStorage.setItem(key,JSON.stringify(value)); return true; } catch { storageUnavailable = true; return false; } }
function validateState(next) {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return false;
  if (!Object.keys(DEFAULTS).every(key => next[key] !== undefined)) return false;
  if (!Array.isArray(next.center) || next.center.length !== 2 || !SPECIES.some(s => s.id === next.species)) return false;
  if (typeof next.location?.name !== 'string' || next.location.name.length > 150 || typeof next.location?.detail !== 'string') return false;
  for (const [key,min,max] of [['spacingM',.5,5],['rotationDeg',0,175],['unitCost',0,10000],['sparePercent',0,100],['footprintM',.1,2],['areaM2',next.boundary ? 1 : 25,next.boundary ? 100000 : 10000]]) {
    if (typeof next[key] !== 'number' || !Number.isFinite(next[key]) || next[key] < min || next[key] > max) return false;
  }
  try { generatePlan(next); return true; } catch { return false; }
}
const stored = readStorage(DRAFT_KEY,null);
let state = validateState(stored) ? stored : clone(DEFAULTS);
let committedState = clone(state);
const storedPlans = readStorage(SAVED_KEY,[]);
let savedPlans = (Array.isArray(storedPlans) ? storedPlans : []).filter(p => typeof p?.id === 'string' && validateState(p.state)).slice(0,50);
let plan, calcTimer, toastTimer, searchController, searchSequence = 0;
let mode = 'explore', drawingPoints = [], layoutMode = false, mapErrors = 0;
let boundaryLayer, centerMarker, modalOrigin;
const species = () => SPECIES.find(s => s.id === state.species);
const pattern = () => PATTERNS.find(p => p.id === state.pattern);

function speciesArt(type) {
  const leaves = type === 'ovalis'
    ? '<path d="M29 55V20m0 21-10-8m10-3 10-8m-10 4-7-8" stroke="#718e4e" stroke-width="1.8" fill="none"/><ellipse cx="17" cy="31" rx="5.3" ry="9" transform="rotate(-42 17 31)" fill="#9bbd63"/><ellipse cx="41" cy="20" rx="5.5" ry="9" transform="rotate(38 41 20)" fill="#87b25c"/><ellipse cx="21" cy="16" rx="4" ry="7" transform="rotate(-30 21 16)" fill="#b1ca78"/><path d="m29 53-10 4m10-4 11 4" stroke="#ac9e70" stroke-width="1.5"/>'
    : type === 'uninervis'
      ? '<path d="M29 56C13 43 16 21 10 9c10 9 11 34 19 44C24 28 34 18 33 4c6 19-3 34-2 49C40 37 42 20 51 14c-8 17-5 29-20 42Z" fill="#8eaf5e"/><path d="M29 55c-1-21-5-33-8-42 8 14 10 27 10 42" fill="#bdd184"/>'
      : '<path d="M29 56C18 36 22 17 15 5c9 12 6 32 16 49C27 33 34 15 31 3c6 15-1 33 1 52C37 38 36 22 47 9c-9 18-4 34-15 47Z" fill="#9bbd6c"/><path d="M30 55C17 45 15 32 11 23m20 32c12-10 16-17 18-29" fill="none" stroke="#75995b" stroke-width="1.6"/>';
  return `<svg class="species-art" viewBox="0 0 60 64" aria-hidden="true"><ellipse cx="30" cy="58" rx="14" ry="2.4" fill="#4d785b" opacity=".1"/>${leaves}</svg>`;
}
function patternArt(type) {
  let dots = '';
  for (let row=0;row<3;row++) for(let col=0;col<5;col++) {
    if (type==='clusters' && (row===1 || col===2)) continue;
    dots += `<circle cx="${5+col*8+(type==='staggered' && row%2 ? 3 : 0)}" cy="${4+row*8}" r="1.8" fill="currentColor"/>`;
  }
  return `<svg viewBox="0 0 43 25" aria-hidden="true">${dots}</svg>`;
}
$('speciesChoices').innerHTML = SPECIES.map(s=>`<button class="species-card" data-species="${s.id}" aria-pressed="false" title="${s.latin}"><span class="species-tick">${icon('check')}</span>${speciesArt(s.id)}<span class="species-name">${s.short}</span></button>`).join('');
$('patternChoices').innerHTML = PATTERNS.map(p=>`<button class="pattern-card" data-pattern="${p.id}" aria-pressed="false">${patternArt(p.id)}<span>${p.name}</span></button>`).join('');
$('quickLocations').innerHTML = PRESET_SITES.slice(0,3).map(s=>`<button data-site="${s.id}">${icon('pin')}${s.name}</button>`).join('');

const map = L.map('map',{zoomControl:false,attributionControl:true,minZoom:3,maxZoom:22,preferCanvas:true,worldCopyJump:true}).setView(state.center,16);
map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxNativeZoom:19,maxZoom:22,updateWhenIdle:true,updateWhenZooming:false,keepBuffer:1,
  attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
}).addTo(map);
tiles.on('tileerror',()=>{ if(++mapErrors>=3 && !layoutMode) $('mapNetworkNote').hidden=false; });
tiles.on('tileload',()=>{ mapErrors=0; $('mapNetworkNote').hidden=true; });
L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
map.createPane('plantingPoints').style.zIndex = '450';
const pointRenderer = L.canvas({pane:'plantingPoints',padding:.2});
const pointLayer = L.layerGroup().addTo(map);
const drawingLayer = L.layerGroup().addTo(map);
const MeasuredLayer = L.GridLayer.extend({createTile() {
  const tile = document.createElement('canvas'); const size=this.getTileSize(); tile.width=size.x;tile.height=size.y;
  const ctx=tile.getContext('2d'); ctx.fillStyle='#e6f0ed';ctx.fillRect(0,0,size.x,size.y);ctx.strokeStyle='#c7ddd633';ctx.lineWidth=1;
  for(let i=0;i<=size.x;i+=32){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,size.y);ctx.stroke();}
  for(let i=0;i<=size.y;i+=32){ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(size.x,i);ctx.stroke();}
  return tile;
}});
const measuredLayer = new MeasuredLayer({attribution:'Measured layout · local projection · not a surveyed site',maxZoom:22});

function notify(message, action) {
  clearTimeout(toastTimer); let toast=$('toast');
  if($('modal').open){toast=$('modalNotice');if(!toast){toast=document.createElement('div');toast.id='modalNotice';toast.className='modal-inline-note';toast.setAttribute('role','status');document.querySelector('.modal-top').append(toast);}}
  toast.textContent=message;
  if(action){ const button=document.createElement('button');button.textContent=action.label;button.addEventListener('click',()=>{action.run();toast.hidden=true;},{once:true});toast.append(button); }
  toast.hidden=false; springIn(toast,{distance:12,scale:.98,duration:400});toastTimer=setTimeout(()=>{toast.hidden=true;},action?7000:4800);
}
function setRangeFill(input) { const value=(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100;input.style.background=`linear-gradient(to right,#009c98 ${value}%,#dce9e3 ${value}%)`; }
function syncControls() {
  $('placeName').textContent=state.location.name; $('placeDetail').textContent=state.location.detail;
  $('speciesLatin').textContent=species().latin; $('speciesDescriptor').textContent=species().descriptor;
  for(const button of document.querySelectorAll('[data-species]')){const selected=button.dataset.species===state.species;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
  for(const button of document.querySelectorAll('[data-pattern]')){const selected=button.dataset.pattern===state.pattern;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
  for(const button of document.querySelectorAll('[data-area]')){const selected=!state.boundary && Number(button.dataset.area)===state.areaM2;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
  $('areaInput').value=Math.round(state.areaM2);$('areaInput').disabled=!!state.boundary;
  $('areaSlider').value=clamp(Math.log(state.areaM2/25)/Math.log(400)*1000,0,1000);$('areaSlider').disabled=!!state.boundary;
  $('areaDimensions').textContent=state.boundary?'Custom boundary':`${fmt(Math.sqrt(state.areaM2),1)} × ${fmt(Math.sqrt(state.areaM2),1)} m`;
  $('clearBoundary').hidden=!state.boundary; $('areaHelper').textContent=state.boundary?'Area is calculated from your boundary. Draw again to change it.':'The footprint for your structures. Growth is not predicted.';
  $('patternDescription').textContent=pattern().description;
  $('spacingSlider').value=state.spacingM;$('spacingOutput').textContent=state.spacingM.toFixed(1)+' m';
  $('rotationSlider').value=state.rotationDeg;$('rotationOutput').textContent=state.rotationDeg+'°';
  $('unitCost').value=state.unitCost;$('sparePercent').value=state.sparePercent;$('footprintInput').value=state.footprintM;
  for(const input of document.querySelectorAll('input[type=range]'))setRangeFill(input);
}
function renderResults() {
  animateNumber($('structureCount'),plan.count,{format:v=>fmt(Math.round(v))});
  animateNumber($('areaCounter'),plan.areaM2,{format:v=>fmt(Math.round(v))});
  animateNumber($('spacingCounter'),plan.spacingM,{format:v=>v.toFixed(1)});
  animateNumber($('estimateCost'),plan.materialCost,{format:money});
  $('resultSubtitle').textContent=`${species().name} · ${pattern().name} layout`;
  $('sparesNote').textContent=`materials incl. ${plan.spareCount} spares (${fmt(state.sparePercent)}%)`;
  $('plotHintArea').textContent=fmt(plan.areaM2)+' m²';$('mapCoordinates').textContent=coordinateText(plan.center);
  const notes=[];
  if(plan.count>1800)notes.push(`Map displays a sample of ${fmt(plan.count)} positions. Exports include every position.`);
  if(!plan.count)notes.push('This layout produces no positions. Try another layout, spacing, or area.');
  if(state.footprintM>state.spacingM)notes.push('Clearance envelopes overlap: increase spacing or reduce the clearance diameter.');
  $('renderNote').textContent=notes.join(' ');$('renderNote').hidden=!notes.length;
}
function renderMap() {
  if(!plan)return;
  if(boundaryLayer)boundaryLayer.setLatLngs(plan.boundary);
  else boundaryLayer=L.polygon(plan.boundary,{color:'#008c87',weight:2,dashArray:'6 5',fillColor:'#40c8ad',fillOpacity:.16,className:'planting-boundary',interactive:false}).addTo(map);
  pointLayer.clearLayers();
  const metersPerPixel=156543.03392*Math.cos(plan.center[0]*Math.PI/180)/2**map.getZoom();
  const radius=clamp(plan.spacingM/metersPerPixel*.15,1.2,4);
  const stride=Math.max(1,Math.ceil(plan.count/1800));
  for(let i=0;i<plan.count;i+=stride){const p=plan.points[i];L.circleMarker([p.lat,p.lng],{radius,color:'#007b75',weight:.6,fillColor:'#16b494',fillOpacity:.9,renderer:pointRenderer}).bindPopup(`<b>${escapeHTML(p.id)}</b><br><i>${species().latin}</i><br>${coordinateText([p.lat,p.lng])}<br><small>Calculated position · field verification required</small>`).addTo(pointLayer);}
  if(centerMarker)centerMarker.remove();
  centerMarker=L.marker(plan.center,{draggable:!state.boundary,keyboard:true,title:'Planting plot. Drag to move a square area.',icon:L.divIcon({className:'plot-center-icon',html:'<span class="plot-pin"></span>',iconSize:[24,24],iconAnchor:[12,12]})}).addTo(map);
  centerMarker.on('dragend',()=>{const p=centerMarker.getLatLng();apply({center:[p.lat,p.lng],location:{name:'Selected coastal point',detail:coordinateText([p.lat,p.lng]),source:'User-positioned map pin · unassessed'}});});
  centerMarker.on('click',()=>{if(mode==='explore')fitPlot();});
  if(map.getZoom()<19)centerMarker.bindTooltip(`<b>${fmt(plan.areaM2)} m² · ${fmt(plan.count)} structures</b><small>Planning footprint · survey needed</small>`,{permanent:true,direction:'right',offset:[15,0],className:'plot-label'}).openTooltip();
}
function calculate() {
  try {
    const next=generatePlan(state);plan=next;state.center=[...next.center];if(state.boundary)state.areaM2=next.areaM2;
    committedState=clone(state);syncControls();renderResults();renderMap();writeStorage(DRAFT_KEY,state);return true;
  } catch(error) {
    state=clone(committedState);plan=generatePlan(state);syncControls();renderResults();renderMap();notify(error.message);return false;
  }
}
function apply(patch,{fit=false,debounce=false}={}) {
  state={...state,...patch};clearTimeout(calcTimer);
  if(debounce){syncControls();calcTimer=setTimeout(calculate,55);return true;}
  if(!calculate())return false;
  if(motionAllowed() && ['pattern','species','areaM2','boundary'].some(key=>key in patch))map.getPane('plantingPoints').animate([{opacity:.25},{opacity:1}],{duration:520,easing:'ease-out'});
  if(fit)fitPlot();return true;
}
function flush() { clearTimeout(calcTimer);return calculate(); }
function fitPlot() {
  if(!plan)return;map.invalidateSize();const {x:w,y:h}=map.getSize();const phone=innerWidth<=620,floating=innerWidth>1100;
  const options={paddingTopLeft:[floating?380:Math.min(w*.12,phone?25:60),Math.min(h*.3,phone?110:175)],paddingBottomRight:[Math.min(w*.2,phone?50:100),Math.min(h*.36,phone?150:280)],maxZoom:22,duration:1.35};
  const bounds=L.latLngBounds(plan.boundary);
  if(motionAllowed())map.flyToBounds(bounds,options);else map.fitBounds(bounds,{...options,animate:false});
}
function moveToPlace(result) {
  if(!apply({center:[result.lat,result.lng],boundary:null,areaM2:clamp(state.areaM2,25,10000),location:{name:result.name,detail:result.detail||'Selected coordinates',source:result.source||'Place search · unassessed'}}))return;
  $('searchInput').value=result.name;$('searchResults').hidden=true;setMode('explore');
  const zoom=/coordinates/i.test(result.source||'')?19:15;
  map.flyTo([result.lat,result.lng],zoom,{animate:motionAllowed(),duration:1.9});
  notify('Location found. Use Place plot to choose the exact planting footprint.');
}
function setMode(next) {
  mode=next;drawingPoints=[];drawingLayer.clearLayers();$('drawToolbar').hidden=next!=='draw';
  $('placePlotButton').classList.toggle('active',next==='place');$('placePlotButton').setAttribute('aria-pressed',String(next==='place'));
  $('drawMapButton').classList.toggle('active',next==='draw');$('drawMapButton').setAttribute('aria-pressed',String(next==='draw'));
  document.querySelector('.map-stage').classList.toggle('placing',next==='place');document.querySelector('.map-stage').classList.toggle('drawing',next==='draw');
  $('mapStatusText').textContent=next==='draw'?'Add corners around your planting area':next==='place'?'Tap the map to place your plot':layoutMode?'Measured layout':'Explore your coastline';
  if(next==='draw')map.doubleClickZoom.disable();else map.doubleClickZoom.enable();updateDrawing();
}
function updateDrawing() {
  drawingLayer.clearLayers();
  if(drawingPoints.length>1)L.polyline(drawingPoints,{color:'#008f88',weight:2,dashArray:'6 5'}).addTo(drawingLayer);
  if(drawingPoints.length>=3)L.polygon(drawingPoints,{color:'#008f88',weight:0,fillOpacity:.12,interactive:false}).addTo(drawingLayer);
  drawingPoints.forEach((point,i)=>L.marker(point,{icon:L.divIcon({className:'boundary-vertex',iconSize:[9,9],iconAnchor:[4.5,4.5]}),interactive:false}).addTo(drawingLayer));
  $('finishDrawing').disabled=drawingPoints.length<3;$('undoCorner').disabled=!drawingPoints.length;
  $('drawInstruction').textContent=drawingPoints.length?`${drawingPoints.length} corners · add more or finish`:'Tap the map to add corners';
}
function finishDrawing() {
  try {
    const area=polygonArea(drawingPoints);if(area<1||area>100000)throw new Error('Draw an area between 1 and 100,000 m². Zoom in for a small planting site.');
    if(apply({boundary:clone(drawingPoints),areaM2:area,location:{name:'Custom planting area',detail:'Drawn boundary · field survey needed',source:'User-drawn boundary · unassessed'}},{fit:true})){setMode('explore');notify('Boundary measured. Your structure positions have been recalculated.');}
  } catch(error){notify(error.message);}
}
map.on('click',event=>{
  const lat=event.latlng.lat,lng=((event.latlng.lng+180)%360+360)%360-180;
  if(mode==='place'){if(apply({center:[lat,lng],boundary:null,areaM2:clamp(state.areaM2,25,10000),location:{name:'Selected coastal point',detail:coordinateText([lat,lng]),source:'User-positioned map pin · unassessed'}}))setMode('explore');}
  else if(mode==='draw'){
    if(drawingPoints.length>=100)return notify('A boundary can contain up to 100 corners.');
    const point=[lat,lng];if(drawingPoints.length && map.distance(point,drawingPoints.at(-1))<.05)return;
    drawingPoints.push(point);updateDrawing();
  }
});
map.on('zoomend',renderMap);

document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();closeDialog();fitPlot();});
$('mapNav').addEventListener('click',()=>{closeDialog();fitPlot();});
$('speciesChoices').addEventListener('click',event=>{const b=event.target.closest('[data-species]');if(b)apply({species:b.dataset.species});});
$('patternChoices').addEventListener('click',event=>{const b=event.target.closest('[data-pattern]');if(b)apply({pattern:b.dataset.pattern});});
document.querySelector('.area-presets').addEventListener('click',event=>{const b=event.target.closest('[data-area]');if(b)apply({areaM2:Number(b.dataset.area),boundary:null},{fit:true});});
$('areaSlider').addEventListener('input',event=>apply({areaM2:Math.round(25*400**(Number(event.target.value)/1000))},{debounce:true}));
$('spacingSlider').addEventListener('input',event=>apply({spacingM:Number(event.target.value)},{debounce:true}));
$('rotationSlider').addEventListener('input',event=>apply({rotationDeg:Number(event.target.value)},{debounce:true}));
for(const [id,key,min,max] of [['areaInput','areaM2',25,10000],['unitCost','unitCost',0,10000],['sparePercent','sparePercent',0,100],['footprintInput','footprintM',.1,2]]) {
  $(id).addEventListener('change',event=>{const text=event.target.value.trim(),value=Number(text);if(!text||!Number.isFinite(value)||value<min||value>max){notify(`Enter a value between ${fmt(min,2)} and ${fmt(max,2)}.`);syncControls();return;}apply({[key]:value},{fit:key==='areaM2'});});
}
$('clearBoundary').addEventListener('click',()=>apply({boundary:null,areaM2:clamp(Math.round(state.areaM2),25,10000)},{fit:true}));
for(const id of ['drawAreaButton','drawMapButton'])$(id).addEventListener('click',()=>setMode(mode==='draw'?'explore':'draw'));
$('placePlotButton').addEventListener('click',()=>setMode(mode==='place'?'explore':'place'));
$('finishDrawing').addEventListener('click',finishDrawing);$('undoCorner').addEventListener('click',()=>{drawingPoints.pop();updateDrawing();});$('cancelDrawing').addEventListener('click',()=>setMode('explore'));
$('zoomIn').addEventListener('click',()=>map.zoomIn());$('zoomOut').addEventListener('click',()=>map.zoomOut());$('fitPlot').addEventListener('click',fitPlot);$('northButton').addEventListener('click',()=>apply({rotationDeg:0}));
$('layerButton').addEventListener('click',()=>{
  layoutMode=!layoutMode;if(layoutMode){tiles.remove();measuredLayer.addTo(map);$('mapNetworkNote').hidden=true;fitPlot();}else{measuredLayer.remove();tiles.addTo(map);map.flyTo(plan.center,16,{animate:motionAllowed(),duration:1.2});}
  $('layerButton').classList.toggle('active',layoutMode);$('layerButton').setAttribute('aria-pressed',String(layoutMode));$('layerButton').setAttribute('aria-label',layoutMode?'Switch to coastline map':'Switch to measured layout view');
  document.querySelector('.leaflet-control-scale').style.display=layoutMode?'block':'';setMode('explore');
});
$('retryMap').addEventListener('click',()=>{mapErrors=0;$('mapNetworkNote').hidden=true;tiles.redraw();});
$('myLocation').addEventListener('click',()=>{
  if(!navigator.geolocation)return notify('Location access is unavailable. Search a place or enter coordinates.');
  const button=$('myLocation');button.disabled=true;
  navigator.geolocation.getCurrentPosition(position=>{button.disabled=false;moveToPlace({lat:position.coords.latitude,lng:position.coords.longitude,name:'Your location',detail:'Device location · choose a coastal footprint',source:'Device coordinates · unassessed'});},()=>{button.disabled=false;notify('Could not get your location. Search a place or enter latitude, longitude.');},{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
});
function focusSearch(){ $('searchInput').focus();$('searchInput').select();springIn(document.querySelector('.map-search'),{distance:0,scale:.98,duration:380}); }
$('locationButton').addEventListener('click',focusSearch);
$('quickLocations').addEventListener('click',event=>{const button=event.target.closest('[data-site]');if(button)moveToPlace(PRESET_SITES.find(s=>s.id===button.dataset.site));});
$('searchForm').addEventListener('submit',async event=>{
  event.preventDefault();const query=$('searchInput').value.trim();if(!query)return focusSearch();
  searchController?.abort();searchController=new AbortController();const sequence=++searchSequence;
  const results=$('searchResults');results.hidden=false;results.innerHTML='<div class="search-message">Finding your coastline…</div>';$('searchSubmit').disabled=true;
  try{
    const locations=await geocode(query,{signal:searchController.signal});if(sequence!==searchSequence)return;
    results.innerHTML=locations.length?locations.map((result,i)=>`<button class="search-result" data-result="${i}">${icon('pin')}<span><b>${escapeHTML(result.name)}</b><small>${escapeHTML(result.detail)}</small></span></button>`).join('')+'<div class="search-credit">Place names: Open-Meteo / GeoNames · not habitat data</div>':'<div class="search-message">No place found. Try a nearby town, one of the coast shortcuts, or latitude, longitude.</div>';
    for(const button of results.querySelectorAll('[data-result]'))button.addEventListener('click',()=>moveToPlace(locations[Number(button.dataset.result)]));
  }catch(error){if(error.name!=='AbortError'&&sequence===searchSequence)results.innerHTML=`<div class="search-message">${escapeHTML(error.message)}</div>`;}
  finally{if(sequence===searchSequence)$('searchSubmit').disabled=false;}
});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.map-search-wrap'))$('searchResults').hidden=true;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('modal').open){$('searchResults').hidden=true;setMode('explore');}});
$('mobileToggle').addEventListener('click',()=>{const panel=document.querySelector('.planner-panel');const collapsed=panel.classList.toggle('collapsed');$('mobileToggle').setAttribute('aria-expanded',String(!collapsed));setTimeout(()=>map.invalidateSize(),320);});
if('ResizeObserver' in window)new ResizeObserver(()=>map.invalidateSize({pan:false})).observe($('map'));

function openModal(eyebrow,html) {
  const dialog=$('modal'),alreadyOpen=dialog.open;$('modalNotice')?.remove();$('modalEyebrow').textContent=eyebrow;$('modalContent').innerHTML=html;
  if(!alreadyOpen){modalOrigin=document.activeElement;dialog.showModal();morphDialog(dialog,modalOrigin);}else{morphDialog(dialog,modalOrigin);springIn($('modalContent'),{distance:12,scale:.99,duration:400});}
  dialog.scrollTop=0;
}
function closeDialog(callback) { const dialog=$('modal');if(!dialog.open){callback?.();return;}dismissDialog(dialog,()=>{dialog.close();callback?.();}); }
$('closeModal').addEventListener('click',()=>closeDialog());$('modal').addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
$('modal').addEventListener('click',event=>{if(event.target!==$('modal'))return;const rect=$('modal').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog();});

function layoutSVG() {
  const latitude=plan.center[0]*Math.PI/180;const convert=([lat,lng])=>[(lng-plan.center[1])*111195.08*Math.cos(latitude),(lat-plan.center[0])*111195.08];
  const boundary=plan.boundary.map(convert);const xs=boundary.map(p=>p[0]),ys=boundary.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const scale=Math.min(440/Math.max(.001,maxX-minX),170/Math.max(.001,maxY-minY));
  const point=([x,y])=>[280+(x-(minX+maxX)/2)*scale,125-(y-(minY+maxY)/2)*scale];
  const path=boundary.map((p,i)=>`${i?'L':'M'}${point(p).map(n=>n.toFixed(2)).join(' ')}`).join(' ')+'Z';
  const stride=Math.max(1,Math.ceil(plan.count/2200));const radius=clamp(plan.spacingM*scale*.14,.7,3.2);let dots='';
  for(let i=0;i<plan.count;i+=stride){const p=plan.points[i],xy=point(convert([p.lat,p.lng]));dots+=`<circle ${plan.count<500?'class="preview-position"':''} cx="${xy[0].toFixed(2)}" cy="${xy[1].toFixed(2)}" r="${radius.toFixed(2)}" fill="#159c82" style="animation-delay:${Math.min(i,60)*6}ms"/>`;}
  return `<div class="layout-preview"><span class="layout-badge">${pattern().name.toUpperCase()} · ${stride>1?'SAMPLED PREVIEW':'CALCULATED POSITIONS'}</span><svg viewBox="0 0 560 245" role="img" aria-label="${escapeHTML(pattern().name)} planting positions within the measured boundary"><defs><pattern id="preview-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" stroke="#cedfd8" stroke-width=".5" fill="none"/></pattern></defs><rect width="560" height="245" fill="url(#preview-grid)"/><path d="${path}" fill="#d2eee2" stroke="#3b9f8b" stroke-width="1.5" stroke-dasharray="5 4"/>${dots}<text x="525" y="35" fill="#4c8d7c" font-size="10" text-anchor="middle">N</text><path d="m525 44-4 11 4-3 4 3Z" fill="#4c8d7c"/><text x="280" y="232" font-size="10" fill="#6d8d81" text-anchor="middle">${fmt(plan.areaM2,1)} m² footprint · ${fmt(plan.spacingM,1)} m centre-to-centre spacing</text></svg></div>`;
}
const SOURCE_LIST = `<ol class="source-list">
  <li><a href="https://doi.org/10.1016/j.marpolbul.2008.09.028" target="_blank" rel="noopener">van Katwijk et al. (2009). Guidelines for seagrass restoration.</a><small>Habitat and donor selection, risk spreading and ecosystem engineering are restoration considerations. A map pin alone cannot establish suitability.</small></li>
  <li><a href="https://doi.org/10.1111/1365-2664.12562" target="_blank" rel="noopener">van Katwijk et al. (2016). Global analysis of seagrass restoration: the importance of large-scale planting.</a><small>Restoration outcomes depend on context and scale. This paper does not validate the app's default 2 m spacing or COASTAL structure performance.</small></li>
  <li><a href="https://doi.org/10.3389/fmars.2021.645673" target="_blank" rel="noopener">Zhang et al. (2021). Seagrass planting arrangements and facilitation.</a><small>Experimental evidence that spatial arrangement can matter in its study system; not a calibration for these Thai species or this apparatus.</small></li>
  <li><a href="https://doi.org/10.3390/jmse11101928" target="_blank" rel="noopener">Titioatchasai et al. (2023). Thai transplanted seagrass meadow monitoring.</a><small>Local monitoring evidence; not a site-suitability layer for this app.</small></li>
  <li><a href="https://www.seagrasswatch.org/idseagrass/" target="_blank" rel="noopener">Seagrass-Watch: species identification.</a><small>Identification guidance for the species choices. Field confirmation is required.</small></li>
</ol>`;
function reportHTML(includeActions=true) {
  const rows=[['Species',species().latin],['Pattern',pattern().name],['Spacing (centre to centre)',fmt(plan.spacingM,2)+' m'],['Row pitch',fmt(plan.rowPitchM,3)+' m'],['Layout rotation',state.rotationDeg+'°'],['Assumed circular clearance diameter',fmt(state.footprintM,2)+' m'],['Minimum centre-to-boundary clearance',fmt(plan.edgeBufferM,2)+' m'],['Structures to place',fmt(plan.count)],['Spare structures',fmt(plan.spareCount)+' ('+fmt(state.sparePercent)+'%)'],['Total structures to order',fmt(plan.orderCount)],['Unit material cost',money(state.unitCost)],['Materials including spares',money(plan.materialCost)],['Positions per 100 m²',fmt(plan.densityPer100M2,1)],['Site assessment','Pending field survey']];
  return `<span class="modal-tag">YOUR NEXT MEADOW · PLANNING ESTIMATE</span><h2>${escapeHTML(state.location.name)}</h2><p class="modal-intro">${escapeHTML(coordinateText(plan.center))}<br>${escapeHTML(species().name)} · ${escapeHTML(pattern().name)} planting layout</p>${layoutSVG()}<div class="report-stats"><div><strong>${fmt(plan.count)}</strong><small>structures to place</small></div><div><strong>${fmt(plan.areaM2)} m²</strong><small>planting footprint</small></div><div><strong>${money(plan.materialCost)}</strong><small>materials + spares</small></div></div><table class="report-table"><tbody>${rows.map(([label,value])=>`<tr><td>${escapeHTML(label)}</td><td>${escapeHTML(value)}</td></tr>`).join('')}</tbody></table><p class="report-note">${plan.count?'Coordinates are calculated layout positions, not surveyed planting instructions.':'This layout produces no positions. A different alignment or pattern may fit; this is not proof that the area cannot be planted.'} Material cost covers structures only. Plants, labour, transport, field surveys and permits are excluded. Coverage means the planting footprint, not predicted seagrass growth.</p>${plan.warnings.length?`<p class="report-note">${plan.warnings.map(escapeHTML).join('<br>')}</p>`:''}${includeActions?`<div class="modal-actions"><button class="action-primary" data-action="save">${icon('save')}Save plan</button><button data-action="csv">${icon('download')}Positions CSV</button><button data-action="geojson">${icon('download')}GeoJSON</button><button data-action="print">Print / PDF</button></div>`:''}`;
}
function reviewPlan(){if(flush())openModal('PLANTING PLAN',reportHTML());}
$('reviewButton').addEventListener('click',reviewPlan);$('exportButton').addEventListener('click',reviewPlan);
function showScience() {
  openModal('THE SCIENCE',`<span class="modal-tag">TRANSPARENT BY DESIGN</span><h2>A calculated layout.<br>A considered next step.</h2><p class="modal-intro">The planner calculates geometry and material quantities. Ecological suitability still needs local evidence.</p><div class="method-cards"><div class="method-card"><b>Grid</b><p>Rows and columns separated by your selected spacing s.</p></div><div class="method-card"><b>Staggered</b><p>Offset rows. Row pitch = s × √3 / 2, with equal nearest-neighbour spacing.</p></div><div class="method-card"><b>Patches</b><p>Complete groups of four. Within-group spacing s; group-centre pitch 3s.</p></div></div><h3>How the numbers are calculated</h3><p class="modal-intro">The app projects a small site onto a local plane, rotates the selected lattice, and counts positions inside the boundary. Every centre must stay at least half the assumed circular clearance diameter from an edge. It does not search every possible lattice alignment or maximise packing.</p><p class="report-note">Order quantity = placed structures + ceil(placed structures × spare percentage / 100).<br>Material estimate = order quantity × unit cost.<br>Default: 400 m², 2 m spacing, 0.30 m circular clearance, 10% spares, US$6/unit → 120 staggered positions, 132 to order, US$792.</p><h3>What the presets mean</h3><p class="modal-intro">Two-metre spacing and 0.30 m clearance are editable demonstration assumptions. US$6 is taken from the supplied COASTAL poster. The species choice changes the plan's identity and guidance; it does not silently change spacing or invent a survival forecast.</p><h3>Before planting</h3><p class="modal-intro">Confirm existing habitat and local species, donor suitability, light and depth, sediment, hydrodynamics, disturbance, permissions and a monitoring plan. Search results are place names, not approved sites. No bathymetry, tide, water-quality or habitat survey is connected.</p><h3>Method limits</h3><p class="modal-intro">The local projection is intended for small sites up to 100,000 m², within ±80° latitude, without crossing the antimeridian. There is a 50,000-position limit. Drawn boundaries must not cross themselves. Large layouts are sampled visually; CSV and GeoJSON contain every generated position.</p><h3>Research and identification</h3>${SOURCE_LIST}<h3>Map and search</h3><p class="modal-intro"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> supplies the base map; <a href="https://open-meteo.com/en/docs/geocoding-api" target="_blank" rel="noopener">Open-Meteo / GeoNames</a> supplies place search. Map clicks are user choices, not habitat assessments. The pale measured view is a generated drafting background.</p><div class="modal-actions"><button data-action="close">Back to your coast ${icon('arrow')}</button></div>`);
}
$('scienceNav').addEventListener('click',showScience);
$('speciesInfo').addEventListener('click',()=>openModal('YOUR SEAGRASS',`<h2>Start with a local species.</h2><p class="modal-intro">Three species choices for the demo. Confirm identification and natural local occurrence before choosing a donor population.</p>${SPECIES.map(s=>`<div class="species-detail">${speciesArt(s.id)}<div><b>${s.name}</b><i>${s.latin}</i><p>${s.note}</p></div></div>`).join('')}<p class="report-note">Descriptions: <a href="https://www.seagrasswatch.org/idseagrass/" target="_blank" rel="noopener">Seagrass-Watch identification guide</a>. Species selection does not imply that the map location is suitable or that 2 m spacing is optimal.</p><div class="modal-actions"><button data-action="close">Choose your species ${icon('arrow')}</button></div>`));
$('helpButton').addEventListener('click',()=>openModal('HOW IT WORKS',`<span class="modal-tag">A SMALL START. A CLEAR PLAN.</span><h2>From coast to planting plan.</h2><p class="modal-intro">A simple way to explore a layout before you head into the field.</p><div class="steps-list">${[['Find your coast','Search a town or island, choose a shortcut, or enter latitude, longitude. Select Place plot, then tap the map.'],['Choose your species','Pick Spoon, Narrowleaf or Fineleaf. Use the information button for identification guidance.'],['Set the footprint','Drag the area slider or draw a boundary. Switch between staggered, grid and patches; quantities update immediately.'],['Take your plan with you','Open View planting plan. Save locally, download every coordinate as CSV or GeoJSON, or print to PDF.']].map(([title,body],i)=>`<div class="help-step"><span>${i+1}</span><div><b>${title}</b><p>${body}</p></div></div>`).join('')}</div><p class="report-note">Use ${icon('fit')} to zoom to the plot, or ${icon('layers')} for the measured layout view. Fine-tune reveals spacing, rotation, unit cost and spares. Saved plans stay in this browser on this device; export a copy to keep or share.</p><div class="modal-actions"><button class="action-primary" data-action="close">Explore your coastline ${icon('arrow')}</button><button data-action="science">Read the methods</button></div>`));
$('projectButton').addEventListener('click',()=>openModal('MEET COASTAL',`<span class="modal-tag">INSPIRED BY MANGROVES</span><h2>Small structure.<br>Lasting possibility.</h2><p class="modal-intro">COASTAL is the Conservation-Oriented Assisted Juvenile Seagrass Transplantation Apparatus for Littoral Restoration through Enhanced Seagrass Establishment, Wave Dissipation, and Sediment Trapping.</p><div class="method-cards"><div class="method-card"><b>Anchor</b><p>A pod-inspired anchor intended to help transplanted seagrass stay in place.</p></div><div class="method-card"><b>Protect</b><p>A root-inspired upper structure intended to dissipate wave energy.</p></div><div class="method-card"><b>Restore</b><p>A tool for planning small restoration trials and monitoring their outcomes.</p></div></div><p class="report-note">The poster below is the project's supplied reference. Its performance and maturity claims are project-reported, not independently verified here, and are not used to predict field outcomes. This app uses the poster's US$6 unit cost only as an editable assumption.</p><img src="coastal-poster.png" class="poster-image" alt="Original COASTAL research poster supplied by the project team" loading="lazy"><div class="modal-actions"><button data-action="science">Read the planning methods ${icon('arrow')}</button></div>`));

function updateSavedCount(){ $('savedCount').textContent=savedPlans.length;$('savedCount').hidden=!savedPlans.length; }
function savePlan() {
  if(!flush())return;if(savedPlans.length>=50)return notify('You have 50 saved plans. Export or remove an older plan first.');
  const entry={id:globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`,createdAt:new Date().toISOString(),state:clone(state),count:plan.count,cost:plan.materialCost};
  const next=[entry,...savedPlans];if(!writeStorage(SAVED_KEY,next))return notify('This browser cannot save locally. Download CSV or GeoJSON to keep your plan.');
  savedPlans=next;updateSavedCount();notify('Plan saved on this device.',{label:'View plans',run:showSaved});
}
function showSaved() {
  const cards=savedPlans.map(entry=>{const s=SPECIES.find(s=>s.id===entry.state.species),p=generatePlan(entry.state);const date=new Date(entry.createdAt);return `<div class="saved-plan"><span class="saved-icon">${icon('leaf')}</span><div class="saved-plan-info"><h3>${escapeHTML(entry.state.location.name)}</h3><p>${escapeHTML(s.name)} · ${fmt(p.areaM2)} m² · ${fmt(p.count)} structures<br>${Number.isNaN(date.valueOf())?'Saved on this device':date.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}</p></div><button class="load-plan" data-load="${escapeHTML(entry.id)}">Open</button><button data-delete="${escapeHTML(entry.id)}" aria-label="Delete ${escapeHTML(entry.state.location.name)}">${icon('trash')}</button></div>`;}).join('');
  openModal('SAVED PLANS',`<h2>Your next meadows.</h2><p class="modal-intro">Saved in this browser, on this device. Export your positions to keep an independent copy.</p>${cards||`<div class="empty-state">${icon('save')}<b>Your first meadow starts here.</b><p>Set up a planting footprint, then save your plan.</p></div>`}<div class="modal-actions"><button data-action="close">Back to the map ${icon('arrow')}</button></div>`);
}
$('savedNav').addEventListener('click',showSaved);$('saveButton').addEventListener('click',savePlan);
function exportPlan(type) {
  if(!flush())return;
  const metadata={site:state.location.name,species:species().latin,createdAt:new Date().toISOString(),status:'Unassessed planning estimate',locationSource:state.location.source||'User input',costCurrency:'USD'};
  const content=type==='geojson'?JSON.stringify(toGeoJSON(plan,metadata),null,2):toCSV(plan,metadata);
  const blob=new Blob([content],{type:type==='geojson'?'application/geo+json':'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`COASTAL-${new Date().toISOString().slice(0,10)}.${type}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);notify(`${type==='csv'?'CSV':'GeoJSON'} prepared with all ${fmt(plan.count)} structure positions.`);
}
function printPlan(){if(!flush())return;$('printReport').innerHTML=`<h1>COASTAL / Planting plan</h1><p>Generated ${escapeHTML(new Date().toLocaleString())} · Planning estimate, pending field survey.</p>${reportHTML(false)}<h3>Methods and sources</h3>${SOURCE_LIST}`;window.print();}
$('modalContent').addEventListener('click',event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;
  if(action==='save')savePlan();else if(action==='csv'||action==='geojson')exportPlan(action);else if(action==='print')printPlan();else if(action==='close')closeDialog();else if(action==='science')showScience();
  const load=event.target.closest('[data-load]')?.dataset.load;
  if(load){const entry=savedPlans.find(p=>p.id===load);if(entry&&validateState(entry.state)){clearTimeout(calcTimer);state=clone(entry.state);if(calculate())closeDialog(()=>{fitPlot();notify('Saved plan loaded.');});}}
  const remove=event.target.closest('[data-delete]')?.dataset.delete;
  if(remove){const original=[...savedPlans],next=savedPlans.filter(p=>p.id!==remove);if(!writeStorage(SAVED_KEY,next))return notify('Could not update saved plans.');savedPlans=next;updateSavedCount();showSaved();notify('Plan removed.',{label:'Undo',run:()=>{if(writeStorage(SAVED_KEY,original)){savedPlans=original;updateSavedCount();if($('modal').open)showSaved();}}});}
});

calculate();updateSavedCount();pressFeedback(document);introSequence(document);
if(storageUnavailable)notify('Local saving is unavailable in this browser. You can still calculate and export plans.');
