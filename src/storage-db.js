const DB_NAME='zongce-planner-v1';
const request = req => new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('浏览器存储请求失败'));});
const finished = tx => new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('浏览器保存已中止'));tx.onerror=()=>reject(tx.error||new Error('浏览器保存失败'));});
export class LocalDB {
  async open(){
    if(!globalThis.indexedDB)throw new Error('此浏览器不支持IndexedDB，不能可靠保存照片。请更换浏览器。');
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('meta');db.createObjectStore('photos',{keyPath:'id'});db.createObjectStore('recovery',{keyPath:'revision'});};
    this.db=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('另一标签页阻止了存储打开，请关闭旧页面再试'));});
    this.db.onversionchange=()=>this.db.close();
    return this;
  }
  async get(key){return request(this.db.transaction('meta').objectStore('meta').get(key));}
  async set(key,value){const tx=this.db.transaction('meta','readwrite');const done=finished(tx);tx.objectStore('meta').put(value,key);await done;}
  async photo(id){return request(this.db.transaction('photos').objectStore('photos').get(id));}
  async photos(ids){const values=[];for(const id of [...new Set(ids)]){const p=await this.photo(id);if(!p?.blob||p.blob.size!==p.size)throw new Error(`证据照片缺失：${id}。请恢复完整备份，不能把缺图资料当完整资料保存。`);values.push(p);}return values;}
  async save(state,photos=[],expectedRevision=undefined){
    const tx=this.db.transaction(['meta','photos'],'readwrite');
    const done=finished(tx);
    let conflict=null;
    const write=()=>{for(const p of photos)tx.objectStore('photos').put(p);tx.objectStore('meta').put(state,'state');};
    if(expectedRevision!==undefined){
      const req=tx.objectStore('meta').get('state');
      req.onsuccess=()=>{if((req.result?.revision||null)!==expectedRevision){conflict=new Error('另一标签页已保存新版本，未覆盖资料，请刷新后继续');tx.abort();}else write();};
    }else write();
    try{await done;}catch(e){throw conflict||e;}
  }
  async recovery(state){
    const tx=this.db.transaction('recovery','readwrite');const done=finished(tx);
    tx.objectStore('recovery').put(state);await done;
  }
  async latestRecovery(){const rows=await request(this.db.transaction('recovery').objectStore('recovery').getAll());return rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];}
  async usage(){if(!navigator.storage?.estimate)return null;return navigator.storage.estimate();}
}
