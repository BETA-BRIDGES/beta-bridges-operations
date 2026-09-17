"use client";
import { useMemo, useState } from "react";
import { ROLES, Role, can, canCreate } from "../lib/permissions";

type Job={jobId:string;client:string;vehicles:number;date:string;technician:string;status:string};
type Task={id:string;title:string;assignee:string;due:string;status:string};

const initialJobs:Job[]=[
  {jobId:"BB-JOB-20260917-001",client:"Leadway",vehicles:15,date:"17 Sep 2026",technician:"Unassigned",status:"Pending"},
  {jobId:"BB-JOB-20260917-002",client:"Friesland",vehicles:25,date:"17 Sep 2026",technician:"Isaac",status:"In Progress"},
  {jobId:"BB-JOB-20260917-003",client:"Noortakaful",vehicles:10,date:"18 Sep 2026",technician:"Sunday",status:"Pending"}
];
const initialTasks:Task[]=[
  {id:"TASK-001",title:"Confirm Friesland vehicle list",assignee:"Isaac",due:"Today 12:00",status:"In Progress"},
  {id:"TASK-002",title:"Follow up offline trackers",assignee:"Sunday",due:"Today 16:00",status:"Pending"},
  {id:"TASK-003",title:"Review miscellaneous charge",assignee:"Finance",due:"18 Sep 09:00",status:"Pending"}
];
const modules=["Daily Job Listing","Daily Job Done","Used Stock","Techie Weekly Activity","Miscellaneous Charges","Client Data","Tasks"];

export default function Home(){
  const [role,setRole]=useState<Role>("Super Admin");
  const [module,setModule]=useState("Dashboard");
  const [jobs,setJobs]=useState<Job[]>(initialJobs);
  const [tasks,setTasks]=useState<Task[]>(initialTasks);
  const [modal,setModal]=useState(false);
  const allowed=useMemo(()=>modules.filter(m=>can(role,m,"view")),[role]);
  const shownJobs=role==="Field Technician"?jobs.filter(j=>j.technician!=="Unassigned"):jobs;

  function addJob(){
    const number=jobs.length+1;
    setJobs([...jobs,{jobId:`BB-JOB-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${String(number).padStart(3,"0")}`,client:"New Client",vehicles:1,date:"17 Sep 2026",technician:"Unassigned",status:"Pending"}]);
    setModal(false);
  }
  function addTask(){
    const number=tasks.length+1;
    setTasks([...tasks,{id:`TASK-${String(number).padStart(3,"0")}`,title:"New operational task",assignee:"Unassigned",due:"Set due date",status:"Pending"}]);
    setModal(false);
  }

  return <div className="app">
    <aside className="sidebar"><div className="brand">BETA BRIDGES</div><div className="side-note">Operations Management</div><nav className="nav">
      <a className={module==="Dashboard"?"active":""} onClick={()=>setModule("Dashboard")}>Dashboard</a>
      {allowed.map(m=><a key={m} className={module===m?"active":""} onClick={()=>setModule(m)}>{m}</a>)}
      {role==="Super Admin"&&<a className={module==="Administration"?"active":""} onClick={()=>setModule("Administration")}>Administration</a>}
    </nav></aside>
    <main className="main"><header className="topbar"><div><h1 className="page-title">{module}</h1><div className="muted">Central operations workspace</div></div><select value={role} onChange={e=>{setRole(e.target.value as Role);setModule("Dashboard")}} className="role-select">{ROLES.map(r=><option key={r}>{r}</option>)}</select></header>

      {module==="Dashboard"&&<><section className="grid">{[["Scheduled projects",String(jobs.length+15)],["Vehicles scheduled",String(jobs.reduce((n,j)=>n+j.vehicles,0)+128)],["Completed today","32"],["Pending tasks",String(tasks.filter(t=>t.status!=="Completed").length)]].map(x=><div className="card" key={x[0]}><div className="muted">{x[0]}</div><div className="stat">{x[1]}</div></div>)}</section><section className="section two"><div className="card"><h3>Today's job queue</h3><Table columns={["Job ID","Client","Vehicles","Technician","Status"]} rows={shownJobs.map(j=>[j.jobId,j.client,String(j.vehicles),j.technician,j.status])}/></div><div className="card"><h3>Open tasks</h3>{tasks.map(t=><div className="task" key={t.id}><strong>{t.title}</strong><span>{t.assignee} · {t.due}</span><em>{t.status}</em></div>)}</div></section></>}

      {module==="Daily Job Listing"&&<Module title="Daily Job Listing" subtitle="NUMBER OF JOBS means the number of vehicles covered by this project." columns={["Job ID","NUMBER OF JOBS / Vehicles","Client","Date","TSS Officer","Techie Assigned","Status"]} rows={jobs.map(j=>[j.jobId,String(j.vehicles),j.client,j.date,"TSS Officer",j.technician,j.status])} edit={can(role,module,"edit")} create={canCreate(role,module)} onAdd={()=>setModal(true)}/>} 
      {module==="Daily Job Done"&&<Module title="Daily Job Done" subtitle="DEVICE ID is the unique tracker/device identifier and is separate from Job ID." columns={["Job ID","DEVICE ID","Date","Installer","Client","Status","Remark"]} rows={[["BB-JOB-20260917-002","DEV-00125","17 Sep 2026","Isaac","Friesland","Completed","Installed successfully"],["BB-JOB-20260917-002","DEV-00126","17 Sep 2026","Isaac","Friesland","Completed","Signal checked"]]} edit={can(role,module,"edit")} create={canCreate(role,module)} onAdd={()=>setModal(true)}/>} 
      {module==="Used Stock"&&<Module title="Used Stock" subtitle="Track custody, issuance and installation of trackers and SIMs. Device ID, SIM ID and Date Issued are locked for Operations." columns={["Device ID","SIM ID","Date Issued","Date Installed","Installer","Client","Location"]} rows={[["DEV-00125","MTN-09021","16 Sep 2026","17 Sep 2026","Isaac","Friesland","Lagos"],["DEV-00126","MTN-09022","16 Sep 2026","17 Sep 2026","Isaac","Friesland","Ibadan"]]} edit={can(role,module,"edit")} create={canCreate(role,module)} onAdd={()=>setModal(true)}/>} 
      {module==="Techie Weekly Activity"&&<Module title="Techie Weekly Activity Report" subtitle="Weekly technician productivity from completed assignments." columns={["Technician","Week","Projects","Vehicles Completed","Date","Remarks"]} rows={[["Isaac","Week 38","4","42","17 Sep 2026","On target"],["Sunday","Week 38","3","31","17 Sep 2026","On target"]]} edit={can(role,module,"edit")} create={canCreate(role,module)} onAdd={()=>setModal(true)}/>} 
      {module==="Miscellaneous Charges"&&<Module title="Miscellaneous Charges" subtitle="Record billable operational extras and approval state." columns={["Charge ID","Client","Logistics","Accommodation","Swap","SIM Replacement","Others","Status"]} rows={[["CHG-001","Friesland","₦25,000","₦0","₦5,000","₦0","₦0","Pending"],["CHG-002","Leadway","₦15,000","₦8,000","₦0","₦3,500","₦0","Approved"]]} edit={can(role,module,"edit")} create={canCreate(role,module)} onAdd={()=>setModal(true)}/>} 
      {module==="Client Data"&&<Module title="Client Data List" subtitle="Master client directory used across jobs and billing." columns={["Client","Contact","Phone","Email","Location","Status"]} rows={[["Leadway","Desk Officer","0800••••••","ops@example.com","Lagos","Active"],["Friesland","Fleet Desk","0800••••••","fleet@example.com","Lagos","Active"],["Noortakaful","Operations","0800••••••","ops@example.com","Abuja","Active"]]} edit={can(role,module,"edit")} create={canCreate(role,module)} onAdd={()=>setModal(true)}/>} 
      {module==="Tasks"&&<Module title="Tasks & Reminders" subtitle="Assign work, monitor progress and record completion." columns={["Task ID","Title","Assignee","Priority","Due","Status"]} rows={tasks.map(t=>[t.id,t.title,t.assignee,"Normal",t.due,t.status])} edit={can(role,module,"edit")} create={canCreate(role,module)} onAdd={()=>setModal(true)}/>} 
      {module==="Administration"&&<div className="two"><div className="card"><h3>Roles & Access</h3>{ROLES.map(r=><div className="task" key={r}><strong>{r}</strong><span>{r==="Super Admin"?"Full access":"Configured permission set"}</span></div>)}</div><div className="card"><h3>Google Sheets</h3><p className="muted">Six legacy sheets are designed to connect through stable IDs and module mappings.</p><span className="badge warn">Awaiting Google authorization</span></div></div>}
      <div className="build-note">Application stage: functional UI, role permissions, local create flows and Supabase schema. Database authentication and Google synchronization are integration steps that follow.</div>
    </main>
    {modal&&<div className="modal-backdrop"><div className="modal"><h3>Create {module}</h3><p className="muted">This local MVP action validates the workflow. The same form will persist to Supabase once connected.</p><div className="form-grid"><label>Module<input value={module} readOnly/></label><label>Role<input value={role} readOnly/></label></div><div className="modal-actions"><button className="btn" onClick={()=>setModal(false)}>Cancel</button><button className="btn primary" onClick={module==="Tasks"?addTask:addJob}>Create record</button></div></div></div>}
  </div>
}

function Module({title,subtitle,columns,rows,edit,create,onAdd}:{title:string;subtitle:string;columns:string[];rows:string[][];edit:boolean;create:boolean;onAdd:()=>void}){return <section className="card"><div className="module-head"><div><h3>{title}</h3><div className="muted">{subtitle}</div></div>{create&&<button className="btn primary" onClick={onAdd}>Add record</button>}{edit&&!create&&<span className="badge">Edit enabled</span>}</div><Table columns={columns} rows={rows}/></section>}
function Table({columns,rows}:{columns:string[];rows:string[][]}){return <div className="table-wrap"><table className="table"><thead><tr>{columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j}>{v}</td>)}</tr>)}</tbody></table></div>}
