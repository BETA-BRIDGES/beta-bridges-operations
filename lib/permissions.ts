export const ROLES=["Super Admin","Operations","TSS Officer","Field Technician","Finance","Viewer"] as const;
export type Role=(typeof ROLES)[number];

export const permissions:Record<string,Record<Role,string[]>>={
  "Daily Job Listing":{"Super Admin":["view","create","edit","assign","delete"],Operations:[],"TSS Officer":["view","create","edit"],"Field Technician":["view"],Finance:[],Viewer:["view"]},
  "Daily Job Done":{"Super Admin":["view","create","edit","delete"],Operations:["view","remark"],"TSS Officer":["view","create","edit"],"Field Technician":[],Finance:[],Viewer:["view"]},
  "Used Stock":{"Super Admin":["view","create","edit","delete"],Operations:["view","edit-except-device-sim-issue"],"TSS Officer":[],"Field Technician":[],Finance:["view","create","edit-device-sim-issue"],Viewer:["view"]},
  "Techie Weekly Activity":{"Super Admin":["view","create","edit","delete"],Operations:["view","create","edit"],"TSS Officer":[],"Field Technician":["view"],Finance:[],Viewer:["view"]},
  "Miscellaneous Charges":{"Super Admin":["view","create","edit","delete"],Operations:[],"TSS Officer":["view","create","edit","delete"],"Field Technician":[],Finance:["view","copy"],Viewer:["view"]},
  "Client Data":{"Super Admin":["view","create","edit","delete"],Operations:[],"TSS Officer":["view","create","edit","delete"],"Field Technician":[],Finance:[],Viewer:["view"]},
  "Tasks":{"Super Admin":["view","create","edit","assign","delete","notify"],Operations:[],"TSS Officer":[],"Field Technician":["view-assigned","comment","complete"],Finance:[],Viewer:["view"]}
};

const fieldRules:Record<string,Partial<Record<Role,{editable?:string[];readonly?:string[]}>>>={
  "Daily Job Listing":{"TSS Officer":{editable:["Job ID","NUMBER OF JOBS","Client","Date","TSS Officer","Status","Location","Vehicle Make","Priority","Description","Notes"],readonly:["Techie Assigned"]}},
  "Used Stock":{"Operations":{editable:["Network","Device Type","Device Status","Date Collected","Operations Remark","Operations Correction","Date Installed","Installer","Location","Client","Vehicle Details","Vehicle Make","Other Issues"],readonly:["Device ID","SIM ID","Date Issued"]},Finance:{editable:["Device ID","SIM ID","Date Issued"]}}
};

export function can(role:Role,module:string,action:string){
  if(role==="Super Admin") return true;
  const actions=permissions[module]?.[role]??[];
  if(actions.includes(action)) return true;
  if(action==="view" && actions.includes("view-assigned")) return true;
  if(action==="edit" && actions.some(a=>a.startsWith("edit-"))) return true;
  return false;
}
export function canCreate(role:Role,module:string){return can(role,module,"create")}
export function canCopy(role:Role,module:string){return can(role,module,"copy")}
export function canEditField(role:Role,module:string,field:string){
  if(role==="Super Admin") return true;
  const rule=fieldRules[module]?.[role];
  if(!rule) return can(role,module,"edit");
  if(rule.readonly?.includes(field)) return false;
  return rule.editable?.includes(field)===true;
}
export function getFieldRule(role:Role,module:string,field:string){
  return {editable:canEditField(role,module,field),readOnly:!canEditField(role,module,field)};
}
