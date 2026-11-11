// Post-migration runtime verification only. This does not generate or apply schemas.
// Only run against an isolated development database; never production.
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {Client} from 'pg';
const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
const origin=process.argv[2];
assert.ok(origin, 'Pass the isolated test app origin');
const id=randomUUID(), token=randomUUID();
const signed=encodeURIComponent(token+'.'+createHmac('sha256',process.env.BETTER_AUTH_SECRET).update(token).digest('base64'));
const cookie='better-auth.session_token='+signed;
try{
 await db.query('INSERT INTO "user" (id,name,email,email_verified) VALUES ($1,$2,$3,true)',[id,'Session test',id+'@example.invalid']);
 await db.query('INSERT INTO "session" (id,token,user_id,expires_at,created_at,updated_at) VALUES ($1,$2,$3,NOW()+INTERVAL \'1 day\',NOW(),NOW())',[randomUUID(),token,id]);
 assert.equal((await fetch(origin+'/api/me')).status,401);
 assert.equal((await fetch(origin+'/api/me',{headers:{cookie:cookie+'tampered'}})).status,401);
 const me=await fetch(origin+'/api/me',{headers:{cookie}});assert.equal(me.status,200,await me.text());
 const bad=await fetch(origin+'/api/auth/sign-out',{method:'POST',headers:{cookie,origin:'https://attacker.invalid','content-type':'application/json'},body:'{}'});assert.equal(bad.status,403);
 const logout=await fetch(origin+'/api/auth/sign-out',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:'{}'});assert.equal(logout.status,200,await logout.text());
 assert.equal((await fetch(origin+'/api/me',{headers:{cookie}})).status,401);
 console.log('Better Auth: anonymous, tampered cookie, database session, CSRF, logout passed');
}finally{await db.query('DELETE FROM "user" WHERE id=$1',[id]);await db.end();}
