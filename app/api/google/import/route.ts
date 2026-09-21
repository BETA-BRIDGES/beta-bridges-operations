import { NextResponse } from "next/server";
import { assertSuperAdmin, getUserFromBearer } from "../../../../lib/googleServer";
import { importLegacyGoogleSheets, importLegacyGoogleModule } from "../../../../lib/googleSheetsImport";

export const runtime="nodejs";

export async function POST(request:Request){
  try{
    const user=await getUserFromBearer(request.headers.get("authorization"));
    await assertSuperAdmin(user.id);
    let module="";
    try{
      const body=await request.json();
      module=typeof body?.module==="string"?body.module:"";
    }catch{}
    if(module){
      const result=await importLegacyGoogleModule(user.id,module);
      return NextResponse.json({ok:true,results:[result]});
    }
    const results=await importLegacyGoogleSheets(user.id);
    return NextResponse.json({ok:true,results});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Legacy Google Sheets import failed."},{status:400});
  }
}
