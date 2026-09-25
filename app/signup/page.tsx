"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

const requestedRoles=[
  {value:"Field Technician",label:"Field Technician"},
  {value:"Operations",label:"Operations"},
  {value:"Finance",label:"Finance"},
  {value:"TSS Officer",label:"TSS Officer"},
  {value:"Viewer",label:"Viewer"}
];

export default function SignupPage(){
  const router=useRouter();
  const [fullName,setFullName]=useState("");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [role,setRole]=useState("Field Technician");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");

  async function submit(e:FormEvent){
    e.preventDefault();
    setError("");setMessage("");
    if(!supabase){setError("Supabase is not configured.");return;}
    setBusy(true);
    const {data,error}=await supabase.auth.signUp({
      email:email.trim(),
      password,
      options:{data:{full_name:fullName.trim(),role}}
    });
    setBusy(false);
    if(error){
      const message=error.message||"Unable to create account.";
      if(/email rate limit exceeded|too many emails|over_email_send_rate_limit/i.test(message)){
        setError("Supabase has temporarily rate-limited authentication emails. A Super Admin can create the technician account from Administration → Create technician without sending a confirmation email, or you can configure custom SMTP in Supabase.");
      }else{
        setError(message);
      }
      return;
    }
    if(data.session){
      router.replace("/pending");
      return;
    }
    setMessage("Account created. Check your email to confirm the account, then sign in. Your selected role will remain pending until a Super Admin activates the account.");
  }

  return <main className="login-page"><section className="login-card">
    <div className="brand">BETA BRIDGES</div>
    <h1>Create account</h1>
    <p className="muted">Register for the Operations Portal and request your operational role.</p>
    <form onSubmit={submit} className="login-form">
      <label>Full name<input autoComplete="name" value={fullName} onChange={e=>setFullName(e.target.value)} required minLength={2}/></label>
      <label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
      <label>Password<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={8}/></label>
      <label>Requested role<select value={role} onChange={e=>setRole(e.target.value)}>{requestedRoles.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
      <p className="role-help">Your selected role is a request. A Super Admin must activate the account before operational access is granted.</p>
      {error&&<div className="login-error">{error}</div>}
      {message&&<div className="success-box">{message}</div>}
      <button className="btn primary" disabled={busy}>{busy?"Creating account…":"Create account"}</button>
    </form>
    <p className="auth-link">Already registered? <a href="/login">Sign in</a></p>
  </section></main>;
}