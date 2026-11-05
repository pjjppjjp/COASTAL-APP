import {generatePlan, makeRectangle, polygonArea, exportGeoJSON} from './planner.js';
import {searchLocations, COASTAL_LOCATIONS} from './geocoder.js';
import {SPECIES, EVIDENCE, SURVEY_FIELDS, assessSurvey} from './evidence.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n,d=0) => Number(n).toLocaleString('en-US',{maximumFractionDigits:d});
const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2,minimumFractionDigits:0}).format(n);
const clone = data => JSON.parse(JSON.stringify(data));
const STORAGE = {draft:'coastal-draft-v1',plans:'coastal-plans-v1'};
const PATTERNS = {staggered:'Staggered',square:'Grid',clusters:'Clusters'};
const initialState = {version:1,name:'',location:{name:'Samae San',detail:'Chonburi, Thailand · unsurveyed draft',lng:100.96315,lat:12.59126},polygon:makeRectangle([100.96315,12.59126],1000),exclusions:[],speciesId:'ovalis',spacing:1.5,pattern:'staggered',orientation:0,unitCost:6,sparePercent:10,seedlingsPerStructure:1,footprintM2:0.09,coveragePercent:100,survey:{},surveyNotes:'',surveyDepth:'',basemap:'satellite'};
function readStorage(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function writeStorage(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}}
function checkedState(data){
  if(!data || data.version!==1)throw Error('This is not a supported COASTAL plan file.');
  const out=clone(initialState);
  for(const key of ['spacing','orientation','unitCost','sparePercent','seedlingsPerStructure','footprintM2','coveragePercent']){if(typeof data[key]!=='number'||!Number.isFinite(data[key]))throw Error(`The plan has an invalid ${key} setting.`);out[key]=data[key]}
  if(!['staggered','square','clusters'].includes(data.pattern))throw Error('The planting pattern is not supported.');
  out.pattern=data.pattern;
  if(!SPECIES.some(s=>s.id===data.speciesId))throw Error('The plan contains an unsupported seagrass species.');out.speciesId=data.speciesId;
  out.polygon=data.polygon;out.exclusions=data.exclusions||[];
  if(data.location&&typeof data.location.name==='string')out.location={name:data.location.name.slice(0,120),detail:String(data.location.detail||'').slice(0,200),lng:Number(data.location.lng),lat:Number(data.location.lat)};
  out.name=String(data.name||'').slice(0,120);
  for(const f of SURVEY_FIELDS)out.survey[f.id]=['yes','no','unknown'].includes(data.survey?.[f.id])?data.survey[f.id]:'unknown';
  out.surveyNotes=String(data.surveyNotes||'').slice(0,5000);out.surveyDepth=String(data.surveyDepth||'').slice(0,30);
  out.basemap=data.basemap==='map'?'map':'satellite';
  const validated=generatePlan(out);
  const origin=validated.polygon[0][0];
  out.location.lng=lngWrap(validated.polygon.reduce((sum,p)=>sum+origin+lngWrap(p[0]-origin),0)/validated.polygon.length);
  out.location.lat=validated.polygon.reduce((sum,p)=>sum+p[1],0)/validated.polygon.length;
  return out;
}
let state=clone(initialState);
try{const stored=readStorage(STORAGE.draft,null);if(stored)state=checkedState(stored)}catch{}
let plan=null,validPlan=false,updateTimer,toastTimer,searchController,searchGeneration=0;
let savedPlans=readStorage(STORAGE.plans,[]);if(!Array.isArray(savedPlans))savedPlans=[];
let mode=null,drawPoints=[],pendingLocation=null;
let activeGuide='methods';
const icons=()=>window.lucide?.createIcons();

const map=L.map('map',{zoomControl:false,preferCanvas:true,minZoom:3,maxZoom:21,attributionControl:true,doubleClickZoom:true}).setView([state.location.lat,state.location.lng],18);
map.attributionControl.setPrefix(false);
const satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:21,maxNativeZoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics, GIS User Community',crossOrigin:true});
const coastmap=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:21,maxNativeZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',crossOrigin:true});
let basemap=state.basemap==='map'?coastmap:satellite;basemap.addTo(map);
let tileFailures=0;
for(const layer of [satellite,coastmap]){
  layer.on('tileerror',()=>{if(map.hasLayer(layer)&&++tileFailures>=3)$('#map-error').hidden=false});
  layer.on('tileload',()=>{if(map.hasLayer(layer)){tileFailures=0;$('#map-error').hidden=true}});
}
L.control.scale({imperial:false,maxWidth:75,position:'bottomleft'}).addTo(map);
const boundaries=L.layerGroup().addTo(map),positions=L.layerGroup().addTo(map),exclusionLayer=L.layerGroup().addTo(map),drawing=L.layerGroup().addTo(map);
const canvas=L.canvas({padding:.3});
let drawnBoundary,areaTooltip;
function displayLng(lng){const ref=state.polygon[0][0];return ref+lngWrap(lng-ref)}
const ll=coords=>coords.map(([lng,lat])=>[lat,displayLng(lng)]);
function lngWrap(n){return ((n+180)%360+360)%360-180}
function centerOf(poly=state.polygon){const ref=poly[0][0];return [lngWrap(poly.reduce((s,p)=>s+ref+lngWrap(p[0]-ref),0)/poly.length),poly.reduce((s,p)=>s+p[1],0)/poly.length]}
function coordinateText(lat,lng){return `${Math.abs(lat).toFixed(5)}° ${lat<0?'S':'N'} · ${Math.abs(lng).toFixed(5)}° ${lng<0?'W':'E'}`}
function currentSpecies(){return SPECIES.find(s=>s.id===state.speciesId)||SPECIES[0]}
function toast(message,error=false){clearTimeout(toastTimer);const node=$('#toast');node.classList.toggle('error',error);node.querySelector('span').textContent=message;node.hidden=false;toastTimer=setTimeout(()=>node.hidden=true,error?7000:4000)}
function speciesArt(id){
  const stems='<path d="M9 57Q23 53 45 56" fill="none" stroke="#a7b58a" stroke-width="1.3"/><path d="M12 57l-2 4m12-6-1 6m12-6 2 5m6-5 3 5" stroke="#b7b58c" stroke-width=".8"/>';
  const oval='<g stroke="#669d61" stroke-width=".8"><path d="M21 55Q18 43 13 30M31 55Q31 42 34 22M39 55Q40 43 45 36" fill="none"/><ellipse cx="12" cy="30" rx="5" ry="10" transform="rotate(-26 12 30)" fill="#89b870"/><ellipse cx="33" cy="22" rx="5.6" ry="11" transform="rotate(13 33 22)" fill="#75a95b"/><ellipse cx="44" cy="35" rx="4" ry="8" transform="rotate(25 44 35)" fill="#9ac27d"/><path d="M9 23l6 14m20-23-4 17m16 0-5 10" fill="none" stroke="#b6d49b"/></g>';
  const grass='<g fill="none" stroke-linecap="round"><path d="M17 55Q9 34 14 12" stroke="#87b16d" stroke-width="2.4"/><path d="M20 55Q17 29 25 8" stroke="#5b9b5c" stroke-width="2.5"/><path d="M25 55Q30 35 30 17" stroke="#9dbf72" stroke-width="2"/><path d="M34 55Q31 31 39 14" stroke="#74a966" stroke-width="2.4"/><path d="M36 55Q43 36 42 23" stroke="#99bc78" stroke-width="2"/></g>';
  return `<svg viewBox="0 0 55 65" aria-hidden="true">${stems}${id==='ovalis'?oval:grass}</svg>`;
}
function renderControls(){
  $('#site-name').textContent=state.location.name;$('#site-detail').textContent=state.location.detail;
  $('#area-input').value=+(polygonArea(state.polygon)/($('#area-unit').value==='ha'?10000:1)).toFixed($('#area-unit').value==='ha'?4:1);
  for(const [id,key] of [['spacing-input','spacing'],['coverage-input','coveragePercent'],['orientation-input','orientation'],['cost-input','unitCost'],['spares-input','sparePercent'],['plants-input','seedlingsPerStructure'],['footprint-input','footprintM2']])$('#'+id).value=state[key];
  const species=currentSpecies();$('#species-common').textContent=species.common;$('#species-latin').textContent=species.latin;$('#species-tag').textContent=species.tag;$('#species-illustration').innerHTML=speciesArt(species.id);
  $$('.pattern-option').forEach(b=>{const on=b.dataset.pattern===state.pattern;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',on)});
  $('#coverage-output').innerHTML=`${state.coveragePercent}<span>%</span>`;
  $('#coverage-input').style.background=`linear-gradient(to right,var(--teal) ${(state.coveragePercent-10)/90*100}%,#e3ebe4 ${(state.coveragePercent-10)/90*100}%)`;
  $$('.basemap-options button').forEach(b=>b.classList.toggle('selected',b.dataset.basemap===state.basemap));
  $('#clear-exclusions').hidden=!state.exclusions.length;
  const c=centerOf();$('#coordinate-label').textContent=coordinateText(c[1],c[0]);
  updateSurveyCard();updateSavedCount();icons();
}
function renderMap(){
  boundaries.clearLayers();positions.clearLayers();exclusionLayer.clearLayers();
  drawnBoundary=L.polygon(ll(state.polygon),{color:'#bef5cf',weight:2.3,opacity:1,fillColor:'#49d3aa',fillOpacity:.16,interactive:false}).addTo(boundaries);
  for(const ring of state.exclusions)L.polygon(ll(ring),{color:'#e4b47b',weight:1.5,dashArray:'5 5',fillColor:'#e4a55c',fillOpacity:.2,interactive:false}).addTo(exclusionLayer);
  if(plan&&validPlan){
    const radius=plan.structureCount>3000?1.9:plan.structureCount>1000?2.6:3.1;
    for(const p of plan.points)L.circleMarker([p.lat,displayLng(p.lng)],{radius,color:'#e3ffee',weight:.85,fillColor:'#26b89b',fillOpacity:.95,renderer:canvas,bubblingMouseEvents:false}).bindPopup(`<strong>COASTAL ${esc(p.id)}</strong><br>${esc(currentSpecies().latin)}<br><span>${p.lat.toFixed(7)}, ${p.lng.toFixed(7)}</span><br>Row ${p.row} · Position ${p.col}<br>${state.seedlingsPerStructure} planting unit${state.seedlingsPerStructure===1?'':'s'}`).addTo(positions);
    const top=state.polygon.reduce((best,p)=>p[1]>best[1]?p:best,state.polygon[0]);
    areaTooltip=L.tooltip({permanent:true,direction:'top',offset:[0,-15],className:'map-area-label',interactive:false}).setLatLng([top[1],displayLng(top[0])]).setContent(`<strong>${esc(state.location.name)} · planting area</strong><span>${fmt(plan.areaM2)} m² &nbsp; / &nbsp; ${fmt(plan.structureCount)} structures</span>`).addTo(boundaries);
  }
  syncLayers();resizeStructureMarkers();
}
function resizeStructureMarkers(){const lat=centerOf()[1],mpp=156543.03392*Math.cos(lat*Math.PI/180)/2**map.getZoom(),radius=Math.max(.65,Math.min(3.2,state.spacing/mpp*.25));positions.eachLayer(layer=>layer.setRadius?.(radius))}
function syncLayers(){for(const [input,group] of [['show-boundary',boundaries],['show-structures',positions]]){if($('#'+input).checked){if(!map.hasLayer(group))group.addTo(map)}else map.removeLayer(group)}}
function renderSummary(){
  if(!plan||!validPlan){$('#plan-summary').classList.add('invalid');$('#stat-structures').textContent='—';$('#stat-plants').textContent='—';$('#stat-cost').textContent='—';$('#stat-area').textContent='—';$('#summary-footnote').textContent='Resolve the plan settings to calculate a valid layout.';return}
  $('#plan-summary').classList.remove('dirty','invalid');
  $('#summary-subtitle').textContent=`${PATTERNS[state.pattern]} layout · ${fmt(state.spacing,2)} m spacing`;
  $('#stat-area').innerHTML=`${fmt(plan.targetAreaM2)} <small>m²</small>`;
  $('#stat-area-sub').textContent=`${state.coveragePercent}% of usable area`;
  $('#stat-structures').textContent=fmt(plan.structureCount);$('#stat-spares').textContent=`+ ${fmt(plan.spares)} spare${plan.spares===1?'':'s'} · ${fmt(plan.procurementCount)} total`;
  $('#stat-plants').textContent=fmt(plan.seedlings);$('#stat-plants-sub').textContent=`${state.seedlingsPerStructure} planting unit${state.seedlingsPerStructure===1?'':'s'} per structure`;
  $('#stat-cost').textContent=money(plan.totalCost);$('#stat-cost-sub').textContent=`${money(state.unitCost)} each · including spares`;
  $('#summary-footnote').textContent=plan.structureCount===0?'No structures fit. Increase the area or adjust spacing and exclusions.':'Layout estimate · confirm local habitat and conditions before planting.';
}
function recalculate({fit=false,notify=false}={}){
  clearTimeout(updateTimer);
  try{plan=generatePlan(state);validPlan=true;$('#plan-error').hidden=true;writeStorage(STORAGE.draft,state);renderControls();renderMap();renderSummary();if(fit)fitSite();if(notify)toast(`${fmt(plan.structureCount)} structure positions calculated. ${fmt(plan.procurementCount)} structures including spares.`);return true}
  catch(error){validPlan=false;$('#plan-error').textContent=error.message;$('#plan-error').hidden=false;positions.clearLayers();renderSummary();if(notify)toast(error.message,true);return false}
}
function scheduleCalculation(){validPlan=false;$('#plan-summary').classList.add('dirty');clearTimeout(updateTimer);updateTimer=setTimeout(()=>recalculate(),180)}
function fitSite(){
  const mobile=innerWidth<=760;const small=innerWidth<=1000;
  map.fitBounds(L.latLngBounds(ll(state.polygon)),{paddingTopLeft:mobile?[62,120]:[innerWidth>=1500?430:innerWidth<=1230?375:410,115],paddingBottomRight:mobile?[65,310]:[small?85:160,small?305:230],maxZoom:19,animate:true});
}
function updateSavedCount(){const count=savedPlans.length;$('#saved-count').textContent=count;$('#saved-count').hidden=!count}
function updateSurveyCard(){const result=assessSurvey(state.survey);$('#survey-status').textContent=result.status==='survey'?'Get to know your site.':result.title;$('#survey-description').textContent=result.status==='survey'?`${result.verifiedCount} of ${SURVEY_FIELDS.length} observations verified. A field survey comes first.`:result.summary;$('#survey-button').innerHTML=`${result.status==='survey'?'Check site conditions':'Review field observations'}<i data-lucide="arrow-up-right"></i>`}
function setSite(point,name,detail){
  const area=polygonArea(state.polygon);state.polygon=makeRectangle([lngWrap(point.lng),point.lat],area);state.exclusions=[];state.survey={};state.surveyNotes='';state.surveyDepth='';state.name='';state.location={name:name||'Selected coastal site',detail:detail||coordinateText(point.lat,point.lng),lng:lngWrap(point.lng),lat:point.lat};cancelMode();recalculate({fit:true});toast('Planting area placed. Check habitat and field conditions at this new location.');
}
function setBasemap(type){map.removeLayer(basemap);basemap=type==='map'?coastmap:satellite;basemap.addTo(map);state.basemap=type;tileFailures=0;$('#map-error').hidden=true;writeStorage(STORAGE.draft,state);renderControls()}

// Search runs only after submission. Suggestions below are real place references.
function renderSearchResults(results,heading='SEARCH RESULTS'){
  const host=$('#search-results');host.innerHTML=`<div class="menu-heading">${esc(heading)}</div>${results.length?results.map((r,i)=>`<button type="button" data-location-index="${i}"><i data-lucide="map-pin"></i><span><strong>${esc(r.name)}</strong><small>${esc(r.detail)}</small></span></button>`).join(''):'<p>No places found. Try a nearby town, Thai place name, or decimal latitude, longitude.</p>'}<p>Place references locate an area. Confirm your planting point on the map.</p>`;host.hidden=false;
  host.querySelectorAll('[data-location-index]').forEach(button=>button.addEventListener('click',()=>chooseSearchResult(results[Number(button.dataset.locationIndex)])));icons();
}
function chooseSearchResult(result){
  resetSearch();$('#search-results').hidden=true;$('#location-search').value=result.name;pendingLocation=result;
  if(result.source==='Coordinates'||/coordinate/i.test(result.source)){try{setSite(result,result.name,result.detail)}catch(error){toast(error.message,true)}return}
  cancelMode();pendingLocation=result;mode='place';$('#map').style.cursor='crosshair';$('#draw-toolbar').hidden=false;$('#draw-instruction').textContent='Click the map to place your planting area';$('#draw-count').textContent=`Near ${result.name} · choose a surveyed nearshore point`;$('#finish-draw').hidden=true;$('#undo-point').hidden=true;
  map.flyTo([result.lat,result.lng],result.name.toLowerCase().includes('province')?10:14,{duration:1});$('#planner-panel').classList.remove('mobile-open');toast('Click a nearshore point on the map to position your planting area.');
}
async function handleSearch(event){
  event?.preventDefault();resetSearch();const query=$('#location-search').value.trim();if(!query){renderSearchResults(COASTAL_LOCATIONS,'EXPLORE A COAST');return}
  searchController=new AbortController();const generation=searchGeneration;
  $('#search-results').innerHTML='<p>Finding your location…</p>';$('#search-results').hidden=false;
  try{const results=await searchLocations(query,{signal:searchController.signal});if(generation===searchGeneration)renderSearchResults(results)}
  catch(error){if(error.name==='AbortError'||generation!==searchGeneration)return;$('#search-results').innerHTML=`<p>${esc(error.message)}</p><p>You can still enter latitude, longitude or choose a point directly on the map.</p>`}
}
function resetSearch(){searchController?.abort();searchGeneration++}

function startDraw(type){
  resetSearch();$('#search-results').hidden=true;cancelMode();mode=type;drawPoints=[];map.removeLayer(positions);$('#map').style.cursor='crosshair';map.doubleClickZoom.disable();$('#draw-toolbar').hidden=false;$('#draw-instruction').textContent=type==='exclusion'?'Outline an area to keep clear':'Click to draw your planting boundary';$('#draw-count').textContent='At least 3 points · click the first point to finish';$('#finish-draw').hidden=false;$('#finish-draw').disabled=true;$('#undo-point').hidden=false;$('#planner-panel').classList.remove('mobile-open');toast(type==='exclusion'?'Outline existing habitat, obstacles or an area to exclude.':'Click around the planting area, then choose Finish area.');
}
function renderDrawing(){
  drawing.clearLayers();if(drawPoints.length>=2)L.polyline(ll([...drawPoints,...(drawPoints.length>=3?[drawPoints[0]]:[])]),{color:mode==='exclusion'?'#edbc7d':'#d0ffdd',weight:2,dashArray:'5 5'}).addTo(drawing);
  drawPoints.forEach((p,i)=>{const m=L.marker([p[1],p[0]],{icon:L.divIcon({className:`map-vertex ${mode==='exclusion'?'exclusion-vertex':''}`,iconSize:[9,9],iconAnchor:[4.5,4.5]}),bubblingMouseEvents:false}).addTo(drawing);if(i===0)m.on('click',()=>{if(drawPoints.length>=3)finishDraw()})});
  $('#finish-draw').disabled=drawPoints.length<3;$('#draw-count').textContent=`${drawPoints.length} point${drawPoints.length===1?'':'s'} · ${drawPoints.length<3?'at least 3 needed':'click Finish area to calculate'}`;
}
function finishDraw(){
  if(drawPoints.length<3)return;const candidate=clone(state);
  if(mode==='exclusion')candidate.exclusions.push(clone(drawPoints));else{candidate.polygon=clone(drawPoints);candidate.exclusions=[];candidate.survey={};candidate.surveyNotes='';candidate.surveyDepth='';candidate.name='';const c=centerOf(candidate.polygon);if(map.distance([state.location.lat,state.location.lng],[c[1],c[0]])>500){candidate.location.name='Drawn coastal site';candidate.location.detail=coordinateText(c[1],c[0])}candidate.location.lng=c[0];candidate.location.lat=c[1]}
  try{generatePlan(candidate);state=candidate;cancelMode();recalculate({fit:true,notify:true})}catch(error){toast(error.message,true)}
}
function cancelMode(){mode=null;drawPoints=[];pendingLocation=null;drawing.clearLayers();$('#draw-toolbar').hidden=true;$('#finish-draw').hidden=false;$('#undo-point').hidden=false;$('#map').style.cursor='';map.doubleClickZoom.enable();syncLayers()}
map.on('click',event=>{
  if(mode==='place'){const chosen=pendingLocation;try{setSite(event.latlng,chosen?.name,chosen?.detail)}catch(error){toast(error.message,true)}return}
  if(mode==='boundary'||mode==='exclusion'){if(drawPoints.length>=256){toast('Use no more than 256 boundary points.',true);return}drawPoints.push([lngWrap(event.latlng.lng),event.latlng.lat]);renderDrawing();return}
  const content=document.createElement('div');content.innerHTML=`<strong>Explore this location</strong><br><span style="color:#819b8a">${esc(coordinateText(event.latlng.lat,event.latlng.lng))}</span><br><button class="primary-button" style="margin-top:10px;font-size:10px">Place planting area here</button>`;
  content.querySelector('button').addEventListener('click',()=>{try{setSite(event.latlng,'Selected coastal site');map.closePopup()}catch(error){toast(error.message,true)}});L.popup().setLatLng(event.latlng).setContent(content).openOn(map);
});
map.on('mousemove',event=>{if(mode&&mode!=='place')$('#map').style.cursor='crosshair'});
map.on('zoomend',resizeStructureMarkers);

function openDialog(title,html,eyebrow='COASTAL WORKSPACE'){$('#dialog-title').textContent=title;$('#dialog-eyebrow').textContent=eyebrow;$('#dialog-body').innerHTML=html;$('#export-menu').hidden=true;$('#search-results').hidden=true;$('#app-dialog').showModal();icons();$('#dialog-body').scrollTop=0}
function closeDialog(){$('#app-dialog').close()}
function openSpecies(){
  openDialog('Find your local species',`<p>Start with a species already documented at the site or its local reference meadow. Each choice is included in your plan and field exports.</p><div class="species-list">${SPECIES.map(s=>`<button class="species-choice ${s.id===state.speciesId?'selected':''}" data-species="${s.id}"><span class="species-illustration">${speciesArt(s.id)}</span><span><strong>${esc(s.common)}</strong><em>${esc(s.latin)}</em><p>${esc(s.description)}</p></span><i data-lucide="${s.id===state.speciesId?'circle-check':'chevron-right'}"></i></button>`).join('')}</div><div class="context-note">Species selection does not establish that a site is suitable. Planting spacing is an editable field-trial assumption, not a universal biological optimum.</div>`,'02 / CHOOSE YOUR SEAGRASS');
  $$('#dialog-body [data-species]').forEach(b=>b.addEventListener('click',()=>{if(state.speciesId!==b.dataset.species){state.speciesId=b.dataset.species;state.survey.native='unknown'}closeDialog();recalculate();toast(`${currentSpecies().latin} selected. Confirm this species occurs locally.`)}));
}
function openSurvey(){
  openDialog('Get to know your site',`<p>Record observations from the actual planting area. These checks organize field evidence; they are not a validated suitability model.</p><form id="survey-form">${SURVEY_FIELDS.map(f=>`<div class="survey-field"><label for="survey-${f.id}">${esc(f.label)}</label><p>${esc(f.help)}</p><select id="survey-${f.id}" name="${f.id}"><option value="unknown"${!['yes','no'].includes(state.survey[f.id])?' selected':''}>Not assessed yet</option><option value="yes"${state.survey[f.id]==='yes'?' selected':''}>Verified — favorable for a local pilot</option><option value="no"${state.survey[f.id]==='no'?' selected':''}>Constraint identified — needs review</option></select></div>`).join('')}<div class="survey-field"><label for="survey-depth">Water depth at observation (optional)</label><p>Record the tide and timing in your notes. This value is retained, without applying a generic species threshold.</p><div class="suffix-input"><input id="survey-depth" type="number" min="0" max="100" step="0.1" placeholder="e.g. 1.2" value="${esc(state.surveyDepth)}"><span>m</span></div></div><div class="survey-field"><label for="survey-notes">Field notes & evidence</label><textarea id="survey-notes" maxlength="5000" placeholder="Survey date, tide, light measurements, donor meadow, observations…">${esc(state.surveyNotes)}</textarea></div><div id="survey-verdict" class="survey-verdict"></div><div class="dialog-actions"><button type="button" class="quiet-button" id="survey-cancel">Cancel</button><button type="submit" class="primary-button">Save observations<i data-lucide="check"></i></button></div></form>`,'FIELD ASSESSMENT');
  const form=$('#survey-form');const readForm=()=>Object.fromEntries(SURVEY_FIELDS.map(f=>[f.id,$('#survey-'+f.id).value]));
  function verdict(){const r=assessSurvey(readForm());$('#survey-verdict').classList.toggle('caution',r.status!=='pilot');$('#survey-verdict').innerHTML=`<strong>${esc(r.title)}</strong><p>${esc(r.summary)}</p><p>${r.verifiedCount} of ${SURVEY_FIELDS.length} observations verified.</p>`}
  form.addEventListener('change',verdict);verdict();$('#survey-cancel').addEventListener('click',closeDialog);
  form.addEventListener('submit',e=>{e.preventDefault();state.survey=readForm();state.surveyNotes=$('#survey-notes').value.trim();state.surveyDepth=$('#survey-depth').value;writeStorage(STORAGE.draft,state);updateSurveyCard();icons();closeDialog();toast('Field observations saved to this plan.')});
}
function evidenceHTML(){return EVIDENCE.map(e=>`<article class="evidence-card"><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)} ↗</a><small>${esc(e.authors)} · ${e.year}</small><p>${esc(e.implication)}</p></article>`).join('')}
function openGuide(tab='methods'){
  activeGuide=tab;
  const methods=`<h3>A real layout, from your real boundary.</h3><p>The planner projects your geographic boundary into a local metric plane, generates structure positions, and clips them to the boundary. A clearance based on the structure footprint keeps whole units inside. Exclusions are removed from the usable area.</p><div class="formula-box">Grid area per position ≈ spacing²<br>Staggered area per position ≈ √3 / 2 × spacing²<br>Procurement = installed + ceil(installed × spare %)<br>Material estimate = procurement × unit cost</div><p>These formulas explain the patterns. The displayed count comes from the actual clipped positions, so irregular boundaries, orientation, footprint and exclusions affect the result.</p><h3>What each pattern does</h3><ul><li><strong>Staggered:</strong> a triangular lattice with the same distance to nearest neighbors. A useful geometric starting point for even spacing.</li><li><strong>Grid:</strong> aligned rows and columns for clear transects and straightforward field marking.</li><li><strong>Clusters:</strong> groups of seven structures. Group centers are four spacings apart. Incomplete edge groups are omitted.</li></ul><h3>Area, coverage and living seagrass</h3><p>The coverage slider allocates a fraction of valid planting positions, starting near the site's center. Planned area is the requested fraction of usable area; it is not measured live seagrass cover or a forecast of spread. Whole structures and whole clusters mean the achieved position fraction can differ slightly.</p><h3>Planning assumptions</h3><p>The initial 1.5 m spacing, 0.09 m² footprint, one planting unit per structure, and 10% spares are editable assumptions. The initial US$6 unit price comes from your project poster. Labor, transport, donor material, maintenance and monitoring are excluded.</p><div class="context-note">Planning limits: 100 ha per site, 15,000 structures, 10 km maximum span, latitude within ±75°. Coordinates use WGS84. Confirm final installation positions by field survey.</div><button class="primary-button" id="guide-compare">Compare layout counts<i data-lucide="arrow-right"></i></button>`;
  const species=`<p>These species match the COASTAL project's tropical seagrass focus. The final selection should follow local species records, donor stock and site observations.</p>${SPECIES.map(s=>`<article class="evidence-card"><div class="about-brand"><span class="species-illustration">${speciesArt(s.id)}</span><div><h3 style="margin:0">${esc(s.common)}</h3><em>${esc(s.latin)}</em></div></div><p>${esc(s.description)}</p>${s.evidence.map((url,i)=>`<a class="source-link" href="${esc(url)}" target="_blank" rel="noopener">Primary evidence ${i+1} ↗</a>`).join(' · ')}</article>`).join('')}<div class="context-note">The planner does not claim a universally optimal species or spacing from coordinates. Changing a species resets its local-occurrence assessment so the new selection can be checked.</div>`;
  const evidence=`<p>Primary literature informs the field checks and explains why species, density and local conditions matter. These studies do not validate the COASTAL device or guarantee an outcome at the selected site.</p>${evidenceHTML()}`;
  const about=`<div class="about-brand"><img src="assets/mark.svg" alt=""><div><strong>COASTAL.</strong><small>A future rooted in seagrass</small></div></div><p>Conservation-Oriented Assisted Juvenile Seagrass Transplantation Apparatus for Littoral Restoration through Enhanced Seagrass Establishment, Wave Dissipation, and Sediment Trapping.</p><p>Inspired by mangrove anchorage and protective root structures, COASTAL brings structure-assisted planting and restoration planning into one workspace.</p><h3>Your project, translated into a working planner.</h3><p>The aqua, teal and coastal blue palette is drawn from the supplied poster. Device performance statements on that poster are project claims; they are not used to predict survival, wave reduction, carbon storage or restored habitat in this app.</p><a href="assets/coastal-poster.png" target="_blank" rel="noopener"><img class="poster-preview" src="assets/coastal-poster.png" alt="Original COASTAL project poster"></a><h3>Map and data</h3><p>Satellite imagery: Esri and its imagery providers. Coast map: OpenStreetMap contributors. Place search: Photon / OpenStreetMap. Place results are location references, not mapped seagrass or recommended habitats.</p><p>Saved plans stay in this browser. Export the complete plan to keep a portable backup or import it on another device. There is no cloud account synchronization.</p>`;
  openDialog('The COASTAL field guide',`<div class="guide-tabs">${[['methods','Planning method'],['species','Species'],['evidence','Research'],['about','About COASTAL']].map(([key,label])=>`<button class="guide-tab ${tab===key?'active':''}" data-guide="${key}">${label}</button>`).join('')}</div>${({methods,species,evidence,about})[tab]||methods}`,'LEARN / PLAN / RESTORE');
  $$('#dialog-body [data-guide]').forEach(b=>b.addEventListener('click',()=>openGuide(b.dataset.guide)));$('#guide-compare')?.addEventListener('click',openCalculation);
}
function openCalculation(){
  if(!ensurePlan())return;
  const comparisons=Object.keys(PATTERNS).map(pattern=>{try{const p=generatePlan({...state,pattern});return `<div><small>${PATTERNS[pattern]}</small><strong>${fmt(p.structureCount)} structures</strong><small>${money(p.totalCost)} with spares</small></div>`}catch{return `<div><small>${PATTERNS[pattern]}</small><strong>Outside limits</strong></div>`}}).join('');
  openDialog('Every position is counted',`<p>Calculated for <strong>${esc(state.location.name)}</strong>, using your boundary, exclusions and current settings.</p><div class="calculation-grid"><div><small>Selected boundary</small><strong>${fmt(plan.areaM2,1)} m²</strong></div><div><small>Usable after exclusions</small><strong>${fmt(plan.usableAreaM2,1)} m²</strong></div><div><small>Requested planting area</small><strong>${fmt(plan.targetAreaM2,1)} m²</strong></div><div><small>Allocated positions</small><strong>${fmt(plan.layoutCoveragePercent,1)}%</strong></div><div><small>Installed structures</small><strong>${fmt(plan.structureCount)}</strong></div><div><small>Order including spares</small><strong>${fmt(plan.procurementCount)}</strong></div><div><small>Nominal installed footprint</small><strong>${fmt(plan.footprintM2,2)} m²</strong></div><div><small>Boundary clearance</small><strong>${fmt(plan.boundaryClearanceM,3)} m</strong></div></div><h3>Compare patterns at ${fmt(state.spacing,2)} m spacing</h3><div class="calculation-grid">${comparisons}</div><p>Counts describe geometry, not ecological performance. Staggering produces more evenly spaced positions per unit area; this does not prove higher survival.</p><div class="context-note">${plan.warnings.map(esc).join('<br><br>')}</div><button class="primary-button" id="calculation-method">Read the planning method<i data-lucide="arrow-right"></i></button>`,'CALCULATION DETAILS');$('#calculation-method').addEventListener('click',()=>openGuide('methods'));
}
function openHelp(){openDialog('From coastline to planting plan',`<p>A practical workspace for planning your next COASTAL installation.</p>${[
['Find your coast','Search a place or enter latitude, longitude. For a place search, click the map to choose the exact planting point.'],
['Define the area','Enter square meters or hectares, or draw a custom boundary. Use the dashed-square tool to exclude existing habitat or obstacles.'],
['Choose and calculate','Select a locally recorded species, choose a pattern and adjust structure spacing. Every generated position contributes to the count.'],
['Check and take it to the field','Record site observations, save the plan, and export the boundary and GPS positions as GeoJSON or CSV.']].map(([title,copy],i)=>`<div class="how-step"><span>0${i+1}</span><div><h3>${title}</h3><p>${copy}</p></div></div>`).join('')}<div class="context-note">The map opens with a draft area near Samae San. It is a starting location, not a field-verified restoration site. Your edits are saved in this browser.</div><div class="dialog-actions"><button class="primary-button" id="help-start">Start planning<i data-lucide="arrow-right"></i></button></div>`,'A FUTURE ROOTED IN SEAGRASS');$('#help-start').addEventListener('click',closeDialog)}

function ensurePlan(){return validPlan||recalculate({notify:true})}
function planName(){return state.name||`${state.location.name} · ${currentSpecies().latin}`}
function completePlan(){return {format:'COASTAL_PLAN',version:1,savedAt:new Date().toISOString(),name:planName(),settings:clone(state),result:clone(plan),assessment:assessSurvey(state.survey),sources:EVIDENCE.map(e=>({title:e.title,url:e.url})),notes:'Geometric planning estimate. Field conditions, live cover and survival are not inferred from the map.'}}
function openSave(){
  if(!ensurePlan())return;
  openDialog('Give this meadow a beginning',`<p>Save this boundary, species, layout and field observations together. Your plans are kept in this browser.</p><form id="save-form"><label for="plan-name" style="display:block;font-weight:600;font-size:11px;margin-bottom:8px">Plan name</label><input class="name-field" id="plan-name" required maxlength="120" value="${esc(state.name||`${state.location.name} restoration`)}"><div class="context-note">${fmt(plan.structureCount)} structures · ${fmt(plan.targetAreaM2)} m² planned · ${esc(currentSpecies().latin)}</div><div class="dialog-actions"><button class="quiet-button" type="button" id="save-cancel">Cancel</button><button class="primary-button" type="submit">Save plan<i data-lucide="bookmark-check"></i></button></div></form>`,'SAVE YOUR PLAN');$('#save-cancel').addEventListener('click',closeDialog);
  $('#save-form').addEventListener('submit',event=>{event.preventDefault();state.name=$('#plan-name').value.trim();if(!state.name)return;const saved={id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),...completePlan()};const next=[saved,...savedPlans];if(!writeStorage(STORAGE.plans,next)){toast('Browser storage is full or unavailable. Export the complete plan as a backup.',true);return}savedPlans=next;writeStorage(STORAGE.draft,state);updateSavedCount();closeDialog();toast('Plan saved. Find it under Saved plans.')});
}
function openSaved(){
  openDialog('Your saved beginnings',`<p>Plans saved in this browser. Export a complete plan to keep a backup or move it to another device.</p>${savedPlans.length?savedPlans.map((p,i)=>`<article class="saved-plan-row"><h3>${esc(p.name||'Untitled plan')}</h3><p>${esc(p.settings?.location?.name||'Coastal site')} · ${fmt(p.result?.structureCount||0)} structures · ${esc(p.settings?.pattern?PATTERNS[p.settings.pattern]:'')}</p><p>${esc(new Date(p.savedAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}))}</p><div class="saved-actions"><button data-open-plan="${i}">Open plan</button><button data-download-plan="${i}">Export backup</button><button data-delete-plan="${i}">Delete</button></div></article>`).join(''):'<div class="empty-state"><i data-lucide="bookmark"></i><h3>Your next meadow belongs here.</h3><p>Create a planting plan, then save its layout and field observations.</p></div>'}<div class="dialog-actions"><input type="file" id="import-file" accept="application/json,.json" hidden><button class="quiet-button" id="import-plan"><i data-lucide="upload"></i>Import complete plan</button><button class="primary-button" id="saved-back">Back to map<i data-lucide="arrow-right"></i></button></div>`,'SAVED PLANS');
  $('#saved-back').addEventListener('click',closeDialog);$('#import-plan').addEventListener('click',()=>$('#import-file').click());$('#import-file').addEventListener('change',importPlan);
  $$('#dialog-body [data-open-plan]').forEach(b=>b.addEventListener('click',()=>{try{const loaded=checkedState(savedPlans[Number(b.dataset.openPlan)].settings);cancelMode();resetSearch();state=loaded;setBasemap(state.basemap);closeDialog();recalculate({fit:true});toast('Saved plan opened.')}catch(error){toast(error.message,true)}}));
  $$('#dialog-body [data-download-plan]').forEach(b=>b.addEventListener('click',()=>{const p=savedPlans[Number(b.dataset.downloadPlan)];download(`${slug(p.name)}.coastal.json`,JSON.stringify(p,null,2),'application/json')}));
  $$('#dialog-body [data-delete-plan]').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.deletePlan);if(b.dataset.confirm!=='yes'){b.dataset.confirm='yes';b.textContent='Confirm delete';return}const next=savedPlans.filter((_,index)=>index!==i);if(writeStorage(STORAGE.plans,next)){savedPlans=next;updateSavedCount();openSaved();toast('Saved plan deleted.')}else toast('Browser storage is unavailable. The plan was not deleted.',true)}));
}
async function importPlan(event){
  const file=event.target.files?.[0];if(!file)return;if(file.size>10*1024*1024){toast('Use a COASTAL JSON file smaller than 10 MB.',true);return}
  try{const data=JSON.parse(await file.text());if(data.format!=='COASTAL_PLAN')throw Error('Choose a complete COASTAL plan JSON export.');const imported=checkedState(data.settings);cancelMode();resetSearch();state=imported;setBasemap(state.basemap);closeDialog();recalculate({fit:true});toast('Plan imported. Save it to add it to this browser’s saved plans.')}catch(error){toast(`Could not import: ${error.message}`,true)}
}
function slug(value){return String(value).normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80).toLowerCase()||'coastal-plan'}
function download(name,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000)}
function csvCell(value){let s=String(value??'');if(/^[=+\-@\t\r]/.test(s)&&!/^[-+]?\d+(\.\d+)?$/.test(s))s="'"+s;return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function exportPlan(type){
  if(!ensurePlan())return;const base=slug(planName());const species=currentSpecies();
  if(type==='geojson')download(base+'.geojson',JSON.stringify(exportGeoJSON(plan,{site:state.location.name,species:species.latin,plantsPerStructure:state.seedlingsPerStructure,assessment:assessSurvey(state.survey).title}),null,2),'application/geo+json');
  if(type==='csv'){const header=['structure_id','latitude','longitude','row','column','species','planting_units','pattern','spacing_m','site','assessment'];const rows=plan.points.map(p=>[p.id,p.lat.toFixed(8),p.lng.toFixed(8),p.row,p.col,species.latin,state.seedlingsPerStructure,state.pattern,state.spacing,state.location.name,assessSurvey(state.survey).title]);download(base+'-coordinates.csv','\uFEFF'+[header,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8')}
  if(type==='json')download(base+'.coastal.json',JSON.stringify(completePlan(),null,2),'application/json');
  if(type==='print'){preparePrint();window.print()}
  $('#export-menu').hidden=true;if(type!=='print')toast('Plan export prepared.');
}
function preparePrint(){
  const result=assessSurvey(state.survey);const center=centerOf();const cos=Math.cos(center[1]*Math.PI/180);const xy=([lng,lat])=>[(center[0]+lngWrap(lng-center[0])-center[0])*cos,-lat];const pts=state.polygon.map(xy);const minX=Math.min(...pts.map(p=>p[0])),maxX=Math.max(...pts.map(p=>p[0])),minY=Math.min(...pts.map(p=>p[1])),maxY=Math.max(...pts.map(p=>p[1]));const scale=Math.min(670/(maxX-minX),250/(maxY-minY));const project=p=>{const [x,y]=xy(p);return [15+(x-minX)*scale,15+(y-minY)*scale]};
  const svg=`<svg viewBox="0 0 700 280" xmlns="http://www.w3.org/2000/svg"><polygon points="${state.polygon.map(p=>project(p).join(',')).join(' ')}" fill="#eaf5e7" stroke="#278d72" stroke-width="1.5"/>${state.exclusions.map(r=>`<polygon points="${r.map(p=>project(p).join(',')).join(' ')}" fill="#f8e6c9" stroke="#b88043"/>`).join('')}${plan.points.map(p=>{const [x,y]=project([p.lng,p.lat]);return `<circle cx="${x}" cy="${y}" r="1.3" fill="#238776"/>`}).join('')}</svg>`;
  $('#print-view').innerHTML=`<h1>COASTAL · ${esc(planName())}</h1><p>${esc(state.location.detail)} · ${esc(coordinateText(center[1],center[0]))}<br>Prepared ${esc(new Date().toLocaleString())}</p>${svg}<p class="print-note">Geometric layout in local metric projection. No habitat or bathymetry is inferred.</p><table><tbody>${[['Species',currentSpecies().latin],['Boundary / usable area',`${fmt(plan.areaM2,1)} / ${fmt(plan.usableAreaM2,1)} m²`],['Planned area',`${fmt(plan.targetAreaM2,1)} m² (${state.coveragePercent}% requested)`],['Pattern / spacing / row bearing',`${PATTERNS[state.pattern]} / ${state.spacing} m / ${state.orientation}°`],['Installed / spare / order structures',`${plan.structureCount} / ${plan.spares} / ${plan.procurementCount}`],['Planting units',plan.seedlings],['Unit footprint / installed footprint',`${state.footprintM2} / ${fmt(plan.footprintM2,2)} m²`],['Materials estimate',`${money(plan.totalCost)} at ${money(state.unitCost)} per structure, including spares`],['Site assessment',result.title]].map(([a,b])=>`<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</tbody></table><h2>Field observations</h2><table>${SURVEY_FIELDS.map(f=>`<tr><td>${esc(f.label)}</td><td>${({yes:'Verified',no:'Constraint identified',unknown:'Not assessed'})[state.survey[f.id]||'unknown']}</td></tr>`).join('')}</table><p>Water depth at observation: ${esc(state.surveyDepth||'Not recorded')} ${state.surveyDepth?'m':''}</p><p>${esc(state.surveyNotes||'No field notes recorded.').replace(/\n/g,'<br>')}</p><h2>Assumptions and evidence</h2><p>Structure count is generated from clipped coordinates. Planned area is not future living seagrass coverage. Unit price, footprint, spacing, planting capacity and spare percentage are editable planning assumptions. Labor, transport and monitoring are excluded.</p><p>Coordinates for all ${fmt(plan.structureCount)} structures are available in the CSV and GeoJSON exports.</p>${EVIDENCE.map(e=>`<p class="print-note">${esc(e.authors)} (${e.year}). ${esc(e.title)}. ${esc(e.url)}</p>`).join('')}`;
}

// Bind every visible control to a complete action.
$('#search-form').addEventListener('submit',handleSearch);
$('#location-search').addEventListener('focus',()=>{if(!$('#location-search').value.trim())renderSearchResults(COASTAL_LOCATIONS,'EXPLORE A COAST')});
$('#choose-location').addEventListener('click',()=>{$('#location-search').focus();renderSearchResults(COASTAL_LOCATIONS,'EXPLORE A COAST');$('#planner-panel').classList.remove('mobile-open')});
$('#generate-plan').addEventListener('click',()=>{if(recalculate({fit:true,notify:true}))$('#planner-panel').classList.remove('mobile-open')});
$('#area-input').addEventListener('change',()=>{const area=Number($('#area-input').value)*($('#area-unit').value==='ha'?10000:1);if(!Number.isFinite(area)||area<1||area>1e6){toast('Enter a planting area between 1 and 1,000,000 m².',true);renderControls();return}const previous=clone(state),old=state.polygon,center=centerOf(),factor=Math.sqrt(area/polygonArea(old));state.polygon=old.map(([lng,lat])=>[lngWrap(center[0]+lngWrap(lng-center[0])*factor),center[1]+(lat-center[1])*factor]);state.survey={};state.surveyDepth='';if(!recalculate({fit:true})){state=previous;recalculate();toast('That area and spacing exceed the planner limits. Increase spacing first.',true)}});
$('#area-unit').addEventListener('change',()=>{const ha=$('#area-unit').value==='ha';$('#area-input').min=ha?.0001:1;$('#area-input').max=ha?100:1e6;$('#area-input').step=ha?.01:10;renderControls()});
for(const [id,key] of [['spacing-input','spacing'],['coverage-input','coveragePercent'],['orientation-input','orientation'],['cost-input','unitCost'],['spares-input','sparePercent'],['plants-input','seedlingsPerStructure'],['footprint-input','footprintM2']])$('#'+id).addEventListener('input',()=>{state[key]=$('#'+id).value===''?NaN:Number($('#'+id).value);if(key==='coveragePercent'){$('#coverage-output').innerHTML=`${state.coveragePercent}<span>%</span>`;$('#coverage-input').style.background=`linear-gradient(to right,var(--teal) ${(state.coveragePercent-10)/90*100}%,#e3ebe4 ${(state.coveragePercent-10)/90*100}%)`}scheduleCalculation()});
for(const [id,delta] of [['spacing-minus',-.1],['spacing-plus',.1]])$('#'+id).addEventListener('click',()=>{state.spacing=+Math.max(.1,(Number.isFinite(state.spacing)?state.spacing:1.5)+delta).toFixed(1);$('#spacing-input').value=state.spacing;recalculate()});
$$('.pattern-option').forEach(b=>b.addEventListener('click',()=>{state.pattern=b.dataset.pattern;recalculate()}));
$('#species-selector').addEventListener('click',openSpecies);$('#species-info').addEventListener('click',()=>openGuide('species'));
$$('[data-info]').forEach(b=>b.addEventListener('click',event=>{event.preventDefault();openGuide('methods')}));
$('#draw-area').addEventListener('click',()=>startDraw('boundary'));$('#draw-exclusion').addEventListener('click',()=>startDraw('exclusion'));$('#clear-exclusions').addEventListener('click',()=>{state.exclusions=[];state.survey={};state.surveyDepth='';recalculate();toast('Exclusions cleared. Recheck observations for the expanded usable area.')});
$('#finish-draw').addEventListener('click',finishDraw);$('#cancel-draw').addEventListener('click',cancelMode);$('#undo-point').addEventListener('click',()=>{drawPoints.pop();renderDrawing()});
$('#zoom-in').addEventListener('click',()=>map.zoomIn(1,{animate:false}));$('#zoom-out').addEventListener('click',()=>map.zoomOut(1,{animate:false}));$('#fit-site').addEventListener('click',fitSite);$('#brand-home').addEventListener('click',fitSite);$('#nav-planner').addEventListener('click',()=>{closeDialog();fitSite()});
$('#locate-me').addEventListener('click',()=>{if(!navigator.geolocation){toast('Location access is not supported. Search or enter coordinates instead.',true);return}toast('Locating your position…');navigator.geolocation.getCurrentPosition(position=>chooseSearchResult({name:'My location',detail:'Device location · select the actual planting site',lat:position.coords.latitude,lng:position.coords.longitude,source:'Device location'}),()=>toast('Could not access your location. You can search or enter latitude, longitude.',true),{timeout:12000,maximumAge:60000})});
$('#layers-button').addEventListener('click',()=>{const visible=$('#layers-popover').hidden;$('#layers-popover').hidden=!visible;$('#layers-button').setAttribute('aria-expanded',visible)});$$('[data-basemap]').forEach(b=>b.addEventListener('click',()=>setBasemap(b.dataset.basemap)));$('#show-boundary').addEventListener('change',syncLayers);$('#show-structures').addEventListener('change',syncLayers);$('#retry-map').addEventListener('click',()=>{tileFailures=0;basemap.redraw();$('#map-error').hidden=true});
$('#survey-button').addEventListener('click',openSurvey);$('#survey-reopen').addEventListener('click',openSurvey);$('#insight-close').addEventListener('click',()=>{$('#site-insight').hidden=true;$('#survey-reopen').hidden=false});
$('#summary-details').addEventListener('click',openCalculation);$('#save-plan').addEventListener('click',openSave);$('#nav-saved').addEventListener('click',openSaved);$('#nav-guide').addEventListener('click',()=>openGuide('methods'));$('#help-button').addEventListener('click',openHelp);
$('#close-dialog').addEventListener('click',closeDialog);$('#app-dialog').addEventListener('click',e=>{if(e.target===$('#app-dialog')){const r=$('#app-dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog()}});
$('#export-button').addEventListener('click',()=>{$('#export-menu').hidden=!$('#export-menu').hidden});$$('[data-export]').forEach(b=>b.addEventListener('click',()=>exportPlan(b.dataset.export)));
$('#mobile-plan-toggle').addEventListener('click',()=>$('#planner-panel').classList.add('mobile-open'));$('#panel-collapse').addEventListener('click',()=>$('#planner-panel').classList.remove('mobile-open'));
document.addEventListener('click',e=>{if(!e.target.closest('.export-menu,.export-button'))$('#export-menu').hidden=true;if(!e.target.closest('.search-area,#choose-location'))$('#search-results').hidden=true;if(!e.target.closest('.layers-popover,#layers-button')){$('#layers-popover').hidden=true;$('#layers-button').setAttribute('aria-expanded','false')}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){cancelMode();$('#export-menu').hidden=true;$('#search-results').hidden=true;$('#layers-popover').hidden=true}if(e.key==='/'&&!e.target.matches('input,textarea,select')&&!$('#app-dialog').open){e.preventDefault();$('#location-search').focus()}if(e.key==='Enter'&&mode&&mode!=='place'&&!e.target.matches('input,textarea,select,button'))finishDraw()});
window.addEventListener('resize',()=>map.invalidateSize());
renderControls();recalculate();requestAnimationFrame(()=>fitSite());
