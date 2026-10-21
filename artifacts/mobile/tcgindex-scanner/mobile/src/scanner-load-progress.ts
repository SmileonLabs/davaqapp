export type ScannerLoadProgress={stage:'checking'|'downloading'|'verifying'|'opening'|'ready'|'pricing';completedBytes:number;totalBytes:number;updating?:boolean};
export function scannerLoadPercent(progress:ScannerLoadProgress):number|null{
 if(progress.stage==='ready')return 100;
 if(progress.totalBytes<=0||!Number.isFinite(progress.totalBytes)||!Number.isFinite(progress.completedBytes))return null;
 return Math.round(Math.max(0,Math.min(1,progress.completedBytes/progress.totalBytes))*100);
}
