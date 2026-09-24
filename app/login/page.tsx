"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function LoginPage(){
  const router=useRouter();
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  async function submit(e:FormEvent){
    e.preventDefault();
    setError("");
    if(!supabase){setError("Supabase is not configured yet. Add the public Supabase URL and anon key to the environment before signing in.");return;}
    setBusy(true);
    const {data,error}=await supabase.auth.signInWithPassword({email,password});
    setBusy(false);
    if(error){setError(error.message);return;}
    if(data.user){
      const {data:profile,error:profileError}=await supabase.from("profiles").select("active").eq("id",data.user.id).maybeSingle();
      if(profileError){setError(profileError.message);return;}
      if(profile && !profile.active){
        await supabase.auth.signOut();
        router.replace("/pending");
        return;
      }
    }
    router.replace("/");
  }

  return <main className="login-page"><section className="login-card"><div className="brand">BETA BRIDGES</div><h1>Operations Portal</h1><p className="muted">Sign in with your Beta Bridges account.</p><form onSubmit={submit} className="login-form"><label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>{error&&<div className="login-error">{error}</div>}<button className="btn primary" disabled={busy}>{busy?"Signing in…":"Sign in"}</button></form><p className="auth-link">New here? <a href="/signup">Create an account</a></p></section></main>
}
