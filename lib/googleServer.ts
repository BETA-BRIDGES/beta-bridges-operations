import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const OAUTH_SCOPES=["https://www.googleapis.com/auth/spreadsheets"];

function env(name:string){const value=process.env[name];if(!value) throw new Error(`Missing required environment variable: ${name}`);return value;}

export async function assertSuperAdmin(userId:string){
  const supabase=getServiceSupabase();
  const {data,error}=await supabase.from("profiles").select("role,active").eq("id",userId).maybeSingle();
  if(error) throw error;
  if(!data||data.active!==true||data.role!=="Super Admin") throw new Error("Only Super Admin can manage Google Sheets integration.");
  return supabase;
}

export function getServiceSupabase():SupabaseClient{
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),{auth:{autoRefreshToken:false,persistSession:false}});
}

export async function getUserFromBearer(authHeader:string|null){
  const token=authHeader?.startsWith("Bearer ")?authHeader.slice(7):"";
  if(!token) throw new Error("Authentication required.");
  const client=createClient(env("NEXT_PUBLIC_SUPABASE_URL"),env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),{auth:{autoRefreshToken:false,persistSession:false}});
  const {data,error}=await client.auth.getUser(token);
  if(error||!data.user) throw new Error("Invalid authentication token.");
  return data.user;
}

function stateSecret(){return env("GOOGLE_OAUTH_STATE_SECRET");}

export function createOAuthState(userId:string){
  const nonce=crypto.randomBytes(24).toString("hex");
  const payload=Buffer.from(JSON.stringify({userId,nonce,exp:Date.now()+10*60*1000})).toString("base64url");
  const signature=crypto.createHmac("sha256",stateSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyOAuthState(state:string){
  const [payload,signature]=state.split(".");
  if(!payload||!signature) throw new Error("Invalid OAuth state.");
  const expected=crypto.createHmac("sha256",stateSecret()).update(payload).digest("base64url");
  const signatureBuffer=Buffer.from(signature);\n  const expectedBuffer=Buffer.from(expected);\n  if(signatureBuffer.length!==expectedBuffer.length||!crypto.timingSafeEqual(signatureBuffer,expectedBuffer)) throw new Error("Invalid OAuth state signature.");
  const decoded=JSON.parse(Buffer.from(payload,"base64url").toString("utf8")) as {userId:string;nonce:string;exp:number};
  if(!decoded.userId||!decoded.exp||decoded.exp<Date.now()) throw new Error("OAuth state expired.");
  return decoded;
}

export function createGoogleOAuthClient(){
  return new google.auth.OAuth2(env("GOOGLE_CLIENT_ID"),env("GOOGLE_CLIENT_SECRET"),env("GOOGLE_REDIRECT_URI"));
}

export function createGoogleAuthorizationUrl(state:string){
  const client=createGoogleOAuthClient();
  return client.generateAuthUrl({
    access_type:"offline",
    prompt:"consent",
    include_granted_scopes:true,
    scope:OAUTH_SCOPES,
    state
  });
}

function encryptionKey(){
  const raw=env("GOOGLE_TOKEN_ENCRYPTION_KEY");
  const key=raw.length===64&&/^[0-9a-fA-F]+$/.test(raw)?Buffer.from(raw,"hex"):Buffer.from(raw,"base64");
  if(key.length!==32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

export function encryptSecret(plain:string){
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv("aes-256-gcm",encryptionKey(),iv);
  const encrypted=Buffer.concat([cipher.update(plain,"utf8"),cipher.final()]);
  const tag=cipher.getAuthTag();
  return [iv,tag,encrypted].map(x=>x.toString("base64url")).join(".");
}

export function decryptSecret(value:string){
  const [ivRaw,tagRaw,dataRaw]=value.split(".");
  if(!ivRaw||!tagRaw||!dataRaw) throw new Error("Invalid encrypted token.");
  const decipher=crypto.createDecipheriv("aes-256-gcm",encryptionKey(),Buffer.from(ivRaw,"base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw,"base64url")),decipher.final()]).toString("utf8");
}

export async function getGoogleClientForUser(userId:string){
  const supabase=getServiceSupabase();
  const {data,error}=await supabase.from("google_oauth_tokens").select("refresh_token_ciphertext").eq("user_id",userId).maybeSingle();
  if(error) throw error;
  if(!data?.refresh_token_ciphertext) throw new Error("Google Sheets is not connected for this account.");
  const client=createGoogleOAuthClient();
  client.setCredentials({refresh_token:decryptSecret(data.refresh_token_ciphertext)});
  return {supabase,client};
}

export const GOOGLE_SCOPES=OAUTH_SCOPES;
