import React,{forwardRef,useMemo} from 'react';
import {Camera,type CameraRef,type CameraOutput} from 'react-native-vision-camera';
import {NitroModules} from 'react-native-nitro-modules';
// A native output joins the Camera component's existing preview session.
export const IOSScannerCamera=forwardRef<CameraRef,React.ComponentProps<typeof Camera>>(function IOSScannerCamera(props,ref){
 const output=useMemo(()=>NitroModules.createHybridObject<CameraOutput>('TCGNativeCameraOutput'),[]);
 const outputs=useMemo(()=>[output],[output]);
 return <Camera {...props} ref={ref} outputs={outputs}/>;
});
