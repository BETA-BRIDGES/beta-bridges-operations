import { google } from "googleapis";
import { getGoogleClientForUser } from "./googleServer";

type Connection={module:string;spreadsheet_id:string;sheet_name:string|null;active:boolean};

const headers={
  dailyJobListing:["CLIENT NAMES","INSURANCE/PERSONAL","NUMBERS OF JOB","VEHICLE MAKE","TIME","LOCATION","TSS OFFICER"],
  dailyJobDone:["DEVICE ID","DATE","INSTALLER NAME","LOCATION","NAME","VEH DETAILS","VEH MAKE","STATUS","TSS OFFICER"],
  usedStock:["NETWORK","DEVICE TYPES","DEVICE STATUS- USED / UNUSED-SIGHTED / UNUSED-UNSIGHTED; OTHERS","DEVICE ID","SIM ID","DATE COLLECTED","OPS REMARK - RECEIVED OR NOT RECEIVED","OPS CORRECTIONS - DEVICE & SIM","DATE/MONTH ISSUED TO TECHNICIAN","DATE INSTALLED","INSTALLER NAME","LOCATION","CLIENT NAME","VEHICLE DETAILS","VEHICLE MAKE","OTHER ISSUES"],
  miscellaneousCharges:["S/N","CUSTOMER/ CLIENT NAME","LOCATION","LOGISTICS","ACCOMMODATION","SWAP","DEINSTALLATION","REINSTALLATION","HEALTH CHECK","SIM REPLACEMENT","OTHERS","PAID OR APPROVED"],
  clientData:["S/N","CUSTOMER/CLIENT NAME","CONTACT PERSON","CUSTOMER CATEGORY","PHONE NUMBER","EMAIL ADDRESS","LOCATION"]
} as const;

function text(value:unknown){return value==null?"":String(value);}
function number(value:unknown){return Number(value??0);}
function col(n:number){let out="";while(n>0){const r=(n-1)%26;out=String.fromCharCode(65+r)+out;n=Math.floor((n-1)/26);}return out;}

async function buildRows(module:string,supabase:any){
  if(module==="dailyJobListing"){
    const {data,error}=await supabase.from("jobs").select("job_id,job_type,number_of_vehicles,vehicle_make,scheduled_date,location,client_id,tss_officer_id").order("scheduled_date",{ascending:true});
    if(error) throw error;
    const clientIds=Array.from(new Set((data??[]).map((x:any)=>x.client_id).filter(Boolean)));
    const officerIds=Array.from(new Set((data??[]).map((x:any)=>x.tss_officer_id).filter(Boolean)));
    const [{data:clients,error:ce},{data:officers,error:oe}]=await Promise.all([
      clientIds.length?supabase.from("clients").select("id,name").in("id",clientIds):Promise.resolve({data:[],error:null}),
      officerIds.length?supabase.from("profiles").select("id,full_name").in("id",officerIds):Promise.resolve({data:[],error:null})
    ]);
    if(ce) throw ce;if(oe) throw oe;
    const cm=new Map((clients??[]).map((x:any)=>[x.id,text(x.name)]));
    const om=new Map((officers??[]).map((x:any)=>[x.id,text(x.full_name)]));
    return [headers.dailyJobListing,...(data??[]).map((x:any)=>[
      cm.get(x.client_id??"")||"—",text(x.job_type),number(x.number_of_vehicles),text(x.vehicle_make),
      text(x.scheduled_time),text(x.location),om.get(x.tss_officer_id??"")||""
    ])];
  }
  if(module==="dailyJobDone"){
    const {data,error}=await supabase.from("job_completions").select("device_id,completion_date,installer,location,client,vehicle_details,vehicle_make,status,tss_officer").order("completion_date",{ascending:false});
    if(error) throw error;
    return [headers.dailyJobDone,...(data??[]).map((x:any)=>[text(x.device_id),text(x.completion_date),text(x.installer),text(x.location),text(x.client),text(x.vehicle_details),text(x.vehicle_make),text(x.status),text(x.tss_officer)])];
  }
  if(module==="usedStock"){
    const {data,error}=await supabase.from("stock_transactions").select("network,device_type,device_status,device_id,sim_id,date_collected,operations_remark,operations_correction,date_issued,date_installed,installer,location,client,vehicle_details,vehicle_make,other_issues").order("date_installed",{ascending:false});
    if(error) throw error;
    return [headers.usedStock,...(data??[]).map((x:any)=>[
      text(x.network),text(x.device_type),text(x.device_status),text(x.device_id),text(x.sim_id),text(x.date_collected),
      text(x.operations_remark),text(x.operations_correction),text(x.date_issued),text(x.date_installed),text(x.installer),
      text(x.location),text(x.client),text(x.vehicle_details),text(x.vehicle_make),text(x.other_issues)
    ])];
  }
  if(module==="miscellaneousCharges"){
    const {data,error}=await supabase.from("miscellaneous_charges").select("charge_id,client_id,location,logistics,accommodation,swap,deinstallation,reinstallation,health_check,sim_replacement,others,paid_or_approved").order("created_at",{ascending:false});
    if(error) throw error;
    const ids=Array.from(new Set((data??[]).map((x:any)=>x.client_id).filter(Boolean)));
    const {data:clients,error:ce}=ids.length?await supabase.from("clients").select("id,name").in("id",ids):{data:[],error:null};
    if(ce) throw ce;
    const cm=new Map((clients??[]).map((x:any)=>[x.id,text(x.name)]));
    return [headers.miscellaneousCharges,...(data??[]).map((x:any,i:number)=>[
      i+1,cm.get(x.client_id??"")||"—",text(x.location),number(x.logistics),number(x.accommodation),number(x.swap),
      number(x.deinstallation),number(x.reinstallation),number(x.health_check),number(x.sim_replacement),number(x.others),text(x.paid_or_approved)
    ])];
  }
  if(module==="clientData"){
    const {data,error}=await supabase.from("clients").select("client_code,name,contact_person,category,phone,email,location").order("name");
    if(error) throw error;
    return [headers.clientData,...(data??[]).map((x:any,i:number)=>[
      i+1,text(x.name),text(x.contact_person),text(x.category),text(x.phone),text(x.email),text(x.location)
    ])];
  }
  if(module==="techieWeeklyActivity"){
    const technicians=["BENJAMIN","GOKE","MICHAEL","SAMSON","SUNDAY","SYLVESTER","MALIK","JOSEPH","ISAAC","PATRICK","EMMANUEL","SHAMSUDEEN","JEREMIAH","MUTIU","AHMED","SEUN","AINA","FAVOUR"];
    const {data:profiles,error:pe}=await supabase.from("profiles").select("id,full_name").eq("role","Field Technician");
    if(pe) throw pe;
    const nameMap=new Map((profiles??[]).map((x:any)=>[x.id,text(x.full_name).toUpperCase()]));
    const {data,error}=await supabase.from("technician_weekly_activity").select("technician_id,week_start,projects_completed").order("week_start",{ascending:true});
    if(error) throw error;
    const bucket=new Map<string,number>();
    for(const x of data??[]){
      const d=new Date(String(x.week_start)+"T00:00:00");
      const week=Math.min(5,Math.floor((d.getUTCDate()-1)/7)+1);
      const tech=nameMap.get(x.technician_id??"");
      if(!tech) continue;
      bucket.set(`${week}|${tech}`,number(x.projects_completed));
    }
    const rows=[[...technicians,"TOTAL"]];
    for(let week=1;week<=5;week++){
      const values=technicians.map(t=>bucket.get(`${week}|${t}`)??"");
      rows.push([`WEEK ${week}`,...values,values.reduce((a,b)=>a+number(b),0)] as any);
    }
    const totals=technicians.map(t=>[1,2,3,4,5].reduce((sum,w)=>sum+number(bucket.get(`${w}|${t}`)??0),0));
    rows.push(["TOTAL",...totals,totals.reduce((a,b)=>a+b,0)] as any);
    return [[`TECHIE WEEKLY ACTIVITIES FOR ${new Date().toLocaleString("en-GB",{month:"long",year:"numeric"}).toUpperCase()}`],["",...technicians,"TOTAL"],...rows.slice(1)];
  }
  throw new Error(`Unsupported Google Sheets module: ${module}`);
}

export async function syncGoogleSheets(userId:string){
  const {supabase,client}=await getGoogleClientForUser(userId);
  const sheets=google.sheets({version:"v4",auth:client});
  const {data:connections,error}=await supabase.from("google_connections").select("module,spreadsheet_id,sheet_name,active").eq("active",true).eq("sync_direction","platform_to_sheet");
  if(error) throw error;
  const results:Record<string,{rows:number;ok:boolean;error?:string}>={};
  for(const connection of (connections??[]) as Connection[]){
    try{
      const rows=await buildRows(connection.module,supabase);
      const width=rows.reduce((max:number,row:any[])=>Math.max(max,row.length),0);
      const end=col(width);
      const range=`${connection.sheet_name||"Sheet1"}!A1:${end}${rows.length}`;
      await sheets.spreadsheets.values.clear({spreadsheetId:connection.spreadsheet_id,range:connection.sheet_name||"Sheet1"});
      await sheets.spreadsheets.values.update({spreadsheetId:connection.spreadsheet_id,range,valueInputOption:"USER_ENTERED",requestBody:{values:rows}});
      await supabase.from("google_connections").update({last_sync_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq("module",connection.module);
      results[connection.module]={rows:Math.max(0,rows.length-1),ok:true};
    }catch(error){
      const message=error instanceof Error?error.message:"Unknown sync error";
      await supabase.from("google_connections").update({last_error:message,updated_at:new Date().toISOString()}).eq("module",connection.module);
      results[connection.module]={rows:0,ok:false,error:message};
    }
  }
  return results;
}
