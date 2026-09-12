// Export the existing DavaQ vector mark; no generated character image is modified.
const fs=require('node:fs');const path=require('node:path');
const sharp=require(process.env.DAVAQ_SHARP_PATH||'sharp');
const root=path.resolve(__dirname,'..');
const svg=fs.readFileSync(path.resolve(root,'../landing/public/favicon.svg'));
async function main(){
 const dir=path.join(root,'assets/images/davaq');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'brand-mark.svg'),svg);
 for(const [file,size] of [['public/davaq-icon-192.png',192],['public/davaq-icon-512.png',512],['public/davaq-apple-touch-icon.png',180],['assets/images/davaq/brand-icon.png',1024]]){
  await sharp(svg,{density:600}).resize(size,size).flatten({background:'#6D4AFF'}).png().toFile(path.join(root,file));
 }
 const foreground=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g transform="translate(8 8) scale(.75)"><circle cx="30" cy="29" r="17" fill="none" stroke="white" stroke-width="7"/><path d="m38 39 12 12" stroke="white" stroke-width="7" stroke-linecap="round"/></g></svg>');
 await sharp(foreground,{density:1200}).resize(1024,1024).png().toFile(path.join(dir,'brand-foreground.png'));
 console.log('DavaQ vector mark exported to PWA and native icon sizes.');
}
main().catch(error=>{console.error(error.message);process.exit(1);});
