export function isValidPhone(value: string): boolean
export function isValidEmail(value: string): boolean
export function hasDuplicate(rows: Array<{phone:string;email:string}>, phone: string, email: string): boolean
export function makeReference(): string
export function makeTicketToken(): string
export function nextCheckIn(registration: {status:string;checkedIn?:string}, time?:string): {result:string;checkedIn?:string}
export function canDownloadTicket(registration: {status:string}): boolean
