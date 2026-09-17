"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ROLES, Role, can, canCopy, canCreate, canEditField } from "../lib/permissions";
import { supabase } from "../lib/supabase";
import { AppJob, AppTask, addTaskComment, createJob, createTask, loadJobs, loadTaskComments, loadTasks, updateJob, updateTaskStatus } from "../lib/data";
import { ClientRecord, ChargeRecord, CompletionRecord, NotificationRecord, StockRecord, UserRecord, WeeklyRecord, addCompletionRemark, createCharge, createClient, createCompletion, createStock, loadCharges, loadClients, loadCompletions, loadNotifications, loadProfiles, loadStock, loadWeekly, markNotificationRead, updateCharge, updateClient, updateStock, upsertWeekly } from "../lib/moduleData";

type Profile={id:string;full_name:string;email:string;role:Role;active:boolean};
type FormState=Record<string,string>;

const MODULES=["Daily Job Listing","Daily Job Done","Used Stock","Techie Weekly Activity","Miscellaneous Charges","Client Data","Tasks"] as const;
function today(){return new Date().toISOString().slice(0,10)}
function money(value:number){return `₦${Number(value||0).toLocaleString("en-NG")}`}
function pretty(value:string|null|undefined){return value||"—"}

function Table({headers,children}:{headers:string[];children:ReactNode}){return <div className="table-wrap"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>}
function Field({label,name,value,setValue,type="text",placeholder="",readOnly=false,options}:{label:string;name:string;value:string;setValue:(v:string)=>void;type?:string;placeholder?:string;readOnly?:boolean;options?:{value:string;label:string}[]}){return <label>{label}{options?<select value={value} disabled={readOnly} onChange={e=>setValue(e.target.value)}><option value="">Select…</option>{options.map(o=><option value={o.value} key={o.value}>{o.label}</option>)}</select>:type==="textarea"?<textarea value={value} readOnly={readOnly} placeholder={placeholder} onChange={e=>setValue(e.target.value)}/>:<input type={type} value={value} readOnly={readOnly} placeholder={placeholder} onChange={e=>setValue(e.target.value)}/>}</label>}

export default function Home(){
  const router=useRouter();
  const [authLoading,setAuthLoading]=useState(Boolean(supabase));
  const [profile,setProfile]=useState<Profile|null>(null);
  const [profileError,setProfileError]=useState("");
  const [bootstrapName,setBootstrapName]=useState("");
  const [bootstrapBusy,setBootstrapBusy]=useState(false);
  const [demoRole,setDemoRole]=useState<Role>("Super Admin");
  const role:Role=profile?.role??(supabase?"Viewer":demoRole);
  const [module,setModule]=useState("Dashboard");
  const [jobs,setJobs]=useState<AppJob[]>([]);
  const [tasks,setTasks]=useState<AppTask[]>([]);
  const [clients,setClients]=useState<ClientRecord[]>([]);
  const [stock,setStock]=useState<StockRecord[]>([]);
  const [completions,setCompletions]=useState<CompletionRecord[]>([]);
  const [charges,setCharges]=useState<ChargeRecord[]>([]);
  const [weekly,setWeekly]=useState<WeeklyRecord[]>([]);
  const [users,setUsers]=useState<UserRecord[]>([]);
  const [notifications,setNotifications]=useState<NotificationRecord[]>([]);
  const [busy,setBusy]=useState(false);
  const [modal,setModal]=useState(false);
  const [editing,setEditing]=useState(false);
  const [formMode,setFormMode]=useState("record");
  const [form,setForm]=useState<FormState>({});
  const [selectedId,setSelectedId]=useState("");
  const [selectedTaskComments,setSelectedTaskComments]=useState<{id:string;comment:string;createdAt:string;user:string}[]>([]);
  const allowed=useMemo(()=>MODULES.filter(m=>can(role,m,"view")),[role]);
  const technicians=users.filter(u=>u.active&&u.role==="Field Technician");
  const unreadCount=notifications.filter(n=>!n.readAt).length;
  function setField(name:string,value:string){setForm(p=>({...p,[name]:value}))}
  function closeModal(){setModal(false);setEditing(false);setFormMode("record");setSelectedId("");setSelectedTaskComments([])}

  async function refresh(){
    if(!supabase) return;
    try{
      const [j,t,c,s,d,mc,w,u,n]=await Promise.all([loadJobs(),loadTasks(),loadClients(),loadStock(),loadCompletions(),loadCharges(),loadWeekly(),loadProfiles(),profile?.id?loadNotifications(profile.id):Promise.resolve([])]);
      setJobs(j);setTasks(t);setClients(c);setStock(s);setCompletions(d);setCharges(mc);setWeekly(w);setUsers(u);setNotifications(n);setProfileError("");
    }catch(error){setProfileError(error instanceof Error?error.message:"Unable to load operational data.")}
  }

  useEffect(()=>{
    if(!supabase){setAuthLoading(false);return}
    let mounted=true;
    async function load(){
      const {data:{session}}=await supabase!.auth.getSession();
      if(!mounted) return;
      if(!session){router.replace("/login");return}
      const {data,error}=await supabase!.from("profiles").select("id,full_name,email,role,active").eq("id",session.user.id).maybeSingle();
      if(!mounted) return;
      if(error){setProfileError(error.message);setAuthLoading(false);return}
      setProfile(data as Profile);setAuthLoading(false);
    }
    load();
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{if(!session) router.replace("/login")});
    return()=>{mounted=false;subscription.unsubscribe()};
  },[router]);
  useEffect(()=>{if(profile) void refresh()},[profile]);
  async function signOut(){if(supabase) await supabase.auth.signOut();else setModule("Dashboard")}

  async function bootstrap(){
    if(!supabase||!bootstrapName.trim()) return;
    setBootstrapBusy(true);setProfileError("");
    const {data:{session}}=await supabase.auth.getSession();
    if(!session){router.replace("/login");return}
    const {data,error}=await supabase.rpc("bootstrap_first_super_admin",{p_full_name:bootstrapName.trim(),p_email:session.user.email||""});
    setBootstrapBusy(false);
    if(error){setProfileError(error.message);return}
    if(data){setProfile(data as Profile)}
  }

  function openCreate(target:string){
    setModule(target);setEditing(false);setFormMode("record");setSelectedId("");
    const defaults:Record<string,FormState>={
      "Daily Job Listing":{clientId:"",numberOfVehicles:"1",scheduledDate:today(),location:"",vehicleMake:"",priority:"Normal",description:"",status:"Pending",assignedTechnicianId:""},
      "Daily Job Done":{jobId:"",deviceId:"",date:today(),installer:"",location:"",client:"",vehicleDetails:"",vehicleMake:"",tssOfficer:profile?.full_name||"",remarks:""},
      "Used Stock":{deviceId:"",simId:"",dateIssued:today(),dateInstalled:"",installer:"",client:"",location:"",network:"",deviceType:"",deviceStatus:"",dateCollected:"",operationsRemark:"",operationsCorrection:"",vehicleDetails:"",vehicleMake:"",otherIssues:""},
      "Techie Weekly Activity":{technicianId:"",weekStart:today(),projects:"0",vehiclesCompleted:"0",remarks:""},
      "Miscellaneous Charges":{clientId:"",location:"",logistics:"0",accommodation:"0",swap:"0",deinstallation:"0",reinstallation:"0",healthCheck:"0",simReplacement:"0",others:"0",status:"Pending"},
      "Client Data":{name:"",clientCode:"",contactPerson:"",phone:"",email:"",location:"",category:"",status:"Active",notes:""},
      "Tasks":{title:"",description:"",assignedTo:"",department:"",priority:"Normal",dueAt:""}
    };
    setForm(defaults[target]||{});setModal(true);
  }

  function openEdit(target:string,record:any){
    setModule(target);setEditing(true);setFormMode("record");setSelectedId(record.id);setModal(true);
    if(target==="Daily Job Listing") setForm({clientId:record.clientId||"",numberOfVehicles:String(record.vehicles),scheduledDate:record.date?new Date(record.date).toISOString().slice(0,10):today(),location:record.location||"",vehicleMake:"",priority:"Normal",description:"",status:record.status,assignedTechnicianId:record.technicianId||""});
    if(target==="Daily Job Done") setForm({deviceId:record.deviceId,date:record.date||today(),installer:record.installer,location:record.location,client:record.client,vehicleDetails:record.vehicleDetails,vehicleMake:record.vehicleMake,tssOfficer:record.tssOfficer,remarks:record.remarks});
    if(target==="Used Stock") setForm({...record});
    if(target==="Techie Weekly Activity") setForm({technicianId:record.technicianId,weekStart:record.weekStart,projects:String(record.projects),vehiclesCompleted:String(record.vehiclesCompleted),remarks:record.remarks});
    if(target==="Miscellaneous Charges") setForm({clientId:record.clientId||"",location:record.location,logistics:String(record.logistics),accommodation:String(record.accommodation),swap:String(record.swap),deinstallation:String(record.deinstallation),reinstallation:String(record.reinstallation),healthCheck:String(record.healthCheck),simReplacement:String(record.simReplacement),others:String(record.others),status:record.status});
    if(target==="Client Data") setForm({...record});
  }

  async function saveRecord(e:FormEvent){
    e.preventDefault();setBusy(true);setProfileError("");
    try{
      if(formMode==="comment"){
        await addTaskComment(selectedId,form.comment||"",profile?.id||"",role);
      }else if(module==="Daily Job Listing"){
        const payload:any={client_id:form.clientId||null,number_of_vehicles:Math.max(1,Number(form.numberOfVehicles)||1),scheduled_date:form.scheduledDate||null,location:form.location||null,vehicle_make:form.vehicleMake||null,priority:form.priority||"Normal",description:form.description||null,status:form.status||"Pending"};
        if(role==="Super Admin") payload.assigned_technician_id=form.assignedTechnicianId||null;
        if(editing) await updateJob(selectedId,payload,role); else await createJob({clientId:form.clientId||null,numberOfVehicles:Math.max(1,Number(form.numberOfVehicles)||1),scheduledDate:form.scheduledDate,location:form.location,vehicleMake:form.vehicleMake,priority:form.priority,description:form.description,tssOfficerId:profile?.id},role);
      }else if(module==="Daily Job Done"){
        if(formMode==="remark") await addCompletionRemark(selectedId,form.remark||"",role);
        else if(editing) await addCompletionRemark(selectedId,form.remarks||"",role);
        else await createCompletion({jobId:form.jobId||null,deviceId:form.deviceId,date:form.date,installer:form.installer,location:form.location,client:form.client,vehicleDetails:form.vehicleDetails,vehicleMake:form.vehicleMake,tssOfficer:form.tssOfficer,remarks:form.remarks},role);
      }else if(module==="Used Stock"){
        const patch:any={device_id:form.deviceId||null,sim_id:form.simId||null,date_issued:form.dateIssued||null,date_installed:form.dateInstalled||null,installer:form.installer||null,client:form.client||null,location:form.location||null,network:form.network||null,device_type:form.deviceType||null,device_status:form.deviceStatus||null,date_collected:form.dateCollected||null,operations_remark:form.operationsRemark||null,operations_correction:form.operationsCorrection||null,vehicle_details:form.vehicleDetails||null,vehicle_make:form.vehicleMake||null,other_issues:form.otherIssues||null};
        if(editing) await updateStock(selectedId,patch,role); else await createStock(patch,role);
      }else if(module==="Techie Weekly Activity"){
        await upsertWeekly({technicianId:form.technicianId,weekStart:form.weekStart,projects:Number(form.projects)||0,vehiclesCompleted:Number(form.vehiclesCompleted)||0,remarks:form.remarks},role);
      }else if(module==="Miscellaneous Charges"){
        const patch={client_id:form.clientId||null,location:form.location||null,logistics:Number(form.logistics)||0,accommodation:Number(form.accommodation)||0,swap:Number(form.swap)||0,deinstallation:Number(form.deinstallation)||0,reinstallation:Number(form.reinstallation)||0,health_check:Number(form.healthCheck)||0,sim_replacement:Number(form.simReplacement)||0,others:Number(form.others)||0,paid_or_approved:form.status||"Pending"};
        if(editing) await updateCharge(selectedId,patch,role); else await createCharge({clientId:form.clientId||null,location:form.location,logistics:Number(form.logistics)||0,accommodation:Number(form.accommodation)||0,swap:Number(form.swap)||0,deinstallation:Number(form.deinstallation)||0,reinstallation:Number(form.reinstallation)||0,healthCheck:Number(form.healthCheck)||0,simReplacement:Number(form.simReplacement)||0,others:Number(form.others)||0},role);
      }else if(module==="Client Data"){
        const patch={client_code:form.clientCode||null,name:form.name,contact_person:form.contactPerson||null,phone:form.phone||null,email:form.email||null,location:form.location||null,category:form.category||null,status:form.status||"Active",notes:form.notes||null};
        if(editing) await updateClient(selectedId,patch,role); else await createClient({name:form.name,contactPerson:form.contactPerson,phone:form.phone,email:form.email,location:form.location,category:form.category,notes:form.notes},role);
      }else if(module==="Tasks"){
        await createTask({title:form.title,description:form.description,assignedTo:form.assignedTo||null,dueAt:form.dueAt||null,department:form.department,priority:form.priority},role,profile?.id||"");
      }
      await refresh();closeModal();
    }catch(error){setProfileError(error instanceof Error?error.message:"Unable to save record.")}
    finally{setBusy(false)}
  }

  async function taskAction(task:AppTask,status:"Completed"|"In Progress"|"Cancelled"){try{await updateTaskStatus(task.id,status,role);await refresh()}catch(error){setProfileError(error instanceof Error?error.message:"Unable to update task.")}}
  async function showComments(task:AppTask){setSelectedId(task.id);setForm({comment:""});setFormMode("comment");const comments=await loadTaskComments(task.id);setSelectedTaskComments(comments);setModal(true)}
  async function copyCharge(charge:ChargeRecord){const text=JSON.stringify(charge);try{await navigator.clipboard.writeText(text);setProfileError("Charge copied to clipboard.")}catch{setProfileError("Copy is not available in this browser.")}}

  if(authLoading) return <main className="login-page"><section className="login-card"><div className="brand">BETA BRIDGES</div><h1>Loading Operations Portal</h1><p className="muted">Checking account and permissions…</p></section></main>;
  if(supabase&&!profile) return <main className="login-page"><section className="login-card"><div className="brand">BETA BRIDGES</div><h1>Complete administrator setup</h1><p className="muted">Your authenticated account has no Beta Bridges profile yet. The first profile created here becomes the initial Super Admin.</p><label>Full name<input value={bootstrapName} onChange={e=>setBootstrapName(e.target.value)} placeholder="Your full name"/></label>{profileError&&<div className="login-error">{profileError}</div>}<button className="btn primary" disabled={bootstrapBusy||!bootstrapName.trim()} onClick={bootstrap}>{bootstrapBusy?"Setting up…":"Create initial Super Admin"}</button></section></main>;

  return <div className="app">
    <aside className="sidebar"><div className="brand">BETA BRIDGES</div><div className="side-note">Operations Management</div><nav className="nav">
      <a className={module==="Dashboard"?"active":""} onClick={()=>setModule("Dashboard")}>Dashboard</a>
      {allowed.map(m=><a key={m} className={module===m?"active":""} onClick={()=>setModule(m)}>{m}</a>)}
      <a className={module==="Notifications"?"active":""} onClick={()=>setModule("Notifications")}>Notifications{unreadCount>0&&<span className="badge">{unreadCount}</span>}</a>
      {role==="Super Admin"&&<a className={module==="Administration"?"active":""} onClick={()=>setModule("Administration")}>Administration</a>}
    </nav></aside>

    <main className="main"><header className="topbar"><div><h1 className="page-title">{module}</h1><div className="muted">Central operations workspace</div></div><div className="topbar-actions">{supabase?<div className="user-chip"><strong>{profile?.full_name||profile?.email}</strong><span>{role}</span></div>:<select value={demoRole} onChange={e=>{setDemoRole(e.target.value as Role);setModule("Dashboard")}} className="role-select">{ROLES.map(r=><option key={r}>{r}</option>)}</select>}{supabase&&<button className="btn" onClick={signOut}>Sign out</button>}</div></header>
      {profileError&&<div className="login-error page-error">{profileError}</div>}

      {module==="Dashboard"&&<><section className="grid"><div className="card"><div className="muted">Scheduled projects</div><div className="stat">{jobs.length}</div></div><div className="card"><div className="muted">Vehicles scheduled</div><div className="stat">{jobs.reduce((n,j)=>n+j.vehicles,0)}</div></div><div className="card"><div className="muted">Completed records</div><div className="stat">{completions.length}</div></div><div className="card"><div className="muted">Open tasks</div><div className="stat">{tasks.filter(t=>t.status!=="Completed").length}</div></div></section><section className="section two"><div className="card"><h3>Job queue</h3><Table headers={["Job ID","Client","Vehicles","Technician","Date","Status"]}>{jobs.slice(0,10).map(j=><tr key={j.id}><td>{j.jobId}</td><td>{j.client}</td><td>{j.vehicles}</td><td>{j.technician}</td><td>{j.date}</td><td>{j.status}</td></tr>)}</Table></div><div className="card"><h3>Open tasks</h3>{tasks.filter(t=>t.status!=="Completed").slice(0,8).map(t=><div className="task" key={t.id}><strong>{t.title}</strong><span>{t.assignee} · {t.due}</span><em>{t.status}</em></div>)}</div></section></>}

      {module==="Daily Job Listing"&&<section className="card"><div className="section-head"><div><h3>Daily Job Listing</h3><p className="muted">Legacy NUMBER OF JOBS is treated as the number of vehicles covered by one project.</p></div>{canCreate(role,module)&&<button className="btn primary" onClick={()=>openCreate(module)}>Add project</button>}</div><Table headers={["Job ID","NUMBER OF JOBS / Vehicles","Client","Date","Location","Techie Assigned","Status","Actions"]}>{jobs.map(j=><tr key={j.id}><td>{j.jobId}</td><td>{j.vehicles}</td><td>{j.client}</td><td>{j.date}</td><td>{pretty(j.location)}</td><td>{j.technician}</td><td>{j.status}</td><td>{can(role,module,"edit")&&<button className="btn small" onClick={()=>openEdit(module,j)}>Edit</button>}{can(role,module,"assign")&&<button className="btn small" onClick={()=>openEdit(module,j)}>Assign</button>}</td></tr>)}</Table></section>}
      {module==="Daily Job Done"&&<section className="card"><div className="section-head"><div><h3>Daily Job Done</h3><p className="muted">DEVICE ID is the physical tracker identifier and is separate from the operational Job ID.</p></div>{canCreate(role,module)&&<button className="btn primary" onClick={()=>openCreate(module)}>Add completion</button>}</div><Table headers={["Job ID","DEVICE ID","Date","Installer","Client","Status","Remark","Actions"]}>{completions.map(c=><tr key={c.id}><td>{c.jobId||"—"}</td><td>{c.deviceId}</td><td>{c.date}</td><td>{c.installer||"—"}</td><td>{c.client||"—"}</td><td>{c.status}</td><td>{pretty(c.remarks)}</td><td>{can(role,module,"remark")&&<button className="btn small" onClick={()=>{setSelectedId(c.id);setForm({remark:c.remarks});setFormMode("remark");setModal(true)}}>Remark</button>}</td></tr>)}</Table></section>}
      {module==="Used Stock"&&<section className="card"><div className="section-head"><div><h3>Used Stock</h3><p className="muted">Operations cannot change Device ID, SIM ID or Date Issued. Finance can change only those three fields.</p></div>{canCreate(role,module)&&<button className="btn primary" onClick={()=>openCreate(module)}>Add stock record</button>}</div><Table headers={["Device ID","SIM ID","Date Issued","Date Installed","Installer","Client","Location","Network","Actions"]}>{stock.map(s=><tr key={s.id}><td>{s.deviceId||"—"}</td><td>{s.simId||"—"}</td><td>{s.dateIssued||"—"}</td><td>{s.dateInstalled||"—"}</td><td>{s.installer||"—"}</td><td>{s.client||"—"}</td><td>{s.location||"—"}</td><td>{s.network||"—"}</td><td>{can(role,module,"edit")&&<button className="btn small" onClick={()=>openEdit(module,s)}>Edit</button>}</td></tr>)}</Table></section>}
      {module==="Techie Weekly Activity"&&<section className="card"><div className="section-head"><div><h3>Techie Weekly Activity Report</h3><p className="muted">Tracks projects and vehicles completed by Field Technician.</p></div>{canCreate(role,module)&&<button className="btn primary" onClick={()=>openCreate(module)}>Add weekly record</button>}</div><Table headers={["Technician","Week","Projects","Vehicles Completed","Updated","Remarks","Actions"]}>{weekly.map(w=><tr key={w.id}><td>{w.technician}</td><td>{w.week}</td><td>{w.projects}</td><td>{w.vehiclesCompleted}</td><td>{w.date}</td><td>{pretty(w.remarks)}</td><td>{can(role,module,"edit")&&<button className="btn small" onClick={()=>openEdit(module,w)}>Edit</button>}</td></tr>)}</Table></section>}
      {module==="Miscellaneous Charges"&&<section className="card"><div className="section-head"><div><h3>Miscellaneous Charges</h3><p className="muted">Finance has view/copy access only; TSS Officer enters and maintains the records.</p></div>{canCreate(role,module)&&<button className="btn primary" onClick={()=>openCreate(module)}>Add charge</button>}</div><Table headers={["Charge ID","Client","Logistics","Accommodation","Swap","SIM Replacement","Others","Status","Actions"]}>{charges.map(c=><tr key={c.id}><td>{c.chargeId}</td><td>{c.client}</td><td>{money(c.logistics)}</td><td>{money(c.accommodation)}</td><td>{money(c.swap)}</td><td>{money(c.simReplacement)}</td><td>{money(c.others)}</td><td>{c.status}</td><td>{can(role,module,"edit")&&<button className="btn small" onClick={()=>openEdit(module,c)}>Edit</button>}{canCopy(role,module)&&<button className="btn small" onClick={()=>copyCharge(c)}>Copy</button>}</td></tr>)}</Table></section>}
      {module==="Client Data"&&<section className="card"><div className="section-head"><div><h3>Client Data List</h3><p className="muted">Master client directory used by jobs and billing.</p></div>{canCreate(role,module)&&<button className="btn primary" onClick={()=>openCreate(module)}>Add client</button>}</div><Table headers={["Client","Contact","Phone","Email","Location","Category","Status","Actions"]}>{clients.map(c=><tr key={c.id}><td>{c.name}</td><td>{pretty(c.contactPerson)}</td><td>{pretty(c.phone)}</td><td>{pretty(c.email)}</td><td>{pretty(c.location)}</td><td>{pretty(c.category)}</td><td>{c.status}</td><td>{can(role,module,"edit")&&<button className="btn small" onClick={()=>openEdit(module,c)}>Edit</button>}</td></tr>)}</Table></section>}
      {module==="Tasks"&&<section className="card"><div className="section-head"><div><h3>Tasks & Reminders</h3><p className="muted">Super Admin assigns tasks. Field Technician can update assigned work, comment and complete it.</p></div>{canCreate(role,module)&&<button className="btn primary" onClick={()=>openCreate(module)}>Create task</button>}</div><Table headers={["Task ID","Title","Assignee","Due","Status","Actions"]}>{tasks.map(t=><tr key={t.id}><td>{t.taskKey}</td><td>{t.title}</td><td>{t.assignee}</td><td>{t.due}</td><td>{t.status}</td><td>{can(role,module,"complete")&&<button className="btn small" onClick={()=>taskAction(t,"Completed")}>Complete</button>}{can(role,module,"comment")&&<button className="btn small" onClick={()=>showComments(t)}>Comment</button>}</td></tr>)}</Table></section>}
      {module==="Notifications"&&<section className="card"><div className="section-head"><div><h3>Notifications</h3><p className="muted">Task assignments and system notifications for this account.</p></div></div>{notifications.length===0?<p className="muted">No notifications.</p>:notifications.map(n=><div className={`task ${n.readAt?"":"unread"}`} key={n.id}><strong>{n.title}</strong><span>{n.message} · {n.createdAt}</span>{!n.readAt&&<button className="btn small" onClick={async()=>{await markNotificationRead(n.id);if(profile) setNotifications(await loadNotifications(profile.id))}}>Mark read</button>}</div>)}</section>}
      {module==="Administration"&&role==="Super Admin"&&<section className="section two"><div className="card"><h3>Users & Roles</h3><Table headers={["Name","Email","Role","Status"]}>{users.map(u=><tr key={u.id}><td>{u.fullName}</td><td>{u.email}</td><td>{u.role}</td><td>{u.active?"Active":"Inactive"}</td></tr>)}</Table></div><div className="card"><h3>Google Sheets Connections</h3><p className="muted">The six legacy spreadsheet IDs and mappings are stored in the project. OAuth authorization is the remaining external Google step.</p><span className="badge warn">Google authorization pending</span></div></section>}
      <div className="build-note">Operational tables now read from Supabase when configured. Database RLS remains the final enforcement layer for every role and field restriction.</div>
    </main>

    {modal&&<div className="modal-backdrop"><form className="modal" onSubmit={saveRecord}>
      <div className="section-head"><div><h3>{formMode==="comment"?"Task comment":formMode==="remark"?"Daily Job Done remark":editing?`Edit ${module}`:`Create ${module}`}</h3><p className="muted">Changes are enforced against the assigned role in Supabase.</p></div><button type="button" className="btn" onClick={closeModal}>Close</button></div>
      {formMode==="comment"&&selectedTaskComments.length>0&&<div className="card"><strong>Previous comments</strong>{selectedTaskComments.map(c=><div className="task" key={c.id}><strong>{c.user}</strong><span>{c.createdAt}</span><div>{c.comment}</div></div>)}</div>}
      {formMode==="remark"?<div className="form-grid"><Field label="Remark" name="remark" type="textarea" value={form.remark||""} setValue={v=>setField("remark",v)} /></div>:formMode==="comment"?<div className="form-grid"><Field label="Comment" name="comment" type="textarea" value={form.comment||""} setValue={v=>setField("comment",v)} /></div>:<>
        {module==="Daily Job Listing"&&<div className="form-grid"><Field label="Client" name="clientId" value={form.clientId||""} setValue={v=>setField("clientId",v)} options={clients.map(c=>({value:c.id,label:c.name}))}/><Field label="Number of vehicles" name="numberOfVehicles" type="number" value={form.numberOfVehicles||"1"} setValue={v=>setField("numberOfVehicles",v)}/><Field label="Scheduled date" name="scheduledDate" type="date" value={form.scheduledDate||today()} setValue={v=>setField("scheduledDate",v)}/><Field label="Location" name="location" value={form.location||""} setValue={v=>setField("location",v)}/><Field label="Vehicle make" name="vehicleMake" value={form.vehicleMake||""} setValue={v=>setField("vehicleMake",v)}/><Field label="Priority" name="priority" value={form.priority||"Normal"} setValue={v=>setField("priority",v)} options={["Normal","High","Urgent"].map(x=>({value:x,label:x}))}/><Field label="Status" name="status" value={form.status||"Pending"} setValue={v=>setField("status",v)} options={["Pending","In Progress","Completed","Cancelled","Overdue"].map(x=>({value:x,label:x}))}/>{role==="Super Admin"&&<Field label="Techie Assigned" name="assignedTechnicianId" value={form.assignedTechnicianId||""} setValue={v=>setField("assignedTechnicianId",v)} options={technicians.map(t=>({value:t.id,label:t.fullName}))}/>}<Field label="Description" name="description" type="textarea" value={form.description||""} setValue={v=>setField("description",v)}/></div>}
        {module==="Daily Job Done"&&<div className="form-grid"><Field label="Job ID" name="jobId" value={form.jobId||""} setValue={v=>setField("jobId",v)} options={jobs.map(j=>({value:j.id,label:j.jobId}))}/><Field label="DEVICE ID" name="deviceId" value={form.deviceId||""} setValue={v=>setField("deviceId",v)}/><Field label="Date" name="date" type="date" value={form.date||today()} setValue={v=>setField("date",v)}/><Field label="Installer" name="installer" value={form.installer||""} setValue={v=>setField("installer",v)}/><Field label="Location" name="location" value={form.location||""} setValue={v=>setField("location",v)}/><Field label="Client" name="client" value={form.client||""} setValue={v=>setField("client",v)}/><Field label="Vehicle details" name="vehicleDetails" value={form.vehicleDetails||""} setValue={v=>setField("vehicleDetails",v)}/><Field label="Vehicle make" name="vehicleMake" value={form.vehicleMake||""} setValue={v=>setField("vehicleMake",v)}/><Field label="TSS Officer" name="tssOfficer" value={form.tssOfficer||""} setValue={v=>setField("tssOfficer",v)}/><Field label="Remarks" name="remarks" type="textarea" value={form.remarks||""} setValue={v=>setField("remarks",v)}/></div>}
        {module==="Used Stock"&&<div className="form-grid">{[["deviceId","Device ID"],["simId","SIM ID"],["dateIssued","Date Issued"],["dateInstalled","Date Installed"],["installer","Installer"],["client","Client"],["location","Location"],["network","Network"],["deviceType","Device Type"],["deviceStatus","Device Status"],["dateCollected","Date Collected"],["operationsRemark","Operations Remark"],["operationsCorrection","Operations Correction"],["vehicleDetails","Vehicle Details"],["vehicleMake","Vehicle Make"],["otherIssues","Other Issues"]].map(([name,label])=><Field key={name} label={label} name={name} type={name.toLowerCase().includes("date")?"date":name.includes("Remark")||name.includes("Correction")||name.includes("Issues")?"textarea":"text"} value={form[name]||""} setValue={v=>setField(name,v)} readOnly={editing&&!canEditField(role,module,label)}/>)}</div>}
        {module==="Techie Weekly Activity"&&<div className="form-grid"><Field label="Technician" name="technicianId" value={form.technicianId||""} setValue={v=>setField("technicianId",v)} options={technicians.map(t=>({value:t.id,label:t.fullName}))}/><Field label="Week start" name="weekStart" type="date" value={form.weekStart||today()} setValue={v=>setField("weekStart",v)}/><Field label="Projects completed" name="projects" type="number" value={form.projects||"0"} setValue={v=>setField("projects",v)}/><Field label="Vehicles completed" name="vehiclesCompleted" type="number" value={form.vehiclesCompleted||"0"} setValue={v=>setField("vehiclesCompleted",v)}/><Field label="Remarks" name="remarks" type="textarea" value={form.remarks||""} setValue={v=>setField("remarks",v)}/></div>}
        {module==="Miscellaneous Charges"&&<div className="form-grid"><Field label="Client" name="clientId" value={form.clientId||""} setValue={v=>setField("clientId",v)} options={clients.map(c=>({value:c.id,label:c.name}))}/><Field label="Location" name="location" value={form.location||""} setValue={v=>setField("location",v)}/>{[["logistics","Logistics"],["accommodation","Accommodation"],["swap","Swap"],["deinstallation","Deinstallation"],["reinstallation","Reinstallation"],["healthCheck","Health Check"],["simReplacement","SIM Replacement"],["others","Others"]].map(([name,label])=><Field key={name} label={label} name={name} type="number" value={form[name]||"0"} setValue={v=>setField(name,v)}/>) }<Field label="Approval status" name="status" value={form.status||"Pending"} setValue={v=>setField("status",v)} options={["Pending","Approved","Rejected"].map(x=>({value:x,label:x}))}/></div>}
        {module==="Client Data"&&<div className="form-grid"><Field label="Client name" name="name" value={form.name||""} setValue={v=>setField("name",v)}/><Field label="Client code" name="clientCode" value={form.clientCode||""} setValue={v=>setField("clientCode",v)}/><Field label="Contact person" name="contactPerson" value={form.contactPerson||""} setValue={v=>setField("contactPerson",v)}/><Field label="Phone" name="phone" value={form.phone||""} setValue={v=>setField("phone",v)}/><Field label="Email" name="email" type="email" value={form.email||""} setValue={v=>setField("email",v)}/><Field label="Location" name="location" value={form.location||""} setValue={v=>setField("location",v)}/><Field label="Category" name="category" value={form.category||""} setValue={v=>setField("category",v)}/><Field label="Status" name="status" value={form.status||"Active"} setValue={v=>setField("status",v)} options={["Active","Inactive"].map(x=>({value:x,label:x}))}/><Field label="Notes" name="notes" type="textarea" value={form.notes||""} setValue={v=>setField("notes",v)}/></div>}
        {module==="Tasks"&&<div className="form-grid"><Field label="Title" name="title" value={form.title||""} setValue={v=>setField("title",v)}/><Field label="Assignee" name="assignedTo" value={form.assignedTo||""} setValue={v=>setField("assignedTo",v)} options={users.filter(u=>u.active&&u.role!=="Viewer").map(u=>({value:u.id,label:`${u.fullName} · ${u.role}`}))}/><Field label="Department" name="department" value={form.department||""} setValue={v=>setField("department",v)}/><Field label="Priority" name="priority" value={form.priority||"Normal"} setValue={v=>setField("priority",v)} options={["Normal","High","Urgent"].map(x=>({value:x,label:x}))}/><Field label="Due" name="dueAt" type="datetime-local" value={form.dueAt||""} setValue={v=>setField("dueAt",v)}/><Field label="Description" name="description" type="textarea" value={form.description||""} setValue={v=>setField("description",v)}/></div>}
      </>}
      <div className="modal-actions">{profileError&&<div className="login-error">{profileError}</div>}<button type="button" className="btn" onClick={closeModal}>Cancel</button><button className="btn primary" disabled={busy}>{busy?"Saving…":"Save"}</button></div>
    </form></div>}
  </div>
}
