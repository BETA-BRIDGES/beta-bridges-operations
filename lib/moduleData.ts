import { supabase } from "./supabase";
import type { Role } from "./permissions";

export type ClientRecord={id:string;clientCode:string;name:string;contactPerson:string;phone:string;email:string;location:string;category:string;status:string;notes:string};
export type ChargeRecord={id:string;chargeId:string;client:string;clientId:string|null;location:string;logistics:number;accommodation:number;swap:number;deinstallation:number;reinstallation:number;healthCheck:number;simReplacement:number;others:number;status:string};
export type StockRecord={id:string;deviceId:string;simId:string;dateIssued:string;dateInstalled:string;installer:string;client:string;location:string;network:string;deviceType:string;deviceStatus:string;dateCollected:string;operationsRemark:string;operationsCorrection:string;vehicleDetails:string;vehicleMake:string;otherIssues:string};
export type CompletionRecord={id:string;jobId:string;deviceId:string;date:string;installer:string;location:string;client:string;vehicleDetails:string;vehicleMake:string;status:string;tssOfficer:string;remarks:string};
export type WeeklyRecord={id:string;technician:string;technicianId:string;week:string;weekStart:string;projects:number;vehiclesCompleted:number;date:string;remarks:string};
export type UserRecord={id:string;fullName:string;email:string;role:Role;active:boolean};
export type NotificationRecord={id:string;title:string;message:string;type:string;readAt:string|null;createdAt:string;relatedTaskId:string|null};

const safeDate=(value:string|null)=>value??"";
const num=(value:number|null)=>Number(value??0);

export async function loadProfiles():Promise<UserRecord[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("profiles").select("id,full_name,email,role,active").order("full_name");
  if(error) throw error;
  return (data??[]).map(p=>({id:p.id,fullName:p.full_name,email:p.email,role:p.role as Role,active:p.active}));
}

export async function loadClients():Promise<ClientRecord[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("clients").select("id,client_code,name,contact_person,phone,email,location,category,status,notes").order("name");
  if(error) throw error;
  return (data??[]).map(c=>({id:c.id,clientCode:c.client_code??"",name:c.name,contactPerson:c.contact_person??"",phone:c.phone??"",email:c.email??"",location:c.location??"",category:c.category??"",status:c.status??"",notes:c.notes??""}));
}

export async function loadStock():Promise<StockRecord[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("stock_transactions").select("id,device_id,sim_id,date_issued,date_installed,installer,client,location,network,device_type,device_status,date_collected,operations_remark,operations_correction,vehicle_details,vehicle_make,other_issues").order("date_installed",{ascending:false});
  if(error) throw error;
  return (data??[]).map(s=>({id:s.id,deviceId:s.device_id??"",simId:s.sim_id??"",dateIssued:safeDate(s.date_issued),dateInstalled:safeDate(s.date_installed),installer:s.installer??"",client:s.client??"",location:s.location??"",network:s.network??"",deviceType:s.device_type??"",deviceStatus:s.device_status??"",dateCollected:safeDate(s.date_collected),operationsRemark:s.operations_remark??"",operationsCorrection:s.operations_correction??"",vehicleDetails:s.vehicle_details??"",vehicleMake:s.vehicle_make??"",otherIssues:s.other_issues??""}));
}

export async function loadCompletions():Promise<CompletionRecord[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("job_completions").select("id,job_id,device_id,completion_date,installer,location,client,vehicle_details,vehicle_make,status,tss_officer,remarks").order("completion_date",{ascending:false});
  if(error) throw error;
  return (data??[]).map(c=>({id:c.id,jobId:c.job_id??"",deviceId:c.device_id??"",date:safeDate(c.completion_date),installer:c.installer??"",location:c.location??"",client:c.client??"",vehicleDetails:c.vehicle_details??"",vehicleMake:c.vehicle_make??"",status:c.status??"",tssOfficer:c.tss_officer??"",remarks:c.remarks??""}));
}

export async function loadCharges():Promise<ChargeRecord[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("miscellaneous_charges").select("id,charge_id,location,logistics,accommodation,swap,deinstallation,reinstallation,health_check,sim_replacement,others,paid_or_approved,client_id").order("created_at",{ascending:false});
  if(error) throw error;
  const ids=[...new Set((data??[]).map(c=>c.client_id).filter(Boolean))];
  const {data:clients,error:clientError}=ids.length?await supabase.from("clients").select("id,name").in("id",ids):{data:[],error:null} as any;
  if(clientError) throw clientError;
  const map=new Map<string,string>((clients??[]).map(c=>[c.id,String(c.name)]));
  return (data??[]).map(c=>({id:c.id,chargeId:c.charge_id,client:map.get(c.client_id)||"—",clientId:c.client_id||null,location:c.location??"",logistics:num(c.logistics),accommodation:num(c.accommodation),swap:num(c.swap),deinstallation:num(c.deinstallation),reinstallation:num(c.reinstallation),healthCheck:num(c.health_check),simReplacement:num(c.sim_replacement),others:num(c.others),status:c.paid_or_approved??"Pending"}));
}

export async function loadWeekly():Promise<WeeklyRecord[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("technician_weekly_activity").select("id,technician_id,week_start,projects_completed,vehicles_completed,remarks,updated_at").order("week_start",{ascending:false});
  if(error) throw error;
  const ids=[...new Set((data??[]).map(x=>x.technician_id))];
  const {data:profiles,error:profileError}=ids.length?await supabase.from("profiles").select("id,full_name").in("id",ids):{data:[],error:null} as any;
  if(profileError) throw profileError;
  const map=new Map<string,string>((profiles??[]).map(p=>[p.id,String(p.full_name)]));
  return (data??[]).map(x=>({id:x.id,technician:map.get(x.technician_id)||"—",technicianId:x.technician_id,week:new Date(`${x.week_start}T00:00:00`).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}),weekStart:x.week_start,projects:Number(x.projects_completed),vehiclesCompleted:Number(x.vehicles_completed),date:new Date(x.updated_at).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}),remarks:x.remarks??""}));
}

export async function loadNotifications(userId:string):Promise<NotificationRecord[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("notifications").select("id,title,message,notification_type,read_at,created_at,related_task_id").eq("user_id",userId).order("created_at",{ascending:false}).limit(50);
  if(error) throw error;
  return (data??[]).map(n=>({id:n.id,title:n.title,message:n.message,type:n.notification_type,readAt:n.read_at??null,createdAt:new Date(n.created_at).toLocaleString("en-GB"),relatedTaskId:n.related_task_id??null}));
}

export async function markNotificationRead(id:string){
  if(!supabase) return;
  const {error}=await supabase.from("notifications").update({read_at:new Date().toISOString()}).eq("id",id);
  if(error) throw error;
}

export async function createClient(input:{name:string;contactPerson?:string;phone?:string;email?:string;location?:string;category?:string;notes?:string},role:Role){
  if(!supabase) return null;
  if(!(role==="Super Admin"||role==="TSS Officer")) throw new Error("You are not permitted to create a client.");
  const {data,error}=await supabase.from("clients").insert({name:input.name.trim(),contact_person:input.contactPerson||null,phone:input.phone||null,email:input.email||null,location:input.location||null,category:input.category||null,notes:input.notes||null,status:"Active"}).select("id").single();
  if(error) throw error;
  return data.id as string;
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

export async function createCompletion(input:{jobId?:string|null;deviceId:string;date:string;installer?:string;location?:string;client?:string;vehicleDetails?:string;vehicleMake?:string;tssOfficer?:string;remarks?:string},role:Role){
  if(!supabase) return null;
  if(!(role==="Super Admin"||role==="TSS Officer")) throw new Error("You are not permitted to create a Daily Job Done record.");
  const {data,error}=await supabase.from("job_completions").insert({job_id:input.jobId||null,device_id:input.deviceId.trim(),completion_date:input.date||null,installer:input.installer||null,location:input.location||null,client:input.client||null,vehicle_details:input.vehicleDetails||null,vehicle_make:input.vehicleMake||null,status:"Completed",tss_officer:input.tssOfficer||null,remarks:input.remarks||null}).select("id").single();
  if(error) throw error;
  return data.id as string;
}
export async function addCompletionRemark(id:string,remark:string,role:Role){
  if(!supabase) return;
  if(!(role==="Super Admin"||role==="Operations")) throw new Error("You are not permitted to add a remark.");
  const {error}=await supabase.from("job_completions").update({remarks:remark}).eq("id",id);
  if(error) throw error;
}
export async function createStock(input:Record<string,unknown>,role:Role){
  if(!supabase) return null;
  if(role!=="Super Admin") throw new Error("Only Super Admin can create stock records.");
  const {data,error}=await supabase.from("stock_transactions").insert(input).select("id").single();
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
