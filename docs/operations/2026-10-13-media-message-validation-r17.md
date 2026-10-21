# Photo and video message diagnosis

Reported on all platforms. Storage transport probe: presigned PUT HTTP 200, read-back matched, generated diagnostic object deleted. Recent upload API requests: four HTTP 200 responses. Message POST aggregate over the same log window: 37 HTTP 201 and 13 HTTP 400. No user message contents or credentials printed.

Confirmed code incompatibility: client photo/video thumbnail strings can be about 9.5–10 KB; server generic metadata rejects strings over 1000 characters and total metadata over 4096 bytes. Existing compiled validator rejects a representative media payload with invalid metadata. Patched compiled validator accepts it.

Fix: JPEG data URL exception only for imageThumbnail on image messages and videoThumbnail on file messages. Maximum 10000 characters, valid base64, JPEG header/end markers. Remaining metadata retains the 1000-character individual and 4096-byte total limits, depth/key limits and dangerous-key rejection. Entire metadata is bounded to 16384 bytes.

Seven policy/schema tests passed; API TypeScript passed. Deployment package uses the existing production image, replaces only the matching validator function and call (old hash checked), preserves bundle line count, checks syntax and policy before/after, saves environment rollback, and recreates only the DAVAQ API container. No DB/schema, other services or native/web bundles changed.

Deployment NOT executed. Automatic approval review rejected the production deployment because the current request authorized diagnosis, not this specific production change. User approval requested. Package uploaded to CloudShell; no deployment SSH key was generated after rejection. Earlier diagnostic keys removed. Source and tests are ready for review.

## Deployment completed after approval

User explicitly approved production deployment. Pre-deployment comparison verified that the live validator rejected realistic photo/video thumbnails. The initial deploy check incorrectly expected the old validator to reject a short invalid JPEG; it was corrected and tested locally before retry. First attempt stopped before image build or environment/container change.

Final image localhost:5000/davaq-api@sha256:2dfae95788287d2f9ba687c217dc0fd5e1a0b21ccf52341063b5fa7fe2779ad8. Previous image sha256:f506b0b00895354307ffc27134e5d34868ea4cd4cd0286a7cf301e1b8a2c14da. Backup /opt/davaq-backups/before-media-policy-r17.env. Bundle SHA256 3eb03191721f1c9dec626778804d7f804ed20b17ee71972aedf04313c5c47372.

Live validator photo=true, video=true, invalid JPEG=false. API health ok, all other container identities/start times preserved. Temporary EIC key removed. Source maps retain surrounding line offsets; changed validator is compacted into the existing span. Web/native client packages unchanged; current installations benefit immediately. No message sent to another person for testing. End-to-end physical attachment/send verification remains pending user retry.
