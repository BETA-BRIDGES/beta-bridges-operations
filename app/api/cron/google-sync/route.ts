import { NextResponse } from "next/server";
import { runScheduledGoogleBidirectionalSync } from "../../../../lib/googleBidirectionalSync";

export const runtime="nodejs";

export async function GET(request:Request){
  const configured=process.env.CRON_SECRET;
  const authorization=request.headers.get("authorization")||"";
  if(!configured || authorization!==`Bearer ${configured}`){
    return NextResponse.json({error:"Unauthorized cron request."},{status:401});
  }
  try{
    const results=await runScheduledGoogleBidirectionalSync();
    const failed=Object.entries(results).filter(([,value]:any)=>!value?.ok);
    return NextResponse.json({
      ok:failed.length===0,
      results,
      failed:failed.length
    },{status:failed.length?207:200});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Scheduled Google Sheets sync failed."},{status:500});
  }
}
