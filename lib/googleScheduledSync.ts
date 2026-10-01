import { getGoogleClientForUser, getServiceSupabase } from "./googleServer";
import { importLegacyGoogleSheets, importLegacyGoogleModule } from "./googleSheetsImport";
import { exportModule } from "./googleBidirectionalSync";

type ScheduledConnection = {
  module:string;
  spreadsheet_id:string;
  sheet_name:string|null;
  active:boolean;
};

async function findGoogleOwner(){
  const supabase=getServiceSupabase();
  const {data:profiles,error:profileError}=await supabase
    .from("profiles")
    .select("id,role,active,created_at")
    .eq("role","Super Admin")
    .eq("active",true)
    .order("created_at",{ascending:true})
    .limit(10);
  if(profileError) throw profileError;
  if(!profiles?.length) throw new Error("No active Super Admin account is available for scheduled Google synchronization.");

  const {data:tokens,error:tokenError}=await supabase
    .from("google_oauth_tokens")
    .select("user_id")
    .in("user_id",profiles.map((p:any)=>p.id));
  if(tokenError) throw tokenError;

  const connected=new Set((tokens??[]).map((row:any)=>String(row.user_id)));
  const owner=profiles.find((profile:any)=>connected.has(String(profile.id)));
  if(!owner) throw new Error("No active Super Admin has a connected Google account for scheduled synchronization.");
  return {supabase,userId:String(owner.id)};
}

export async function runScheduledGoogleSheetImport(){
  const {userId}=await findGoogleOwner();
  return importLegacyGoogleSheets(userId);
}

export async function runScheduledGoogleSheetModuleImport(module:string){
  const {supabase,userId}=await findGoogleOwner();
  const {data:connection,error}=await supabase
    .from("google_connections")
    .select("module,spreadsheet_id,sheet_name,active,sync_direction")
    .eq("module",module)
    .eq("active",true)
    .maybeSingle();
  if(error) throw error;
  if(!connection) throw new Error("No active Google connection is configured for module: "+module);
  if(!["platform_to_sheet","bidirectional"].includes(String(connection.sync_direction))){
    throw new Error("Google synchronization is disabled for module: "+module);
  }

  const summary=await importLegacyGoogleModule(userId,module);
  const message=summary.errors.length ? summary.errors.slice(0,10).join(" | ") : null;
  const now=new Date().toISOString();

  await supabase.from("google_connections").update({
    last_sync_at:now,
    last_error:message,
    updated_at:now
  }).eq("module",module);

  const {data:state}=await supabase
    .from("google_sync_states")
    .select("conflict_count")
    .eq("module",module)
    .eq("spreadsheet_id",connection.spreadsheet_id)
    .eq("sheet_scope","ALL")
    .maybeSingle();

  await supabase.from("google_sync_states").upsert({
    module,
    spreadsheet_id:connection.spreadsheet_id,
    sheet_scope:"ALL",
    last_sheet_hash:null,
    last_platform_hash:null,
    last_sync_at:now,
    last_direction:"sheet_to_platform",
    last_error:message,
    conflict_count:Number(state?.conflict_count||0),
    updated_at:now
  },{onConflict:"module,spreadsheet_id,sheet_scope"});

  if(message) throw new Error(message);
  return {ok:true,rows:summary.imported,skipped:summary.skipped,exceptions:summary.exceptions||0,direction:"sheet_to_platform"};
}

export async function runScheduledGooglePlatformExport(){
  const {supabase,userId}=await findGoogleOwner();
  const {data:connections,error}=await supabase
    .from("google_connections")
    .select("module,spreadsheet_id,sheet_name,active")
    .eq("active",true);
  if(error) throw error;

  const results:Record<string,any>={};
  for(const connection of (connections??[]) as ScheduledConnection[]){
    const {data:health}=await supabase
      .from("google_connections")
      .select("last_sync_at,last_error")
      .eq("module",connection.module)
      .maybeSingle();

    if(health?.last_error || !health?.last_sync_at){
      results[connection.module]={
        ok:true,
        rows:0,
        direction:"platform_to_sheet",
        frequency:"4h",
        skipped:true,
        reason:"Skipped because the latest five-minute Sheet import has not completed successfully."
      };
      continue;
    }

    try{
      const rows=await exportModule(userId,connection.module,connection);
      results[connection.module]={ok:true,rows,direction:"platform_to_sheet",frequency:"4h"};
    }catch(error){
      const message=error instanceof Error?error.message:"Platform-to-Sheet export failed.";
      await supabase
        .from("google_connections")
        .update({last_error:message,updated_at:new Date().toISOString()})
        .eq("module",connection.module);
      results[connection.module]={
        ok:false,
        rows:0,
        direction:"platform_to_sheet",
        frequency:"4h",
        error:message
      };
    }
  }
  return results;
}
