import {digest,validateState,RULE_VERSION,SCHEMA} from './model.js';
import {photoIds,validateEvidence} from './storage-directory.js';

// 标准ZIP32的Store方法。图片已压缩，备份保存原始字节；无需CDN、base64或解压依赖。
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const MAX_ARCHIVE=1024*1024*1024,MAX_ENTRIES=20002;
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
const write=(size,fn)=>{const b=new Uint8Array(size);fn(new DataView(b.buffer));return b;};
async function zip(files,progress){
  const pieces=[],central=[];let offset=0,index=0;
  for(const entry of files){
    const name=enc.encode(entry.path),bytes=new Uint8Array(await entry.blob.arrayBuffer()),crc=crc32(bytes),size=bytes.length;
    const head=write(30,v=>{v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x0800,true);v.setUint16(8,0,true);v.setUint16(12,0x21,true);v.setUint32(14,crc,true);v.setUint32(18,size,true);v.setUint32(22,size,true);v.setUint16(26,name.length,true);});
    const c=write(46,v=>{v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x0800,true);v.setUint16(14,0x21,true);v.setUint32(16,crc,true);v.setUint32(20,size,true);v.setUint32(24,size,true);v.setUint16(28,name.length,true);v.setUint32(42,offset,true);});
    pieces.push(head,name,entry.blob);central.push(c,name);offset+=head.length+name.length+size;
    if(offset>MAX_ARCHIVE)throw new Error('备份超过1GB，请先按学年分开保管；未生成不完整备份');
    progress?.(`正在打包 ${++index}/${files.length}`);
  }
  const centralSize=central.reduce((n,b)=>n+b.length,0);
  const end=write(22,v=>{v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);});
  return new Blob([...pieces,...central,end],{type:'application/zip'});
}
export async function createBackup(state,photos,progress){
  validateState(state);
  const map=new Map(photos.map(p=>[p.id,p])),expected=photoIds(state),entries=[];
  const data=new Blob([JSON.stringify(state)],{type:'application/json'});
  let totalSize=data.size;
  const manifest={format:'zongce-planner-backup',version:1,schemaVersion:SCHEMA,ruleVersion:RULE_VERSION,exportedAt:new Date().toISOString(),data:{path:'data.json',size:data.size,sha256:await digest(data)},evidence:[]};
  for(const id of expected){
    const p=map.get(id);if(!p?.blob)throw new Error('完整备份失败：存在缺失照片');validateEvidence(p);
    if(p.blob.size!==p.size||await digest(p.blob)!==p.sha256)throw new Error(`照片校验不通过：${p.name}`);
    const meta=Object.fromEntries(Object.entries(p).filter(([k])=>k!=='blob'));
    meta.path=`evidence/${id}.${p.ext}`;manifest.evidence.push(meta);entries.push({path:meta.path,blob:p.blob});totalSize+=p.size;
  }
  if(expected.length+2>MAX_ENTRIES||totalSize>MAX_ARCHIVE)throw new Error('超出备份1GB或20000张照片限制，请减少资料或分学年保存');
  return zip([{path:'manifest.json',blob:new Blob([JSON.stringify(manifest)],{type:'application/json'})},{path:'data.json',blob:data},...entries],progress);
}
async function readEntries(file){
  if(!(file instanceof Blob)||file.size<22||file.size>MAX_ARCHIVE+32*1024*1024)throw new Error('请选择本工具导出的有效ZIP，支持最大约1GB');
  const tailStart=Math.max(0,file.size-65557),tail=new Uint8Array(await file.slice(tailStart).arrayBuffer()),v=new DataView(tail.buffer);
  let end=-1;for(let i=tail.length-22;i>=0;i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===tail.length){end=i;break;}
  if(end<0)throw new Error('ZIP目录缺失或文件截断');
  const count=v.getUint16(end+10,true),length=v.getUint32(end+12,true),offset=v.getUint32(end+16,true);
  if(v.getUint16(end+4,true)||v.getUint16(end+6,true)||v.getUint16(end+8,true)!==count||count<2||count>MAX_ENTRIES||offset+length>tailStart+end||length>8*1024*1024)throw new Error('不支持分卷/ZIP64或异常ZIP目录');
  const central=new DataView(await file.slice(offset,offset+length).arrayBuffer()),map=new Map();let p=0,total=0;
  for(let i=0;i<count;i++){
    if(p+46>central.byteLength||central.getUint32(p,true)!==0x02014b50)throw new Error('ZIP目录损坏');
    const flags=central.getUint16(p+8,true),method=central.getUint16(p+10,true),crc=central.getUint32(p+16,true),compressed=central.getUint32(p+20,true),size=central.getUint32(p+24,true),nameLength=central.getUint16(p+28,true),extra=central.getUint16(p+30,true),comment=central.getUint16(p+32,true),local=central.getUint32(p+42,true);
    if(p+46+nameLength+extra+comment>central.byteLength||flags&1||method!==0||compressed!==size||size>50*1024*1024)throw new Error('只支持本工具的未压缩ZIP备份，或文件大小异常');
    const name=dec.decode(new Uint8Array(central.buffer,p+46,nameLength));
    if(!/^(manifest\.json|data\.json|evidence\/[a-zA-Z0-9_-]{8,80}\.(jpg|png|webp|gif|heic|heif|avif|bmp))$/.test(name)||map.has(name))throw new Error('备份包含不安全路径、重复文件或非预期文件');
    if(local+30>offset)throw new Error('ZIP文件偏移无效');
    const header=new DataView(await file.slice(local,local+30).arrayBuffer());
    if(header.getUint32(0,true)!==0x04034b50||header.getUint16(8,true)!==0)throw new Error('ZIP文件头损坏');
    const nl=header.getUint16(26,true),el=header.getUint16(28,true),start=local+30+nl+el;
    if(start+size>offset)throw new Error('ZIP内容越界');
    const localName=dec.decode(new Uint8Array(await file.slice(local+30,local+30+nl).arrayBuffer()));if(localName!==name)throw new Error('ZIP文件名不一致');
    map.set(name,{size,crc,blob:file.slice(start,start+size)});total+=size;if(total>MAX_ARCHIVE)throw new Error('备份解包大小超过1GB');
    p+=46+nameLength+extra+comment;
  }
  if(p!==central.byteLength)throw new Error('ZIP目录尾部数据异常');
  return map;
}
async function checked(entry){if(!entry)throw new Error('备份缺少必要文件');const bytes=new Uint8Array(await entry.blob.arrayBuffer());if(crc32(bytes)!==entry.crc)throw new Error('备份CRC校验失败，文件可能损坏');return entry.blob;}
export async function inspectBackup(file,ruleIds,progress){
  const entries=await readEntries(file);
  const manifestBlob=await checked(entries.get('manifest.json'));
  if(manifestBlob.size>16*1024*1024)throw new Error('备份清单过大');
  const manifest=JSON.parse(await manifestBlob.text());
  if(manifest.format!=='zongce-planner-backup'||manifest.version!==1||manifest.ruleVersion!==RULE_VERSION||manifest.schemaVersion!==SCHEMA)throw new Error('备份格式/规则版本不匹配，请使用对应版本程序');
  const dataBlob=await checked(entries.get('data.json'));
  if(dataBlob.size!==manifest.data?.size||await digest(dataBlob)!==manifest.data.sha256)throw new Error('资料文件SHA-256校验失败');
  const state=validateState(JSON.parse(await dataBlob.text()),ruleIds);
  if(!Array.isArray(manifest.evidence)||manifest.evidence.length>20000)throw new Error('备份照片清单异常');
  const expected=new Set(photoIds(state)),photos=[],seen=new Set();
  for(const p of manifest.evidence){
    validateEvidence(p);if(seen.has(p.id)||!expected.has(p.id)||p.path!==`evidence/${p.id}.${p.ext}`)throw new Error('照片清单包含重复或无引用照片');seen.add(p.id);
    const blob=await checked(entries.get(p.path));if(blob.size!==p.size||await digest(blob)!==p.sha256)throw new Error(`证据损坏：${p.name}`);
    const {path,...meta}=p;photos.push({...meta,blob:new Blob([blob],{type:p.mime})});progress?.(`正在验证照片 ${photos.length}/${expected.size}`);
  }
  if(expected.size!==seen.size||entries.size!==seen.size+2)throw new Error('备份缺少证据照片或包含额外文件，不能作为完整备份导入');
  return {state,photos,manifest};
}
