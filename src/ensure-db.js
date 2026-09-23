import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {q} from "./db.js";

const here=path.dirname(fileURLToPath(import.meta.url));
export async function ensureDatabase(){
  const schema=await fs.readFile(path.join(here,"../db/schema.sql"),"utf8");
  await q(schema);
  const seed=await fs.readFile(path.join(here,"../db/travel_seed.sql"),"utf8");
  await q(seed);
}
