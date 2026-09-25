import crypto from "node:crypto";
import { google } from "googleapis";
import { getGoogleClientForUser, getServiceSupabase } from "./googleServer";
import { loadDriveWorkbook, importLegacyGoogleModule } from "./googleSheetsImport";
import { buildRows } from "./googleSheetsSync";

type SheetMeta={title:string;hidden?:boolean;sheetId?:number};
type Connection={module:string;spreadsheet_id:string;sheet_name:string|null;active:boolean};

const DATE_MODULES=new Set(["dailyJobListing","dailyJobDone","usedStock"]);
const ROW_ID_MODULES=new Set(["clientData","dailyJobListing","dailyJobDone","usedStock","miscellaneousCharges"]);

function text(value:unknown){return value==null?"":String(value);}
function col(n:number){let out="";while(n>0){const r=(n-1)%26;out=String.fromCharCode(65+r)+out;n=Math.floor((n-1)/26);}return out;}
function quoteSheetTitle(title:string){return `'${title.replace(/'/g,"''")}'`;}

function parseSheetDate(title:string,fallbackYear?:number){
  const s=title.trim().replace(/\\s+/g," ");
  const monthMap:Record<string,number>={JAN:1,JANUARY:1,FEB:2,FEBRUARY:2,MAR:3,MARCH:3,APR:4,APRIL:4,MAY:5,JUN:6,JUNE:6,JUL:7,JULY:7,AUG:8,AUGUST:8,SEP:9,SEPT:9,SEPTEMBER:9,OCT:10,OCTOBER:10,NOV:11,NOVEMBER:11,DEC:12,DECEMBER:12};
  let m=s.match(/^(\\d{1,2})[\\/.-](\\d{1,2})[\\/.-](\\d{4})$/);
  if(m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  m=s.match(/^(\\d{4})[\\/.-](\\d{1,2})[\\/.-](\\d{1,2})$/);
  if(m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  m=s.match(/^([A-Za-z]+)[\\s-]*(\\d{1,2})(?:ST|ND|RD|TH)?$/i);
  if(m){
    const month=monthMap[m[1].toUpperCase()];
    if(month && fallbackYear) return String(fallbackYear)+"-"+String(month).padStart(2,"0")+"-"+m[2].padStart(2,"0");
  }
  return null;
}

function preferredSheet(module:string,items:SheetMeta[]){
  const visible=items.filter(x=>!x.hidden);
  const exact=visible.find(x=>x.title==="Sheet1");
  if(exact) return exact.title;
  const keywords:Record<string,string[]>={miscellaneousCharges:["MISCELLANEOUS","CHARGE"],clientData:["CLIENT"],techieWeeklyActivity:["TECHIE","WEEKLY"]};
  const hit=visible.find(x=>keywords[module]?.some(k=>x.title.toUpperCase().includes(k)));
  if(hit) return hit.title;
  return visible[0]?.title||null;
}

async function listSheets(sheets:any,spreadsheetId:string):Promise<SheetMeta[]>{
  const {data,error}=await sheets.spreadsheets.get({spreadsheetId,fields:"sheets(properties(sheetId,title,hidden,index))"});
  if(error) throw error;
  return (data.sheets??[]).map((x:any)=>x.properties).filter((x:any)=>x?.title).map((x:any)=>({title:String(x.title),hidden:Boolean(x.hidden),sheetId:Number(x.sheetId)}));
}

async function ensureSheet(sheets:any,spreadsheetId:string,items:SheetMeta[],title:string){
  const existing=items.find(x=>x.title===title);
  if(existing) return existing;
  const {data,error}=await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:[{addSheet:{properties:{title}}}]}});
  if(error) throw error;
  const props=data.replies?.[0]?.addSheet?.properties;
  const created={title,hidden:false,sheetId:Number(props?.sheetId)};
  items.push(created);
  return created;
}

function canonicalRows(rows:any[][]){
  return rows.map(row=>row.map(v=>text(v).trim()).reduce((acc:string[],v:string)=>{acc.push(v);return acc},[]));
}
function hashPayload(value:unknown){
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function selectAllRows(supabase:any,table:string,columns:string,refine?:(q:any)=>any){
  const all:any[]=[];const size=1000;
  for(let from=0;;from+=size){
    let q=supabase.from(table).select(columns).range(from,from+size-1);
    if(refine) q=refine(q);
    const {data,error}=await q;if(error) throw error;
    all.push(...(data??[]));
    if(!data||data.length<size) break;
  }
  return all;
}

async function platformSnapshot(module:string,supabase:any,tabs:SheetMeta[]){
  if(DATE_MODULES.has(module)){
    const meta=module==="dailyJobListing"?{table:"jobs",field:"scheduled_date"}:module==="dailyJobDone"?{table:"job_completions",field:"completion_date"}:{table:"stock_transactions",field:"date_installed"};
    const rows=await selectAllRows(supabase,meta.table,meta.field,(q:any)=>q.not(meta.field,"is",null));
    const dates=Array.from(new Set(rows.map((x:any)=>String(x[meta.field]).slice(0,10)).filter(x=>/^\\d{4}-\\d{2}-\\d{2}$/.test(x)))).sort();
    const fallbackYear=dates.length?Number(dates[0].slice(0,4)):new Date().getFullYear();
    const parsed=tabs.map(x=>({title:x.title,date:parseSheetDate(x.title,fallbackYear)})).filter(x=>x.date) as {title:string;date:string}[];
    const allDates=Array.from(new Set([...parsed.map(x=>x.date),...dates])).sort();
    const entries:any[]=[];
    for(const date of allDates){
      let target=parsed.find(x=>x.date===date);
      if(!target) target={title:legacyTitleFromDate(date),date};
      const built=await buildRows(module,supabase,date);
      entries.push([target.title,canonicalRows(built as any[][])]);
    }
    return entries.sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  }
  const target=tabs.find(x=>x.title===preferredSheet(module,tabs));
  const built=await buildRows(module,supabase);
  return [[target?.title||preferredSheet(module,tabs)||"Sheet1",canonicalRows(built as any[][])]];
}

function legacyTitleFromDate(date:string){
  const d=new Date(date+"T00:00:00Z");
  const months=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEPT","OCT","NOV","DEC"];
  const day=d.getUTCDate();
  const suffix=day%10===1&&day%100!==11?"ST":day%10===2&&day%100!==12?"ND":day%10===3&&day%100!==13?"RD":"TH";
  return months[d.getUTCMonth()]+"-"+day+suffix;
}

function relevantSheetRows(module:string,workbook:{title:string;rows:string[][]}[],tabs:SheetMeta[]){
  if(DATE_MODULES.has(module)){
    const parsed=workbook
      .filter(s=>parseSheetDate(s.title,new Date().getFullYear()))
      .map(s=>[s.title,canonicalRows(s.rows as any[][])]);
    return parsed.sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  }
  const target=preferredSheet(module,tabs);
  const sheet=workbook.find(x=>x.title===target)||workbook[0];
  return sheet?[[sheet.title,canonicalRows(sheet.rows as any[][])]]:[];
}

async function sheetSnapshot(module:string,workbook:any[],tabs:SheetMeta[]){
  return hashPayload(relevantSheetRows(module,workbook,tabs));
}

async function platformHash(module:string,supabase:any,tabs:SheetMeta[]){
  return hashPayload(await platformSnapshot(module,supabase,tabs));
}

async function writeRows(sheets:any,spreadsheetId:string,sheet:SheetMeta,rows:any[][],hideHelper:boolean){
  const width=rows.reduce((m,row)=>Math.max(m,Array.isArray(row)?row.length:0),0);
  if(!width||!rows.length) return;
  const range=quoteSheetTitle(sheet.title)+"!A1:"+col(width)+rows.length;
  await sheets.spreadsheets.values.clear({spreadsheetId,range:quoteSheetTitle(sheet.title)});
  await sheets.spreadsheets.values.update({spreadsheetId,range,valueInputOption:"USER_ENTERED",requestBody:{values:rows}});
  if(hideHelper && sheet.sheetId){
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody:{requests:[{updateDimensionProperties:{
        range:{sheetId:sheet.sheetId,dimension:"COLUMNS",startIndex:width-1,endIndex:width},
        properties:{hidden:true},
        fields:"hidden"
      }}]}
    });
  }
}

async function exportModule(userId:string,module:string,connection:Connection){
  const {supabase,client}=await getGoogleClientForUser(userId);
  const sheets=google.sheets({version:"v4",auth:client});
  const tabs=await listSheets(sheets,connection.spreadsheet_id);
  let rowsWritten=0;

  if(DATE_MODULES.has(module)){
    const meta=module==="dailyJobListing"?{table:"jobs",field:"scheduled_date"}:module==="dailyJobDone"?{table:"job_completions",field:"completion_date"}:{table:"stock_transactions",field:"date_installed"};
    const dateRows=await selectAllRows(supabase,meta.table,meta.field,(q:any)=>q.not(meta.field,"is",null));
    const dates=Array.from(new Set(dateRows.map((x:any)=>String(x[meta.field]).slice(0,10)).filter(x=>/^\\d{4}-\\d{2}-\\d{2}$/.test(x)))).sort();
    const fallbackYear=dates.length?Number(dates[0].slice(0,4)):new Date().getFullYear();
    const known=tabs.map(x=>({tab:x,date:parseSheetDate(x.title,fallbackYear)})).filter(x=>x.date);
    for(const date of dates){
      let match=known.find(x=>x.date===date);
      if(!match){
        const created=await ensureSheet(sheets,connection.spreadsheet_id,tabs,legacyTitleFromDate(date));
        match={tab:created,date};
        known.push(match);
      }
      const built=await buildRows(module,supabase,date);
      await writeRows(sheets,connection.spreadsheet_id,match.tab,built as any[][],true);
      rowsWritten+=Math.max(0,built.length-1);
    }
  }else{
    const sheetName=connection.sheet_name||preferredSheet(module,tabs);
    if(!sheetName) throw new Error("No target worksheet could be resolved.");
    const sheet=await ensureSheet(sheets,connection.spreadsheet_id,tabs,sheetName);
    const built=await buildRows(module,supabase);
    await writeRows(sheets,connection.spreadsheet_id,sheet,built as any[][],ROW_ID_MODULES.has(module));
    rowsWritten=Math.max(0,built.length-1);
  }

  const timestamp=new Date().toISOString();
  await supabase.from("google_connections").update({last_sync_at:timestamp,last_error:null,updated_at:timestamp}).eq("module",module);
  return rowsWritten;
}

export async function syncGoogleSheetsBidirectional(userId:string){
  const {supabase,client}=await getGoogleClientForUser(userId);
  const drive=google.drive({version:"v3",auth:client});
  const sheets=google.sheets({version:"v4",auth:client});
  const {data:connections,error}=await supabase.from("google_connections")
    .select("module,spreadsheet_id,sheet_name,active,sync_direction")
    .eq("active",true)
    .in("sync_direction",["platform_to_sheet","bidirectional"]);
  if(error) throw error;

  const results:Record<string,any>={};
  for(const connection of (connections??[]) as Connection[]){
    const module=connection.module;
    try{
      let tabs=await listSheets(sheets,connection.spreadsheet_id);
      let workbook=await loadDriveWorkbook(drive,connection.spreadsheet_id);
      let shHash=await sheetSnapshot(module,workbook,tabs);
      let phHash=await platformHash(module,supabase,tabs);

      const {data:state,error:stateError}=await supabase.from("google_sync_states")
        .select("last_sheet_hash,last_platform_hash,last_direction,conflict_count")
        .eq("module",module).eq("spreadsheet_id",connection.spreadsheet_id).eq("sheet_scope","ALL").maybeSingle();
      if(stateError) throw stateError;

      let direction:"bootstrap"|"sheet_to_platform"|"platform_to_sheet"|"conflict"|"noop"="noop";

      if(!state){
        await importLegacyGoogleModule(userId,module);
        await exportModule(userId,module,connection);
        direction="bootstrap";
      }else if(shHash===state.last_sheet_hash && phHash===state.last_platform_hash){
        direction="noop";
      }else if(shHash!==state.last_sheet_hash && phHash===state.last_platform_hash){
        await importLegacyGoogleModule(userId,module);
        await exportModule(userId,module,connection);
        direction="sheet_to_platform";
      }else if(shHash===state.last_sheet_hash && phHash!==state.last_platform_hash){
        await exportModule(userId,module,connection);
        direction="platform_to_sheet";
      }else{
        const conflictCount=Number(state.conflict_count||0)+1;
        await supabase.from("google_sync_states").upsert({
          module,spreadsheet_id:connection.spreadsheet_id,sheet_scope:"ALL",
          last_sheet_hash:shHash,last_platform_hash:phHash,last_sync_at:new Date().toISOString(),
          last_direction:"conflict",
          last_error:"Both the platform and legacy sheet changed since the last synchronized state. Automatic overwrite was blocked.",
          conflict_count:conflictCount,
          updated_at:new Date().toISOString()
        },{onConflict:"module,spreadsheet_id,sheet_scope"});
        await supabase.from("google_connections").update({
          last_error:"Sync conflict: both platform and legacy sheet changed since the last synchronized state.",
          updated_at:new Date().toISOString()
        }).eq("module",module);
        results[module]={ok:false,rows:0,direction:"conflict",error:"Both sides changed since the last synchronization; automatic overwrite was blocked."};
        continue;
      }

      tabs=await listSheets(sheets,connection.spreadsheet_id);
      workbook=await loadDriveWorkbook(drive,connection.spreadsheet_id);
      shHash=await sheetSnapshot(module,workbook,tabs);
      phHash=await platformHash(module,supabase,tabs);
      const now=new Date().toISOString();
      const {data:currentState}=await supabase.from("google_sync_states").select("conflict_count").eq("module",module).eq("spreadsheet_id",connection.spreadsheet_id).eq("sheet_scope","ALL").maybeSingle();
      await supabase.from("google_sync_states").upsert({
        module,spreadsheet_id:connection.spreadsheet_id,sheet_scope:"ALL",
        last_sheet_hash:shHash,last_platform_hash:phHash,last_sync_at:now,last_direction:direction,last_error:null,
        conflict_count:Number(currentState?.conflict_count||0),updated_at:now
      },{onConflict:"module,spreadsheet_id,sheet_scope"});

      results[module]={ok:true,rows:0,direction};
    }catch(error){
      const message=error instanceof Error?error.message:"Bidirectional sync failed.";
      await supabase.from("google_connections").update({last_error:message,updated_at:new Date().toISOString()}).eq("module",module);
      results[module]={ok:false,rows:0,error:message};
    }
  }
  return results;
}

export async function runScheduledGoogleBidirectionalSync(){
  const supabase=getServiceSupabase();
  const {data:profiles,error:pe}=await supabase.from("profiles").select("id,role,active,created_at").eq("role","Super Admin").eq("active",true).order("created_at",{ascending:true}).limit(10);
  if(pe) throw pe;
  if(!profiles?.length) throw new Error("No active Super Admin account is available for scheduled Google Sheets sync.");
  const {data:tokenRows,error:te}=await supabase.from("google_oauth_tokens").select("user_id").in("user_id",profiles.map((p:any)=>p.id));
  if(te) throw te;
  const tokenUserIds=new Set((tokenRows??[]).map((x:any)=>String(x.user_id)));
  const owner=profiles.find((p:any)=>tokenUserIds.has(String(p.id)));
  if(!owner) throw new Error("No active Super Admin has a connected Google account for scheduled synchronization.");
  return syncGoogleSheetsBidirectional(String(owner.id));
}
