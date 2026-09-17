export const GOOGLE_SHEETS={
  dailyJobListing:{module:"Daily Job Listing",spreadsheetId:"12w7XVieA1GrHJU1oKAnvJjqNXwpew-Ue6qePxl1RBo",sheetName:"DAILY JOB LISTING",direction:"platform_to_sheet"},
  dailyJobDone:{module:"Daily Job Done",spreadsheetId:"1Uhm7XmqjXHFUqWA56-50rCiXtjO7w0s-Ncg3r5bkaJ0",sheetName:"DAILY JOB DONE",direction:"platform_to_sheet"},
  usedStock:{module:"Used Stock",spreadsheetId:"1-MHhppys4-dlClRqOutjrOTllHooLZOr3f6FO56Sjn4",sheetName:"2026 USED STOCK",direction:"platform_to_sheet"},
  techieWeeklyActivity:{module:"Techie Weekly Activity",spreadsheetId:"1MG5B7JgXx-4mHalo1V1oe2CkWJR2Ruf5cHcNKtHiDqM",sheetName:"TECHIE WEEKLY ACTIVITY REPORT",direction:"platform_to_sheet"},
  miscellaneousCharges:{module:"Miscellaneous Charges",spreadsheetId:"1AsVlHCHips4k5Y4yRWFFq_pV_EJYeE-1Ccwhn4c8OAQ",sheetName:"MISCELLANEOUS CHARGES",direction:"platform_to_sheet"},
  clientData:{module:"Client Data",spreadsheetId:"1HgF7uVBjbywDLRdbfLxONh8s-tuAJ7sej6-7apAS2wo",sheetName:"CLIENT CONTACT DATA",direction:"platform_to_sheet"}
} as const;

export type GoogleSheetModule=typeof GOOGLE_SHEETS[keyof typeof GOOGLE_SHEETS]["module"];

export const LEGACY_FIELD_RULES={
  dailyJobListing:{
    headers:["CLIENT NAMES","INSURANCE/PERSONAL","NUMBERS OF JOB","VEHICLE MAKE","TIME","LOCATION","TSS OFFICER"],
    mapping:{"CLIENT NAMES":"client","INSURANCE/PERSONAL":"job_type","NUMBERS OF JOB":"number_of_vehicles","VEHICLE MAKE":"vehicle_make","TIME":"scheduled_date_or_time","LOCATION":"location","TSS OFFICER":"tss_officer"},
    notes:["NUMBERS OF JOB is the number of vehicles covered by one project/assignment, not the number of separate Job IDs."]
  },
  dailyJobDone:{
    headers:["DEVICE ID","DATE","INSTALLER NAME","LOCATION","NAME","VEH DETAILS","VEH MAKE","STATUS","TSS OFFICER"],
    mapping:{"DEVICE ID":"device_id","DATE":"completion_date","INSTALLER NAME":"installer","LOCATION":"location","NAME":"client","VEH DETAILS":"vehicle_details","VEH MAKE":"vehicle_make","STATUS":"status","TSS OFFICER":"tss_officer"},
    notes:["DEVICE ID is the unique tracker/device identifier and is separate from internal Job ID."]
  },
  usedStock:{
    headers:["NETWORK","DEVICE TYPES","DEVICE STATUS- USED / UNUSED-SIGHTED / UNUSED-UNSIGHTED; OTHERS","DEVICE ID","SIM ID","DATE COLLECTED","OPS REMARK - RECEIVED OR NOT RECEIVED","OPS CORRECTIONS - DEVICE & SIM","DATE/MONTH ISSUED TO TECHNICIAN","DATE INSTALLED","INSTALLER NAME","LOCATION","CLIENT NAME","VEHICLE DETAILS","VEHICLE MAKE","OTHER ISSUES"],
    mapping:{"NETWORK":"network","DEVICE TYPES":"device_type","DEVICE STATUS- USED / UNUSED-SIGHTED / UNUSED-UNSIGHTED; OTHERS":"device_status","DEVICE ID":"device_id","SIM ID":"sim_id","DATE COLLECTED":"date_collected","OPS REMARK - RECEIVED OR NOT RECEIVED":"operations_remark","OPS CORRECTIONS - DEVICE & SIM":"operations_correction","DATE/MONTH ISSUED TO TECHNICIAN":"date_issued","DATE INSTALLED":"date_installed","INSTALLER NAME":"installer","LOCATION":"location","CLIENT NAME":"client","VEHICLE DETAILS":"vehicle_details","VEHICLE MAKE":"vehicle_make","OTHER ISSUES":"other_issues"}
  },
  miscellaneousCharges:{
    headers:["S/N","CUSTOMER/ CLIENT NAME","LOCATION","LOGISTICS","ACCOMMODATION","SWAP","DEINSTALLATION","REINSTALLATION","HEALTH CHECK","SIM REPLACEMENT","OTHERS","PAID OR APPROVED"],
    mapping:{"S/N":"charge_sequence","CUSTOMER/ CLIENT NAME":"client","LOCATION":"location","LOGISTICS":"logistics","ACCOMMODATION":"accommodation","SWAP":"swap","DEINSTALLATION":"deinstallation","REINSTALLATION":"reinstallation","HEALTH CHECK":"health_check","SIM REPLACEMENT":"sim_replacement","OTHERS":"others","PAID OR APPROVED":"paid_or_approved"}
  },
  clientData:{
    headers:["S/N","CUSTOMER/CLIENT NAME","CONTACT PERSON","CUSTOMER CATEGORY","PHONE NUMBER","EMAIL ADDRESS","LOCATION"],
    mapping:{"S/N":"client_sequence","CUSTOMER/CLIENT NAME":"name","CONTACT PERSON":"contact_person","CUSTOMER CATEGORY":"category","PHONE NUMBER":"phone","EMAIL ADDRESS":"email","LOCATION":"location"}
  },
  techieWeeklyActivity:{
    titleCell:"TECHIE WEEKLY ACTIVITIES FOR AUGUST 2026",
    weekRows:["WEEK 1","WEEK 2","WEEK 3","WEEK 4","WEEK 5","TOTAL"],
    technicians:["BENJAMIN","GOKE","MICHAEL","SAMSON","SUNDAY","SYLVESTER","MALIK","JOSEPH","ISAAC","PATRICK","EMMANUEL","SHAMSUDEEN","JEREMIAH","MUTIU","AHMED","SEUN","AINA","FAVOUR"],
    totalColumn:"TOTAL",
    notes:["Weekly technician activity should be derived from completed operational work where practical, then exported into the legacy matrix format."]
  }
} as const;
