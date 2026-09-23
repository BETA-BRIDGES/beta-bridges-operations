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
  const s=text(value).toUpperCase().replace(/\s+/g," ").trim();
  return /\bWEEK\s*[-:#.]?\s*[1-5]\b/.test(s)
    || /^WEEK\D*[1-5]\b/.test(s)
    || /^[1-5](?:ST|ND|RD|TH)?\s+WEEK\b/.test(s);
}
function flexibleHeaderInfo(rows:Row[],aliases:string[],threshold=3){
  const wanted=new Set(aliases.map(normHeader));
  let best={index:-1,score:0};
  for(let i=0;i<Math.min(rows.length,150);i++){
    const found=new Set(rows[i].map(normHeader).filter(Boolean));
    let score=0; wanted.forEach(h=>{if(found.has(h)) score++;});
    if(score>best.score) best={index:i,score};
  }
  return best.score>=threshold?best:null;
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
  const limit=rows.length;
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
  const serial=new Set(["S N","SERIAL NUMBER","S N"]);
  let best={index:-1,score:0};
  const limit=Math.min(rows.length,120);
  for(let i=0;i<limit;i++){
    const cells=rows[i].map(normHeader);
    const hasPrimary=cells.some(v=>primary.has(v));
    const secondaryScore=cells.filter(v=>secondary.has(v)).length;
    const hasSerial=cells.some(v=>serial.has(v));
    // Prefer a true table header: a client-name column plus at least one
    // companion field, or a serial-number column plus several companions.
    const score=(hasPrimary?6:0)+Math.min(secondaryScore,4)+(hasSerial?1:0);
    if(score>best.score) best={index:i,score};
  }
  return best.score>=6?best:null;
}
function findHeaderColumn(headers:Row,aliases:string[]){
  const wanted=new Set(aliases.map(normHeader));
  for(let i=0;i<headers.length;i++){
    if(wanted.has(normHeader(headers[i]))) return i;
  }
  return -1;
}
function findClientNameColumn(headers:Row){
  const exact=findHeaderColumn(headers,[
    "CUSTOMER CLIENT NAME","CUSTOMER CLIENT NAMES",
    "CUSTOMER NAME","CUSTOMER NAMES",
    "CLIENT NAME","CLIENT NAMES","NAME"
  ]);
  if(exact>=0) return exact;

  let best={index:-1,score:0};
  headers.forEach((header,index)=>{
    const h=normHeader(header);
    if(!h) return;
    let score=0;
    if(/\bCLIENTS?\b/.test(h)) score+=6;
    if(/\bCUSTOMERS?\b/.test(h)) score+=6;
    if(/\bNAMES?\b/.test(h)) score+=5;
    if(/^NAME$/.test(h)) score+=4;
    if(/CONTACT|CATEGORY|PHONE|MOBILE|EMAIL|LOCATION|ADDRESS/.test(h)) score-=3;
    if(score>best.score) best={index,score};
  });
  return best.score>=5?best.index:-1;
}
function locateClientHeader(rows:Row[]){
  let best={index:-1,score:0};
  for(let i=0;i<rows.length;i++){
    const rawCells=rows[i].map(text);
    const cells=rawCells.map(normHeader);
    const nonEmpty=cells.filter(Boolean);
    if(nonEmpty.length<2) continue;

    const nameCol=findClientNameColumn(rows[i]);
    let score=0;
    if(nameCol>=0) score+=8;
    if(cells.some(v=>v==="S N"||v==="SERIAL NUMBER")) score+=3;
    if(cells.some(v=>v==="CONTACT PERSON"||v==="CONTACT")) score+=2;
    if(cells.some(v=>v==="CUSTOMER CATEGORY"||v==="CATEGORY")) score+=2;
    if(cells.some(v=>v==="PHONE NUMBER"||v==="PHONE"||v==="MOBILE NUMBER"||v==="MOBILE")) score+=2;
    if(cells.some(v=>v==="EMAIL ADDRESS"||v==="EMAIL")) score+=2;
    if(cells.some(v=>v==="LOCATION"||v==="ADDRESS")) score+=2;

    // Also recognize the literal legacy label even when the workbook
    // contains unusual spacing/case around the slash.
    if(rawCells.some(v=>/CUSTOMER\s*\/\s*CLIENT\s+NAME/i.test(v))) score+=4;

    if(score>best.score) best={index:i,score};
  }
  return best.score>=8?best:null;
}
function findChargeHeaderInfo(rows:Row[]){
  let best={index:-1,score:0};
  for(let i=0;i<rows.length;i++){
    const cells=rows[i].map(normHeader);
    const checks=[
      ["CUSTOMER CLIENT NAME","CLIENT NAME","CUSTOMER NAME","NAME"],
      ["LOCATION"],
      ["LOGISTICS"],
      ["ACCOMMODATION"],
      ["SWAP"],
      ["SIM REPLACEMENT"],
      ["OTHERS"]
    ];
    let score=0;
    for(const aliases of checks){if(cells.some(v=>aliases.includes(v))) score++;}
    if(score>best.score) best={index:i,score};
  }
  return best.score>=3?best:null;
}
function firstDataHeaderRow(rows:Row[],required:string[]){
  for(let i=0;i<Math.min(rows.length,80);i++){
    const cells=rows[i].map(normHeader).filter(Boolean);
    if(required.some(h=>cells.includes(h))) return i;
  }
  return -1;
}
function fallbackHeaderRow(rows:Row[],kind:"client"|"charge"){
  const required=kind==="client"
    ? ["CUSTOMER CLIENT NAME","CLIENT NAME","CUSTOMER NAME","NAME","S/N"]
    : ["CUSTOMER CLIENT NAME","CLIENT NAME","CUSTOMER NAME","NAME","LOCATION","LOGISTICS"];
  const direct=firstDataHeaderRow(rows,required);
  if(direct>=0) return direct;
  for(let i=0;i<Math.min(rows.length,30);i++){
    const nonEmpty=rows[i].map(text).filter(Boolean);
    if(nonEmpty.length>=4) return i;
  }
  return -1;
}

function findWeeklyHeaderInfo(rows:Row[],firstWeekIndex:number){
  const limit=Math.min(rows.length,40);
  let best={index:-1,score:0};
  for(let i=0;i<limit;i++){
    const cells=rows[i].map(norm);
    const nonEmpty=cells.filter(Boolean).length;
    const total=cells.includes("TOTAL");
    const nextRows=rows.slice(i+1,Math.min(rows.length,i+7));
    const weekCount=nextRows.filter(r=>r.some(cell=>isWeekLabel(cell))).length;
    const score=(total?6:0)+Math.min(nonEmpty,10)+weekCount*4;
    if(total && weekCount>0 && score>best.score) best={index:i,score};
  }
  if(best.index>=0) return best.index;
  if(firstWeekIndex>0) return firstWeekIndex-1;
  // Last-resort: a row with several technician-like column labels followed by data rows.
  for(let i=0;i<limit;i++){
    const nonEmpty=rows[i].map(text).filter(Boolean);
    if(nonEmpty.length>=3 && i+1<rows.length) return i;
  }
  return -1;
}
function detectWeeklyRows(rows:Row[],headerIndex:number){
  const found=rows.map((r,i)=>({r,i})).filter(x=>x.r.some(cell=>isWeekLabel(cell)));
  if(found.length) return found.slice(0,5);
  if(headerIndex>=0){
    return rows.slice(headerIndex+1,headerIndex+6).map((r,i)=>({r,i:i+headerIndex+1}));
  }
  return [];
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

async function upsertChunks(
  supabase:any, table:string, rows:any[], onConflict:string, errors:string[], label:string, chunkSize=500
){
  // PostgreSQL rejects an upsert batch when the same conflict key appears
  // more than once in that single statement. Legacy workbooks repeat clients
  // across monthly tabs, so collapse duplicate conflict keys before batching.
  const unique=new Map<string,any>();
  const passthrough:any[]=[];
  for(const row of rows){
    const key=row?.[onConflict];
    if(key==null || String(key)==="") passthrough.push(row);
    else unique.set(String(key),row);
  }
  const deduped=passthrough.concat(Array.from(unique.values()));
  let imported=0;
  for(let start=0;start<deduped.length;start+=chunkSize){
    const chunk=deduped.slice(start,start+chunkSize);
    const {error}=await supabase.from(table).upsert(chunk,{onConflict});
    if(error) errors.push(label+" batch "+(start+1)+"-"+(start+chunk.length)+": "+error.message);
    else imported+=chunk.length;
  }
  return imported;
}
async function ensureClientsBatch(supabase:any,names:string[],existing:Map<string,string>){
  const missing=Array.from(new Set(names.map(norm).filter(Boolean))).filter(k=>!existing.has(k));
  if(!missing.length) return existing;
  const byNorm=new Map<string,string>();
  for(const name of names){const k=norm(name);if(k&&!byNorm.has(k))byNorm.set(k,name);}
  const payload=missing.map(key=>({legacy_source_key:legacyClientKey(key),name:byNorm.get(key)||key}));
  const localErrors:string[]=[];
  await upsertChunks(supabase,"clients",payload,"legacy_source_key",localErrors,"Client creation");
  const {data,error}=await supabase.from("clients").select("id,name");
  if(error) throw error;
  for(const x of data??[]){if(x.name) existing.set(norm(x.name),String(x.id));}
  if(localErrors.length) throw new Error(localErrors.join(" | "));
  return existing;
}

function clientDataLooksLikeSerial(value:unknown){
  const s=text(value).replace(/,/g,"").trim();
  return /^#?\d+(?:\.0+)?[.)\-:\/]?$/.test(s);
}
function clientDataPositionalLayout(rows:Row[]){
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    const filled=row.map(text).filter(Boolean).length;
    if(filled<4) continue;

    // Support both:
    //   S/N | CLIENT NAME | ...
    // and exported/indexed layouts such as:
    //   INDEX | S/N | CLIENT NAME | ...
    for(let serialCol=0;serialCol<=2 && serialCol<row.length;serialCol++){
      const serial=text(row[serialCol]);
      if(!clientDataLooksLikeSerial(serial)) continue;

      for(let nameCol=serialCol+1;nameCol<=serialCol+2 && nameCol<row.length;nameCol++){
        const name=text(row[nameCol]);
        if(!name || clientDataLooksLikeSerial(name) || /CUSTOMER|CLIENT|NAME/i.test(name)) continue;
        return {startIndex:i,serialCol,nameCol};
      }
    }
  }
  return null;
}
function clientDataSheetDate(title:string){
  return /^[A-Z]+\s+\d{4}$/i.test(title);
}
function looksLikeClientName(value:unknown){
  const s=text(value);
  if(!s || clientDataLooksLikeSerial(s)) return false;
  if(/^(S\/?N|SERIAL(?: NUMBER)?|CUSTOMER(?:\/|\s+\/\s+)?CLIENT(?:\s+NAME)?|CUSTOMER CLIENT NAME|CLIENT NAME|CONTACT PERSON|CUSTOMER CATEGORY|PHONE NUMBER|EMAIL ADDRESS|LOCATION)$/i.test(s)) return false;
  return /[A-Za-z]/.test(s) && s.length>=2;
}
function looksLikeClientPhone(value:unknown){
  const s=text(value).replace(/[\s().-]/g,"");
  return /^(?:\+?234|0)?[789]\d{8,10}$/.test(s) || /^\d{10,13}$/.test(s);
}
function looksLikeClientEmail(value:unknown){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value));
}
function isKnownNonClientName(value:unknown){
  const s=norm(value);
  if(!s) return true;
  return /^(?:WEEK|\d(?:ST|ND|RD|TH)? WEEK)|^(?:TECHIE|TECHIES).*ACTIVIT|^TOTAL$|^EXTRA(?: DAYS| 3 DAYS)?$|^\d+ HCS$/.test(s)
    || ["BENJAMIN","GOKE","MICHAEL","SAMSON","SUNDAY","SYLVESTER","MALIK","JOSEPH","ISAAC","PATRICK","EMMANUEL","SHAMSUDEEN","JEREMIAH","MUTIU","AHMED","SEUN","AINA","FAVOUR","ADEKUNLE","ALEEM","DAVID","FRANK"].includes(s);
}
function parseClientDataRow(row:Row){
  const cells=row.map(text);

  // Best path: use an S/N-like value as an anchor and inspect the next few
  // columns for the customer name. This matches the legacy Client Data
  // layout while avoiding Techie Weekly rows.
  const serialCols=cells.map((v,i)=>({v,i})).filter(x=>clientDataLooksLikeSerial(x.v)).map(x=>x.i);
  for(const serialCol of serialCols){
    for(const nameCol of [serialCol+1,serialCol+2,serialCol+3]){
      if(nameCol>=cells.length) continue;
      const name=cells[nameCol];
      if(!looksLikeClientName(name)||isKnownNonClientName(name)) continue;

      const remainder=cells.slice(nameCol+1);
      const hasEmail=remainder.some(looksLikeClientEmail);
      const hasPhone=remainder.some(looksLikeClientPhone);
      const alphaCompanions=remainder.filter(v=>/[A-Za-z]/.test(v)&&!isKnownNonClientName(v)).length;

      // Weekly rows contain mostly labels/numbers and should not qualify.
      if(!hasEmail && !hasPhone && alphaCompanions<1) continue;

      const contact=remainder.find(v=>/[A-Za-z]/.test(v)&&!looksLikeClientEmail(v)&&!looksLikeClientPhone(v)&&!isKnownNonClientName(v))||null;
      const phone=remainder.find(looksLikeClientPhone)||null;
      const email=remainder.find(looksLikeClientEmail)||null;
      const locationCandidates=remainder.filter(v=>v&&v!==contact&&v!==phone&&v!==email);

      return {
        name,
        contact,
        category:locationCandidates[0]||null,
        phone,
        email,
        location:locationCandidates[1]||locationCandidates[0]||null
      };
    }
  }

  // Fallback for rows where S/N is missing/malformed but contact data exists.
  const signalCols=cells.map((v,i)=>({v,i}))
    .filter(x=>looksLikeClientEmail(x.v)||looksLikeClientPhone(x.v))
    .map(x=>x.i);
  if(signalCols.length){
    const firstSignal=Math.min(...signalCols);
    for(let nameCol=0;nameCol<Math.min(firstSignal,8);nameCol++){
      const name=cells[nameCol];
      if(!looksLikeClientName(name)||isKnownNonClientName(name)) continue;
      return {
        name,
        contact:cells[nameCol+1]||null,
        category:cells[nameCol+2]||null,
        phone:cells.find(looksLikeClientPhone)||null,
        email:cells.find(looksLikeClientEmail)||null,
        location:cells[nameCol+5]||null
      };
    }
  }

  return null;
}

async function importClientData(supabase:any,client:drive_v3.Drive,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"clientData",sheets:0,rows:0,imported:0,skipped:0,errors:[]}; const payloads:any[]=[];
  for(const sheet of await loadDriveWorkbook(client,spreadsheetId)){
    const title=sheet.title;
    const monthTab=!!parseMonthTitle(title);
    const explicitClientSheet=/CLIENT/i.test(title);
    const nonClientTab=/TECHIE|WEEK|ACTIVITY|MISC|CHARGE|STOCK|JOB|DONE|LISTING/i.test(title);

    // The connected Client Data workbook can contain unrelated legacy tabs.
    // Only month-named/client-named tabs are eligible for this importer.
    if((nonClientTab && !explicitClientSheet) || (!monthTab && !explicitClientSheet)) continue;

    const detected=clientHeaderInfo(sheet.rows)
      || locateClientHeader(sheet.rows)
      || flexibleHeaderInfo(sheet.rows,["CUSTOMER CLIENT NAME","CLIENT NAME","CUSTOMER NAME","NAME","CONTACT PERSON","PHONE NUMBER","EMAIL ADDRESS","LOCATION","CUSTOMER CATEGORY"],2);

    let info=detected;
    let positionalLayout:{startIndex:number;serialCol:number;nameCol:number}|null=null;
    if(!info){
      const fallbackHeader=locateClientHeader(sheet.rows);
      if(fallbackHeader) info=fallbackHeader;
      else positionalLayout=clientDataPositionalLayout(sheet.rows);
    }

    let parsedByHeader=false;
    if(info){
      const headers=sheet.rows[info.index];
      const nameCol=findClientNameColumn(headers);
      // A false-positive header match should not prevent the positional
      // fallback from being attempted.
      if(nameCol>=0){
        parsedByHeader=true;
        const contactCol=findHeaderColumn(headers,["CONTACT PERSON","CONTACT"]);
        const categoryCol=findHeaderColumn(headers,["CUSTOMER CATEGORY","CATEGORY"]);
        const phoneCol=findHeaderColumn(headers,["PHONE NUMBER","PHONE","MOBILE NUMBER","MOBILE"]);
        const emailCol=findHeaderColumn(headers,["EMAIL ADDRESS","EMAIL"]);
        const locationCol=findHeaderColumn(headers,["LOCATION","ADDRESS"]);

        summary.sheets++;
        for(let i=info.index+1;i<sheet.rows.length;i++){
          summary.rows++;
          const row=sheet.rows[i];
          const name=text(row[nameCol]);
          if(!name){summary.skipped++;continue;}
          payloads.push({
            legacy_source_key:legacyClientKey(name),
            client_code:null,
            name,
            contact_person:contactCol>=0?text(row[contactCol])||null:null,
            category:categoryCol>=0?text(row[categoryCol])||null:null,
            phone:phoneCol>=0?text(row[phoneCol])||null:null,
            email:emailCol>=0?text(row[emailCol])||null:null,
            location:locationCol>=0?text(row[locationCol])||null:null
          });
        }
      }
    }

    if(!parsedByHeader){
      positionalLayout=positionalLayout || clientDataPositionalLayout(sheet.rows);
    }
    if(!parsedByHeader){
      const fallbackStart=positionalLayout?.startIndex??0;
      let importedFromRows=0;

      // Parse each row independently instead of assuming every legacy tab has
      // identical leading/index columns. Month-named tabs provide the final
      // contextual guard that these rows belong to Client Data.
      for(let i=fallbackStart;i<sheet.rows.length;i++){
        const parsed=parseClientDataRow(sheet.rows[i]);
        if(!parsed){
          summary.rows++;
          summary.skipped++;
          continue;
        }
        summary.rows++;
        importedFromRows++;
        payloads.push({
          legacy_source_key:legacyClientKey(parsed.name),
          client_code:null,
          name:parsed.name,
          contact_person:parsed.contact,
          category:parsed.category,
          phone:parsed.phone,
          email:parsed.email,
          location:parsed.location
        });
      }
      if(importedFromRows>0) summary.sheets++;
    }
  }
  if(!payloads.length){
    summary.errors.push("No client header/data rows were detected in the connected workbook.");
  }
  summary.imported=await upsertChunks(supabase,"clients",payloads,"legacy_source_key",summary.errors,"Client import");
  return summary;
}

async function importJobs(supabase:any,client:drive_v3.Drive,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"dailyJobListing",sheets:0,rows:0,imported:0,skipped:0,errors:[]}; const workbook=await loadDriveWorkbook(client,spreadsheetId); const clients=await clientLookup(supabase);
  const rawRows:{title:string;rowNumber:number;raw:Record<string,string>;fallbackDate:string|null}[]=[];
  const {data:profiles,error:pe}=await supabase.from("profiles").select("id,full_name"); if(pe)throw pe; const profileMap=new Map((profiles??[]).map((x:any)=>[norm(x.full_name),String(x.id)]));
  for(const sheet of workbook){const info=headerInfo(sheet.rows,expectedHeaders.dailyJobListing);if(!info)continue;summary.sheets++;const tabDate=parseDate(sheet.title);
    for(let i=info.index+1;i<sheet.rows.length;i++){summary.rows++;const raw=rowMap(sheet.rows[info.index],sheet.rows[i]);if(!raw["CLIENT NAMES"]){summary.skipped++;continue;}rawRows.push({title:sheet.title,rowNumber:i+1,raw,fallbackDate:tabDate});}}
  await ensureClientsBatch(supabase,rawRows.map(x=>x.raw["CLIENT NAMES"]),clients);
  const payloads=rawRows.map(x=>{const officerName=x.raw["TSS OFFICER"];return{legacy_source_key:sourceKey("dailyJobListing",x.title,x.rowNumber),job_id:"BB-LEGACY-"+(slug(x.title)||"TAB")+"-"+x.rowNumber,client_id:clients.get(norm(x.raw["CLIENT NAMES"]))||null,job_type:x.raw["INSURANCE/PERSONAL"]||null,number_of_vehicles:Math.max(1,Math.trunc(numeric(x.raw["NUMBERS OF JOB"]||x.raw["NUMBER OF JOB"]||x.raw["NUMBER OF JOBS"])||1)),vehicle_make:x.raw["VEHICLE MAKE"]||null,scheduled_date:parseDate(x.raw["DATE"],x.fallbackDate),scheduled_time:parseTime(x.raw["TIME"]),location:x.raw["LOCATION"]||null,tss_officer_id:profileMap.get(norm(officerName))||null,tss_officer_name:officerName||null};});
  summary.imported=await upsertChunks(supabase,"jobs",payloads,"legacy_source_key",summary.errors,"Job import");return summary;
}

async function importCompletions(supabase:any,client:drive_v3.Drive,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"dailyJobDone",sheets:0,rows:0,imported:0,skipped:0,errors:[]}; const payloads:any[]=[];
  for(const sheet of await loadDriveWorkbook(client,spreadsheetId)){const info=headerInfo(sheet.rows,expectedHeaders.dailyJobDone);if(!info)continue;summary.sheets++;const tabDate=parseDate(sheet.title);
    for(let i=info.index+1;i<sheet.rows.length;i++){summary.rows++;const raw=rowMap(sheet.rows[info.index],sheet.rows[i]);if(!raw["DEVICE ID"]&&!raw["NAME"]){summary.skipped++;continue;}payloads.push({legacy_source_key:sourceKey("dailyJobDone",sheet.title,i+1),device_id:raw["DEVICE ID"]||null,completion_date:parseDate(raw["DATE"],tabDate),installer:raw["INSTALLER NAME"]||null,location:raw["LOCATION"]||null,client:raw["NAME"]||null,vehicle_details:raw["VEH DETAILS"]||raw["VEHICLE DETAILS"]||null,vehicle_make:raw["VEH MAKE"]||null,status:raw["STATUS"]||"Completed",tss_officer:raw["TSS OFFICER"]||null});}}
  summary.imported=await upsertChunks(supabase,"job_completions",payloads,"legacy_source_key",summary.errors,"Daily Job Done import");return summary;
}

async function importStock(supabase:any,client:drive_v3.Drive,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"usedStock",sheets:0,rows:0,imported:0,skipped:0,errors:[]}; const payloads:any[]=[];
  for(const sheet of await loadDriveWorkbook(client,spreadsheetId)){const info=headerInfo(sheet.rows,expectedHeaders.usedStock);if(!info)continue;summary.sheets++;
    for(let i=info.index+1;i<sheet.rows.length;i++){summary.rows++;const raw=rowMap(sheet.rows[info.index],sheet.rows[i]);if(!raw["DEVICE ID"]&&!raw["SIM ID"]){summary.skipped++;continue;}payloads.push({legacy_source_key:sourceKey("usedStock",sheet.title,i+1),network:raw["NETWORK"]||null,device_type:raw["DEVICE TYPES"]||null,device_status:raw["DEVICE STATUS- USED / UNUSED-SIGHTED / UNUSED-UNSIGHTED; OTHERS"]||null,device_id:raw["DEVICE ID"]||null,sim_id:raw["SIM ID"]||null,date_collected:parseDate(raw["DATE COLLECTED"]),operations_remark:raw["OPS REMARK - RECEIVED OR NOT RECEIVED"]||null,operations_correction:raw["OPS CORRECTIONS - DEVICE & SIM"]||null,date_issued:parseDate(raw["DATE/MONTH ISSUED TO TECHNICIAN"]),date_installed:parseDate(raw["DATE INSTALLED"]),installer:raw["INSTALLER NAME"]||null,location:raw["LOCATION"]||null,client:raw["CLIENT NAME"]||null,vehicle_details:raw["VEHICLE DETAILS"]||raw["VEH DETAILS"]||null,vehicle_make:raw["VEHICLE MAKE"]||null,other_issues:raw["OTHER ISSUES"]||null});}}
  summary.imported=await upsertChunks(supabase,"stock_transactions",payloads,"legacy_source_key",summary.errors,"Used Stock import");return summary;
}

async function importCharges(supabase:any,client:drive_v3.Drive,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"miscellaneousCharges",sheets:0,rows:0,imported:0,skipped:0,errors:[]}; const clients=await clientLookup(supabase); const rawRows:{title:string;rowNumber:number;raw:Record<string,string>}[]=[];
  for(const sheet of await loadDriveWorkbook(client,spreadsheetId)){
    const detected=findChargeHeaderInfo(sheet.rows)
      || headerInfo(sheet.rows,expectedHeaders.miscellaneousCharges)
      || flexibleHeaderInfo(sheet.rows,["CUSTOMER CLIENT NAME","CLIENT NAME","CUSTOMER NAME","NAME","LOCATION","LOGISTICS","ACCOMMODATION","SWAP","SIM REPLACEMENT","OTHERS"],3);
    const fallback=(/SHEET1/i.test(sheet.title)||/MISC/i.test(sheet.title)||/CHARGE/i.test(sheet.title))?fallbackHeaderRow(sheet.rows,"charge"):-1;
    const info=detected|| (fallback>=0?{index:fallback,score:0}:null);
    if(!info)continue;summary.sheets++;
    for(let i=info.index+1;i<sheet.rows.length;i++){summary.rows++;const raw=rowMap(sheet.rows[info.index],sheet.rows[i]);const name=raw["CUSTOMER CLIENT NAME"]||raw["CUSTOMER/ CLIENT NAME"]||raw["CUSTOMER/CLIENT NAME"]||raw["CLIENT NAME"]||raw["NAME"];if(!name&&!raw["LOCATION"]){summary.skipped++;continue;}rawRows.push({title:sheet.title,rowNumber:i+1,raw});}}
  await ensureClientsBatch(supabase,rawRows.map(x=>x.raw["CUSTOMER/ CLIENT NAME"]||x.raw["CUSTOMER/CLIENT NAME"]||x.raw["CLIENT NAME"]),clients);
  const payloads=rawRows.map(x=>{const raw=x.raw;const name=raw["CUSTOMER/ CLIENT NAME"]||raw["CUSTOMER/CLIENT NAME"]||raw["CLIENT NAME"];return{legacy_source_key:sourceKey("miscellaneousCharges",x.title,x.rowNumber),charge_id:"BB-LEGACY-CHG-"+(slug(x.title)||"TAB")+"-"+x.rowNumber,client_id:clients.get(norm(name))||null,location:raw["LOCATION"]||null,logistics:numeric(raw["LOGISTICS"]),accommodation:numeric(raw["ACCOMMODATION"]),swap:numeric(raw["SWAP"]),deinstallation:numeric(raw["DEINSTALLATION"]),reinstallation:numeric(raw["REINSTALLATION"]),health_check:numeric(raw["HEALTH CHECK"]),sim_replacement:numeric(raw["SIM REPLACEMENT"]),others:numeric(raw["OTHERS"]),paid_or_approved:raw["PAID OR APPROVED"]||"Pending"};});
  summary.imported=await upsertChunks(supabase,"miscellaneous_charges",payloads,"legacy_source_key",summary.errors,"Miscellaneous Charges import");return summary;
}

async function importWeekly(supabase:any,client:drive_v3.Drive,spreadsheetId:string):Promise<ImportSummary>{
  const summary:ImportSummary={module:"techieWeeklyActivity",sheets:0,rows:0,imported:0,skipped:0,errors:[]}; const payloads:any[]=[];
  for(const sheet of await loadDriveWorkbook(client,spreadsheetId)){
    const weekRows=findWeeklyRows(sheet.rows);
    const headerCandidate=findWeeklyHeaderInfo(sheet.rows,weekRows[0]?.i??-1);
    const effectiveWeekRows=weekRows.length?weekRows:detectWeeklyRows(sheet.rows,headerCandidate);
    if(!effectiveWeekRows.length || headerCandidate<0) continue;

    const headers=sheet.rows[headerCandidate];
    const month=parseMonthTitle(sheet.rows[0]?.join(" ")||sheet.title);
    summary.sheets++;

    for(const item of effectiveWeekRows){
      const weekCell=item.r.find(cell=>isWeekLabel(cell));
      const weekNo=Math.max(1,Math.min(5,Number(text(weekCell).replace(/\D/g,""))||((item.i-headerCandidate))));
      const date=month
        ? new Date(Date.UTC(month.year,month.month-1,(weekNo-1)*7+1)).toISOString().slice(0,10)
        : parseDate(sheet.title);

      for(let col=1;col<headers.length;col++){
        const technician=text(headers[col]);
        if(!technician||norm(technician)==="TOTAL") continue;
        summary.rows++;
        const value=text(item.r[col]);
        if(!value){summary.skipped++;continue;}
        payloads.push({
          legacy_source_key:sourceKey("techieWeeklyActivity",sheet.title,(item.i+1)*1000+col),
          technician_name:technician,
          week_start:date,
          projects_completed:Math.max(0,Math.trunc(numeric(value))),
          vehicles_completed:0
        });
      }
    }
  }
  summary.imported=await upsertChunks(supabase,"technician_weekly_activity",payloads,"legacy_source_key",summary.errors,"Weekly Activity import");
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

export async function importLegacyGoogleModule(userId:string,module:string){
  const {supabase}=await getGoogleClientForUser(userId);
  const {data:connection,error}=await supabase.from("google_connections")
    .select("module,spreadsheet_id,active,sync_direction")
    .eq("module",module).eq("active",true).eq("sync_direction","platform_to_sheet").maybeSingle();
  if(error) throw error;
  if(!connection?.spreadsheet_id) throw new Error("No active Google connection configured for "+module+".");
  const client=(await getGoogleClientForUser(userId)).client;
  const drive=google.drive({version:"v3",auth:client});
  let summary:ImportSummary;
  if(module==="clientData") summary=await importClientData(supabase,drive,connection.spreadsheet_id);
  else if(module==="dailyJobListing") summary=await importJobs(supabase,drive,connection.spreadsheet_id);
  else if(module==="dailyJobDone") summary=await importCompletions(supabase,drive,connection.spreadsheet_id);
  else if(module==="usedStock") summary=await importStock(supabase,drive,connection.spreadsheet_id);
  else if(module==="miscellaneousCharges") summary=await importCharges(supabase,drive,connection.spreadsheet_id);
  else if(module==="techieWeeklyActivity") summary=await importWeekly(supabase,drive,connection.spreadsheet_id);
  else throw new Error("Unsupported legacy import module: "+module+".");
  const errorText=summary.errors.length?summary.errors.slice(0,10).join(" | "):null;
  await supabase.from("google_connections").update({last_error:errorText,updated_at:new Date().toISOString()}).eq("module",module);
  return summary;
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
