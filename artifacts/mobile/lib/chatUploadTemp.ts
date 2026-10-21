import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
const root = `${FileSystem.cacheDirectory}davaq-upload-previews/`;
export async function pruneChatUploadPreviews() {
  if (Platform.OS === "web" || !FileSystem.cacheDirectory) return;
  const info = await FileSystem.getInfoAsync(root);if(!info.exists)return;
  for (const name of await FileSystem.readDirectoryAsync(root)) {
    const uri=root+name, file=await FileSystem.getInfoAsync(uri);
    if(file.exists && !file.isDirectory && Date.now()-(file.modificationTime ?? 0)*1000 > 86400000) await FileSystem.deleteAsync(uri,{idempotent:true});
  }
}
export async function retainChatUploadPreview(uri: string) {
  if(Platform.OS === "web" || !FileSystem.cacheDirectory)return uri;
  await FileSystem.makeDirectoryAsync(root,{intermediates:true});
  const destination=root+`${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  await FileSystem.moveAsync({from:uri,to:destination});return destination;
}
export async function removeGeneratedMedia(uri: string) {
  if(Platform.OS !== "web") await FileSystem.deleteAsync(uri,{idempotent:true}).catch(()=>{});
}
