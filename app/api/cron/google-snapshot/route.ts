import { NextResponse } from "next/server";
import { google } from "googleapis";
import { findGoogleOwner, resolveConnection } from "../../../../lib/googleScheduledSync";
import { getGoogleClientForUser } from "../../../../lib/googleServer";

export const runtime="nodejs";

const modules=["clientData","dailyJobListing","dailyJobDone","usedStock","miscellaneousCharges","techieWeeklyActivity"];

export async function GET(request:Request){
  const configured=process.env.CRON_SECRET;
  const authorization=request.headers.get("authorization")||"";
  if(!configured || authorization!==`Bearer ${configured}`){
    return NextResponse.json({error:"Unauthorized snapshot request."},{status:401});
  }

  const module=new URL(request.url).searchParams.get("module")||"";
  if(!modules.includes(module)){
    return NextResponse.json({error:"Unsupported snapshot module."},{status:400});
  }

  try{
    const {supabase,userId}=await findGoogleOwner();
    const {data:rawConnection,error}=await supabase
      .from("google_connections")
      .select("module,spreadsheet_id,sheet_name,active,sync_direction")
      .eq("module",module).eq("active",true).maybeSingle();
    if(error) throw error;
    if(!rawConnection) throw new Error("No active Google connection is configured for "+module+".");

    const connection=await resolveConnection(supabase,userId,rawConnection);
    const {client}=await getGoogleClientForUser(userId);
    const drive=google.drive({version:"v3",auth:client});
    const response=await drive.files.export(
      {fileId:String(connection.spreadsheet_id),mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
      {responseType:"arraybuffer"}
    );
    const buffer=Buffer.from(response.data as ArrayBuffer);
    return new NextResponse(buffer,{
      status:200,
      headers:{
        "Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Length":String(buffer.length),
        "Content-Disposition":`attachment; filename="${module}-live-legacy.xlsx"`,
        "Cache-Control":"no-store"
      }
    });
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Unable to export live Google workbook."},{status:500});
  }
}
