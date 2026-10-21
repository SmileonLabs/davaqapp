type ZoomController={minZoom:number;maxZoom:number;setZoom:(value:number)=>Promise<void>};
export function isInactiveCameraError(error:unknown):boolean {
 return /Camera is not active|Camera is not yet ready|Camera Preview is not yet ready/i.test(String(error));
}
export function isRecoverableCameraError(error:unknown):boolean {
 return /Camera is disabled|Camera device is already in use|maximum number of open cameras|Camera has been removed|Encountered a fatal Camera|unknown recoverable error|Camera is not active/i.test(String(error));
}
// A configured controller can exist before CameraX starts streaming.
export async function applyCameraZoom(controller:ZoomController|undefined,zoom:number,isCurrent:()=>boolean):Promise<boolean>{
 if(!controller||!isCurrent())return false;
 try{await controller.setZoom(Math.max(controller.minZoom,Math.min(controller.maxZoom,zoom)));return isCurrent();}
 catch(error){if(!isCurrent()||isInactiveCameraError(error))return false;throw error;}
}
