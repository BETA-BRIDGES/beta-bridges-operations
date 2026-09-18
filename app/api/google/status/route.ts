import { NextResponse } from "next/server";
import { getServiceSupabase, getUserFromBearer } from "../../../../lib/googleServer";

export const runtime="nodejs";

export async function GET(request:Request){
  try{
    const user=await getUserFromBearer(request.headers.get("authorization"));
    const supabase=getServiceSupabase();
    const [{data:token,error:tokenError},{data:connections,error:connectionError}]=await Promise.all([
      supabase.from("google_oauth_tokens").select("id,google_email,scopes,updated_at").eq("user_id",user.id).maybeSingle(),
      supabase.from("google_connections").select("module,spreadsheet_id,sheet_name,last_sync_at,last_error,active,sync_direction").order("module")
    ]);
    if(tokenError) throw tokenError;if(connectionError) throw connectionError;
    return NextResponse.json({connected:Boolean(token),googleEmail:token?.google_email??null,updatedAt:token?.updated_at??null,connections:connections??[]});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Unable to load Google Sheets status."},{status:400});
  }
}
