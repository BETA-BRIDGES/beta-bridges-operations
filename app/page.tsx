"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ROLES, Role, can, canCopy, canCreate, canEditField } from "../lib/permissions";
import { supabase } from "../lib/supabase";
import { AppJob, AppTask, addTaskComment, createJob, createTask, loadJobs, loadTaskComments, loadTasks, updateJob, updateTaskStatus } from "../lib/data";
import { AuditLogRecord, ClientRecord, ChargeRecord, CompletionRecord, NotificationRecord, ReminderRecord, StockRecord, UserRecord, VehicleRecord, WeeklyRecord, addCompletionRemark, assignJobToTechnician, fieldTechStartJob, updateCompletion, createCharge, createClient, createCompletion, createStock, createVehicle, updateVehicle, deliverDueReminders, deliverReminderNow, loadAuditLogs, loadCharges, loadClients, loadCompletions, loadNotifications, loadProfiles, loadStock, loadReminders, loadVehicleManagement, loadVehicles, loadWeekly, loadLegacyDeviceExceptions, markNotificationRead, updateLegacyDeviceException, updateCharge, updateClient, updateStock, updateUserProfile, upsertWeekly, createReminder } from "../lib/moduleData";

type Profile={id:string;full_name:string;email:string;role:Role;active:boolean;module_access:string[]|null};
type GoogleStatus={connected:boolean;googleEmail:string|null;connections:{module:string;spreadsheet_id:string;sheet_name:string|null;last_sync_at:string|null;last_error:string|null;active:boolean;sync_direction:string}[]};
type FormState=Record<string,string>;

const MODULES=["Daily Job Listing","Daily Job Done","Used Stock","Techie Weekly Activity","Miscellaneous Charges","Client Data","Vehicle Management","Tasks","Field Technician"] as const;
function moduleLabel(value:string){return value==="Client Data"?"Client Database":value}
function today(){return new Date().toISOString().slice(0,10)}
function money(value:number){return `₦${Number(value||0).toLocaleString("en-NG")}`}
function pretty(value:string|null|undefined){return value||"—"}

function Table({headers,children}:{headers:string[];children:ReactNode}){return <div className="table-wrap"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>}
function Field({label,name,value,setValue,type="text",placeholder="",readOnly=false,options}:{label:string;name:string;value:string;setValue:(v:string)=>void;type?:string;placeholder?:string;readOnly?:boolean;options?:{value:string;label:string}[]}){return <label>{label}{options?<select value={value} disabled={readOnly} onChange={e=>setValue(e.target.value)}><option value="">Select…</option>{options.map(o=><option value={o.value} key={o.value}>{o.label}</option>)}</select>:type==="textarea"?<textarea value={value} readOnly={readOnly} placeholder={placeholder} onChange={e=>setValue(e.target.value)}/>:<input type={type} value={value} readOnly={readOnly} placeholder={placeholder} onChange={e=>setValue(e.target.value)}/>}</label>}
function Pager({page,total,pageSize,onPage}:{page:number;total:number;pageSize:number;onPage:(p:number)=>void}){
  if(!total) return <div className="muted">No records found.</div>;
  const pages=Math.max(1,Math.ceil(total/pageSize));
  const start=(page-1)*pageSize+1;
  const end=Math.min(page*pageSize,total);
  return <div className="section-head"><span className="muted">Showing {start}–{end} of {total}</span><div className="modal-actions"><button className="btn small" type="button" disabled={page<=1} onClick={()=>onPage(page-1)}>Previous</button><span className="muted">Page {page} of {pages}</span><button className="btn small" type="button" disabled={page>=pages} onClick={()=>onPage(page+1)}>Next</button></div></div>
}

export default function Home(){
  const router=useRouter();
  const [authLoading,setAuthLoading]=useState(Boolean(supabase));
  const [profile,setProfile]=useState<Profile|null>(null);
  const [hasSession,setHasSession]=useState(false);
  const [profileError,setProfileError]=useState("");
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
  const [reminders,setReminders]=useState<ReminderRecord[]>([]);
  const [auditLogs,setAuditLogs]=useState<AuditLogRecord[]>([]);
  const [jobVehicles,setJobVehicles]=useState<VehicleRecord[]>([]);
  const [managedVehicles,setManagedVehicles]=useState<VehicleRecord[]>([]);
  const [legacyExceptions,setLegacyExceptions]=useState<import("../lib/moduleData").LegacyDeviceExceptionRecord[]>([]);
  const [vehicleEditingId,setVehicleEditingId]=useState("");
  const [workflowVehicles,setWorkflowVehicles]=useState<VehicleRecord[]>([]);
  const [googleStatus,setGoogleStatus]=useState<GoogleStatus|null>(null);
  const [googleBusy,setGoogleBusy]=useState(false);
  const [googleMessage,setGoogleMessage]=useState("");
  const [tableSearch,setTableSearch]=useState("");
  const [tablePage,setTablePage]=useState(1);
  const [jobStatusFilter,setJobStatusFilter]=useState("");
  const [jobAssignmentFilter,setJobAssignmentFilter]=useState("all");
  const [reportDays,setReportDays]=useState("30");
  const pageSize=50;
  const [busy,setBusy]=useState(false);
  const [modal,setModal]=useState(false);
  const [editing,setEditing]=useState(false);
  const [formMode,setFormMode]=useState("record");
  const [form,setForm]=useState<FormState>({});
  const [selectedId,setSelectedId]=useState("");
  const [selectedTaskComments,setSelectedTaskComments]=useState<{id:string;comment:string;createdAt:string;user:string}[]>([]);
  const allowed=useMemo(()=>MODULES.filter(m=>{
    if(!can(role,m,"view")) return false;
    if(role==="Viewer" && Array.isArray(profile?.module_access)) return profile.module_access.includes(m);
    return true;
  }),[role,profile?.module_access]);
  const technicians=users.filter(u=>u.active&&u.role==="Field Technician");
  const technicianWorkload=(technicianId:string)=>jobs.filter(j=>j.technicianId===technicianId && !["Completed","Cancelled"].includes(j.status)).length;
  const unreadCount=notifications.filter(n=>!n.readAt).length;
  function setField(name:string,value:string){setForm(p=>({...p,[name]:value}))}
  function closeModal(){setModal(false);setEditing(false);setFormMode("record");setSelectedId("");setSelectedTaskComments([]);setVehicleEditingId("")}
  function openVehicleCreate(){setModule("Vehicle Management");setEditing(false);setFormMode("vehicle-record");setSelectedId("");setVehicleEditingId("");setForm({jobId:"",registration:"",vehicleMake:"",vehicleDetails:"",vehicleStatus:"Pending"});setModal(true)}
  function openVehicleEdit(vehicle:VehicleRecord){setModule("Vehicle Management");setEditing(true);setFormMode("vehicle-record");setSelectedId(vehicle.id);setVehicleEditingId(vehicle.id);setForm({jobId:vehicle.jobId,registration:vehicle.registration,vehicleMake:vehicle.vehicleMake,vehicleDetails:vehicle.vehicleDetails,vehicleStatus:vehicle.status});setModal(true)}
  function openUserEdit(user:UserRecord){setModule("Administration");setEditing(true);setFormMode("user");setSelectedId(user.id);setForm({role:user.role,active:String(user.active),moduleAccess:user.moduleAccess===null?MODULES.join("||"):user.moduleAccess.join("||")});setModal(true)}
  function openUserCreate(){setModule("Administration");setEditing(false);setFormMode("create-user");setSelectedId("");setForm({fullName:"",email:"",password:"",role:"Field Technician",moduleAccess:MODULES.join("||")});setModal(true)}
  function openAssignment(job:AppJob){setModule("Daily Job Listing");setEditing(false);setFormMode("assignment");setSelectedId(job.id);setForm({assignedTechnicianId:job.technicianId||""});setModal(true)}
  async function openTechnicianJob(job:AppJob){setModule("Field Technician");setEditing(false);setFormMode("technician-job");setSelectedId(job.id);setForm({jobId:job.id});setProfileError("");try{setWorkflowVehicles(await loadVehicles(job.id));setModal(true)}catch(error){setProfileError(error instanceof Error?error.message:"Unable to load assigned job vehicles.")}}
  async function startTechnicianJob(job:AppJob){setBusy(true);setProfileError("");try{await fieldTechStartJob(job.id,role);await refresh();setSelectedId(job.id);setForm({jobId:job.id});setWorkflowVehicles(await loadVehicles(job.id))}catch(error){setProfileError(error instanceof Error?error.message:"Unable to start assigned job.")}finally{setBusy(false)}}
  function openTechnicianCompletion(job:AppJob,vehicle:VehicleRecord){setModule("Daily Job Done");setEditing(false);setFormMode("record");setSelectedId("");setForm({jobId:job.id,vehicleId:vehicle.id,deviceId:"",date:today(),installer:profile?.full_name||"",location:job.location||"",client:job.client==="—"?"":job.client,vehicleDetails:vehicle.vehicleDetails||"",vehicleMake:vehicle.vehicleMake||"",tssOfficer:job.tssOfficer==="—"?"":job.tssOfficer,remarks:""})}
  function openReminderCreate(){setModule("Administration");setEditing(false);setFormMode("reminder");setSelectedId("");setForm({title:"",details:"",userId:profile?.id||"",remindAt:""});setModal(true)}
  async function openVehicles(job:AppJob){
    setModule("Daily Job Listing");
    setEditing(false);
    setFormMode("vehicles");
    setSelectedId(job.id);
    setForm({registration:"",vehicleMake:"",vehicleDetails:"",vehicleStatus:"Pending"});
    setProfileError("");
    try{setJobVehicles(await loadVehicles(job.id));setModal(true)}
    catch(error){setProfileError(error instanceof Error?error.message:"Unable to load vehicle details.")}
  }

  async function refresh(){
    if(!supabase) return;
    try{
      const [j,t,c,s,d,mc,w,u,n,r,v,e,a]=await Promise.all([loadJobs(profile?.role,profile?.id),loadTasks(),loadClients(),loadStock(),loadCompletions(),loadCharges(),loadWeekly(profile?.role,profile?.id),loadProfiles(),profile?.id?loadNotifications(profile.id):Promise.resolve([]),profile?.id?loadReminders(profile.id):Promise.resolve([]),loadVehicleManagement(),profile?.role==="Super Admin"?loadLegacyDeviceExceptions():Promise.resolve([]),profile?.role==="Super Admin"?loadAuditLogs():Promise.resolve([])]);
      setJobs(j);setTasks(t);setClients(c);setStock(s);setCompletions(d);setCharges(mc);setWeekly(w);setUsers(u);setNotifications(n);setReminders(r);setManagedVehicles(v);setLegacyExceptions(e as import("../lib/moduleData").LegacyDeviceExceptionRecord[]);setAuditLogs(a as AuditLogRecord[]);setProfileError("");
    }catch(error){setProfileError(error instanceof Error?error.message:"Unable to load operational data.")}
  }

  useEffect(()=>{
    if(!supabase){setAuthLoading(false);return}
    let mounted=true;
    async function load(){
      const {data:{session}}=await supabase!.auth.getSession();
      if(!mounted) return;
      if(!session){setHasSession(false);setAuthLoading(false);return}
      setHasSession(true);
      const {data,error}=await supabase!.from("profiles").select("id,full_name,email,role,active,module_access").eq("id",session.user.id).maybeSingle();
      if(!mounted) return;
      if(error){setProfileError(error.message);setAuthLoading(false);return}
      if(!data){
        setProfileError("Your account profile has not been created. Please contact a Super Admin.");
        setAuthLoading(false);
        return;
      }
      if(!(data as Profile).active){
        router.replace("/pending");
        return;
      }
      setProfile(data as Profile);setAuthLoading(false);
    }
    load();
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{if(!session) router.replace("/login")});
    return()=>{mounted=false;subscription.unsubscribe()};
  },[router]);
  useEffect(()=>{if(profile) void refresh();if(profile?.role==="Super Admin") void loadGoogleStatus()},[profile]);
  useEffect(()=>{
    if(!profile?.id) return;
    let active=true;
    const tick=async()=>{
      try{
        await deliverDueReminders();
        if(active){
          const [nextNotifications,nextReminders]=await Promise.all([loadNotifications(profile.id),loadReminders(profile.id)]);
          setNotifications(nextNotifications);setReminders(nextReminders);
        }
      }catch{}
    };
    void tick();
    const timer=window.setInterval(tick,30000);
    return()=>{active=false;window.clearInterval(timer)};
  },[profile?.id]);
  useEffect(()=>{
    setTablePage(1);
    setTableSearch("");
    if(module!=="Daily Job Listing"){
      setJobStatusFilter("");
      setJobAssignmentFilter("all");
    }
  },[module]);
  useEffect(()=>{
    if(!modal || !form.jobId || (module!=="Daily Job Done" && module!=="Used Stock")){
      setWorkflowVehicles([]);
      return;
    }
    let active=true;
    const job=jobs.find(j=>j.id===form.jobId);
    if(job){
      setForm(previous=>({
        ...previous,
        ...(module==="Daily Job Done"
          ? {
              client:previous.client|| (job.client==="—"?"":job.client),
              location:previous.location||job.location,
              tssOfficer:previous.tssOfficer||job.tssOfficer
            }
          : {
              client:previous.client|| (job.client==="—"?"":job.client),
              location:previous.location||job.location
            })
      }));
    }
    void loadVehicles(form.jobId)
      .then(rows=>{if(active) setWorkflowVehicles(rows)})
      .catch(error=>{if(active) setProfileError(error instanceof Error?error.message:"Unable to load workflow vehicles.")});
    return()=>{active=false};
  },[modal,module,form.jobId,jobs]);
  useEffect(()=>{
    if(!modal || !form.vehicleId) return;
    const vehicle=workflowVehicles.find(v=>v.id===form.vehicleId);
    if(!vehicle) return;
    setForm(previous=>({
      ...previous,
      vehicleDetails:previous.vehicleDetails||vehicle.vehicleDetails,
      vehicleMake:previous.vehicleMake||vehicle.vehicleMake
    }));
  },[modal,form.vehicleId,workflowVehicles]);

  async function signOut(){if(supabase) await supabase.auth.signOut();else setModule("Dashboard")}
  async function googleRequest(path:string,method:"GET"|"POST"="GET"){
    if(!supabase) throw new Error("Supabase is not configured.");
    const {data:{session}}=await supabase.auth.getSession();
    if(!session) throw new Error("Authentication required.");
    const response=await fetch(path,{method,headers:{authorization:`Bearer ${session.access_token}`}});
    const raw=await response.text();
    let body:any={};
    try{body=raw?JSON.parse(raw):{};}catch{}
    if(!response.ok){
      const detail=body?.error||raw?.trim()||`HTTP ${response.status} ${response.statusText}`;
      throw new Error(`Google Sheets request failed (${response.status}): ${detail}`);
    }
    return body;
  }
  async function loadGoogleStatus(){
    if(role!=="Super Admin") return false;
    try{setGoogleStatus(await googleRequest("/api/google/status"));return true;}
    catch(error){setGoogleMessage(error instanceof Error?error.message:"Unable to load Google Sheets status.");return false}
  }
  async function connectGoogle(){
    setGoogleBusy(true);setGoogleMessage("");
    try{const data=await googleRequest("/api/google/connect","POST");window.location.href=data.url;}catch(error){setGoogleMessage(error instanceof Error?error.message:"Unable to connect Google Sheets.");setGoogleBusy(false)}
  }
  async function previewGoogle(){
    setGoogleBusy(true);setGoogleMessage("");
    try{
      const data=await googleRequest("/api/google/import/preview","GET");
      const lines=(data.results??[]).map((r:any)=>{
        if(r.error) return `${r.module}: error — ${r.error}`;
        if(r.detected?.length) return `${r.module}: ${r.detected.map((d:any)=>`${d.title} (${d.dataRows} rows)`).join(", ")}`;
        return `${r.module}: no matching tabs (found: ${r.tabs?.join(", ")||"none"})`;
      });
      setGoogleMessage(`Import preview: ${lines.join(" • ")}`);
    }catch(error){setGoogleMessage(error instanceof Error?error.message:"Unable to preview legacy Google Sheets.");}finally{setGoogleBusy(false)}
  }

  async function importGoogle(){
    if(!window.confirm("Import the existing six Google Sheets into the Beta Bridges portal? This will add/update portal records and will not modify the Google Sheets.")) return;
    setGoogleBusy(true);setGoogleMessage("");
    const modules=["clientData","dailyJobListing","dailyJobDone","usedStock","miscellaneousCharges","techieWeeklyActivity"];
    const labels:Record<string,string>={clientData:"Client Data",dailyJobListing:"Daily Job Listing",dailyJobDone:"Daily Job Done",usedStock:"Used Stock",miscellaneousCharges:"Miscellaneous Charges",techieWeeklyActivity:"Techie Weekly Activity"};
    const results:any[]=[];
    try{
      for(const moduleName of modules){
        setGoogleMessage("Importing "+labels[moduleName]+"…");
        const {data:{session}}=await supabase!.auth.getSession();
        if(!session) throw new Error("Authentication required.");
        const response=await fetch("/api/google/import",{
          method:"POST",
          headers:{authorization:`Bearer ${session.access_token}`,"content-type":"application/json"},
          body:JSON.stringify({module:moduleName})
        });
        const body=await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(body.error||`Legacy import failed for ${labels[moduleName]}.`);
        const result=body.results?.[0];
        results.push(result);
        if(result?.errors?.length) setGoogleMessage(labels[moduleName]+": imported "+result.imported+", skipped "+result.skipped+", with "+result.errors.length+" errors.");
      }
      const lines=results.map(r=>`${r.module}: ${r.imported} imported, ${r.skipped} skipped${r.exceptions?", "+r.exceptions+" exceptions":""}${r.errors?.length?", "+r.errors.length+" errors":""}`);
      setGoogleMessage("Legacy import completed. "+lines.join(" • "));
      await refresh();
      try{await loadGoogleStatus();}catch{}
    }catch(error){
      setGoogleMessage(error instanceof Error?error.message:"Legacy Google Sheets import failed.");
    }finally{setGoogleBusy(false)}
  }

  async function previewSyncGoogle(){
    setGoogleBusy(true);setGoogleMessage("");
    try{
      const data=await googleRequest("/api/google/sync/preview","GET");
      const labels:Record<string,string>={
        clientData:"Client Data",
        dailyJobListing:"Daily Job Listing",
        dailyJobDone:"Daily Job Done",
        usedStock:"Used Stock",
        miscellaneousCharges:"Miscellaneous Charges",
        techieWeeklyActivity:"Techie Weekly Activity"
      };
      const lines=Object.entries(data.results??{}).map(([moduleName,value]:any)=>{
        const label=labels[moduleName]||moduleName;
        if(!value?.ok) return label+": error — "+(value?.error||"Preview failed");
        if(value.mode==="date-tabs"){
          const missing=value.missingTargets?.length||0;
          return label+": "+value.sourceRows+" rows across "+value.matchedTabs+" matched date tabs"+(missing?"; "+missing+" date tab(s) have no matching source date":"");
        }
        return label+": "+value.sourceRows+" rows → "+value.targetSheet;
      });
      setGoogleMessage("Sync preview: "+lines.join(" • "));
    }catch(error){setGoogleMessage(error instanceof Error?error.message:"Unable to preview Google Sheets sync.");}
    finally{setGoogleBusy(false)}
  }

  async function syncGoogle(){
    setGoogleBusy(true);setGoogleMessage("");
    try{const data=await googleRequest("/api/google/sync","POST");const failed=Object.entries(data.results??{}).filter(([,v]:any)=>!v.ok);setGoogleMessage(failed.length?`${failed.length} sheet(s) reported an error during sync.`:"All configured Google Sheets were synchronized successfully.");await loadGoogleStatus();}catch(error){setGoogleMessage(error instanceof Error?error.message:"Google Sheets sync failed.");}finally{setGoogleBusy(false)}
  }
  async function disconnectGoogle(){
    setGoogleBusy(true);setGoogleMessage("");
    try{await googleRequest("/api/google/disconnect","POST");setGoogleMessage("Google Sheets disconnected.");await loadGoogleStatus();}catch(error){setGoogleMessage(error instanceof Error?error.message:"Unable to disconnect Google Sheets.");}finally{setGoogleBusy(false)}
  }

  function openCreate(target:string){
    setModule(target);setEditing(false);setFormMode("record");setSelectedId("");
    const defaults:Record<string,FormState>={
      "Daily Job Listing":{clientId:"",numberOfVehicles:"1",scheduledDate:today(),scheduledTime:"",location:"",vehicleMake:"",priority:"Normal",description:"",notes:"",status:"Pending"},
      "Daily Job Done":{jobId:"",vehicleId:"",deviceId:"",date:today(),installer:"",location:"",client:"",vehicleDetails:"",vehicleMake:"",tssOfficer:profile?.full_name||"",remarks:""},
      "Used Stock":{deviceId:"",simId:"",dateIssued:today(),dateInstalled:"",installer:"",client:"",location:"",network:"",deviceType:"",deviceStatus:"",dateCollected:"",operationsRemark:"",operationsCorrection:"",vehicleDetails:"",vehicleMake:"",otherIssues:""},
      "Techie Weekly Activity":{technicianId:"",weekStart:today(),projects:"0",vehiclesCompleted:"0",remarks:""},
      "Miscellaneous Charges":{clientId:"",location:"",logistics:"0",accommodation:"0",swap:"0",deinstallation:"0",reinstallation:"0",healthCheck:"0",simReplacement:"0",others:"0",status:"Pending"},
      "Client Data":{name:"",clientCode:"",contactPerson:"",phone:"",email:"",location:"",category:"",status:"Active",notes:""},
      "Tasks":{title:"",description:"",assignedTo:"",department:"",priority:"Normal",dueAt:"",relatedJobId:""}
    };
    setForm(defaults[target]||{});setModal(true);
  }

  function openEdit(target:string,record:any){
    setModule(target);setEditing(true);setFormMode("record");setSelectedId(record.id);setModal(true);
    if(target==="Daily Job Listing") setForm({clientId:record.clientId||"",numberOfVehicles:String(record.vehicles),scheduledDate:record.date?new Date(record.date).toISOString().slice(0,10):today(),scheduledTime:record.time||"",location:record.location||"",vehicleMake:record.vehicleMake||"",priority:record.priority||"Normal",description:record.description||"",notes:record.notes||"",status:record.status});
    if(target==="Daily Job Done") setForm({jobId:record.jobUuid||"",vehicleId:record.vehicleId||"",deviceId:record.deviceId,date:record.date||today(),installer:record.installer,location:record.location,client:record.client,vehicleDetails:record.vehicleDetails,vehicleMake:record.vehicleMake,tssOfficer:record.tssOfficer,remarks:record.remarks});
    if(target==="Used Stock") setForm({...record});
    if(target==="Techie Weekly Activity") setForm({technicianId:record.technicianId,weekStart:record.weekStart,projects:String(record.projects),vehiclesCompleted:String(record.vehiclesCompleted),remarks:record.remarks});
    if(target==="Miscellaneous Charges") setForm({clientId:record.clientId||"",location:record.location,logistics:String(record.logistics),accommodation:String(record.accommodation),swap:String(record.swap),deinstallation:String(record.deinstallation),reinstallation:String(record.reinstallation),healthCheck:String(record.healthCheck),simReplacement:String(record.simReplacement),others:String(record.others),status:record.status});
    if(target==="Client Data") setForm({...record});
  }

  async function saveRecord(e:FormEvent){
    e.preventDefault();setBusy(true);setProfileError("");
    try{
      if(formMode==="assignment"){await assignJobToTechnician(selectedId,form.assignedTechnicianId||null,role);}else if(formMode==="reminder"){
        await createReminder({title:form.title||"",details:form.details,userId:form.userId||null,remindAt:form.remindAt},role);
      }else if(formMode==="create-user"){
        if(role!=="Super Admin") throw new Error("Only Super Admin can create user accounts.");
        const {data,error}=await supabase!.functions.invoke("admin-create-user",{body:{fullName:String(form.fullName||"").trim(),email:String(form.email||"").trim(),password:String(form.password||""),role:String(form.role||"Field Technician"),moduleAccess:String(form.moduleAccess||"").split("||").filter(Boolean)}});
        if(error) throw new Error(error.message||"Unable to create user account.");
        if(data?.error) throw new Error(String(data.error));
        if(!data?.ok) throw new Error("User account creation failed.");
      }else if(formMode==="user"){
        await updateUserProfile(selectedId,{role:form.role as Role,active:form.active==="true",moduleAccess:form.role==="Viewer"?String(form.moduleAccess||"").split("||").filter(Boolean):null},role);
      }else if(formMode==="comment"){
        await addTaskComment(selectedId,form.comment||"",profile?.id||"",role);
      }else if(formMode==="vehicles"){
        if(vehicleEditingId){
          if(!form.registration?.trim()) throw new Error("Vehicle registration is required.");
          await updateVehicle(vehicleEditingId,{registration:form.registration,vehicleMake:form.vehicleMake,vehicleDetails:form.vehicleDetails,status:form.vehicleStatus},role);
          setJobVehicles(await loadVehicles(selectedId));
          setVehicleEditingId("");
          setForm({registration:"",vehicleMake:"",vehicleDetails:"",vehicleStatus:"Pending"});
          setBusy(false);
          return;
        }
        if(jobVehicles.length >= (jobs.find(j=>j.id===selectedId)?.vehicles||0)) throw new Error("All vehicle slots for this project have already been recorded.");
        if(!form.registration?.trim()) throw new Error("Vehicle registration is required.");
        await createVehicle(selectedId,{registration:form.registration,vehicleMake:form.vehicleMake,vehicleDetails:form.vehicleDetails,status:form.vehicleStatus},role);
        setJobVehicles(await loadVehicles(selectedId));
        setForm({registration:"",vehicleMake:"",vehicleDetails:"",vehicleStatus:"Pending"});
        setBusy(false);
        return;
      }else if(formMode==="vehicle-record"){
        if(!form.jobId) throw new Error("Select an Operational Job before adding or editing a vehicle.");
        if(!form.registration?.trim()) throw new Error("Vehicle registration is required.");
        if(editing) await updateVehicle(selectedId,{registration:form.registration,vehicleMake:form.vehicleMake,vehicleDetails:form.vehicleDetails,status:form.vehicleStatus},role);
        else await createVehicle(form.jobId,{registration:form.registration,vehicleMake:form.vehicleMake,vehicleDetails:form.vehicleDetails,status:form.vehicleStatus},role);
      }else if(module==="Daily Job Listing"){
        const payload:any={client_id:form.clientId||null,number_of_vehicles:Math.max(1,Number(form.numberOfVehicles)||1),scheduled_date:form.scheduledDate||null,scheduled_time:form.scheduledTime||null,location:form.location||null,vehicle_make:form.vehicleMake||null,priority:form.priority||"Normal",description:form.description||null,notes:form.notes||null,status:form.status||"Pending"};
        if(editing) await updateJob(selectedId,payload,role);
        else await createJob({clientId:form.clientId||null,numberOfVehicles:Math.max(1,Number(form.numberOfVehicles)||1),scheduledDate:form.scheduledDate,scheduledTime:form.scheduledTime,location:form.location,vehicleMake:form.vehicleMake,priority:form.priority,description:form.description,notes:form.notes,tssOfficerId:profile?.id},role);
      }else if(module==="Daily Job Done"){
        if(formMode==="remark") await addCompletionRemark(selectedId,form.remark||"",role);
        else {
          if(!editing){
            if(!form.jobId) throw new Error("Select an Operational Job ID before recording completion.");
            if(!form.vehicleId) throw new Error("Select a Vehicle before recording completion.");
            if(!form.deviceId?.trim()) throw new Error("DEVICE ID is required before recording completion.");
          }
          if(editing) await updateCompletion(selectedId,{jobId:form.jobId||null,vehicleId:form.vehicleId||null,deviceId:form.deviceId,date:form.date,installer:form.installer,location:form.location,client:form.client,vehicleDetails:form.vehicleDetails,vehicleMake:form.vehicleMake,tssOfficer:form.tssOfficer,remarks:form.remarks},role);
          else await createCompletion({jobId:form.jobId||null,vehicleId:form.vehicleId||null,deviceId:form.deviceId,date:form.date,installer:form.installer,location:form.location,client:form.client,vehicleDetails:form.vehicleDetails,vehicleMake:form.vehicleMake,tssOfficer:form.tssOfficer,remarks:form.remarks},role);
        }
      }else if(module==="Used Stock"){
        if(!editing && role!=="Finance"){
          if(!form.jobId) throw new Error("Select an Operational Job before adding Used Stock for a workflow record.");
          if(!form.vehicleId) throw new Error("Select a Vehicle before adding Used Stock for a workflow record.");
          if(!form.deviceId?.trim()) throw new Error("Device ID is required for a workflow stock record.");
          if(!form.simId?.trim()) throw new Error("SIM ID is required for a workflow stock record.");
          if(!form.dateIssued) throw new Error("Date Issued is required for a workflow stock record.");
        }
        const patch:any={job_id:form.jobId||null,vehicle_id:form.vehicleId||null,device_id:form.deviceId||null,sim_id:form.simId||null,date_issued:form.dateIssued||null,date_installed:form.dateInstalled||null,installer:form.installer||null,client:form.client||null,location:form.location||null,network:form.network||null,device_type:form.deviceType||null,device_status:form.deviceStatus||null,date_collected:form.dateCollected||null,operations_remark:form.operationsRemark||null,operations_correction:form.operationsCorrection||null,vehicle_details:form.vehicleDetails||null,vehicle_make:form.vehicleMake||null,other_issues:form.otherIssues||null};
        if(editing) await updateStock(selectedId,patch,role);
        else if(role==="Finance") await createStock({device_id:form.deviceId||null,sim_id:form.simId||null,date_issued:form.dateIssued||null},role);
        else await createStock(patch,role);
      }else if(module==="Techie Weekly Activity"){
        await upsertWeekly({technicianId:form.technicianId,weekStart:form.weekStart,projects:Number(form.projects)||0,vehiclesCompleted:Number(form.vehiclesCompleted)||0,remarks:form.remarks},role);
      }else if(module==="Miscellaneous Charges"){
        const patch={client_id:form.clientId||null,location:form.location||null,logistics:Number(form.logistics)||0,accommodation:Number(form.accommodation)||0,swap:Number(form.swap)||0,deinstallation:Number(form.deinstallation)||0,reinstallation:Number(form.reinstallation)||0,health_check:Number(form.healthCheck)||0,sim_replacement:Number(form.simReplacement)||0,others:Number(form.others)||0,paid_or_approved:form.status||"Pending"};
        if(editing) await updateCharge(selectedId,patch,role); else await createCharge({clientId:form.clientId||null,location:form.location,logistics:Number(form.logistics)||0,accommodation:Number(form.accommodation)||0,swap:Number(form.swap)||0,deinstallation:Number(form.deinstallation)||0,reinstallation:Number(form.reinstallation)||0,healthCheck:Number(form.healthCheck)||0,simReplacement:Number(form.simReplacement)||0,others:Number(form.others)||0},role);
      }else if(module==="Client Data"){
        const patch={client_code:form.clientCode||null,name:form.name,contact_person:form.contactPerson||null,phone:form.phone||null,email:form.email||null,location:form.location||null,category:form.category||null,status:form.status||"Active",notes:form.notes||null};
        if(editing) await updateClient(selectedId,patch,role); else await createClient({name:form.name,contactPerson:form.contactPerson,phone:form.phone,email:form.email,location:form.location,category:form.category,notes:form.notes},role);
      }else if(module==="Tasks"){
        await createTask({title:form.title,description:form.description,assignedTo:form.assignedTo||null,dueAt:form.dueAt||null,department:form.department,priority:form.priority,relatedJobId:form.relatedJobId||null},role,profile?.id||"");
      }
      await refresh();closeModal();
    }catch(error){setProfileError(error instanceof Error?error.message:"Unable to save record.")}
    finally{setBusy(false)}
  }

  async function taskAction(task:AppTask,status:"Acknowledged"|"Completed"|"In Progress"|"Cancelled"){try{await updateTaskStatus(task.id,status,role);await refresh()}catch(error){setProfileError(error instanceof Error?error.message:"Unable to update task.")}}
  async function showComments(task:AppTask){setSelectedId(task.id);setForm({comment:""});setFormMode("comment");const comments=await loadTaskComments(task.id);setSelectedTaskComments(comments);setModal(true)}
  async function copyCharge(charge:ChargeRecord){const text=JSON.stringify(charge);try{await navigator.clipboard.writeText(text);setProfileError("Charge copied to clipboard.")}catch{setProfileError("Copy is not available in this browser.")}}

  const query=tableSearch.trim().toLowerCase();
  const matches=(values:unknown[])=>!query||values.some(value=>String(value??"").toLowerCase().includes(query));
  const paginate=<T,>(items:T[])=>items.slice((tablePage-1)*pageSize,tablePage*pageSize);
  // RLS already limits these two datasets at the database layer. Keep the
  // same restriction in the UI so a Field Technician only sees their own
  // assigned jobs and their own weekly activity if any rows are returned.
  const visibleJobs=role==="Field Technician"&&profile?.id
    ? jobs.filter(j=>j.technicianId===profile.id)
    : jobs;
  const visibleWeekly=role==="Field Technician"&&profile?.id
    ? weekly.filter(w=>w.technicianId===profile.id)
    : weekly;
  const fieldTechJobs=visibleJobs.filter(j=>j.technicianId);
  const fieldTechPendingVehicles=managedVehicles.filter(v=>v.status!=="Completed"&&v.technician&&v.technician!=="Unassigned").length;
  const fieldTechCompletedVehicles=managedVehicles.filter(v=>v.status==="Completed"&&v.technician&&v.technician!=="Unassigned").length;
  const filteredJobs=visibleJobs.filter(j=>{
    const statusMatch=!jobStatusFilter||j.status===jobStatusFilter;
    const assignmentMatch=jobAssignmentFilter==="all"
      || (jobAssignmentFilter==="unassigned" && !j.technicianId)
      || (jobAssignmentFilter==="assigned" && !!j.technicianId);
    return statusMatch && assignmentMatch && matches([j.jobId,j.client,j.tssOfficer,j.technician,j.location,j.status,j.date,j.priority]);
  });
  const filteredCompletions=completions.filter(c=>matches([c.jobId,c.deviceId,c.date,c.installer,c.client,c.location,c.status,c.remarks]));
  const filteredStock=stock.filter(s=>matches([s.jobId,s.vehicleId,s.deviceId,s.simId,s.dateIssued,s.dateInstalled,s.installer,s.client,s.location,s.network,s.deviceType,s.deviceStatus]));
  const filteredWeekly=visibleWeekly.filter(w=>matches([w.technician,w.week,w.projects,w.vehiclesCompleted,w.date,w.remarks]));
  const filteredCharges=charges.filter(ch=>matches([ch.chargeId,ch.client,ch.location,ch.logistics,ch.accommodation,ch.swap,ch.simReplacement,ch.others,ch.status]));
  const filteredClients=clients.filter(cl=>matches([cl.name,cl.clientCode,cl.contactPerson,cl.phone,cl.email,cl.location,cl.category,cl.status]));
  const filteredVehicles=managedVehicles.filter(v=>matches([v.jobKey,v.client,v.registration,v.vehicleMake,v.vehicleDetails,v.status,v.technician,v.scheduledDate]));
  const vehiclePending=managedVehicles.filter(v=>v.status==="Pending").length;
  const vehicleInProgress=managedVehicles.filter(v=>v.status==="In Progress").length;
  const vehicleCompleted=managedVehicles.filter(v=>v.status==="Completed").length;
  const filteredTasks=tasks.filter(t=>matches([t.taskKey,t.title,t.assignee,t.due,t.status,jobs.find(j=>j.id===t.relatedJobId)?.jobId]));
  const dashboardJobs=visibleJobs;
  const dashboardPending=dashboardJobs.filter(j=>j.status==="Pending").length;
  const dashboardInProgress=dashboardJobs.filter(j=>j.status==="In Progress").length;
  const dashboardCompleted=dashboardJobs.filter(j=>j.status==="Completed").length;
  const dashboardUnassigned=dashboardJobs.filter(j=>!j.technicianId).length;
  const dashboardVehiclesScheduled=dashboardJobs.reduce((n,j)=>n+j.vehicles,0);
  const dashboardVehiclesCompleted=managedVehicles.filter(v=>v.status==="Completed").length;
  const dashboardOpenTasks=tasks.filter(t=>!["Completed","Cancelled"].includes(t.status)).length;
  const dashboardOpenExceptions=legacyExceptions.filter(x=>x.status==="Open").length;
  const dashboardTechWorkload=technicians.map(t=>({id:t.id,name:t.fullName,activeJobs:technicianWorkload(t.id)})).sort((a,b)=>b.activeJobs-a.activeJobs);

  const reportWindowDays=reportDays==="all"?null:Number(reportDays);
  const reportEndDate=new Date();
  reportEndDate.setHours(23,59,59,999);
  const reportStartDate=new Date(reportEndDate);
  if(reportWindowDays!==null) reportStartDate.setDate(reportEndDate.getDate()-reportWindowDays+1);
  reportStartDate.setHours(0,0,0,0);
  const inReportRange=(value:string|null|undefined)=>{
    if(!value) return false;
    const date=new Date(\`\${value}T00:00:00\`);
    if(Number.isNaN(date.getTime())) return false;
    return reportWindowDays===null || (date>=reportStartDate&&date<=reportEndDate);
  };
  const inReportDateTimeRange=(value:string|null|undefined)=>{
    if(!value) return false;
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return false;
    return reportWindowDays===null || (date>=reportStartDate&&date<=reportEndDate);
  };

  const reportJobs=dashboardJobs.filter(j=>inReportRange(j.dateIso));
  const reportVehicles=managedVehicles.filter(v=>inReportRange(v.scheduledDate||null));
  const reportCompletions=completions.filter(c=>inReportRange(c.date));
  const reportDeviceCompletions=reportCompletions.filter(c=>Boolean(c.deviceId.trim()));
  const reportExceptionCompletions=reportCompletions.filter(c=>!c.deviceId.trim());
  const reportScheduledVehicles=reportJobs.reduce((sum,j)=>sum+j.vehicles,0);
  const reportCompletedVehicles=reportVehicles.filter(v=>v.status==="Completed").length;
  const reportPendingVehicles=reportVehicles.filter(v=>v.status!=="Completed").length;
  const reportUnassignedProjects=reportJobs.filter(j=>!j.technicianId).length;
  const reportUnassignedVehicles=reportJobs.filter(j=>!j.technicianId).reduce((sum,j)=>sum+j.vehicles,0);
  const reportCompletionRate=reportScheduledVehicles?Math.round((reportCompletedVehicles/reportScheduledVehicles)*100):0;
  const reportOpenTasks=tasks.filter(t=>!["Completed","Cancelled"].includes(t.status));
  const reportOverdueTasks=reportOpenTasks.filter(t=>t.dueAt&&new Date(t.dueAt).getTime()<Date.now());
  const reportIssuedStock=stock.filter(s=>inReportRange(s.dateIssued)).length;
  const reportInstalledStock=stock.filter(s=>inReportRange(s.dateInstalled)).length;
  const reportAwaitingInstall=stock.filter(s=>s.dateIssued&&!s.dateInstalled).length;
  const reportChargesTotal=charges.reduce((sum,c)=>sum+c.logistics+c.accommodation+c.swap+c.deinstallation+c.reinstallation+c.healthCheck+c.simReplacement+c.others,0);
  const reportPendingCharges=charges.filter(c=>/PENDING/i.test(c.status||"")).reduce((sum,c)=>sum+c.logistics+c.accommodation+c.swap+c.deinstallation+c.reinstallation+c.healthCheck+c.simReplacement+c.others,0);

  const reportTrend=Array.from({length:14},(_,offset)=>{
    const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-(13-offset));
    const key=d.toISOString().slice(0,10);
    const label=d.toLocaleDateString("en-GB",{day:"2-digit",month:"short"});
    const dayJobs=reportJobs.filter(j=>j.dateIso===key);
    const dayVehicles=reportVehicles.filter(v=>v.scheduledDate===key);
    const dayCompletions=reportDeviceCompletions.filter(c=>c.date===key).length;
    return {key,label,projects:dayJobs.length,vehicles:dayJobs.reduce((sum,j)=>sum+j.vehicles,0),vehiclesCompleted:dayVehicles.filter(v=>v.status==="Completed").length,completions:dayCompletions};
  });
  const maxTrend=Math.max(1,...reportTrend.map(x=>Math.max(x.vehicles,x.vehiclesCompleted,x.completions)));

  const reportTechRows=technicians.map(t=>{
    const jobs=reportJobs.filter(j=>j.technicianId===t.id);
    const vehicles=reportVehicles.filter(v=>v.technicianId===t.id);
    return {id:t.id,name:t.fullName,projects:jobs.length,planned:jobs.reduce((sum,j)=>sum+j.vehicles,0),completed:vehicles.filter(v=>v.status==="Completed").length,pending:vehicles.filter(v=>v.status!=="Completed").length};
  }).sort((a,b)=>b.completed-a.completed||b.projects-a.projects||a.name.localeCompare(b.name));

  const clientAnalytics=Array.from(new Set(reportJobs.map(j=>j.client).filter(x=>x&&x!=="—"))).map(client=>{
    const jobs=reportJobs.filter(j=>j.client===client);
    const vehicles=reportVehicles.filter(v=>v.client===client);
    return {client,projects:jobs.length,planned:jobs.reduce((sum,j)=>sum+j.vehicles,0),completed:vehicles.filter(v=>v.status==="Completed").length};
  }).sort((a,b)=>b.planned-a.planned||a.client.localeCompare(b.client)).slice(0,8);

  const taskHealth=reportOpenTasks.map(t=>({
    ...t,
    relatedJob:jobs.find(j=>j.id===t.relatedJobId)?.jobId||"—",
    overdue:Boolean(t.dueAt&&new Date(t.dueAt).getTime()<Date.now())
  })).sort((a,b)=>Number(b.overdue)-Number(a.overdue));

  

  if(authLoading) return <main className="login-page"><section className="login-card"><div className="brand">BETA BRIDGES</div><h1>Loading Operations Portal</h1><p className="muted">Checking account and permissions…</p></section></main>;
  if(!hasSession) return <main className="login-page"><section className="login-card"><div className="brand">BETA BRIDGES</div><h1>Operations Portal</h1><p className="muted">Welcome to the Beta Bridges Operations Management Portal.</p><div className="section"><div className="card"><h3>Existing user</h3><p className="muted">Sign in with your Beta Bridges account.</p><a className="btn primary" href="/login">Login</a></div><div className="card" style={{marginTop:12}}><h3>New user</h3><p className="muted">Create an account and request an operational role.</p><a className="btn" href="/signup">Sign up</a></div></div></section></main>;
  if(supabase&&!profile) return <main className="login-page"><section className="login-card"><div className="brand">BETA BRIDGES</div><h1>Account status</h1><p className="muted">This account does not have an active Beta Bridges profile yet.</p>{profileError&&<div className="login-error">{profileError}</div>}<p className="auth-link"><a href="/pending">View account status</a> · <a href="/login">Return to sign in</a></p></section></main>;

  return <div className="app">
    <aside className="sidebar"><div className="brand">BETA BRIDGES</div><div className="side-note">Operations Management</div><nav className="nav">
      <a className={module==="Dashboard"?"active":""} onClick={()=>setModule("Dashboard")}>Dashboard</a>
      {allowed.map(m=><a key={m} className={module===m?"active":""} onClick={()=>setModule(m)}>{moduleLabel(m)}</a>)}
      <a className={module==="Notifications"?"active":""} onClick={()=>setModule("Notifications")}>Notifications{unreadCount>0&&<span className="badge">{unreadCount}</span>}</a>
      {role==="Super Admin"&&<a className={module==="Administration"?"active":""} onClick={()=>setModule("Administration")}>Administration</a>}
    </nav></aside>

    <main className="main"><header className="topbar"><div><h1 className="page-title">{moduleLabel(module)}</h1><div className="muted">Central operations workspace</div></div><div className="topbar-actions">{supabase?<div className="user-chip"><strong>{profile?.full_name||profile?.email}</strong><span>{role}</span></div>:<select value={demoRole} onChange={e=>{setDemoRole(e.target.value as Role);setModule("Dashboard")}} className="role-select">{ROLES.map(r=><option key={r}>{r}</option>)}</select>}{supabase&&<button className="btn" onClick={signOut}>Sign out</button>}</div></header>
      {profileError&&<div className="login-error page-error">{profileError}</div>}

      {module==="Dashboard"&&<>
        <section className="report-toolbar card">
          <div>
            <h3 style={{margin:"0 0 4px"}}>Operational reporting</h3>
            <p className="muted">Workflow performance across jobs, vehicles, completions, stock, tasks and financial charges.</p>
          </div>
          <label className="report-range">Reporting window
            <select value={reportDays} onChange={e=>setReportDays(e.target.value)}>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="all">All available data</option>
            </select>
          </label>
        </section>

        <section className="grid analytics-grid">
          <div className="card"><div className="muted">Projects in window</div><div className="stat">{reportJobs.length}</div><div className="metric-note">{dashboardPending} pending overall</div></div>
          <div className="card"><div className="muted">Vehicles scheduled</div><div className="stat">{reportScheduledVehicles}</div><div className="metric-note">{reportUnassignedVehicles} on unassigned projects</div></div>
          <div className="card"><div className="muted">Vehicles completed</div><div className="stat">{reportCompletedVehicles}</div><div className="metric-note">{reportCompletionRate}% of scheduled vehicles</div></div>
          <div className="card"><div className="muted">Recorded completions</div><div className="stat">{reportCompletions.length}</div><div className="metric-note">{reportDeviceCompletions.length} device-linked</div></div>
          <div className="card"><div className="muted">Awaiting installation</div><div className="stat">{reportAwaitingInstall}</div><div className="metric-note">{reportIssuedStock} stock issued in window</div></div>
          <div className="card"><div className="muted">Open / overdue tasks</div><div className="stat">{reportOpenTasks.length}</div><div className="metric-note">{reportOverdueTasks.length} overdue</div></div>
          <div className="card"><div className="muted">Charges recorded</div><div className="stat">{money(reportChargesTotal)}</div><div className="metric-note">{money(reportPendingCharges)} pending</div></div>
          <div className="card"><div className="muted">Unassigned projects</div><div className="stat">{reportUnassignedProjects}</div><div className="metric-note">{dashboardUnassigned} overall</div></div>
        </section>

        <section className="section two">
          <div className="card">
            <div className="section-head"><div><h3>Workflow funnel</h3><p className="muted">Current project progression plus vehicle-level completion.</p></div></div>
            <div className="funnel-list">
              <div><span>Pending</span><strong>{dashboardPending}</strong></div><div className="progress"><i style={{width:`${dashboardJobs.length?Math.round((dashboardPending/dashboardJobs.length)*100):0}%`}}/></div>
              <div><span>Assigned</span><strong>{dashboardJobs.filter(j=>j.technicianId).length}</strong></div><div className="progress"><i style={{width:`${dashboardJobs.length?Math.round((dashboardJobs.filter(j=>j.technicianId).length/dashboardJobs.length)*100):0}%`}}/></div>
              <div><span>In progress</span><strong>{dashboardInProgress}</strong></div><div className="progress"><i style={{width:`${dashboardJobs.length?Math.round((dashboardInProgress/dashboardJobs.length)*100):0}%`}}/></div>
              <div><span>Completed</span><strong>{dashboardCompleted}</strong></div><div className="progress"><i style={{width:`${dashboardJobs.length?Math.round((dashboardCompleted/dashboardJobs.length)*100):0}%`}}/></div>
            </div>
            <div className="workflow-summary"><span>Vehicle pipeline</span><strong>{dashboardVehiclesCompleted}/{dashboardVehiclesScheduled} completed</strong><span>{reportPendingVehicles} vehicle records still open in window</span></div>
          </div>

          <div className="card">
            <div className="section-head"><div><h3>Task health</h3><p className="muted">Open work requiring operational attention.</p></div><span className={reportOverdueTasks.length?"badge warn":"badge"}>{reportOverdueTasks.length} overdue</span></div>
            {taskHealth.length?taskHealth.slice(0,7).map(t=><div className="task" key={t.id}><strong>{t.title}</strong><span>{t.assignee} · {t.due} · {t.relatedJob}</span><em className={t.overdue?"task-overdue":""}>{t.overdue?"Overdue":t.status}</em></div>):<p className="muted">No open tasks.</p>}
          </div>
        </section>

        <section className="section two">
          <div className="card">
            <div className="section-head"><div><h3>14-day activity trend</h3><p className="muted">Scheduled vehicles compared with completed vehicle records and device-linked completion records.</p></div></div>
            <div className="mini-bars">{reportTrend.map(row=><div className="mini-bar-row" key={row.key}><span>{row.label}</span><div className="mini-track"><i title={`Scheduled: ${row.vehicles}`} style={{width:`${Math.round((row.vehicles/maxTrend)*100)}%`}}/></div><strong>{row.vehicles}</strong><div className="mini-track secondary"><i title={`Completed: ${row.vehiclesCompleted}`} style={{width:`${Math.round((row.vehiclesCompleted/maxTrend)*100)}%`}}/></div><strong>{row.vehiclesCompleted}</strong><div className="mini-track tertiary"><i title={`Device-linked completions: ${row.completions}`} style={{width:`${Math.round((row.completions/maxTrend)*100)}%`}}/></div><strong>{row.completions}</strong></div>)}</div>
            <div className="trend-legend"><span>Scheduled</span><span>Completed vehicle records</span><span>Device-linked completions</span></div>
          </div>

          <div className="card">
            <div className="section-head"><div><h3>Technician workload & output</h3><p className="muted">Projects and vehicle records attributable to each Field Technician.</p></div></div>
            <Table headers={["Technician","Projects","Planned vehicles","Completed","Pending"]}>{reportTechRows.length?reportTechRows.map(t=><tr key={t.id}><td>{t.name}</td><td>{t.projects}</td><td>{t.planned}</td><td>{t.completed}</td><td>{t.pending}</td></tr>):<tr><td colSpan={5}>No Field Technicians.</td></tr>}</Table>
          </div>
        </section>

        <section className="section two">
          <div className="card">
            <div className="section-head"><div><h3>Client workload</h3><p className="muted">Top clients by scheduled vehicle volume in the reporting window.</p></div></div>
            <Table headers={["Client","Projects","Planned vehicles","Completed"]}>{clientAnalytics.length?clientAnalytics.map(x=><tr key={x.client}><td>{x.client}</td><td>{x.projects}</td><td>{x.planned}</td><td>{x.completed}</td></tr>):<tr><td colSpan={4}>No client activity in this window.</td></tr>}</Table>
          </div>

          <div className="card">
            <div className="section-head"><div><h3>Data quality & exceptions</h3><p className="muted">Items that should be reviewed before operational reporting is treated as complete.</p></div></div>
            <div className="exception-list">
              <div><span>Completion records without DEVICE ID</span><strong>{reportExceptionCompletions.length}</strong></div>
              <div><span>Open legacy exceptions</span><strong>{dashboardOpenExceptions}</strong></div>
              <div><span>Stock records with Device ID + SIM ID</span><strong>{stock.filter(s=>s.deviceId.trim()&&s.simId.trim()).length}</strong></div>
              <div><span>Installed stock records in window</span><strong>{reportInstalledStock}</strong></div>
            </div>
            <p className="muted" style={{marginTop:12}}>The completion exception count includes legacy summary rows that do not carry a physical Device ID.</p>
          </div>
        </section>

        {role==="Super Admin"&&<section className="section card">
          <div className="section-head"><div><h3>Recent audit activity</h3><p className="muted">Latest recorded operational changes.</p></div><span className="muted">{auditLogs.length} loaded</span></div>
          <Table headers={["Time","Actor","Module","Action","Record"]}>{auditLogs.slice(0,10).map(a=><tr key={a.id}><td>{a.createdAt}</td><td>{a.actor}</td><td>{a.module}</td><td>{a.action}</td><td>{a.recordId}</td></tr>)}</Table>
        </section>}
      </>}

      {module==="Daily Job Listing"&&<section>
        <section className="grid">
          <div className="card"><div className="muted">Projects</div><div className="stat">{visibleJobs.length}</div></div>
          <div className="card"><div className="muted">Unassigned</div><div className="stat">{visibleJobs.filter(j=>!j.technicianId).length}</div></div>
          <div className="card"><div className="muted">Assigned</div><div className="stat">{visibleJobs.filter(j=>!!j.technicianId).length}</div></div>
          <div className="card"><div className="muted">In Progress</div><div className="stat">{visibleJobs.filter(j=>j.status==="In Progress").length}</div></div>
        </section>
        <section className="card">
          <div className="section-head"><div><h3>Daily Job Listing</h3><p className="muted">{role==="Field Technician"?"Only jobs assigned to you are shown. ":""}Each Job ID represents one operational project; NUMBER OF JOBS is the vehicle count for that project.</p></div>{canCreate(role,module)&&<button className="btn primary" onClick={()=>openCreate(module)}>Add project</button>}</div>
          <div className="section-head">
            <input className="table-search" value={tableSearch} onChange={e=>{setTableSearch(e.target.value);setTablePage(1)}} placeholder="Search jobs, clients, technicians, locations…"/>
            <select value={jobStatusFilter} onChange={e=>{setJobStatusFilter(e.target.value);setTablePage(1)}}><option value="">All statuses</option>{["Pending","Acknowledged","In Progress","Completed","Cancelled","Overdue"].map(x=><option key={x} value={x}>{x}</option>)}</select>
            <select value={jobAssignmentFilter} onChange={e=>{setJobAssignmentFilter(e.target.value);setTablePage(1)}}><option value="all">All assignment states</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option></select>
            <span className="muted">{filteredJobs.length} matching</span>
          </div>
          <Table headers={["Job ID","Vehicles","Client","Date","Time","Location","Technician","Status","Actions"]}>{paginate(filteredJobs).map(j=><tr key={j.id}>
            <td>{j.jobId}</td><td>{j.vehicles}</td><td>{j.client}</td><td>{j.date}</td><td>{j.time||"—"}</td><td>{pretty(j.location)}</td><td>{j.technician}</td><td>{j.status}</td>
            <td>{can(role,module,"edit")&&<button className="btn small" onClick={()=>openEdit(module,j)}>Edit</button>}{can(role,module,"assign")&&<button className="btn small" onClick={()=>openAssignment(j)}>{j.technicianId?"Reassign":"Assign"}</button>}{canCreate(role,module)&&<button className="btn small" onClick={()=>openVehicles(j)}>Vehicles</button>}</td>
          </tr>)}</Table>
          <Pager page={tablePage} total={filteredJobs.length} pageSize={pageSize} onPage={setTablePage}/>
        </section>
      </section>}
{module==="Field Technician"&&<section className="section two">
        <div className="card">
          <div className="section-head"><div><h3>Field Technician Workspace</h3><p className="muted">{role==="Field Technician"?"Only jobs assigned to you are shown.":"Assigned-job overview for field operations."}</p></div></div>
          <section className="grid">
            <div className="card"><div className="muted">Assigned projects</div><div className="stat">{fieldTechJobs.length}</div></div>
            <div className="card"><div className="muted">Vehicles completed</div><div className="stat">{fieldTechCompletedVehicles}</div></div>
            <div className="card"><div className="muted">Vehicles pending</div><div className="stat">{fieldTechPendingVehicles}</div></div>
          </section>
          <Table headers={["Operational Job ID","Client","Vehicles","Date","Location","Technician","Status","Action"]}>{paginate(fieldTechJobs).map(j=>{const vehicleRows=managedVehicles.filter(v=>v.jobId===j.id);const completed=vehicleRows.filter(v=>v.status==="Completed").length;return <tr key={j.id}><td>{j.jobId}</td><td>{j.client}</td><td>{completed}/{j.vehicles}</td><td>{j.date}</td><td>{pretty(j.location)}</td><td>{j.technician}</td><td>{j.status}</td><td><button type="button" className="btn small" onClick={()=>openTechnicianJob(j)}>Open job</button>{(j.status==="Pending"||j.status==="Acknowledged")&&role==="Field Technician"&&<button type="button" className="btn small" onClick={()=>void startTechnicianJob(j)}>Start</button>}</td></tr>})}</Table>
        </div>
      </section>}
      {module==="Daily Job Done"&&<section className="card"><div className="section-head"><div><h3>Daily Job Done</h3><p className="muted">DEVICE ID is the physical tracker identifier. Operational Job ID is linked to the project record; legacy rows without a match remain unlinked until assigned.</p></div>{canCreate(role,module)&&<button className="btn primary" onClick={()=>openCreate(module)}>Add completion</button>}</div><div className="section-head"><input className="table-search" value={tableSearch} onChange={e=>{setTableSearch(e.target.value);setTablePage(1)}} placeholder="Search Job ID, DEVICE ID, client, installer…"/><span className="muted">{filteredCompletions.length} matching</span></div><Table headers={["Operational Job ID","DEVICE ID","Date","Installer","Client","Status","Remark","Actions"]}>{paginate(filteredCompletions).map(c=><tr key={c.id}><td>{c.jobId||"—"}</td><td>{c.deviceId||"—"}</td><td>{c.date}</td><td>{c.installer||"—"}</td><td>{c.client||"—"}</td><td>{c.status}</td><td>{pretty(c.remarks)}</td><td>{can(role,module,"edit")&&<button className="btn small" onClick={()=>openEdit(module,c)}>Edit</button>}{can(role,module,"remark")&&<button className="btn small" onClick={()=>{setSelectedId(c.id);setForm({remark:c.remarks});setFormMode("remark");setModal(true)}}>Remark</button>}</td></tr>)}</Table><Pager page={tablePage} total={filteredCompletions.length} pageSize={pageSize} onPage={setTablePage}/></section>}
      {module==="Used Stock"&&<section className="card"><div className="section-head"><div><h3>Used Stock</h3><p className="muted">Operations cannot change Device ID, SIM ID or Date Issued. Finance can create records with Device ID, SIM ID and Date Issued, and can edit only those three fields on existing records.</p></div>{canCreate(role,module)&&<button className="btn primary" onClick={()=>openCreate(module)}>Add stock record</button>}</div><div className="section-head"><input className="table-search" value={tableSearch} onChange={e=>{setTableSearch(e.target.value);setTablePage(1)}} placeholder="Search device, SIM, client, installer, location…"/><span className="muted">{filteredStock.length} matching</span></div><Table headers={["Job","Device ID","SIM ID","Date Issued","Date Installed","Installer","Client","Location","Network","Actions"]}>{paginate(filteredStock).map(s=><tr key={s.id}><td>{s.jobId?(jobs.find(j=>j.id===s.jobId)?.jobId||"Linked job"):"—"}</td><td>{s.deviceId||"—"}</td><td>{s.simId||"—"}</td><td>{s.dateIssued||"—"}</td><td>{s.dateInstalled||"—"}</td><td>{s.installer||"—"}</td><td>{s.client||"—"}</td><td>{s.location||"—"}</td><td>{s.network||"—"}</td><td>{can(role,module,"edit")&&<button className="btn small" onClick={()=>openEdit(module,s)}>Edit</button>}</td></tr>)}</Table><Pager page={tablePage} total={filteredStock.length} pageSize={pageSize} onPage={setTablePage}/></section>}
      {module==="Techie Weekly Activity"&&<section className="card"><div className="section-head"><div><h3>Techie Weekly Activity Report</h3><p className="muted">{role==="Field Technician"?"Only your completed activity is shown. ":""}Tracks projects and vehicles completed by Field Technician.</p></div>{canCreate(role,module)&&<button className="btn primary" onClick={()=>openCreate(module)}>Add weekly record</button>}</div><div className="section-head"><input className="table-search" value={tableSearch} onChange={e=>{setTableSearch(e.target.value);setTablePage(1)}} placeholder="Search technician, week, remarks…"/><span className="muted">{filteredWeekly.length} matching</span></div><Table headers={["Technician","Week","Projects","Vehicles Completed","Updated","Remarks","Actions"]}>{paginate(filteredWeekly).map(w=><tr key={w.id}><td>{w.technician}</td><td>{w.week}</td><td>{w.projects}</td><td>{w.vehiclesCompleted}</td><td>{w.date}</td><td>{pretty(w.remarks)}</td><td>{can(role,module,"edit")&&<button className="btn small" onClick={()=>openEdit(module,w)}>Edit</button>}</td></tr>)}</Table><Pager page={tablePage} total={filteredWeekly.length} pageSize={pageSize} onPage={setTablePage}/></section>}
      {module==="Miscellaneous Charges"&&<section className="card"><div className="section-head"><div><h3>Miscellaneous Charges</h3><p className="muted">Finance has view/copy access only; TSS Officer enters and maintains the records.</p></div>{canCreate(role,module)&&<button className="btn primary" onClick={()=>openCreate(module)}>Add charge</button>}</div><div className="section-head"><input className="table-search" value={tableSearch} onChange={e=>{setTableSearch(e.target.value);setTablePage(1)}} placeholder="Search charge, client, location, status…"/><span className="muted">{filteredCharges.length} matching</span></div><Table headers={["Charge ID","Client","Logistics","Accommodation","Swap","SIM Replacement","Others","Status","Actions"]}>{paginate(filteredCharges).map(c=><tr key={c.id}><td>{c.chargeId}</td><td>{c.client}</td><td>{money(c.logistics)}</td><td>{money(c.accommodation)}</td><td>{money(c.swap)}</td><td>{money(c.simReplacement)}</td><td>{money(c.others)}</td><td>{c.status}</td><td>{can(role,module,"edit")&&<button className="btn small" onClick={()=>openEdit(module,c)}>Edit</button>}{canCopy(role,module)&&<button className="btn small" onClick={()=>copyCharge(c)}>Copy</button>}</td></tr>)}</Table><Pager page={tablePage} total={filteredCharges.length} pageSize={pageSize} onPage={setTablePage}/></section>}
      {module==="Client Data"&&<section className="card"><div className="section-head"><div><h3>Client Database</h3><p className="muted">Master client directory used by jobs and billing.</p></div>{canCreate(role,module)&&<button className="btn primary" onClick={()=>openCreate(module)}>Add client</button>}</div><div className="section-head"><input className="table-search" value={tableSearch} onChange={e=>{setTableSearch(e.target.value);setTablePage(1)}} placeholder="Search client, contact, phone, email, location…"/><span className="muted">{filteredClients.length} matching</span></div><Table headers={["Client","Contact","Phone","Email","Location","Category","Status","Actions"]}>{paginate(filteredClients).map(c=><tr key={c.id}><td>{c.name}</td><td>{pretty(c.contactPerson)}</td><td>{pretty(c.phone)}</td><td>{pretty(c.email)}</td><td>{pretty(c.location)}</td><td>{pretty(c.category)}</td><td>{c.status}</td><td>{can(role,module,"edit")&&<button className="btn small" onClick={()=>openEdit(module,c)}>Edit</button>}</td></tr>)}</Table><Pager page={tablePage} total={filteredClients.length} pageSize={pageSize} onPage={setTablePage}/></section>}
      {module==="Vehicle Management"&&<section className="card">
        <div className="section-head">
          <div>
            <h3>Vehicle Management</h3>
            <p className="muted">Manage vehicles against their Operational Job and use the same Job + Vehicle link for completion and stock records.</p>
          </div>
          {canCreate(role,module)&&<button className="btn primary" onClick={openVehicleCreate}>Add vehicle</button>}
        </div>
        <section className="grid">
          <div className="card"><div className="muted">Total vehicles</div><div className="stat">{managedVehicles.length}</div></div>
          <div className="card"><div className="muted">Pending</div><div className="stat">{vehiclePending}</div></div>
          <div className="card"><div className="muted">In Progress</div><div className="stat">{vehicleInProgress}</div></div>
          <div className="card"><div className="muted">Completed</div><div className="stat">{vehicleCompleted}</div></div>
        </section>
        <div className="section-head">
          <input className="table-search" value={tableSearch} onChange={e=>{setTableSearch(e.target.value);setTablePage(1)}} placeholder="Search registration, Job ID, client, make, technician…"/>
          <span className="muted">{filteredVehicles.length} matching</span>
        </div>
        <Table headers={["Job ID","Client","Registration","Vehicle Make","Vehicle Details","Technician","Status","Actions"]}>
          {paginate(filteredVehicles).map(v=><tr key={v.id}>
            <td>{v.jobKey||"—"}</td>
            <td>{v.client||"—"}</td>
            <td>{v.registration||"Unregistered"}</td>
            <td>{v.vehicleMake||"—"}</td>
            <td>{v.vehicleDetails||"—"}</td>
            <td>{v.technician||"Unassigned"}</td>
            <td>{v.status||"Pending"}</td>
            <td>{can(role,module,"edit")&&<button className="btn small" onClick={()=>openVehicleEdit(v)}>Edit</button>}</td>
          </tr>)}
        </Table>
        <Pager page={tablePage} total={filteredVehicles.length} pageSize={pageSize} onPage={setTablePage}/>
      </section>}
      {module==="Tasks"&&<section className="card"><div className="section-head"><div><h3>Tasks & Reminders</h3><p className="muted">Tasks can be created, assigned, updated and commented on by all operational users. Viewers have read-only task access.</p></div>{canCreate(role,module)&&<button className="btn primary" onClick={()=>openCreate(module)}>Create task</button>}</div><div className="section-head"><input className="table-search" value={tableSearch} onChange={e=>{setTableSearch(e.target.value);setTablePage(1)}} placeholder="Search task, assignee, due date, status…"/><span className="muted">{filteredTasks.length} matching</span></div><Table headers={["Task ID","Linked Job","Title","Assignee","Due","Status","Actions"]}>{paginate(filteredTasks).map(t=><tr key={t.id}><td>{t.taskKey}</td><td>{t.relatedJobId?(jobs.find(j=>j.id===t.relatedJobId)?.jobId||"Linked job"):"—"}</td><td>{t.title}</td><td>{t.assignee}</td><td>{t.due}</td><td>{t.status}</td><td>{can(role,module,"complete")&&t.status==="Pending"&&<button className="btn small" onClick={()=>taskAction(t,"Acknowledged")}>Acknowledge receipt</button>}{can(role,module,"complete")&&t.status==="Acknowledged"&&<button className="btn small" onClick={()=>taskAction(t,"In Progress")}>Start</button>}{can(role,module,"complete")&&t.status==="In Progress"&&<button className="btn small" onClick={()=>taskAction(t,"Completed")}>Complete</button>}{can(role,module,"comment")&&<button className="btn small" onClick={()=>showComments(t)}>Comment</button>}</td></tr>)}</Table><Pager page={tablePage} total={filteredTasks.length} pageSize={pageSize} onPage={setTablePage}/></section>}
      {module==="Notifications"&&<section className="card"><div className="section-head"><div><h3>Notifications</h3><p className="muted">Task assignments and system notifications for this account.</p></div></div>{notifications.length===0?<p className="muted">No notifications.</p>:notifications.map(n=><div className={`task ${n.readAt?"":"unread"}`} key={n.id}><strong>{n.title}</strong><span>{n.message} · {n.createdAt}</span>{!n.readAt&&<button className="btn small" onClick={async()=>{await markNotificationRead(n.id);if(profile) setNotifications(await loadNotifications(profile.id))}}>Mark read</button>}</div>)}</section>}
      {module==="Administration"&&role==="Super Admin"&&<section className="section two"><div className="card"><div className="section-head"><h3>Users & Roles</h3><button className="btn primary" type="button" onClick={openUserCreate}>Create user</button></div><Table headers={["Name","Email","Role","Status","Actions"]}>{users.map(u=><tr key={u.id}><td>{u.fullName}</td><td>{u.email}</td><td>{u.role}</td><td>{u.active?"Active":"Inactive"}</td><td><button className="btn small" onClick={()=>openUserEdit(u)}>Edit access</button></td></tr>)}</Table></div><div className="card"><div className="section-head"><div><h3>Reminders</h3><p className="muted">Scheduled operational reminders stored in Supabase.</p></div><button className="btn primary" onClick={openReminderCreate}>New reminder</button></div><Table headers={["Title","Assigned user","Remind at","Sent","Actions"]}>{reminders.map(r=><tr key={r.id}><td>{r.title}</td><td>{r.user}</td><td>{r.remindAt}</td><td>{r.sentAt?"Sent":"Pending"}</td><td>{!r.sentAt&&<button className="btn small" onClick={async()=>{try{await deliverReminderNow(r.id,role);if(profile){await deliverDueReminders();setReminders(await loadReminders(profile.id));setNotifications(await loadNotifications(profile.id))}}catch(error){setProfileError(error instanceof Error?error.message:"Unable to deliver reminder.")}}}>Deliver now</button>}</td></tr>)}</Table></div><div className="card"><div className="section-head"><div><h3>Legacy Device-ID Exceptions</h3><p className="muted">Legacy Daily Job Done rows without a Device ID stay outside the operational completion workflow. Summary or note rows are kept for audit; unresolved rows remain open for source reconciliation.</p></div><div className="modal-actions"><span className="badge warn">{legacyExceptions.filter(x=>x.status==="Open").length} Open</span><span className="badge ok">{legacyExceptions.filter(x=>x.status==="Ignored").length} Ignored</span><span className="badge">{legacyExceptions.filter(x=>x.status==="Resolved").length} Resolved</span></div></div><Table headers={["Source","Row","Type","Date","Client / Note","Installer","Location","Status","Action"]}>{paginate(legacyExceptions).map(x=><tr key={x.id}><td>{x.sourceSheet}</td><td>{x.sourceRowNumber}</td><td>{x.exceptionType}</td><td>{x.date||"—"}</td><td>{x.client||"—"}</td><td>{x.installer||"—"}</td><td>{x.location||"—"}</td><td>{x.status}</td><td>{x.status==="Open"&&<><button className="btn small" type="button" onClick={async()=>{try{await updateLegacyDeviceException(x.id,{status:"Ignored",resolutionNote:"Ignored during legacy reconciliation."},role);setLegacyExceptions(await loadLegacyDeviceExceptions())}catch(error){setProfileError(error instanceof Error?error.message:"Unable to update exception.")}}}>Ignore</button><button className="btn small" type="button" onClick={async()=>{const note=window.prompt("Enter the source-reconciliation note:","Resolved after legacy source review");if(note===null)return;try{await updateLegacyDeviceException(x.id,{status:"Resolved",resolutionNote:note},role);setLegacyExceptions(await loadLegacyDeviceExceptions())}catch(error){setProfileError(error instanceof Error?error.message:"Unable to resolve exception.")}}}>Resolve</button></>}{x.status!=="Open"&&<button className="btn small" type="button" onClick={async()=>{try{await updateLegacyDeviceException(x.id,{status:"Open",resolutionNote:"Reopened for review."},role);setLegacyExceptions(await loadLegacyDeviceExceptions())}catch(error){setProfileError(error instanceof Error?error.message:"Unable to reopen exception.")}}}>Reopen</button>}</td></tr>)}</Table><Pager page={tablePage} total={legacyExceptions.length} pageSize={pageSize} onPage={setTablePage}/></div><div className="card" style={{gridColumn:"1 / -1"}}><div className="section-head"><div><h3>Audit Log</h3><p className="muted">Recorded changes across operational tables. Updates show the fields that changed; inserts and deletes retain the affected record snapshot.</p></div><span className="badge">{auditLogs.length} recent</span></div><Table headers={["Time","User","Action","Module","Record","Details"]}>{auditLogs.filter(x=>matches([x.actor,x.action,x.module,x.recordId,JSON.stringify(x.details)])).map(x=>{const changed=x.details?.changed_fields&&typeof x.details.changed_fields==="object"?Object.keys(x.details.changed_fields):[];const detail=x.action==="UPDATE"?(changed.length?changed.join(", "):"No field changes"):(x.action==="INSERT"?"Record created":"Record deleted");return <tr key={x.id}><td>{x.createdAt}</td><td>{x.actor}</td><td>{x.action}</td><td>{x.module}</td><td>{x.recordId||"—"}</td><td>{detail}</td></tr>})}</Table></div><div className="card"><div className="section-head"><div><h3>Google Sheets</h3><p className="muted">Import the existing legacy sheets into the portal first. After migration, normal synchronization will publish portal data back to the sheets.</p></div><span className={`badge ${googleStatus?.connected?"ok":"warn"}`}>{googleStatus?.connected?"Connected":"Not connected"}</span></div>{googleMessage&&<p className="muted">{googleMessage}</p>}<div className="section-head"><div><strong>{googleStatus?.connected?"Google authorization active":"Google authorization required"}</strong>{googleStatus?.googleEmail&&<p className="muted">{googleStatus.googleEmail}</p>}</div><div className="modal-actions"><button className="btn primary" type="button" disabled={googleBusy} onClick={connectGoogle}>{googleBusy?"Working…":"Connect Google"}</button>{googleStatus?.connected&&<><button className="btn" type="button" disabled={googleBusy} onClick={previewGoogle}>Preview import</button><button className="btn" type="button" disabled={googleBusy} onClick={importGoogle}>Import legacy data</button><button className="btn" type="button" disabled={googleBusy} onClick={previewSyncGoogle}>Preview sync</button><button className="btn" type="button" disabled={googleBusy} onClick={syncGoogle}>Sync all six</button><button className="btn" type="button" disabled={googleBusy} onClick={disconnectGoogle}>Disconnect</button></>}</div></div>{googleStatus?.connections&&<Table headers={["Module","Sheet","Last sync","Status"]}>{googleStatus.connections.map(x=><tr key={x.module}><td>{x.module}</td><td>{x.sheet_name||"Default sheet"}</td><td>{x.last_sync_at?new Date(x.last_sync_at).toLocaleString("en-GB"):"Never"}</td><td>{x.last_error?<span className="badge warn">Error</span>:<span className="badge ok">Ready</span>}</td></tr>)}</Table>}</div></section>}
      <div className="build-note">Operational tables now read from Supabase when configured. Database RLS remains the final enforcement layer for every role and field restriction.</div>
    </main>

    {modal&&<div className="modal-backdrop"><form className="modal" onSubmit={saveRecord}>
      <div className="section-head"><div><h3>{formMode==="assignment"?"Technician Assignment":formMode==="technician-job"?"Assigned Job Workspace":formMode==="reminder"?"Create reminder":formMode==="create-user"?"Create user account":formMode==="user"?"Edit user access":formMode==="comment"?"Task comment":formMode==="remark"?"Daily Job Done remark":formMode==="vehicles"?"Vehicle details":formMode==="vehicle-record"?(editing?"Edit vehicle":"Add vehicle"):editing?`Edit ${module}`:`Create ${module}`}</h3><p className="muted">Changes are enforced against the assigned role in Supabase.</p></div><button type="button" className="btn" onClick={closeModal}>Close</button></div>
      {formMode==="comment"&&selectedTaskComments.length>0&&<div className="card"><strong>Previous comments</strong>{selectedTaskComments.map(c=><div className="task" key={c.id}><strong>{c.user}</strong><span>{c.createdAt}</span><div>{c.comment}</div></div>)}</div>}
      {formMode==="assignment"?<div>
        <div className="card"><strong>{jobs.find(j=>j.id===selectedId)?.jobId||"Job"}</strong><p className="muted">{jobs.find(j=>j.id===selectedId)?.client||"—"} · {jobs.find(j=>j.id===selectedId)?.date||"—"} · {jobs.find(j=>j.id===selectedId)?.location||"—"}</p><p className="muted">Current technician: {jobs.find(j=>j.id===selectedId)?.technician||"Unassigned"} · {jobs.find(j=>j.id===selectedId)?.vehicles||0} vehicle(s) · Status: {jobs.find(j=>j.id===selectedId)?.status||"—"}</p></div>
        <div className="form-grid"><Field label="Assigned Field Technician" name="assignedTechnicianId" value={form.assignedTechnicianId||""} setValue={v=>setField("assignedTechnicianId",v)} options={[{value:"",label:"Unassigned"},...technicians.map(t=>({value:t.id,label:t.fullName+" · "+technicianWorkload(t.id)+" active job(s)"}))]}/></div>
      </div>:formMode==="technician-job"?<div>
        <div className="card"><strong>{jobs.find(j=>j.id===selectedId)?.jobId||"Job"}</strong><p className="muted">{jobs.find(j=>j.id===selectedId)?.client||"—"} · {jobs.find(j=>j.id===selectedId)?.location||"—"} · {jobs.find(j=>j.id===selectedId)?.date||"—"}</p><p className="muted">Status: {jobs.find(j=>j.id===selectedId)?.status||"—"} · Technician: {jobs.find(j=>j.id===selectedId)?.technician||"—"}</p></div>
        <Table headers={["Vehicle","Make","Details","Status","Action"]}>{workflowVehicles.map(v=>{const completed=completions.some(c=>c.jobUuid===selectedId&&c.vehicleId===v.id&&c.status==="Completed");return <tr key={v.id}><td>{v.registration||"Vehicle"}</td><td>{v.vehicleMake||"—"}</td><td>{v.vehicleDetails||"—"}</td><td>{completed?"Completed":v.status}</td><td>{role==="Field Technician"&&!completed&&<button type="button" className="btn small" onClick={()=>openTechnicianCompletion(jobs.find(j=>j.id===selectedId)!,v)}>Submit Daily Job Done</button>}</td></tr>})}</Table>
        <p className="muted">Daily Job Done submissions require a DEVICE ID and remain linked to this Operational Job and Vehicle.</p>
      </div>:formMode==="vehicle-record"?<div className="form-grid"><Field label="Operational Job" name="jobId" value={form.jobId||""} setValue={v=>setField("jobId",v)} options={jobs.map(j=>({value:j.id,label:j.jobId+" · "+j.client+" · "+j.date}))} readOnly={editing}/><Field label="Registration" name="registration" value={form.registration||""} setValue={v=>setField("registration",v)}/><Field label="Vehicle make" name="vehicleMake" value={form.vehicleMake||""} setValue={v=>setField("vehicleMake",v)}/><Field label="Vehicle details" name="vehicleDetails" value={form.vehicleDetails||""} setValue={v=>setField("vehicleDetails",v)}/><Field label="Status" name="vehicleStatus" value={form.vehicleStatus||"Pending"} setValue={v=>setField("vehicleStatus",v)} options={["Pending","In Progress","Completed","Cancelled"].map(x=>({value:x,label:x}))}/></div>:formMode==="create-user"?<div className="form-grid"><Field label="Full name" name="fullName" value={form.fullName||""} setValue={v=>setField("fullName",v)}/><Field label="Email" name="email" type="email" value={form.email||""} setValue={v=>setField("email",v)}/><Field label="Initial password" name="password" type="password" value={form.password||""} setValue={v=>setField("password",v)}/><Field label="Role" name="role" value={form.role||"Field Technician"} setValue={v=>setField("role",v)} options={ROLES.filter(r=>r!=="Super Admin").map(r=>({value:r,label:r}))}/>{form.role==="Viewer"&&<div className="card"><strong>Viewer module access</strong><p className="muted">Select which operational modules this Viewer may open.</p>{MODULES.map(m=>{const selected=String(form.moduleAccess||"").split("||").filter(Boolean).includes(m);return <label key={m} style={{display:"block",margin:"8px 0"}}><input type="checkbox" checked={selected} onChange={e=>{const current=String(form.moduleAccess||"").split("||").filter(Boolean);const next=e.target.checked?Array.from(new Set([...current,m])):current.filter(x=>x!==m);setField("moduleAccess",next.join("||"))}}/> {m}</label>})}</div>}<p className="muted">This admin-created account is confirmed automatically; no Supabase confirmation email is sent.</p></div>:formMode==="vehicles"?<div>
        <div className="card"><div className="section-head"><strong>{jobs.find(j=>j.id===selectedId)?.jobId||"Job"} vehicle records</strong><span className="muted">{jobVehicles.length} of {jobs.find(j=>j.id===selectedId)?.vehicles||0} vehicle slots recorded</span></div>{jobVehicles.length===0?<p className="muted">No vehicle details have been entered for this project yet.</p>:<Table headers={["Registration","Make","Vehicle details","Status","Actions"]}>{jobVehicles.map(v=><tr key={v.id}><td>{v.registration||"—"}</td><td>{v.vehicleMake||"—"}</td><td>{v.vehicleDetails||"—"}</td><td>{v.status}</td><td>{can(role,"Vehicle Management","edit")&&<button className="btn small" type="button" onClick={()=>{setVehicleEditingId(v.id);setEditing(true);setForm({registration:v.registration,vehicleMake:v.vehicleMake,vehicleDetails:v.vehicleDetails,vehicleStatus:v.status});}}>Edit</button>}</td></tr>)}</Table>}</div>
        <div className="form-grid"><Field label="Registration" name="registration" value={form.registration||""} setValue={v=>setField("registration",v)}/><Field label="Vehicle make" name="vehicleMake" value={form.vehicleMake||""} setValue={v=>setField("vehicleMake",v)}/><Field label="Vehicle details" name="vehicleDetails" value={form.vehicleDetails||""} setValue={v=>setField("vehicleDetails",v)}/><Field label="Status" name="vehicleStatus" value={form.vehicleStatus||"Pending"} setValue={v=>setField("vehicleStatus",v)} options={["Pending","In Progress","Completed","Cancelled"].map(x=>({value:x,label:x}))}/></div>
      </div>:formMode==="reminder"?<div className="form-grid"><Field label="Title" name="title" value={form.title||""} setValue={v=>setField("title",v)}/><Field label="Assigned user" name="userId" value={form.userId||""} setValue={v=>setField("userId",v)} options={users.filter(u=>u.active).map(u=>({value:u.id,label:`${u.fullName} · ${u.role}`}))}/><Field label="Remind at" name="remindAt" type="datetime-local" value={form.remindAt||""} setValue={v=>setField("remindAt",v)}/><Field label="Details" name="details" type="textarea" value={form.details||""} setValue={v=>setField("details",v)}/></div>:formMode==="user"?<div className="form-grid"><Field label="Role" name="role" value={form.role||""} setValue={v=>setField("role",v)} options={ROLES.map(r=>({value:r,label:r}))}/><Field label="Account status" name="active" value={form.active||"true"} setValue={v=>setField("active",v)} options={[{value:"true",label:"Active"},{value:"false",label:"Inactive"}]}/>{form.role==="Viewer"&&<div className="card"><strong>Viewer module access</strong><p className="muted">Select which operational modules this Viewer may open.</p>{MODULES.map(m=>{const selected=String(form.moduleAccess||"").split("||").filter(Boolean).includes(m);return <label key={m} style={{display:"block",margin:"8px 0"}}><input type="checkbox" checked={selected} onChange={e=>{const current=String(form.moduleAccess||"").split("||").filter(Boolean);const next=e.target.checked?Array.from(new Set([...current,m])):current.filter(x=>x!==m);setField("moduleAccess",next.join("||"))}}/> {m}</label>})}</div>}</div>:formMode==="remark"?<div className="form-grid"><Field label="Remark" name="remark" type="textarea" value={form.remark||""} setValue={v=>setField("remark",v)} /></div>:formMode==="comment"?<div className="form-grid"><Field label="Comment" name="comment" type="textarea" value={form.comment||""} setValue={v=>setField("comment",v)} /></div>:<>
        {module==="Daily Job Listing"&&<div className="form-grid"><Field label="Client" name="clientId" value={form.clientId||""} setValue={v=>setField("clientId",v)} options={clients.map(c=>({value:c.id,label:c.name}))}/><Field label="Number of vehicles" name="numberOfVehicles" type="number" value={form.numberOfVehicles||"1"} setValue={v=>setField("numberOfVehicles",v)}/><Field label="Scheduled date" name="scheduledDate" type="date" value={form.scheduledDate||today()} setValue={v=>setField("scheduledDate",v)}/><Field label="Time" name="scheduledTime" type="time" value={form.scheduledTime||""} setValue={v=>setField("scheduledTime",v)}/><Field label="Location" name="location" value={form.location||""} setValue={v=>setField("location",v)}/><Field label="Vehicle make" name="vehicleMake" value={form.vehicleMake||""} setValue={v=>setField("vehicleMake",v)}/><Field label="Priority" name="priority" value={form.priority||"Normal"} setValue={v=>setField("priority",v)} options={["Normal","High","Urgent"].map(x=>({value:x,label:x}))}/><Field label="Status" name="status" value={form.status||"Pending"} setValue={v=>setField("status",v)} options={["Pending","In Progress","Completed","Cancelled","Overdue"].map(x=>({value:x,label:x}))}/><Field label="Description" name="description" type="textarea" value={form.description||""} setValue={v=>setField("description",v)}/><Field label="Notes" name="notes" type="textarea" value={form.notes||""} setValue={v=>setField("notes",v)}/></div>}
        {module==="Daily Job Done"&&<div className="form-grid"><Field label="Operational Job ID" name="jobId" value={form.jobId||""} setValue={v=>setField("jobId",v)} options={jobs.map(j=>({value:j.id,label:j.jobId+" · "+j.client+" · "+j.date}))}/><Field label="Vehicle" name="vehicleId" value={form.vehicleId||""} setValue={v=>setField("vehicleId",v)} options={workflowVehicles.map(v=>({value:v.id,label:(v.registration||"Vehicle")+" · "+(v.vehicleMake||"") }))} readOnly={!form.jobId||workflowVehicles.length===0}/><Field label="DEVICE ID" name="deviceId" value={form.deviceId||""} setValue={v=>setField("deviceId",v)}/><Field label="Date" name="date" type="date" value={form.date||today()} setValue={v=>setField("date",v)}/><Field label="Installer" name="installer" value={form.installer||""} setValue={v=>setField("installer",v)}/><Field label="Location" name="location" value={form.location||""} setValue={v=>setField("location",v)}/><Field label="Client" name="client" value={form.client||""} setValue={v=>setField("client",v)}/><Field label="Vehicle details" name="vehicleDetails" value={form.vehicleDetails||""} setValue={v=>setField("vehicleDetails",v)}/><Field label="Vehicle make" name="vehicleMake" value={form.vehicleMake||""} setValue={v=>setField("vehicleMake",v)}/><Field label="TSS Officer" name="tssOfficer" value={form.tssOfficer||""} setValue={v=>setField("tssOfficer",v)}/><Field label="Remarks" name="remarks" type="textarea" value={form.remarks||""} setValue={v=>setField("remarks",v)}/></div>}
        {module==="Used Stock"&&role==="Finance"&&!editing&&<div className="form-grid"><Field label="Device ID" name="deviceId" value={form.deviceId||""} setValue={v=>setField("deviceId",v)}/><Field label="SIM ID" name="simId" value={form.simId||""} setValue={v=>setField("simId",v)}/><Field label="Date Issued" name="dateIssued" type="date" value={form.dateIssued||today()} setValue={v=>setField("dateIssued",v)}/></div>}
        {module==="Used Stock"&&!(role==="Finance"&&!editing)&&<div className="form-grid"><Field label="Job" name="jobId" value={form.jobId||""} setValue={v=>setField("jobId",v)} options={jobs.map(j=>({value:j.id,label:j.jobId+" · "+j.client}))}/><Field label="Vehicle" name="vehicleId" value={form.vehicleId||""} setValue={v=>setField("vehicleId",v)} options={workflowVehicles.map(v=>({value:v.id,label:(v.registration||"Vehicle")+" · "+(v.vehicleMake||"") }))} readOnly={!form.jobId||workflowVehicles.length===0}/>{[["deviceId","Device ID"],["simId","SIM ID"],["dateIssued","Date Issued"],["dateInstalled","Date Installed"],["installer","Installer"],["client","Client"],["location","Location"],["network","Network"],["deviceType","Device Type"],["deviceStatus","Device Status"],["dateCollected","Date Collected"],["operationsRemark","Operations Remark"],["operationsCorrection","Operations Correction"],["vehicleDetails","Vehicle Details"],["vehicleMake","Vehicle Make"],["otherIssues","Other Issues"]].map(([name,label])=><Field key={name} label={label} name={name} type={name.toLowerCase().includes("date")?"date":name.includes("Remark")||name.includes("Correction")||name.includes("Issues")?"textarea":"text"} value={form[name]||""} setValue={v=>setField(name,v)} readOnly={editing&&!canEditField(role,module,label)}/>)}</div>}
        {module==="Techie Weekly Activity"&&<div className="form-grid"><Field label="Technician" name="technicianId" value={form.technicianId||""} setValue={v=>setField("technicianId",v)} options={technicians.map(t=>({value:t.id,label:t.fullName}))}/><Field label="Week start" name="weekStart" type="date" value={form.weekStart||today()} setValue={v=>setField("weekStart",v)}/><Field label="Projects completed" name="projects" type="number" value={form.projects||"0"} setValue={v=>setField("projects",v)}/><Field label="Vehicles completed" name="vehiclesCompleted" type="number" value={form.vehiclesCompleted||"0"} setValue={v=>setField("vehiclesCompleted",v)}/><Field label="Remarks" name="remarks" type="textarea" value={form.remarks||""} setValue={v=>setField("remarks",v)}/></div>}
        {module==="Miscellaneous Charges"&&<div className="form-grid"><Field label="Client" name="clientId" value={form.clientId||""} setValue={v=>setField("clientId",v)} options={clients.map(c=>({value:c.id,label:c.name}))}/><Field label="Location" name="location" value={form.location||""} setValue={v=>setField("location",v)}/>{[["logistics","Logistics"],["accommodation","Accommodation"],["swap","Swap"],["deinstallation","Deinstallation"],["reinstallation","Reinstallation"],["healthCheck","Health Check"],["simReplacement","SIM Replacement"],["others","Others"]].map(([name,label])=><Field key={name} label={label} name={name} type="number" value={form[name]||"0"} setValue={v=>setField(name,v)}/>) }<Field label="Approval status" name="status" value={form.status||"Pending"} setValue={v=>setField("status",v)} options={["Pending","Approved","Rejected"].map(x=>({value:x,label:x}))}/></div>}
        {module==="Client Data"&&<div className="form-grid"><Field label="Client name" name="name" value={form.name||""} setValue={v=>setField("name",v)}/><Field label="Client code" name="clientCode" value={form.clientCode||""} setValue={v=>setField("clientCode",v)}/><Field label="Contact person" name="contactPerson" value={form.contactPerson||""} setValue={v=>setField("contactPerson",v)}/><Field label="Phone" name="phone" value={form.phone||""} setValue={v=>setField("phone",v)}/><Field label="Email" name="email" type="email" value={form.email||""} setValue={v=>setField("email",v)}/><Field label="Location" name="location" value={form.location||""} setValue={v=>setField("location",v)}/><Field label="Category" name="category" value={form.category||""} setValue={v=>setField("category",v)}/><Field label="Status" name="status" value={form.status||"Active"} setValue={v=>setField("status",v)} options={["Active","Inactive"].map(x=>({value:x,label:x}))}/><Field label="Notes" name="notes" type="textarea" value={form.notes||""} setValue={v=>setField("notes",v)}/></div>}
        {module==="Tasks"&&<div className="form-grid"><Field label="Title" name="title" value={form.title||""} setValue={v=>setField("title",v)}/><Field label="Linked Job" name="relatedJobId" value={form.relatedJobId||""} setValue={v=>setField("relatedJobId",v)} options={jobs.map(j=>({value:j.id,label:j.jobId+" · "+j.client+" · "+j.date}))}/><Field label="Assignee" name="assignedTo" value={form.assignedTo||""} setValue={v=>setField("assignedTo",v)} options={users.filter(u=>u.active&&u.role!=="Viewer").map(u=>({value:u.id,label:`${u.fullName} · ${u.role}`}))}/><Field label="Department" name="department" value={form.department||""} setValue={v=>setField("department",v)}/><Field label="Priority" name="priority" value={form.priority||"Normal"} setValue={v=>setField("priority",v)} options={["Normal","High","Urgent"].map(x=>({value:x,label:x}))}/><Field label="Due" name="dueAt" type="datetime-local" value={form.dueAt||""} setValue={v=>setField("dueAt",v)}/><Field label="Description" name="description" type="textarea" value={form.description||""} setValue={v=>setField("description",v)}/></div>}
      </>}
      <div className="modal-actions">{profileError&&<div className="login-error">{profileError}</div>}<button type="button" className="btn" onClick={closeModal}>Cancel</button>{formMode!=="technician-job"&&<button className="btn primary" disabled={busy||(formMode==="vehicles"&&!vehicleEditingId&&jobVehicles.length>=(jobs.find(j=>j.id===selectedId)?.vehicles||0))}>{busy?"Saving…":formMode==="vehicles"?(vehicleEditingId?"Update vehicle":"Add vehicle"):formMode==="vehicle-record"?(editing?"Update vehicle":"Add vehicle"):formMode==="create-user"?"Create user":"Save"}</button>}</div>
    </form></div>}
  </div>
}
