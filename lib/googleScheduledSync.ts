import { google } from "googleapis";
import { getGoogleClientForUser, getServiceSupabase } from "./googleServer";
import { importLegacyGoogleSheets, importLegacyGoogleModule, loadDriveWorkbook } from "./googleSheetsImport";
import { exportModule } from "./googleBidirectionalSync";

type ScheduledConnection = {
  module:string;
  spreadsheet_id:string;
  sheet_name:string|null;
  active:boolean;
};

export async function findGoogleOwner(){
  const supabase=getServiceSupabase();
  const {data:profiles,error:profileError}=await supabase.from("profiles").select("id,role,active,created_at").eq("role","Super Admin").eq("active",true).order("created_at",{ascending:true}).limit(10);
  if(profileError) throw profileError;
  if(!profiles?.length) throw new Error("No active Super Admin account is available for scheduled Google synchronization.");
  const {data:tokens,error:tokenError}=await supabase.from("google_oauth_tokens").select("user_id").in("user_id",profiles.map((p:any)=>p.id));
  if(tokenError) throw tokenError;
  const connected=new Set((tokens??[]).map((row:any)=>String(row.user_id)));
  const owner=profiles.find((profile:any)=>connected.has(String(profile.id)));
  if(!owner) throw new Error("No active Super Admin has a connected Google account for scheduled synchronization.");
  return {supabase,userId:String(owner.id)};
}

export async function resolveConnection(supabase:any,userId:string,connection:any){
  const client=(await getGoogleClientForUser(userId)).client;
  const drive=google.drive({version:"v3",auth:client});
  try{
    await loadDriveWorkbook(drive,String(connection.spreadsheet_id));
    return connection;
  }catch(error){
    const message=error instanceof Error?error.message:"Unable to read configured Google spreadsheet.";
    if(!/not found|requested entity was not found|404/i.test(message) || !connection.sheet_name) throw error;

    // The legacy Techie Weekly Activity workbook has an explicit restored ID.
    // Prefer it before broad Drive discovery so a known legacy connection can be repaired
    // deterministically even when Drive search/listing is incomplete.
    const legacySpreadsheetId = connection.module === "techieWeeklyActivity"
      ? "1HgF7uVBjbywDLRdbfLxONh8s-tuAJ7sej6-7apAS2wo"
      : null;
    if(legacySpreadsheetId && legacySpreadsheetId !== String(connection.spreadsheet_id)){
      try{
        const workbook=await loadDriveWorkbook(drive,legacySpreadsheetId);
        if(workbook.some((sheet:any)=>sheet.title===String(connection.sheet_name))){
          const oldSpreadsheetId=String(connection.spreadsheet_id);
          const now=new Date().toISOString();
          await supabase.from("google_connections").update({spreadsheet_id:legacySpreadsheetId,last_error:null,updated_at:now}).eq("module",connection.module);
          await supabase.from("google_sync_states").delete().eq("module",connection.module).eq("spreadsheet_id",oldSpreadsheetId).eq("sheet_scope","ALL");
          return {...connection,spreadsheet_id:legacySpreadsheetId};
        }
      }catch{
        // Fall through to Drive discovery if the explicit legacy workbook is inaccessible.
      }
    }

    const files:any[]=[];
    let pageToken:string|undefined;
    do{
      const response=await drive.files.list({
        q:"trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'",
        fields:"nextPageToken,files(id,name)",
        pageSize:100,
        pageToken
      });
      files.push(...(response.data.files??[]));
      pageToken=response.data.nextPageToken||undefined;
    }while(pageToken && files.length<500);

    for(const file of files){
      if(!file.id) continue;
      try{
        const workbook=await loadDriveWorkbook(drive,String(file.id));
        if(workbook.some((sheet:any)=>sheet.title===String(connection.sheet_name))){
          const oldSpreadsheetId=String(connection.spreadsheet_id);
          const newSpreadsheetId=String(file.id);
          const now=new Date().toISOString();

          await supabase.from("google_connections").update({spreadsheet_id:newSpreadsheetId,last_error:null,updated_at:now}).eq("module",connection.module);
          await supabase.from("google_sync_states").delete().eq("module",connection.module).eq("spreadsheet_id",oldSpreadsheetId).eq("sheet_scope","ALL");

          return {...connection,spreadsheet_id:newSpreadsheetId};
        }
      }catch{
        // Continue searching other accessible spreadsheets.
      }
    }
    throw new Error("Configured Google spreadsheet was not found, and no accessible replacement workbook contains worksheet '"+connection.sheet_name+"'.");
  }
}

export async function runScheduledGoogleSheetImport(){
  const {userId}=await findGoogleOwner();
  return importLegacyGoogleSheets(userId);
}

export async function runScheduledGoogleSheetModuleImport(module:string){
  const {supabase,userId}=await findGoogleOwner();
  const {data:rawConnection,error}=await supabase.from("google_connections").select("module,spreadsheet_id,sheet_name,active,sync_direction").eq("module",module).eq("active",true).maybeSingle();
  if(error) throw error;
  if(!rawConnection) throw new Error("No active Google connection is configured for module: "+module);
  if(!["platform_to_sheet","bidirectional"].includes(String(rawConnection.sync_direction))) throw new Error("Google synchronization is disabled for module: "+module);

  const connection=await resolveConnection(supabase,userId,rawConnection);
  const summary=await importLegacyGoogleModule(userId,module);
  const message=summary.errors.length ? summary.errors.slice(0,10).join(" | ") : null;
  const now=new Date().toISOString();

  await supabase.from("google_connections").update({last_sync_at:now,last_error:message,updated_at:now}).eq("module",module);
  const {data:state}=await supabase.from("google_sync_states").select("conflict_count").eq("module",module).eq("spreadsheet_id",connection.spreadsheet_id).eq("sheet_scope","ALL").maybeSingle();
  await supabase.from("google_sync_states").upsert({
    module,spreadsheet_id:connection.spreadsheet_id,sheet_scope:"ALL",
    last_sheet_hash:null,last_platform_hash:null,last_sync_at:now,last_direction:"sheet_to_platform",
    last_error:message,conflict_count:Number(state?.conflict_count||0),updated_at:now
  },{onConflict:"module,spreadsheet_id,sheet_scope"});

  if(message) throw new Error(message);
  return {ok:true,rows:summary.imported,skipped:summary.skipped,exceptions:summary.exceptions||0,direction:"sheet_to_platform",spreadsheet_id:connection.spreadsheet_id};
}

export async function runScheduledGooglePlatformExport(){
  const {supabase,userId}=await findGoogleOwner();
  const {data:connections,error}=await supabase.from("google_connections").select("module,spreadsheet_id,sheet_name,active").eq("active",true);
  if(error) throw error;
  const results:Record<string,any>={};
  for(const rawConnection of (connections??[]) as ScheduledConnection[]){
    try{
      const connection=await resolveConnection(supabase,userId,rawConnection);
      const {data:health}=await supabase.from("google_connections").select("last_sync_at,last_error").eq("module",connection.module).maybeSingle();
      if(health?.last_error || !health?.last_sync_at){
        results[connection.module]={ok:true,rows:0,direction:"platform_to_sheet",frequency:"4h",skipped:true,reason:"Skipped because the latest five-minute Sheet import has not completed successfully."};
        continue;
      }
      const rows=await exportModule(userId,connection.module,connection);
      results[connection.module]={ok:true,rows,direction:"platform_to_sheet",frequency:"4h"};
    }catch(error){
      const message=error instanceof Error?error.message:"Platform-to-Sheet export failed.";
      await supabase.from("google_connections").update({last_error:message,updated_at:new Date().toISOString()}).eq("module",rawConnection.module);
      results[rawConnection.module]={ok:false,rows:0,direction:"platform_to_sheet",frequency:"4h",error:message};
    }
  }
  return results;
}
