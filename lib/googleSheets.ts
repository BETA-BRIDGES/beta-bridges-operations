export const GOOGLE_SHEETS={
  dailyJobListing:{module:"Daily Job Listing",spreadsheetId:"12w7XVieA1GrHJU1oKAnvJjqNXwpew-Ue6qePxl1RBo",direction:"platform_to_sheet"},
  dailyJobDone:{module:"Daily Job Done",spreadsheetId:"1Uhm7XmqjXHFUqWA56-50rCiXtjO7w0s-Ncg3r5bkaJ0",direction:"platform_to_sheet"},
  usedStock:{module:"Used Stock",spreadsheetId:"1-MHhppys4-dlClRqOutjrOTllHooLZOr3f6FO56Sjn4",direction:"platform_to_sheet"},
  techieWeeklyActivity:{module:"Techie Weekly Activity",spreadsheetId:"1MG5B7JgXx-4mHalo1V1oe2CkWJR2Ruf5cHcNKtHiDqM",direction:"platform_to_sheet"},
  miscellaneousCharges:{module:"Miscellaneous Charges",spreadsheetId:"1AsVlHCHips4k5Y4yRWFFq_pV_EJYeE-1Ccwhn4c8OAQ",direction:"platform_to_sheet"},
  clientData:{module:"Client Data",spreadsheetId:"1HgF7uVBjbywDLRdbfLxONh8s-tuAJ7sej6-7apAS2wo",direction:"platform_to_sheet"}
} as const;

export type GoogleSheetModule=typeof GOOGLE_SHEETS[keyof typeof GOOGLE_SHEETS]["module"];

export const LEGACY_FIELD_RULES={
  dailyJobListing:{legacy:"NUMBER OF JOBS",platform:"number_of_vehicles",note:"The legacy field stores the number of vehicles covered by one project/assignment."},
  dailyJobDone:{legacy:"DEVICE ID",platform:"device_id",note:"The tracker/device unique identifier; separate from internal Job ID."}
} as const;
