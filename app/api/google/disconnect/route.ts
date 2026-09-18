import { NextResponse } from "next/server";
import { getServiceSupabase, getUserFromBearer } from "../../../../lib/googleServer";

export const runtime="nodejs";

export async function POST(request:Request){
  try{
    const user=await getUserFromBearer(request.headers.get("authorization"));
    const supabase=getServiceSupabase();
    const {data:profile,error:profileError}=await supabase.from("profiles").select("role").eq("id",user.id).maybeSingle();
    if(profileError) throw profileError;
    if(profile?.role!=="Super Admin") throw new Error("Only Super Admin can disconnect Google Sheets.");
    const {error}=await supabase.from("google_oauth_tokens").delete().eq("user_id",user.id);
    if(error) throw error;
    return NextResponse.json({ok:true});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Unable to disconnect Google Sheets."},{status:400});
  }
}
