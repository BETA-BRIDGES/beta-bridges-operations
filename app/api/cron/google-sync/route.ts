import { NextResponse } from "next/server";
import {
  runScheduledGooglePlatformExport,
  runScheduledGoogleSheetModuleImport
} from "../../../../lib/googleScheduledSync";
import { runScheduledGoogleBidirectionalSync } from "../../../../lib/googleBidirectionalSync";

export const runtime="nodejs";

export async function GET(request:Request){
  const configured=process.env.CRON_SECRET;
  const authorization=request.headers.get("authorization")||"";
  if(!configured || authorization!==`Bearer ${configured}`){
    return NextResponse.json({error:"Unauthorized cron request."},{status:401});
  }
  const url=new URL(request.url);
  const mode=url.searchParams.get("mode")||"import";
  // Safety lock: the legacy Google Sheet is the source of truth. Until write-back
  // is explicitly re-enabled, this endpoint may import from Sheets only.
  if(mode!=="import"){
    return NextResponse.json({
      error:"Platform-to-Sheet export and bidirectional sync are temporarily disabled to protect the legacy Google Sheet.",
      mode,
      writesBlocked:true
    },{status:423});
  }
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

    const requestedModule=url.searchParams.get("module")||undefined;
    const allowedModules=["clientData","dailyJobListing","dailyJobDone","usedStock","miscellaneousCharges","techieWeeklyActivity"];
    if(requestedModule && !allowedModules.includes(requestedModule)){
      return NextResponse.json({error:"Unsupported sync module."},{status:400});
    }

    // Allow a single module to be reconciled independently so one slow Google API
    // operation cannot hold the full six-module scheduled run open until timeout.
    if(mode==="bidirectional" && requestedModule){
      const results=await runScheduledGoogleBidirectionalSync({modules:[requestedModule]});
      const failed=Object.values(results).filter((value:any)=>!value?.ok);
      return NextResponse.json({
        ok:failed.length===0,
        mode:"bidirectional_reconciliation",
        module:requestedModule,
        results,
        failed:failed.length
      },{status:failed.length?207:200});
    }

    if(requestedModule){
      const result=await runScheduledGoogleSheetModuleImport(requestedModule);
      return NextResponse.json({
        ok:true,
        mode:"sheet_to_platform",
        schedule:"*/5 * * * *",
        module:requestedModule,
        results:{[requestedModule]:result},
        failed:0
      },{status:200});
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
