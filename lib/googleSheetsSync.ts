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

type SheetMeta={title:string;hidden?:boolean};

function quoteSheetTitle(title:string){return `'${title.replace(/'/g,"''")}'`;}

function dateKeyFromValue(value:unknown){
  if(!value) return null;
  const s=String(value).trim();
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d=new Date(s);
  if(Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0,10);
}

function parseSheetDate(title:string,fallbackYear?:number){
  const s=title.trim().replace(/\s+/g," ");
  const monthMap:Record<string,number>={
    JAN:1,JANUARY:1,FEB:2,FEBRUARY:2,MAR:3,MARCH:3,APR:4,APRIL:4,MAY:5,
    JUN:6,JUNE:6,JUL:7,JULY:7,AUG:8,AUGUST:8,SEP:9,SEPT:9,SEPTEMBER:9,
    OCT:10,OCTOBER:10,NOV:11,NOVEMBER:11,DEC:12,DECEMBER:12
  };
  let m=s.match(/^(\d{1,2})[\\/.-](\d{1,2})[\\/.-](\d{4})$/);
  if(m) return m[3]+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0");
  m=s.match(/^(\d{4})[\\/.-](\d{1,2})[\\/.-](\d{1,2})$/);
  if(m) return m[1]+"-"+m[2].padStart(2,"0")+"-"+m[3].padStart(2,"0");
  m=s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if(m){
    const month=monthMap[m[2].toUpperCase()];
    if(month) return m[3]+"-"+String(month).padStart(2,"0")+"-"+m[1].padStart(2,"0");
  }
  m=s.match(/^([A-Za-z]+)[\s-]*(\d{1,2})(?:ST|ND|RD|TH)?$/i);
  if(m){
    const month=monthMap[m[1].toUpperCase()];
    if(month && fallbackYear) return String(fallbackYear)+"-"+String(month).padStart(2,"0")+"-"+m[2].padStart(2,"0");
  }
  return null;
}

async function listSheets(sheets:any,spreadsheetId:string):Promise<SheetMeta[]>{
  const {data,error}=await sheets.spreadsheets.get({spreadsheetId,fields:"sheets(properties(title,hidden,index))"});
  if(error) throw error;
  return (data.sheets??[]).map((x:any)=>x.properties).filter((x:any)=>x?.title).map((x:any)=>({title:String(x.title),hidden:Boolean(x.hidden)}));
}

function preferredSheet(module:string,items:SheetMeta[]){
  const visible=items.filter(x=>!x.hidden);
  const exact=visible.find(x=>x.title==="Sheet1");
  if(exact) return exact.title;
  const keywords:Record<string,string[]>= {
    miscellaneousCharges:["MISCELLANEOUS","CHARGE"],
    clientData:["CLIENT"],
    techieWeeklyActivity:["TECHIE","WEEKLY"]
  };
  const hit=visible.find(x=>keywords[module]?.some(k=>x.title.toUpperCase().includes(k)));
  if(hit) return hit.title;
  if(visible.length===1) return visible[0].title;
  return visible[0]?.title||null;
}

async function selectAllRows(
  supabase:any,
  table:string,
  columns:string,
  refine?:(query:any)=>any
){
  const pageSize=1000;
  const all:any[]=[];
  for(let from=0;;from+=pageSize){
    let query=supabase.from(table).select(columns).range(from,from+pageSize-1);
    if(refine) query=refine(query);
    const {data,error}=await query;
    if(error) throw error;
    all.push(...(data??[]));
    if(!data || data.length<pageSize) break;
  }
  return all;
}

async function buildRows(module:string,supabase:any,dateKey?:string){
  if(module==="dailyJobListing"){
    const data=await selectAllRows(supabase,"jobs","job_id,job_type,number_of_vehicles,vehicle_make,scheduled_date,scheduled_time,location,client_id,tss_officer_id",(q:any)=>{
      if(dateKey) q=q.eq("scheduled_date",dateKey);
      return q.order("scheduled_date",{ascending:true});
    });
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
    const data=await selectAllRows(supabase,"job_completions","device_id,completion_date,installer,location,client,vehicle_details,vehicle_make,status,tss_officer",(q:any)=>{
      if(dateKey) q=q.eq("completion_date",dateKey);
      return q.order("completion_date",{ascending:false});
    });
    return [headers.dailyJobDone,...(data??[]).map((x:any)=>[text(x.device_id),text(x.completion_date),text(x.installer),text(x.location),text(x.client),text(x.vehicle_details),text(x.vehicle_make),text(x.status),text(x.tss_officer)])];
  }
  if(module==="usedStock"){
    const data=await selectAllRows(supabase,"stock_transactions","network,device_type,device_status,device_id,sim_id,date_collected,operations_remark,operations_correction,date_issued,date_installed,installer,location,client,vehicle_details,vehicle_make,other_issues",(q:any)=>{
      if(dateKey) q=q.eq("date_installed",dateKey);
      return q.order("date_installed",{ascending:false});
    });
    return [headers.usedStock,...(data??[]).map((x:any)=>[
      text(x.network),text(x.device_type),text(x.device_status),text(x.device_id),text(x.sim_id),text(x.date_collected),
      text(x.operations_remark),text(x.operations_correction),text(x.date_issued),text(x.date_installed),text(x.installer),
      text(x.location),text(x.client),text(x.vehicle_details),text(x.vehicle_make),text(x.other_issues)
    ])];
  }
  if(module==="miscellaneousCharges"){
    const data=await selectAllRows(supabase,"miscellaneous_charges","charge_id,client_id,location,logistics,accommodation,swap,deinstallation,reinstallation,health_check,sim_replacement,others,paid_or_approved",(q:any)=>q.order("created_at",{ascending:false}));
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
    const data=await selectAllRows(supabase,"clients","client_code,name,contact_person,category,phone,email,location",(q:any)=>q.order("name"));
    return [headers.clientData,...(data??[]).map((x:any,i:number)=>[
      i+1,text(x.name),text(x.contact_person),text(x.category),text(x.phone),text(x.email),text(x.location)
    ])];
  }
  if(module==="techieWeeklyActivity"){
    const technicians=["BENJAMIN","GOKE","MICHAEL","SAMSON","SUNDAY","SYLVESTER","MALIK","JOSEPH","ISAAC","PATRICK","EMMANUEL","SHAMSUDEEN","JEREMIAH","MUTIU","AHMED","SEUN","AINA","FAVOUR"];
    const {data:profiles,error:pe}=await supabase.from("profiles").select("id,full_name").eq("role","Field Technician");
    if(pe) throw pe;
    const nameMap=new Map((profiles??[]).map((x:any)=>[x.id,text(x.full_name).toUpperCase()]));
    const data=await selectAllRows(supabase,"technician_weekly_activity","technician_id,technician_name,week_start,projects_completed",(q:any)=>q.order("week_start",{ascending:true}));
    const bucket=new Map<string,number>();
    for(const x of data??[]){
      const d=new Date(String(x.week_start)+"T00:00:00");
      const week=Math.min(5,Math.floor((d.getUTCDate()-1)/7)+1);
      const tech=nameMap.get(x.technician_id??"")||text(x.technician_name).toUpperCase();
      if(!tech) continue;
      bucket.set(`${week}|${tech}`,number(x.projects_completed));
    }
    const rows=[[...technicians,"TOTAL"]];
    for(let week=1;week<=5;week++){
      const values=technicians.map(t=>bucket.get(`${week}|${t}`)??"");
      rows.push([`WEEK ${week}`,...values,values.reduce<number>((a,b)=>a+number(b),0)] as any);
    }
    const totals=technicians.map(t=>[1,2,3,4,5].reduce((sum,w)=>sum+number(bucket.get(`${w}|${t}`)??0),0));
    rows.push(["TOTAL",...totals,totals.reduce((a,b)=>a+b,0)] as any);
    return [[`TECHIE WEEKLY ACTIVITIES FOR ${new Date().toLocaleString("en-GB",{month:"long",year:"numeric"}).toUpperCase()}`],["",...technicians,"TOTAL"],...rows.slice(1)];
  }
  throw new Error(`Unsupported Google Sheets module: ${module}`);
}

export async function previewGoogleSheets(userId:string){
  const {supabase,client}=await getGoogleClientForUser(userId);
  const sheets=google.sheets({version:"v4",auth:client});
  const {data:connections,error}=await supabase.from("google_connections")
    .select("module,spreadsheet_id,sheet_name,active")
    .eq("active",true)
    .eq("sync_direction","platform_to_sheet");
  if(error) throw error;

  const results:Record<string,any>={};
  const dateFields:Record<string,{table:string;field:string}>={
    dailyJobListing:{table:"jobs",field:"scheduled_date"},
    dailyJobDone:{table:"job_completions",field:"completion_date"},
    usedStock:{table:"stock_transactions",field:"date_installed"}
  };

  for(const connection of (connections??[]) as Connection[]){
    try{
      const tabs=await listSheets(sheets,connection.spreadsheet_id);
      if(!tabs.length) throw new Error("Google spreadsheet has no accessible worksheets.");

      if(dateFields[connection.module] && !connection.sheet_name){
        const meta=dateFields[connection.module];
        const rows=await selectAllRows(supabase,meta.table,meta.field);
        const counts=new Map<string,number>();
        for(const row of rows??[]){
          const key=dateKeyFromValue((row as any)[meta.field]);
          if(key) counts.set(key,(counts.get(key)||0)+1);
        }

        const sourceDates=Array.from(counts.keys());
        const years=new Set(sourceDates.map(x=>Number(x.slice(0,4))).filter(Number.isFinite));
        const fallbackYear=years.size===1?Array.from(years)[0]:undefined;
        const dateTabs=tabs.map(x=>({title:x.title,date:parseSheetDate(x.title,fallbackYear)})).filter(x=>x.date);
        const tabByDate=new Map(dateTabs.map(x=>[x.date as string,x.title]));
        const mappings=Array.from(counts.entries()).sort(([a],[b])=>a.localeCompare(b))
          .map(([date,count])=>({date,count,targetSheet:tabByDate.get(date)||null}));
        const missingTargets=mappings.filter(x=>!x.targetSheet).map(x=>x.date);
        const targetDates=new Set(mappings.map(x=>x.date));
        const unusedDateTabs=dateTabs.filter(x=>x.date&&!targetDates.has(x.date)).map(x=>x.title);

        results[connection.module]={
          ok:true, mode:"date-tabs", sourceRows:Array.from(counts.values()).reduce((a,b)=>a+b,0),
          matchedTabs:mappings.filter(x=>x.targetSheet).length,
          missingTargets,
          unusedDateTabs,
          mappings:mappings.slice(0,120)
        };
        continue;
      }

      const targetSheet=connection.sheet_name||preferredSheet(connection.module,tabs);
      if(!targetSheet) throw new Error("No target worksheet could be resolved.");
      const rows=await buildRows(connection.module,supabase);
      results[connection.module]={
        ok:true, mode:"single-sheet", targetSheet, sourceRows:Math.max(0,rows.length-1)
      };
    }catch(error){
      const raw=error instanceof Error?error.message:"Unknown sync preview error";
      results[connection.module]={ok:false,error:raw};
    }
  }
  return results;
}

export async function syncGoogleSheets(userId:string){
  const {supabase,client}=await getGoogleClientForUser(userId);
  const sheets=google.sheets({version:"v4",auth:client});
  const {data:connections,error}=await supabase.from("google_connections").select("module,spreadsheet_id,sheet_name,active").eq("active",true).eq("sync_direction","platform_to_sheet");
  if(error) throw error;
  const results:Record<string,{rows:number;ok:boolean;error?:string}>={};
  const dateModules=new Set(["dailyJobListing","dailyJobDone","usedStock"]);
  const dateFields:Record<string,{table:string;field:string}>= {
    dailyJobListing:{table:"jobs",field:"scheduled_date"},
    dailyJobDone:{table:"job_completions",field:"completion_date"},
    usedStock:{table:"stock_transactions",field:"date_installed"}
  };

  for(const connection of (connections??[]) as Connection[]){
    try{
      const tabs=await listSheets(sheets,connection.spreadsheet_id);
      if(!tabs.length) throw new Error("Google spreadsheet has no accessible worksheets.");

      if(dateModules.has(connection.module) && !connection.sheet_name){
        const meta=dateFields[connection.module];
        const dateRows=await selectAllRows(supabase,meta.table,meta.field,(q:any)=>q.not(meta.field,"is",null));
        const dataDates=Array.from(new Set((dateRows??[]).map((x:any)=>dateKeyFromValue(x[meta.field])).filter(Boolean))) as string[];
        const years=new Set(dataDates.map(x=>Number(x.slice(0,4))).filter(Number.isFinite));
        const fallbackYear=years.size===1?[...years][0]:undefined;
        const dateTabs=tabs.map(x=>({title:x.title,date:parseSheetDate(x.title,fallbackYear)})).filter(x=>x.date);
        if(!dateTabs.length){
          const sheet=preferredSheet(connection.module,tabs);
          if(!sheet) throw new Error("No target worksheet could be resolved.");
          const rows=await buildRows(connection.module,supabase);
          if(rows.length<=1){
            results[connection.module]={rows:0,ok:true};
            await supabase.from("google_connections").update({last_error:null,updated_at:new Date().toISOString()}).eq("module",connection.module);
            continue;
          }
          const width=rows.reduce((max:number,row:any[])=>Math.max(max,row.length),0);
          const range=`${quoteSheetTitle(sheet)}!A1:${col(width)}${rows.length}`;
          await sheets.spreadsheets.values.clear({spreadsheetId:connection.spreadsheet_id,range:quoteSheetTitle(sheet)});
          await sheets.spreadsheets.values.update({spreadsheetId:connection.spreadsheet_id,range,valueInputOption:"USER_ENTERED",requestBody:{values:rows}});
          await supabase.from("google_connections").update({last_sync_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq("module",connection.module);
          results[connection.module]={rows:Math.max(0,rows.length-1),ok:true};
          continue;
        }
        let totalRows=0;
        for(const dateKey of dataDates){
          const tab=dateTabs.find(x=>x.date===dateKey);
          if(!tab) continue;
          const rows=await buildRows(connection.module,supabase,dateKey);
          if(rows.length<=1) continue;
          const width=rows.reduce((max:number,row:any[])=>Math.max(max,row.length),0);
          const range=`${quoteSheetTitle(tab.title)}!A1:${col(width)}${rows.length}`;
          await sheets.spreadsheets.values.clear({spreadsheetId:connection.spreadsheet_id,range:quoteSheetTitle(tab.title)});
          await sheets.spreadsheets.values.update({spreadsheetId:connection.spreadsheet_id,range,valueInputOption:"USER_ENTERED",requestBody:{values:rows}});
          totalRows+=Math.max(0,rows.length-1);
        }
        await supabase.from("google_connections").update({last_sync_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq("module",connection.module);
        results[connection.module]={rows:totalRows,ok:true};
        continue;
      }

      const sheet=connection.sheet_name||preferredSheet(connection.module,tabs);
      if(!sheet) throw new Error("No target worksheet could be resolved.");
      const rows=await buildRows(connection.module,supabase);
      if(rows.length<=1){
        results[connection.module]={rows:0,ok:true};
        await supabase.from("google_connections").update({last_error:null,updated_at:new Date().toISOString()}).eq("module",connection.module);
        continue;
      }
      const width=rows.reduce((max:number,row:any[])=>Math.max(max,row.length),0);
      const range=`${quoteSheetTitle(sheet)}!A1:${col(width)}${rows.length}`;
      await sheets.spreadsheets.values.clear({spreadsheetId:connection.spreadsheet_id,range:quoteSheetTitle(sheet)});
      await sheets.spreadsheets.values.update({spreadsheetId:connection.spreadsheet_id,range,valueInputOption:"USER_ENTERED",requestBody:{values:rows}});
      await supabase.from("google_connections").update({last_sync_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq("module",connection.module);
      results[connection.module]={rows:Math.max(0,rows.length-1),ok:true};
    }catch(error){
      const raw=error instanceof Error?error.message:"Unknown sync error";
      const message=raw.includes("Requested entity was not found")?
        "Google spreadsheet was not found or the connected Google account does not have access to it.":raw;
      await supabase.from("google_connections").update({last_error:message,updated_at:new Date().toISOString()}).eq("module",connection.module);
      results[connection.module]={rows:0,ok:false,error:message};
    }
  }
  return results;
}
