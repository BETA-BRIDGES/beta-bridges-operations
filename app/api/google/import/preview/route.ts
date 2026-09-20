import { NextResponse } from "next/server";
import { assertSuperAdmin, getUserFromBearer } from "../../../../../lib/googleServer";
import { previewLegacyGoogleSheets } from "../../../../../lib/googleSheetsImport";

export const runtime="nodejs";

export async function GET(request:Request){
  try{
    const user=await getUserFromBearer(request.headers.get("authorization"));
    await assertSuperAdmin(user.id);
    const results=await previewLegacyGoogleSheets(user.id);
    return NextResponse.json({ok:true,results});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Legacy Google Sheets preview failed."},{status:400});
  }
}
