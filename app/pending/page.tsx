"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function PendingPage(){
  const router=useRouter();
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [role,setRole]=useState("");
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");

  useEffect(()=>{
    if(!supabase){router.replace("/login");return;}
    let mounted=true;
    (async()=>{
      const {data:{session}}=await supabase.auth.getSession();
      if(!mounted)return;
      if(!session){router.replace("/login");return;}
      const {data:profile,error:profileError}=await supabase.from("profiles").select("full_name,email,role,active").eq("id",session.user.id).maybeSingle();
      if(profileError){setError(profileError.message||"Unable to load account status.");return;}
      if(!profile){setError("Account profile not found.");return;}
      setName(profile.full_name||"");
      setEmail(profile.email||session.user.email||"");
      setRole(profile.role||"");
    })();
    return()=>{mounted=false};
  },[router]);

  async function signOut(){
    if(supabase) await supabase.auth.signOut();
    router.replace("/login");
  }

  return <main className="login-page"><section className="login-card">
    <div className="brand">BETA BRIDGES</div>
    <h1>Account pending</h1>
    <p className="muted">Your account has been registered successfully and is awaiting Super Admin approval.</p>
    <div className="pending-note"><strong>{name||email}</strong><br/>Requested role: {role||"Pending"}<br/><br/>A Super Admin must activate this account before you can access the operations workspace.</div>
    {message&&<div className="success-box">{message}</div>}
    {error&&<div className="login-error">{error}</div>}
    <div className="modal-actions"><button className="btn" onClick={signOut}>Sign out</button></div>
  </section></main>;
}