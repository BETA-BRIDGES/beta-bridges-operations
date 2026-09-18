import { NextResponse } from "next/server";
import { createOAuthState, createGoogleAuthorizationUrl, assertSuperAdmin, getUserFromBearer } from "../../../../lib/googleServer";

export const runtime="nodejs";

export async function POST(request:Request){
  try{
    const user=await getUserFromBearer(request.headers.get("authorization"));\n    await assertSuperAdmin(user.id);
    const state=createOAuthState(user.id);
    const url=createGoogleAuthorizationUrl(state);
    const response=NextResponse.json({url});
    response.cookies.set("bb_google_oauth_state",state,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:600});
    return response;
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Unable to start Google authorization."},{status:400});
  }
}
