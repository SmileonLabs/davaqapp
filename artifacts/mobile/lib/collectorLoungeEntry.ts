import AsyncStorage from '@react-native-async-storage/async-storage';
const key='davaq.pending-collector-lounge.v1';
export async function saveCollectorLoungeEntry(){await AsyncStorage.setItem(key,String(Date.now()));}
export async function hasCollectorLoungeEntry(){const at=Number(await AsyncStorage.getItem(key));return Number.isFinite(at)&&at>0&&Date.now()>=at&&Date.now()-at<30*60*1000;}
export async function clearCollectorLoungeEntry(){await AsyncStorage.removeItem(key);}
