import {newState,validateState,revise,clone,uid,today,isoNow,createEvidence,fmt,POLICY_NOTES,RULE_VERSION} from './model.js';
import {loadRules,BOARDS,GROUPS,sourceUrl} from './rules.js';
import {score} from './scoring.js';
import {LocalDB} from './storage-db.js';
import {Storage,photoIds} from './storage-directory.js';
import {createBackup,inspectBackup} from './backup.js';
import {esc,getFields,renderField} from './forms.js';
import {shell,home,boardView,recordsView,storageView,settingsView,policiesView,icon,button} from './views.js';

let state,rules,result,db,storage,ctx=null,busy=false,query='',usage=null,persistent=null,toastTimer,viewerUrl=null,installEvent=null,stale=false;
const app=document.getElementById('app'),dialog=document.getElementById('record-dialog'),viewer=document.getElementById('viewer');
const channel=globalThis.BroadcastChannel?new BroadcastChannel('zongce-planner-changes'):null;
const route=()=>{const parts=location.hash.replace(/^#\/?/,'').split('/');return {name:parts[0]||'home',id:parts[1]||'',rule:parts[2]||''};};
const toast=(message,timeout=6000)=>{const el=document.getElementById('toast');clearTimeout(toastTimer);el.textContent=message;el.hidden=false;toastTimer=setTimeout(()=>{el.hidden=true;},timeout);};
function renderStatus(status){
  for(const el of document.querySelectorAll('[data-storage-status]'))el.innerHTML=`<span class="status-dot"></span>${esc(status.message)}`;
  for(const el of document.querySelectorAll('[data-storage-strip]'))el.dataset.kind=status.kind;
  for(const el of document.querySelectorAll('[data-storage-time]'))el.textContent=status.time?new Date(status.time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'';
}
function render(){
  result=score(state,rules);const r=route();let body;
  switch(r.name){case 'board':body=boardView(r.id,state,result,rules);break;case 'records':body=recordsView(state,result,rules,r.id,query);break;case 'storage':body=storageView(state,result,storage,usage,persistent);break;case 'settings':body=settingsView(state);break;case 'policies':body=policiesView(state);break;default:body=home(state,result,rules,storage.currentStatus);}
  app.innerHTML=shell(body,state,r.name,storage.currentStatus);
  if(stale)app.querySelector('.topbar')?.insertAdjacentHTML('afterend','<div class="notice warning">另一标签页已更新资料，请先刷新本页后继续编辑，避免覆盖。</div>');
  if(r.rule){const detail=app.querySelector(`[data-rule="${CSS.escape(r.rule)}"]`);if(detail?.tagName==='DETAILS'){detail.open=true;requestAnimationFrame(()=>detail.scrollIntoView({block:'start'}));}}
}
async function persist(next,photos=[]){
  if(stale)throw new Error('另一标签页已更新资料，请刷新后继续');
  validateState(next,new Set(rules.map(r=>r.id)));
  busy=true;const previous=state;
  try{
    revise(next);const saved=await storage.save(next,photos);state=next;channel?.postMessage({revision:state.revision});render();
    if(saved.destination==='browser-pending')toast('记录已暂存在浏览器，手机目录尚未保存，请到“备份”重新授权或重试。',10000);
    return saved;
  }catch(e){state=previous;throw e;}finally{busy=false;}
}
function dateOptions(){const y=Number(state.settings.year.slice(0,4));return [y-3,y-2,y-1,y,y+1].map(n=>`${n}-${n+1}`);}
function ruleOptions(board,selected){return Object.entries(GROUPS).filter(([id])=>rules.some(r=>r.board===board&&r.group===id)).map(([id,g])=>`<optgroup label="${g.name}">${rules.filter(r=>r.board===board&&r.group===id).map(r=>`<option value="${r.id}" ${r.id===selected?'selected':''}>${esc(r.title)}</option>`).join('')}</optgroup>`).join('');}
async function openRecord(ruleId,recordId,boardId){
  if(busy||stale){toast(stale?'另一标签页更新了资料，请刷新后再编辑':'正在保存，请稍候');return;}
  const record=recordId?state.records.find(r=>r.id===recordId):null;
  const rule=rules.find(r=>r.id===(record?.ruleId||ruleId))||rules.find(r=>r.board===(boardId||'D'));
  ctx={record:record?clone(record):null,ruleId:rule.id,board:rule.board,keep:[...(record?.evidence||[])],newPhotos:[],urls:[],saving:false};
  dialog.innerHTML=`<form id="record-form"><header class="modal-header"><h2 id="dialog-title">${record?'编辑':'新增'}实践记录</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="关闭">${icon('close')}</button></header><div class="modal-body"><div class="field-grid"><label class="field"><span>板块</span><select id="record-board" ${record?'disabled':''}>${BOARDS.map(b=>`<option value="${b.id}" ${b.id===rule.board?'selected':''}>${b.name}</option>`).join('')}</select></label><label class="field"><span>所属学年</span><select name="recordYear">${[...new Set([...dateOptions(),record?.year||state.settings.year])].sort().map(y=>`<option value="${y}" ${y===(record?.year||state.settings.year)?'selected':''}>${y}</option>`).join('')}</select></label></div><label class="field"><span>对应细则 *</span><select id="record-rule" required ${record?'disabled':''}>${ruleOptions(rule.board,rule.id)}</select></label><div id="rule-hint" class="notice" style="margin:0 0 20px"></div><label class="field"><span>活动 / 成果名称 *</span><input name="name" required maxlength="200" value="${esc(record?.name||'')}" placeholder="例如：学院心理健康讲座"></label><div class="field-grid"><label class="field"><span>日期 *</span><input name="date" type="date" required value="${record?.date||today()}"></label><label class="field"><span>参与次数 *</span><input name="count" type="number" min="1" max="100000" step="1" required inputmode="numeric" value="${record?.count||1}"><small>仅次数制细则按此累计；论文/项目/岗位不乘次数。</small></label></div><div class="form-section">计分所需信息</div><div id="dynamic-fields"></div><div class="form-section">关联与申报</div><label class="field"><span>关联已有活动（可选）</span><select id="link-existing"><option value="">独立活动 / 手动填写关联ID</option>${state.records.filter(r=>r.year===(record?.year||state.settings.year)&&r.id!==recordId).slice(-500).reverse().map(r=>`<option value="${r.id}">${esc(r.date+' · '+r.name)}</option>`).join('')}</select><small>同一活动申报不同板块时选中已有活动，以便识别互斥。</small></label><label class="field"><span>同一活动关联ID（可选）</span><input name="linkId" maxlength="300" value="${esc(record?.linkId||'')}" placeholder="同一事实在不同细则中保持一致"><small>未填时用名称+日期识别；改名或跨日活动建议明确关联ID。论文/项目另以稳定编号识别。</small></label><label class="field"><span>申报归属</span><select name="claim">${[['auto','按规则自动判断'],['selected','冲突时优先申报本记录所属项'],['excluded','仅留存，不申报计分'],['pending','待学院核定，暂不计分']].map(([v,l])=>`<option value="${v}" ${(record?.claim||'auto')===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="field"><span>备注</span><textarea name="notes" maxlength="5000" placeholder="活动内容、学院要求或补充说明">${esc(record?.notes||'')}</textarea></label><div class="form-section">证据照片 <span id="photo-count" class="muted"></span></div><div class="photo-adders">${button('拍照添加','camera','secondary','','camera')}${button('选择多张照片','album','secondary','','image')}</div><input type="file" id="camera-input" accept="image/*" capture="environment" hidden><input type="file" id="album-input" accept="image/*" multiple hidden><div id="evidence-grid" class="evidence-grid"></div><p class="form-hint">照片仅保存到本机，不上传服务器。保留原图，单张≤40MB；每条最多100张。HEIC等格式是否可预览由浏览器决定，原文件仍可备份。</p><div id="record-error" class="form-error" hidden></div></div><footer class="modal-footer">${button('取消','close-dialog','outline')}<button type="submit" class="btn" id="save-record">${icon('check')}保存并重算</button></footer></form>`;
  renderDynamicFields(record?.fields||{});dialog.showModal();await renderPhotos();
}
function renderDynamicFields(values={}){
  const rule=rules.find(r=>r.id===ctx.ruleId);
  document.getElementById('dynamic-fields').innerHTML=getFields(rule,state).map(d=>renderField(d,values[d.key]??'')).join('')||'<p class="form-hint" style="margin-bottom:20px">本细则按记录次数或固定条件计算，无额外分值输入。</p>';
  document.getElementById('rule-hint').innerHTML=`<div><p class="tiny">${esc(rule.summary)}</p><a class="tiny" href="${sourceUrl(rule.page)}" target="_blank" rel="noopener">原文第${rule.page}页 · 查看依据</a></div>`;
}
async function renderPhotos(){
  if(!ctx)return;const current=ctx;for(const url of current.urls)URL.revokeObjectURL(url);current.urls=[];
  const photos=[];
  for(const id of current.keep){const p=current.newPhotos.find(x=>x.id===id)||await db.photo(id);if(p)photos.push(p);}
  if(ctx!==current)return;
  document.getElementById('photo-count').textContent=`${photos.length} 张`;
  document.getElementById('evidence-grid').innerHTML=photos.map(p=>{const url=URL.createObjectURL(p.blob);current.urls.push(url);return `<div class="evidence-tile"><button type="button" class="preview-btn" data-action="preview" data-id="${p.id}" aria-label="预览${esc(p.name)}"><img src="${url}" alt="${esc(p.name)}" loading="lazy"></button><button type="button" class="remove-photo" data-action="remove-photo" data-id="${p.id}" aria-label="移除照片">${icon('close')}</button></div>`;}).join('');
}
function closeDialog(){if(ctx?.saving)return;closeViewer();dialog.close();for(const url of ctx?.urls||[])URL.revokeObjectURL(url);ctx=null;}
async function addPhotos(files){
  if(!ctx)return;const current=ctx;
  if(current.keep.length+files.length>100)throw new Error('每条记录最多100张照片');
  const created=[];
  for(const file of files){const p=await createEvidence(file);if(ctx!==current)return;created.push(p);}
  current.newPhotos.push(...created);current.keep.push(...created.map(p=>p.id));
  await renderPhotos();
}
async function saveRecord(form){
  if(!ctx||ctx.saving)return;const current=ctx;current.saving=true;
  const submit=document.getElementById('save-record');submit.disabled=true;submit.textContent='正在保存原始照片…';
  try{
    const data=new FormData(form),rule=rules.find(r=>r.id===current.ruleId),fields={};
    for(const d of getFields(rule,state)){const value=data.get(`f_${d.key}`);fields[d.key]=d.type==='number'&&value!==''?Number(value):String(value??'');}
    const existing=current.record;
    const record={id:existing?.id||uid(),ruleId:rule.id,name:String(data.get('name')).trim(),date:String(data.get('date')),year:String(data.get('recordYear')),count:Number(data.get('count')),linkId:String(data.get('linkId')||'').trim(),claim:String(data.get('claim')),notes:String(data.get('notes')||''),fields,evidence:[...current.keep],createdAt:existing?.createdAt||isoNow(),updatedAt:isoNow()};
    const next=clone(state);const index=next.records.findIndex(r=>r.id===record.id);
    if(index>=0)next.records[index]=record;else next.records.push(record);
    const saved=await persist(next,current.newPhotos.filter(p=>current.keep.includes(p.id)));
    current.saving=false;closeDialog();
    if(saved.destination!=='browser-pending')toast(saved.destination==='directory'?'已保存到所选目录，分数已重算':'已保存到本机浏览器，分数已重算');
  }catch(e){const error=document.getElementById('record-error');if(error){error.textContent=e.message;error.hidden=false;}toast(e.message);}
  finally{if(ctx===current){current.saving=false;submit.disabled=false;submit.innerHTML=`${icon('check')}保存并重算`;}}
}
async function previewPhoto(id){
  const p=ctx?.newPhotos.find(x=>x.id===id)||await db.photo(id);if(!p)throw new Error('原始证据照片缺失，请导入完整备份');
  closeViewer();viewerUrl=URL.createObjectURL(p.blob);viewer.innerHTML=`<img src="${viewerUrl}" alt="${esc(p.name)}"><p class="viewer-name">${esc(p.name)} · ${fmt(p.size/1024)} KB</p><div class="viewer-actions"><a class="btn secondary" download="${esc(p.name)}" href="${viewerUrl}">${icon('download')}保存原图</a>${button('关闭','close-viewer','outline','','close')}</div><p class="tiny" style="color:#a6b79c">若此格式不能预览，可保存原图后使用手机相册打开。</p>`;viewer.hidden=false;
  // dialog位于top-layer，图像查看器放到同一dialog内可保持正确叠放。
  if(dialog.open)dialog.appendChild(viewer);else document.body.appendChild(viewer);
}
function closeViewer(){viewer.hidden=true;viewer.innerHTML='';if(viewerUrl)URL.revokeObjectURL(viewerUrl);viewerUrl=null;document.body.appendChild(viewer);}
async function showEvidence(recordId){
  const r=state.records.find(x=>x.id===recordId);if(!r)return;
  if(r.evidence.length===1){await previewPhoto(r.evidence[0]);return;}
  closeDialog();dialog.innerHTML=`<header class="modal-header"><h2 id="dialog-title">${esc(r.name)} · 证据照片</h2><button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon('close')}</button></header><div class="modal-body"><p id="gallery-loading" class="form-hint">正在从本机读取原始照片…</p><div class="evidence-grid" id="evidence-grid"></div><p class="form-hint">点击照片查看原图；照片从本机读取。</p></div>`;
  ctx={keep:r.evidence,newPhotos:[],urls:[],saving:false};dialog.showModal();
  const current=ctx;
  const photos=await db.photos(r.evidence);
  if(ctx!==current)return;
  document.getElementById('gallery-loading')?.remove();
  document.getElementById('evidence-grid').innerHTML=photos.map(p=>{const url=URL.createObjectURL(p.blob);ctx.urls.push(url);return `<div class="evidence-tile"><button class="preview-btn" data-action="preview" data-id="${p.id}" aria-label="预览${esc(p.name)}"><img src="${url}" alt="${esc(p.name)}" loading="lazy"></button></div>`;}).join('');
}
async function connect(){
  if(busy)return;
  busy=true;
  try{const connected=await storage.connect(state,async incoming=>{
    if(incoming.revision===state.revision)return 'load';
    return confirm(`此目录已有${incoming.records.length}笔记录。是否读取目录资料并切换？当前浏览器资料将保留恢复点。取消则保持当前资料。`)?'load':'cancel';
  });
  state=connected.state;validateState(state,new Set(rules.map(r=>r.id)));render();
  if(!connected.cancelled){channel?.postMessage({revision:state.revision});toast(storage.currentStatus.message);}
  }finally{busy=false;}
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function exportBackup(){
  if(busy)return;busy=true;
  let handle;
  try{
    // 文件选择器必须在用户点击的激活链内调用，而不是等待打包后才调用。
    if(globalThis.isSecureContext&&typeof showSaveFilePicker==='function'){
      try{handle=await showSaveFilePicker({suggestedName:`综测完整备份_${today()}.zip`,types:[{description:'完整ZIP备份',accept:{'application/zip':['.zip']}}]});}catch(e){if(e.name==='AbortError')return;throw e;}
    }
    toast('正在核验数据和原始照片，请保持页面打开…',60000);
    const photos=await db.photos(photoIds(state));
    const blob=await createBackup(state,photos,m=>toast(m,60000));
    if(handle){
      const writer=await handle.createWritable();try{await writer.write(blob);await writer.close();}catch(e){try{await writer.abort();}catch{}throw e;}
      const file=await handle.getFile();
      const {digest}=await import('./model.js');if(file.size!==blob.size||await digest(file)!==await digest(blob))throw new Error('备份写入后读回校验失败，未确认成功');
      toast('完整备份已保存到文件，并通过读回校验。',10000);
    }else{download(blob,`综测完整备份_${today()}.zip`);toast('已生成完整备份并发起下载，请到手机“下载”中检查ZIP文件。',12000);}
  }finally{busy=false;}
}
async function importBackup(file){
  if(busy||!file)return;busy=true;
  try{
    toast('正在验证完整备份…',60000);
    const found=await inspectBackup(file,new Set(rules.map(r=>r.id)),m=>toast(m,60000));
    if(!confirm(`备份校验通过：${found.state.records.length}笔记录、${found.photos.length}张原图，当前学年${found.state.settings.year}。确定替换当前资料？会先保留导入前恢复点。`)){toast('已取消导入');return;}
    for(const p of found.photos){const old=await db.photo(p.id);if(old&&old.sha256!==p.sha256)throw new Error('备份照片标识与本机不同照片冲突，已停止以保护原资料');}
    await db.recovery(state);busy=false;
    const saved=await persist(found.state,found.photos);
    if(saved.destination!=='browser-pending')toast('完整备份已导入，记录和所有证据照片已保存。',10000);
  }finally{busy=false;}
}
async function submitSettings(form){
  const data=new FormData(form),next=clone(state),oldYear=state.settings.year;
  const year=String(data.get('year')).trim();
  next.settings={...next.settings,year,grade:String(data.get('grade')),startDate:String(data.get('startDate')),endDate:String(data.get('endDate')),rangeConfirmed:data.get('rangeConfirmed')==='on',academicMisconduct:String(data.get('academicMisconduct')),conductViolation:String(data.get('conductViolation')),hygieneFailures:data.get('hygieneFailures')===''?null:Number(data.get('hygieneFailures'))};
  if(year!==oldYear){
    // 年度否决状态不跨学年继承；旧学年的状态保存在年度配置中。
    next.settings.years={...(next.settings.years||{}),[oldYear]:{grade:state.settings.grade,startDate:state.settings.startDate,endDate:state.settings.endDate,rangeConfirmed:state.settings.rangeConfirmed,academicMisconduct:state.settings.academicMisconduct,conductViolation:state.settings.conductViolation,hygieneFailures:state.settings.hygieneFailures}};
    const saved=next.settings.years[year];
    if(saved)Object.assign(next.settings,saved);
    else{
      const y=Number(year.slice(0,4));Object.assign(next.settings,{grade:'',startDate:`${y}-09-01`,endDate:`${y+1}-08-31`,rangeConfirmed:false,academicMisconduct:'unknown',conductViolation:'unknown',hygieneFailures:null});
    }
  }
  await persist(next);toast(year!==oldYear?'已切换学年，请核对此学年的年级、日期和年度状态':'设置已保存，预估分已重算');
}
async function submitPolicies(form){
  const data=new FormData(form),next=clone(state);
  for(const [key]of POLICY_NOTES)if(data.has(`p_${key}`))next.settings.policies[key]=String(data.get(`p_${key}`));
  next.settings.policyAcknowledged=data.get('acknowledged')==='on';
  next.settings.policyConfirmedAt=isoNow();await persist(next);toast('规划口径已保存，分数已重新计算');
}

document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-action]');if(!target)return;const action=target.dataset.action;
  if(busy&&!['preview','close-viewer','close-dialog'].includes(action)){toast('正在处理保存或备份，请稍候');return;}
  try{
    switch(action){
      case 'add':await openRecord(target.dataset.rule,null,target.dataset.board);break;
      case 'edit':await openRecord(null,target.dataset.id);break;
      case 'close-dialog':closeDialog();break;
      case 'camera':document.getElementById('camera-input').click();break;
      case 'album':document.getElementById('album-input').click();break;
      case 'remove-photo':if(ctx&&!ctx.saving){ctx.keep=ctx.keep.filter(id=>id!==target.dataset.id);await renderPhotos();}break;
      case 'preview':await previewPhoto(target.dataset.id);break;
      case 'close-viewer':closeViewer();break;
      case 'evidence':await showEvidence(target.dataset.id);break;
      case 'delete':{
        const r=state.records.find(x=>x.id===target.dataset.id);if(r&&confirm(`删除“${r.name}”？本学年分数会重算，已导出的备份不受影响。`)){const next=clone(state);next.records=next.records.filter(x=>x.id!==r.id);await persist(next);toast('记录已删除，预估分已重算');}break;
      }
      case 'connect':await connect();break;
      case 'retry':{
        if(storage.mode!=='directory'){toast('请先选择保存目录');break;}
        if(!storage.root||await storage.handle?.queryPermission({mode:'readwrite'})!=='granted')await storage.reauthorize();
        await storage.save(state);render();toast(storage.currentStatus.message,10000);break;
      }
      case 'use-browser':await storage.useBrowser();render();break;
      case 'export':await exportBackup();break;
      case 'import':document.getElementById('backup-input').click();break;
      case 'recover':{
        const old=await db.latestRecovery();if(!old){toast('还没有导入或切换目录前的恢复点');break;}
        if(confirm(`恢复最近保存的${old.records.length}笔记录？当前资料会成为新的恢复点。`)){await db.recovery(state);await persist(old);toast('已恢复资料并重新计算');}break;
      }
      case 'persist':{
        if(navigator.storage?.persist){persistent=await navigator.storage.persist();render();toast(persistent?'浏览器允许持久存储，仍建议定期备份':'浏览器未授予持久存储，请定期导出完整备份');}else toast('此浏览器未提供持久存储请求，请手动备份');break;
      }
      case 'install-help':{
        if(installEvent){await installEvent.prompt();installEvent=null;}
        else alert('安卓：先通过HTTPS网址打开并等待首次加载完成，再在浏览器菜单选择“安装应用”或“添加到主屏幕”。本机HTTP局域网网址通常无法安装。离线需先打开过本应用并完成缓存；原始PDF首次也会缓存。安装不等于数据已备份。');break;
      }
    }
  }catch(e){toast(e.name==='AbortError'?'操作已取消':e.message,12000);}
});
document.addEventListener('change',async event=>{
  const target=event.target;
  try{
    if(target.id==='record-board'&&ctx){ctx.board=target.value;ctx.ruleId=rules.find(r=>r.board===target.value).id;document.getElementById('record-rule').innerHTML=ruleOptions(ctx.board,ctx.ruleId);renderDynamicFields();}
    if(target.id==='record-rule'&&ctx){ctx.ruleId=target.value;renderDynamicFields();}
    if(target.id==='link-existing'&&target.value){const r=state.records.find(x=>x.id===target.value);document.querySelector('[name=linkId]').value=r.linkId||`${r.name}|${r.date}`;}
    if(['camera-input','album-input'].includes(target.id)){await addPhotos([...target.files]);target.value='';}
    if(target.id==='backup-input'){await importBackup(target.files[0]);target.value='';}
  }catch(e){toast(e.message,12000);}
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!['record-form','settings-form','policy-form','search-form'].includes(form.id))return;event.preventDefault();
  try{
    if(form.id==='record-form')await saveRecord(form);
    if(form.id==='settings-form')await submitSettings(form);
    if(form.id==='policy-form')await submitPolicies(form);
    if(form.id==='search-form'){query=String(new FormData(form).get('query')||'');render();}
  }catch(e){const error=document.getElementById('settings-error');if(error){error.textContent=e.message;error.hidden=false;}toast(e.message,12000);}
});
dialog.addEventListener('cancel',event=>{event.preventDefault();if(!viewer.hidden)closeViewer();else closeDialog();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!viewer.hidden){event.preventDefault();closeViewer();}});
window.addEventListener('hashchange',()=>{query='';render();window.scrollTo({top:0,behavior:'instant'});});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installEvent=event;});
window.addEventListener('beforeunload',event=>{if(busy||ctx?.record||ctx?.newPhotos?.length){event.preventDefault();event.returnValue='';}});
channel?.addEventListener('message',event=>{if(state&&event.data.revision!==state.revision){stale=true;render();toast('另一标签页已更新资料，请刷新本页后继续编辑。',12000);}});
try{
  rules=await loadRules();db=await new LocalDB().open();storage=new Storage(db,new Set(rules.map(r=>r.id)),renderStatus);
  state=await storage.initialize(newState());validateState(state,new Set(rules.map(r=>r.id)));render();
  db.usage().then(value=>{usage=value;if(route().name==='storage')render();}).catch(()=>{});
  if(navigator.storage?.persisted)navigator.storage.persisted().then(value=>{persistent=value;if(route().name==='storage')render();}).catch(()=>{});
  if('serviceWorker' in navigator&&isSecureContext){navigator.serviceWorker.register(new URL('../service-worker.js',import.meta.url)).then(()=>{window.dispatchEvent(new Event('planner-ready'));}).catch(error=>{toast('离线缓存暂不可用，联网时仍可使用：'+error.message);});}
  window.dispatchEvent(new Event('planner-ready'));
}catch(error){app.innerHTML=`<main class="fatal"><span class="brand-mark">综</span><h1 style="margin-top:20px">暂时无法打开本机资料</h1><p>${esc(error.message)}</p><p>请勿清除浏览器数据。先重试刷新，或检查浏览器存储权限；若资料版本不同，请使用原版本导出备份。</p><a href="" class="btn" style="margin-top:20px">重新加载</a></main>`;console.error(error);}
