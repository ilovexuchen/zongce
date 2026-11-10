import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {newState,uid,revise,createEvidence,clone} from '../src/model.js';
import {Storage,readDirectory,verifiedWrite} from '../src/storage-directory.js';
import {createBackup,inspectBackup} from '../src/backup.js';
const rules=JSON.parse(await readFile(new URL('../src/rules-data.json',import.meta.url),'utf8'));
const ids=new Set(rules.map(r=>r.id));
async function fixture(){
  const state=newState(),p=await createEvidence(new File([new Uint8Array([137,80,78,71,13,10,26,10,22,33])],'测试照片.png',{type:'image/png'}));
  state.records.push({id:uid(),ruleId:'D-B04',name:'带证据的讲座',date:'2026-11-10',year:state.settings.year,count:2,linkId:'',claim:'auto',notes:'test',fields:{},evidence:[p.id],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  return {state,photos:[p]};
}
class FakeDB{
  constructor(){this.meta=new Map();this.images=new Map();this.history=[];}
  async get(k){return this.meta.get(k);}
  async set(k,v){this.meta.set(k,k==='directoryHandle'?v:clone(v));}
  async photo(id){return this.images.get(id);}
  async save(state,photos=[]){if(this.fail)throw new DOMException('quota','QuotaExceededError');for(const p of photos)this.images.set(p.id,p);this.meta.set('state',clone(state));}
  async recovery(s){this.history.push(clone(s));}
}
class MemDir{
  constructor(name='test'){this.name=name;this.files=new Map();this.dirs=new Map();this.kind='directory';this.permission='granted';this.closed=[];}
  async queryPermission(){return this.permission;}
  async requestPermission(){return this.permission;}
  async getDirectoryHandle(name,{create=false}={}){if(!this.dirs.has(name)){if(!create)throw new DOMException('missing','NotFoundError');this.dirs.set(name,new MemDir(name));}return this.dirs.get(name);}
  async getFileHandle(name,{create=false}={}){
    if(!this.files.has(name)&&!create)throw new DOMException('missing','NotFoundError');
    const root=this;
    return {kind:'file',name,async getFile(){const value=root.files.get(name);if(!value)throw new DOMException('missing','NotFoundError');return new File([value],name,{lastModified:root.times?.get(name)||Date.now()});},async createWritable(){let staged;return {async write(blob){if(root.failWrite)throw new DOMException('denied','NotAllowedError');staged=blob instanceof Blob?blob:new Blob([blob]);},async close(){if(root.failClose)throw new Error('disk full');root.files.set(name,staged);root.closed.push(name);root.times??=new Map();root.times.set(name,Date.now());},async abort(){staged=null;}};}};
  }
  async *entries(){for(const [name]of this.files)yield [name,await this.getFileHandle(name)];}
}
async function storageFixture(){const data=await fixture(),db=new FakeDB(),root=new MemDir(),handle=new MemDir('手机选择目录'),statuses=[];handle.dirs.set('综测规划数据',root);const storage=new Storage(db,ids,s=>statuses.push(s));storage.mode='directory';storage.root=root;storage.handle=handle;return {...data,db,root,handle,storage,statuses};}

test('完整ZIP备份含原图且字节校验往返一致',async()=>{
  const {state,photos}=await fixture();const blob=await createBackup(state,photos);const loaded=await inspectBackup(blob,ids);
  assert.deepEqual(loaded.state,state);assert.equal(loaded.photos.length,1);assert.equal(loaded.photos[0].sha256,photos[0].sha256);assert.deepEqual(new Uint8Array(await loaded.photos[0].blob.arrayBuffer()),new Uint8Array(await photos[0].blob.arrayBuffer()));
});
test('没有照片也能完整备份与导入',async()=>{const state=newState();const loaded=await inspectBackup(await createBackup(state,[]),ids);assert.equal(loaded.photos.length,0);assert.equal(loaded.state.id,state.id);});
test('备份缺少任何照片必须失败，不能生成假完整备份',async()=>{const {state}=await fixture();await assert.rejects(createBackup(state,[]),/缺失照片/);});
test('照片字节改变时备份拒绝',async()=>{const {state,photos}=await fixture();photos[0].blob=new Blob(['tampered'],{type:'image/png'});await assert.rejects(createBackup(state,photos),/校验/);});
test('ZIP截断与内容损坏导入拒绝',async()=>{const {state,photos}=await fixture(),blob=await createBackup(state,photos);await assert.rejects(inspectBackup(blob.slice(0,blob.size-5),ids));const bytes=new Uint8Array(await blob.arrayBuffer());bytes[80]^=1;await assert.rejects(inspectBackup(new Blob([bytes]),ids));});
test('非本工具压缩ZIP和不安全路径拒绝',async()=>{const blob=await createBackup(newState(),[]),bytes=new Uint8Array(await blob.arrayBuffer());const needle=new TextEncoder().encode('data.json');for(let i=0;i<=bytes.length-needle.length;i++)if(needle.every((v,j)=>bytes[i+j]===v))bytes.set(new TextEncoder().encode('../x.json'),i);await assert.rejects(inspectBackup(new Blob([bytes]),ids),/不安全|不一致/);});
test('导入先验证规则版本，不在不同规则间静默重算',async()=>{const state=newState();state.ruleVersion='future-version';await assert.rejects(createBackup(state,[]),/规则版本/);});
test('文件write和close完成并读回后才成功',async()=>{const root=new MemDir();await verifiedWrite(root,'x.json',new Blob(['hello']));assert.deepEqual(root.closed,['x.json']);root.failClose=true;await assert.rejects(verifiedWrite(root,'next.json',new Blob(['no'])));assert.equal(root.files.has('next.json'),false);});
test('目录照片、快照与指针均真实写入，可重新读取原图',async()=>{const {storage,state,photos,root,statuses}=await storageFixture();const saved=await storage.save(state,photos);assert.equal(saved.destination,'directory');assert.equal(statuses.at(-1).kind,'directory');assert.ok(root.files.has('current.json'));const restored=await readDirectory(root,ids);assert.deepEqual(restored.state,state);assert.equal(restored.photos[0].sha256,photos[0].sha256);});
test('权限失效：浏览器暂存成功，但绝不能显示已写入目录',async()=>{const {storage,state,photos,handle,root,statuses,db}=await storageFixture();handle.permission='denied';const saved=await storage.save(state,photos);assert.equal(saved.destination,'browser-pending');assert.equal(statuses.at(-1).kind,'pending');assert.equal(root.files.has('current.json'),false);assert.equal((await db.get('state')).revision,state.revision);});
test('照片写入失败：不提交数据指针；浏览器仍保留真实照片',async()=>{const f=await storageFixture();const photoDir=await f.root.getDirectoryHandle('evidence',{create:true});photoDir.failClose=true;const saved=await f.storage.save(f.state,f.photos);assert.equal(saved.destination,'browser-pending');assert.equal(f.root.files.has('current.json'),false);assert.ok((await f.db.photo(f.photos[0].id)).blob);});
test('快照写入失败不谎报成功，也不更改上一提交指针',async()=>{const f=await storageFixture();await f.storage.save(f.state,f.photos);const oldPointer=await f.root.files.get('current.json').text();const snapshots=await f.root.getDirectoryHandle('snapshots');snapshots.failClose=true;const next=revise(clone(f.state));next.records[0].count=3;const saved=await f.storage.save(next);assert.equal(saved.destination,'browser-pending');assert.equal(await f.root.files.get('current.json').text(),oldPointer);});
test('磁盘指针损坏时恢复最近完整快照，照片损坏则拒绝假恢复',async()=>{const f=await storageFixture();await f.storage.save(f.state,f.photos);f.root.files.set('current.json',new Blob(['not-json']));const restored=await readDirectory(f.root,ids);assert.equal(restored.recovered,true);const photoDir=await f.root.getDirectoryHandle('evidence');photoDir.files.clear();await assert.rejects(readDirectory(f.root,ids),/没有可恢复/);});
test('另一页面更新目录后不静默覆盖',async()=>{const f=await storageFixture();await f.storage.save(f.state,f.photos);f.root.files.set('current.json',new Blob([JSON.stringify({revision:uid(),datasetId:f.state.id})]));const next=revise(clone(f.state));const saved=await f.storage.save(next);assert.equal(saved.destination,'browser-pending');assert.match(saved.error,/其他页面/);});
test('浏览器配额失败必须抛错且不写目录',async()=>{const f=await storageFixture();f.db.fail=true;await assert.rejects(f.storage.save(f.state,f.photos));assert.equal(f.root.files.has('current.json'),false);assert.equal(f.statuses.at(-1).kind,'error');});
test('重启读取浏览器照片；等待提交版本不会被旧目录覆盖',async()=>{const f=await storageFixture();await f.storage.save(f.state,f.photos);const next=revise(clone(f.state));next.records[0].count=7;f.handle.permission='denied';await f.storage.save(next);const second=new Storage(f.db,ids);await f.db.set('directoryHandle',f.handle);const loaded=await second.initialize(newState());assert.equal(loaded.records[0].count,7);assert.equal(second.currentStatus.kind,'permission');});
test('浏览器多标签旧版本不能覆盖最新保存',async()=>{const db=new FakeDB(),state=newState(),a=new Storage(db,ids),b=new Storage(db,ids);await a.initialize(state);await b.initialize(state);await a.save(revise(clone(state)));await assert.rejects(b.save(revise(clone(state))),/另一标签页/);});
test('删除最后一条且目录断权时，重启保留空的待提交版本，不恢复已删除记录',async()=>{const f=await storageFixture();await f.storage.save(f.state,f.photos);f.handle.permission='denied';const next=revise(clone(f.state));next.records=[];await f.storage.save(next);await f.db.set('directoryHandle',f.handle);f.handle.permission='granted';const second=new Storage(f.db,ids);const loaded=await second.initialize(newState());assert.equal(loaded.records.length,0);assert.equal(second.currentStatus.kind,'pending');});
test('损坏指针恢复完整快照后，用户重试可实际修复提交指针',async()=>{const f=await storageFixture();await f.storage.save(f.state,f.photos);f.root.files.set('current.json',new Blob(['broken']));await f.db.set('directoryHandle',f.handle);const second=new Storage(f.db,ids);const loaded=await second.initialize(newState());assert.equal(second.currentStatus.kind,'pending');const saved=await second.save(loaded);assert.equal(saved.destination,'directory');const restored=await readDirectory(f.root,ids);assert.equal(restored.recovered,false);});
