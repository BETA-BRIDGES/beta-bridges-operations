import { supabase } from "./supabase";
import type { Role } from "./permissions";

export type AppJob={id:string;jobId:string;client:string;clientId:string|null;vehicles:number;date:string;time:string;technician:string;technicianId:string|null;tssOfficer:string;tssOfficerId:string|null;status:string;location:string};
export type AppTask={id:string;taskKey:string;title:string;assignee:string;assigneeId:string|null;due:string;status:string};

type ClientLookup={id:string;name:string|null};
type ProfileLookup={id:string;full_name:string|null};
type TaskProfileLookup={id:string;full_name:string|null};
type JobLookupRow={id:string;job_id:string;client_id:string|null;number_of_vehicles:number;scheduled_date:string;scheduled_time:string|null;assigned_technician_id:string|null;tss_officer_id:string|null;tss_officer_name:string|null;status:string;location:string|null};
type TaskLookupRow={id:string;task_id:string;title:string;assigned_to:string|null;due_at:string|null;status:string};

function formatDate(value:string|null){
  if(!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
}

export async function loadJobs():Promise<AppJob[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("jobs").select("id,job_id,client_id,number_of_vehicles,scheduled_date,scheduled_time,assigned_technician_id,tss_officer_id,tss_officer_name,status,location").order("scheduled_date",{ascending:true});
  if(error) throw error;
  const rows=(data??[]) as JobLookupRow[];
  const clientIds=Array.from(new Set(rows.map(x=>x.client_id).filter(Boolean)));
  const techIds=Array.from(new Set(rows.map(x=>x.assigned_technician_id).filter(Boolean)));
  const officerIds=Array.from(new Set(rows.map(x=>x.tss_officer_id).filter(Boolean)));
  // PostgREST encodes .in() values into the request URL. Hundreds of UUIDs
  // can exceed proxy/request URL limits, so load client lookups in small chunks.
  const clientChunks=Array.from({length:Math.ceil(clientIds.length/100)},(_,i)=>clientIds.slice(i*100,(i+1)*100));
  const [clientResults,{data:techs,error:techError},{data:officers,error:officerError}]=await Promise.all([
    Promise.all(clientChunks.map(ids=>supabase!.from("clients").select("id,name").in("id",ids))),
    techIds.length?supabase!.from("profiles").select("id,full_name").in("id",techIds):Promise.resolve({data:[],error:null} as {data:ProfileLookup[];error:null}),
    officerIds.length?supabase!.from("profiles").select("id,full_name").in("id",officerIds):Promise.resolve({data:[],error:null} as {data:ProfileLookup[];error:null})
  ]);
  const clientError=clientResults.find(result=>result.error)?.error??null;
  if(clientError) throw clientError;
  if(techError) throw techError;
  if(officerError) throw officerError;
  const clientRows=clientResults.flatMap(result=>result.data??[]) as ClientLookup[];
  const techRows=(techs??[]) as ProfileLookup[];
  const clientMap=new Map<string,string|null>(clientRows.map((c:ClientLookup)=>[c.id,c.name]));
  const techMap=new Map<string,string|null>(techRows.map((t:ProfileLookup)=>[t.id,t.full_name]));
  const officerMap=new Map<string,string|null>((officers??[]).map((t:ProfileLookup)=>[t.id,t.full_name]));
  return rows.map(j=>({id:j.id,jobId:j.job_id,client:clientMap.get(j.client_id ?? "")||"—",clientId:j.client_id||null,vehicles:j.number_of_vehicles,date:formatDate(j.scheduled_date),time:j.scheduled_time??"",technician:techMap.get(j.assigned_technician_id ?? "")||"Unassigned",technicianId:j.assigned_technician_id||null,tssOfficer:officerMap.get(j.tss_officer_id ?? "")||j.tss_officer_name||"—",tssOfficerId:j.tss_officer_id||null,status:j.status,location:j.location||""}));
}

export async function loadTasks():Promise<AppTask[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("tasks").select("id,task_id,title,assigned_to,due_at,status").order("due_at",{ascending:true});
  if(error) throw error;
  const rows=(data??[]) as TaskLookupRow[];
  const ids=Array.from(new Set(rows.map(t=>t.assigned_to).filter(Boolean)));
  const {data:profiles,error:profileError}=await (ids.length?supabase.from("profiles").select("id,full_name").in("id",ids):Promise.resolve({data:[],error:null} as {data:TaskProfileLookup[];error:null}));
  if(profileError) throw profileError;
  const profileRows=(profiles??[]) as TaskProfileLookup[];
  const map=new Map<string,string|null>(profileRows.map((p:TaskProfileLookup)=>[p.id,p.full_name]));
  return rows.map(t=>({id:t.id,taskKey:t.task_id,title:t.title,assignee:map.get(t.assigned_to ?? "")||"Unassigned",assigneeId:t.assigned_to||null,due:t.due_at?new Date(t.due_at).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—",status:t.status}));
}

export async function createJob(input:{clientId?:string|null;numberOfVehicles:number;scheduledDate:string;scheduledTime?:string;location?:string;vehicleMake?:string;priority?:string;description?:string;tssOfficerId?:string|null},role:Role){
  if(!supabase) return null;
  if(!(role==="Super Admin"||role==="TSS Officer")) throw new Error("You are not permitted to create a job.");
  const stamp=new Date().toISOString().slice(0,10).replaceAll("-","");
  const {data:latest,error:latestError}=await supabase.from("jobs").select("job_id").like("job_id",`BB-JOB-${stamp}-%`).order("job_id",{ascending:false}).limit(1);
  if(latestError) throw latestError;
  const next=(latest?.[0]?.job_id?.split("-").pop()?Number(latest[0].job_id.split("-").pop()):0)+1;
  const jobId=`BB-JOB-${stamp}-${String(next).padStart(3,"0")}`;
  const {error}=await supabase.from("jobs").insert({job_id:jobId,client_id:input.clientId||null,number_of_vehicles:Math.max(1,input.numberOfVehicles),scheduled_date:input.scheduledDate,scheduled_time:input.scheduledTime||null,location:input.location||null,vehicle_make:input.vehicleMake||null,tss_officer_id:input.tssOfficerId||null,priority:input.priority||"Normal",description:input.description||null,status:"Pending"});
  if(error) throw error;
  return jobId;
}

export async function updateJob(id:string,input:Record<string,unknown>,role:Role){
  if(!supabase) return;
  if(role!=="Super Admin"&&role!=="TSS Officer") throw new Error("You are not permitted to edit this job.");
  if(role!=="Super Admin" && Object.prototype.hasOwnProperty.call(input,"assigned_technician_id")) throw new Error("TSS Officer cannot change Techie Assigned.");
  const {error}=await supabase.from("jobs").update(input).eq("id",id);
  if(error) throw error;
}

export async function createTask(input:{title:string;description?:string;dueAt?:string|null;assignedTo?:string|null;priority?:string;department?:string},role:Role,creatorId:string){
  if(!supabase) return null;
  if(role!=="Super Admin") throw new Error("Only Super Admin can create and assign tasks.");
  const {data:latest,error:latestError}=await supabase.from("tasks").select("task_id").like("task_id","TASK-%").order("task_id",{ascending:false}).limit(1);
  if(latestError) throw latestError;
  const next=(latest?.[0]?.task_id?.replace("TASK-","")?Number(latest[0].task_id.replace("TASK-","")):0)+1;
  const taskId=`TASK-${String(next).padStart(3,"0")}`;
  const {error}=await supabase.from("tasks").insert({task_id:taskId,title:input.title.trim(),description:input.description||null,due_at:input.dueAt||null,assigned_to:input.assignedTo||null,created_by:creatorId,priority:input.priority||"Normal",department:input.department||null,status:"Pending"});
  if(error) throw error;
  return taskId;
}

export async function updateTaskStatus(id:string,status:"Pending"|"In Progress"|"Completed"|"Cancelled"|"Overdue",role:Role){
  if(!supabase) return;
  if(!(role==="Super Admin"||role==="Field Technician")) throw new Error("You are not permitted to update this task.");
  const {error}=await supabase.from("tasks").update({status,completed_at:status==="Completed"?new Date().toISOString():null}).eq("id",id);
  if(error) throw error;
}

export async function addTaskComment(taskId:string,comment:string,userId:string,role:Role){
  if(!supabase) return;
  if(!(role==="Super Admin"||role==="Field Technician")) throw new Error("You are not permitted to comment on this task.");
  const {error}=await supabase.from("task_comments").insert({task_id:taskId,comment:comment.trim(),user_id:userId});
  if(error) throw error;
}

type TaskComment={id:string;comment:string;createdAt:string;user:string};
export async function loadTaskComments(taskId:string):Promise<TaskComment[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("task_comments").select("id,comment,created_at,user_id").eq("task_id",taskId).order("created_at",{ascending:true});
  if(error) throw error;
  const ids=Array.from(new Set((data??[]).map(x=>x.user_id).filter(Boolean)));
  const {data:profiles,error:profileError}=await (ids.length?supabase.from("profiles").select("id,full_name").in("id",ids):Promise.resolve({data:[],error:null} as {data:{id:string;full_name:string|null}[];error:null}));
  if(profileError) throw profileError;
  const map=new Map<string,string>((profiles??[]).map(p=>[String(p.id),String(p.full_name??"User")]));
  return (data??[]).map(x=>({id:String(x.id),comment:String(x.comment??""),createdAt:new Date(x.created_at).toLocaleString("en-GB"),user:map.get(String(x.user_id))||"User"}));
}
