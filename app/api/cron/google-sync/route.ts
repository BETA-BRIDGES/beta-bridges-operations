import { NextResponse } from "next/server";
import { runScheduledGoogleSheetModuleImport } from "../../../../lib/googleScheduledSync";

export const runtime="nodejs";

export async function GET(request:Request){
  const configured=process.env.CRON_SECRET;
  const authorization=request.headers.get("authorization")||"";
  if(!configured || authorization!==`Bearer ${configured}`){
    return NextResponse.json({error:"Unauthorized cron request."},{status:401});
  }

  const url=new URL(request.url);
  const mode=url.searchParams.get("mode")||"import";

  // The legacy Google Sheet is the source of truth. This endpoint intentionally
  // supports imports only; export and bidirectional requests are rejected.
  if(mode!=="import"){
    return NextResponse.json({
      error:"Platform-to-Sheet export and bidirectional sync are disabled to protect the legacy Google Sheet.",
      mode,
      writesBlocked:true
    },{status:423});
  }

  const requestedModule=url.searchParams.get("module")||undefined;
  const allowedModules=["clientData","dailyJobListing","dailyJobDone","usedStock","miscellaneousCharges","techieWeeklyActivity"];
  if(requestedModule && !allowedModules.includes(requestedModule)){
    return NextResponse.json({error:"Unsupported sync module."},{status:400});
  }

  try{
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

    return NextResponse.json({
      error:"A module is required. Run each legacy Sheet import separately.",
      mode:"sheet_to_platform",
      allowedModules
    },{status:400});
  }catch(error){
    return NextResponse.json({
      ok:false,
      module:requestedModule||null,
      error:error instanceof Error?error.message:"Scheduled Google Sheet import failed."
    },{status:500});
  }
}
