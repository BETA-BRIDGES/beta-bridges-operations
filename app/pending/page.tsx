"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function PendingPage(){
  const router=useRouter();
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [role,setRole]=useState("");
  const [canBootstrap,setCanBootstrap]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");

  useEffect(()=>{
    if(!supabase){router.replace("/login");return;}
    let mounted=true;
    (async()=>{
      const {data:{session}}=await supabase.auth.getSession();
      if(!mounted)return;
      if(!session){router.replace("/login");return;}
      const [{data:profile,error:profileError},{count,error:countError},{data:admins,error:adminError}]=await Promise.all([
        supabase.from("profiles").select("full_name,email,role,active").eq("id",session.user.id).maybeSingle(),
        supabase.from("profiles").select("id",{count:"exact",head:true}),
        supabase.from("profiles").select("id").eq("role","Super Admin").eq("active",true).limit(1)
      ]);
      if(profileError||countError||adminError){setError((profileError||countError||adminError)?.message||"Unable to load account status.");return;}
      if(!profile){setError("Account profile not found.");return;}
      setName(profile.full_name||"");
      setEmail(profile.email||session.user.email||"");
      setRole(profile.role||"");
      setCanBootstrap((count??0)===1 && (admins??[]).length===0);
    })();
    return()=>{mounted=false};
  },[router]);

  async function bootstrap(){
    if(!supabase||!name.trim())return;
    setBusy(true);setError("");setMessage("");
    const {data,error}=await supabase.rpc("bootstrap_first_super_admin",{p_full_name:name.trim(),p_email:email});
    setBusy(false);
    if(error){setError(error.message);return;}
    if(data){router.replace("/");}
  }

  async function signOut(){
    if(supabase) await supabase.auth.signOut();
    router.replace("/login");
  }

  return <main className="login-page"><section className="login-card">
    <div className="brand">BETA BRIDGES</div>
    <h1>Account pending</h1>
    <p className="muted">Your account has been registered successfully.</p>
    <div className="pending-note"><strong>{name||email}</strong><br/>Requested role: {role||"Pending"}<br/><br/>A Super Admin must activate this account before you can access the operations workspace.</div>
    {canBootstrap&&<div className="section"><h3>Initial setup</h3><p className="muted">This is the first registered account. Complete the one-time setup to become the initial Super Admin.</p><button className="btn primary" disabled={busy} onClick={bootstrap}>{busy?"Setting up…":"Complete initial Super Admin setup"}</button></div>}
    {message&&<div className="success-box">{message}</div>}
    {error&&<div className="login-error">{error}</div>}
    <div className="modal-actions"><button className="btn" onClick={signOut}>Sign out</button></div>
  </section></main>;
}