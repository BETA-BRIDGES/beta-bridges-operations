import { google, sheets_v4 } from "googleapis";
import { getGoogleClientForUser } from "./googleServer";

type Row = string[];
type ImportSummary = {
  module: string;
  sheets: number;
  rows: number;
  imported: number;
  skipped: number;
  errors: string[];
};

const expectedHeaders: Record<string, string[]> = {
  clientData: ["S/N","CUSTOMER/CLIENT NAME","CONTACT PERSON","CUSTOMER CATEGORY","PHONE NUMBER","EMAIL ADDRESS","LOCATION"],
  dailyJobListing: ["CLIENT NAMES","INSURANCE/PERSONAL","NUMBERS OF JOB","VEHICLE MAKE","TIME","LOCATION","TSS OFFICER"],
  dailyJobDone: ["DEVICE ID","DATE","INSTALLER NAME","LOCATION","NAME","VEH DETAILS","VEH MAKE","STATUS","TSS OFFICER"],
  usedStock: ["NETWORK","DEVICE TYPES","DEVICE STATUS- USED / UNUSED-SIGHTED / UNUSED-UNSIGHTED; OTHERS","DEVICE ID","SIM ID","DATE COLLECTED","OPS REMARK - RECEIVED OR NOT RECEIVED","OPS CORRECTIONS - DEVICE & SIM","DATE/MONTH ISSUED TO TECHNICIAN","DATE INSTALLED","INSTALLER NAME","LOCATION","CLIENT NAME","VEHICLE DETAILS","VEHICLE MAKE","OTHER ISSUES"],
  miscellaneousCharges: ["S/N","CUSTOMER/ CLIENT NAME","LOCATION","LOGISTICS","ACCOMMODATION","SWAP","DEINSTALLATION","REINSTALLATION","HEALTH CHECK","SIM REPLACEMENT","OTHERS","PAID OR APPROVED"]
};

function text(value: unknown){return value == null ? "" : String(value).trim();}
function norm(value: unknown){return text(value).replace(/\s+/g," ").toUpperCase();}
function numeric(value: unknown){
  const cleaned = text(value).replace(/[₦$£€,\s]/g,"");
  if(!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function slug(value: string){
  return norm(value).replace(/[^A-Z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80);
}
function parseDate(value: unknown, fallback?: string | null){
  const raw=text(value);
  if(!raw) return fallback ?? null;
  const iso=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(iso) return `${iso[1]}-${iso[2].padStart(2,"0")}-${iso[3].padStart(2,"0")}`;
  const dmy=raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if(dmy) return `${dmy[3]}-${dmy[2].padStart(2,"0")}-${dmy[1].padStart(2,"0")}`;
  const named=raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if(named){
    const months=["january","february","march","april","may","june","july","august","september","october","november","december"];
    const idx=months.indexOf(named[2].toLowerCase());
    if(idx>=0) return `${named[3]}-${String(idx+1).padStart(2,"0")}-${named[1].padStart(2,"0")}`;
  }
  const js=new Date(raw);
  if(!Number.isNaN(js.getTime())) return js.toISOString().slice(0,10);
  return fallback ?? null;
}
function parseTime(value: unknown){
  const raw=text(value).toUpperCase();
  if(!raw) return null;
  const m=raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if(!m) return null;
  let h=Number(m[1]); const min=Number(m[2]); const sec=Number(m[3]||"0"); const ap=m[4];
  if(ap==="PM" && h<12) h+=12;
  if(ap==="AM" && h===12) h=0;
  if(h>23||min>59||sec>59) return null;
  return `${String(h).padStart(2,"0")}:${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}
function parseMonthTitle(title:string){
  const m=title.toUpperCase().match(/([A-Z]+)\s+(\d{4})/);
  if(!m) return null;
  const months=["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
  const idx=months.indexOf(m[1]);
  return idx>=0 ? {year:Number(m[2]),month:idx+1} : null;
}

async function listSheets(client:sheets_v4.Sheets,spreadsheetId:string){
  const {data}=await client.spreadsheets.get({spreadsheetId,fields:"sheets(properties(title,hidden,index))"});
  return (data.sheets??[]).map(s=>s.properties).filter(Boolean).filter(s=>!s?.hidden).map(s=>String(s!.title));
}
async function readSheet(client:sheets_v4.Sheets,spreadsheetId:string,title:string){
  const range=`'${title.replace(/'/g,"''")}'`;
  const {data}=await client.spreadsheets.values.get({spreadsheetId,range,valueRenderOption:"FORMATTED_VALUE"});
  return {title,rows:(data.values??[]) as Row[]};
}
function headerInfo(rows:Row[],expected:string[]){
  let best={index:-1,score:0};
  const wanted=new Set(expected.map(norm));
  for(let i=0;i<Math.min(rows.length,15);i++){
    const found=new Set(rows[i].map(norm).filter(Boolean));
    let score=0; wanted.forEach(h=>{if(found.has(h)) score++;});
    if(score>best.score) best={index:i,score};
  }
  const threshold=Math.max(3,Math.ceil(expected.length*0.5));
  return best.score>=threshold?best:null;
}
function rowMap(headers:Row,row:Row){
  const out:Record<string,string>={};
  headers.forEach((h,i)=>{const k=norm(h); if(k) out[k]=text(row[i]);});
  return out;
}
function legacyClientKey(name:string){return `client|legacy|${slug(name)}`;}
function sourceKey(module:string,sheet:string,rowNumber:number){return `sheet|${module}|${slug(sheet)}|${rowNumber}`;}

async function upsertClient(supabase:any,item:{name:string;code?:string;contact?:string;category?:string;phone?:string;email?:string;location?:string},sourceKeyValue?:string){
  const name=text(item.name); if(!name) return null;
  const key=sourceKeyValue || legacyClientKey(name);
  const {data,error}=await supabase.from("clients").upsert({
    legacy_source_key:key,client_code:item.code||null,name,contact_person:item.contact||null,
    category:item.category||null,phone:item.phone||null,email:item.email||null,location:item.location||null
  },{onConflict:"legacy_source_key"}).select("id,name").single();
  if(error) throw error;
  return String(data.id);
}
async function clientLookup(supabase:any){
  const {data,error}=await supabase.from("clients").select("id,name");
  if(error) throw error;
  return new Map((data??[]).map((x:any)=>[norm(x.name),String(x.id)]));
}
async function ensureClient(supabase:any,map:Map<string,string>,name:string){
  const key=norm(name); if(!key) return null;
  const existing=map.get(key); if(existing) return existing;
  const id=await upsertClient(supabase,{name},legacyClientKey(name));
  if(id) map.set(key,id);
  return id;
}

async function importClientData(supabase:any,client:sheets_v4.Sheets,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"clientData",sheets:0,rows:0,imported:0,skipped:0,errors:[]};
  for(const title of await listSheets(client,spreadsheetId)){
    const sheet=await readSheet(client,spreadsheetId,title);
    const info=headerInfo(sheet.rows,expectedHeaders.clientData); if(!info) continue;
    summary.sheets++;
    for(let i=info.index+1;i<sheet.rows.length;i++){
      summary.rows++;
      const raw=rowMap(sheet.rows[info.index],sheet.rows[i]);
      const name=raw["CUSTOMER/CLIENT NAME"];
      if(!name){summary.skipped++;continue;}
      try{
        await upsertClient(supabase,{
          name,contact:raw["CONTACT PERSON"],category:raw["CUSTOMER CATEGORY"],
          phone:raw["PHONE NUMBER"],email:raw["EMAIL ADDRESS"],location:raw["LOCATION"]
        });
        summary.imported++;
      }catch(error){summary.errors.push(`Row ${i+1}: ${error instanceof Error?error.message:"Import failed"}`);}
    }
  }
  return summary;
}

async function importJobs(supabase:any,client:sheets_v4.Sheets,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"dailyJobListing",sheets:0,rows:0,imported:0,skipped:0,errors:[]};
  const clients=await clientLookup(supabase);
  const {data:profiles,error:pe}=await supabase.from("profiles").select("id,full_name");
  if(pe) throw pe;
  const profileMap=new Map((profiles??[]).map((x:any)=>[norm(x.full_name),String(x.id)]));
  for(const title of await listSheets(client,spreadsheetId)){
    const sheet=await readSheet(client,spreadsheetId,title);
    const info=headerInfo(sheet.rows,expectedHeaders.dailyJobListing); if(!info) continue;
    summary.sheets++;
    const tabDate=parseDate(title);
    for(let i=info.index+1;i<sheet.rows.length;i++){
      summary.rows++;
      const raw=rowMap(sheet.rows[info.index],sheet.rows[i]);
      const name=raw["CLIENT NAMES"]; if(!name){summary.skipped++;continue;}
      try{
        const clientId=await ensureClient(supabase,clients,name);
        const source=sourceKey("dailyJobListing",title,i+1);
        const officerName=raw["TSS OFFICER"];
        const payload={
          legacy_source_key:source,job_id:`BB-LEGACY-${slug(title)||"TAB"}-${i+1}`,client_id:clientId,
          job_type:raw["INSURANCE/PERSONAL"]||null,number_of_vehicles:Math.max(1,Math.trunc(numeric(raw["NUMBERS OF JOB"])||1)),
          vehicle_make:raw["VEHICLE MAKE"]||null,scheduled_date:parseDate(raw["DATE"],tabDate),scheduled_time:parseTime(raw["TIME"]),
          location:raw["LOCATION"]||null,tss_officer_id:profileMap.get(norm(officerName))||null,tss_officer_name:officerName||null
        };
        const {error}=await supabase.from("jobs").upsert(payload,{onConflict:"legacy_source_key"});
        if(error) throw error;
        summary.imported++;
      }catch(error){summary.errors.push(`Row ${i+1}: ${error instanceof Error?error.message:"Import failed"}`);}
    }
  }
  return summary;
}

async function importCompletions(supabase:any,client:sheets_v4.Sheets,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"dailyJobDone",sheets:0,rows:0,imported:0,skipped:0,errors:[]};
  for(const title of await listSheets(client,spreadsheetId)){
    const sheet=await readSheet(client,spreadsheetId,title);
    const info=headerInfo(sheet.rows,expectedHeaders.dailyJobDone); if(!info) continue;
    summary.sheets++;
    const tabDate=parseDate(title);
    for(let i=info.index+1;i<sheet.rows.length;i++){
      summary.rows++;
      const raw=rowMap(sheet.rows[info.index],sheet.rows[i]);
      if(!raw["DEVICE ID"]&&!raw["NAME"]){summary.skipped++;continue;}
      try{
        const payload={
          legacy_source_key:sourceKey("dailyJobDone",title,i+1),device_id:raw["DEVICE ID"]||null,
          completion_date:parseDate(raw["DATE"],tabDate),installer:raw["INSTALLER NAME"]||null,location:raw["LOCATION"]||null,
          client:raw["NAME"]||null,vehicle_details:raw["VEH DETAILS"]||null,vehicle_make:raw["VEH MAKE"]||null,
          status:raw["STATUS"]||"Completed",tss_officer:raw["TSS OFFICER"]||null
        };
        const {error}=await supabase.from("job_completions").upsert(payload,{onConflict:"legacy_source_key"});
        if(error) throw error;
        summary.imported++;
      }catch(error){summary.errors.push(`Row ${i+1}: ${error instanceof Error?error.message:"Import failed"}`);}
    }
  }
  return summary;
}

async function importStock(supabase:any,client:sheets_v4.Sheets,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"usedStock",sheets:0,rows:0,imported:0,skipped:0,errors:[]};
  for(const title of await listSheets(client,spreadsheetId)){
    const sheet=await readSheet(client,spreadsheetId,title);
    const info=headerInfo(sheet.rows,expectedHeaders.usedStock); if(!info) continue;
    summary.sheets++;
    for(let i=info.index+1;i<sheet.rows.length;i++){
      summary.rows++;
      const raw=rowMap(sheet.rows[info.index],sheet.rows[i]);
      if(!raw["DEVICE ID"]&&!raw["SIM ID"]){summary.skipped++;continue;}
      try{
        const payload={
          legacy_source_key:sourceKey("usedStock",title,i+1),network:raw["NETWORK"]||null,device_type:raw["DEVICE TYPES"]||null,
          device_status:raw["DEVICE STATUS- USED / UNUSED-SIGHTED / UNUSED-UNSIGHTED; OTHERS"]||null,device_id:raw["DEVICE ID"]||null,
          sim_id:raw["SIM ID"]||null,date_collected:parseDate(raw["DATE COLLECTED"]),operations_remark:raw["OPS REMARK - RECEIVED OR NOT RECEIVED"]||null,
          operations_correction:raw["OPS CORRECTIONS - DEVICE & SIM"]||null,date_issued:parseDate(raw["DATE/MONTH ISSUED TO TECHNICIAN"]),
          date_installed:parseDate(raw["DATE INSTALLED"]),installer:raw["INSTALLER NAME"]||null,location:raw["LOCATION"]||null,
          client:raw["CLIENT NAME"]||null,vehicle_details:raw["VEHICLE DETAILS"]||null,vehicle_make:raw["VEHICLE MAKE"]||null,
          other_issues:raw["OTHER ISSUES"]||null
        };
        const {error}=await supabase.from("stock_transactions").upsert(payload,{onConflict:"legacy_source_key"});
        if(error) throw error;
        summary.imported++;
      }catch(error){summary.errors.push(`Row ${i+1}: ${error instanceof Error?error.message:"Import failed"}`);}
    }
  }
  return summary;
}

async function importCharges(supabase:any,client:sheets_v4.Sheets,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"miscellaneousCharges",sheets:0,rows:0,imported:0,skipped:0,errors:[]};
  const clients=await clientLookup(supabase);
  for(const title of await listSheets(client,spreadsheetId)){
    const sheet=await readSheet(client,spreadsheetId,title);
    const info=headerInfo(sheet.rows,expectedHeaders.miscellaneousCharges); if(!info) continue;
    summary.sheets++;
    for(let i=info.index+1;i<sheet.rows.length;i++){
      summary.rows++;
      const raw=rowMap(sheet.rows[info.index],sheet.rows[i]);
      const name=raw["CUSTOMER/ CLIENT NAME"]; if(!name&&!raw["LOCATION"]){summary.skipped++;continue;}
      try{
        const clientId=await ensureClient(supabase,clients,name);
        const payload={
          legacy_source_key:sourceKey("miscellaneousCharges",title,i+1),charge_id:`BB-LEGACY-CHG-${slug(title)||"TAB"}-${i+1}`,
          client_id:clientId,location:raw["LOCATION"]||null,logistics:numeric(raw["LOGISTICS"]),accommodation:numeric(raw["ACCOMMODATION"]),
          swap:numeric(raw["SWAP"]),deinstallation:numeric(raw["DEINSTALLATION"]),reinstallation:numeric(raw["REINSTALLATION"]),
          health_check:numeric(raw["HEALTH CHECK"]),sim_replacement:numeric(raw["SIM REPLACEMENT"]),others:numeric(raw["OTHERS"]),
          paid_or_approved:raw["PAID OR APPROVED"]||"Pending"
        };
        const {error}=await supabase.from("miscellaneous_charges").upsert(payload,{onConflict:"legacy_source_key"});
        if(error) throw error;
        summary.imported++;
      }catch(error){summary.errors.push(`Row ${i+1}: ${error instanceof Error?error.message:"Import failed"}`);}
    }
  }
  return summary;
}

async function importWeekly(supabase:any,client:sheets_v4.Sheets,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"techieWeeklyActivity",sheets:0,rows:0,imported:0,skipped:0,errors:[]};
  for(const title of await listSheets(client,spreadsheetId)){
    const sheet=await readSheet(client,spreadsheetId,title);
    const weekRows=sheet.rows.map((r,i)=>({r,i})).filter(x=>/^WEEK\s+[1-5]$/i.test(text(x.r[0])));
    if(!weekRows.length) continue;
    const headerIndex=sheet.rows.findIndex((r,i)=>i<8 && r.some(v=>norm(v)==="BENJAMIN") && r.some(v=>norm(v)==="TOTAL"));
    if(headerIndex<0) continue;
    summary.sheets++;
    const month=parseMonthTitle(sheet.rows[0]?.join(" ")||title);
    for(const item of weekRows){
      const weekNo=Number(text(item.r[0]).replace(/\D/g,""))||1;
      const date=month?new Date(Date.UTC(month.year,month.month-1,(weekNo-1)*7+1)).toISOString().slice(0,10):parseDate(title);
      for(let col=1;col<sheet.rows[headerIndex].length;col++){
        const technician=text(sheet.rows[headerIndex][col]); if(!technician||norm(technician)==="TOTAL") continue;
        summary.rows++;
        const value=text(item.r[col]); if(!value){summary.skipped++;continue;}
        try{
          const payload={
            legacy_source_key:sourceKey("techieWeeklyActivity",title,(item.i+1)*1000+col),technician_name:technician,
            week_start:date,projects_completed:Math.max(0,Math.trunc(numeric(value))),vehicles_completed:0
          };
          const {error}=await supabase.from("technician_weekly_activity").upsert(payload,{onConflict:"legacy_source_key"});
          if(error) throw error;
          summary.imported++;
        }catch(error){summary.errors.push(`Row ${item.i+1}, col ${col+1}: ${error instanceof Error?error.message:"Import failed"}`);}
      }
    }
  }
  return summary;
}

export async function previewLegacyGoogleSheets(userId:string){
  const {supabase,client}=await getGoogleClientForUser(userId);
  const sheets=google.sheets({version:"v4",auth:client});
  const {data:connections,error}=await supabase.from("google_connections").select("module,spreadsheet_id,sheet_name,active").eq("active",true).eq("sync_direction","platform_to_sheet");
  if(error) throw error;
  const results:any[]=[];
  for(const connection of (connections??[]) as any[]){
    const tabs=await listSheets(sheets,connection.spreadsheet_id);
    const detected:any[]=[];
    for(const title of tabs){
      const sheet=await readSheet(sheets,connection.spreadsheet_id,title);
      const expected=expectedHeaders[connection.module];
      if(expected){
        const info=headerInfo(sheet.rows,expected);
        if(info) detected.push({title,headerRow:info.index+1,dataRows:Math.max(0,sheet.rows.length-info.index-1)});
      }else if(connection.module==="techieWeeklyActivity"){
        const weekRows=sheet.rows.filter(r=>/^WEEK\s+[1-5]$/i.test(text(r[0]))).length;
        const headerIndex=sheet.rows.findIndex((r,i)=>i<8&&r.some(v=>norm(v)==="BENJAMIN")&&r.some(v=>norm(v)==="TOTAL"));
        if(weekRows&&headerIndex>=0) detected.push({title,headerRow:headerIndex+1,dataRows:weekRows});
      }
    }
    results.push({module:connection.module,spreadsheetId:connection.spreadsheet_id,tabs,detected});
  }
  return results;
}

export async function importLegacyGoogleSheets(userId:string){
  const {supabase,client}=await getGoogleClientForUser(userId);
  const sheets=google.sheets({version:"v4",auth:client});
  const {data:connections,error}=await supabase.from("google_connections").select("module,spreadsheet_id,sheet_name,active").eq("active",true).eq("sync_direction","platform_to_sheet");
  if(error) throw error;
  const byModule=new Map((connections??[]).map((x:any)=>[x.module,x]));
  const order=["clientData","dailyJobListing","dailyJobDone","usedStock","miscellaneousCharges","techieWeeklyActivity"];
  const results:ImportSummary[]=[];
  for(const module of order){
    const connection=byModule.get(module); if(!connection) continue;
    try{
      let summary:ImportSummary;
      if(module==="clientData") summary=await importClientData(supabase,sheets,connection.spreadsheet_id);
      else if(module==="dailyJobListing") summary=await importJobs(supabase,sheets,connection.spreadsheet_id);
      else if(module==="dailyJobDone") summary=await importCompletions(supabase,sheets,connection.spreadsheet_id);
      else if(module==="usedStock") summary=await importStock(supabase,sheets,connection.spreadsheet_id);
      else if(module==="miscellaneousCharges") summary=await importCharges(supabase,sheets,connection.spreadsheet_id);
      else summary=await importWeekly(supabase,sheets,connection.spreadsheet_id);
      results.push(summary);
      const errorText=summary.errors.length?summary.errors.slice(0,10).join(" | "):null;
      await supabase.from("google_connections").update({last_error:errorText,updated_at:new Date().toISOString()}).eq("module",module);
    }catch(error){
      results.push({module,sheets:0,rows:0,imported:0,skipped:0,errors:[error instanceof Error?error.message:"Import failed"]});
      await supabase.from("google_connections").update({last_error:error instanceof Error?error.message:"Import failed",updated_at:new Date().toISOString()}).eq("module",module);
    }
  }
  return results;
}
