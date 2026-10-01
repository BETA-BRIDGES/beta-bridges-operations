import { NextResponse } from "next/server";
import { runScheduledGooglePlatformExport } from "../../../../lib/googleScheduledSync";
import { runScheduledGoogleBidirectionalSync } from "../../../../lib/googleBidirectionalSync";

export const runtime="nodejs";

export async function GET(request:Request){
  const configured=process.env.CRON_SECRET;
  const authorization=request.headers.get("authorization")||"";
  if(!configured || authorization!==`Bearer ${configured}`){
    return NextResponse.json({error:"Unauthorized cron request."},{status:401});
  }
  const mode=new URL(request.url).searchParams.get("mode")||"import";
  try{
    if(mode==="export"){
      const results=await runScheduledGooglePlatformExport();
      const failed=Object.values(results).filter((value:any)=>!value?.ok);
      return NextResponse.json({
        ok:failed.length===0,
        mode:"platform_to_sheet",
        schedule:"0 */4 * * *",
        results,
        failed:failed.length
      },{status:failed.length?207:200});
    }

    const results=await runScheduledGoogleBidirectionalSync();
    const failed=Object.values(results).filter((value:any)=>!value?.ok);
    return NextResponse.json({
      ok:failed.length===0,
      mode:"bidirectional_reconciliation",
      schedule:"*/5 * * * *",
      results,
      failed:failed.length
    },{status:failed.length?207:200});
  }catch(error){
    return NextResponse.json({
      error:error instanceof Error?error.message:"Scheduled Google synchronization failed."
    },{status:500});
  }
}
