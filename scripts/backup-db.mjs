import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
const url=process.env.DATABASE_URL;if(!url)throw new Error("DATABASE_URL is required");
const dir=path.resolve(process.env.BACKUP_DIR||"./backups");await fs.mkdir(dir,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,"-");const file=path.join(dir,`vibemeet-${stamp}.dump`);
const run=(bin,args)=>new Promise((resolve,reject)=>{const p=spawn(bin,args,{stdio:"inherit"});p.on("error",reject);p.on("exit",code=>code===0?resolve():reject(new Error(`${bin} exited with ${code}`)))});
await run(process.env.PG_DUMP_BIN||"pg_dump",[url,"--format=custom","--file",file]);
const stat=await fs.stat(file);if(stat.size<1024)throw new Error("Backup file was created but is unexpectedly small.");
try{await run(process.env.PG_RESTORE_BIN||"pg_restore",["--list",file]);console.log(`Backup verified: ${file}`)}catch(e){console.warn(`Backup created but pg_restore verification was unavailable or failed: ${e.message}`)}
console.log(`Database backup created: ${file}`);
