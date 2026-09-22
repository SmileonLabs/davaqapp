import {build} from "esbuild";
import {mkdir,copyFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const out=path.join(root,"artifacts/api-server/.davaq-integration");
await mkdir(out,{recursive:true});
await build({entryPoints:[path.join(root,"artifacts/api-server/tests/davaq.integration.mjs")],outfile:path.join(out,"test.mjs"),bundle:true,platform:"node",format:"esm",alias:{"pg":path.join(root,"lib/db/node_modules/pg/lib/index.js"),"@workspace/db":path.join(root,"lib/db/src/index.ts")},external:["pg-native","*.node"],banner:{js:"import { createRequire } from 'node:module';const require=createRequire(import.meta.url);"},plugins:[{name:"isolated-test-boundaries",setup(b){
 b.onResolve({filter:/\/lib\/auth$/},args=>({path:"auth",namespace:"test-only"}));
 b.onResolve({filter:/\/lib\/rateLimit$/},args=>({path:"rate",namespace:"test-only"}));
 b.onResolve({filter:/(?:^|\/)realtime$/},args=>({path:"realtime",namespace:"test-only"}));
 b.onResolve({filter:/(?:^|\/)push$/},args=>({path:"push",namespace:"test-only"}));
 b.onLoad({filter:/.*/,namespace:"test-only"},args=>({loader:"js",resolveDir:root,contents:args.path==="auth"?`import {pool} from "@workspace/db";export async function requireAuth(req,res,next){const id=req.get("x-test-user");if(!id)return res.status(401).json({message:"test auth required"});const row=(await pool.query("SELECT * FROM users WHERE id=$1",[id])).rows[0];if(!row)return res.status(401).json({message:"unknown test user"});req.dbUser={...row,clerkId:row.clerk_id};next();}`:args.path==="rate"?"export const rateLimit=()=> (req,res,next)=>next();":args.path==="realtime"?"export async function publishRealtimeEvent(){}":"export async function sendPushToUser(){};export async function sendPushToUsers(){}"}));
}}]});
for(const file of ["0029_davaq_exchange.sql","0030_davaq_media_learning.sql","0031_davaq_request_keys.sql","0032_davaq_operational_state.sql","0033_davaq_brand_exchange.sql","0034_davaq_chat_transport.sql","0035_davaq_messenger_actions.sql"])await copyFile(path.join(root,"lib/db/drizzle",file),path.join(out,file));
console.log("Built isolated DavaQ integration harness.");
