export const ROLES=["Super Admin","Operations","TSS Officer","Field Technician","Finance","Viewer"] as const;
export type Role=(typeof ROLES)[number];
export const permissions:Record<string,Record<Role,string[]>>={
"Daily Job Listing":{"Super Admin":["view","create","edit","assign","delete"],Operations:[],"TSS Officer":["view","create","edit"],"Field Technician":["view"],Finance:[],Viewer:["view"]},
"Daily Job Done":{"Super Admin":["view","create","edit","delete"],Operations:["view","remark"],"TSS Officer":["view","create","edit"],"Field Technician":[],Finance:[],Viewer:["view"]},
"Used Stock":{"Super Admin":["view","create","edit","delete"],Operations:["view","edit-except-device-sim-issue"],"TSS Officer":[],"Field Technician":[],Finance:["view","edit-device-sim-issue"],Viewer:["view"]},
"Techie Weekly Activity":{"Super Admin":["view","create","edit","delete"],Operations:["view","create","edit"],"TSS Officer":[],"Field Technician":["view"],Finance:[],Viewer:["view"]},
"Miscellaneous Charges":{"Super Admin":["view","create","edit","delete"],Operations:[],"TSS Officer":["view","create","edit","delete"],"Field Technician":[],Finance:["view","copy"],Viewer:["view"]},
"Client Data":{"Super Admin":["view","create","edit","delete"],Operations:[],"TSS Officer":["view","create","edit","delete"],"Field Technician":[],Finance:[],Viewer:["view"]},
"Tasks":{"Super Admin":["view","create","edit","assign","delete","notify"],Operations:[],"TSS Officer":[],"Field Technician":["view-assigned","comment","complete"],Finance:[],Viewer:["view"]}
};
export function can(role:Role,module:string,action:string){return role==="Super Admin"||permissions[module]?.[role]?.includes(action)===true}
