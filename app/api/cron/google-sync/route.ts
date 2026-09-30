import { NextResponse } from "next/server";
import { runScheduledGoogleSheetImport } from "../../../../lib/googleBidirectionalSync";

export const runtime="nodejs";

export async function GET(request:Request){
  const configured=process.env.CRON_SECRET;
  const authorization=request.headers.get("authorization")||"";
  if(!configured || authorization!==`Bearer ${configured}`){
    return NextResponse.json({error:"Unauthorized cron request."},{status:401});
  }
  try{
    const results=await runScheduledGoogleSheetImport();
    const errors=Object.values(results).filter((value:any)=>value?.errors?.length);
    return NextResponse.json({
      ok:errors.length===0,
      mode:"sheet_to_platform",
      schedule:"*/5 * * * *",
      results,
      failed:errors.length
    },{status:errors.length?207:200});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Scheduled Google Sheet import failed."},{status:500});
  }
}
