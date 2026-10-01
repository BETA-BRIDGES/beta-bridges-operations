import { NextResponse } from "next/server";
import { runScheduledGoogleBidirectionalSync } from "../../../../lib/googleBidirectionalSync";

export const runtime="nodejs";

export async function GET(request:Request){
  const token=new URL(request.url).searchParams.get("token");
  if(token!=="92FGSuJoxfnh6RqKu_kSgytCk-9pqZJwQycHfhdP5uc"){
    return NextResponse.json({error:"Not found."},{status:404});
  }
  try{
    const results=await runScheduledGoogleBidirectionalSync();
    const failed=Object.values(results).filter((value:any)=>!value?.ok);
    return NextResponse.json({ok:failed.length===0,results,failed:failed.length},{status:failed.length?207:200});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Reconciliation failed."},{status:500});
  }
}
