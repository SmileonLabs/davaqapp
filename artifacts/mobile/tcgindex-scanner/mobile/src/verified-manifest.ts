import type {File} from 'expo-file-system';

/** Keep the last usable manifest recoverable across a failed move or app exit. */
export async function replaceVerifiedManifest(current:()=>File,pending:File,previous:()=>File){
 // Expo File.move changes the source object's URI. Reopen path handles after
 // each move instead of accidentally publishing into the backup path.
 if(current().exists){
  if(previous().exists)previous().delete();
  await current().move(previous());
 }
 try{await pending.move(current());}
 catch(error){
  if(!current().exists&&previous().exists)await previous().move(current());
  throw error;
 }
}

export async function recoverVerifiedManifest(current:()=>File,previous:()=>File){
 if(!current().exists&&previous().exists)await previous().move(current());
}
