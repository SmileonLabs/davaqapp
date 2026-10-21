import React from 'react';
import {AndroidCallControls} from './AndroidCallControls';
export function CallAudioOutput({callId}:{callId?:string}){return <AndroidCallControls callId={callId} controlsOnly onEnd={async()=>{}} onMute={async()=>{}}/>;}
