#!/usr/bin/env python3
"""Deploy a verified DavaQ release on its existing EC2 host.
Archives must be staged in /tmp: davaq-api-<revision>.tar.gz and davaq-web-<revision>.tar.gz.
No AnotherMe container, proxy configuration, volume or database is modified.
"""
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess, tarfile, time, tempfile, atexit
from urllib.parse import urlparse, unquote
p=argparse.ArgumentParser()
p.add_argument("--revision",required=True)
args=p.parse_args()
revision=args.revision
if not re.fullmatch(r"[0-9a-f]{40}",revision): raise RuntimeError("Expected a full Git revision")
root=pathlib.Path("/opt/davaq-release-20260912")
if root.resolve()!=root or not (root/"docker-compose.server.yml").is_file(): raise RuntimeError("Unexpected DavaQ release")
env_path=root/".env"
original=env_path.read_text()
env={}
for line in original.splitlines():
 if "=" in line and not line.startswith("#"):
  k,v=line.split("=",1);env[k]=v.strip().strip('"').strip("'")
url=urlparse(env.get("DATABASE_URL",""))
if url.path!="/davaq" or unquote(url.username or "")!="davaq": raise RuntimeError("Refusing a non-DavaQ database")
base_image=env.get("API_IMAGE","")
if not re.fullmatch(r"localhost:5000/davaq-api@sha256:[0-9a-f]{64}",base_image): raise RuntimeError("Unexpected base image")
compose=["docker","compose","-f",str(root/"docker-compose.server.yml")]
# Compose removes outer quotes; docker run --env-file does not. Normalize on the server only.
with tempfile.NamedTemporaryFile(mode="w",prefix=".davaq-runtime-",dir=root,delete=False) as runtime:
 for key,value in env.items():
  if "\n" in value or "\r" in value:raise RuntimeError("Unsupported multiline environment value")
  runtime.write(key+"="+value+"\n")
 runtime_env=pathlib.Path(runtime.name)
os.chmod(runtime_env,0o600)
atexit.register(lambda:runtime_env.unlink(missing_ok=True))
redactions=[v for v in env.values() if len(v)>8]+[unquote(url.password or "")]
def redact(value):
 for secret in sorted((v for v in redactions if v),key=len,reverse=True):value=value.replace(secret,"[REDACTED]")
 return value
def run(command,capture=False):
 result=subprocess.run(command,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if result.returncode:
  raise RuntimeError(redact(result.stdout+result.stderr)[-5000:])
 if not capture:print(redact(result.stdout+result.stderr),end="",flush=True)
 return result.stdout.strip() if capture else None
def extract(source,target):
 if target.exists(): raise RuntimeError("Release target already exists: "+str(target))
 target.mkdir(parents=True)
 boundary=str(target.resolve())+"/"
 with tarfile.open(source,"r:gz") as archive:
  for member in archive.getmembers():
   final=(target/member.name).resolve()
   if not (str(final).startswith(boundary) or final==target.resolve()) or member.issym() or member.islnk():
    raise RuntimeError("Unsafe archive member")
  archive.extractall(target)
api_root=pathlib.Path("/opt/davaq-api-mvp-"+revision[:12])
web_root=pathlib.Path("/opt/davaq-web-mvp-"+revision[:12])
extract(pathlib.Path("/tmp/davaq-api-"+revision+".tar.gz"),api_root)
extract(pathlib.Path("/tmp/davaq-web-"+revision+".tar.gz"),web_root)
web=web_root/"artifacts/mobile/web-build-mvp-20260912"
landing=web_root/"artifacts/landing/dist/public"
if not (web/"index.html").is_file() or not (landing/"index.html").is_file(): raise RuntimeError("Web release missing")
dockerfile=api_root/"Dockerfile"
dockerfile.write_text("FROM "+base_image+"\n"+
 "COPY artifacts/api-server/dist/ /app/artifacts/api-server/dist/\n"+
 "COPY lib/db/drizzle/ /app/lib/db/drizzle/\n"+
 "COPY lib/db/src/ /app/lib/db/src/\n"+
 "COPY lib/api-zod/src/ /app/lib/api-zod/src/\n"+
 "LABEL org.opencontainers.image.revision="+revision+"\n")
tag="localhost:5000/davaq-api:mvp-"+revision[:12]
run(["docker","build","-t",tag,str(api_root)])
run(["docker","push",tag])
digest=json.loads(run(["docker","image","inspect",tag],True))[0]["RepoDigests"]
image=next(v for v in digest if v.startswith("localhost:5000/davaq-api@sha256:"))
backup_root=pathlib.Path("/opt/davaq-backups")
backup_root.mkdir(exist_ok=True,mode=0o700)
backup=backup_root/("before-mvp-"+revision[:12]+".dump")
if backup.exists(): raise RuntimeError("Backup already exists")
env_backup=backup_root/("before-mvp-"+revision[:12]+".env")
shutil.copyfile(env_path,env_backup);os.chmod(env_backup,0o600)
# PostgreSQL 16 is already installed as an official Docker image on this host.
run(["docker","run","--rm","--network","davaq-prod_default","--env-file",str(runtime_env),
 "-v",str(backup_root)+":/backup","postgres:16","sh","-c",
 'exec pg_dump "$DATABASE_URL" --format=custom --file=/backup/'+backup.name])
os.chmod(backup,0o600)
if backup.stat().st_size<1000: raise RuntimeError("Database backup is unexpectedly small")
run(["docker","run","--rm","-v",str(backup_root)+":/backup:ro","postgres:16","pg_restore","--list","/backup/"+backup.name],True)
print("DavaQ database backup verified:",str(backup),flush=True)
# Additive migrations run before switching either service; old API remains compatible.
run(["docker","run","--rm","--network","davaq-prod_default","--env-file",str(runtime_env),
 "-e","PGOPTIONS=-c lock_timeout=5s -c statement_timeout=15min",image,"pnpm","--filter","@workspace/db","run","migrate"])
updates={"API_IMAGE":image,"PWA_WEB_ROOT":str(web),"LANDING_WEB_ROOT":str(landing)}
def update_env():
 lines=original.splitlines();seen=set();result=[]
 for line in lines:
  k=line.split("=",1)[0]
  if k in updates:result.append(k+"="+json.dumps(updates[k]));seen.add(k)
  else:result.append(line)
 for k,v in updates.items():
  if k not in seen:result.append(k+"="+json.dumps(v))
 env_path.write_text("\n".join(result)+"\n");os.chmod(env_path,0o600)
try:
 update_env()
 run(compose+["config","--quiet"])
 run(compose+["up","-d","--no-deps","--wait","app"])
 run(compose+["up","-d","--no-deps","--force-recreate","web"])
 for attempt in range(10):
  try:
   health=run(compose+["exec","-T","web","wget","-q","-O","-","http://127.0.0.1/api/healthz"],True)
   if json.loads(health).get("status")=="ok":break
  except (RuntimeError,ValueError):
   if attempt==9:raise
  time.sleep(2)
 if json.loads(health).get("status")!="ok":raise RuntimeError("DavaQ health verification failed")
except Exception:
 env_path.write_text(original);os.chmod(env_path,0o600)
 run(compose+["up","-d","--no-deps","--wait","app","web"])
 raise
manifest={"revision":revision,"image":image,"web":str(web),"landing":str(landing),"databaseBackup":str(backup),"environmentBackup":str(env_backup)}
(root/("mvp-release-"+revision[:12]+".json")).write_text(json.dumps(manifest,indent=2)+"\n")
print(json.dumps(manifest),flush=True)
