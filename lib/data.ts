import { supabase } from "./supabase";
import type { Role } from "./permissions";

export type AppJob={jobId:string;client:string;vehicles:number;date:string;technician:string;status:string};
export type AppTask={id:string;title:string;assignee:string;due:string;status:string};

function formatDate(value:string|null){
  if(!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
}

export async function loadJobs():Promise<AppJob[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("jobs").select("id,job_id,client_id,number_of_vehicles,scheduled_date,assigned_technician_id,status").order("scheduled_date",{ascending:true});
  if(error) throw error;
  const clientIds=[...new Set((data??[]).map(x=>x.client_id).filter(Boolean))];
  const techIds=[...new Set((data??[]).map(x=>x.assigned_technician_id).filter(Boolean))];
  const [{data:clients,error:clientError},{data:techs,error:techError}]=await Promise.all([
    clientIds.length?supabase.from("clients").select("id,name").in("id",clientIds):Promise.resolve({data:[],error:null} as any),
    techIds.length?supabase.from("profiles").select("id,full_name").in("id",techIds):Promise.resolve({data:[],error:null} as any)
  ]);
  if(clientError) throw clientError;
  if(techError) throw techError;
  const clientMap=new Map((clients??[]).map(c=>[c.id,c.name]));
  const techMap=new Map((techs??[]).map(t=>[t.id,t.full_name]));
  return (data??[]).map(j=>({jobId:j.job_id,client:clientMap.get(j.client_id)||"—",vehicles:j.number_of_vehicles,date:formatDate(j.scheduled_date),technician:techMap.get(j.assigned_technician_id)||"Unassigned",status:j.status}));
}

export async function loadTasks():Promise<AppTask[]>{
  if(!supabase) return [];
  const {data,error}=await supabase.from("tasks").select("id,task_id,title,assigned_to,due_at,status").order("due_at",{ascending:true});
  if(error) throw error;
  const ids=[...new Set((data??[]).map(t=>t.assigned_to).filter(Boolean))];
  const {data:profiles,error:profileError}=ids.length?await supabase.from("profiles").select("id,full_name").in("id",ids):{data:[],error:null} as any;
  if(profileError) throw profileError;
  const map=new Map((profiles??[]).map(p=>[p.id,p.full_name]));
  return (data??[]).map(t=>({id:t.task_id,title:t.title,assignee:map.get(t.assigned_to)||"Unassigned",due:t.due_at?new Date(t.due_at).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—",status:t.status}));
}

export async function createJob(input:{clientId?:string|null;numberOfVehicles:number;scheduledDate:string;location?:string;priority?:string;description?:string},role:Role){
  if(!supabase) return null;
  if(!(role==="Super Admin"||role==="TSS Officer")) throw new Error("You are not permitted to create a job.");
  const stamp=new Date().toISOString().slice(0,10).replaceAll("-","");
  const {data:latest}=await supabase.from("jobs").select("job_id").like("job_id",`BB-JOB-${stamp}-%`).order("job_id",{ascending:false}).limit(1);
  const next=(latest?.[0]?.job_id?.split("-").pop()?Number(latest[0].job_id.split("-").pop()):0)+1;
  const jobId=`BB-JOB-${stamp}-${String(next).padStart(3,"0")}`;
  const {error}=await supabase.from("jobs").insert({job_id:jobId,client_id:input.clientId||null,number_of_vehicles:Math.max(1,input.numberOfVehicles),scheduled_date:input.scheduledDate,location:input.location||null,priority:input.priority||"Normal",description:input.description||null,status:"Pending"});
  if(error) throw error;
  return jobId;
}

export async function createTask(input:{title:string;description?:string;dueAt?:string|null;assignedTo?:string|null},role:Role,creatorId:string){
  if(!supabase) return null;
  if(role!=="Super Admin") throw new Error("Only Super Admin can create and assign tasks.");
  const {data:latest}=await supabase.from("tasks").select("task_id").like("task_id","TASK-%").order("task_id",{ascending:false}).limit(1);
  const next=(latest?.[0]?.task_id?.replace("TASK-","")?Number(latest[0].task_id.replace("TASK-","")):0)+1;
  const taskId=`TASK-${String(next).padStart(3,"0")}`;
  const {error}=await supabase.from("tasks").insert({task_id:taskId,title:input.title.trim(),description:input.description||null,due_at:input.dueAt||null,assigned_to:input.assignedTo||null,created_by:creatorId,status:"Pending"});
  if(error) throw error;
  return taskId;
}
