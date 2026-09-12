import { execFileSync } from "node:child_process";
import {readFileSync} from "node:fs";

const forbidden = [
  /(^|\/)google-services\.json$/i,
  /(^|\/)\.env(?:\.|$)/i,
  /\.(?:pem|keystore|jks)$/i,
];

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const template=".env.docker.example";
const violations = tracked.filter((file) => file!==template && forbidden.some((pattern) => pattern.test(file)));
if(tracked.includes(template)){
 const source=readFileSync(template,"utf8");
 const privateValue=/^[A-Z0-9_]*(?:SECRET|API_KEY|ACCESS_KEY_ID|PRIVATE_KEY|PASSWORD|DATABASE_URL|FIREBASE_SERVICE_ACCOUNT)[A-Z0-9_]*=[\t ]*\S+/m;
 if(privateValue.test(source))violations.push(template+" (credential fields must be empty)");
}

if (violations.length > 0) {
  console.error("금지된 로컬 전용 파일이 Git에 추적되고 있습니다:");
  for (const file of violations) console.error(`- ${file}`);
  process.exit(1);
}

console.log("민감 로컬 파일 Git 추적 검사를 통과했습니다.");
