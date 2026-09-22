#!/usr/bin/env python3
"""Run the DavaQ integration bundle in a disposable PostgreSQL schema."""
import json, os, pathlib, subprocess, tarfile, tempfile
from urllib.parse import urlparse,unquote
app=json.loads(subprocess.check_output(["docker","inspect","davaq-prod-app-1"],text=True))[0]
env=dict(v.split("=",1) for v in app["Config"]["Env"] if "=" in v)
url=env["DATABASE_URL"];parsed=urlparse(url)
if parsed.path!="/davaq" or unquote(parsed.username or "")!="davaq":raise RuntimeError("Not the DavaQ database")
image=app["Image"]
allowed={"test.mjs","0029_davaq_exchange.sql","0030_davaq_media_learning.sql","0031_davaq_request_keys.sql","0032_davaq_operational_state.sql","0033_davaq_brand_exchange.sql","0034_davaq_chat_transport.sql"}
with tempfile.TemporaryDirectory(prefix="davaq-brand-it-",dir="/tmp") as folder:
 root=pathlib.Path(folder)
 with tarfile.open("/tmp/davaq-brand-integration.tar.gz","r:gz") as tar:
  for member in tar.getmembers():
   if member.name not in allowed or not member.isfile():raise RuntimeError("Unexpected test bundle member")
  tar.extractall(root,filter="data")
 runtime=root/"runtime.env"
 runtime.write_text("DATABASE_URL="+url+"\nNODE_ENV=production\n")
 os.chmod(runtime,0o600)
 result=subprocess.run(["docker","run","--rm","--network","davaq-prod_default","--memory","384m","--cpus","0.5","--env-file",str(runtime),"-v",str(root)+":/test:ro","--entrypoint","node",image,"--max-old-space-size=300","/test/test.mjs"],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 output=result.stdout.replace(url,"[DATABASE_URL]").replace(unquote(parsed.password or ""),"[REDACTED]")
 print(output,flush=True)
 if result.returncode:raise SystemExit(result.returncode)
