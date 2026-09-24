import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
const url=process.env.DATABASE_URL;if(!url)throw new Error("DATABASE_URL is required");
const dir=path.resolve(process.env.BACKUP_DIR||"./backups");await fs.mkdir(dir,{recursive:true});const stamp=new Date().toISOString().replace(/[:.]/g,"-");const file=path.join(dir,`vibemeet-${stamp}.dump`);
await new Promise((resolve,reject)=>{const p=spawn(process.env.PG_DUMP_BIN||"pg_dump",[url,"--format=custom","--file",file],{stdio:"inherit"});p.on("error",reject);p.on("exit",code=>code===0?resolve():reject(new Error(`pg_dump exited with ${code}`)));});console.log(`Database backup created: ${file}`);
