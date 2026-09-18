import { NextResponse } from "next/server";
import { getUserFromBearer } from "../../../../lib/googleServer";
import { syncGoogleSheets } from "../../../../lib/googleSheetsSync";

export const runtime="nodejs";

export async function POST(request:Request){
  try{
    const user=await getUserFromBearer(request.headers.get("authorization"));
    const results=await syncGoogleSheets(user.id);
    return NextResponse.json({ok:true,results});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Google Sheets sync failed."},{status:400});
  }
}
