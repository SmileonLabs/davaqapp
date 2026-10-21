-- Run once before deploying the content-report API. No UGC bodies or media
-- URLs are copied into this queue; moderators inspect the original by reference.
CREATE TABLE davaq_content_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
 target_type text NOT NULL CONSTRAINT davaq_content_reports_target_type_check CHECK(target_type IN('user','card_comment','listing_comment','message')),
 target_id uuid NOT NULL,
 target_owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
 reason text NOT NULL CONSTRAINT davaq_content_reports_reason_check CHECK(char_length(btrim(reason)) BETWEEN 5 AND 2000),
 status text NOT NULL DEFAULT 'pending' CONSTRAINT davaq_content_reports_status_check CHECK(status IN('pending','resolved','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 reviewer_id uuid REFERENCES users(id) ON DELETE SET NULL,
 review_note text,
 CONSTRAINT davaq_content_reports_review_note_check CHECK(review_note IS NULL OR char_length(btrim(review_note)) BETWEEN 5 AND 2000),
 CONSTRAINT davaq_content_reports_review_state_check CHECK((status='pending' AND reviewed_at IS NULL AND reviewer_id IS NULL AND review_note IS NULL)
   OR (status<>'pending' AND reviewed_at IS NOT NULL AND review_note IS NOT NULL))
);
CREATE UNIQUE INDEX davaq_content_reports_pending_unique
 ON davaq_content_reports(reporter_id,target_type,target_id) WHERE status='pending';
CREATE INDEX davaq_content_reports_queue ON davaq_content_reports(status,created_at,id);
CREATE INDEX davaq_content_reports_reporter_rate ON davaq_content_reports(reporter_id,created_at);
CREATE TABLE davaq_content_report_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 report_id uuid NOT NULL REFERENCES davaq_content_reports(id),
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 action text NOT NULL CONSTRAINT davaq_content_report_actions_action_check CHECK(action IN('reviewed','remove_content','dismissed')),
 note text NOT NULL CONSTRAINT davaq_content_report_actions_note_check CHECK(char_length(btrim(note)) BETWEEN 5 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX davaq_content_report_actions_report ON davaq_content_report_actions(report_id,created_at,id);
