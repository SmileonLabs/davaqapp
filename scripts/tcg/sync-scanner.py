"""Import TCGIndex scanner sources, preserving recognition algorithms."""
from pathlib import Path
import hashlib,json,re,shutil,sys
source=Path(sys.argv[1]).resolve();root=Path(__file__).resolve().parents[2]
dest=root/'artifacts/mobile/tcgindex-scanner';mobile=source/'apps/mobile'
queue=[mobile/'src/app/ScannerScreen.tsx',mobile/'src/NativeLiveScannerAndroid.tsx',mobile/'tests/scanner.test.ts',mobile/'tests/scanner-live-price.test.ts',mobile/'tests/scanner-load-progress.test.ts'];seen=set();manifest=[]
adapters={'src/app/api.ts','src/app/Localized.tsx','src/app/InterfaceIcon.tsx','src/app/scanner-cache.ts'}
while queue:
 p=queue.pop().resolve()
 if p in seen:continue
 seen.add(p)
 if str(p).startswith(str(mobile)) and str(p.relative_to(mobile)) in adapters:continue
 text=p.read_text();out=dest/p.relative_to(source/'apps')
 for name in re.findall(r'(?:from\s*|import\s*\(|require\s*\()\s*[\'\"]([^\'\"]+)',text):
  if not name.startswith('.'):continue
  base=(p.parent/name).resolve();candidate=next((v for v in [base]+[Path(str(base)+s) for s in ['.ts','.tsx','.json','.js']] if v.is_file()),None)
  if candidate:
   if candidate.suffix in ['.ts','.tsx','.js','.json']:queue.append(candidate)
   else:
    target=dest/candidate.relative_to(source/'apps');target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(candidate,target)
 out.parent.mkdir(parents=True,exist_ok=True)
 if p.name in ['useCompactScannerLibrary.ts','visual-cache.ts']:
  text=text.replace('await pending.move(file,{overwrite:true})','if(file.exists)file.delete();await pending.move(file)').replace('await pending.move(manifest,{overwrite:true})','if(manifest.exists)manifest.delete();await pending.move(manifest)')
 if p.name=='visual-cache.ts':
  text=text.replace('pending.create({overwrite:true});\n      for(const chunk', 'pending.create({overwrite:true});\n      const handle=pending.open();try{for(const chunk').replace('pending.write(chunk,{append:true});','handle.writeBytes(new TextEncoder().encode(chunk));').replace('await new Promise<void>(resolve=>setTimeout(resolve,0));\n      }','await new Promise<void>(resolve=>setTimeout(resolve,0));\n      }}finally{handle.close();}')
 if p.name=='catalog.ts':text=text.replace("process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://tcgindex.org'", "process.env.EXPO_PUBLIC_TCGINDEX_ORIGIN ?? 'https://tcgindex.org'")
 if p.name=='ScannerScreen.tsx':text=(root/'scripts/tcg/ScannerScreen.native.tsx').read_text()
 out.write_text(text)
 manifest.append({'source':str(p.relative_to(source)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'destination':str(out.relative_to(root))})
for folder in ['native-scanner','plugins/android','plugins/ios']:
 for p in (mobile/folder).rglob('*'):
  if not p.is_file() or any(v in p.parts for v in ['build','.gradle','.cxx','node_modules']):continue
  out=dest/'mobile'/p.relative_to(mobile);out.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,out)
  manifest.append({'source':str(p.relative_to(source)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'destination':str(out.relative_to(root))})
for filename in ['with-scanner-android.cjs','with-scanner-ios.cjs']:
 p=mobile/'plugins'/filename;text=p.read_text()
 if filename.endswith('android.cjs'):
  text=text.replace("'../native-scanner/android'","'../tcgindex-scanner/mobile/native-scanner/android'").replace("'app/src/main/java/org/tcgindex/scanner'", "'app/src/main/java/'+config.android.package.replace(/\\./g,'/')")
  text=text.replace('const { mkdirSync, copyFileSync }', 'const { mkdirSync, copyFileSync, readFileSync, writeFileSync }')
  text=text.replace('return config;\n  }]);', "for(const f of ['CardTextModule.kt','CardQuadDetector.kt','CardOutlineView.kt','CardVisionModule.kt']){const p=join(folder,f);writeFileSync(p,readFileSync(p,'utf8').replace('package org.tcgindex.scanner','package '+config.android.package));}\n    return config;\n  }]);")
 else:
  text=text.replace("'native-scanner/android/src/main/cpp/third-party/usearch'", "'tcgindex-scanner/mobile/native-scanner/android/src/main/cpp/third-party/usearch'").replace('../plugins/ios/TCGOpenCV.podspec','../tcgindex-scanner/mobile/plugins/ios/TCGOpenCV.podspec')
 (dest/'mobile/plugins'/filename).write_text(text)
(dest/'provenance.json').write_text(json.dumps({'provider':'TCGIndex','files':manifest},indent=2)+'\n')
print('Imported',len(manifest),'scanner source files; card data remains remote.')
