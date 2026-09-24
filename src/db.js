import pg from "pg";
import dotenv from "dotenv";
dotenv.config();
const {Pool}=pg;
export const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,max:Number(process.env.DB_POOL_MAX||10)});
export const q=(text,params)=>pool.query(text,params);
