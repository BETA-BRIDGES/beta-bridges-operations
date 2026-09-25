import { supabase } from "./supabase";
import type { Role } from "./permissions";

export type ClientRecord={id:string;clientCode:string;name:string;contactPerson:string;phone:string;email:string;location:string;category:string;status:string;notes:string};
export type ChargeRecord={id:string;chargeId:string;client:string;clientId:string|null;location:string;logistics:number;accommodation:number;swap:number;deinstallation:number;reinstallation:number;healthCheck:number;simReplacement:number;others:number;status:string};
export type StockRecord={id:string;jobId:string|null;vehicleId:string|null;deviceId:string;simId:string;dateIssued:string;dateInstalled:string;installer:string;client:string;location:string;network:string;deviceType:string;deviceStatus:string;dateCollected:string;operationsRemark:string;operationsCorrection:string;vehicleDetails:string;vehicleMake:string;otherIssues:string};
export type CompletionRecord={id:string;jobId:string;jobUuid:string|null;vehicleId:string|null;deviceId:string;date:string;installer:string;location:string;client:string;vehicleDetails:string;vehicleMake:string;status:string;tssOfficer:string;remarks:string};
export type VehicleRecord={id:string;jobId:string;registration:string;vehicleMake:string;vehicleDetails:string;status:string;jobKey?:string;client?:string;scheduledDate?:string;jobStatus?:string;technician?:string;technicianId?:string|null};
export type WeeklyRecord={id:string;technician:string;technicianId:string;week:string;weekStart:string;projects:number;vehiclesCompleted:number;date:string;remarks:string};
export type UserRecord={id:string;fullName:string;email:string;role:Role;active:boolean;moduleAccess:string[]|null};
export type NotificationRecord={id:string;title:string;message:string;type:string;readAt:string|null;createdAt:string;relatedTaskId:string|null};
export type ReminderRecord={id:string;title:string;details:string;userId:string|null;user:string;remindAt:string;sentAt:string|null;createdAt:string};
export type AuditLogRecord={id:string;actor:string;actorId:string|null;action:string;module:string;recordId:string;details:any;createdAt:string};
export type LegacyDeviceExceptionRecord={id:string;sourceSheet:string;sourceRowNumber:number;sourceKey:string;exceptionType:string;status:string;deviceId:string;date:string;installer:string;location:string;client:string;vehicleDetails:string;vehicleMake:string;legacyStatus:string;tssOfficer:string;resolutionNote:string};

type ChargeClientLookup={id:string;name:string|null};
type WeeklyProfileLookup={id:string;full_name:string|null};

const safeDate=(value:string|null)=>value??"";
const num=(value:number|null)=>Number(value??0);

async function loadAllRows<T>(loader:(from:number,to:number)=>any):Promise<T[]>{
  const out:T[]=[];
  const pageSize=1000;
  for(let from=0;;from+=pageSize){
    const {data,error}=await loader(from,from+pageSize-1);
    if(error) throw error;
    out.push(...((data??[]) as T[]));
    if(!data || data.length<pageSize) break;
  }
  return out;
}

export async function loadAuditLogs(limit=100):Promise<AuditLogRecord[]>{
  if(!supabase) return [];
  const {data,error}=await supabase
    .from("audit_logs")
    .select("id,actor_id,action,module,record_id,details,created_at")
    .order("created_at",{ascending:false})
    .limit(limit);
  if(error) throw error;
  const ids=Array.from(new Set((data??[]).map((x:any)=>x.actor_id).filter(Boolean)));
  const {data:profiles,error:profileError}=await (ids.length
    ? supabase.from("profiles").select("id,full_name").in("id",ids)
    : Promise.resolve({data:[],error:null} as {data:{id:string;full_name:string|null}[];error:null}));
  if(profileError) throw profileError;
  const map=new Map<string,string>((profiles??[]).map((p:any)=>[String(p.id),String(p.full_name??"User")]));
  return (data??[]).map((x:any)=>({
    id:String(x.id),
    actor:map.get(String(x.actor_id))||"System",
    actorId:x.actor_id?String(x.actor_id):null,
    action:String(x.action??""),
    module:String(x.module??""),
    recordId:String(x.record_id??""),
    details:x.details??{},
    createdAt:new Date(x.created_at).toLocaleString("en-GB")
  }));
}

export async function loadProfiles():Promise<UserRecord[]>{
  if(!supabase) return [];
  const data=await loadAllRows<any>((from,to)=>supabase!.from("profiles").select("id,full_name,email,role,active,module_access").order("full_name").range(from,to));
  return data.map(p=>({id:p.id,fullName:p.full_name,email:p.email,role:p.role as Role,active:p.active,moduleAccess:(p.module_access??null) as string[]|null}));
}

export async function loadClients():Promise<ClientRecord[]>{
  if(!supabase) return [];
  const data=await loadAllRows<any>((from,to)=>supabase!.from("clients").select("id,client_code,name,contact_person,phone,email,location,category,status,notes").order("name").range(from,to));
  return data.map(c=>({id:c.id,clientCode:c.client_code??"",name:c.name,contactPerson:c.contact_person??"",phone:c.phone??"",email:c.email??"",location:c.location??"",category:c.category??"",status:c.status??"",notes:c.notes??""}));
}

export async function loadStock():Promise<StockRecord[]>{
  if(!supabase) return [];
  const data=await loadAllRows<any>((from,to)=>supabase!.from("stock_transactions").select("id,job_id,vehicle_id,device_id,sim_id,date_issued,date_installed,installer,client,location,network,device_type,device_status,date_collected,operations_remark,operations_correction,vehicle_details,vehicle_make,other_issues").order("date_installed",{ascending:false}).range(from,to));
  return data.map(s=>({id:s.id,jobId:s.job_id??null,vehicleId:s.vehicle_id??null,deviceId:s.device_id??"",simId:s.sim_id??"",dateIssued:safeDate(s.date_issued),dateInstalled:safeDate(s.date_installed),installer:s.installer??"",client:s.client??"",location:s.location??"",network:s.network??"",deviceType:s.device_type??"",deviceStatus:s.device_status??"",dateCollected:safeDate(s.date_collected),operationsRemark:s.operations_remark??"",operationsCorrection:s.operations_correction??"",vehicleDetails:s.vehicle_details??"",vehicleMake:s.vehicle_make??"",otherIssues:s.other_issues??""}));
}

export async function loadCompletions():Promise<CompletionRecord[]>{
  if(!supabase) return [];
  const data=await loadAllRows<any>((from,to)=>supabase!.from("job_completions").select("id,job_id,vehicle_id,device_id,completion_date,installer,location,client,vehicle_details,vehicle_make,status,tss_officer,remarks").order("completion_date",{ascending:false}).range(from,to));
  const rows=(data??[]) as {id:string;job_id:string|null;vehicle_id:string|null;device_id:string|null;completion_date:string|null;installer:string|null;location:string|null;client:string|null;vehicle_details:string|null;vehicle_make:string|null;status:string|null;tss_officer:string|null;remarks:string|null}[];
  const jobIds=Array.from(new Set(rows.map(c=>c.job_id).filter(Boolean))) as string[];
  const chunks=Array.from({length:Math.ceil(jobIds.length/100)},(_,i)=>jobIds.slice(i*100,(i+1)*100));
  const jobResults=await Promise.all(chunks.map(ids=>supabase!.from("jobs").select("id,job_id").in("id",ids)));
  const jobError=jobResults.find(x=>x.error)?.error??null;
  if(jobError) throw jobError;
  const jobMap=new Map<string,string>();
  jobResults.forEach(result=>{(result.data??[]).forEach((job:any)=>jobMap.set(String(job.id),String(job.job_id??"")))});
  return rows.map(c=>({
    id:c.id,
    jobId:c.job_id?jobMap.get(c.job_id)||"": "",
    jobUuid:c.job_id??null,
    vehicleId:c.vehicle_id??null,
    deviceId:c.device_id??"",
    date:safeDate(c.completion_date),
    installer:c.installer??"",
    location:c.location??"",
    client:c.client??"",
    vehicleDetails:c.vehicle_details??"",
    vehicleMake:c.vehicle_make??"",
    status:c.status??"",
    tssOfficer:c.tss_officer??"",
    remarks:c.remarks??""
  }));
}

export async function loadVehicles(jobId:string):Promise<VehicleRecord[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("vehicles").select("id,job_id,registration,vehicle_make,vehicle_details,status").eq("job_id",jobId).order("created_at",{ascending:true});
  if(error) throw error;
  return (data??[]).map(v=>({id:v.id,jobId:String(v.job_id),registration:v.registration??"",vehicleMake:v.vehicle_make??"",vehicleDetails:v.vehicle_details??"",status:v.status??"Pending"}));
}

export async function loadVehicleManagement():Promise<VehicleRecord[]>{
  if(!supabase) return [];
  const vehicles=await loadAllRows<any>((from,to)=>supabase!.from("vehicles").select("id,job_id,registration,vehicle_make,vehicle_details,status,created_at").order("created_at",{ascending:true}).range(from,to));
  const jobIds=Array.from(new Set(vehicles.map(v=>v.job_id).filter(Boolean))) as string[];
  const chunks=Array.from({length:Math.ceil(jobIds.length/100)},(_,i)=>jobIds.slice(i*100,(i+1)*100));
  const jobResults=await Promise.all(chunks.map(ids=>supabase!.from("jobs").select("id,job_id,client_id,scheduled_date,status,assigned_technician_id").in("id",ids)));
  const jobError=jobResults.find(x=>x.error)?.error??null;
  if(jobError) throw jobError;
  const jobs=jobResults.flatMap(x=>x.data??[]);
  const clientIds=Array.from(new Set(jobs.map((j:any)=>j.client_id).filter(Boolean))) as string[];
  const techIds=Array.from(new Set(jobs.map((j:any)=>j.assigned_technician_id).filter(Boolean))) as string[];
  const [clientResult,techResult]=await Promise.all([
    clientIds.length?supabase.from("clients").select("id,name").in("id",clientIds):Promise.resolve({data:[],error:null} as any),
    techIds.length?supabase.from("profiles").select("id,full_name").in("id",techIds):Promise.resolve({data:[],error:null} as any)
  ]);
  if(clientResult.error) throw clientResult.error;
  if(techResult.error) throw techResult.error;
  const jobMap=new Map<string,any>(jobs.map((j:any)=>[String(j.id),j]));
  const clientMap=new Map<string,string>((clientResult.data??[]).map((x:any)=>[String(x.id),String(x.name??"—")]));
  const techMap=new Map<string,string>((techResult.data??[]).map((x:any)=>[String(x.id),String(x.full_name??"Unassigned")]));
  return vehicles.map(v=>{
    const job=jobMap.get(String(v.job_id));
    return {id:String(v.id),jobId:String(v.job_id),registration:v.registration??"",vehicleMake:v.vehicle_make??"",vehicleDetails:v.vehicle_details??"",status:v.status??"Pending",
      jobKey:job?.job_id??"—",client:clientMap.get(String(job?.client_id??""))||"—",scheduledDate:job?.scheduled_date??"",jobStatus:job?.status??"—",
      technician:techMap.get(String(job?.assigned_technician_id??""))||"Unassigned",technicianId:job?.assigned_technician_id??null};
  });
}

export async function createVehicle(jobId:string,input:{registration?:string;vehicleMake?:string;vehicleDetails?:string;status?:string},role:Role){
  if(!supabase) return null;
  if(!(role==="Super Admin"||role==="TSS Officer")) throw new Error("You are not permitted to add vehicle details.");
  const {data,error}=await supabase.from("vehicles").insert({
    job_id:jobId,
    registration:input.registration?.trim()||null,
    vehicle_make:input.vehicleMake?.trim()||null,
    vehicle_details:input.vehicleDetails?.trim()||null,
    status:input.status||"Pending"
  }).select("id").single();
  if(error) throw error;
  return data.id as string;
}

export async function updateVehicle(id:string,input:{registration?:string;vehicleMake?:string;vehicleDetails?:string;status?:string},role:Role){
  if(!supabase) return;
  if(!(role==="Super Admin"||role==="TSS Officer")) throw new Error("You are not permitted to edit vehicle details.");
  const {error}=await supabase.from("vehicles").update({registration:input.registration?.trim()||null,vehicle_make:input.vehicleMake?.trim()||null,vehicle_details:input.vehicleDetails?.trim()||null,status:input.status||"Pending"}).eq("id",id);
  if(error) throw error;
}

export async function loadCharges():Promise<ChargeRecord[]>{
  if(!supabase) return [];
  const data=await loadAllRows<any>((from,to)=>supabase!.from("miscellaneous_charges").select("id,charge_id,location,logistics,accommodation,swap,deinstallation,reinstallation,health_check,sim_replacement,others,paid_or_approved,client_id").order("created_at",{ascending:false}).range(from,to));
  const rows=(data??[]);
  const ids=Array.from(new Set(rows.map(c=>c.client_id).filter(Boolean)));
  const {data:clients,error:clientError}=await (ids.length?supabase.from("clients").select("id,name").in("id",ids):Promise.resolve({data:[],error:null} as {data:ChargeClientLookup[];error:null}));
  if(clientError) throw clientError;
  const clientRows=(clients??[]) as ChargeClientLookup[];
  const map=new Map<string,string>((clientRows.map(c=>[c.id,String(c.name??"—")])));
  return (data??[]).map(c=>({id:c.id,chargeId:c.charge_id,client:map.get(c.client_id ?? "")||"—",clientId:c.client_id||null,location:c.location??"",logistics:num(c.logistics),accommodation:num(c.accommodation),swap:num(c.swap),deinstallation:num(c.deinstallation),reinstallation:num(c.reinstallation),healthCheck:num(c.health_check),simReplacement:num(c.sim_replacement),others:num(c.others),status:c.paid_or_approved??"Pending"}));
}

export async function loadWeekly(role?:Role,userId?:string):Promise<WeeklyRecord[]>{
  if(!supabase) return [];
  const data=await loadAllRows<any>((from,to)=>{
    let query=supabase!.from("technician_weekly_activity").select("id,technician_id,technician_name,week_start,projects_completed,vehicles_completed,remarks,updated_at").order("week_start",{ascending:false}).range(from,to);
    if(role==="Field Technician" && userId) query=query.eq("technician_id",userId);
    return query;
  });
  const ids=Array.from(new Set((data??[]).map(x=>x.technician_id).filter(Boolean)));
  const {data:profiles,error:profileError}=await (ids.length?supabase.from("profiles").select("id,full_name").in("id",ids):Promise.resolve({data:[],error:null} as {data:WeeklyProfileLookup[];error:null}));
  if(profileError) throw profileError;
  const profileRows=(profiles??[]) as WeeklyProfileLookup[];
  const map=new Map<string,string>(profileRows.map(p=>[p.id,String(p.full_name??"User")]));
  return (data??[]).map(x=>({id:x.id,technician:map.get(x.technician_id ?? "")||x.technician_name||"—",technicianId:x.technician_id,week:new Date(`${x.week_start}T00:00:00`).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}),weekStart:x.week_start,projects:Number(x.projects_completed),vehiclesCompleted:Number(x.vehicles_completed),date:new Date(x.updated_at).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}),remarks:x.remarks??""}));
}

export async function loadNotifications(userId:string):Promise<NotificationRecord[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("notifications").select("id,title,message,notification_type,read_at,created_at,related_task_id").eq("user_id",userId).order("created_at",{ascending:false}).limit(50);
  if(error) throw error;
  return (data??[]).map(n=>({id:n.id,title:n.title,message:n.message,type:n.notification_type,readAt:n.read_at??null,createdAt:new Date(n.created_at).toLocaleString("en-GB"),relatedTaskId:n.related_task_id??null}));
}

export async function loadLegacyDeviceExceptions():Promise<LegacyDeviceExceptionRecord[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("legacy_device_exceptions")
    .select("id,source_sheet,source_row_number,legacy_source_key,exception_type,status,device_id,completion_date,installer,location,client,vehicle_details,vehicle_make,legacy_status,tss_officer,resolution_note")
    .order("status",{ascending:true}).order("completion_date",{ascending:false}).limit(500);
  if(error) throw error;
  return (data??[]).map(x=>({
    id:String(x.id),
    sourceSheet:String(x.source_sheet??""),
    sourceRowNumber:Number(x.source_row_number??0),
    sourceKey:String(x.legacy_source_key??""),
    exceptionType:String(x.exception_type??""),
    status:String(x.status??"Open"),
    deviceId:String(x.device_id??""),
    date:safeDate(x.completion_date),
    installer:String(x.installer??""),
    location:String(x.location??""),
    client:String(x.client??""),
    vehicleDetails:String(x.vehicle_details??""),
    vehicleMake:String(x.vehicle_make??""),
    legacyStatus:String(x.legacy_status??""),
    tssOfficer:String(x.tss_officer??""),
    resolutionNote:String(x.resolution_note??"")
  }));
}
export async function updateLegacyDeviceException(id:string,input:{status:"Open"|"Ignored"|"Resolved";resolutionNote?:string},role:Role){
  if(!supabase) return;
  if(role!=="Super Admin") throw new Error("Only Super Admin can manage legacy Device-ID exceptions.");
  const {error}=await supabase.from("legacy_device_exceptions").update({
    status:input.status,
    resolution_note:input.resolutionNote?.trim()||null
  }).eq("id",id);
  if(error) throw error;
}

export async function loadReminders(userId:string):Promise<ReminderRecord[]>{
  if(!supabase) return [];
  const data=await loadAllRows<any>((from,to)=>supabase!.from("reminders").select("id,title,details,user_id,remind_at,sent_at,created_at").order("remind_at",{ascending:true}).range(from,to));
  const rows=data??[];
  const ids=Array.from(new Set(rows.map(r=>r.user_id).filter(Boolean)));
  const {data:profiles,error:profileError}=await (ids.length?supabase.from("profiles").select("id,full_name").in("id",ids):Promise.resolve({data:[],error:null} as {data:{id:string;full_name:string|null}[];error:null}));
  if(profileError) throw profileError;
  const map=new Map<string,string>((profiles??[]).map(p=>[p.id,p.full_name??"User"]));
  return rows.map(r=>({id:r.id,title:r.title,details:r.details??"",userId:r.user_id??null,user:map.get(r.user_id??"")||"User",remindAt:new Date(r.remind_at).toLocaleString("en-GB"),sentAt:r.sent_at?new Date(r.sent_at).toLocaleString("en-GB"):null,createdAt:new Date(r.created_at).toLocaleString("en-GB")}));
}
export async function createReminder(input:{title:string;details?:string;userId?:string|null;remindAt:string},role:Role){
  if(!supabase) return null;
  if(role!=="Super Admin") throw new Error("Only Super Admin can create reminders.");
  const {data,error}=await supabase.from("reminders").insert({title:input.title.trim(),details:input.details||null,user_id:input.userId||null,remind_at:input.remindAt}).select("id").single();
  if(error) throw error;
  return data.id as string;
}
export async function deliverDueReminders(){
  if(!supabase) return 0;
  const {data,error}=await supabase.rpc("deliver_due_reminders");
  if(error) throw error;
  return Number(data??0);
}
export async function deliverReminderNow(id:string,role:Role){
  if(!supabase) return false;
  if(role!=="Super Admin") throw new Error("Only Super Admin can deliver reminders immediately.");
  const {data,error}=await supabase.rpc("deliver_reminder_now",{p_reminder_id:id});
  if(error) throw error;
  return Boolean(data);
}
export async function markReminderSent(id:string,role:Role){
  return deliverReminderNow(id,role);
}

export async function markNotificationRead(id:string){
  if(!supabase) return;
  const {error}=await supabase.from("notifications").update({read_at:new Date().toISOString()}).eq("id",id);
  if(error) throw error;
}

export async function assignJobToTechnician(jobId:string,technicianId:string|null,role:Role){
  if(!supabase) return;
  if(role!=="Super Admin") throw new Error("Only Super Admin can assign a technician.");
  const {error}=await supabase.rpc("assign_job_to_technician",{p_job_id:jobId,p_technician_id:technicianId||null});
  if(error) throw error;
}

export async function fieldTechStartJob(jobId:string,role:Role){
  if(!supabase) return;
  if(role!=="Field Technician") throw new Error("Only Field Technicians can start assigned jobs.");
  const {error}=await supabase.rpc("field_tech_start_job",{p_job_id:jobId});
  if(error) throw error;
}

export async function createClient(input:{name:string;contactPerson?:string;phone?:string;email?:string;location?:string;category?:string;notes?:string},role:Role){
  if(!supabase) return null;
  if(!(role==="Super Admin"||role==="TSS Officer")) throw new Error("You are not permitted to create a client.");
  const {data,error}=await supabase.from("clients").insert({name:input.name.trim(),contact_person:input.contactPerson||null,phone:input.phone||null,email:input.email||null,location:input.location||null,category:input.category||null,notes:input.notes||null,status:"Active"}).select("id").single();
  if(error) throw error;
  return data.id as string;
}
export async function updateUserProfile(id:string,input:{role?:Role;active?:boolean;moduleAccess?:string[]|null},role:Role){
  if(!supabase) return;
  if(role!=="Super Admin") throw new Error("Only Super Admin can edit user permissions.");
  const payload:Record<string,unknown>={};
  if(input.role!==undefined) payload.role=input.role;
  if(input.active!==undefined) payload.active=input.active;
  if("moduleAccess" in input) payload.module_access=input.moduleAccess??null;
  const {error}=await supabase.from("profiles").update(payload).eq("id",id);
  if(error) throw error;
}
export async function updateClient(id:string,input:Record<string,unknown>,role:Role){
  if(!supabase) return;
  if(!(role==="Super Admin"||role==="TSS Officer")) throw new Error("You are not permitted to edit a client.");
  const {error}=await supabase.from("clients").update(input).eq("id",id);
  if(error) throw error;
}

export async function createCharge(input:{clientId?:string|null;location?:string;logistics?:number;accommodation?:number;swap?:number;deinstallation?:number;reinstallation?:number;healthCheck?:number;simReplacement?:number;others?:number},role:Role){
  if(!supabase) return null;
  if(!(role==="Super Admin"||role==="TSS Officer")) throw new Error("You are not permitted to create miscellaneous charges.");
  const stamp=new Date().toISOString().slice(0,10).replaceAll("-","");
  const {data:latest,error:latestError}=await supabase.from("miscellaneous_charges").select("charge_id").like("charge_id",`CHG-${stamp}-%`).order("charge_id",{ascending:false}).limit(1);
  if(latestError) throw latestError;
  const next=(latest?.[0]?.charge_id?.split("-").pop()?Number(latest[0].charge_id.split("-").pop()):0)+1;
  const chargeId=`CHG-${stamp}-${String(next).padStart(3,"0")}`;
  const {error}=await supabase.from("miscellaneous_charges").insert({charge_id:chargeId,client_id:input.clientId||null,location:input.location||null,logistics:input.logistics??0,accommodation:input.accommodation??0,swap:input.swap??0,deinstallation:input.deinstallation??0,reinstallation:input.reinstallation??0,health_check:input.healthCheck??0,sim_replacement:input.simReplacement??0,others:input.others??0,paid_or_approved:"Pending"});
  if(error) throw error;
  return chargeId;
}
export async function updateCharge(id:string,input:Record<string,unknown>,role:Role){
  if(!supabase) return;
  if(!(role==="Super Admin"||role==="TSS Officer")) throw new Error("You are not permitted to edit miscellaneous charges.");
  const {error}=await supabase.from("miscellaneous_charges").update(input).eq("id",id);
  if(error) throw error;
}

export async function createCompletion(input:{jobId?:string|null;vehicleId?:string|null;deviceId:string;date:string;installer?:string;location?:string;client?:string;vehicleDetails?:string;vehicleMake?:string;tssOfficer?:string;remarks?:string},role:Role){
  if(!supabase) return null;
  if(!(role==="Super Admin"||role==="TSS Officer"||role==="Field Technician")) throw new Error("You are not permitted to create a Daily Job Done record.");
  if(!input.jobId || !input.vehicleId) throw new Error("A Job and Vehicle are required for a new Daily Job Done record.");
  if(!input.deviceId.trim()) throw new Error("DEVICE ID is required for a new Daily Job Done record.");

  if(role==="Field Technician"){
    const {data,error}=await supabase.rpc("field_tech_submit_completion",{
      p_job_id:input.jobId,
      p_vehicle_id:input.vehicleId,
      p_device_id:input.deviceId.trim(),
      p_completion_date:input.date||null,
      p_installer:input.installer||null,
      p_location:input.location||null,
      p_client:input.client||null,
      p_vehicle_details:input.vehicleDetails||null,
      p_vehicle_make:input.vehicleMake||null,
      p_tss_officer:input.tssOfficer||null,
      p_remarks:input.remarks||null
    });
    if(error) throw error;
    return String(data);
  }

  const {data:vehicle,error:vehicleError}=await supabase.from("vehicles").select("id,job_id").eq("id",input.vehicleId).maybeSingle();
  if(vehicleError) throw vehicleError;
  if(!vehicle || vehicle.job_id!==input.jobId) throw new Error("The selected vehicle does not belong to the selected job.");
  const {data,error}=await supabase.from("job_completions").insert({job_id:input.jobId,vehicle_id:input.vehicleId,device_id:input.deviceId.trim(),completion_date:input.date||null,installer:input.installer||null,location:input.location||null,client:input.client||null,vehicle_details:input.vehicleDetails||null,vehicle_make:input.vehicleMake||null,status:"Completed",tss_officer:input.tssOfficer||null,remarks:input.remarks||null}).select("id").single();
  if(error) throw error;
  return data.id as string;
}
export async function updateCompletion(id:string,input:{jobId?:string|null;vehicleId?:string|null;deviceId?:string;date?:string|null;installer?:string;location?:string;client?:string;vehicleDetails?:string;vehicleMake?:string;tssOfficer?:string;remarks?:string},role:Role){
  if(!supabase) return;
  if(!(role==="Super Admin"||role==="TSS Officer")) throw new Error("You are not permitted to edit a Daily Job Done record.");
  const {error}=await supabase.from("job_completions").update({
    job_id:input.jobId||null,
    vehicle_id:input.vehicleId||null,
    device_id:input.deviceId?.trim()||null,
    completion_date:input.date||null,
    installer:input.installer||null,
    location:input.location||null,
    client:input.client||null,
    vehicle_details:input.vehicleDetails||null,
    vehicle_make:input.vehicleMake||null,
    tss_officer:input.tssOfficer||null,
    remarks:input.remarks||null
  }).eq("id",id);
  if(error) throw error;
}
export async function addCompletionRemark(id:string,remark:string,role:Role){
  if(!supabase) return;
  if(!(role==="Super Admin"||role==="Operations")) throw new Error("You are not permitted to add a remark.");
  const {error}=await supabase.from("job_completions").update({remarks:remark}).eq("id",id);
  if(error) throw error;
}
export async function createStock(input:Record<string,unknown>,role:Role){
  if(!supabase) return null;
  if(!(role==="Super Admin"||role==="Finance")) throw new Error("You are not permitted to create Used Stock records.");
  const payload=role==="Finance"
    ? {device_id:input.device_id||null,sim_id:input.sim_id||null,date_issued:input.date_issued||null}
    : input;
  const {data,error}=await supabase.from("stock_transactions").insert(payload).select("id").single();
  if(error) throw error;
  return data.id as string;
}
export async function updateStock(id:string,input:Record<string,unknown>,role:Role){
  if(!supabase) return;
  if(!(role==="Super Admin"||role==="Operations"||role==="Finance")) throw new Error("You are not permitted to edit Used Stock.");
  const {error}=await supabase.from("stock_transactions").update(input).eq("id",id);
  if(error) throw error;
}
export async function upsertWeekly(input:{technicianId:string;weekStart:string;projects:number;vehiclesCompleted:number;remarks?:string},role:Role){
  if(!supabase) return null;
  if(!(role==="Super Admin"||role==="Operations")) throw new Error("You are not permitted to edit the weekly technician report.");
  const {data,error}=await supabase.from("technician_weekly_activity").upsert({technician_id:input.technicianId,week_start:input.weekStart,projects_completed:Math.max(0,input.projects),vehicles_completed:Math.max(0,input.vehiclesCompleted),remarks:input.remarks||null,updated_at:new Date().toISOString()},{onConflict:"technician_id,week_start"}).select("id").single();
  if(error) throw error;
  return data.id as string;
}
