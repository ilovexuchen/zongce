import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.pdf':'application/pdf','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
export function createServer(port=Number(process.env.PORT)||4173,host='127.0.0.1'){
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/,''),file=path.resolve(root,relative);
      if(!file.startsWith(root+path.sep)||relative.split(/[\\/]/).some(s=>s.startsWith('.')||s==='node_modules'||s==='test-results')){res.writeHead(403);res.end('Forbidden');return;}
      const info=await stat(file);if(!info.isFile())throw new Error('Not a file');
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(await readFile(file));
    }catch{res.writeHead(404);res.end('Not found');}
  });
  server.listen(port,host,()=>console.log(`综测规划预览：http://${host}:${server.address().port}`));return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))createServer(Number(process.argv[2])||Number(process.env.PORT)||4173,process.argv.includes('--lan')?'0.0.0.0':'127.0.0.1');
