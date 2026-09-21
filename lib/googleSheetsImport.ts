import { google, drive_v3 } from "googleapis";
import * as XLSX from "xlsx";
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
function normHeader(value: unknown){
  return norm(value)
    .replace(/&/g," AND ")
    .replace(/[\\/().,:;_-]+/g," ")
    .replace(/\s+/g," ")
    .trim()
    .replace(/NUMBER OF JOBS/g,"NUMBER OF JOB")
    .replace(/NUMBERS OF JOB/g,"NUMBER OF JOB")
    .replace(/VEHICLE DETAILS/g,"VEH DETAILS")
    .replace(/CUSTOMER CLIENT NAME/g,"CUSTOMER CLIENT NAME")
    .replace(/CUSTOMER CLIENT/g,"CUSTOMER CLIENT")
    .replace(/^CLIENT NAME$/g,"CUSTOMER CLIENT NAME")
    .replace(/^CUSTOMER NAME$/g,"CUSTOMER CLIENT NAME")
    .replace(/^NAME$/g,"CUSTOMER CLIENT NAME")
    .replace(/^EMAIL$/g,"EMAIL ADDRESS")
    .replace(/^PHONE$/g,"PHONE NUMBER")
    .replace(/^MOBILE NUMBER$/g,"PHONE NUMBER")
    .replace(/^MOBILE$/g,"PHONE NUMBER")
    .replace(/^ADDRESS$/g,"LOCATION")
    .replace(/^CLIENT LOCATION$/g,"LOCATION")
    .replace(/INSTALLER NAME/g,"INSTALLER NAME");
}
function isWeekLabel(value:unknown){
  return /^\s*WEEK\D*([1-5])\b/i.test(text(value));
}
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

async function loadDriveWorkbook(client:drive_v3.Drive,spreadsheetId:string){
  const xlsxMime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  let response;
  try{
    response=await client.files.export(
      {fileId:spreadsheetId,mimeType:xlsxMime},
      {responseType:"arraybuffer"}
    );
  }catch{
    response=await client.files.get(
      {fileId:spreadsheetId,alt:"media"},
      {responseType:"arraybuffer"}
    );
  }
  const buffer=Buffer.from(response.data as ArrayBuffer);
  const workbook=XLSX.read(buffer,{type:"buffer",cellDates:false});
  return workbook.SheetNames.map(title=>({
    title,
    rows:(XLSX.utils.sheet_to_json(workbook.Sheets[title],{header:1,defval:"",raw:false}) as unknown[][]).map(row=>row.map(text))
  }));
}

function headerInfo(rows:Row[],expected:string[]){
  let best={index:-1,score:0};
  const wanted=new Set(expected.map(normHeader));
  const limit=Math.min(rows.length,120);
  for(let i=0;i<limit;i++){
    const found=new Set(rows[i].map(normHeader).filter(Boolean));
    let score=0; wanted.forEach(h=>{if(found.has(h)) score++;});
    if(score>best.score) best={index:i,score};
  }
  const threshold=expected.includes("CUSTOMER/CLIENT NAME")
    ? 3
    : Math.max(3,Math.ceil(expected.length*0.4));
  return best.score>=threshold?best:null;
}
function countDataRows(rows:Row[],headerIndex:number){
  return rows.slice(headerIndex+1).filter(r=>r.some(v=>text(v))).length;
}
function findWeeklyRows(rows:Row[]){
  return rows.map((r,i)=>({r,i})).filter(x=>x.r.some(cell=>isWeekLabel(cell)));
}
function findWeeklyHeaderIndex(rows:Row[],firstWeekIndex:number){
  if(firstWeekIndex<=0) return -1;
  for(let i=firstWeekIndex-1;i>=0;i--){
    const cells=rows[i].map(text).filter(Boolean);
    if(cells.length>=2) return i;
  }
  return -1;
}
function clientHeaderInfo(rows:Row[]){
  const primary=new Set(["CUSTOMER CLIENT NAME","CLIENT NAME","CUSTOMER NAME","NAME"]);
  const secondary=new Set(["CONTACT PERSON","CONTACT","PHONE NUMBER","PHONE","MOBILE","MOBILE NUMBER","EMAIL ADDRESS","EMAIL","LOCATION","ADDRESS","CUSTOMER CATEGORY","CATEGORY"]);
  let best={index:-1,score:0};
  for(let i=0;i<Math.min(rows.length,120);i++){
    const cells=rows[i].map(normHeader);
    const hasPrimary=cells.some(v=>primary.has(v));
    const secondaryScore=cells.filter(v=>secondary.has(v)).length;
    const score=(hasPrimary?3:0)+Math.min(secondaryScore,4);
    if(score>best.score) best={index:i,score};
  }
  return best.score>=5?best:null;
}
function rowMap(headers:Row,row:Row){
  const out:Record<string,string>={};
  headers.forEach((h,i)=>{
    const rawKey=norm(h);
    const canonical=normHeader(h);
    const value=text(row[i]);
    if(rawKey) out[rawKey]=value;
    if(canonical) out[canonical]=value;
    if(canonical==="NUMBER OF JOB"){
      out["NUMBERS OF JOB"]=value;
      out["NUMBER OF JOBS"]=value;
    }
    if(canonical==="VEH DETAILS") out["VEHICLE DETAILS"]=value;
    if(canonical==="CUSTOMER CLIENT NAME"){
      out["CUSTOMER/CLIENT NAME"]=value;
      out["CUSTOMER/ CLIENT NAME"]=value;
      out["CLIENT NAME"]=value;
    }
    if(canonical==="CUSTOMER CLIENT NAME") out["CUSTOMER/ CLIENT NAME"]=value;
  });
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
async function clientLookup(supabase:any):Promise<Map<string,string>>{
  const {data,error}=await supabase.from("clients").select("id,name");
  if(error) throw error;
  const map=new Map<string,string>();
  for(const x of data??[]){ if(x.name) map.set(norm(x.name),String(x.id)); }
  return map;
}
async function ensureClient(supabase:any,map:Map<string,string>,name:string){
  const key=norm(name); if(!key) return null;
  const existing=map.get(key); if(existing) return existing;
  const id=await upsertClient(supabase,{name},legacyClientKey(name));
  if(id) map.set(key,id);
  return id;
}

async function importClientData(supabase:any,client:drive_v3.Drive,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"clientData",sheets:0,rows:0,imported:0,skipped:0,errors:[]};
  for(const sheet of await loadDriveWorkbook(client,spreadsheetId)){
    const title=sheet.title;
    const info=clientHeaderInfo(sheet.rows); if(!info) continue;
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

async function importJobs(supabase:any,client:drive_v3.Drive,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"dailyJobListing",sheets:0,rows:0,imported:0,skipped:0,errors:[]};
  const clients=await clientLookup(supabase);
  const {data:profiles,error:pe}=await supabase.from("profiles").select("id,full_name");
  if(pe) throw pe;
  const profileMap=new Map((profiles??[]).map((x:any)=>[norm(x.full_name),String(x.id)]));
  for(const sheet of await loadDriveWorkbook(client,spreadsheetId)){
    const title=sheet.title;
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

async function importCompletions(supabase:any,client:drive_v3.Drive,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"dailyJobDone",sheets:0,rows:0,imported:0,skipped:0,errors:[]};
  for(const sheet of await loadDriveWorkbook(client,spreadsheetId)){
    const title=sheet.title;
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

async function importStock(supabase:any,client:drive_v3.Drive,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"usedStock",sheets:0,rows:0,imported:0,skipped:0,errors:[]};
  for(const sheet of await loadDriveWorkbook(client,spreadsheetId)){
    const title=sheet.title;
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

async function importCharges(supabase:any,client:drive_v3.Drive,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"miscellaneousCharges",sheets:0,rows:0,imported:0,skipped:0,errors:[]};
  const clients=await clientLookup(supabase);
  for(const sheet of await loadDriveWorkbook(client,spreadsheetId)){
    const title=sheet.title;
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

async function importWeekly(supabase:any,client:drive_v3.Drive,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"techieWeeklyActivity",sheets:0,rows:0,imported:0,skipped:0,errors:[]};
  for(const sheet of await loadDriveWorkbook(client,spreadsheetId)){
    const title=sheet.title;
    const weekRows=findWeeklyRows(sheet.rows);
    if(!weekRows.length) continue;
    const firstWeekIndex=weekRows[0].i;
    const headerIndex=findWeeklyHeaderIndex(sheet.rows,firstWeekIndex);
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
  const drive=google.drive({version:"v3",auth:client});
  const {data:connections,error}=await supabase.from("google_connections").select("module,spreadsheet_id,sheet_name,active").eq("active",true).eq("sync_direction","platform_to_sheet");
  if(error) throw error;
  const results:any[]=[];
  for(const connection of (connections??[]) as any[]){
    try{
      const workbook=await loadDriveWorkbook(drive,connection.spreadsheet_id);
      const tabs=workbook.map(s=>s.title);
      const detected:any[]=[];
      for(const sheet of workbook){
        const title=sheet.title;
        const expected=expectedHeaders[connection.module];
        if(connection.module==="clientData"){
          const info=clientHeaderInfo(sheet.rows);
          if(info){
            detected.push({title,headerRow:info.index+1,dataRows:Math.max(0,sheet.rows.length-info.index-1)});
          }else if(/^[A-Z]+\s+\d{4}$/i.test(title)){
            detected.push({title,headerRow:null,dataRows:Math.max(0,sheet.rows.length),needsHeaderReview:true});
          }
        }else if(expected){
          const info=headerInfo(sheet.rows,expected);
          if(info) detected.push({title,headerRow:info.index+1,dataRows:Math.max(0,sheet.rows.length-info.index-1)});
        }else if(connection.module==="techieWeeklyActivity"){
          const weekRows=findWeeklyRows(sheet.rows);
          const firstWeekIndex=weekRows.length?weekRows[0].i:-1;
          const headerIndex=findWeeklyHeaderIndex(sheet.rows,firstWeekIndex);
          if(weekRows.length){
            detected.push({title,headerRow:headerIndex>=0?headerIndex+1:null,dataRows:weekRows.length,needsHeaderReview:headerIndex<0});
          }else if(/^[A-Z]+\s+\d{4}$/i.test(title) && sheet.rows.length){
            detected.push({title,headerRow:null,dataRows:Math.max(0,sheet.rows.length),needsHeaderReview:true});
          }
        }
      }
      results.push({module:connection.module,spreadsheetId:connection.spreadsheet_id,tabs,detected,error:null});
    }catch(error){
      results.push({
        module:connection.module,
        spreadsheetId:connection.spreadsheet_id,
        tabs:[],
        detected:[],
        error:error instanceof Error?error.message:"Unable to read spreadsheet."
      });
    }
  }
  return results;
}

export async function importLegacyGoogleSheets(userId:string){
  const {supabase,client}=await getGoogleClientForUser(userId);
  const drive=google.drive({version:"v3",auth:client});
  const {data:connections,error}=await supabase.from("google_connections").select("module,spreadsheet_id,sheet_name,active").eq("active",true).eq("sync_direction","platform_to_sheet");
  if(error) throw error;
  const byModule=new Map((connections??[]).map((x:any)=>[x.module,x]));
  const order=["clientData","dailyJobListing","dailyJobDone","usedStock","miscellaneousCharges","techieWeeklyActivity"];
  const results:ImportSummary[]=[];
  for(const module of order){
    const connection=byModule.get(module); if(!connection) continue;
    try{
      let summary:ImportSummary;
      if(module==="clientData") summary=await importClientData(supabase,drive,connection.spreadsheet_id);
      else if(module==="dailyJobListing") summary=await importJobs(supabase,drive,connection.spreadsheet_id);
      else if(module==="dailyJobDone") summary=await importCompletions(supabase,drive,connection.spreadsheet_id);
      else if(module==="usedStock") summary=await importStock(supabase,drive,connection.spreadsheet_id);
      else if(module==="miscellaneousCharges") summary=await importCharges(supabase,drive,connection.spreadsheet_id);
      else summary=await importWeekly(supabase,drive,connection.spreadsheet_id);
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
