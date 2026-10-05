import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getServiceSupabase } from "../../../../lib/googleServer";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODULES = ["clientData","dailyJobListing","dailyJobDone","usedStock","miscellaneousCharges","techieWeeklyActivity"] as const;
type ModuleName = typeof MODULES[number];
type Row = string[];

const text=(v:unknown)=>v==null?"":String(v).trim();
const norm=(v:unknown)=>text(v).replace(/\s+/g," ").toUpperCase();
const num=(v:unknown)=>{const n=Number(text(v).replace(/[₦$£€,\s]/g,""));return Number.isFinite(n)?n:0};
const slug=(v:string)=>norm(v).replace(/[^A-Z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80);
function stableHash(v:string){let h=2166136261;for(let i=0;i<v.length;i++){h^=v.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(36)}
function validSyncId(v:unknown){const s=text(v);return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)?s:null}
function sourceKey(module:string,sheet:string,row:number,collisions:Set<string>){const s=slug(sheet);return `sheet|${module}|${s}${collisions.has(s)?`|${stableHash(sheet)}`:""}|${row}`}
function legacyClientKey(name:string){return `client|legacy|${slug(name)}`}

function rowsOf(ws:XLSX.WorkSheet):Row[]{
  if(!ws["!ref"]) return [];
  const range=XLSX.utils.decode_range(ws["!ref"]); const out:Row[]=[];
  for(let r=range.s.r;r<=range.e.r;r++){const row:Row=[];
    for(let col=range.s.c;col<=range.e.c;col++){
      const cell=ws[XLSX.utils.encode_cell({r,c:col})] as XLSX.CellObject|undefined;
      if(!cell){row.push("");continue;}
      if(cell.t==="n" && typeof cell.v==="number"){
        const format=typeof cell.z==="string"?cell.z:"";
        if(format && XLSX.SSF.is_date(format)) row.push(text(cell.w ?? XLSX.SSF.format(format,cell.v)));
        else row.push(String(cell.v));
      }else row.push(text(cell.v ?? cell.w));
    }
    out.push(row);
  }
  return out;
}
function workbook(buf:Buffer){const wb=XLSX.read(buf,{type:"buffer",cellDates:false});return wb.SheetNames.map(title=>({title,rows:rowsOf(wb.Sheets[title])}))}
function nh(v:unknown){return norm(v).replace(/&/g," AND ").replace(/[\\/().,:;_-]+/g," ").replace(/\\s+/g," ").trim().replace(/NUMBER OF JOBS/g,"NUMBER OF JOB").replace(/NUMBERS OF JOB/g,"NUMBER OF JOB").replace(/VEHICLE DETAILS/g,"VEH DETAILS").replace(/CUSTOMER CLIENT NAME/g,"CUSTOMER CLIENT NAME").replace(/CUSTOMER CLIENT/g,"CUSTOMER CLIENT").replace(/^CLIENT NAME$/g,"CUSTOMER CLIENT NAME").replace(/^CUSTOMER NAME$/g,"CUSTOMER CLIENT NAME").replace(/^NAME$/g,"CUSTOMER CLIENT NAME").replace(/^EMAIL$/g,"EMAIL ADDRESS").replace(/^PHONE$/g,"PHONE NUMBER").replace(/^MOBILE NUMBER$/g,"PHONE NUMBER").replace(/^MOBILE$/g,"PHONE NUMBER").replace(/^ADDRESS$/g,"LOCATION").replace(/^CLIENT LOCATION$/g,"LOCATION").replace(/INSTALLER NAME/g,"INSTALLER NAME")}
function header(rows:Row[],expected:string[],threshold=Math.max(3,Math.ceil(expected.length*.4))){const wanted=new Set(expected.map(nh));let best={i:-1,s:0};for(let i=0;i<rows.length;i++){const found=new Set(rows[i].map(nh).filter(Boolean));let s=0;wanted.forEach(h=>{if(found.has(h))s++});if(s>best.s)best={i,s}}return best.s>=threshold?best.i:-1}
function mapRow(headers:Row,row:Row){const o:Record<string,string>={};headers.forEach((h,i)=>{const rawKey=norm(h),canonical=nh(h),value=text(row[i]);if(rawKey)o[rawKey]=value;if(canonical)o[canonical]=value;if(canonical==="NUMBER OF JOB"){o["NUMBERS OF JOB"]=value;o["NUMBER OF JOBS"]=value}if(canonical==="VEH DETAILS")o["VEHICLE DETAILS"]=value;if(canonical==="CUSTOMER CLIENT NAME"){o["CUSTOMER/CLIENT NAME"]=value;o["CUSTOMER/ CLIENT NAME"]=value;o["CLIENT NAME"]=value}});return o}
function parseLegacyTabDate(value:unknown,fallbackYear=new Date().getFullYear()){let raw=text(value).toUpperCase().replace(/[,]/g," ").replace(/\s+/g," ").trim();raw=raw.replace(/\\b1O(TH)\\b/g,"10$1");if(!raw)return null;const months:Record<string,number>={JAN:1,JANUARY:1,FEB:2,FEBRUARY:2,MAR:3,MARCH:3,APR:4,APRIL:4,MAY:5,JUN:6,JUNE:6,JUL:7,JULY:7,JLUY:7,AUG:8,AUGUST:8,SEP:9,SEPT:9,SEPTEMBER:9,OCT:10,OCTOBER:10,NOV:11,NOVEMBER:11,DEC:12,DECEMBER:12};const ordinal=(s:string)=>Number(s.replace(/(ST|ND|RD|TH)$/,""));let m=raw.match(/^(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)[\\s\\-_./]*(\\d{1,2}(?:ST|ND|RD|TH)?)$/);if(m){const month=months[m[1]],day=ordinal(m[2]);if(month&&day>=1&&day<=31)return fallbackYear+"-"+String(month).padStart(2,"0")+"-"+String(day).padStart(2,"0")}m=raw.match(/^(\\d{1,2}(?:ST|ND|RD|TH)?)[\\s\\-_.\\/]*(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)$/);if(m){const day=ordinal(m[1]),month=months[m[2]];if(month&&day>=1&&day<=31)return fallbackYear+"-"+String(month).padStart(2,"0")+"-"+String(day).padStart(2,"0")}const compact=raw.replace(/[\\s._\\/]+/g,"-").replace(/-+/g,"-"),md=compact.match(/^([A-Z]+)-?(\\d{1,2})(?:ST|ND|RD|TH)?$/);if(md){const month=months[md[1]],day=Number(md[2]);if(month&&day>=1&&day<=31)return fallbackYear+"-"+String(month).padStart(2,"0")+"-"+String(day).padStart(2,"0")}if(/\\b\\d{4}\\b/.test(raw)){const d=new Date(raw);if(!Number.isNaN(d.getTime()))return d.toISOString().slice(0,10)}return null}
function parseDate(v:unknown,fallback:string|null=null){const raw=text(v);if(!raw)return fallback??null;const iso=raw.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/);if(iso)return iso[1]+"-"+iso[2].padStart(2,"0")+"-"+iso[3].padStart(2,"0");const dmy=raw.match(/^(\\d{1,2})[\\/.\\-](\\d{1,2})[\\/.\\-](\\d{4})$/);if(dmy)return dmy[3]+"-"+dmy[2].padStart(2,"0")+"-"+dmy[1].padStart(2,"0");const named=raw.match(/^(\\d{1,2})\\s+([A-Za-z]+)\\s+(\\d{4})$/);if(named){const months=["january","february","march","april","may","june","july","august","september","october","november","december"],idx=months.indexOf(named[2].toLowerCase());if(idx>=0)return named[3]+"-"+String(idx+1).padStart(2,"0")+"-"+named[1].padStart(2,"0")}if(/\\b\\d{4}\\b/.test(raw)){const d=new Date(raw);if(!Number.isNaN(d.getTime()))return d.toISOString().slice(0,10)}return fallback??null}
function parseTime(v:unknown){const r=norm(v);if(!r)return null;const m=r.match(/^(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*(AM|PM)?$/);if(!m)return null;let h=+m[1];if(m[4]==="PM"&&h<12)h+=12;if(m[4]==="AM"&&h===12)h=0;return h>23||+m[2]>59||+(m[3]||0)>59?null:`${String(h).padStart(2,"0")}:${m[2]}:${m[3]||"00"}`}
const expected:Record<ModuleName,string[]>={
 clientData:["S/N","CUSTOMER/CLIENT NAME","CONTACT PERSON","CUSTOMER CATEGORY","PHONE NUMBER","EMAIL ADDRESS","LOCATION","BB SYNC ID"],
 dailyJobListing:["CLIENT NAMES","INSURANCE/PERSONAL","NUMBERS OF JOB","VEHICLE MAKE","TIME","LOCATION","TSS OFFICER","BB SYNC ID"],
 dailyJobDone:["DEVICE ID","DATE","INSTALLER NAME","LOCATION","NAME","VEH DETAILS","VEH MAKE","STATUS","TSS OFFICER","BB SYNC ID"],
 usedStock:["NETWORK","DEVICE TYPES","DEVICE STATUS- USED / UNUSED-SIGHTED / UNUSED-UNSIGHTED; OTHERS","DEVICE ID","SIM ID","DATE COLLECTED","OPS REMARK - RECEIVED OR NOT RECEIVED","OPS CORRECTIONS - DEVICE & SIM","DATE/MONTH ISSUED TO TECHNICIAN","DATE INSTALLED","INSTALLER NAME","LOCATION","CLIENT NAME","VEHICLE DETAILS","VEHICLE MAKE","OTHER ISSUES","BB SYNC ID"],
 miscellaneousCharges:["S/N","CUSTOMER/ CLIENT NAME","LOCATION","LOGISTICS","ACCOMMODATION","SWAP","DEINSTALLATION","REINSTALLATION","HEALTH CHECK","SIM REPLACEMENT","OTHERS","PAID OR APPROVED","BB SYNC ID"],
 techieWeeklyActivity:[]
};

type Rec={key:string;id:string;fields:Record<string,unknown>};
function parseModule(module:ModuleName,buf:Buffer):Rec[]{
 const sheets=workbook(buf); const collisions=new Set<string>(); const counts=new Map<string,number>(); for(const s of sheets){const k=slug(s.title);counts.set(k,(counts.get(k)||0)+1)} for(const [k,n] of Array.from(counts.entries()))if(n>1)collisions.add(k);
 const out:Rec[]=[];
 if(module==="clientData"){
   for(const s of sheets){const i=header(s.rows,expected.clientData,3);if(i<0)continue;for(let r=i+1;r<s.rows.length;r++){const raw=mapRow(s.rows[i],s.rows[r]);const name=raw["CUSTOMER CLIENT NAME"];if(!name)continue;out.push({key:legacyClientKey(name),id:validSyncId(raw["BB SYNC ID"])||"",fields:{name,contact_person:raw["CONTACT PERSON"],category:raw["CUSTOMER CATEGORY"],phone:raw["PHONE NUMBER"],email:raw["EMAIL ADDRESS"],location:raw["LOCATION"]}})}}return out;
 }
 for(const s of sheets){
   const i=module==="miscellaneousCharges"?header(s.rows,expected.miscellaneousCharges,3):header(s.rows,expected[module]);
   if(i<0)continue; const d=parseLegacyTabDate(s.title);
   for(let r=i+1;r<s.rows.length;r++){const raw=mapRow(s.rows[i],s.rows[r]);const rowNo=r+1;
     if(module==="dailyJobListing" && !raw["CLIENT NAMES"])continue;
     if(module==="dailyJobDone" && !raw["DEVICE ID"] && !raw["CUSTOMER CLIENT NAME"])continue;
     if(module==="usedStock" && !raw["DEVICE ID"] && !raw["SIM ID"])continue;
     if(module==="miscellaneousCharges" && !raw["CUSTOMER CLIENT NAME"] && !raw["LOCATION"])continue;
     const key=sourceKey(module,s.title,rowNo,collisions);
     if(module==="dailyJobListing") out.push({key,id:validSyncId(raw["BB SYNC ID"])||"",fields:{job_id:`BB-LEGACY-${collisions.has(slug(s.title))?slug(s.title)+"-"+stableHash(s.title):(slug(s.title)||"TAB")}-${rowNo}`,legacy_client_name:raw["CLIENT NAMES"],job_type:raw["INSURANCE/PERSONAL"],number_of_vehicles:Math.max(1,Math.trunc(num(raw["NUMBERS OF JOB"])||1)),vehicle_make:raw["VEHICLE MAKE"],scheduled_date:parseDate(raw["DATE"],d),scheduled_time:parseTime(raw["TIME"]),location:raw["LOCATION"],tss_officer_name:raw["TSS OFFICER"]}});
     else if(module==="dailyJobDone") out.push({key,id:validSyncId(raw["BB SYNC ID"])||"",fields:{device_id:raw["DEVICE ID"],completion_date:parseDate(raw["DATE"],d),installer:raw["INSTALLER NAME"],location:raw["LOCATION"],client:raw["CUSTOMER CLIENT NAME"]||raw["NAME"],vehicle_details:raw["VEH DETAILS"],vehicle_make:raw["VEH MAKE"],status:raw["STATUS"]||"Completed",tss_officer:raw["TSS OFFICER"]}});
     else if(module==="usedStock") out.push({key,id:validSyncId(raw["BB SYNC ID"])||"",fields:{network:raw["NETWORK"],device_type:raw["DEVICE TYPES"],device_status:raw["DEVICE STATUS USED UNUSED SIGHTED UNUSED UNSIGHTED OTHERS"]||raw["DEVICE STATUS- USED / UNUSED-SIGHTED / UNUSED-UNSIGHTED; OTHERS"],device_id:raw["DEVICE ID"],sim_id:raw["SIM ID"],date_collected:parseDate(raw["DATE COLLECTED"]),operations_remark:raw["OPS REMARK RECEIVED OR NOT RECEIVED"],operations_correction:raw["OPS CORRECTIONS DEVICE SIM"],date_issued:parseDate(raw["DATE MONTH ISSUED TO TECHNICIAN"]),date_installed:parseDate(raw["DATE INSTALLED"]),installer:raw["INSTALLER NAME"],location:raw["LOCATION"],client:raw["CLIENT NAME"],vehicle_details:raw["VEHICLE DETAILS"]||raw["VEH DETAILS"],vehicle_make:raw["VEHICLE MAKE"],other_issues:raw["OTHER ISSUES"]}});
     else out.push({key,id:validSyncId(raw["BB SYNC ID"])||"",fields:{charge_id:`BB-LEGACY-CHG-${slug(s.title)||"TAB"}-${rowNo}`,client_name:raw["CUSTOMER CLIENT NAME"],location:raw["LOCATION"],logistics:num(raw["LOGISTICS"]),accommodation:num(raw["ACCOMMODATION"]),swap:num(raw["SWAP"]),deinstallation:num(raw["DEINSTALLATION"]),reinstallation:num(raw["REINSTALLATION"]),health_check:num(raw["HEALTH CHECK"]),sim_replacement:num(raw["SIM REPLACEMENT"]),others:num(raw["OTHERS"]),paid_or_approved:raw["PAID OR APPROVED"]||"Pending"}});
   }
 }
 return out;
}

function weeklyParse(buf:Buffer):Rec[]{
 const out:Rec[]=[]; const sheets=workbook(buf); const counts=new Map<string,number>();for(const s of sheets){const k=slug(s.title);counts.set(k,(counts.get(k)||0)+1)}const collisions=new Set<string>();for(const [k,n] of Array.from(counts.entries()))if(n>1)collisions.add(k);
 for(const s of sheets){let weekRows:number[]=[];for(let i=0;i<s.rows.length;i++)if(s.rows[i].some(c=>/\bWEEK\s*[-:#.]?\s*[1-5]\b|^[1-5](?:ST|ND|RD|TH)?\s+WEEK\b/i.test(c)))weekRows.push(i);if(!weekRows.length)continue;const hi=weekRows[0]>0?weekRows[0]-1:-1;if(hi<0)continue;const headers=s.rows[hi];const monthText=s.rows[0]?.join(" ")||s.title;const month=monthText.match(/([A-Z]+)\s+(\d{4})/i);const months:{[k:string]:number}={JANUARY:1,FEBRUARY:2,MARCH:3,APRIL:4,MAY:5,JUNE:6,JULY:7,AUGUST:8,SEPTEMBER:9,OCTOBER:10,NOVEMBER:11,DECEMBER:12};for(const wi of weekRows){const weekNo=Math.max(1,Math.min(5,Number((s.rows[wi].find(c=>/WEEK/i.test(c))||"").replace(/\D/g,""))||wi-hi));const date=month&&months[month[1].toUpperCase()]?`${month[2]}-${String(months[month[1].toUpperCase()]).padStart(2,"0")}-${String((weekNo-1)*7+1).padStart(2,"0")}`:parseLegacyTabDate(s.title);for(let c=1;c<headers.length;c++){const tech=text(headers[c]);if(!tech||norm(tech)==="TOTAL")continue;const value=text(s.rows[wi][c]);if(!value)continue;const rowNo=(wi+1)*1000+c;out.push({key:sourceKey("techieWeeklyActivity",s.title,rowNo,collisions),id:"",fields:{technician_name:tech,week_start:date,projects_completed:Math.max(0,Math.trunc(num(value))),vehicles_completed:0}})}}}return out;
}

async function allRows(supabase:any,table:string,select:string){const out:any[]=[];for(let from=0;;from+=1000){const {data,error}=await supabase.from(table).select(select).range(from,from+999);if(error)throw error;out.push(...(data||[]));if(!data||data.length<1000)break}return out}
function clean(v:any){if(v===null||v===undefined)return "";if(typeof v==="number")return Number.isFinite(v)?String(v):"";return norm(v)}
function equal(a:any,b:any){return clean(a)===clean(b)}
function compare(source:Rec[],platform:Rec[],idField:string){const sm=new Map(source.map(r=>[r.key,r]));const pm=new Map(platform.map(r=>[r.key,r]));const diffs:any[]=[];
 for(const [k,s] of Array.from(sm.entries())){const p=pm.get(k);if(!p){diffs.push({type:"missing_in_platform",key:k,id:s.id,fields:{},source:s.fields,platform:null});continue}const changed:any={};for(const f of Object.keys(s.fields))if(!equal(s.fields[f],p.fields[f]))changed[f]={source:s.fields[f],platform:p.fields[f]};if(Object.keys(changed).length)diffs.push({type:"changed",key:k,id:s.id,fields:changed,source:s.fields,platform:p.fields})}
 for(const [k,p] of Array.from(pm.entries()))if(!sm.has(k))diffs.push({type:"extra_in_platform",key:k,id:p.id,fields:{},source:null,platform:p.fields});
 return diffs;
}

async function platformFor(supabase:any,module:ModuleName):Promise<Rec[]>{
 if(module==="clientData"){const rows=await allRows(supabase,"clients","id,legacy_source_key,name,contact_person,category,phone,email,location");return rows.filter(r=>r.legacy_source_key).map(r=>({key:r.legacy_source_key,id:String(r.id),fields:{name:r.name,contact_person:r.contact_person,category:r.category,phone:r.phone,email:r.email,location:r.location}}))}
 if(module==="dailyJobListing"){const rows=await allRows(supabase,"jobs","id,job_id,legacy_source_key,client_id,legacy_client_name,job_type,number_of_vehicles,vehicle_make,scheduled_date,scheduled_time,location,tss_officer_name");return rows.map(r=>({key:r.legacy_source_key||`__id__${r.id}`,id:String(r.id),fields:{job_id:r.job_id,legacy_client_name:r.legacy_client_name,job_type:r.job_type,number_of_vehicles:r.number_of_vehicles,vehicle_make:r.vehicle_make,scheduled_date:r.scheduled_date,scheduled_time:r.scheduled_time,location:r.location,tss_officer_name:r.tss_officer_name}}))}
 if(module==="dailyJobDone"){const rows=await allRows(supabase,"job_completions","id,legacy_source_key,device_id,completion_date,installer,location,client,vehicle_details,vehicle_make,status,tss_officer");return rows.map(r=>({key:r.legacy_source_key||`__id__${r.id}`,id:String(r.id),fields:{device_id:r.device_id,completion_date:r.completion_date,installer:r.installer,location:r.location,client:r.client,vehicle_details:r.vehicle_details,vehicle_make:r.vehicle_make,status:r.status,tss_officer:r.tss_officer}}))}
 if(module==="usedStock"){const rows=await allRows(supabase,"stock_transactions","id,legacy_source_key,network,device_type,device_status,device_id,sim_id,date_collected,operations_remark,operations_correction,date_issued,date_installed,installer,location,client,vehicle_details,vehicle_make,other_issues");return rows.map(r=>({key:r.legacy_source_key||`__id__${r.id}`,id:String(r.id),fields:{network:r.network,device_type:r.device_type,device_status:r.device_status,device_id:r.device_id,sim_id:r.sim_id,date_collected:r.date_collected,operations_remark:r.operations_remark,operations_correction:r.operations_correction,date_issued:r.date_issued,date_installed:r.date_installed,installer:r.installer,location:r.location,client:r.client,vehicle_details:r.vehicle_details,vehicle_make:r.vehicle_make,other_issues:r.other_issues}}))}
 if(module==="miscellaneousCharges"){const rows=await allRows(supabase,"miscellaneous_charges","id,legacy_source_key,location,logistics,accommodation,swap,deinstallation,reinstallation,health_check,sim_replacement,others,paid_or_approved,client_id");const clients=await allRows(supabase,"clients","id,name");const cm=new Map(clients.map(c=>[String(c.id),c.name]));return rows.map(r=>({key:r.legacy_source_key||`__id__${r.id}`,id:String(r.id),fields:{charge_id:r.charge_id,client_name:cm.get(String(r.client_id))||"",location:r.location,logistics:r.logistics,accommodation:r.accommodation,swap:r.swap,deinstallation:r.deinstallation,reinstallation:r.reinstallation,health_check:r.health_check,sim_replacement:r.sim_replacement,others:r.others,paid_or_approved:r.paid_or_approved}}))}
 const rows=await allRows(supabase,"technician_weekly_activity","id,legacy_source_key,technician_name,week_start,projects_completed,vehicles_completed");return rows.map(r=>({key:r.legacy_source_key||`__id__${r.id}`,id:String(r.id),fields:{technician_name:r.technician_name,week_start:r.week_start,projects_completed:r.projects_completed,vehicles_completed:r.vehicles_completed}}));
}

export async function POST(req:Request){
 try{
  const secret=process.env.CRON_SECRET||"";const auth=req.headers.get("authorization")||"";if(!secret||auth!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized"},{status:401});
  const form=await req.formData();const runId=text(form.get("run_id"));const sourceRunId=Number(text(form.get("source_run_id"))||0)||null;const commit=text(form.get("source_commit_sha"));const module=text(form.get("module")) as ModuleName;const file=form.get("file");
  if(!MODULES.includes(module)||!(file instanceof File))return NextResponse.json({error:"module and XLSX file are required"},{status:400});
  const supabase=getServiceSupabase();const run=runId?{id:runId}:{id:""};
  if(!run.id){const {data,error}=await supabase.from("google_reconciliation_runs").insert({source_run_id:sourceRunId,source_commit_sha:commit,status:"running"}).select("id").single();if(error)throw error;run.id=String(data.id)}
  const buf=Buffer.from(await file.arrayBuffer());const source=module==="techieWeeklyActivity"?weeklyParse(buf):parseModule(module,buf);const platform=await platformFor(supabase,module);const diffs=compare(source,platform,"id");
  const relevant=diffs.filter(d=>d.type!=="extra_in_platform"||d.key.startsWith("sheet|")||d.key.startsWith("client|")||d.key.startsWith("__id__"));
  const payload=relevant.map(d=>({run_id:run.id,module,diff_type:d.type,legacy_source_key:d.key,record_identifier:d.id||null,changed_fields:d.fields,source_record:d.source,platform_record:d.platform}));
  for(let i=0;i<payload.length;i+=250){const {error}=await supabase.from("google_reconciliation_diffs").insert(payload.slice(i,i+250));if(error)throw error}
  const summary={source_records:source.length,platform_records:platform.length,missing_in_platform:diffs.filter(d=>d.type==="missing_in_platform").length,extra_in_platform:diffs.filter(d=>d.type==="extra_in_platform").length,changed:diffs.filter(d=>d.type==="changed").length};
  await supabase.from("google_reconciliation_runs").update({status:"complete",summary}).eq("id",run.id);
  return NextResponse.json({run_id:run.id,module,summary});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Reconciliation failed"},{status:500})}
}
