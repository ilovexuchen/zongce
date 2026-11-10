import {digest,validateState,IMAGE_TYPES,clone} from './model.js';
export const photoIds=state=>[...new Set(state.records.flatMap(r=>r.evidence))];
const metadata=p=>Object.fromEntries(Object.entries(p).filter(([k])=>k!=='blob'));
const missing=e=>e?.name==='NotFoundError';
const safeId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{8,80}$/.test(id);
const safeRevision=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{8,80}$/.test(id);
export function validateEvidence(p){
  if(!p||!safeId(p.id)||!IMAGE_TYPES.has(p.mime)||IMAGE_TYPES.get(p.mime)!==p.ext||!Number.isInteger(p.size)||p.size<1||p.size>40*1024*1024||!/^[a-f0-9]{64}$/.test(p.sha256||'')||typeof p.name!=='string'||p.name.length>200)throw new Error('证据照片元数据无效');
  return p;
}
export async function verifiedWrite(directory,name,blob){
  const file=await directory.getFileHandle(name,{create:true});
  const writer=await file.createWritable();
  try{await writer.write(blob);await writer.close();}catch(error){try{await writer.abort();}catch{}throw error;}
  const read=await file.getFile();
  if(read.size!==blob.size||await digest(read)!==await digest(blob))throw new Error(`文件读回校验失败：${name}`);
  return read;
}
export async function readPointer(root){
  try{
    const file=await (await root.getFileHandle('current.json')).getFile();
    if(file.size>10000)throw new Error('目录提交指针过大或损坏');
    const pointer=JSON.parse(await file.text());
    if(!safeRevision(pointer.revision)||!safeId(pointer.datasetId))throw new Error('目录提交指针无效');
    return pointer;
  }catch(e){if(missing(e))return null;throw e;}
}
async function readSnapshot(root,filename,ruleIds,progress=()=>{}){
  if(!/^[a-zA-Z0-9_-]{8,80}\.json$/.test(filename))throw new Error('快照文件名无效');
  const folder=await root.getDirectoryHandle('snapshots');
  const file=await (await folder.getFileHandle(filename)).getFile();
  if(file.size>32*1024*1024)throw new Error('资料快照过大');
  const snap=JSON.parse(await file.text());
  validateState(snap.data,ruleIds);
  if(!Array.isArray(snap.evidence)||snap.evidence.length>20000)throw new Error('照片目录格式错误');
  const expected=photoIds(snap.data),photoMap=new Map();
  for(const p of snap.evidence){validateEvidence(p);if(photoMap.has(p.id))throw new Error('目录包含重复照片标识');photoMap.set(p.id,p);}
  const photos=[];
  if(expected.length){
    const photoDir=await root.getDirectoryHandle('evidence');
    for(const id of expected){
      const p=photoMap.get(id);if(!p)throw new Error('快照缺少照片清单');
      const blob=await (await photoDir.getFileHandle(`${p.id}.${p.ext}`)).getFile();
      if(blob.size!==p.size||await digest(blob)!==p.sha256)throw new Error(`照片缺失或损坏：${p.name}`);
      photos.push({...p,blob:new Blob([blob],{type:p.mime})});progress(`正在读取证据 ${photos.length}/${expected.length}`);
    }
  }
  return {state:snap.data,photos};
}
export async function readDirectory(root,ruleIds,progress){
  let pointer,error,pointerHash=null;
  try{pointer=await readPointer(root);if(pointer){const result=await readSnapshot(root,`${pointer.revision}.json`,ruleIds,progress);if(result.state.id!==pointer.datasetId||result.state.revision!==pointer.revision)throw new Error('快照与提交指针不一致');return {...result,pointer,recovered:false};}}catch(e){error=e;try{pointerHash=await digest(await(await root.getFileHandle('current.json')).getFile());}catch{}}
  // 指针未完成或损坏时只读取经过数据和所有照片校验的最近快照，不自动覆盖任何旧文件。
  let folder;
  try{folder=await root.getDirectoryHandle('snapshots');}catch(e){if(missing(e)&&!error)return null;throw error||e;}
  const files=[];
  for await(const [name,handle] of folder.entries())if(handle.kind==='file'&&/^[a-zA-Z0-9_-]{8,80}\.json$/.test(name)){const f=await handle.getFile();files.push({name,modified:f.lastModified});if(files.length>20000)throw new Error('目录快照过多，请备份后手动归档');}
  files.sort((a,b)=>b.modified-a.modified);
  for(const entry of files.slice(0,30)){
    try{return {...await readSnapshot(root,entry.name,ruleIds,progress),pointer:pointer||null,recovered:true,pointerHash};}catch(e){error=e;}
  }
  if(error)throw new Error(`目录没有可恢复的完整版本：${error.message}`);
  if(files.length)throw new Error('目录包含快照但没有完整可读取版本');
  return null;
}
export class Storage {
  constructor(db,ruleIds,onStatus=()=>{}){this.db=db;this.ruleIds=ruleIds;this.onStatus=onStatus;this.mode='browser';this.root=null;this.queue=Promise.resolve();this.expected=null;}
  status(kind,message,extra={}){this.currentStatus={kind,message,...extra};this.onStatus(this.currentStatus);}
  get supported(){return globalThis.isSecureContext&&typeof globalThis.showDirectoryPicker==='function';}
  async initialize(fallback){
    const stored=await this.db.get('state');
    let state=stored||fallback;this.localRevision=stored?.revision||null;
    const prefs=await this.db.get('storage')||{mode:'browser'};
    this.mode=prefs.mode;
    this.expected=prefs.expected||null;
    if(this.mode==='directory'){
      this.handle=await this.db.get('directoryHandle');
      if(!this.handle){this.status('permission','目录句柄已失效，请重新选择原目录；当前显示浏览器暂存资料');return state;}
      try{
        if(await this.handle.queryPermission({mode:'readwrite'})!=='granted'){this.status('permission','目录需重新授权；当前显示浏览器暂存资料');return state;}
        this.root=await this.handle.getDirectoryHandle('综测规划数据');
        const pending=!!stored&&state.revision!==this.expected?.revision;
        if(pending){this.status('pending','有尚未写入目录的浏览器暂存修改，请点击重试保存');return state;}
        const found=await readDirectory(this.root,this.ruleIds,message=>this.status('busy',message));
        if(!found)throw new Error('已连接目录缺少资料，请重新授权或从备份恢复');
        state=found.state;await this.db.save(state,found.photos);this.localRevision=state.revision;this.expected=found.pointer;this.recoveryPointerHash=found.pointerHash;
        await this.persistPrefs();
        this.status(found.recovered?'pending':'directory',found.recovered?'已恢复完整快照，请重试提交目录指针':`已从目录恢复 · ${this.handle.name}`,{time:state.updatedAt});
      }catch(e){this.status('error',`目录读取失败：${e.message}；浏览器暂存资料仍保留`);}
    }else this.status('browser',stored?(this.supported?'已从本机浏览器恢复 · 可连接手机目录':'已从本机浏览器恢复 · 当前无法直接读写目录'):(this.supported?'浏览器本地模式 · 尚无保存记录，可连接手机目录':'浏览器本地模式 · 尚无保存记录；当前无法直接读写目录'),stored?{time:state.updatedAt}:{});
    return state;
  }
  async persistPrefs(){await this.db.set('storage',{mode:this.mode,expected:this.expected});}
  async connect(state,chooseExisting){
    if(!this.supported)throw new Error('当前浏览器或页面环境不支持目录直接读写。可使用浏览器本地保存与完整备份。');
    let handle;
    try{handle=await showDirectoryPicker({id:'zongce-planner-directory',mode:'readwrite'});}catch(e){if(e.name==='AbortError'){this.status('info','已取消选择目录，现有保存方式保持不变');return {state,cancelled:true};}throw e;}
    const root=await handle.getDirectoryHandle('综测规划数据',{create:true});
    const found=await readDirectory(root,this.ruleIds,m=>this.status('busy',m));
    if(found){
      const action=await chooseExisting(found.state,state);
      if(action==='cancel')return {state,cancelled:true};
      await this.db.recovery(state);
      if(action==='load'){state=found.state;await this.db.save(state,found.photos);this.localRevision=state.revision;}
      this.expected=found.pointer;this.recoveryPointerHash=found.pointerHash;
    }else this.expected=null;
    this.handle=handle;this.root=root;this.mode='directory';
    await this.db.set('directoryHandle',handle);await this.persistPrefs();
    const result=await this.save(state);
    return {state,result};
  }
  async reauthorize(){
    if(!this.handle)throw new Error('没有可恢复的目录句柄，请重新选择原目录');
    const permission=await this.handle.requestPermission({mode:'readwrite'});
    if(permission!=='granted')throw new Error('未获得目录读写授权，修改仍暂存在浏览器');
    this.root=await this.handle.getDirectoryHandle('综测规划数据',{create:true});
  }
  async useBrowser(){this.mode='browser';this.root=null;await this.persistPrefs();this.status('browser','已切换为浏览器本地保存；请定期导出完整备份');}
  save(state,newPhotos=[]){
    const frozen=clone(state);
    const run=this.queue.catch(()=>{}).then(()=>globalThis.navigator?.locks?.request?globalThis.navigator.locks.request('zongce-planner-save',()=>this._save(frozen,newPhotos)):this._save(frozen,newPhotos));
    this.queue=run;
    return run;
  }
  async _save(state,newPhotos){
    validateState(state,this.ruleIds);
    this.status('busy','正在保存…');
    const existing=await this.db.get('state');
    if((existing?.revision||null)!==(this.localRevision||null))throw new Error('另一标签页已保存新资料，请刷新后继续，未覆盖原数据');
    const ids=photoIds(state),fresh=new Map(newPhotos.map(p=>[p.id,p]));
    for(const p of newPhotos)validateEvidence(p);
    const photos=[];
    for(const id of ids){const p=fresh.get(id)||await this.db.photo(id);if(!p?.blob||p.blob.size!==p.size)throw new Error('有证据照片尚未持久保存，请重新选择或恢复备份');photos.push(p);}
    try{await this.db.save(state,newPhotos);this.localRevision=state.revision;}catch(e){this.status('error',`保存失败：${e.name||e.message}。浏览器配额可能不足，请立即备份或减少照片。`);throw e;}
    if(this.mode!=='directory'){this.status('browser','已保存到本机浏览器',{time:state.updatedAt});return {destination:'browser'};}
    try{
      if(!this.root||!this.handle||await this.handle.queryPermission({mode:'readwrite'})!=='granted')throw new Error('目录权限失效，请重新授权');
      let pointer;
      try{pointer=await readPointer(this.root);}catch(error){
        if(!this.recoveryPointerHash||await digest(await(await this.root.getFileHandle('current.json')).getFile())!==this.recoveryPointerHash)throw error;
        pointer=this.expected; // 已核验完整快照，且损坏指针未被他处修改：允许用户重试修复。
      }
      if((pointer?.revision||null)!==(this.expected?.revision||null))throw new Error('目录已有其他页面或设备写入的新版本，请重新连接并选择读取，避免覆盖');
      const photoDir=await this.root.getDirectoryHandle('evidence',{create:true});
      let index=0;
      for(const p of photos){
        this.status('busy',`正在核验并写入照片 ${++index}/${photos.length}`);
        let exists=false;
        try{const file=await(await photoDir.getFileHandle(`${p.id}.${p.ext}`)).getFile();exists=file.size===p.size&&await digest(file)===p.sha256;}catch(e){if(!missing(e))throw e;}
        if(!exists)await verifiedWrite(photoDir,`${p.id}.${p.ext}`,p.blob);
      }
      const snapshots=await this.root.getDirectoryHandle('snapshots',{create:true});
      const snapshot=new Blob([JSON.stringify({schemaVersion:1,data:state,evidence:photos.map(metadata)})],{type:'application/json'});
      await verifiedWrite(snapshots,`${state.revision}.json`,snapshot);
      const next={revision:state.revision,datasetId:state.id,updatedAt:state.updatedAt};
      await verifiedWrite(this.root,'current.json',new Blob([JSON.stringify(next)],{type:'application/json'}));
      this.expected=next;this.recoveryPointerHash=null;await this.persistPrefs();
      this.status('directory',`已保存到所选目录 · ${this.handle.name}`,{time:state.updatedAt});return {destination:'directory'};
    }catch(e){this.status('pending',`浏览器已暂存；目录未保存：${e.message}`);return {destination:'browser-pending',error:e.message};}
  }
}
