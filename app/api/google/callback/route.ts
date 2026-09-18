import { NextResponse } from "next/server";
import { createGoogleOAuthClient, decryptSecret, encryptSecret, getServiceSupabase, verifyOAuthState } from "../../../../lib/googleServer";

export const runtime="nodejs";

export async function GET(request:Request){
  const url=new URL(request.url);
  const code=url.searchParams.get("code");
  const state=url.searchParams.get("state");
  const cookie=request.headers.get("cookie")?.match(/(?:^|; )bb_google_oauth_state=([^;]+)/)?.[1];
  const redirect=new URL("/",url.origin);

  try{
    if(!code||!state||!cookie||state!==decodeURIComponent(cookie)) throw new Error("Invalid or missing Google OAuth state.");
    const {userId}=verifyOAuthState(state);
    const client=createGoogleOAuthClient();
    const {tokens}=await client.getToken(code);
    if(!tokens.refresh_token) throw new Error("Google did not return a refresh token. Re-authorize with consent.");
    const encrypted=encryptSecret(tokens.refresh_token);
    const supabase=getServiceSupabase();
    const {error}=await supabase.from("google_oauth_tokens").upsert({user_id:userId,refresh_token_ciphertext:encrypted,google_email:null,scopes:tokens.scope?.split(" ")??[],updated_at:new Date().toISOString()},{onConflict:"user_id"});
    if(error) throw error;
    redirect.searchParams.set("google","connected");
  }catch(error){
    redirect.searchParams.set("google","error");
    redirect.searchParams.set("message",error instanceof Error?error.message:"Google authorization failed.");
  }
  const response=NextResponse.redirect(redirect);
  response.cookies.set("bb_google_oauth_state","",{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:0});
  return response;
}
