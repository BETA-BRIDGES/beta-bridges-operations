import { NextResponse } from "next/server";
import { assertSuperAdmin, getUserFromBearer } from "../../../../lib/googleServer";
import { previewGoogleSheets } from "../../../../lib/googleSheetsSync";
import { syncGoogleSheetsBidirectional } from "../../../../lib/googleBidirectionalSync";

export const runtime="nodejs";

export async function GET(request:Request){
  try{
    const user=await getUserFromBearer(request.headers.get("authorization"));
    await assertSuperAdmin(user.id);
    const results=await previewGoogleSheets(user.id);
    return NextResponse.json({ok:true,results});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Google Sheets sync preview failed."},{status:400});
  }
}

export async function POST(request:Request){
  try{
    const user=await getUserFromBearer(request.headers.get("authorization"));
    await assertSuperAdmin(user.id);
    const results=await syncGoogleSheetsBidirectional(user.id);
    return NextResponse.json({ok:true,results});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Google Sheets sync failed."},{status:400});
  }
}
